/**
 * Deep links carrying a game code: `<scheme>://load?code=…` on a device,
 * `https://…/#code=…` on the web, and `https://…/?code=…` from the links the
 * web build wrote before the code moved into the fragment, which still load.
 * The code itself is validated by decodeGame.
 */

/**
 * The three places a code can hide in a link, read once so that the reader and
 * the cleaner below are looking at the same strings. `new URL` is the only
 * parse either of them gets: reading the raw href instead is how the two came
 * apart, because for a scheme the parser does not know - `multidcheckers://` -
 * `load` in `multidcheckers://load/CODE` is the HOST and never appears in the
 * pathname the cleaner rewrites.
 */
function partsOf(url: string): { path: string; query: string; hash: string } | null {
  try {
    const parsed = new URL(url);
    return { path: parsed.pathname, query: parsed.search, hash: parsed.hash };
  } catch {
    return null;
  }
}

export function codeFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const parts = partsOf(url);
  if (!parts) return null;
  const found = /[?&#]code=([^&#]+)/.exec(parts.query + parts.hash)?.[1];
  if (found !== undefined) {
    try {
      return decodeURIComponent(found);
    } catch {
      return found;
    }
  }
  // The last path segment only, out of the parsed path and never out of the
  // query or the fragment: what this finds has to be exactly what
  // urlWithoutCode can strip. A code it reads out of `/load/<code>/x`, out of
  // the fragment, or out of the host of a custom-scheme link is one the cleaner
  // leaves where it is, and a code left in the address bar is imported again on
  // every reload.
  return /\/load\/([^/?#]+)\/?$/.exec(parts.path)?.[1] ?? null;
}

let launchUrlTaken = false;

/**
 * The address the app was launched with, the first time it is asked for in a
 * run, and null every time after. `read` is the platform's getInitialURL,
 * which is no record of what is still waiting: React Native reports the intent
 * or launch option that started the app for as long as it runs, and
 * react-native-web the `location.href` it read when the bundle loaded, before
 * clearCodeFromUrl took the code out of it. The screen that asks is mounted
 * again by the error boundary, from both of its buttons, and asking again
 * there answered the link a second time: after "Start a new game" it loaded
 * the launch link's game over the new game the reset had just promised,
 * without a question, one the player had declined included, and after "Try
 * again" it put a declined link's question back. A link that arrives while the
 * app runs comes through the `url` event instead, once per link.
 */
export function takeLaunchUrl(read: () => Promise<string | null>): Promise<string | null> {
  if (launchUrlTaken) return Promise.resolve(null);
  launchUrlTaken = true;
  return read();
}

/**
 * A shareable link for the web build, or null when not running on the web.
 *
 * The code goes in the fragment, which a browser never sends to the host. In
 * the query it was part of the request line, at about a hundred bytes an
 * action, and a game past about eighty actions outgrew the 8 KB line that
 * Apache and nginx accept by default: the link answered "414 Request-URI Too
 * Large", the server's own page rather than the game. It also put the whole
 * game in the host's access log, which made the About card's "a game code goes
 * only where you send it" untrue. codeFromUrl reads both shapes, so a link sent
 * before this one still loads.
 */
export function webLinkFor(code: string): string | null {
  if (typeof window === 'undefined' || !window.location?.origin || window.location.origin.startsWith('null')) return null;
  return `${window.location.origin}${window.location.pathname}#code=${encodeURIComponent(code)}`;
}

/**
 * Calls `onUrl` with the page's address whenever its fragment changes, on the
 * web, and does nothing anywhere else; the answer removes the listener.
 *
 * A link to the page that is already open differs from it in the fragment
 * alone, so following it, or pasting it into the same tab, does not load the
 * page again: getInitialURL keeps answering the address the page loaded with,
 * and react-native-web's Linking never reports a `url` event. Without this the
 * game would simply not hear the link. clearCodeFromUrl's replaceState fires no
 * `hashchange`, so taking the code out again is not heard as a second link.
 */
export function onWebHashChange(onUrl: (url: string) => void): () => void {
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function' || typeof window.location?.href !== 'string') return () => {};
  const listener = () => onUrl(window.location.href);
  window.addEventListener('hashchange', listener);
  return () => window.removeEventListener('hashchange', listener);
}

/**
 * The same URL with any game code removed, or null when there was none. A code
 * left in the address bar is re-imported on every reload, replacing whatever has
 * been played since, so this is the inverse of codeFromUrl: whatever that reads
 * out of a link, this has to take back out of it.
 */
export function urlWithoutCode(href: string): string | null {
  try {
    const url = new URL(href);
    const before = url.pathname + url.search + url.hash;
    url.searchParams.delete('code');
    if (/[?&#]code=/.test(url.hash)) url.hash = '';
    // Once per segment: stripping `/load/x/load/y` leaves `/load/x/`, which is
    // itself a link the reader takes a code out of.
    while (/\/load\/[^/?#]+\/?$/.test(url.pathname)) url.pathname = url.pathname.replace(/\/load\/[^/?#]+\/?$/, '/');
    const after = url.pathname + url.search + url.hash;
    if (after === before) return null;
    // A custom-scheme link has no path at all (`multidcheckers://load?code=…`
    // parses as host `load`), so stripping its query can leave nothing. An
    // empty string is not a URL the caller can replace the address with - it
    // resolves back to the address it was given, code and all - so say `/`.
    return after === '' ? '/' : after;
  } catch {
    return null;
  }
}

/** Drop the game code from the web address bar, so a reload does not re-import it. */
export function clearCodeFromUrl(): void {
  if (typeof window === 'undefined') return;
  const href = window.location?.href;
  if (!href || typeof window.history?.replaceState !== 'function') return;
  const next = urlWithoutCode(href);
  // `null` is the only "nothing to strip": anything else, empty string included,
  // is an address that differs from the one the code is in.
  if (next !== null) window.history.replaceState(null, '', next);
}

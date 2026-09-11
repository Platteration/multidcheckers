/**
 * Deep links carrying a game code: `<scheme>://load?code=…` on a device,
 * `https://…/?code=…` on the web. The code itself is validated by decodeGame.
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
  const match = /[?&#]code=([^&#]+)/.exec(parts.query + parts.hash);
  if (match) {
    try {
      return decodeURIComponent(match[1]);
    } catch {
      return match[1];
    }
  }
  // The last path segment only, out of the parsed path and never out of the
  // query or the fragment: what this finds has to be exactly what
  // urlWithoutCode can strip. A code it reads out of `/load/<code>/x`, out of
  // the fragment, or out of the host of a custom-scheme link is one the cleaner
  // leaves where it is, and a code left in the address bar is imported again on
  // every reload.
  const path = /\/load\/([^/?#]+)\/?$/.exec(parts.path);
  return path ? path[1] : null;
}

/** A shareable link for the web build, or null when not running on the web. */
export function webLinkFor(code: string): string | null {
  if (typeof window === 'undefined' || !window.location?.origin || window.location.origin.startsWith('null')) return null;
  return `${window.location.origin}${window.location.pathname}?code=${encodeURIComponent(code)}`;
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

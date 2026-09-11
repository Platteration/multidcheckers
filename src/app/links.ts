/**
 * Deep links carrying a game code: `<scheme>://load?code=…` on a device,
 * `https://…/?code=…` on the web. The code itself is validated by decodeGame.
 */
export function codeFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const match = /[?&#]code=([^&#]+)/.exec(url);
  if (match) {
    try {
      return decodeURIComponent(match[1]);
    } catch {
      return match[1];
    }
  }
  // The last path segment only, and never what follows a `?` or a `#`: what
  // this finds has to be exactly what urlWithoutCode can strip. A code it reads
  // out of `/load/<code>/x` or out of the fragment is one the cleaner leaves
  // where it is, and a code left in the address bar is imported again on every
  // reload.
  const path = /\/load\/([^/?#]+)\/?$/.exec(url.replace(/[?#][\s\S]*$/, ''));
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
    return after === before ? null : after;
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
  if (next) window.history.replaceState(null, '', next);
}

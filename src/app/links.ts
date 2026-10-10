/**
 * Deep links carrying a game code: `<scheme>://load?code=…` on a device,
 * `https://…/?code=…` on the web. The code itself is validated by decodeGame.
 */
const MAX_CODE_LENGTH = 12000;

function decodeSafe(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function sanitizeCode(raw: string): string | null {
  if (raw.length > MAX_CODE_LENGTH) return null;
  const decoded = decodeSafe(raw);
  return decoded.length <= MAX_CODE_LENGTH ? decoded : null;
}

export function codeFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const match = /[?&#]code=([^&#]+)/.exec(url);
  if (match) {
    return sanitizeCode(match[1]);
  }
  const path = /\/load\/([^/?#]+)/.exec(url);
  return path?.[1] ? sanitizeCode(path[1]) : null;
}

/** Remove a consumed web deep-link so a reload cannot replay it. */
export function clearCodeFromUrl(): void {
  if (typeof window === 'undefined' || !window.location?.href || !window.history?.replaceState) return;
  try {
    const url = new URL(window.location.href);
    let changed = false;
    if (url.searchParams.has('code')) {
      url.searchParams.delete('code');
      changed = true;
    }
    if (url.hash.startsWith('#code=')) {
      url.hash = '';
      changed = true;
    }
    if (changed) window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
  } catch {
    // A non-browser URL implementation should not prevent opening a game.
  }
}

/** A shareable link for the web build, or null when not running on the web. */
export function webLinkFor(code: string): string | null {
  if (typeof window === 'undefined' || !window.location?.origin || window.location.origin.startsWith('null')) return null;
  return `${window.location.origin}${window.location.pathname}?code=${encodeURIComponent(code)}`;
}

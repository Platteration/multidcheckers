/**
 * The page's window as a browser has it, for the code that reads the address
 * or listens for `hashchange`. Not a test file: `testMatch` only picks up
 * `*.test.ts`. In this environment `window` is the global object, with no
 * location and no events of its own, so this puts them there; `restore` puts
 * back what was there before.
 */
export function onWebPage(href: string) {
  const g = globalThis as unknown as Record<string, unknown>;
  const before = { location: g.location, addEventListener: g.addEventListener, removeEventListener: g.removeEventListener };
  const listeners = new Set<() => void>();
  const location = { href, origin: new URL(href).origin, pathname: new URL(href).pathname };
  g.location = location;
  g.addEventListener = (type: string, fn: () => void) => type === 'hashchange' && listeners.add(fn);
  g.removeEventListener = (type: string, fn: () => void) => type === 'hashchange' && listeners.delete(fn);
  return {
    listeners,
    /** Following a link to this same page: only the fragment changes, so nothing loads again. */
    follow(next: string) {
      location.href = next;
      for (const fn of [...listeners]) fn();
    },
    restore() {
      for (const [key, value] of Object.entries(before)) {
        if (value === undefined) delete g[key];
        else g[key] = value;
      }
    },
  };
}

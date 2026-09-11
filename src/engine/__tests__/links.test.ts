/**
 * Links carrying a game code. A code left in the web address bar is re-imported
 * on every reload, which throws away whatever has been played since.
 */
import { codeFromUrl, urlWithoutCode } from '../../app/links';

describe('codeFromUrl', () => {
  it('finds the code in every shape of link', () => {
    expect(codeFromUrl('https://example.com/?code=5DCK.abc')).toBe('5DCK.abc');
    expect(codeFromUrl('multidcheckers://load?code=5DCK.abc')).toBe('5DCK.abc');
    expect(codeFromUrl('https://example.com/#code=5DCK.abc')).toBe('5DCK.abc');
    expect(codeFromUrl('https://example.com/load/5DCK.abc')).toBe('5DCK.abc');
    expect(codeFromUrl('https://example.com/?code=5DCK.a%2Bb')).toBe('5DCK.a+b');
  });

  it('finds nothing where there is nothing', () => {
    expect(codeFromUrl(null)).toBeNull();
    expect(codeFromUrl('https://example.com/')).toBeNull();
  });

  it('reads no code it could not hand back to urlWithoutCode', () => {
    // A code taken out of a shape the cleaner cannot rewrite is imported again
    // on every reload. The fragment matters most: it never reaches the server,
    // so any static host serving index.html at / loads the app with it.
    expect(codeFromUrl('https://example.com/load/5DCK.abc/x')).toBeNull();
    expect(codeFromUrl('https://example.com/a/load/5DCK.abc/b/c')).toBeNull();
    expect(codeFromUrl('https://example.com/?x=1#/load/5DCK.abc')).toBeNull();
    // The host, not the path: for a scheme the parser does not know, `load` in
    // `multidcheckers://load/CODE` is where the host goes, so the cleaner's
    // rewrite of the pathname can never reach it. Reading the raw href instead
    // of the parse is what let the reader see a code the cleaner could not.
    expect(codeFromUrl('multidcheckers://load/5DCK.abc')).toBeNull();
    // The query of the same link is read, and is strippable.
    expect(codeFromUrl('multidcheckers://load?code=5DCK.abc')).toBe('5DCK.abc');
  });
});

/**
 * Every shape a link can take, generated rather than listed. A list of examples
 * only pins the examples somebody thought of: the shape this pair came apart on
 * - `<scheme>://load/<code>`, where the parser puts `load` in the HOST and the
 * pathname the cleaner rewrites never contains it - was not among the twelve
 * that were listed, and the property was claimed as proven anyway.
 */
const ORIGINS = [
  'https://example.com',
  'https://user.github.io/multidcheckers',
  'http://localhost:8081',
  'multidcheckers://load',
  'multidcheckers://',
  'exp://192.168.0.2:8081/--',
];
const PATHS = ['', '/', '/game/', '/load/5DCK.abc', '/load/5DCK.abc/', '/load/5DCK.abc/x', '/a/load/5DCK.p/b', '/load/5DCK.a/load/5DCK.b'];
const QUERIES = ['', '?x=1', '?code=5DCK.q', '?x=1&code=5DCK.q'];
const HASHES = ['', '#x', '#code=5DCK.h', '#/load/5DCK.h'];
const SHAPES: string[] = [];
for (const origin of ORIGINS) {
  for (const path of PATHS) {
    for (const query of QUERIES) {
      for (const hash of HASHES) SHAPES.push(origin + path + query + hash);
    }
  }
}

describe('urlWithoutCode', () => {
  it('leaves nothing a reload could import again, in any shape of link', () => {
    // The pair has to be an inverse of each other over every shape, not over
    // the ones the app writes: whatever codeFromUrl reads out of a link,
    // urlWithoutCode has to be able to take back out of it.
    expect(SHAPES.length).toBeGreaterThan(500);
    let read = 0;
    for (const href of SHAPES) {
      if (codeFromUrl(href) === null) continue;
      read++;
      const next = urlWithoutCode(href);
      // Only null means "there was nothing to strip". The empty string is an
      // address of its own, and one the caller must not be handed: replacing
      // the address with it resolves back to the address the code is in.
      expect(next).not.toBeNull();
      expect(next).not.toBe('');
      expect(codeFromUrl(next)).toBeNull();
    }
    // Most of them do carry a code; a property nothing satisfies proves nothing.
    expect(read).toBeGreaterThan(SHAPES.length / 2);
  });

  it('keeps the rest of the address', () => {
    expect(urlWithoutCode('https://example.com/game/?code=5DCK.abc&x=1')).toBe('/game/?x=1');
    expect(urlWithoutCode('https://example.com/?code=5DCK.abc')).toBe('/');
  });

  it('says so when there was nothing to strip', () => {
    expect(urlWithoutCode('https://example.com/game/?x=1')).toBeNull();
    expect(urlWithoutCode('not a url')).toBeNull();
  });
});

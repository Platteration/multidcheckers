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
  });
});

describe('urlWithoutCode', () => {
  it('leaves nothing a reload could import again', () => {
    // The pair has to be an inverse of each other over every shape, not over
    // the four the app writes: whatever codeFromUrl reads out of a link,
    // urlWithoutCode has to be able to take back out of it.
    for (const href of [
      'https://example.com/?code=5DCK.abc',
      'https://example.com/game/?code=5DCK.abc&x=1',
      'https://example.com/#code=5DCK.abc',
      'https://example.com/load/5DCK.abc',
      'https://example.com/load/5DCK.abc/',
      'https://example.com/load/5DCK.abc/x',
      'https://example.com/a/load/5DCK.abc/b/c',
      'https://example.com/load/5DCK.a/load/5DCK.b',
      'https://example.com/load/5DCK.abc?code=5DCK.def',
      'https://example.com/load/5DCK.abc#code=5DCK.def',
      'https://example.com/?x=1#/load/5DCK.abc',
      'multidcheckers://load?code=5DCK.abc',
    ]) {
      if (codeFromUrl(href) === null) continue;
      const next = urlWithoutCode(href);
      expect(next).not.toBeNull();
      expect(codeFromUrl(next)).toBeNull();
    }
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

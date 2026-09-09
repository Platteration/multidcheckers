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
});

describe('urlWithoutCode', () => {
  it('leaves nothing a reload could import again', () => {
    for (const href of [
      'https://example.com/?code=5DCK.abc',
      'https://example.com/game/?code=5DCK.abc&x=1',
      'https://example.com/#code=5DCK.abc',
      'https://example.com/load/5DCK.abc',
    ]) {
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

/**
 * Links carrying a game code. A code left in the web address bar is re-imported
 * on every reload, which throws away whatever has been played since.
 */
import fs from 'fs';
import path from 'path';
import { codeFromUrl, onWebHashChange, urlWithoutCode, webLinkFor } from '../../app/links';
import { decodeGame, encodeGame } from '../../app/share';
import { onWebPage } from '../../app/__tests__/webPage';
import { GameState, applyAction, chooseAction, newGame } from '../index';

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
/** Each shape with the scheme and host it arrived under: the cleaner answers with a path. */
const SHAPES: { origin: string; href: string }[] = [];
for (const origin of ORIGINS) {
  for (const path of PATHS) {
    for (const query of QUERIES) {
      for (const hash of HASHES) SHAPES.push({ origin, href: origin + path + query + hash });
    }
  }
}

/**
 * The cleaned address as the browser will hold it. `urlWithoutCode` answers
 * with a path, `history.replaceState` resolves that against the address it is
 * already showing, and `new URL` throws on a relative path - so re-reading the
 * bare answer found "no code" whatever the cleaner had actually left behind.
 * That is what made the property below pass while proving nothing.
 */
const backInTheAddressBar = (origin: string, cleaned: string): string => new URL(cleaned, origin).href;

describe('urlWithoutCode', () => {
  it('leaves nothing a reload could import again, in any shape of link', () => {
    // The pair has to be an inverse of each other over every shape, not over
    // the ones the app writes: whatever codeFromUrl reads out of a link,
    // urlWithoutCode has to be able to take back out of it.
    expect(SHAPES.length).toBeGreaterThan(500);
    let read = 0;
    for (const { origin, href } of SHAPES) {
      if (codeFromUrl(href) === null) continue;
      read++;
      const next = urlWithoutCode(href);
      // Only null means "there was nothing to strip". The empty string is an
      // address of its own, and one the caller must not be handed: replacing
      // the address with it resolves back to the address the code is in.
      expect(next).not.toBeNull();
      expect(next).not.toBe('');
      // Read back through the scheme and host it will really sit under, which
      // is the whole point: this is the address the next reload starts from.
      expect(codeFromUrl(backInTheAddressBar(origin, next!))).toBeNull();
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

describe('takeLaunchUrl', () => {
  // The platform's getInitialURL reports the launch link for the whole run, so
  // a second mount of the screen asking it again re-imported a link already
  // answered (src/ui/__tests__/launchLink.test.ts drives that through the app).
  // Each case loads the module afresh: what it remembers is per run.
  const fresh = (): typeof import('../../app/links') => {
    let mod!: typeof import('../../app/links');
    jest.isolateModules(() => {
      mod = require('../../app/links');
    });
    return mod;
  };

  it('hands over the launch link the first time it is asked, and nothing after', async () => {
    const { takeLaunchUrl } = fresh();
    const read = jest.fn(async () => 'multidcheckers://?code=5DCK.abc');
    await expect(takeLaunchUrl(read)).resolves.toBe('multidcheckers://?code=5DCK.abc');
    await expect(takeLaunchUrl(read)).resolves.toBeNull();
    await expect(takeLaunchUrl(read)).resolves.toBeNull();
    // Not asked again at all, so a platform that keeps reporting it cannot.
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('counts a launch with no link, or one that could not be read, as the one ask', async () => {
    const quiet = fresh();
    await expect(quiet.takeLaunchUrl(async () => null)).resolves.toBeNull();
    await expect(quiet.takeLaunchUrl(async () => 'multidcheckers://?code=5DCK.late')).resolves.toBeNull();

    const failing = fresh();
    await expect(failing.takeLaunchUrl(() => Promise.reject(new Error('no native module')))).rejects.toThrow('no native module');
    await expect(failing.takeLaunchUrl(async () => 'multidcheckers://?code=5DCK.late')).resolves.toBeNull();
  });
});

/**
 * e2e/long-game.txt, the code the browser suite opens as a link: a game of 90
 * actions between two seeded bots of the middle level, which is how long a
 * code a game reaches long before it ends (seeded bot games ran 180 to 400
 * actions). Regenerated here so the file cannot drift from the engine.
 */
function ninetyActionGame(): GameState[] {
  let seed = 1;
  const rng = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
  const history: GameState[] = [newGame()];
  while (history.length <= 90) {
    const state = history[history.length - 1]!;
    const action = chooseAction(state, 2, rng);
    if (!action) throw new Error('the seeded game ended before 90 actions');
    history.push(applyAction(state, action));
  }
  return history;
}

/**
 * The longest request line Apache accepts by default (LimitRequestLine);
 * nginx's default 8 KB header buffer refuses about the same. Past it both
 * answer 414 with their own error page (e2e/hosts.mjs measures both).
 */
const REQUEST_LINE_LIMIT = 8190;

describe('webLinkFor', () => {
  let page: ReturnType<typeof onWebPage> | null = null;
  afterEach(() => {
    page?.restore();
    page = null;
  });

  it('carries the code in the fragment, which a browser never sends to the host', () => {
    page = onWebPage('https://example.com/multidcheckers/?x=1#y');
    const link = webLinkFor('5DCK.a+b');
    expect(link).toBe('https://example.com/multidcheckers/#code=5DCK.a%2Bb');
    // What the host is asked for: the path, and nothing of the game.
    const url = new URL(link!);
    expect(url.pathname + url.search).toBe('/multidcheckers/');
    // And the pair that reads and clears it handles it.
    expect(codeFromUrl(link)).toBe('5DCK.a+b');
    expect(urlWithoutCode(link!)).toBe('/multidcheckers/');
  });

  it('is null away from a web page', () => {
    expect(webLinkFor('5DCK.abc')).toBeNull();
  });

  it('keeps a long game out of the request line: the 90-action code the browser suite opens', () => {
    const code = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'e2e', 'long-game.txt'), 'utf8').trim();
    const history = ninetyActionGame();
    // Paste this into e2e/long-game.txt if the engine has changed the game.
    expect(code).toBe(encodeGame(history, { mode: 'local' }));
    expect(decodeGame(code).history).toHaveLength(91);
    page = onWebPage('https://platteration.github.io/multidcheckers/');
    const link = webLinkFor(code)!;
    // Far past what a host takes in a request line, so in the query it was a 414 ...
    expect(link.length).toBeGreaterThan(REQUEST_LINE_LIMIT);
    // ... and in the fragment the host is asked for the page alone.
    const url = new URL(link);
    expect(`GET ${url.pathname}${url.search} HTTP/1.1`.length).toBeLessThan(100);
    expect(codeFromUrl(link)).toBe(code);
  });
});

describe('onWebHashChange', () => {
  it('hears a link to the open page, which changes the fragment alone, until it is removed', () => {
    const page = onWebPage('https://example.com/multidcheckers/');
    try {
      const heard: string[] = [];
      const remove = onWebHashChange((url) => heard.push(url));
      page.follow('https://example.com/multidcheckers/#code=5DCK.abc');
      expect(heard).toEqual(['https://example.com/multidcheckers/#code=5DCK.abc']);
      remove();
      expect(page.listeners.size).toBe(0);
      page.follow('https://example.com/multidcheckers/#code=5DCK.def');
      expect(heard).toHaveLength(1);
    } finally {
      page.restore();
    }
  });

  it('listens to nothing away from a web page', () => {
    const heard: string[] = [];
    const remove = onWebHashChange((url) => heard.push(url));
    expect(typeof remove).toBe('function');
    remove();
    expect(heard).toEqual([]);
  });
});

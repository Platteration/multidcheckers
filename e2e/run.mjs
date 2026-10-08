// The website, end to end: the built site (scripts/build-web.mjs --base /multidcheckers) served
// under that sub-path by e2e/serve.mjs, which answers with the headers public/_headers writes and
// the 404s public/_redirects writes, and the game played in Chromium under them.
//
// It fails on any Content-Security-Policy or Trusted Types violation (the page's own
// securitypolicyviolation events and the console's reports), any page error, any console error,
// and any request outside the site's sub-path, and it plays the game: the welcome, a move for each
// side, a time travel that branches a timeline, an undo, a capture, the sounds, Play by message
// (copy, the share sheet and the link it is handed, that link followed in the tab already showing
// the game, a link in the shape sent before, and a 90-action game's link, longer than any host
// takes in a request line), the settings, a reload that keeps the game, a game against the bot,
// the replay, the other sheets and a puzzle. Then the not-found page, the repository's own files,
// and the safety net: a bundle that does not load, a bundle that throws, and no JavaScript at all.
// e2e/hosts.mjs then serves the same site from a real nginx and a real Apache.
//
//   npm run test:e2e        builds the site, then runs this
//   node e2e/run.mjs        runs this against the dist-web/ already built
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { REQUEST_LINE_LIMIT, headersFor, parseHeaders, serveSite } from './serve.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(root, 'package.json'));
const BASE = '/multidcheckers';
const SITE = path.join(root, 'dist-web');
const NOT_FOUND = 'That page isn’t here';
/** What the Vibration row says in a browser: src/ui/SettingsModal.tsx's WEB_VIBRATION_HINT. */
const WEB_VIBRATION_HINT = 'A browser cannot vibrate for the game; the phone app can.';

// Playwright is a devDependency. Missing, this fails rather than skips: a skipped browser suite
// reads as a passed one.
const { chromium } = require('playwright');

if (!fs.existsSync(path.join(SITE, 'index.html'))) {
  console.error(`e2e: no site in ${path.relative(root, SITE)}; run npm run test:e2e, which builds it first`);
  process.exit(1);
}
const index = fs.readFileSync(path.join(SITE, 'index.html'), 'utf8');
assert.ok(index.includes(`src="${BASE}/_expo/static/js/web/`), `the site was built for ${BASE}: run node scripts/build-web.mjs --base ${BASE}`);

const headerRules = parseHeaders(fs.readFileSync(path.join(SITE, '_headers'), 'utf8'));
// The page carries the header's policy as a <meta> too, less frame-ancestors, which a meta cannot
// set: a host with no headers of its own (GitHub Pages) still holds the game to it.
const policy = headersFor(headerRules, '/').headers.get('content-security-policy');
const metas = [...index.matchAll(/<meta http-equiv="Content-Security-Policy" content="([^"]+)" \/>/g)].map((m) => m[1]);
assert.deepEqual(metas, [policy.split('; ').filter((d) => !d.startsWith('frame-ancestors')).join('; ')], 'the built page carries the policy once, as _headers writes it');
const site = await serveSite({ root: SITE, base: BASE });
// The full Chromium build, not the headless shell: only the full browser fetches the favicon,
// which is what showed that the policy needs img-src.
const browser = await chromium.launch({ channel: 'chromium' });
const problems = [];

/** Every path a response in the browser came from, to check its headers off the browser too. */
const seen = new Set();

/**
 * Watches a page for everything this suite fails on. `expected` names the console errors and
 * page errors a scenario causes on purpose (the caller may add to it and empty it again);
 * nothing excuses a policy violation or a request outside the site.
 */
async function watched(context, label, expected = []) {
  const page = await context.newPage();
  const allowed = (text) => expected.some((re) => re.test(text));
  await page.exposeBinding('__e2eViolation', (_source, report) => problems.push(`${label}: policy violation: ${report}`));
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) => {
      window.__e2eViolation(`${e.violatedDirective} blocked ${e.blockedURI || '(inline)'} at ${e.sourceFile}:${e.lineNumber} ${e.sample}`);
    });
    // Every sound the game plays, and whether the browser let it.
    window.__e2ePlays = [];
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      const name = String(this.currentSrc || this.src).split('/').pop().split('.')[0];
      const result = play.call(this);
      result.then(
        () => window.__e2ePlays.push(`${name} played`),
        (e) => window.__e2ePlays.push(`${name} refused: ${e.name}`),
      );
      return result;
    };
    // Every write to the clipboard through the API Permissions-Policy governs. Under
    // clipboard-write=() it is refused and expo-clipboard falls back to execCommand('copy'),
    // which still says "Copied", so the note alone would not show the policy is right.
    window.__e2eClipboard = [];
    if (navigator.clipboard) {
      const writeText = navigator.clipboard.writeText.bind(navigator.clipboard);
      navigator.clipboard.writeText = (text) => {
        const result = writeText(text);
        result.then(
          () => window.__e2eClipboard.push('written'),
          (e) => window.__e2eClipboard.push(`refused: ${e.name}`),
        );
        return result;
      };
    }
  });
  page.on('console', (m) => {
    const text = m.text();
    if (/Content.Security.Policy|Trusted Type/i.test(text) || (m.type() === 'error' && !allowed(text))) problems.push(`${label}: console.${m.type()}: ${text}`);
  });
  page.on('pageerror', (e) => {
    if (!allowed(e.message)) problems.push(`${label}: page error: ${e.message}`);
  });
  page.on('request', (r) => {
    const url = r.url();
    if (!url.startsWith(site.url) && url !== `${site.origin}${BASE}`) problems.push(`${label}: request outside the site: ${url}`);
  });
  page.on('response', (r) => {
    const url = new URL(r.url());
    if (!url.pathname.startsWith(`${BASE}/`)) return;
    // Every response carries exactly what _headers gives its path. Strict-Transport-Security
    // is the exception here: a browser ignores it from a plain-HTTP origin and does not keep it
    // with a cached response, so it is checked off the browser instead, below.
    const sitePath = decodeURIComponent(url.pathname.slice(BASE.length));
    seen.add(sitePath);
    const want = headersFor(headerRules, sitePath).headers;
    const got = r.headers();
    for (const [name, value] of want) {
      if (name !== 'strict-transport-security' && got[name] !== value) problems.push(`${label}: ${url.pathname} answered ${name}: ${got[name]}, not ${value}`);
    }
  });
  page.setDefaultTimeout(15000);
  return page;
}

const button = (page, name) => page.getByRole('button', { name, exact: true });
const press = async (page, name) => {
  await button(page, name).click();
};
/** The labels of every square of the big board that holds a piece. */
const pieces = async (page) =>
  (await page.getByRole('button', { name: /^[a-h][1-8], (Red|Black) (man|king)$/ }).evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')))).sort();
/** Picks a piece up and puts it down: a square's label, then the square it goes to. */
const move = async (page, from, to) => {
  await press(page, from);
  await press(page, to);
};

/** WCAG contrast of an element's text against the background of the card it sits on. */
async function contrast(page, selector, cardSelector) {
  return page.evaluate(
    ([sel, card]) => {
      const rgb = (c) => c.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number);
      const lum = ([r, g, b]) => {
        const f = (v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
      };
      const el = document.querySelector(sel);
      const fg = lum(rgb(getComputedStyle(el).color));
      const ownBg = getComputedStyle(el).backgroundColor;
      const bg = lum(rgb(ownBg !== 'rgba(0, 0, 0, 0)' ? ownBg : getComputedStyle(document.querySelector(card)).backgroundColor));
      return (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
    },
    [selector, cardSelector],
  );
}

let current = 'setup';
async function step(name, fn) {
  current = name;
  await fn();
  console.log(`ok - ${name}`);
}

try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, permissions: ['clipboard-write'] });
  // Chromium has a share sheet (navigator.share) on macOS and Windows and none on Linux. It is taken
  // away here, so Share… falls back to the clipboard on every system this runs on, and a step below
  // hands the page a share sheet of its own to see what Share… gives one.
  await context.addInitScript(() => {
    delete Navigator.prototype.share;
    delete Navigator.prototype.canShare;
  });
  const expected = [];
  const page = await watched(context, 'game', expected);
  let code = '';
  let link = '';

  await step('the page loads under the policy, and the welcome opens', async () => {
    const response = await page.goto(site.url);
    assert.equal(response.status(), 200);
    assert.ok(response.headers()['content-security-policy'].includes("frame-ancestors 'none'"));
    assert.equal(await page.title(), '5D Checkers');
    await button(page, 'Next').waitFor();
    assert.equal(await page.locator('#boot-failed').isHidden(), true, 'the safety net stays out of sight when the game starts');
    await press(page, 'Next');
    await press(page, 'Next');
    await press(page, 'Just play');
    await button(page, 'Just play').waitFor({ state: 'detached' });
  });

  await step('each side moves a piece', async () => {
    await move(page, 'b3, Red man', 'c4, move here');
    await button(page, 'c4, Red man').waitFor();
    await move(page, 'c6, Black man', 'd5, move here');
    await button(page, 'd5, Black man').waitFor();
  });

  await step('a piece travels into the past and branches a timeline', async () => {
    // c4 was empty at the start, a board where Red was to move: the man can go back there.
    await press(page, 'c4, Red man');
    await press(page, 'Timeline 1 turn 0, Red to move, travel target');
    await button(page, 'Timeline 2 turn 1, Black to move, waiting').waitFor();
    await page.getByText('Black to move · 2 boards waiting').waitFor();
  });

  await step('undo takes the travel back', async () => {
    await press(page, 'Undo');
    await button(page, 'Timeline 2 turn 1, Black to move, waiting').waitFor({ state: 'detached' });
    await page.getByText('Red to move · 1 board waiting').waitFor();
  });

  await step('a man jumps another, and the captured one leaves the board', async () => {
    await move(page, 'h3, Red man', 'g4, move here');
    // A capture is compulsory: the jump is the only square the board offers Black's man.
    await move(page, 'd5, Black man', 'b3, jump here');
    await button(page, 'b3, Black man').waitFor();
    await button(page, 'c4').waitFor();
    await page.getByText('Red to move · 1 board waiting').waitFor();
  });

  await step('the sounds play, from the site itself', async () => {
    await page.waitForFunction(() => window.__e2ePlays.some((p) => p.startsWith('thud')));
    const plays = await page.evaluate(() => window.__e2ePlays);
    for (const sound of ['tap', 'warp', 'thud']) assert.ok(plays.includes(`${sound} played`), `${sound} played: ${plays.join(', ')}`);
  });

  await step('Play by message copies the code', async () => {
    await press(page, 'Menu');
    await press(page, 'Play by message');
    code = (await page.getByText(/^5DCK\./).innerText()).trim();
    assert.match(code, /^5DCK\.[A-Za-z0-9_-]+/);
    await press(page, 'Copy');
    await page.getByText('Copied. Paste it into any message.').waitFor();
    assert.deepEqual(await page.evaluate(() => window.__e2eClipboard), ['written']);
    await press(page, 'Close');
  });

  await step('Share… with no share sheet in this browser copies instead, and says so', async () => {
    // A browser with no navigator.share (the context took it away); the button must still do
    // something visible.
    assert.equal(await page.evaluate(() => 'share' in navigator), false);
    await press(page, 'Menu');
    await press(page, 'Play by message');
    await press(page, 'Share…');
    // The sheet keeps its note from the Copy above, so what shows the fallback ran is the
    // second write to the clipboard.
    await page.waitForFunction(() => window.__e2eClipboard.length === 2);
    assert.deepEqual(await page.evaluate(() => window.__e2eClipboard), ['written', 'written']);
    await page.getByText('Copied. Paste it into any message.').waitFor();
    await press(page, 'Close');
  });

  await step('Share… hands a share sheet the game as a link, with the code where no host sees it', async () => {
    await page.evaluate(() => {
      window.__e2eShared = [];
      navigator.share = (data) => {
        window.__e2eShared.push(data.text);
        return Promise.resolve();
      };
    });
    await press(page, 'Menu');
    await press(page, 'Play by message');
    await press(page, 'Share…');
    await page.waitForFunction(() => window.__e2eShared.length === 1);
    const [text] = await page.evaluate(() => window.__e2eShared);
    await page.evaluate(() => delete navigator.share);
    link = text.split('\n')[0];
    assert.equal(text, `${link}\n\n(or paste this code into the app)\n${code}`);
    // In the fragment: a browser never sends it, so the host neither logs the game nor has to
    // take it in a request line.
    assert.equal(link, `${site.url}#code=${encodeURIComponent(code)}`);
    await press(page, 'Close');
  });

  await step('the settings sheet works, and says what a browser cannot do', async () => {
    await press(page, 'Menu');
    await press(page, 'Settings');
    await page.getByText(WEB_VIBRATION_HINT).waitFor();
    assert.equal(await page.getByRole('switch', { name: 'Vibration' }).isDisabled(), true, 'the Vibration switch cannot be pressed in a browser');
    assert.equal(await page.getByRole('switch', { name: 'Sound' }).isDisabled(), false);
    await press(page, 'Dark');
    await press(page, 'Done');
    // The screen behind the header, now in the dark palette's background (src/ui/theme.ts).
    const screen = () =>
      page.evaluate(() => {
        for (let el = document.elementFromPoint(4, 4); el; el = el.parentElement) {
          const bg = getComputedStyle(el).backgroundColor;
          if (bg !== 'rgba(0, 0, 0, 0)') return bg;
        }
        return null;
      });
    await page.waitForFunction(() => !document.querySelector('[aria-modal="true"]'));
    assert.equal(await screen(), 'rgb(25, 35, 45)');
  });

  await step('a reload brings the same game back', async () => {
    const before = await pieces(page);
    // Twelve men a side, less the one Black took.
    assert.equal(before.length, 23);
    await page.reload();
    await button(page, 'Menu').waitFor();
    await page.waitForFunction((n) => document.querySelectorAll('[aria-label$=" man"], [aria-label$=" king"]').length >= n, before.length);
    assert.deepEqual(await pieces(page), before);
  });

  await step('a link in the shape the game wrote before, ?code=, still loads, and leaves the address clean', async () => {
    await page.goto(`${site.url}?code=${encodeURIComponent(code)}`);
    await page.getByText('Load the game from this link?').waitFor();
    await press(page, 'Yes, load it');
    await page.waitForFunction(() => !location.search.includes('code='));
    assert.equal(new URL(page.url()).pathname, `${BASE}/`);
    // The code was made after the capture: Red to move, the jumped man gone.
    await page.getByText('Red to move · 1 board waiting').waitFor();
    await button(page, 'b3, Black man').waitFor();
  });

  await step('the link Share… made, followed in the tab already showing the game, is heard and loads', async () => {
    // Undo Black's capture, so the game the link brings back is not the one on the screen.
    await press(page, 'Undo');
    await button(page, 'c4, Red man').waitFor();
    // Only the fragment differs from the address on show, so the browser loads nothing again and
    // the game hears the link through hashchange or not at all.
    await page.goto(link);
    await page.getByText('Load the game from this link?').waitFor();
    await press(page, 'Yes, load it');
    await button(page, 'b3, Black man').waitFor();
    await button(page, 'c4').waitFor();
    await page.getByText('Red to move · 1 board waiting').waitFor();
    await page.waitForFunction(() => location.hash === '');
    assert.equal(new URL(page.url()).pathname, `${BASE}/`);
  });

  await step('a 90-action game travels as a link too, longer than any host takes in a request line', async () => {
    const long = fs.readFileSync(path.join(root, 'e2e', 'long-game.txt'), 'utf8').trim();
    // In the query, as links were written before, no host would get as far as the game.
    assert.equal((await page.request.get(`${site.url}?code=${encodeURIComponent(long)}`)).status(), 414);
    const sending = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const s = await watched(sending, 'long game, sent');
    await s.addInitScript(() => {
      window.__e2eShared = [];
      Object.defineProperty(navigator, 'share', {
        configurable: true,
        value: (data) => {
          window.__e2eShared.push(data.text);
          return Promise.resolve();
        },
      });
    });
    await s.goto(site.url);
    await press(s, 'Skip');
    await press(s, 'Menu');
    await press(s, 'Play by message');
    await s.getByLabel('Game code to load').fill(long);
    await press(s, 'Load this game');
    // A code that loads closes the sheet on the game it holds.
    await button(s, 'Load this game').waitFor({ state: 'detached' });
    await s.getByText('Timeline 1 · turn 90 · now').waitFor();
    await press(s, 'Menu');
    await press(s, 'Play by message');
    await press(s, 'Share…');
    await s.waitForFunction(() => window.__e2eShared.length === 1);
    const longLink = (await s.evaluate(() => window.__e2eShared[0])).split('\n')[0];
    assert.ok(longLink.startsWith(`${site.url}#code=`), longLink.slice(0, 120));
    assert.ok(longLink.length > REQUEST_LINE_LIMIT, `the link is ${longLink.length} characters`);
    await press(s, 'Close');
    const sent = await pieces(s);
    const status = await s.getByText(/ to move · \d+ boards? waiting$/).innerText();

    const receiving = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const r = await watched(receiving, 'long game, received');
    const response = await r.goto(longLink);
    assert.equal(response.status(), 200);
    await press(r, 'Skip');
    await r.getByText(status, { exact: true }).waitFor();
    assert.deepEqual(await pieces(r), sent);
    await r.waitForFunction(() => location.hash === '');
    await sending.close();
    await receiving.close();
  });

  await step('the bot answers a move', async () => {
    await press(page, 'Menu');
    await press(page, 'New game');
    await press(page, 'Yes, new game');
    await press(page, 'Me against a bot');
    await press(page, 'Start');
    await move(page, 'b3, Red man', 'c4, move here');
    // The bot has moved once a Black man stands on a square no Black man starts on.
    await page.getByRole('button', { name: /^[a-h][1-5], Black man$/ }).waitFor();
    await page.getByText('Red to move · 1 board waiting').waitFor();
  });

  await step('every other sheet opens under the policy: the replay, the rules, the record, the extras, a puzzle', async () => {
    // The menu slides away after it hands over, and until it has gone its own Close is a second
    // button of that name: each sheet is used once the menu's buttons are gone.
    const fromMenu = async (item) => {
      await press(page, 'Menu');
      await press(page, item);
      await button(page, 'Your record').waitFor({ state: 'detached' });
    };
    await fromMenu('Replay this game');
    await press(page, '▶');
    await press(page, 'Back to game');
    await fromMenu('How to play');
    await page.getByText('How to play 5D Checkers').waitFor();
    await press(page, 'Got it');
    await fromMenu('Your record');
    await page.getByText('Time travels made', { exact: true }).waitFor();
    await press(page, 'Close');
    await fromMenu('Extras');
    await page.getByText('Supporter pack', { exact: true }).waitFor();
    await press(page, 'Close');
    await fromMenu('Puzzles');
    await page.getByRole('button', { name: /^Puzzle 1: / }).click();
    await page.getByRole('button', { name: /^Puzzle 1: / }).waitFor({ state: 'detached' });
    // A puzzle, not the game before it: only a puzzle offers a hint.
    await press(page, 'Hint');
    await button(page, 'Brief').waitFor();
  });

  await step('an address that is not part of the site answers the not-found page', async () => {
    // Chromium reports the 404 of the page it was sent to as a console error.
    expected.push(/the server responded with a status of 404/);
    const response = await page.goto(`${site.url}no/such/page`);
    assert.equal(response.status(), 404);
    assert.equal(await page.title(), 'Page not found · 5D Checkers');
    await page.getByText(NOT_FOUND).waitFor();
    for (const scheme of ['dark', 'light']) {
      await page.emulateMedia({ colorScheme: scheme });
      for (const sel of ['.not-found-card h1', '.not-found-card p', '.not-found-button']) {
        const ratio = await contrast(page, sel, '.not-found-card');
        assert.ok(ratio >= 4.5, `${sel} in the ${scheme} scheme: contrast ${ratio.toFixed(2)}, under 4.5`);
      }
    }
    await page.getByRole('link', { name: 'Open 5D Checkers' }).click();
    await page.waitForURL(site.url);
    await button(page, 'Menu').waitFor();
    expected.length = 0;
  });

  await step("the repository's own files, and the configurations, are not part of the site", async () => {
    for (const file of ['README.md', '.git/config', '.git/HEAD', 'deploy/nginx.conf', '_headers', '_redirects', '.htaccess', '.nojekyll', 'metadata.json', 'package.json', 'app.json', '_expo/', 'assets/']) {
      const response = await page.request.get(`${site.url}${file}`);
      assert.equal(response.status(), 404, `${file} answered ${response.status()}`);
      assert.ok((await response.text()).includes(NOT_FOUND), `${file} answered the not-found page`);
    }
    for (const file of ['', 'index.html', 'guard.js', 'site.css', 'favicon.ico', 'robots.txt', '.well-known/security.txt', '404.html']) {
      const response = await page.request.get(`${site.url}${file}`);
      assert.equal(response.status(), 200, `${file || '/'} answered ${response.status()}`);
    }
    // A name under /_expo/static/ that the site does not hold: the not-found page, under the year
    // the path's rule gives it, as Netlify answers (serve.mjs says why; nginx and Apache revalidate).
    const missing = await page.request.get(`${site.url}_expo/static/js/web/index-ffffffffffffffffffffffffffffffff.js`);
    assert.equal(missing.status(), 404);
    assert.equal(missing.headers()['cache-control'], 'public, max-age=31536000, immutable');
  });

  await step('every path the game loaded answers every header _headers gives it, HSTS included', async () => {
    assert.ok(seen.size >= 6, `paths seen: ${[...seen].join(', ')}`);
    for (const sitePath of seen) {
      const response = await page.request.get(`${site.origin}${BASE}${sitePath}`);
      const got = response.headers();
      for (const [name, value] of headersFor(headerRules, sitePath).headers) assert.equal(got[name], value, `${sitePath}: ${name}`);
    }
  });
  await context.close();

  await step('the policy bites: no page can frame the game, and no script writes HTML from a string', async () => {
    // Deliberate violations, so this page is not one `watched` reports on.
    const bare = await browser.newContext();
    const p = await bare.newPage();
    const refusals = [];
    p.on('console', (m) => refusals.push(m.text()));
    await p.setContent(`<iframe src="${site.url}" width="400" height="400"></iframe>`);
    // A refused frame is left on the browser's error page, having loaded nothing of the game.
    const frame = () => p.frames().find((f) => f !== p.mainFrame());
    for (let i = 0; i < 100 && !refusals.some((t) => /frame-ancestors/.test(t)); i += 1) await p.waitForTimeout(100);
    assert.ok(refusals.some((t) => /Refused to frame .* "frame-ancestors 'none'"/.test(t)), `framing refused: ${refusals.join(' | ')}`);
    assert.equal(frame()?.url(), 'chrome-error://chromewebdata/');
    await p.goto(site.url);
    await button(p, 'Skip').waitFor();
    const written = await p.evaluate(() => {
      try {
        document.body.insertAdjacentHTML('beforeend', '<img src=x onerror="window.__xss=1">');
        return 'written';
      } catch (e) {
        return e.name;
      }
    });
    assert.equal(written, 'TypeError', 'Trusted Types refuse a string written as HTML');
    await bare.close();
  });

  await step("on a host that sends no headers, the page's own <meta> holds the game to the policy", async () => {
    // GitHub Pages sends none of _headers. The game must still play under the <meta> alone,
    // and the <meta> must still bite.
    const pages = await serveSite({ root: SITE, base: BASE, headers: false });
    try {
      const bare = await browser.newContext();
      const p = await bare.newPage();
      const reports = [];
      p.on('console', (m) => {
        if (m.type() === 'error' || /Content.Security.Policy|Trusted Type/i.test(m.text())) reports.push(m.text());
      });
      p.on('pageerror', (e) => reports.push(e.message));
      const response = await p.goto(pages.url);
      assert.equal(response.headers()['content-security-policy'], undefined);
      await button(p, 'Skip').click();
      await button(p, 'b3, Red man').click();
      await button(p, 'c4, move here').click();
      await button(p, 'c4, Red man').waitFor();
      assert.deepEqual(reports, [], 'the game plays under the <meta> with nothing refused');
      const written = await p.evaluate(() => {
        try {
          document.body.insertAdjacentHTML('beforeend', '<b>x</b>');
          return 'written';
        } catch (e) {
          return e.name;
        }
      });
      assert.equal(written, 'TypeError', 'the <meta> enforces Trusted Types');
      assert.deepEqual(pages.outside, []);
      await bare.close();
    } finally {
      pages.server.close();
    }
  });

  await step('a bundle that does not load leaves a note, not a blank page', async () => {
    const failed = await browser.newContext();
    const p = await watched(failed, 'no bundle', [/Failed to load resource/]);
    await p.route('**/_expo/static/js/**', (route) => route.abort());
    await p.goto(site.url);
    await p.locator('#boot-failed').waitFor({ state: 'visible' });
    for (const scheme of ['dark', 'light']) {
      await p.emulateMedia({ colorScheme: scheme });
      const ratio = await contrast(p, '#boot-failed', '#boot-failed');
      assert.ok(ratio >= 4.5, `the note in the ${scheme} scheme: contrast ${ratio.toFixed(2)}, under 4.5`);
    }
    await failed.close();
  });

  await step('a bundle that throws while starting leaves the same note', async () => {
    const thrown = await browser.newContext();
    const p = await watched(thrown, 'throwing bundle', [/e2e: the bundle throws while starting/]);
    await p.route('**/_expo/static/js/**', (route) =>
      route.fulfill({
        status: 200,
        // The headers the real bundle is served with, so this one runs under the same policy.
        headers: Object.fromEntries(headersFor(headerRules, new URL(route.request().url()).pathname.slice(BASE.length)).headers),
        contentType: 'text/javascript',
        body: 'throw new Error("e2e: the bundle throws while starting");',
      }),
    );
    await p.goto(site.url);
    await p.locator('#boot-failed').waitFor({ state: 'visible' });
    await thrown.close();
  });

  await step('with JavaScript off, the page says what it needs', async () => {
    const off = await browser.newContext({ javaScriptEnabled: false });
    const p = await watched(off, 'no JavaScript');
    await p.goto(site.url);
    // Playwright's text search skips <noscript>, so the note is read by its own selector.
    const note = p.locator('noscript > .site-note');
    assert.equal(await note.isVisible(), true);
    assert.match(await note.innerText(), /^5D Checkers needs JavaScript\./);
    assert.equal(await p.locator('#boot-failed').isHidden(), true);
    await off.close();
  });

  await step('a phone-sized window plays too', async () => {
    const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const p = await watched(phone, 'phone');
    await p.goto(site.url);
    await button(p, 'Skip').tap();
    await button(p, 'b3, Red man').tap();
    await button(p, 'c4, move here').tap();
    await button(p, 'c4, Red man').waitFor();
    assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'no sideways scroll');
    await phone.close();
  });

  current = 'the whole run';
  assert.deepEqual(site.outside, [], 'requests that reached the server outside the site');
  assert.deepEqual(site.twice, [], 'paths two _headers rules both set a header for');
  assert.deepEqual(problems, [], 'violations, errors and requests outside the site');
  console.log(`e2e: passed, ${site.requests.length} requests, all inside ${BASE}/`);
} catch (error) {
  console.error(`not ok - ${current}`);
  console.error(error);
  if (problems.length) console.error(problems.join('\n'));
  const shots = path.join(os.tmpdir(), 'multidcheckers-e2e');
  fs.mkdirSync(shots, { recursive: true });
  for (const [i, context] of browser.contexts().entries()) {
    for (const [j, p] of context.pages().entries()) await p.screenshot({ path: path.join(shots, `${i}-${j}.png`) }).catch(() => {});
  }
  console.error(`screenshots of the open pages: ${shots}`);
  process.exitCode = 1;
} finally {
  await browser.close();
  site.server.close();
}

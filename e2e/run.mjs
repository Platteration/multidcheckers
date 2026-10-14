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
// The host above runs no API, as GitHub Pages and Netlify run none: the page asks for
// api/config once, is answered 404, and draws no sign-in and no shop. Then the same site is
// served with the sign-in and shop API beside it (server/kit with server/catalogue.js, as
// Cloudflare Pages runs functions/api/[[path]].js), its Google and Stripe the fakes of
// server/fakes.mjs handed to the kit as its `fetch`, and the whole flow is played under the
// site's policy: sign in (Google's authorize page answered by page.route with the redirect back
// to the callback), buy (Checkout's page answered the same way), Stripe's signed webhook, the
// pack drawn as owned, sign out, sign in again, delete the account, and a sign-in that fails.
//
//   npm run test:e2e        builds the site, then runs this
//   node e2e/run.mjs        runs this against the dist-web/ already built
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import catalogue from '../server/catalogue.js';
import { createFakes, envFor, signedDelivery } from '../server/fakes.mjs';
import { createNodeHandler } from '../server/kit/node.js';
import { createMemoryStore } from '../server/kit/store.js';
import { REQUEST_LINE_LIMIT, headersFor, parseHeaders, serveSite } from './serve.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(root, 'package.json'));
const BASE = '/multidcheckers';
const SITE = path.join(root, 'dist-web');
const NOT_FOUND = 'That page isn’t here';
/** What the Vibration row says in a browser: src/ui/SettingsModal.tsx's WEB_VIBRATION_HINT. */
const WEB_VIBRATION_HINT = 'A browser cannot vibrate for the game; the phone app can.';
/** The About card's sentence on a site with no account, and on one with: src/app/accountModel.ts. */
const PRIVACY_OFFLINE = 'Nothing leaves your device. There is no server, no account and no analytics; a game code goes only where you send it.';
const PRIVACY_WITH_ACCOUNT = /^Nothing leaves your device unless you sign in or buy\. Signing in with Google tells this site an account id/;
/** What Extras draws where Buy was while a payment is on its way (WORDS.processing), and the tab's note of it. */
const PROCESSING = 'Payment received — processing';
const PENDING_KEY = 'multidcheckers.purchasePending.v1';
/** The edge of the ✦ Forest board and of the default Walnut one (src/ui/theme.ts), as a computed style writes them. */
const FOREST_BOARD = 'rgb(47, 74, 44)';
const CLASSIC_BOARD = 'rgb(90, 58, 38)';
/**
 * Whether the big board is drawn in that skin: the edge of the frame two levels above its a8
 * square (src/ui/CheckerBoard.tsx). Not any element in that colour: the Look row's swatches carry
 * every skin's squares.
 */
const drawn = (color) => {
  const frame = document.querySelector('[aria-label="a8"], [aria-label^="a8, "]')?.parentElement?.parentElement;
  return !!frame && getComputedStyle(frame).borderTopColor === color;
};
/** The headers server/kit sends on every answer of its own (server/kit/http.js, API_HEADERS). */
const API_HEADERS = {
  'x-content-type-options': 'nosniff',
  'content-security-policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
  'referrer-policy': 'no-referrer',
  'cross-origin-resource-policy': 'same-origin',
};

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

/** The api/config probes a host without the API answered 404, page by page: see `watched`. */
const configProbes = [];

/**
 * Watches a page for everything this suite fails on. `expected` names the console errors and
 * page errors a scenario causes on purpose (the caller may add to it and empty it again);
 * nothing excuses a policy violation or a request outside the site. `on` is the host the page
 * is served by; `leaves`, the outside addresses the page may navigate to, each answered by
 * page.route in the browser and never sent (Google's authorize page and Stripe's Checkout).
 *
 * The one console error excused everywhere is Chromium's line for the page's own api/config
 * when it is a 404, as it is on every host that runs no API: it is counted in configProbes,
 * matched by the address it is reported at, not by its words.
 */
async function watched(context, label, expected = [], { on = site, leaves = [] } = {}) {
  const page = await context.newPage();
  const allowed = (text) => expected.some((re) => re.test(text));
  page.left = [];
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
    if (m.type() === 'error' && m.location().url === `${on.url}api/config` && /the server responded with a status of 404/.test(text)) {
      configProbes.push(label);
      return;
    }
    if (/Content.Security.Policy|Trusted Type/i.test(text) || (m.type() === 'error' && !allowed(text))) problems.push(`${label}: console.${m.type()}: ${text}`);
  });
  page.on('pageerror', (e) => {
    if (!allowed(e.message)) problems.push(`${label}: page error: ${e.message}`);
  });
  page.on('request', (r) => {
    const url = r.url();
    if (url.startsWith(on.url) || url === `${on.origin}${BASE}`) return;
    if (r.isNavigationRequest() && leaves.some((prefix) => url.startsWith(prefix))) page.left.push(url);
    else problems.push(`${label}: request outside the site: ${url}`);
  });
  page.on('response', (r) => {
    const url = new URL(r.url());
    if (!url.pathname.startsWith(`${BASE}/`)) return;
    if (on.hasApi && url.pathname.startsWith(`${BASE}/api/`)) {
      // The API's own answers carry its headers, not _headers', which a host does not apply to
      // a Function (Cloudflare Pages) or a proxied location (nginx). On a host without the API
      // the path is the not-found page's, under _headers like any other.
      const got = r.headers();
      for (const [name, value] of Object.entries(API_HEADERS)) if (got[name] !== value) problems.push(`${label}: ${url.pathname} answered ${name}: ${got[name]}, not ${value}`);
      return;
    }
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
/** Opens a sheet from the menu, once the menu has gone: while it fades, its own Close is a second one. */
const openFromMenu = async (page, item) => {
  await press(page, 'Menu');
  await press(page, item);
  await button(page, item).waitFor({ state: 'detached' });
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

  await step('with no API on the host, the page asked for api/config once and draws no sign-in and no shop', async () => {
    // GitHub Pages and Netlify run nothing: api/config is the not-found page, and the account and
    // the shop do not exist. The About card keeps its sentence, and the Supporter pack is what the
    // phone app shows, every look free.
    await openFromMenu(page, 'Settings');
    await page.getByText(PRIVACY_OFFLINE).waitFor();
    assert.equal(await button(page, 'Sign in with Google').count(), 0);
    await press(page, 'Done');
    await openFromMenu(page, 'Extras');
    await page.getByText('The store is not wired up in this build, so everything is unlocked for everyone.').waitFor();
    assert.equal(await button(page, 'Buy').count(), 0);
    assert.equal(await button(page, 'Sign in to buy').count(), 0);
    await press(page, 'Close');
    const asked = site.requests.filter((p) => p.startsWith(`${BASE}/api/`));
    assert.deepEqual(asked, [`${BASE}/api/config`], 'one question per page load, and nothing after the 404');
    assert.deepEqual(configProbes, ['game']);
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
    for (const file of ['README.md', '.git/config', '.git/HEAD', 'deploy/nginx.conf', '_headers', '_redirects', '.htaccess', '_routes.json', '.nojekyll', 'metadata.json', 'package.json', 'app.json', '_expo/', 'assets/', 'server/catalogue.js', 'functions/api/[[path]].js']) {
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

  await step('with the API beside the site: sign in with Google, buy, the webhook, the pack owned, sign out, delete', async () => {
    // The site as Cloudflare Pages serves it with functions/api/[[path]].js: server/kit with this
    // app's catalogue, answering <base>/api/*, its Google and Stripe the fakes it is handed as
    // its fetch. APP_URL is this host's own address, as on a deployment.
    const fakes = await createFakes();
    let handler = null;
    const shop = await serveSite({ root: SITE, base: BASE, api: (req, res) => handler(req, res) });
    const logs = [];
    handler = createNodeHandler({ catalogue, env: envFor(shop.url), store: createMemoryStore(), fetch: fakes.fetch, log: (level, message) => logs.push(`${level}: ${message}`) });
    assert.deepEqual(handler.features, { signIn: true, shop: true });
    const GOOGLE = 'https://accounts.google.com/o/oauth2/v2/auth?';
    const CHECKOUT = 'https://checkout.stripe.com/c/pay/';
    const visitor = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    // Only Checkout is ever navigated to: the page goes there itself. Google's authorize page is
    // reached by the kit's redirect, which the browser is never let follow (below).
    const p = await watched(visitor, 'account', [], { on: shop, leaves: [CHECKOUT] });
    try {
      // Google's side. Playwright routes a request but not the ones a redirect makes (its
      // route() note: "the handler will only be called for the first url if the response is a
      // redirect"), so the authorize page is answered where the redirect to it is made: the
      // kit's own answer to api/auth/google/start is fetched as it is, the authorize URL in it
      // checked as Google checks it (fakes.consent), and the browser sent on to the callback
      // that Google would send it to, with the kit's sign-in cookie; or, refusing, with Google's
      // `error=access_denied`. A request to accounts.google.com itself is one `watched` fails on.
      const answered = [];
      let refuse = false;
      await p.route(`${shop.url}api/auth/google/start?*`, async (route) => {
        const response = await route.fetch({ maxRedirects: 0 });
        const url = response.headers()['location'] ?? '';
        assert.equal(response.status(), 302);
        assert.ok(url.startsWith(GOOGLE), url);
        answered.push(url);
        let back;
        if (refuse) {
          const asked = new URL(url).searchParams;
          back = new URL(asked.get('redirect_uri'));
          back.searchParams.set('error', 'access_denied');
          back.searchParams.set('state', asked.get('state'));
        } else {
          back = fakes.consent(url, { sub: '1001', email: 'ada@example.com' });
        }
        assert.equal(`${back.origin}${back.pathname}`, `${shop.url}api/auth/google/callback`);
        await route.fulfill({ response, headers: { ...response.headers(), location: back.href } });
      });
      // Stripe's side: Checkout, paid at once, sends the visitor back to success_url.
      const checkouts = [];
      await p.route('https://checkout.stripe.com/**', (route) => {
        const url = route.request().url();
        answered.push(url);
        checkouts.push(url);
        return route.fulfill({ status: 302, headers: { location: `${shop.url}?purchase=success` } });
      });
      const title = (badge) => p.getByText(badge ? '5D Checkers ✦' : '5D Checkers', { exact: true });
      const settings = () => openFromMenu(p, 'Settings');
      const signIn = async () => {
        await settings();
        await press(p, 'Sign in with Google');
        await p.waitForURL(shop.url);
        await button(p, 'Menu').waitFor();
      };

      await p.goto(shop.url);
      await press(p, 'Skip');
      await settings();
      await p.getByText(PRIVACY_WITH_ACCOUNT).waitFor();
      await press(p, 'Done');
      await openFromMenu(p, 'Extras');
      await p.getByText('€2.99', { exact: true }).waitFor();
      await press(p, 'Sign in to buy');
      await p.waitForURL(shop.url);
      await button(p, 'Menu').waitFor();
      await settings();
      await p.getByText('Signed in as ada@example.com').waitFor();
      // The store is on, and nothing is owned: a ✦ look is the Supporter pack's.
      await button(p, '✦ Forest').waitFor();
      await press(p, 'Done');
      await title(false).waitFor();

      await openFromMenu(p, 'Extras');
      const back = p.waitForResponse((r) => r.url() === `${shop.url}?purchase=success`);
      await press(p, 'Buy');
      // Back from Checkout: the address loses its ?purchase=success, and the page asks api/me
      // until the purchase shows. It shows only once Stripe's signed webhook has said so: until
      // then no thank-you, and where Buy was the pack says the payment is on its way, so that a
      // second press cannot start a second Checkout to pay.
      await back;
      await p.waitForFunction(() => location.search === '');
      assert.equal(checkouts.length, 1);
      await openFromMenu(p, 'Extras');
      await p.getByText(PROCESSING, { exact: true }).waitFor();
      assert.equal(await button(p, 'Buy').count(), 0);
      assert.equal(await p.getByText(/Thank you/).count(), 0);
      assert.equal(await p.evaluate((key) => JSON.parse(sessionStorage.getItem(key) ?? 'null')?.at > 0, PENDING_KEY), true);
      await press(p, 'Close');
      const delivery = signedDelivery(fakes.paid(checkouts[0]));
      const hook = await fetch(`${shop.url}api/webhooks/stripe`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'stripe-signature': delivery.signature },
        body: delivery.body,
      });
      assert.equal(hook.status, 200);
      await p.getByText('Thank you — Supporter pack is unlocked.').waitFor({ timeout: 20000 });
      assert.equal(await p.evaluate((key) => sessionStorage.getItem(key), PENDING_KEY), null);
      await title(true).waitFor();
      await press(p, 'Dismiss');
      await openFromMenu(p, 'Extras');
      await p.getByText('Owned', { exact: true }).waitFor();
      assert.equal(await button(p, 'Buy').count(), 0);
      await press(p, 'Close');
      await settings();
      await press(p, 'Forest');
      await p.waitForFunction(drawn, FOREST_BOARD);
      await press(p, 'Sign out');
      await button(p, 'Sign in with Google').waitFor();
      // Signed out, the pack is no longer the visitor's: the board is drawn as the default again,
      // and the choice stays theirs for when it is.
      await p.waitForFunction(drawn, CLASSIC_BOARD);
      assert.equal(await p.evaluate(drawn, FOREST_BOARD), false);
      await button(p, '✦ Forest').waitFor();
      await press(p, 'Done');
      await title(false).waitFor();

      // The purchase is the account's: signing in again brings it back, and the board with it.
      await signIn();
      await title(true).waitFor();
      await p.waitForFunction(drawn, FOREST_BOARD);

      // Deleting the account takes the purchase with it, after asking.
      await settings();
      await press(p, 'Delete account');
      await p.getByText('Delete account?').waitFor();
      await press(p, 'Delete account');
      await button(p, 'Sign in with Google').waitFor();
      await press(p, 'Done');
      await title(false).waitFor();
      await signIn();
      await title(false).waitFor();
      await openFromMenu(p, 'Extras');
      await button(p, 'Buy').waitFor();

      // Paid again, and the page reloaded before the webhook: the tab remembers the payment, so
      // Buy stays away (pressed, the kit would answer 409 payment_pending), until the webhook is in
      // and api/me reports the pack.
      const backAgain = p.waitForResponse((r) => r.url() === `${shop.url}?purchase=success`);
      await press(p, 'Buy');
      await backAgain;
      await p.waitForFunction(() => location.search === '');
      assert.equal(checkouts.length, 2);
      // The tab notes the payment once api/me has said who is signed in, a moment after the
      // address is cleaned: reload only once it has.
      await p.waitForFunction((key) => sessionStorage.getItem(key) !== null, PENDING_KEY);
      await p.reload();
      await button(p, 'Menu').waitFor();
      await openFromMenu(p, 'Extras');
      await p.getByText(PROCESSING, { exact: true }).waitFor();
      assert.equal(await button(p, 'Buy').count(), 0);
      await press(p, 'Close');
      const again = signedDelivery(fakes.paid(checkouts[1]));
      const hookAgain = await fetch(`${shop.url}api/webhooks/stripe`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'stripe-signature': again.signature },
        body: again.body,
      });
      assert.equal(hookAgain.status, 200);
      await p.reload();
      await title(true).waitFor();
      await openFromMenu(p, 'Extras');
      await p.getByText('Owned', { exact: true }).waitFor();
      assert.equal(await p.evaluate((key) => sessionStorage.getItem(key), PENDING_KEY), null);
      await press(p, 'Close');

      // A sign-in Google refuses comes back to the site, which says so once and cleans the address.
      await settings();
      await press(p, 'Sign out');
      await button(p, 'Sign in with Google').waitFor();
      refuse = true;
      await press(p, 'Sign in with Google');
      await p.getByText("Sign-in didn't complete.").waitFor();
      assert.equal(new URL(p.url()).search, '');
      await press(p, 'Dismiss');
      await p.goto(`${shop.url}?purchase=cancelled`);
      await button(p, 'Menu').waitFor();
      await p.waitForFunction(() => location.search === '');
      assert.equal(await p.getByRole('alert').count(), 0);
      // Anyone can open the address Checkout returns to. Signed out, it is taken out of the
      // address and nothing more: no line about a payment, and no api/me asked after the first.
      const before = shop.apiRequests.length;
      await p.goto(`${shop.url}?purchase=success`);
      await button(p, 'Menu').waitFor();
      await p.waitForFunction(() => location.search === '');
      await p.waitForTimeout(4000);
      assert.deepEqual(shop.apiRequests.slice(before), [`GET ${BASE}/api/config`, `GET ${BASE}/api/me`]);
      assert.equal(await p.getByRole('alert').count(), 0);

      // Every page that left the site went to Stripe's Checkout, which the browser answered
      // itself; Google's consent was answered before the browser went there. Nothing reached either.
      assert.deepEqual(p.left, checkouts);
      assert.equal(answered.filter((u) => u.startsWith(GOOGLE)).length, 4);
      assert.equal(answered.length, 6);
      assert.deepEqual(fakes.unexpected, []);
      assert.deepEqual(logs, []);
      assert.deepEqual(shop.outside, []);
      assert.ok(shop.apiRequests.some((r) => r === `POST ${BASE}/api/webhooks/stripe`));
    } finally {
      await visitor.close();
      shop.server.close();
    }
  });

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
    // connect-src 'self': the site's own api/ and nothing else. Were the policy to let it through,
    // the route below stops the request in the browser; the policy's own refusal is what is read.
    await p.route('https://example.com/**', (route) => route.abort());
    const reached = await p.evaluate(async () => {
      try {
        await fetch('https://example.com/collect');
        return 'fetched';
      } catch (e) {
        return e.name;
      }
    });
    assert.equal(reached, 'TypeError');
    assert.ok(
      refusals.some((t) => /Refused to connect to 'https:\/\/example\.com\/collect'.*"connect-src 'self'"/.test(t)),
      `the request refused by connect-src: ${refusals.join(' | ')}`,
    );
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
      // Pages runs no API: api/config is its not-found page, which Chromium reports, and the page
      // draws no sign-in and no shop.
      const probes = [];
      p.on('console', (m) => {
        if (m.type() === 'error' && m.location().url === `${pages.url}api/config` && /status of 404/.test(m.text())) probes.push(m.text());
        else if (m.type() === 'error' || /Content.Security.Policy|Trusted Type/i.test(m.text())) reports.push(m.text());
      });
      p.on('pageerror', (e) => reports.push(e.message));
      const response = await p.goto(pages.url);
      assert.equal(response.headers()['content-security-policy'], undefined);
      await button(p, 'Skip').click();
      await button(p, 'b3, Red man').click();
      await button(p, 'c4, move here').click();
      await button(p, 'c4, Red man').waitFor();
      assert.deepEqual(reports, [], 'the game plays under the <meta> with nothing refused');
      assert.equal(probes.length, 1);
      assert.deepEqual(pages.requests.filter((r) => r.startsWith(`${BASE}/api/`)), [`${BASE}/api/config`]);
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

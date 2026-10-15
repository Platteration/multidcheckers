# 5D Checkers

A parody of *5D Chess with Multiverse Time Travel*, but with a game you can
actually hold in your head: checkers. Many boards, many timelines, and pieces
that can be sent into the past.

Built with [Expo](https://expo.dev) / React Native, so the same code runs on
iOS, Android, and the web. Two players share one phone (pass and play).

## How it plays

- **It's checkers.** Men move diagonally forward one square and jump over
  enemy pieces to capture them. Jumps are mandatory and chain together. Reach
  the far row to be crowned a king, which moves and jumps backwards too. Red
  moves first.
- **Every move is remembered.** Each turn creates a new board. The map at the
  bottom of the screen shows every board that has ever existed, laid out left
  to right through time, one row per timeline.
- **Send a piece into the past.** Tap one of your pieces on a "now" board to
  pick it up. Its legal squares light up, and so do the past boards it can
  travel to: boards where it was also your move and its square was empty. Tap
  a glowing board to send it there.
- **That branches a new timeline.** The past board itself never changes;
  instead history forks. A fresh timeline starts from that moment with your
  extra piece in it, and your opponent has to answer there too.
- **Leaving has a cost.** The piece is gone from the present board. Time
  travel is the one way to dodge a mandatory jump, but if it was your last
  piece there, you lose on that board.
- **Play every waiting board.** On your turn you must make one move on every
  board marked *play*. Only then does the turn pass.
- **Winning.** Wipe your opponent off any single board, or leave them a
  waiting board where they have no legal move and nowhere to travel, and you
  win the whole game.

Why parity matters: you can only travel to boards where it was your move, so
you cannot slip a piece in between your opponent's decisions. What you can do
is stack extra material into an old position, open a second front your
opponent must defend, or pull a doomed piece out of the present.

## What's in the app

- **Two ways to play alone or together.** Pass-and-play on one phone, or
  against a bot at three levels: Novice (wanders, loves a crown), Tricky
  (counts material after your best reply) and Paradox (also travels through
  time). Undo rewinds through the bot's replies.
- **Puzzles.** Six hand-made positions: a capture sweep, a king jumping
  backwards, sealing an old board through time travel so the opponent is
  trapped, a flying-king chain, a two-board turn, and a backward capture.
  Progress is saved.
- **Replay.** Step through any game move by move with a one-line narration.
- **Play by message.** Share a game as a short code, paste it into any chat,
  and the other person loads it, moves, and sends it back. No server.
- **Rule variants.** Flying kings, backward captures for men, and strict
  present, the real 5D Chess rule: only boards at the present must be played,
  boards ahead of it are optional, and you end your turn yourself. All off by
  default, and whichever are on are named under the title: a game that arrives
  as a code brings its own rules, so it cannot change them on you quietly.
  Forty quiet moves each with no capture, crowning or travel is a draw.
- **Themes and looks.** System, dark or light theme; five board skins; four
  piece sets that also rename the sides; colour-blind markings on pieces; a
  reduce-motion setting that follows the device or overrides it. Settings can
  be reset to their defaults without touching games, record or progress.
- **Feel.** Haptics and short synthesized sounds, both switchable. A
  browser cannot vibrate, so there the Vibration row says so instead. Pieces
  pop into place when they land.
- **Your record.** Games played, wins against each bot, time travels made,
  biggest multiverse, longest game, and puzzles solved.
- **A welcome on first launch** that shows the one idea that matters, with a
  real tiny multiverse, and offers the puzzles.
- **Links.** A game code also loads from a link: `#code=` on the web build
  (in the fragment, which a browser never sends to the site's host, so a long
  game still opens and the host never logs it; `?code=` links made before
  still load) and the app's own scheme on a device.
- **Fits the screen.** On a device the app is locked to portrait
  (`orientation` in `app.json`), so the board stacks over the map; the
  side-by-side layout the screen keeps for a window half again wider than it
  is tall (`width > height * 1.15` in GameScreen, so a nearly square window
  still stacks) is what the web build shows in a wide browser window. The map draws a line
  from each branch to the board it split off, and a time travel flies a token
  across it.
- **Saved automatically.** The game in progress, settings, record, and
  puzzle progress survive closing the app.

## Money, and what will never be for sale

The app is built so it can sell one thing: a **Supporter pack** of cosmetics
(the board skins and piece sets marked ✦, plus future puzzle packs). Nothing
that changes the rules, the bots, or the outcome of a game will ever be sold,
and there are no loot boxes.

In the phone apps, until a billing library is wired in, `STORE_ENABLED` in
`src/app/purchases.ts` is false and every extra is unlocked for everyone. To
go live: implement `purchase` and `restore` in that file against your store
SDK, persist the result, and set the flag to true. The Settings sheet and the
Extras sheet already respect the entitlement.

On the website the pack is sold through Stripe Checkout to a visitor signed in
with Google, once the site's own API is configured (see "Sign-in and the shop"
below). Only then does the store turn on there, and then what unlocks the ✦
looks is the purchase the server has on record, which Stripe's signed webhook
alone writes. Without that API (GitHub Pages, any static host) the website is
as the phone apps are: no sign-in, no shop, every extra free. The unlock is a
cosmetic gate in the visitor's own browser, not a secret: anyone who edits the
page can wear a ✦ board without paying. A ✦ look stays chosen in the
visitor's settings whatever happens, but is drawn only while it is owned:
one chosen while everything was free, or whose purchase was refunded,
signed out of or deleted with the account, is drawn as the default board or
pieces until the server reports the pack again, and the pickers offer the
others to a supporter only. Until the site has answered what it sells (its
`api/config`, and `api/me` where sign-in is on) nothing is owned on the web,
so on every load a ✦ look is drawn as its default for the time of that
answer, on a host with no API too. A site with no API, or whose `api/config`
fails or is not the API's answer, is a host with no API for that visit:
every look free.

## Design comparisons

The dated Checkers comparisons and concept artwork are versioned in the shared bundle in the Chess repository:

- [Checkers phone screenshot comparison](https://github.com/Platteration/chesscheatser/blob/4d6a208d90d404f2d6a3b93fcf17ae3707b58f0d/docs/comparisons/comparisons/multidcheckers-phone-light-game.png)
- [Checkers sprite style comparisons](https://github.com/Platteration/chesscheatser/blob/4d6a208d90d404f2d6a3b93fcf17ae3707b58f0d/docs/comparisons/styles/comparisons/checkers-light.png)
- [Complete galleries, PNG sprites and editable Blender projects](https://github.com/Platteration/chesscheatser/tree/4d6a208d90d404f2d6a3b93fcf17ae3707b58f0d/docs/comparisons)
- [Clone, open, edit or export the comparison bundle](https://github.com/Platteration/chesscheatser/blob/4d6a208d90d404f2d6a3b93fcf17ae3707b58f0d/docs/comparisons/GIT.md)

The screenshots record the 11 October 2026 capture commits; the Arcade Pop, Neon Circuit and Porcelain Studio concepts were added on 13 October. These links pin the shared asset revision so they remain reproducible as the apps evolve.

## Running it

```sh
npm install
npm start          # Expo dev server; scan the QR code with Expo Go
npm run ios        # iOS simulator (macOS)
npm run android    # Android emulator or device
npm run web        # in a browser
```

### Native builds

To produce store builds use [EAS Build](https://docs.expo.dev/build/introduction/)
(`npx eas build --platform ios|android`). The bundle identifiers are set in
`app.json`. `eas.json` has development, preview, and production profiles
for EAS Build. The icon family in `assets/` (the icon, the favicon, the
Android adaptive layers and the splash image the `expo-splash-screen` plugin
shows) is Blender relief artwork. Its editable scene is
`assets/artwork/icon.blend`; regenerate it with
`blender -b --python scripts/render-icons.py` (Blender 4.3). Inspect the
adaptive masks and the launch splash on Android and iOS devices before a store
release. `docs/release.md` is the release checklist and `docs/store-listing.md`
the store listing draft.

### Deploy

The web build is also a website: a static one. The game runs entirely in the
visitor's browser, as it does on a phone; the host only serves files, and the
headers and rules that protect them, which this repository writes for it (and,
once the owner configures it, the sign-in and shop API under `api/`: see
"Sign-in and the shop" below).

```sh
npm run build:web                                    # the site, in dist-web/, for a domain of its own
node scripts/build-web.mjs --base /multidcheckers    # the same site, served under /multidcheckers/
```

**Publish that folder, and only it.** `dist-web/` holds `index.html`,
`404.html`, `guard.js`, `site.css`, `favicon.ico`, `robots.txt`,
`.well-known/security.txt`, `_expo/` (the game) and `assets/` (the sounds),
plus the hosts' configurations, which `npx expo export` copies from
`public/`: `_headers` and `_redirects` for Netlify and Cloudflare Pages,
`.htaccess` for Apache, and an empty `.nojekyll` for GitHub Pages; and, in a
build for the root of its domain, `_routes.json` for Cloudflare Pages, which
`build-web.mjs` writes (a `--base` build has none: see "Sign-in and the
shop"). Netlify refuses all five with the not-found page, and Apache and
nginx refuse the lot; Cloudflare Pages serves `.htaccess` and `.nojekyll` as
files (it reads no 404 rules), and GitHub Pages serves every one it is
given. Nothing in them is secret.
(`npm run build:web` leaves `metadata.json`, the exporter's manifest for EAS
Update, out of the site; a plain `npx expo export` does not.)

**Never point a host at the checkout**: `.git/` holds the whole history. In a
checkout, `.htaccess` and `_redirects` sit in `public/`, where no host reads
them, so Apache, Netlify and the rest serve every file in it. Only nginx
still refuses every dotfile but `/.well-known/`, and `README.md`, `deploy/`,
`_headers`, `_redirects`, `_routes.json` and `metadata.json`, because its
rules live in the server's own configuration rather than in the folder.

**nginx**: copy `deploy/nginx.conf` into the server's configuration (it is
included from the `http {}` block) and set `server_name`, `root` and the
certificate paths. It asks for HTTP/2 on the `listen` lines, which nginx
reads from 1.9.5 on, including the 1.24 of Ubuntu 24.04 and the 1.22 of
Debian 12; from 1.25.1, `nginx -t` warns that this spelling is deprecated,
which is harmless.

**Apache** needs two modules that Debian and Ubuntu leave off, and has to be
allowed to read `.htaccess` at all, which they do not allow under
`/var/www`:

```sh
sudo a2enmod rewrite headers
# in the site's <Directory> block (or the virtual host's):
#   AllowOverride FileInfo Options      (or All)
# and in the server's configuration, which .htaccess cannot set:
#   ServerTokens Prod
sudo systemctl reload apache2
```

Without a module, every request answers 500 and the error log names the
directive (`Invalid command 'RewriteEngine'`): the file wraps nothing in
`<IfModule>`, which would serve the folder with none of the rules and say
nothing. Without `AllowOverride`, Apache ignores the file without a word, so
run the launch checklist below. Without `ServerTokens Prod`, every response
names Apache's version and the operating system (and OpenSSL's version, with
mod_ssl).

**Response headers.** The same set is in `public/_headers`,
`public/.htaccess` and `deploy/nginx.conf`, and
`src/app/__tests__/website.test.ts` fails when they disagree; `npm run
test:e2e` also serves the built site from a real nginx and a real Apache
where they are installed (`e2e/hosts.mjs`) and checks what each one sends:

| Header | Value | Why |
| --- | --- | --- |
| `Content-Security-Policy` | `default-src 'none'; script-src 'self'; style-src 'self' 'sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU='; img-src 'self'; media-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; object-src 'none'; frame-ancestors 'none'; upgrade-insecure-requests; require-trusted-types-for 'script'; trusted-types 'none'` | Only the site's own script, stylesheet, favicon and sounds load, measured by playing the game in Chromium under it. The one hash is the empty string's: react-native-web creates an empty `<style>` element and fills it through the CSSOM, which the policy does not govern, so no `'unsafe-inline'` is needed. `connect-src 'self'` is the site's own `api/` (sign-in and the shop, below) and nothing else: with `'none'` the page's `GET api/config` is refused (measured), and a request to any other origin still fails loudly. Google and Stripe are reached by top-level navigations, which no directive governs. Trusted Types are enforced with no policy, because nothing in the game writes HTML from a string. |
| `X-Frame-Options` | `DENY` | With `frame-ancestors 'none'`: no other site can frame the game (clickjacking). |
| `X-Content-Type-Options` | `nosniff` | Files are what their type says. |
| `Referrer-Policy` | `no-referrer` | A game code travels in the address (`#code=`, and `?code=` in links made before), so no address is ever sent on. |
| `Permissions-Policy` | everything off but `autoplay` and `clipboard-write` for this site | The sound effects, and Copy in Play by message. Share… uses `web-share`, which is left at its default (this site only). |
| `Cross-Origin-Opener-Policy`, `Cross-Origin-Resource-Policy` | `same-origin` | No other window keeps a handle on this one, and no other site embeds its files. |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` | Browsers remember to use HTTPS. |
| `Cache-Control` | a year, `immutable`, for `_expo/static/` and `assets/`; `no-cache` for everything else | The game and the sounds carry a hash of their contents in their names; every other file keeps its name from one deploy to the next, so it is revalidated on every load. Netlify applies a path's rule to a 404 there too (it has no rule by status; Cloudflare Pages is taken to do the same), so a name the live deploy does not hold, asked for by a tab left open across a deploy, is a 404 a browser may keep a year; nginx and Apache answer it with `no-cache`. |

**GitHub Pages sends none of these headers.** The built `index.html` and
`404.html` carry the policy (less `frame-ancestors`, which a `<meta>` cannot
set) and the referrer policy as `<meta>` tags, so script, style and network
are held there too; `build-web.mjs` writes the page's from `public/_headers`.
(The template in `public/` does not carry it, because `npm run web` serves
the template too and its development server needs a WebSocket and HTML
written from strings, both of which the policy refuses.) The clickjacking
protection, HSTS, `nosniff`, the permissions, the cross-origin isolation and
the cache rules need a host that sets headers: Netlify, Cloudflare Pages,
Apache or nginx.

**GitHub Pages, from this repository.** `.github/workflows/pages.yml` builds
the site under `/<repository>` (`scripts/build-web.mjs --base`) after
`npm ci`, the type check and the unit tests, and publishes it on a push to
`main` or when run by hand from the Actions tab. This repository has no `main`
branch yet, and the run-by-hand button only appears once the file is on the
default branch, so until one of those is true nothing deploys. The repository's
Pages source has to be set to GitHub Actions once (Settings, Pages), and the
`github-pages` environment has to accept the branch that deploys. Only the
deploy job holds `pages: write` and `id-token: write`; the job that installs
and builds holds a read-only token and does not keep it in `.git/config`.

**One origin per app.** A GitHub Pages project site lives at
`platteration.github.io/multidcheckers/` and shares that origin with every
other app the account publishes there. Browser storage is kept per origin,
and the web build keeps the game in progress, the settings, the record and
the puzzle progress in `localStorage`, so script running on any of those
other apps could read or rewrite them (`src/app/validate.ts` bounds what a
planted record can do; it cannot make one private). Give the site a domain
or subdomain of its own, which gives it an origin of its own; the storage
keys stay prefixed `multidcheckers.` either way. `robots.txt` and
`/.well-known/security.txt` also only count at the root of an origin.

**Not-found page and safety net.** `404.html` answers any address that is
not part of the site, in the game's colours and with no script; Netlify,
Cloudflare Pages and GitHub Pages pick it up by themselves, and the Apache
and nginx configurations wire it in (and turn folder listings off).
`build-web.mjs --base` moves its addresses under the sub-path. `guard.js`
loads before the game: if the game's script fails to load, or throws before
it has drawn anything, the page says so instead of staying blank, and a
visitor with JavaScript off reads why the page is empty.

**Launch checklist**, with `SITE` the site's https address:

```sh
curl -sI http://SITE/ | head -1                      # a 301 to https
curl -sI https://SITE/ | grep -i -E 'content-security|frame-options|strict-transport|nosniff|referrer|permissions|cross-origin|cache-control'
                                                     # all nine; none means Apache is not reading .htaccess
curl -sI https://SITE/ | grep -i '^server:'           # no version number
curl -sI https://SITE/.git/HEAD | head -1             # 404
curl -sI https://SITE/README.md | head -1             # 404
curl -s  https://SITE/_expo/ | grep -c 'isn’t here'   # 1: the not-found page, not a listing
curl -sI https://SITE/no-such-page | head -1          # 404
```

Then play a game, open every sheet, share a code and load it from its link,
and check that the browser console shows no `Content Security Policy`
lines. The `Expires` date in `security.txt` is 8 October 2027 and needs
renewing before then (`website.test.ts` fails once it has passed). On GitHub
Pages, a deploy from a branch runs Jekyll over the folder unless it holds a
`.nojekyll`, and Jekyll leaves out every path that starts with `_` or `.`,
`_expo/` (the whole game) among them: the site carries one, so keep it when
copying the folder to the branch. The Pages upload action leaves out every
path that starts with a dot unless told otherwise (from its v4), so
`pages.yml` sets `include-hidden-files: true`; check after a deploy that
`/.well-known/security.txt` is served.

### Sign-in and the shop

The website can sign visitors in with Google and sell them the Supporter pack
through Stripe Checkout. It is built and tested, and **off until the owner
gives it keys**: with none set, and on any host that runs no code (GitHub
Pages, Netlify, Apache or nginx without the API below), the site looks and
plays exactly as it does without it. The phone apps never have it.

- **The backend** is `server/kit/`, a small API shared byte for byte by the
  owner's apps (never edited here; `server/kit/README.md` is its setup guide
  and the owner's checklist), with this app's catalogue,
  `server/catalogue.js`: one product, `supporter` (one-time, granting the
  entitlement `supporter`), whose Stripe Price id is `STRIPE_PRICE_SUPPORTER`.
  It answers under the site's own `api/`, so the session is a first-party
  cookie and the page's policy only gains `connect-src 'self'`. A purchase is
  granted by Stripe's signed webhook and nothing else.
- **The page**, on load, asks `api/config` once. A 404 (or anything that is
  not the API's answer) means the feature does not exist: nothing is drawn,
  stored or asked again. On a host without the API that one request is the
  only change, and Chromium notes its 404 in the console. Configured,
  Settings gets an Account section ("Sign in with Google"; signed in, "Signed
  in as …", Sign out, and Delete account, which asks first and says the
  purchase goes with the account), Extras sells the pack at its price ("Buy",
  "Sign in to buy" when signed out, "Owned"), and the screen says when a
  sign-in did not complete or a purchase has been unlocked. A line about a
  payment is said only to a visitor `api/me` reports signed in, and every
  line goes when they sign out or delete the account. Back from Checkout
  before Stripe's webhook has reached the site, Extras says "Payment received
  — processing" where Buy was until `api/me` reports the pack, and across a
  reload within ten minutes through one sessionStorage record of the tab's
  own (`multidcheckers.purchasePending.v1`). The API itself gives a second
  Buy before the webhook the Checkout it gave the first while that is still
  open, and once it is paid refuses it (409 `payment_pending`, which the page
  reads the same way), so another tab, or a reload after ten minutes, still
  shows Buy until the webhook arrives, and pressing it there says the payment
  is on its way rather than starting a second one. Two devices signed in at
  once can still each start one (`server/kit/README.md`, "Limits worth
  knowing"). The About card's
  sentence about what leaves the device says what does then. The code is
  `src/app/accountClient.web.ts` (the one module of the app that makes a
  request, bundled into the web build alone), `accountModel.ts`,
  `account.tsx`, and the native twin `accountClient.ts`, which answers "not
  configured" and opens nothing.
- **Cloudflare Pages** (the reference host): the build command is
  `npm run build:web`, its output `dist-web`, and the project root this
  repository, where Pages finds `functions/api/[[path]].js`, the API's entry.
  The build writes `_routes.json`, so only `/api/*` runs the function. Bind
  a KV namespace as `KIT_STORE` and set the variables below, encrypted.
  Cloudflare applies neither `_headers` nor `_redirects` to a function's
  answer (its documentation, `pages/configuration/headers.mdx` and
  `redirects.mdx`), so the API sends its own headers, and the site's 404 rule
  cannot swallow `api/`; Wrangler uploads none of `_headers`, `_redirects`
  and `_routes.json` as a file. Serve the site at the root of its own domain,
  where Pages serves a project and where the entry answers `/api/*`. Pages
  runs a Function by its file's path, so a sub-path build's `api/` would need
  the entry at `functions/<path>/api/[[path]].js`: without that file a
  `--base` build writes no `_routes.json` at all (it says so as it ends),
  rather than one that sends `/<path>/api/*` to a Function that is not there.
- **Self-hosted**: `KIT_DATA_DIR=/var/lib/multidcheckers-api node server/start.mjs`
  under a service manager, as its own user, one process per data directory
  (outside the web root). It listens on 127.0.0.1:8788, and
  `deploy/nginx.conf`'s `location ^~ /api/` sends it the site's `api/`;
  stopped, that location answers 502 (504 when it does not answer in time)
  with the site's not-found page and every header the site sends, and the
  page draws nothing; `/api` itself is the not-found page too
  (`location = /api`), where nginx would answer its own 301. A site that
  runs no API can delete both locations. Apache's `.htaccess` cannot proxy:
  in the virtual host, with `mod_proxy` and `mod_proxy_http`,

  ```apache
  ProxyPass "/api/" "http://127.0.0.1:8788/api/"
  ErrorDocument 502 /404.html
  ErrorDocument 503 /404.html
  ErrorDocument 504 /404.html
  ```

  Without the `ErrorDocument` lines an API that is not running is Apache's
  own 503 page with none of the site's headers; with them it is the site's
  not-found page, status kept (`e2e/hosts.mjs` runs both servers so, on
  nginx 1.24 and Apache 2.4.58). The API's own answers pass through either
  way.
- **The variables**, environment only, never in the repository:
  `APP_URL` (the site's address with its trailing slash), `SESSION_SECRET`,
  `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `STRIPE_SECRET_KEY`,
  `STRIPE_WEBHOOK_SECRET` and `STRIPE_PRICE_SUPPORTER`. Sign-in needs the
  first four; the shop needs all seven.
- **What leaves the device**, then: nothing unless the visitor signs in or
  buys. Signing in, Google tells the site an account id and the email
  address; a purchase is paid to Stripe, which handles the payment and is
  told the account id with it (as the Checkout session's reference and in
  the payment's metadata), but not the email address. The site keeps the
  account id, what was bought and Stripe's customer id, and the email
  address only while the visitor stays signed in. Delete account removes
  all of it but the payment, which stays with Stripe under that account id,
  and a count of the hour's Buy presses, which names the account id and goes
  within two hours.
- **One origin per app.** Every page on the site's origin can act as the
  signed-in visitor through `api/` (the kit's README, "Hosting"), so the API
  belongs on an origin of the game's own, never on a shared one such as a
  GitHub Pages project site, which runs no API anyway.

`npm test` runs the kit's own self-test and `server/api.test.mjs` (this
catalogue through both entries, the Node one over a real socket with a fake
Google and a fake Stripe handed to the kit as its `fetch`); the browser suite
plays the whole flow in Chromium under the site's policy.

## Development

```sh
npm test                  # the API's tests (node --test: server/kit's self-test, server/api.test.mjs), then
                          # the unit tests (jest-expo): the engine, the app, the website's hosting files
npm run lint              # eslint .
npm run typecheck         # tsc --noEmit
npm run test:conventions  # the shared repository conventions (CONVENTIONS.md)
npm run check             # all of the above: the gate before a push
npm run test:e2e          # the website: built for /multidcheckers/ and played in Chromium
npm run test:all          # npm test, then the browser suite
```

`npm run test:e2e` builds the site and serves it under `/multidcheckers/`
with exactly the headers `public/_headers` writes and the 404s
`public/_redirects` writes (`e2e/serve.mjs`), then plays the game in Chromium
(`e2e/run.mjs`): the welcome, a move for each side, a time travel, an undo, a
capture, the sounds, Play by message and the link it makes, the settings, a
reload, a game against the bot, the replay, the other sheets and a puzzle,
the not-found page, the repository's own files, and the safety net. Then it
serves the same site with the sign-in and shop API beside it, as Cloudflare
Pages runs it, and plays the whole flow: sign in with Google, buy, Stripe's
signed webhook, the pack drawn as owned, sign out, delete the account, and a
sign-in Google refuses. Google's consent page and Stripe's Checkout are
answered in the browser (`page.route`), and Google and Stripe themselves are
the fakes the kit is handed. It fails on any policy violation, page error,
console error (but the 404 for `api/config` where no API runs) or request
outside the sub-path. Share… is driven both ways on every system (Chromium has a share
sheet on macOS and Windows and none on Linux, so the suite takes it away for
the clipboard fallback and hands the page one of its own for the link), and
the link it makes is followed in the tab already showing the game and, for a
90-action game (`e2e/long-game.txt`), longer than a host takes in a request
line, in a fresh one. Playwright is a devDependency; its Chromium comes from
`npx playwright install chromium`.

Then `e2e/hosts.mjs` copies the built site with a checkout's files planted
in it, loads `deploy/nginx.conf` into the installed nginx and the site's
`.htaccess` into the installed Apache (with the modules, `AllowOverride` and
`ServerTokens` the Deploy section asks for), and checks every path's
headers, the refusals, the redirect and the `Server` header, and that an
Apache without `mod_rewrite` and `mod_headers` refuses the site rather than
serving it bare. nginx's `location ^~ /api/` is run too: a 502 with the
site's not-found page and every header while the API is down (and `/api` that
page with a 404), then `server/start.mjs` behind it (with the fake Google and
Stripe), whose answers must leave with the API's own headers and the server
block's HSTS alone, never a file from the folder; on Apache, which `.htaccess`
cannot make proxy, `api/` is the not-found page, and an Apache given the
virtual host's lines above (read out of this README) answers a 503 with the
not-found page and every header while the API is down, and the API's own
answers once it runs. It needs nginx, Apache as Debian and Ubuntu install it and
openssl, which GitHub's Ubuntu runner has; elsewhere it says it skipped,
and with `CI` set it fails instead.

`e2e/ui-regression.py` is a separate check against the development server
(`npm run web`), where React Native raises the layout assertions a production
build leaves out: a move on a desktop-wide window, a reload that keeps it, a
phone, landscape and desktop resize, and an undo, failing on any page error.
It needs Python's Playwright (`pip install playwright`) and a Chromium, named by
`PW_CHROMIUM` (it defaults to `/usr/bin/chromium`); CI does not run it:
`python e2e/ui-regression.py http://localhost:8081`.

`.github/workflows/ci.yml` runs the lint, the typecheck, the tests, the
conventions test, an Android and web export and the browser suite on every
push; a separate job runs `node .github/audit/npm-audit.mjs` against the
lockfile: the shared audit gate (CONVENTIONS.md, "CI"), which runs
`npm audit --omit=dev` and fails on every high or critical advisory, less what
`.github/audit/accepted.json` accepts. That list accepts two today, braces and
node-forge, which reach the production tree only through Metro's, Expo's and
Jest's file maps and `@expo/cli`'s code signing, none of it in the app or the
website, and have no patched release to take. Each acceptance names a route
from every direct dependency that reaches the package and expires within 90
days, so it is read again at least once a quarter, and sooner when a fixed
release appears in the major an installed copy is on, or the lockfile brings
the package in through a direct dependency the list has no route from.

## Project layout

```
App.tsx                    entry: safe area + status bar + error boundary + GameScreen
src/engine/types.ts        players, board references, turn parity
src/engine/board.ts        one checkers board: moves, jump chains, kings
src/engine/multiverse.ts   timelines, pending boards, time travel, rules, win/draw
src/engine/bot.ts          the three-level computer opponent
src/engine/__tests__/      unit tests for the rules, bots, puzzles, game codes,
                           the autosave and links
src/app/__tests__/         the app config, the settings contract, the validator,
                           the game read back out of storage and the website's
                           account client
src/puzzles/index.ts       the puzzle set (each verified by a test)
src/app/settings.tsx       persisted settings (theme, motion, skin, sound, variants)
src/motion.ts              the reduce-motion hook (device preference or override)
src/app/theme.tsx          resolves settings into the palette screens draw with,
                           a ✦ look only while it is owned (drawnLook)
src/app/persist.ts         every storage key, the key migration, AsyncStorage helpers
src/app/validate.ts        what a stored record may contain; every read goes through it
src/app/share.ts           game codes for play by message (app/base64.ts)
src/app/setup.ts           how a game is set up, and the autosave format
src/app/purchases.ts       the store seam on a phone; app/entitlements.tsx gates premium looks
src/app/account*.ts(x)     the website's sign-in and shop: accountClient.web.ts (the
                           requests to api/, web build only), accountClient.ts (its
                           inert native twin), accountModel.ts (what the page reads
                           and says), account.tsx (the state the screens draw)
src/app/feedback.ts        haptics and sounds (app/sound.ts)
src/ui/useGame.ts          game controller hook: history/undo, selection, bot turns
src/ui/guards.ts           the screen's pure guards: travel origin, link confirmation, square labels
src/ui/GameScreen.tsx      screen layout, status text, bot loop, replay
src/ui/CheckerBoard.tsx    the big tappable board with the landing animation
src/ui/MiniBoard.tsx       board thumbnails for the map
src/ui/MultiverseMap.tsx   the timeline map (rows = timelines, columns = turns)
src/ui/*Modal.tsx          menu, rules, settings, new game, puzzles, share, extras
src/ui/AccountNotice.tsx   the website's line about a sign-in or a purchase
src/ui/ErrorBoundary.tsx   the fallback for a render that throws; its button clears the saved game
src/ui/__tests__/          contrast checks on the header text (drawn straight on
                           the background) and the player labels, the map's
                           windowing and labels, the error boundary, the
                           launch link, the board, the share sheet, the
                           guards and the account and shop screens
public/                    the website around the game, which the web export
                           copies beside it: the page template (index.html),
                           the safety net (guard.js), site.css, 404.html,
                           robots.txt, .well-known/security.txt, and _headers,
                           _redirects, .htaccess and .nojekyll for the hosts
deploy/nginx.conf          the same headers and rules for nginx, and the API's proxy
server/kit/                the sign-in, shop and webhook API, shared byte for byte
                           (its README is the setup guide); never edited here
server/catalogue.js        what this site sells: the Supporter pack
server/start.mjs           the API on a host of its own (127.0.0.1:8788)
server/api.test.mjs        the catalogue and both entries, against server/fakes.mjs
functions/api/[[path]].js  the API's entry on Cloudflare Pages
app.config.js              the web build's sub-path, when WEB_BASE_URL asks for one
scripts/build-web.mjs      builds the site into dist-web/ (npm run build:web)
src/app/__tests__/website.test.ts
                           the headers, the policy and the refused paths, read
                           out of every file that writes them
e2e/serve.mjs, e2e/run.mjs the browser suite's host (Netlify's reading of
                           _headers and _redirects, under a sub-path, with the
                           API beside it when asked) and the game played under it
e2e/hosts.mjs              the built site on a real nginx and a real Apache, and
                           each one's proxy to the API, running and stopped
e2e/ui-regression.py       the development-server check above (Python)
.github/workflows/         ci.yml (the gate and the audit) and pages.yml (the
                           GitHub Pages deploy)
.github/audit/             the shared audit gate the audit job runs, and the
                           advisories it accepts (accepted.json)
assets/artwork/icon.blend  the icons' Blender scene; scripts/render-icons.py
                           renders assets/ from it
docs/                      the release checklist and the store listing draft
```

The engine is pure TypeScript with no React dependency, so the rules can be
tested (and reused, e.g. for an AI opponent or online play) without the UI.
It shares its multiverse design with the sibling project
[multidconnect4](https://github.com/Platteration/multidconnect4).

# multidcheckers

Read AGENTS.md first. It holds the working rules every coding agent follows in this repository; this file adds the notes specific to this project.

Expo (React Native + TypeScript) app: a 5D-chess-style multiverse time travel
parody built on checkers. See README.md for the rules and layout.

- Engine lives in `src/engine` and must stay free of React/React Native imports.
- Boards are immutable; every rule function returns a new value.
- `npm test` runs the API's tests with `node --test` (`server/kit/selftest.mjs` and
  `server/api.test.mjs`), then the jest-expo unit tests; `npm run typecheck` runs tsc. Jest stays on 29
  with the jest-expo preset: most suites render React Native screens or mock modules, and
  Vitest in Node (the default branch's runner from October) loaded 11 of the 26 (measured).
- Exact versioned Expo docs: https://docs.expo.dev/versions/v57.0.0/

## Native configuration

`app.json` states every native-config key `src/app/__tests__/appConfig.test.ts` pins,
even at its default, so the file and the test say the same thing: the splash screen is
configured through the `expo-splash-screen` plugin props (SDK 57 dropped the top-level
`splash` block and the plugin no-ops without props), `expo-system-ui` is installed
because `userInterfaceStyle` does nothing on Android without it, and
`newArchEnabled`/`android.edgeToEdgeEnabled` are absent because SDK 57 no longer reads
them. The app has no network code (`Share.share`, the clipboard and `Linking` need no
socket): the one module that makes a request is the website's account client,
`src/app/accountClient.web.ts`, which Metro bundles into the web build alone, and a native
build resolves its twin `accountClient.ts`, which answers "not configured" and opens
nothing (`appConfig.test.ts` exempts exactly that `.web` file from its scan, holds it to the
site's own `api/` and Checkout's address, and pins the twin as the inert one jest-expo
resolves, as Metro does for a phone). So `android.blockedPermissions` takes INTERNET, the
legacy storage pair, the media-read set and the template's SYSTEM_ALERT_WINDOW back out of the
shipped build;
`plugins/withDebugInternet.js` adds INTERNET to
`android/app/src/debug/AndroidManifest.xml` alone at prebuild so a dev client can still
fetch its bundle; it is drawdraw's file, verbatim but for the one sentence that described
drawdraw's own subject matter. `allowBackup` is an explicit `true`: the store is the player's own six
records and nothing else — the settings, the game in progress, the record, puzzle progress,
the entitlements and the save that could not be read (`KEYS` in `src/app/persist.ts`) —
so a restore brings back a half-played game rather than anything worth protecting. The
entitlement record travels with them, which costs nothing while `STORE_ENABLED` is false
and every cosmetic is free; wiring a store up means deciding whether a restored (or
adb-planted) `multidcheckers.entitlements.v1` may unlock the Supporter pack, and if not,
this is where the backup rules that exclude it go (tvsham writes its own for that reason). The test runs `expo config --type introspect` (the merged manifest, not
app.json) and scans every AndroidManifest.xml under node_modules, so a module someone
adds tomorrow that declares a permission fails it until the permission is either used or
blocked. `tsconfig.json` lists `node` in `types` for that test; `@types/node` is a
declared devDependency for the same reason, pinned to the Node major CI runs (^22).
Install expo packages with `npm install <pkg>@<pin from
node_modules/expo/bundledNativeModules.json>`; `npx expo install` needs Expo's API.
`appConfig.test.ts` holds `expo-system-ui` and `expo-splash-screen` to those pins, so a move
of `expo` itself moves them. `package.json`'s `overrides` take two transitive packages past
advisories their parents' ranges cannot reach: `js-yaml` 4.3.2 under
`@istanbuljs/load-nyc-config` (babel-jest's coverage loader, whose js-yaml 3 pulls in
`sprintf-js`) and `uuid` 11.1.1 under `xcode` (from `@expo/config-plugins`);
`docs/release.md` says when each can go. Under uuid 11, `appConfig.test.ts` runs in Node's
test environment with `node` added to the export conditions, as the plugins it drives run in
Node: React Native's offers only `require` and `react-native`, which give uuid's ES-module
browser build.

## Settings

Every stored record has one key, named in `KEYS` in `src/app/persist.ts`:
`multidcheckers.{settings,game,stats,progress,entitlements}.v1`, plus
`multidcheckers.setaside.v1` — the last saved game this build could not replay, moved
there by `setAsideGame` so that it is attempted once rather than at every launch, kept
rather than deleted (the fault may be ours), and never read back by the app; the screen
says so where the hint is (`UNREADABLE_SAVE_NOTE`). The bare keys earlier
builds wrote (`settings.v1` and the rest, which the set-aside record predates nothing of)
migrate on first launch — new key wins when
both are present, bytes are copied verbatim, the old key is deleted only after the write
succeeded and never on the web, where AsyncStorage is localStorage keyed by an origin
the sibling game shares — and `loadJson` awaits the migration, so no provider can read
ahead of it. Every read goes through `src/app/validate.ts` (`cleanSettings`,
`cleanVariants`, `cleanStats`, `cleanProgress`, `cleanEntitlements`): tables typed
`Record<Union, true>`, own-property lookups only, a per-field fallback from the defaults
passed in, and no React Native import so a plain test can load it. The settings record
holds `haptics`, `sound`, `patterns`, `theme` (`system|dark|light`; a null platform scheme
resolves to dark), `reduceMotion` (`system|on|off`, resolved by `useReduceMotion` in
`src/motion.ts`: a rejected native query or a web page without `matchMedia` means no
preference), `skin`, `pieces`, `variants` (one boolean per rule the engine knows) and
`welcomed`, the onboarding flag. Reset to defaults is confirmed before it spends anything,
rewrites the settings record alone and keeps `welcomed`; the question is asked *inside* the
settings `<Modal>` (a `ConfirmPanel` swapped in for the sheet, the way `MenuModal` asks its
own), because on iOS a view controller already presenting a modal refuses to present a
second one and the sibling `<ConfirmModal>` that used to ask it simply never appeared —
Reset did nothing at all on that platform. The error boundary follows chesscheatser's
rule for the same shape of question: `Try again` first and free, `Start a new game` behind
a confirmation, and it is mounted above the providers as well as below them. The About card's version is
`Constants.expoConfig.version` from `expo-constants`, which is app.json's, and its source
link is the one URL in the tree: `Linking` hands it to the browser, so INTERNET stays
blocked, and `appConfig.test.ts` pins that URL by file and value so the no-network scan
stays a guard. That scan names the socket primitives (`fetch(`, `XMLHttpRequest`,
`WebSocket`, `EventSource`, `sendBeacon`, `new Request(`), the transfer calls of a module
that is already installed (expo-file-system's `downloadAsync`/`uploadAsync`) and the module
specifiers that exist only to open a socket, and a second test keeps those packages out of
`package.json`; what it cannot see is a call assembled at runtime
(`globalThis['fet'+'ch']`), which is what the INTERNET block itself is for. The keys, the
record's fields and every enum table are pinned as literals in
`src/app/__tests__/settings-contract.test.ts`, and the sheet's own rows, its Reset
confirmation and the one-Modal rule in `src/ui/__tests__/settingsSheet.test.ts`; `validate.test.ts` walks
`Object.getOwnPropertyNames(Object.prototype)` through every table via `JSON.parse` and
must fail if `has` is ever changed to `in`.

## Website

The web build is also a website, built by `scripts/build-web.mjs` (`npm run build:web`) into
`dist-web/`, which is the whole site and the only thing to publish. The game does not move to a
server: the host serves files and the headers around them (and, once the owner configures it,
the sign-in and shop API under `api/`, below). Everything around the bundle lives in
`public/`, which `npx expo export` copies to the site root on SDK 57, `.well-known/` included
(checked on a real export): `index.html` is the page template the exporter reads in place of its
own (the referrer `<meta>`, the `<noscript>` note, the `#boot-failed` note and `guard.js` before
the bundle; not the policy, because `expo start --web` serves the template too and the
development server needs a WebSocket and `innerHTML`, so `build-web.mjs` writes the policy
`<meta>` into the built page from `_headers`), `guard.js` the safety net, `site.css` the reset Expo's template
carried inline plus the notes and the not-found page, `404.html`, `robots.txt`,
`.well-known/security.txt` (renewed yearly: the test fails once `Expires` has passed), the
hosts' `_headers`, `_redirects` and `.htaccess`, and an empty `.nojekyll` (a GitHub Pages branch
deploy otherwise runs Jekyll, which drops `_expo/`, the whole game); nginx's copy is
`deploy/nginx.conf`. `build-web.mjs` writes Cloudflare Pages' `_routes.json` itself
(`<base>/api/*`), and the three other hosts' configurations refuse it. The headers are written in all three and the policy in both built pages'
`<meta>` too (less `frame-ancestors`), and `src/app/__tests__/website.test.ts` reads every copy
and requires them equal, path by path, including the cache rules and the paths each host refuses;
change one and change them all. It reads `.htaccess` and `nginx.conf` whole, and a line it does
not know fails it: reading only the parts it compared let a condition after a header's value, a
`RewriteEngine Off`, a RewriteCond in front of a refusal and headers moved into nginx's port-80
server all pass. `e2e/hosts.mjs` (the last part of `npm run test:e2e`) then runs both files in a
real nginx and a real Apache against the built site, which is what catches `http2 on;` (unknown
to the nginx 1.24 Ubuntu 24.04 ships: `listen … http2` instead) and `<IfModule>` wrappers (on a
stock Apache, with the modules off, they served `.git/` with no headers and logged nothing;
unwrapped, a missing module is a 500 and a log line); it skips where the servers are missing
unless `CI` is set. The
policy was measured by playing the game in Chromium under it, not copied: `style-src` carries
the hash of the empty string and no `'unsafe-inline'`, because react-native-web creates an empty
`<style>` and fills it through `insertRule`; `img-src 'self'` is the favicon (only the full
Chromium fetches it, which is why the suite launches `channel: 'chromium'`), `media-src 'self'`
the sounds, `connect-src 'self'` the site's own `api/` (sign-in and the shop, below; with
`'none'` the page's `GET api/config` is refused, measured), and Trusted Types are enforced.
`npm run test:e2e` builds the site for `/multidcheckers/` (`app.config.js` reads `WEB_BASE_URL`
into `experiments.baseUrl`; `build-web.mjs` also prefixes `404.html` and `.htaccess`) and
`e2e/run.mjs` plays it under `e2e/serve.mjs`, which answers as Netlify reads `_headers` and
`_redirects`; it fails on any violation, page or console error, or request outside the sub-path.
Share… links write the code in the fragment (`webLinkFor`, `#code=`): in the query a game past
about eighty actions outgrew the 8 KB request line Apache and nginx take (414) and put the game in
the host's log. `?code=` still loads. A fragment link to the page already open loads nothing
again and raises no `url` event on react-native-web, so `GameScreen` also listens for
`hashchange` (`onWebHashChange`). The browser suite takes Chromium's `navigator.share` away
(macOS and Windows have it, Linux does not) and hands the page its own, so it runs the same
everywhere.
`build-web.mjs` refuses an `--out` inside the checkout other than `dist-web`, `dist` or
`web-build`, and one that holds the checkout, because the exporter empties its output folder
first; its tests run it against a stand-in exporter in a temporary folder for that reason.
`.github/workflows/pages.yml` builds with `--base /<repository>` after `npm ci`, the type check
and the unit tests, and deploys on a push to `main` (which does not exist yet) or by hand; its
shape is the conventions test's. On
the web the Vibration row is shown off, disabled and says why (`WEB_VIBRATION_HINT`), since
`feedback.ts` never vibrates there. In a window wider than it is tall the left column is a
`ScrollView`, whose own style must not lay out children (`justifyContent`, `alignItems`): both
React Native and react-native-web throw on it in development.

## Sign-in and the shop (website)

The website signs visitors in with Google and sells the Supporter pack through Stripe Checkout,
through the shared kit at `server/kit/` (the charter's location, the same bytes in every app
that carries it: never edit this copy; what it should do differently is a request against the
canonical one). It mirrors multidconnect4's, file for file: `server/kit/`, `server/fakes.mjs`,
`server/package.json`, `functions/api/[[path]].js`, `accountClient.ts`, `accountModel.ts`,
`account.tsx`, `AccountNotice.tsx`, `entitlements.tsx`, `purchases.ts`, `ExtrasModal.tsx` and
`src/ui/__tests__/account.test.ts` are the twin's bytes; the rest differ by the app's name, or
where the two repositories already differed. `server/catalogue.js` is this app's catalogue (one
product, `supporter`, one-time, granting `supporter`; price `STRIPE_PRICE_SUPPORTER`),
`functions/api/[[path]].js` the kit's three-line Cloudflare Pages entry, `server/start.mjs` the
Node one behind `deploy/nginx.conf`'s `location ^~ /api/` (the one location with an
`add_header`, the server block's HSTS line, which `website.test.ts` holds), and
`server/package.json` only `{"type":"module"}`, so Node reads those files as ES modules without
a warning. The kit lints and type-checks under this repository's own configuration unchanged
(its `// @ts-check` files are in tsc's program through `allowJs`), and `npm test` runs its
self-test and `server/api.test.mjs`, which drives the catalogue through both entries with
`server/fakes.mjs`'s Google and Stripe handed to the kit as its `fetch`; nothing points the kit
at another host. Everything is off until the owner sets the variables (README, "Sign-in and
the shop"; `server/kit/README.md` has the checklist): with none, and on every static host,
`api/config` is a 404 or says nothing is on, and the page draws nothing and asks nothing more.
On the client, `src/app/accountModel.ts` reads `api/config` and `api/me` field by field and
holds the words (the charter's, the same in every app) and the two privacy sentences the About
card picks between; `accountClient.web.ts` is the only code that makes a request (relative to
the page, so a sub-path site asks its own `api/`) and navigates only to `api/auth/google/start`
and to an address that starts `https://checkout.stripe.com/`; `account.tsx` is the state the
screens draw (`AccountNotice`, the Account section of `SettingsModal`, the shop in
`ExtrasModal`, Delete account confirmed inside the sheet's own Modal like Reset, for the iOS
reason above). On the web the store is on exactly when `api/config` sells the pack, and then
`EntitlementsProvider` reads what is owned from `api/me` alone, never from
`multidcheckers.entitlements.v1`; the phone apps keep `STORE_ENABLED = false` and their own
store seam. The browser suite plays the whole flow under the site's policy (`e2e/serve.mjs`
runs the kit for `<base>/api/*` as Cloudflare does); Playwright does not route a request a
redirect makes, so Google's consent is answered where the kit's redirect to it is made, from
the kit's own answer, and a request that reaches accounts.google.com fails the suite.
`e2e/hosts.mjs` runs nginx's `/api/` location in the real nginx: a 502 while the API is down,
then `server/start.mjs` behind it, its answers with the API's headers and HSTS alone, and a
file planted at `api/` in the folder never served.

## Conventions

This repository follows `CONVENTIONS.md`, which is identical in every platteration
repository and pinned by the conventions test (`npm run test:conventions`, or
`tests/test_conventions.py` in a Python repository): the script set (`test`,
`typecheck`, `lint`, `check`, `test:e2e`, `test:all`), Node 22 via `.nvmrc`, one
`.editorconfig`, ESLint per stack, the `ci.yml` shape, the documents every repository
carries and the README skeleton. The repository's check command (`npm run check`, or
`ruff check .` then `pytest -q` in a Python repository) is the gate before a push. To
change a convention, change it in every repository in one pass and update the hashes in
the test.

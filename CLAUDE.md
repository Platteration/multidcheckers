# multidcheckers

Expo (React Native + TypeScript) app: a 5D-chess-style multiverse time travel
parody built on checkers. See README.md for the rules and layout.

- Engine lives in `src/engine` and must stay free of React/React Native imports.
- Boards are immutable; every rule function returns a new value.
- `npm test` runs the jest-expo unit tests, `npm run typecheck` runs tsc.
- Exact versioned Expo docs: https://docs.expo.dev/versions/v57.0.0/

## Native configuration

`app.json` states every native-config key `src/app/__tests__/appConfig.test.ts` pins,
even at its default, so the file and the test say the same thing: the splash screen is
configured through the `expo-splash-screen` plugin props (SDK 57 dropped the top-level
`splash` block and the plugin no-ops without props), `expo-system-ui` is installed
because `userInterfaceStyle` does nothing on Android without it, and
`newArchEnabled`/`android.edgeToEdgeEnabled` are absent because SDK 57 no longer reads
them. The app has no network code (`Share.share`, the clipboard and `Linking` need no
socket), so `android.blockedPermissions` takes INTERNET, the legacy storage pair, the
media-read set and the template's SYSTEM_ALERT_WINDOW back out of the shipped build;
`plugins/withDebugInternet.js` adds INTERNET to
`android/app/src/debug/AndroidManifest.xml` alone at prebuild so a dev client can still
fetch its bundle. `allowBackup` is an explicit `true`: the store is the player's own six
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
`welcomed`, the onboarding flag. Reset to defaults is confirmed through `ConfirmModal`,
rewrites the settings record alone and keeps `welcomed`. The About card's version is
`Constants.expoConfig.version` from `expo-constants`, which is app.json's, and its source
link is the one URL in the tree: `Linking` hands it to the browser, so INTERNET stays
blocked, and `appConfig.test.ts` pins that URL by file and value so the no-network scan
stays a guard. The keys, the row list and every enum table are pinned as literals in
`src/app/__tests__/settings-contract.test.ts`; `validate.test.ts` walks
`Object.getOwnPropertyNames(Object.prototype)` through every table via `JSON.parse` and
must fail if `has` is ever changed to `in`.

## Conventions

This repository follows `CONVENTIONS.md`, which is identical in every platteration
repository and pinned by the conventions test (`npm run test:conventions`, or
`tests/test_conventions.py` in a Python repository): the script set (`test`,
`typecheck`, `lint`, `check`, `test:e2e`, `test:all`), Node 22 via `.nvmrc`, one
`.editorconfig`, ESLint per stack, the `ci.yml` shape, the documents every repository
carries and the README skeleton. `npm run check` is the gate before a push. To change a
convention, change it in every repository in one pass and update the hashes in the test.

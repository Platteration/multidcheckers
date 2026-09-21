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
fetch its bundle. `allowBackup` is an explicit `true`: the store is one in-progress game
plus settings. The test runs `expo config --type introspect` (the merged manifest, not
app.json) and scans every AndroidManifest.xml under node_modules, so a module someone
adds tomorrow that declares a permission fails it until the permission is either used or
blocked. `tsconfig.json` lists `node` in `types` for that test; `@types/node` is a
declared devDependency for the same reason, pinned to the Node major CI runs (^22).

## Conventions

This repository follows `CONVENTIONS.md`, which is identical in every platteration
repository and pinned by the conventions test (`npm run test:conventions`, or
`tests/test_conventions.py` in a Python repository): the script set (`test`,
`typecheck`, `lint`, `check`, `test:e2e`, `test:all`), Node 22 via `.nvmrc`, one
`.editorconfig`, ESLint per stack, the `ci.yml` shape, the documents every repository
carries and the README skeleton. `npm run check` is the gate before a push. To change a
convention, change it in every repository in one pass and update the hashes in the test.

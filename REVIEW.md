# 5D Checkers (multidcheckers) — security & upgrade review (2026-09-09)

Two independent reviewers read every first-party file in this repository; a third then re-read each security or bug claim against the code and tried to refute it. Only claims that survived that check are listed as findings; the ones that did not are recorded at the end so they are not re-raised.

## Status — what has been fixed

These findings are now fixed on `claude/repo-review-security-baiyud`, each with a regression test:

- **BUG-1**
- **REL-1**
- **BUG-2**
- **BUG-3**
- **SEC-1**
- **VER-1**

The rest of this document is the review as written, and the fixed items are left in place so the reasoning behind each change stays with it.

Repository hardening applied here as well: every GitHub Action is pinned to a commit rather than a floating tag, each workflow declares a least-privilege `permissions` block, and a Dependabot config, a licence and a security policy are in place.

## Summary

5D Checkers is a polished, feature-complete Expo SDK 57 / RN 0.86 / React 19 pass-and-play game: a pure-TypeScript multiverse engine (board, timelines, time travel, three bot levels), six verified puzzles, replay, share-by-code, themes/skins, stats, a store seam, and 5 jest-expo engine test files. It is well past prototype and is genuinely close to shippable, but it is also a near-identical twin of the sibling repo multidconnect4: 23 first-party source files (~1,150 LOC) plus tsconfig/eas.json/ci.yml/.gitignore are byte-for-byte identical, and another 8 differ only in a product string. De-duplicating those into one shared package is the single highest-leverage change here, because every fix below currently has to be made twice. The other headline items are correctness (the bot plays a move computed from a replayed position; concurrent commits can build a history that no longer replays, which silently breaks share codes and autosave), scale (the whole game history is JSON-stringified into AsyncStorage on every move, growing quadratically, and the multiverse map re-renders every board because React.memo is defeated by an inline onPress), accessibility (light-theme primary buttons are 2.8:1, six unlabelled Switches, no reduce-motion, badges that are invisible), and app-store readiness (no LICENSE, no iOS privacy manifest, no splash config, generated placeholder icons, no OTA channel). Tooling is thin: no linter or formatter at all, no UI or app-layer tests, no Dependabot, unpinned actions, no permissions block.

## Attack surface

This is a fully offline Expo app: there is not one fetch, XMLHttpRequest or WebSocket in the first-party source, no API keys, no accounts and no server, so the classic web/server categories (injection, SSRF, CSRF, CORS, auth) do not apply. The only data that crosses a trust boundary is a game code: a base64url-wrapped JSON payload {v, r, m, a} that arrives either pasted into ShareModal's TextInput or through a deep link (`multidcheckers://...?code=` on device, `?code=` in the URL on the react-native-web build), parsed in src/app/share.ts and replayed through the engine. That path is well designed - only actions are transported and every one is re-validated by applyAction - but the rules object `r` is spread into the game state without any validation, there is no bound on payload size or action count, and the import silently destroys whatever game is in progress plus its autosave. The second boundary is local persistence: four AsyncStorage keys (settings.v1, game.v1, stats.v1, progress.v1, entitlements.v1) read back with JSON.parse and, for the saved game, only a two-field shape check before the raw objects are handed to React. Nothing is rendered as HTML (React Native has no innerHTML surface) and no secrets are stored, so realistic risk is concentrated in untrusted-import handling, persistence robustness, and correctness of the multiverse rules. Supply chain is the remaining exposure: 11 moderate advisories, all rooted in one build-time uuid bug reached through xcode -> @expo/config-plugins, plus two unpinned GitHub Actions in a workflow with no permissions block.

## Already done well

- Game codes transport only the action list and replay it through the real engine (src/app/share.ts:38-45), so a tampered code cannot inject an illegal position - every action is re-checked by applyAction; the round-trip and junk-code cases are tested (src/engine/__tests__/share.test.ts:29-32).
- The engine is genuinely pure and immutable as CLAUDE.md requires: no React import anywhere in src/engine, and applyMove/removePiece/placePiece all copy (src/engine/board.ts:207-232). Illegal actions raise a typed IllegalAction (src/engine/multiverse.ts:229) that the UI distinguishes from crashes (src/ui/useGame.ts:138).
- Persistence is uniformly best-effort and never throws into the UI: every read and write is wrapped (src/app/persist.ts:10-33), and theme values loaded from storage fall back safely (`SKINS.find(...) ?? SKINS[0]`, src/ui/theme.ts:149-150), so a corrupt skin id cannot break rendering.
- The trapped-loss rule is actually implemented and considers time travel, not just moves: passTurn checks hasAnyAction on every board the incoming player must play (src/engine/multiverse.ts:349-356, src/engine/multiverse.ts:223-227), which is what the README promises.
- Good accessibility discipline for a game: every board square and every map thumbnail carries a descriptive accessibilityLabel and accessibilityRole (src/ui/CheckerBoard.tsx:50-59, src/ui/MultiverseMap.tsx:160-165), and there is a colour-blind piece-marking setting (src/ui/CheckerBoard.tsx:84-96).
- Randomised engine tests catch whole classes of rule regressions rather than single positions: 'never picks an illegal action over many random games' (src/engine/__tests__/bot.test.ts:54-66) and 'stays legal across random strict games with bots' (src/engine/__tests__/multiverse.test.ts:303-318), and every puzzle's solution is replayed against the strongest bot (src/engine/__tests__/puzzles.test.ts).
- The monetisation seam is honest and inert: STORE_ENABLED is false, `owns()` returns true for everything, and nothing rule-affecting is gated (src/app/purchases.ts:15, src/app/entitlements.tsx:32).
- CI uses `npm ci` against a committed lockfile and runs typecheck, tests and a web export on Node 22 (.github/workflows/ci.yml:16-20); no secrets are committed and .gitignore covers keystores, .p8/.p12 and .env*.local.

## Findings (20)

| # | Severity | Category | Title | Where | Effort | Status |
|---|---|---|---|---|---|---|
| BUG-1 | High | bug | Novice and Tricky bots freeze the game forever when their only legal action is a time travel | `src/engine/bot.ts:42` | small | confirmed |
| REL-1 | High | reliability | Autosave serialises the whole history on every move; it grows quadratically and silently exceeds storage limits | `src/ui/GameScreen.tsx:188` | medium | confirmed |
| BUG-2 | Medium | bug | Watching the replay of a bot game makes the bot play moves into the live game | `src/ui/GameScreen.tsx:79` | trivial | confirmed |
| BUG-3 | Medium | bug | A finished game is folded into the record again on every app launch | `src/ui/GameScreen.tsx:89` | small | confirmed |
| SEC-1 | Medium | security | A deep link or web ?code= silently replaces the game in progress and destroys its autosave, with no confirmation and no way back | `src/ui/GameScreen.tsx:110` | small | confirmed |
| VER-1 | Medium | bug | Opening the replay while a piece is picked up crashes the app during render | `src/ui/GameScreen.tsx:251` | small | found by second reviewer |
| REL-2 | Low | reliability | The restored game is accepted on a two-field check with no schema validation or migration, and a bad save bricks the app at launch | `src/app/setup.ts:25` | medium | confirmed, severity lowered |
| SEC-2 | Low | security | An imported game code chooses the rule variants, and the app never tells the player which rules it is now enforcing | `src/app/share.ts:38` | trivial | confirmed |
| SEC-3 | Low | security | No bound on the size or action count of an imported game code | `src/app/share.ts:39` | trivial | confirmed |
| BUG-4 | Low | bug | 'System' theme never follows the system on iOS: app.json forces the app into dark mode | `app.json:9` | trivial | confirmed |
| BUG-5 | Low | reliability | The multiverse map renders every board of every timeline with no virtualisation | `src/ui/MultiverseMap.tsx:114` | medium | confirmed |
| CI-1 | Low | ci-cd | CI workflow uses floating action tags, grants default token permissions, and runs on every push | `.github/workflows/ci.yml:3` | trivial | confirmed, severity lowered |
| VER-2 | Low | bug | A pasted game code that picked up a line break is rejected as 'damaged' | `src/app/share.ts:29` | small | found by second reviewer |
| VER-3 | Low | bug | The game-over sheet re-opens over the replay and again on the way back to the game | `src/ui/GameScreen.tsx:226` | small | found by second reviewer |
| VER-4 | Low | reliability | Bot thinking time grows with the size of the multiverse, on the main thread with no yield | `src/engine/bot.ts:116` | medium | found by second reviewer |
| BUG-6 | Info | bug | The forty-move draw rule counts plies across all boards, so a big multiverse draws far too early | `src/engine/multiverse.ts:57` | small | confirmed, severity lowered |
| REL-3 | Info | reliability | seekTo's promise is left unhandled inside a synchronous try/catch, so audio errors surface as unhandled rejections | `src/app/sound.ts:40` | trivial | confirmed, severity lowered |
| BUG-7 | Info | bug | Malformed actions escape as raw Error text shown to the player | `src/engine/multiverse.ts:113` | trivial | confirmed, severity lowered |
| SUPPLY-1 | Info | supply-chain | expo-sharing is a declared dependency that is never imported | `package.json:11` | trivial | confirmed, severity lowered |
| SUPPLY-2 | Info | supply-chain | No LICENSE, SECURITY.md, CODEOWNERS or Dependabot in a repo that ships to app stores | `README.md:1` | trivial | confirmed |

### BUG-1 · Novice and Tricky bots freeze the game forever when their only legal action is a time travel

**Severity:** High · **Category:** bug · **Effort:** small · **Where:** `src/engine/bot.ts:42`

enumerateActions only offers time travels at level 3, but the engine's trapped-loss rule counts a travel as an action. So a position where the bot has no checkers move yet does have a legal travel is NOT a loss (hasAnyAction returns true, passTurn does not end the game) and is NOT playable by a level 1 or 2 bot: chooseAction returns null, and GameScreen's bot effect does `if (action) game.play(action)` with no else branch and no retry, so the app sits on 'Novice is thinking...' / 'Tricky is thinking...' forever. Nothing recovers it - the effect only re-runs when `state`, `bot` or `humanTurn` changes, and none of them can change while the bot owns the turn. The player's only escape is Undo or throwing the game away. I reproduced this by simulating 300 single-timeline games of a level-2 bot against a random legal opponent using the repo's own engine: 4 games (1.3%) ended in this frozen state, each around ply 92-95, with hasAnyAction=true. It is not an exotic corner - it is the ordinary endgame where a last man walks into a blocked square whose position was empty on an earlier board of its own parity.

Evidence:

```
src/engine/bot.ts:39-49  `for (const tl of pendingTimelines(state)) { ... if (level >= 3) { for (const square of piecesOf(board, state.toMove)) { for (const to of travelTargets(state, tl.id, square)) ... } } }`
src/engine/bot.ts:103-104  `let actions = enumerateActions(state, level);\n  if (actions.length === 0) return null;`
src/engine/multiverse.ts:223-227  `export function hasAnyAction(state, timeline) { if (legalMovesOn(...).length > 0) return true; ... return piecesOf(board, state.toMove).some((sq) => travelTargets(state, timeline, sq).length > 0); }`
src/ui/GameScreen.tsx:218-221  `const timer = setTimeout(() => { const action = chooseAction(state, bot.level); if (action) game.play(action); }, 600);`
Reproduction output (repo engine, 300 games, level 2 vs random): `STUCK game=27 plies=94 timelines=1 boards=94 hasAnyAction=true` (4 of 300).
```

**Recommendation.** Make chooseAction total, as recommended: `let actions = enumerateActions(state, level); if (actions.length === 0) actions = enumerateActions(state, 3);`. Also add the missing else branch in GameScreen so any future dead end surfaces as text instead of a silent hang. The regression test is worth writing as the auditor describes (chooseAction(state, 1) !== null wherever hasAnyAction is true on a mandatory timeline), and it should be derived from hasAnyAction rather than from enumerateActions so it cannot excuse itself. Do not port the fix to multidconnect4 as a bug fix - its pendingTimelines already excludes full boards, so level 1 always has a drop; a defensive fallback there is harmless but not needed.

### REL-1 · Autosave serialises the whole history on every move; it grows quadratically and silently exceeds storage limits

**Severity:** High · **Category:** reliability · **Effort:** medium · **Where:** `src/ui/GameScreen.tsx:188`

The autosave writes `{version: 2, history: game.history, setup}` - every GameState, each of which contains every board of every timeline. In memory the boards are shared by reference, but JSON.stringify expands them, so the payload is O(moves x boards). Measured with the repo's own engine driving a level-3 (Paradox) bot: 40 actions -> 0.84 MB, 100 actions -> 5.5 MB, 200 actions -> 21.5 MB (249 ms to stringify on desktop V8; Hermes on a phone is several times slower), 400 actions -> 81 MB. This runs 250 ms after every single move. Consequences on real devices: on the web build AsyncStorage is localStorage, whose ~5 MB per-origin quota is passed around 100 actions; on Android AsyncStorage's default SQLite budget is 6 MB. saveJson swallows the error, so the app keeps playing while the save silently freezes at an old state - the player closes the app and loses everything since. Before that point the repeated multi-megabyte stringify plus native bridge write is a visible stall after each move, and on a low-memory phone an OOM. This is the single most likely way a real user loses a long game.

Evidence:

```
src/ui/GameScreen.tsx:186-192  `const timer = setTimeout(() => {\n      if (game.history.length > 1) void saveJson(keys.game, { version: 2, history: game.history, setup: game.setup });\n      else void removeKey(keys.game);\n    }, 250);`
src/app/persist.ts:19-25  `try { await AsyncStorage.setItem(key, JSON.stringify(value)); } catch { // Ignore: persistence is a convenience, never a requirement. }`
Measured (repo engine, Paradox bot): actions=100 timelines=34 savedBytes=5,759,418 (5.49 MB); actions=200 savedBytes=22,574,317 (21.5 MB); actions=400 savedBytes=85,431,138 (81.5 MB).
```

**Recommendation.** Persist the action list, not the state list - the code to do it already exists. Save `{version: 3, actions: actionsOf(game.history), rules: game.history[0].rules, setup}` (src/app/share.ts:19-26) and rebuild on load by replaying through applyAction; the same 400-action game replays in 5 ms and its action payload is 31 KB instead of 81 MB. Keep the version 2 reader for one release to migrate existing saves. Separately, stop swallowing write failures silently: have saveJson return a boolean and let GameScreen surface 'this game is too large to save' rather than pretending it saved. persist.ts is byte-identical in multidconnect4, and multidconnect4/src/ui/GameScreen.tsx:178 has the same full-history write.

### BUG-2 · Watching the replay of a bot game makes the bot play moves into the live game

**Severity:** Medium · **Category:** bug · **Effort:** trivial · **Where:** `src/ui/GameScreen.tsx:79`

During replay, `humanTurn` is forced false and `state` is switched to a historical snapshot. The bot effect's guard is `if (!bot || humanTurn || state.status !== 'playing') return;`, so replaying a bot game satisfies every condition: 600 ms later it calls `chooseAction(state, bot.level)` on the OLD state and then `game.play(action)`, which applies it to `game.state` - the live game. 'Replay this game' is offered from the menu whenever history.length > 1, i.e. mid-game, so the realistic outcome is that opening the replay of an in-progress bot game silently appends a bot move (chosen for a stale position) to the real history; each seek in the ReplayBar can append another. When the live game is already finished the action instead throws IllegalAction('the game is over') into `game.error`, which the replay layout hides (`replaying && { display: 'none' }`), so the failure is invisible. Puzzles are affected too, since they install a level-3 bot.

Evidence:

```
src/ui/GameScreen.tsx:80-83  `const replaying = replayIndex !== null && replayIndex < game.history.length;\n  const state = replaying ? game.history[replayIndex] : game.state;\n  ...\n  const humanTurn = game.humanTurn && !replaying;`
src/ui/GameScreen.tsx:217-221  `if (!bot || humanTurn || state.status !== 'playing') return;\n    const timer = setTimeout(() => {\n      const action = chooseAction(state, bot.level);\n      if (action) game.play(action);\n    }, 600);`
src/ui/useGame.ts:120  `const next = applyAction(state, action);`  // `state` here is the LIVE state, not the replayed one
```

**Recommendation.** Add `!replaying` to the effect's guard (`if (!bot || humanTurn || replaying || state.status !== 'playing') return;`) and drive it from `game.state` rather than the replay-shadowed `state`, so the replay view is strictly read-only. Identical code and identical bug in multidconnect4/src/ui/GameScreen.tsx:79 and :250-254.

### BUG-3 · A finished game is folded into the record again on every app launch

**Severity:** Medium · **Category:** bug · **Effort:** small · **Where:** `src/ui/GameScreen.tsx:89`

The 'record this game once' effect is guarded only by a ref that lives as long as the component. A finished game stays in AsyncStorage (the autosave only clears the key when history.length <= 1), so on the next cold start GameScreen mounts with that finished history, the effect runs with `recordedRef.current === null`, and recordGame is called again. Every relaunch while a finished game is the saved game adds another game played, another win/loss against that bot, another `travels` count and another shot at mostTimelines/longestGame. The 'Your record' screen therefore drifts upward just from opening the app, which quietly makes the whole stats feature untrustworthy. The same effect also records a finished game imported from someone else's share code as if it were yours.

Evidence:

```
src/ui/GameScreen.tsx:88-95  `const recordedRef = useRef<GameState | null>(null);\n  useEffect(() => {\n    const live = game.state;\n    if (live.status === 'playing' || game.setup.mode === 'puzzle' || recordedRef.current === live) return;\n    recordedRef.current = live;\n    recordGame(game.history, game.setup);\n  }, [game.state.status]);`
src/ui/GameScreen.tsx:188  `if (game.history.length > 1) void saveJson(keys.game, ...)`  // a finished game is still length > 1, so it persists
```

**Recommendation.** Make 'recorded' a property of the game, not of the component: stamp the saved game with `recorded: true` when recordGame runs and skip it on load, or write a short game id into the stats record and refuse duplicates. Cheapest correct fix: in the same effect, `void removeKey(keys.game)` once a non-puzzle game is finished and recorded, so the next launch starts clean. Identical code in multidconnect4/src/ui/GameScreen.tsx:84-88.

### SEC-1 · A deep link or web ?code= silently replaces the game in progress and destroys its autosave, with no confirmation and no way back

**Severity:** Medium · **Category:** security · **Effort:** small · **Where:** `src/ui/GameScreen.tsx:110`

Any `multidcheckers://...?code=...` link (the scheme is registered in app.json) or any `?code=` in the URL of the web build is loaded immediately on arrival: codeFromUrl extracts it and loadCode calls game.load, which throws away the entire current history and setup. There is no confirmation, even though the in-app 'New game' path is carefully guarded by a 'Start over? The game in progress will be lost' dialog for exactly this outcome. 250 ms later the autosave overwrites game.v1 with the imported game, so the previous game is gone from storage too and Undo cannot reach it (history was replaced, not appended). On the web the URL is never cleaned up, so every subsequent reload re-imports the same shared position and discards whatever has been played since. For an offline game the security impact is limited to griefing and accidental data loss rather than compromise, but a link in a chat that wipes a friend's half-finished game is a real, one-tap outcome.

Evidence:

```
src/ui/GameScreen.tsx:110-122  `Linking.getInitialURL().then((url) => { const code = codeFromUrl(url); if (code) loadCodeRef.current(code); })... Linking.addEventListener('url', ({ url }) => { const code = codeFromUrl(url); if (code) loadCodeRef.current(code); });`
src/ui/useGame.ts:248-255  `const load = useCallback((nextHistory, nextSetup) => { ... setHistory(nextHistory); ... }, []);`
src/ui/MenuModal.tsx:37-38  `<Text style={styles.title}>Start over?</Text> <Text style={styles.body}>The game in progress will be lost. Every timeline of it.</Text>`  // the guard that the link path skips
```

**Recommendation.** Decode the incoming code first, then ask before replacing: reuse MenuModal's confirmation pattern (or a dedicated 'Load the game from this link?' sheet showing whose turn it is and how many timelines) whenever `game.history.length > 1`. On the web, strip the parameter after a successful import with `window.history.replaceState(null, '', window.location.pathname)` so a reload does not re-import. links.ts is byte-identical in multidconnect4 and its GameScreen has the same auto-load.

### VER-1 · Opening the replay while a piece is picked up crashes the app during render

**Severity:** Medium · **Category:** bug · **Effort:** small · **Where:** `src/ui/GameScreen.tsx:251`

`origin` is computed from the replay-shadowed `state` but the live `selection`. Selection is not cleared when the menu opens or when a replay starts, so if the player has a piece picked up on a timeline that did not exist yet at the replayed index - any timeline created by a time travel, i.e. the whole point of the game - `getTimeline(history[replayIndex], selection.from.timeline)` throws `Error: no timeline N` straight out of the render body. 'Replay this game' sets replayIndex to 0, where a normal game has exactly one timeline, so holding a piece on Timeline 2 and tapping Replay is enough. There is no ErrorBoundary anywhere in App.tsx, so the exception unmounts the tree: a redbox in development, a blank screen or a terminated app in release. It is recoverable by restarting (replayIndex is not persisted), which is why this is medium rather than high. The same line exists in multidconnect4/src/ui/GameScreen.tsx:277, so the sibling shares it.

Evidence:

```
src/ui/GameScreen.tsx:251  `const origin = selection.kind === 'none' ? null : latestRef(getTimeline(state, selection.from.timeline));`
src/ui/GameScreen.tsx:80-81  `const replaying = replayIndex !== null && replayIndex < game.history.length;\n  const state = replaying ? game.history[replayIndex] : game.state;`
src/ui/GameScreen.tsx:412  `...(game.history.length > 1 ? [{ label: 'Replay this game', onPress: () => setReplayIndex(0) }] : []),`  // offered mid-game, and nothing clears the selection on the way in
src/engine/multiverse.ts:112-116  `const tl = state.timelines[id]; if (!tl) throw new Error(`no timeline ${id}`);`
src/ui/useGame.ts:198-204  `const cancel = useCallback(() => { ... setSelection(NONE); }, ...)`  // the only thing that clears a selection, and the replay path never calls it
```

**Recommendation.** Clear the selection when entering a replay (`game.cancel()` alongside `setReplayIndex(0)`), and make `origin` replay-safe as well: `const origin = replaying || selection.kind === 'none' ? null : latestRef(...)`. The general fix is to derive every replay-time value from the replayed state alone and treat the replay view as strictly read-only - the same discipline the BUG-2 fix needs. An ErrorBoundary around <Root/> would also cap the blast radius of this class of mistake.

### REL-2 · The restored game is accepted on a two-field check with no schema validation or migration, and a bad save bricks the app at launch

**Severity:** Low (reported as medium, adjusted after review) · **Category:** reliability · **Effort:** medium · **Where:** `src/app/setup.ts:25`

looksLikeSavedGame accepts anything whose `version` is 1 or 2 and whose `history` is a non-empty array; normaliseSaved then hands the raw objects straight to useGame as GameState[]. Nothing checks that each element has `timelines`, `lastCreated`, `quietPlies`, `status`, or that each timeline's `id` equals its index (an invariant applyAction relies on at src/engine/multiverse.ts:269 `timelines[tl.id].boards.push(...)`). Version 1 is explicitly accepted with no migration function at all - it just gets DEFAULT_SETUP. Any shape drift from an older shipped build therefore reaches render, where the first dereference is unguarded: GameScreen does `state.lastCreated.some(...)` and `getTimeline(state, focus.timeline)`, the latter throwing a plain Error for a missing timeline. There is no ErrorBoundary anywhere in App.tsx and no 'clear saved game' escape, and the same bad value is reloaded on every launch, so the result is an unrecoverable crash loop that can only be cleared by deleting the app's data.

Evidence:

```
src/app/setup.ts:25-32  `return !!s && (s.version === 1 || s.version === 2) && Array.isArray(s.history) && s.history.length > 0;` ... `return { history: v.history, setup: 'setup' in v ? v.setup : DEFAULT_SETUP };`
App.tsx:22-24  `loadJson<unknown>(keys.game).then((v) => setSaved(looksLikeSavedGame(v) ? normaliseSaved(v) : null));`
src/ui/GameScreen.tsx:242  `const timeline = getTimeline(state, focus.timeline);`  // throws, no fallback (line 241 above it does have `?? state.timelines[0].boards[0]`)
src/engine/multiverse.ts:112-116  `if (!tl) throw new Error(\`no timeline ${id}\`);`
```

**Recommendation.** Keep the ErrorBoundary + 'discard the saved game' escape hatch as the primary fix (it is the part that converts an unrecoverable launch crash into a recoverable one, whatever the cause). The per-state schema walk is better replaced by the REL-1 fix: persisting actions and replaying them through applyAction validates by construction and removes the migration problem, so do not write a bespoke validator that will drift from the engine. Either drop the `version === 1` branch or give it a real migration.

*Reviewer note (confirmed, severity lowered):* The code reads exactly as quoted: the guard is a version check plus 'history is a non-empty array', normaliseSaved hands the raw objects on, version 1 is accepted with no migration, and GameScreen.tsx:242 dereferences via getTimeline which throws a plain Error with no fallback (unlike line 241, which does have `?? state.timelines[0].boards[0]`). There is also no ErrorBoundary in App.tsx - I checked the whole provider tree - and no 'clear saved game' escape, so a malformed save would indeed reproduce on every launch. What is overstated is reachability: the only writer of this key is GameScreen.tsx:188, which always writes a well-formed `{version: 2, history, setup}` produced by the engine, and this is the first release (git log shows 13 commits, package.json version 1.0.0), so there is no shipped v1 payload in the wild for the v1 branch to mis-handle. Getting a value the loader accepts but the renderer chokes on needs either an out-of-band edit (device with the app's data, or same-origin localStorage on a web build) or a future format change - a forward-looking hardening item, not a live defect. Worth adding to the finding: `setup` is passed through with no validation at all (setup.ts:31 `'setup' in v ? v.setup : DEFAULT_SETUP`), so a tampered save can carry `bot.player` outside {0,1}, which leaves humanTurn permanently true and the bot silently inert.

### SEC-2 · An imported game code chooses the rule variants, and the app never tells the player which rules it is now enforcing

**Severity:** Low · **Category:** security · **Effort:** trivial · **Where:** `src/app/share.ts:38`

decodeGame passes the attacker-controlled `payload.r` straight into newGame, which spreads it over DEFAULT_RULES with no validation of keys or types. The sender therefore decides whether flying kings, backward captures and strict present are in force for the game you load, and non-boolean truthy values (`"flyingKings": 1`, `{}`) are accepted as on. Nothing in the UI surfaces the loaded game's rules: the Settings switches show only the local preferences that apply to the *next new* game (src/ui/GameScreen.tsx:452-463), the status pill and board title never mention variants, and the loaded history keeps its own `rules` forever. The concrete consequence in play-by-message is that a friend can hand you a code whose rules differ from what you both agreed, and the only symptom is that a move you thought was illegal is accepted (or a jump you did not expect is mandatory). Prototype pollution is not reachable here - object spread defines an own `__proto__` property rather than invoking the setter - so this is a rules-integrity issue, not a memory-safety one.

Evidence:

```
src/app/share.ts:37-38  `if (payload.v !== 1 || !Array.isArray(payload.a)) throw new Error(...);\n  const history: GameState[] = [newGame(payload.r)];`
src/engine/multiverse.ts:87  `rules: { ...DEFAULT_RULES, ...rules },`
src/app/share.ts:12-17  `interface Payload { v: 1; r: Rules; m: GameSetup['mode']; a: Action[]; }`  // the type is asserted, never checked
```

**Recommendation.** Normalise the rules on import rather than trusting the cast: `const r = payload.r as Record<string, unknown> | null; const rules = { flyingKings: r?.flyingKings === true, backCapture: r?.backCapture === true, strictPresent: r?.strictPresent === true };` and pass that. Then show the loaded game's active variants in the header subtitle or the board title (e.g. 'flying kings - strict present') so a player can see which rule set they just accepted. share.ts differs from multidconnect4/src/app/share.ts only in the 5DCK./5DC4. prefix and the error string, so the same change applies there.

### SEC-3 · No bound on the size or action count of an imported game code

**Severity:** Low · **Category:** security · **Effort:** trivial · **Where:** `src/app/share.ts:39`

decodeGame replays `payload.a` in one synchronous loop with no cap on its length and no cap on the input string, accumulating a GameState per action into `history`. Replay itself is cheap (I measured 400 legal actions across 78 timelines replaying in 5 ms), so this is not a practical hang for realistic codes; the cost is memory and everything downstream - the resulting history feeds the autosave described in REL-1 (quadratic JSON) and the un-virtualised map described in BUG-5. A deliberately large but entirely legal code pasted from a chat can therefore push the app straight into the multi-megabyte-save and tens-of-thousands-of-views regimes at import time, on the main thread, with no progress indication. There is also no cap on the pasted string itself before base64 decoding.

Evidence:

```
src/app/share.ts:38-45  `const history: GameState[] = [newGame(payload.r)];\n  for (const action of payload.a) {\n    try { history.push(applyAction(history[history.length - 1], action)); }\n    catch { throw new Error('That code contains a move that is not legal.'); }\n  }`
src/ui/ShareModal.tsx:75-86  `<TextInput value={pasted} onChangeText={setPasted} ... multiline />` ... `onPress={load}`  // no length check
```

**Recommendation.** Reject oversized input before doing any work: cap `code.length` (a normal game is a few KB - 64 KB is generous) and cap `payload.a.length` (e.g. 2000 actions), with a clear 'that game is too large to load' message. Both checks are two lines at the top of decodeGame and also protect the deep-link path in SEC-1.

### BUG-4 · 'System' theme never follows the system on iOS: app.json forces the app into dark mode

**Severity:** Low · **Category:** bug · **Effort:** trivial · **Where:** `app.json:9`

`userInterfaceStyle: "dark"` sets UIUserInterfaceStyle=Dark in the iOS Info.plist, which forces the whole app into dark mode and makes React Native's useColorScheme() report 'dark' regardless of the device setting. The Settings sheet offers System / Dark / Light, and ThemeProvider resolves 'system' via useColorScheme, so on iOS the default 'System' choice is permanently dark for a user whose phone is in light mode - the setting appears to do nothing until they pick 'Light' explicitly. (On Android the key is a no-op here anyway: expo-system-ui, which Expo requires to apply it, is not a dependency.)

Evidence:

```
app.json:9  `"userInterfaceStyle": "dark",`
src/app/theme.tsx:11-12  `const system = useColorScheme();\n  const scheme = settings.theme === 'system' ? (system === 'light' ? 'light' : 'dark') : settings.theme;`
package.json:5-18  // no expo-system-ui dependency
```

**Recommendation.** Set `"userInterfaceStyle": "automatic"` in app.json so the OS scheme reaches useColorScheme, and add expo-system-ui if the Android side should honour it too; keep `backgroundColor` as is. Same value and same effect in multidconnect4/app.json:9.

### BUG-5 · The multiverse map renders every board of every timeline with no virtualisation

**Severity:** Low · **Category:** reliability · **Effort:** medium · **Where:** `src/ui/MultiverseMap.tsx:114`

The map maps over `state.timelines` and then over `tl.boards`, mounting a MiniBoard for each; every MiniBoard mounts 64 cell Views plus a piece View per occupied square, inside plain nested ScrollViews rather than a FlatList. The board count grows with moves x timelines, so a Paradox-bot game measured on the repo's engine reaches 134 boards (about 8,600 cell views) at 100 actions and 478 boards (about 30,600 cell views) at 400. Every one of them re-renders whenever `state` changes - MiniBoard is React.memo'd, but the `onPress` arrow and the computed `ring`/`badge`/`dim` props are new objects each render, so memoisation does not bite. Long or travel-heavy games therefore get progressively laggier and eventually unusable on a mid-range phone, which is exactly the kind of game this app is designed to produce.

Evidence:

```
src/ui/MultiverseMap.tsx:114-171  `{state.timelines.map((tl) => { ... {tl.boards.map((board, i) => { ... <MiniBoard board={board} ring={ring} badge={badge} dim={dim} onPress={() => onPressBoard(ref)} ... /> ... })}`
src/ui/MiniBoard.tsx:26-51  `for (let r = SIZE - 1; r >= 0; r--) { for (let c = 0; c < SIZE; c++) { cells.push(<View ... />) } }`  // 64 views per thumbnail
Measured: 100 actions -> 34 timelines / 134 boards; 400 actions -> 78 timelines / 478 boards.
```

**Recommendation.** Windowing is the real fix: render timeline rows with a FlatList and, within a row, only the boards whose slot intersects the horizontal viewport (the layout is already absolute-positioned by turn, so the visible turn range is `scrollX / SLOT` to `(scrollX + viewport.width) / SLOT`). Cheaper interim step: stabilise MiniBoard's props (`useCallback` the press handler per ref, pass primitives) so React.memo actually prevents the re-render storm.

### CI-1 · CI workflow uses floating action tags, grants default token permissions, and runs on every push

**Severity:** Low (reported as medium, adjusted after review) · **Category:** ci-cd · **Effort:** trivial · **Where:** `.github/workflows/ci.yml:3`

Three hygiene gaps in one 20-line file. (1) `actions/checkout@v4` and `actions/setup-node@v4` are floating tags, not commit SHAs (0 of 2 pinned): a tag can be repointed, so a compromised action would execute in the workflow. (2) There is no `permissions:` block, so the job's GITHUB_TOKEN gets the repository default - on a repo whose default is still read/write, any code that runs in the job (including a postinstall script from the dependency tree that `npm ci` executes) can push to the repository. This job needs nothing but `contents: read`. (3) `on: push` has no branch filter, so every push to every branch runs a full install plus a web export; combined with `pull_request` it also double-runs for PRs from branches in the same repo. There are no secrets in the workflow, which limits the blast radius, but the write-capable token is itself the asset.

Evidence:

```
.github/workflows/ci.yml:3-5  `on:\n  push:\n  pull_request:`
.github/workflows/ci.yml:8-12  `jobs:\n  check:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - uses: actions/setup-node@v4`  // no `permissions:` anywhere in the file
```

**Recommendation.** Add `permissions: { contents: read }` at workflow level; pin both actions to full commit SHAs with a version comment (`actions/checkout@<sha> # v4.2.2`); and narrow the trigger to `push: { branches: [main] }` so PR branches run once via `pull_request`. The workflow is byte-identical in multidconnect4/.github/workflows/ci.yml - apply the same change there. Adding a Dependabot config for `github-actions` and `npm` keeps the pins fresh.

*Reviewer note (confirmed, severity lowered):* All three facts check out - the file really has no permissions block, both actions are floating major tags, and `on: push` has no branch filter alongside `pull_request` - but medium overstates the risk for this workflow. There are no secrets referenced anywhere in it, no deploy or release step, no pull_request_target, and nothing is published; the only asset is GITHUB_TOKEN, and GitHub's default for repositories created since Feb 2023 is already contents:read, so the write-capable-token scenario is conditional on an old repo setting rather than something the file demonstrates. The two actions are first-party actions/checkout and actions/setup-node, where floating major tags are the documented, near-universal practice; SHA-pinning is real hardening but it is hygiene, not a live exposure. The unfiltered push trigger is wasted CI minutes, not a security issue. The recommendation itself is correct and cheap - do all of it - just at low priority. The workflow is byte-identical in multidconnect4 (verified with diff).

### VER-2 · A pasted game code that picked up a line break is rejected as 'damaged'

**Severity:** Low · **Category:** bug · **Effort:** small · **Where:** `src/app/share.ts:29`

decodeGame only trims the ends of the pasted string; base64 decode then rejects the first character that is not in the URL-safe alphabet, and a newline is not. Codes for a real game are long (the whole action list), the paste target is a multiline TextInput, and messaging clients, email and terminals all wrap or insert breaks in long tokens, so a perfectly good code that survived the round trip through a chat gets the flat message 'That code is damaged and cannot be read.' Play-by-message is a headline feature and this is its most likely field failure; the user has no way to tell a wrapped code from a corrupt one. The same code is in multidconnect4/src/app/share.ts.

Evidence:

```
src/app/share.ts:29-36  `const trimmed = code.trim();\n  if (!trimmed.startsWith(PREFIX)) throw new Error('This is not a 5D Checkers game code.');\n  let payload: Payload;\n  try {\n    payload = JSON.parse(decode(trimmed.slice(PREFIX.length))) as Payload;\n  } catch {\n    throw new Error('That code is damaged and cannot be read.');\n  }`
src/app/base64.ts:28-30  `for (const ch of code) {\n    const v = ALPHABET.indexOf(ch);\n    if (v < 0) throw new Error('not a valid code');`
src/app/base64.ts:2  `const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';`  // no whitespace, no padding
src/ui/ShareModal.tsx:82  `multiline`
```

**Recommendation.** Strip all whitespace before decoding rather than only trimming: `const trimmed = code.replace(/\s+/g, '');` (do it before the prefix test so a leading break is tolerated too). Add a case to src/engine/__tests__/share.test.ts that round-trips a code with newlines inserted every 40 characters.

### VER-3 · The game-over sheet re-opens over the replay and again on the way back to the game

**Severity:** Low · **Category:** bug · **Effort:** small · **Where:** `src/ui/GameScreen.tsx:226`

`gameOverDismissed` is reset by an effect keyed on the replay-shadowed `state.status`, and GameOverModal's visibility reads that same shadowed status. Pressing 'Watch the replay' sets gameOverDismissed true and then seeks to index 0, whose status is 'playing' - which immediately resets the flag to false. Seeking forward to the final state then pops the modal on top of the replay bar, and pressing 'Back to game' pops it again over the finished board. The replay of a finished game therefore cannot be watched to the end without dismissing the sheet repeatedly.

Evidence:

```
src/ui/GameScreen.tsx:226-228  `useEffect(() => {\n    if (state.status === 'playing') setGameOverDismissed(false);\n  }, [state.status]);`
src/ui/GameScreen.tsx:493-495  `<GameOverModal\n        state={state}\n        visible={!puzzle && state.status !== 'playing' && !gameOverDismissed}`
src/ui/GameScreen.tsx:501-504  `onReplay={() => {\n          setGameOverDismissed(true);\n          setReplayIndex(0);\n        }}`
src/ui/GameScreen.tsx:81  `const state = replaying ? game.history[replayIndex] : game.state;`
```

**Recommendation.** Drive both the reset effect and the modal's visibility from `game.state` rather than the replay-shadowed `state`, and add `!replaying` to the visible condition. This is the same root cause as BUG-2 and VER-1: replay-time values leaking into logic that should read the live game.

### VER-4 · Bot thinking time grows with the size of the multiverse, on the main thread with no yield

**Severity:** Low · **Category:** reliability · **Effort:** medium · **Where:** `src/engine/bot.ts:116`

chooseAction applies every candidate twice - once in the immediate-win scan and once in the scoring loop - and each applyAction copies every timeline and every timeline's board array (multiverse.ts:257), so one bot move costs O(candidates x timelines) array allocations, up to 120 x T with MAX_CANDIDATES at 60. On top of that, level 3's enumerateActions calls travelTargets per piece, and travelTargets walks every board of every timeline, giving O(pendingTimelines x pieces x totalBoards) before scoring even starts; the same scan runs again inside hasAnyAction for each mandatory timeline whenever a candidate ends the turn. All of it runs synchronously inside a setTimeout on the JS thread, so in the large multiverses the Paradox bot itself creates the 'thinking' pause stops being the cosmetic 600 ms delay it is meant to be. This is the compute-side twin of BUG-5 and would be masked by the same long games.

Evidence:

```
src/engine/bot.ts:115-133  `// Immediate wins first, at every level.\n  for (const a of actions) {\n    const next = applyAction(state, a);\n    if (next.status === 'won' && next.win?.player === me) return a;\n  }\n  ...\n  for (const a of actions) {\n    const next = applyAction(state, a);`  // every candidate applied twice
src/engine/multiverse.ts:257  `const timelines = state.timelines.map((tl) => ({ ...tl, boards: tl.boards.slice() }));`
src/engine/multiverse.ts:191-208  `export function travelTargets(...) { for (const tl of state.timelines) { const last = latestTurn(tl); tl.boards.forEach((board, i) => { ... }) } }`
src/engine/bot.ts:42-47  `if (level >= 3) { for (const square of piecesOf(board, state.toMove)) { for (const to of travelTargets(state, tl.id, square)) {`
src/ui/GameScreen.tsx:218-221  `const timer = setTimeout(() => { const action = chooseAction(state, bot.level); if (action) game.play(action); }, 600);`
```

**Recommendation.** Cheapest win first: fold the immediate-win scan into the scoring loop so each candidate is applied once. Then hoist the per-timeline travelTargets computation out of the per-piece loop in enumerateActions (the target list does not depend on the square except for the emptiness test, which can be checked per candidate). If measurements still show a stall, cap MAX_CANDIDATES by multiverse size rather than by a constant.

### BUG-6 · The forty-move draw rule counts plies across all boards, so a big multiverse draws far too early

**Severity:** Info (reported as low, adjusted after review) · **Category:** bug · **Effort:** small · **Where:** `src/engine/multiverse.ts:57`

QUIET_PLIES_FOR_DRAW is 80 and quietPlies is incremented once per action, not once per turn. With a single timeline that is exactly the promised 'forty quiet moves each'. But on your turn you must move on every waiting board, so with N timelines each player makes N actions per turn: at four timelines the draw fires after ten turns each, at ten timelines after four. Since time travel is the whole point of the game, a multi-timeline endgame that is not actually repeating can be declared drawn almost immediately, and the game-over sheet then tells the player something untrue ('Forty moves each without a capture, a crowning, or a time travel'). The draw can also land mid-turn, ending the game while boards are still waiting to be played.

Evidence:

```
src/engine/multiverse.ts:56-57  `/** Plies (one move by one player) without progress before the game is drawn. */\nexport const QUIET_PLIES_FOR_DRAW = 80;`
src/engine/multiverse.ts:273  `quietPlies = action.move.captures.length > 0 || crowned ? 0 : state.quietPlies + 1;`
src/engine/multiverse.ts:325  `if (quietPlies >= QUIET_PLIES_FOR_DRAW) return { ...next, status: 'draw' };`
src/ui/Modals.tsx:123  `: 'Forty moves each without a capture, a crowning, or a time travel.'`
```

**Recommendation.** If the turn-scaled threshold is judged wrong in play, change it as a rules decision and update README.md, RulesModal and the game-over text together - do not present it as a bug fix, and expect to rewrite multiverse.test.ts:233 which currently pins the per-action count. A smaller, clearly-correct fix is worth doing on its own: move the draw check below resolveTurn so a draw cannot be declared while boards are still waiting inside the same turn.

*Reviewer note (confirmed, severity lowered):* The mechanism is described correctly - QUIET_PLIES_FOR_DRAW is 80 and quietPlies moves once per ACTION, so with N mandatory boards a turn burns N of them - but the framing as a rules bug does not survive a check against the documentation, which my task says to prefer over intuition. The code comment defines a ply as 'one move by one player', the README says 'Forty quiet moves each with no capture, crowning or travel is a draw', and in this game a move is an action on one board, not a whole turn; on that reading 80 plies IS forty moves each, and the game-over sheet's 'Forty moves each without a capture, a crowning, or a time travel' is literally true rather than 'something untrue' as the finding claims. The behaviour is also pinned by an existing test that steps quietPlies action by action, so it is deliberate. What remains is a design judgement (a ten-timeline endgame reaches the threshold in four turns each, and the draw can land mid-turn because the check at line 325 precedes resolveTurn) and a note that more boards also mean more chances to reset the counter, which pushes the other way. Worth a design discussion and possibly a README clarification; not a defect.

### REL-3 · seekTo's promise is left unhandled inside a synchronous try/catch, so audio errors surface as unhandled rejections

**Severity:** Info (reported as low, adjusted after review) · **Category:** reliability · **Effort:** trivial · **Where:** `src/app/sound.ts:40`

playSound is a synchronous function wrapped in try/catch, but expo-audio's `AudioPlayer.seekTo` returns a Promise. A synchronous catch cannot catch its rejection, so a failure (player not yet loaded on the very first tap, source still decoding, player released) becomes an unhandled promise rejection logged by RN rather than the silent no-op the comment promises. `play()` is also called without awaiting the seek, so a rapid second tap can replay from the previous position instead of restarting the sample.

Evidence:

```
src/app/sound.ts:27-44  `export function playSound(name: SoundName): void {\n  if (!enabled) return;\n  try { ... player.seekTo(0);\n    player.play();\n  } catch {\n    // No audio available; the game is fine without it.\n  }\n}`
```

**Recommendation.** Chain instead of ignoring: `void Promise.resolve(player.seekTo(0)).then(() => player.play()).catch(() => {});` (or keep the fire-and-forget play but add `.catch(() => {})` to the seek). While in this file, note that `interruptionMode` at line 32 is the iOS key - pass `interruptionModeAndroid` too if Android mixing matters. sound.ts is byte-identical in multidconnect4.

*Reviewer note (confirmed, severity lowered):* The mechanism is right - expo-audio's AudioPlayer.seekTo returns a Promise, a synchronous try/catch cannot catch its rejection, and the surrounding comment does promise a silent no-op - but the consequence is smaller than 'reliability, low' suggests. Nothing user-facing breaks: React Native does not crash on an unhandled rejection, so the visible effect is a LogBox warning in development and nothing at all in a release build, and the audio path is already best-effort by design (setAudioModeAsync on line 32 is deliberately fire-and-forget with its own .catch). The 'rapid second tap replays from the previous position' point is plausible but speculative; I could not check expo-audio's actual seek semantics because node_modules is not installed here. Worth the one-line fix, not worth a reliability rating. sound.ts is byte-identical in multidconnect4 (verified with diff).

### BUG-7 · Malformed actions escape as raw Error text shown to the player

**Severity:** Info (reported as low, adjusted after review) · **Category:** bug · **Effort:** trivial · **Where:** `src/engine/multiverse.ts:113`

getTimeline throws a plain Error, and assertPending calls it before any validation, so an action with a missing or out-of-range `timeline` produces `Error: no timeline undefined` rather than an IllegalAction. useGame's catch distinguishes the two and renders anything that is not an IllegalAction with `String(e)`, so that raw developer string is displayed in the hint row where a player expects a sentence. I hit this while fuzzing the engine with a slightly malformed action object. It is cosmetic in normal play (the UI only builds well-formed actions) but it is the failure mode for anything coming from a share code or an old save, i.e. exactly the paths where a clear message matters.

Evidence:

```
src/engine/multiverse.ts:112-116  `export function getTimeline(state: GameState, id: number): Timeline {\n  const tl = state.timelines[id];\n  if (!tl) throw new Error(\`no timeline ${id}\`);`
src/ui/useGame.ts:136-139  `} catch (e) {\n        feedback.nope();\n        setError(e instanceof IllegalAction ? e.message : String(e));\n      }`
Observed while fuzzing: `Error: no timeline undefined  at getTimeline (multiverse.ts:113)  at assertPending (multiverse.ts:231)  at applyAction (multiverse.ts:274)`
```

**Recommendation.** Validate the action shape at the top of applyAction and raise IllegalAction for anything malformed (`if (!Number.isInteger(action.timeline) || !state.timelines[action.timeline]) throw new IllegalAction('that board does not exist')`), and have useGame show a generic 'Something went wrong with that move.' for non-IllegalAction errors instead of String(e).

*Reviewer note (confirmed, severity lowered):* The two halves of the mechanism are real: getTimeline throws a plain Error, assertPending calls it before any other validation, and useGame renders `String(e)` for anything that is not an IllegalAction. What is wrong is the reachability argument that carries the severity. The finding says this 'is the failure mode for anything coming from a share code or an old save' - it is not: share.ts:40-44 wraps every applyAction call in its own try/catch and converts ANY throw, TypeError included, into the friendly 'That code contains a move that is not legal.', so a malformed action in an imported code can never reach the hint row. The UI itself only ever constructs well-formed actions (pressSquare/focusBoard/endTurn/the bot), and a corrupt restored save fails earlier and harder at GameScreen.tsx:242 (that is REL-2, a crash, not a bad message). So this is only observable by hand-crafting an action object, i.e. while fuzzing the engine, which is what the auditor was doing. Cosmetic; the guard is still worth adding as defence in depth.

### SUPPLY-1 · expo-sharing is a declared dependency that is never imported

**Severity:** Info (reported as low, adjusted after review) · **Category:** supply-chain · **Effort:** trivial · **Where:** `package.json:11`

`expo-sharing` is listed in dependencies but there is no `import ... from 'expo-sharing'` anywhere in the source - ShareModal uses expo-clipboard and React Native's own `Share` API instead. It is therefore a native module shipped into every iOS and Android build for nothing, plus an extra config-plugin in the prebuild graph. It is also one of the two direct packages named in the audit. Note for accuracy: removing it will NOT clear the 11 moderate advisories - every one of them roots in the same uuid bug (GHSA-w5hq-g745-h8pq, missing buffer bounds check in v3/v5/v6) reached through xcode -> @expo/config-plugins, and `expo` itself pulls that chain. Those are build/prebuild-time only and never execute in the shipped app, so the audit output is noise here rather than a shipped vulnerability.

Evidence:

```
package.json:11  `"expo-sharing": "~57.0.18",`
`grep -rn "expo-sharing\|Sharing" src App.tsx` -> no matches
src/ui/ShareModal.tsx:1-3  `import * as Clipboard from 'expo-clipboard';` ... `import { Modal, Platform, ScrollView, Share, ... } from 'react-native';`
audit JSON: all 11 advisories via `@expo/config-plugins -> xcode -> uuid` (GHSA-w5hq-g745-h8pq, moderate).
```

**Recommendation.** Drop expo-sharing from package.json and refresh the lockfile. For the remaining advisories, either wait for an Expo release that bumps xcode/uuid or add an npm `overrides` entry pinning uuid to a fixed major; either way document in the README that the finding is build-time only so a future audit does not re-litigate it.

*Reviewer note (confirmed, severity lowered):* The fact is right - I re-ran the grep and there is no import of expo-sharing anywhere in src/, App.tsx or index.ts; ShareModal uses expo-clipboard plus React Native's own Share - but an unused declared dependency is build bloat and hygiene, not a security or reliability issue, so low overstates it. The auditor's own caveat is the important part and I confirmed it from the lockfile: there is exactly one uuid in the tree, uuid@7.0.3, pulled in by xcode@3.0.1 under @expo/config-plugins@57.0.9, which runs at prebuild time and is not part of the shipped JS bundle, so the advisory count is not a shipped vulnerability. Removing expo-sharing will not change that count.

### SUPPLY-2 · No LICENSE, SECURITY.md, CODEOWNERS or Dependabot in a repo that ships to app stores

**Severity:** Info · **Category:** supply-chain · **Effort:** trivial · **Where:** `README.md:1`

The repository has no LICENSE file, so the default is all-rights-reserved and nobody (including a future you) has a stated right to reuse the engine the README explicitly suggests reusing ('the rules can be tested and reused'). There is no SECURITY.md, so a finder has no disclosure channel for an app that has store bundle identifiers configured in app.json. There is no Dependabot configuration, so the uuid/xcode chain in SUPPLY-1 will not be picked up automatically when Expo publishes a fix, and no CODEOWNERS. package.json is correctly marked `private: true`, so npm publication is not a risk.

Evidence:

```
`git ls-files` shows no LICENSE, no SECURITY.md, no .github/dependabot.yml, no CODEOWNERS.
app.json:13  `"bundleIdentifier": "com.platteration.multidcheckers"` and app.json:16 `"package": "com.platteration.multidcheckers"`  // a shipping target
package.json:34  `"private": true,`
```

**Recommendation.** Add a LICENSE (MIT matches the reuse the README invites), a short SECURITY.md pointing at an email or GitHub private advisories, and .github/dependabot.yml with `npm` and `github-actions` ecosystems on a monthly cadence. All four are missing from the sibling multidconnect4 as well.

## Upgrades

| Value | Effort | Upgrade | Now | Move to |
|---|---|---|---|---|
| high | medium | Extract the code shared with multidconnect4 into one package | Two repos with the same 65-file layout. 23 first-party source files (~1,150 LOC) are byte-identical: all 12 of src/app/ (base64, entitlements, feedback, links, persist, progress, purchases, settings, setup, sound, stats, theme = 568 LOC), 7 of src/ui/ (ExtrasModal, MenuModal, PuzzleResultModal, PuzzlesModal, ReplayBar, StatsModal, WelcomeModal = 479 LOC), App.tsx, index.ts, src/engine/index.ts, src/engine/__tests__/puzzles.test.ts, plus tsconfig.json, eas.json, .github/workflows/ci.yml and .gitignore. Eight more differ only by a product string: src/engine/types.ts (1 line: PLAYER_NAMES, which is dead code anyway), src/app/share.ts (the '5DCK.'/'5DC4.' prefix and one error message), src/ui/ShareModal.tsx (the placeholder), src/ui/SettingsModal.tsx (one hint + a swatch accessor), src/ui/NewGameModal.tsx (LEVEL_HINTS), package.json (name), app.json (name/slug/scheme/bundle ids), CLAUDE.md. | Stage 1 (small, no abstraction needed): create one repo/package -- npm workspaces monorepo with packages/multiverse-app + apps/checkers + apps/connect4, or a private package pinned by commit ('github:Platteration/multiverse#<sha>') if you want to keep two deployable repos. Move the 23 identical files in verbatim and parameterise the 8 near-identical ones with props/constants (share.ts takes {prefix, gameName}; ShareModal takes placeholder; NewGameModal takes levelHints; SettingsModal takes the hint text and a swatch selector). Stage 2 (medium): src/ui/Modals.tsx (Button + backdrop/sheet identical; only RulesModal copy differs -> take rules as children), src/ui/MiniBoard.tsx (grid identical; take a renderCell prop), src/ui/MultiverseMap.tsx (18-line diff; take an isFinished(board) predicate and a MiniBoard render prop), src/ui/theme.ts (DARK/LIGHT bases, spacing, radius identical; SKINS/PIECE_SETS stay per-game), src/ui/useGame.ts (history/undo/startNew/startPuzzle/load/restart/goToWaitingBoard/nextWaitingBoard/canUndo/error identical; only pressSquare + Selection differ), src/ui/GameScreen.tsx shell (header, status pill, landscape split, deep-link handling, autosave, bot loop, welcome demo, all ten modal mounts). Stage 3 (large, optional): src/engine/multiverse.ts -- Timeline, latestTurn/latestBoard/latestRef, getBoard, isLatest, maxTurn, pendingTimelines, presentTurn, mandatory/optionalTimelines, canEndTurn, isPending, travelTargets, isTravelTarget, resolveTurn and passTurn are structurally identical across the two games; only the Action union and the win/draw predicates differ. A createMultiverse<Board, Move>(ops) taking {initialBoard, legalActionsOn, applyToBoard, travelSlotFree, winnerOn, madeProgress} would leave each repo with just its board rules. If Metro workspace config is a worry, do Stage 1 only: it already removes ~1,150 duplicated lines from each repo and means every fix in this report is applied once. |
| high | small | No linter or formatter at all | package.json devDependencies are only @types/jest, @types/react, jest, jest-expo, typescript. There is no eslint, no eslint-config-expo, no prettier, and no config file. The code already contains three hand-written '// eslint-disable-next-line react-hooks/exhaustive-deps' comments (GameScreen.tsx:94, :223; CheckerBoard.tsx:35; MultiverseMap.tsx:66) for a rule that nothing enforces. | Add eslint + eslint-config-expo (flat config) and prettier, wire 'npm run lint' and 'npm run format:check', and add them to CI. react-hooks/exhaustive-deps in particular would have flagged the stale-dependency bug in the bot effect. Do it in the shared package so both repos get it. |
| high | small | Persisted game grows quadratically and can silently exceed AsyncStorage limits | GameScreen.tsx:186-192 saves {version:2, history, setup} where history is every GameState, and every GameState carries every board of every timeline. One 8x8 board serialises to roughly 850 bytes, so a 40-move single-timeline game is already ~680 KB and a branching game is several MB. It is JSON.stringify'd and written 250 ms after every move, and persist.ts:19-25 swallows the failure, so on Android (default 2 MB per value / 6 MB DB) a long game just stops saving with no sign. | Persist the actions, not the states: src/app/share.ts already has actionsOf()/encodeGame()/decodeGame(), so store {version:3, code: encodeGame(history, setup)} and replay on load in App.tsx. That is O(moves) instead of O(moves^2), it validates the save through the engine for free (a corrupt value throws and you fall back to a new game), and it removes the need for looksLikeSavedGame's shape guess in setup.ts. Keep the v2 reader for one release to migrate. |
| high | small | Light theme fails WCAG AA on primary buttons, selected chips and notes | theme.ts LIGHT.travel is #0a9fc6 and is used as the primary button background (Modals.tsx buttonPrimary) and the selected-chip background (SettingsModal.tsx choiceOn) with label colour colors.background (#f3f4fb): 2.82:1, against the 4.5:1 AA requirement for 14 px and 12 px bold text. Affects 'Start', 'Done', 'Got it', 'End turn', 'Share...', 'Back to game' and every selected Choice pill. colors.travel as note text on white panel (ShareModal/ExtrasModal note, 12 px) is 3.09:1; colors.success as 14 px 'You own the Supporter pack' is 3.62:1; colors.warning at 14 px is 3.99:1; the dark-theme red player accent on panel is 4.04:1 at 11-12 px. | Darken the light-mode travel/success/warning tokens (e.g. travel #0b7d9c gives 4.6:1 against #f3f4fb, success #17703e, warning #8f5600) or set primary button text to a dark ink instead of colors.background. Then pin it with a test: the sibling repos randostats and tvsham both have a palette test that checks every text pairing in both schemes against AA -- add src/ui/__tests__/theme.test.ts doing the same over buildTheme() x {dark,light} x all five SKINS x all four PIECE_SETS. |
| high | small | Screen-reader and motion accessibility gaps | Six <Switch> controls (SettingsModal.tsx:30,33,38 and GameScreen.tsx:455,458,461) have no accessibilityLabel -- the label Text is a sibling, not associated, so VoiceOver/TalkBack announce an unlabelled switch. The status pill and the hint/error line (GameScreen.tsx:328-331, 355-358) carry the entire game state in text but have no accessibilityLiveRegion / accessibilityRole='alert', so a screen-reader user is never told 'Red wins' or 'you must capture'. No Modal sets accessibilityViewIsModal, so iOS VoiceOver can reach the board behind an open sheet. grep for AccessibilityInfo/reduceMotion returns zero hits while there are 10 Animated.* call sites (the piece pop in CheckerBoard.tsx:31-36 and the time-travel flight in MultiverseMap.tsx:53-67). | Give Row an accessibilityLabel it forwards (or wrap the row in accessible + accessibilityRole='switch'), add accessibilityLiveRegion='polite' to the status pill and role='alert' to the error line, add accessibilityViewIsModal to every Modal's sheet, and read AccessibilityInfo.isReduceMotionEnabled() once into a context that CheckerBoard and MultiverseMap consult before animating. |
| high | small | CI: no lint, no audit, unpinned actions, no permissions block, duplicate runs | .github/workflows/ci.yml is 20 lines: checkout@v4 + setup-node@v4 (tags, not SHAs), npm ci, typecheck, test --ci, expo export --platform web. It triggers on 'push:' with no branch filter and on 'pull_request:', so every PR commit runs twice. There is no permissions: block (the default GITHUB_TOKEN scope applies), no concurrency group, no lint step (nothing to lint yet), no npm audit, no coverage, and no check that the iOS/Android bundle builds -- only web. | Pin both actions to full commit SHAs with a version comment, add 'permissions: contents: read', add a concurrency group cancelling in-progress runs per ref, restrict the push trigger to your main branch, and add steps for lint, 'npm audit --audit-level=high', 'npx expo export --platform ios --platform android' (catches native-only import breaks that the web export misses, as the drawdraw sibling does), and 'npx expo install --check' to flag dependency versions that drift from the SDK's expected set. |
| high | small | app.json has no plugins block, no splash config, no privacy manifest | app.json is 30 lines: name/slug/version/scheme/orientation/icon/userInterfaceStyle/backgroundColor, ios.bundleIdentifier + supportsTablet, android.package + adaptiveIcon + predictiveBackGestureEnabled:false, web.favicon + bundler. There is no "plugins" array at all, so assets/splash-icon.png is committed but never referenced -- the app launches on a default blank splash. There is no ios.privacyManifests, although the app uses AsyncStorage (NSUserDefaults, required-reason API category CA92.1), which Apple requires be declared. android.permissions is unset, so the merged manifest keeps every permission RN's defaults pull in. | Add "plugins": [["expo-splash-screen", { "image": "./assets/splash-icon.png", "backgroundColor": "#0d0f1f", "imageWidth": 200 }]] so the committed asset is actually used, add ios.privacyManifests.NSPrivacyAccessedAPITypes with the UserDefaults entry and reason CA92.1, and set android.permissions to the minimum list (likely [] plus VIBRATE for expo-haptics) so the store listing does not advertise permissions you do not use. Also reconsider predictiveBackGestureEnabled:false: every sheet already implements onRequestClose, so predictive back should work and Android is pushing hard toward it. |
| medium | trivial | npm audit: 11 moderate, all from uuid <11.1.1 via the xcode config plugin | 11 moderate advisories, all chaining to GHSA-w5hq-g745-h8pq (uuid missing buffer bounds check in v3/v5/v6) reached through xcode <- @expo/config-plugins <- @expo/cli and expo-sharing. Build-time only (prebuild/Xcode project manipulation), not shipped in the app bundle. npm's suggested fix is to downgrade expo to 46, which is not a fix. | Add an npm override so the transitive resolution moves without touching Expo: "overrides": { "uuid": "^11.1.1" } in package.json, then re-run npm audit to confirm it goes to zero. Do not act on the isSemVerMajor downgrade suggestion. |
| medium | trivial | No Dependabot or Renovate | No .github/dependabot.yml and no renovate.json. Expo SDKs move roughly three times a year and the whole dependency tree moves with them; nothing here will tell you. | Add .github/dependabot.yml with two ecosystems: npm (weekly, grouped, ignoring the expo-* and react-native majors so SDK bumps stay a deliberate 'npx expo install --fix' exercise) and github-actions (so the SHA pins above get refreshed). Same file in both sibling repos, or once in the shared repo. |
| medium | trivial | Missing LICENSE, SECURITY.md, CHANGELOG, CONTRIBUTING | None of the four exist; package.json has no license field and is "private": true, while README.md links the repo publicly on GitHub and the sibling multidconnect4. | Add a LICENSE (MIT or a source-available licence if you intend to sell the app) and set package.json license to match. Add a short SECURITY.md pointing at a contact -- the app parses untrusted share codes and deep links, so it is the right place to say how to report a bad one. A CHANGELOG becomes load-bearing the moment you ship to a store with EAS autoIncrement. |
| medium | medium | No OTA updates channel and no store metadata path | eas.json has development/preview/production build profiles and appVersionSource: remote with autoIncrement, which is good, but there is no expo-updates dependency, no updates/runtimeVersion block in app.json, and no eas.json submit configuration beyond an empty "production": {}. README also says the icons in assets/ are generated and must be replaced with real artwork before release. | Add expo-updates with runtimeVersion: { policy: 'appVersion' } and channels wired to the preview/production profiles, so a copy fix or a bot tuning tweak ships without a store review. Fill in submit.production (ascAppId, appleTeamId, Android service account path via EAS secrets). Replace the generated icons, and add the store copy (description, keywords, screenshots per device class) to the repo so a release is reproducible. |
| medium | trivial | Jest testMatch cannot pick up component tests | package.json jest.testMatch is ["**/__tests__/**/*.test.ts"] -- .tsx is not matched, so no React component test can ever run even though jest-expo and react-test-renderer are already installed. Every one of the five test files lives under src/engine/__tests__ and covers only the engine plus base64/share. | Change testMatch to "**/__tests__/**/*.test.@(ts\|tsx)", add @testing-library/react-native, and add coverage thresholds so the untested surface stops growing. Then add the tests listed in the code-quality section. |
| medium | medium | TypeScript strictness stops at strict:true | tsconfig.json extends expo/tsconfig.base and sets only strict:true and types:["jest"]. The code indexes arrays constantly -- board.cells[sq], state.timelines[ref.timeline], tl.boards[ref.turn - tl.startTurn], marks[marks.length-1], state.lastCreated[1] -- and papers over it with non-null assertions (getBoard(next, ref)!, pieceAt(board, sq)!, pieceAt(board, action.move.from)!). | Turn on noUncheckedIndexedAccess, noImplicitOverride, noFallthroughCasesInSwitch and useUnknownInCatchVariables. noUncheckedIndexedAccess will surface real cases (MultiverseMap.tsx:52-57 indexes lastCreated[1] guarded only by a length check; puzzles/index.ts builds GameStates by hand). Land it as one mechanical pass, since the engine is only ~800 lines. |
| medium | medium | Web build is exported in CI but never run, and is not a PWA | CI runs 'npx expo export --platform web' and checks only that it exits zero. app.json's web block sets favicon and bundler only -- no name, shortName, themeColor, backgroundColor, display or startUrl, and no service worker. README advertises '?code=' web links as a real way to share a game, so the web build is a shipping surface, not just a smoke test. | Add the web manifest fields to app.json, and add a Playwright smoke test that serves the exported dist/, loads it with a ?code= share link, asserts the board renders and a move can be made, and fails on any console error -- exactly the pattern the drawdraw (e2e/smoke.mjs) and simplacad (test/e2e.mjs) siblings use, including skipping itself with exit 0 when Playwright is absent so a bare checkout still passes. That also gives you a regression test for the share-code path, which is currently only covered at the pure-function level. |
| medium | small | No error boundary or crash reporting | App.tsx mounts five providers and GameScreen with no error boundary. A corrupt saved game (setup.ts:25 looksLikeSavedGame only checks version and that history is a non-empty array before feeding the object straight into useGame) or a malformed deep link produces a render-time throw and a blank screen with no recovery path, and there is no telemetry to learn it happened. | Add an ErrorBoundary around GameScreen that catches, clears keys.game via removeKey (already exported and currently used only for the empty-history case), and offers 'Start a new game'. If you want signal from real devices, add an opt-in toggle in the Feel/Seeing settings section that enables a crash reporter -- opt-in, since the app currently collects nothing and that is a selling point worth keeping explicit in a PRIVACY.md. |
| low | trivial | No Node version pin outside CI | CI hardcodes node-version: 22. There is no .nvmrc, no .node-version, and no "engines" field in package.json, so a local checkout can silently be on a different major from the one CI validates. | Add .nvmrc containing 22 and "engines": { "node": ">=22" } to package.json, and have the workflow read node-version-file: .nvmrc so the two cannot drift. |
| low | medium | No i18n scaffolding | Every string is inline in a component: the eight Rule blocks in Modals.tsx, the nine-branch hint ladder in GameScreen.tsx:285-308, LEVEL_HINTS in NewGameModal.tsx, the six puzzle brief/hint pairs, narrate.ts sentences, and every Settings label. | If reaching beyond English is on the table, do the extraction before the string count doubles: a flat strings module with typed keys (no runtime library needed for one or two locales) hooked into the shared package, so both games translate once. Note that narrate.ts builds sentences by concatenation, so it needs interpolation-with-parameters rather than plain lookups. |

- **Extract the code shared with multidconnect4 into one package** (high value, medium, `src/app/, src/ui/, src/engine/multiverse.ts`). undefined
- **No linter or formatter at all** (high value, small, `package.json`). undefined
- **Persisted game grows quadratically and can silently exceed AsyncStorage limits** (high value, small, `src/ui/GameScreen.tsx:186, src/app/setup.ts`). undefined
- **Light theme fails WCAG AA on primary buttons, selected chips and notes** (high value, small, `src/ui/theme.ts:59-72, src/ui/Modals.tsx:161, src/ui/SettingsModal.tsx:150`). undefined
- **Screen-reader and motion accessibility gaps** (high value, small, `src/ui/SettingsModal.tsx:89-101, src/ui/GameScreen.tsx:328, src/ui/CheckerBoard.tsx:31, src/ui/MultiverseMap.tsx:53`). undefined
- **CI: no lint, no audit, unpinned actions, no permissions block, duplicate runs** (high value, small, `.github/workflows/ci.yml`). undefined
- **app.json has no plugins block, no splash config, no privacy manifest** (high value, small, `app.json`). undefined
- **npm audit: 11 moderate, all from uuid <11.1.1 via the xcode config plugin** (medium value, trivial, `package.json`). undefined
- **No Dependabot or Renovate** (medium value, trivial, `.github/dependabot.yml`). undefined
- **Missing LICENSE, SECURITY.md, CHANGELOG, CONTRIBUTING** (medium value, trivial, `LICENSE`). undefined
- **No OTA updates channel and no store metadata path** (medium value, medium, `eas.json, app.json`). undefined
- **Jest testMatch cannot pick up component tests** (medium value, trivial, `package.json`). undefined
- **TypeScript strictness stops at strict:true** (medium value, medium, `tsconfig.json`). undefined
- **Web build is exported in CI but never run, and is not a PWA** (medium value, medium, `.github/workflows/ci.yml, app.json`). undefined
- **No error boundary or crash reporting** (medium value, small, `App.tsx, src/app/setup.ts:25`). undefined
- **No Node version pin outside CI** (low value, trivial, `package.json`). undefined
- **No i18n scaffolding** (low value, medium, `src/app/narrate.ts, src/ui/GameScreen.tsx:285`). undefined

## Features worth adding

- **A bot that actually searches** (high value, large). bot.ts is one ply: enumerateActions -> applyAction -> evaluate, minus bestCaptureValue of the opponent's single best reply. It never sees a two-move combination, and time travel is judged by a flat '-6' constant (bot.ts:140). Replace chooseAction with an iterative-deepening alpha-beta over whole turns (a turn is a sequence of actions across every waiting board, so the node is a turn, not a ply), time-boxed to ~800 ms with a transposition table keyed on a hash of all latest boards + toMove. Keep the current chooseAction as level 1-2 and add a fourth level on top. Because the search runs on the JS thread, chunk it: yield via InteractionManager or a setTimeout ladder so the map keeps scrolling, and drive it from the existing bot effect at GameScreen.tsx:216-224 (which should call bot.ts's own playTurn rather than re-implementing the loop). Add a self-play harness (scripts/simulate.ts, mirroring the chesscheatser sibling) so level strength is measured, not guessed.
- **Interactive tutorial for the multiverse rules** (high value, medium). Today the teaching is a three-page WelcomeModal, a static eight-block RulesModal, and a one-line hint ladder. None of it makes you do the thing. Add a Lesson type beside Puzzle in src/puzzles/: a scripted starting multiverse plus an ordered list of expected actions, each with a prompt and a spotlight target (a square, or a board ref on the map). Add setup.mode 'lesson' to GameSetup, have useGame reject any action that is not the expected one (surfacing the existing error line), and reuse PuzzlesModal/PuzzleResultModal for the list and the completion sheet. Four lessons cover it: play a board, play two waiting boards, send a piece back, and use travel to escape a forced jump. Hook the entry point into the WelcomeModal's last page, replacing 'Try a puzzle first'.
- **Multi-move and survive puzzles, plus a puzzle miner** (high value, medium). The Puzzle type already supports goal:'survive' (puzzles/index.ts:21) and multi-action solutions, GameScreen.tsx:199-208 implements both branches, PuzzleResultModal takes a 'survived' prop, and puzzles.test.ts has a whole survive branch -- but all six shipped puzzles are goal:'win' with within:1, so none of that code has ever run against real content. Ship at least one survive puzzle and two two-movers to exercise it, and add scripts/mine-puzzles.ts (as chesscheatser does) that self-plays random multiverses, keeps positions with exactly one forced win within N actions, and emits them as a JSON pack -- which is also the natural shape for the 'future puzzle packs' the Supporter pack already promises in ExtrasModal.
- **Async play without copy-paste in both directions** (high value, large). Play-by-message works but requires the recipient to open the app, open the menu, open Share, paste, and load. Three concrete steps, in increasing cost: (1) pack the payload -- share.ts encodes JSON of the full Action list, where a move is {type,timeline,move:{from,path,captures}}; a binary packing (timeline 5 bits, square 6 bits, path/capture counts) through the existing base64 alphabet would cut code length several-fold and make the link paste-able in any chat without wrapping; (2) add a 'Send it back' button on the share sheet that re-shares immediately after your move, and register an https universal/app link (ios.associatedDomains + android.intentFilters) so the ?code= web link opens the installed app instead of the browser; (3) optionally a stateless relay -- a tiny Worker storing {gameId -> latest code} plus expo-notifications, behind a setting, so neither player has to remember to send. Hooks: src/app/share.ts, src/app/links.ts, src/ui/ShareModal.tsx, src/ui/GameScreen.tsx:110-122.
- **A games library instead of one autosaved game** (high value, medium). persist.ts has a single 'game.v1' key, so starting a bot game destroys the pass-and-play game in progress -- and MenuModal already guards 'New game' with a 'the game in progress will be lost' confirmation, which is the affordance admitting the problem. Store games under 'games.v1' as a list of {id, code, setup, updatedAt, summary}, add a 'Your games' menu item listing them with a MiniBoard of the newest board, and have New Game park the current one instead of destroying it. Once games are stored as share codes (see the persistence upgrade) each entry is a few hundred bytes, so a list is cheap.
- **Move list with notation, and replay seeking from it** (medium value, small). narrate.ts already turns any state into an English sentence and ReplayBar already seeks by index, but there is no way to see the shape of a game at a glance. Add notation() beside narrate() (e.g. 'T1 c3xe5', 'T1 e5>t2 =T3') and a scrollable list panel -- in the right column on landscape, behind a menu item on portrait -- where tapping row i sets replayIndex to i. It costs almost nothing on top of what exists and it is the main thing that makes a branching game reviewable.
- **Free hint / 'show me a move' in normal play** (medium value, small). Hints exist only in puzzle mode (GameScreen.tsx:359-360). In a normal game a new player looking at five waiting boards has no idea where to start. Add a hint button that runs chooseAction at level 2 for the human's side and highlights the chosen piece and destination (or the target board when it picks a travel), with the reason drawn from narrate(). This must be free -- README and ExtrasModal both promise nothing affecting outcomes is ever sold -- so gate it on a settings toggle, not on entitlements.
- **Daily multiverse challenge** (medium value, medium). Stats already track games, wins per bot, travels, biggest multiverse and longest game, but nothing brings a player back tomorrow. Add a daily.ts (the chesscheatser sibling has exactly this) that derives a seeded starting position and rule set from the date, gives everyone the same puzzle-like target ('win within 6 actions against Paradox'), and produces a spoiler-free shareable result line. It needs no server: the seed is the date, and the result string is already expressible with the share-code machinery.
- **Redo, and undo that survives a reload** (medium value, small). useGame.undo (useGame.ts:206-221) pops history and, against a bot, rewinds through the bot's replies -- but there is no redo, so an accidental undo is unrecoverable, and undo state is lost on relaunch because only the history array is saved. Keep a forward stack in useGame, expose canRedo/redo, and put both on the header next to Undo. With actions-based persistence this is free: the saved code holds the full action list and a cursor.
- **Screen-reader board readout and map summary** (medium value, medium). The board exposes per-square labels and the map exposes per-board labels, but there is no way to hear the position as a whole, and a 10-timeline multiverse is 200+ focusable buttons to swipe through. Add a 'Read the board' action (accessibilityActions on the board container) that announces material and piece squares per side, and a map summary announcing 'three boards waiting for you: Timeline 1 turn 8, Timeline 3 turn 6...' with a way to jump straight to each. This pairs with the live-region fix and turns the app from technically-labelled into actually playable without sight.
- **Share the multiverse as an image** (low value, medium). The map is the whole visual identity of the game and there is no way to show it to anyone. Render the current multiverse to a PNG (react-native-view-shot, or a canvas path on web) with the timelines, branch connectors and the winning board marked, and offer it through the existing expo-sharing dependency alongside the game code. The ambientnoiser sibling does exactly this with card.js and it is the cheapest marketing the app has.

## Code quality

- **Opening the replay during a bot game makes the bot play a move computed from a past position** (high value, trivial, `src/ui/GameScreen.tsx:216-224`). The bot effect reads `state`, which line 81 defines as `replaying ? game.history[replayIndex] : game.state`, and `humanTurn` (line 83) is forced false whenever replaying. So entering replay while the bot is to move runs chooseAction on the replayed board and passes the result to game.play, which applies it to the live game -- a legal-by-coincidence move played for the wrong position, or a spurious red 'the game is over' error when you tap 'Watch the replay' after losing (replayIndex 0 has status 'playing', the live state does not). Fix: bail out of the effect when replaying, and read game.state rather than the replay alias. This is the clearest argument for the missing react-hooks/exhaustive-deps lint rule, which the effect suppresses by hand.
- **commit() derives the next state outside the functional updater** (high value, small, `src/ui/useGame.ts:117-142`). `const next = applyAction(state, action)` uses the render-time `state`, then `setHistory((h) => [...h, next])` appends it regardless of what h's last element actually is. Two commits batched in one tick (a double tap on a destination square, or a human tap landing in the same batch as the bot's setTimeout callback) push two siblings of the same parent as if they were sequential. Nothing throws, but the history is then not a legal replay, so encodeGame produces a code that decodeGame rejects with 'That code contains a move that is not legal' -- and the autosave stores the same broken sequence. Fix: compute inside the updater from h[h.length-1], and move the feedback/focus side effects to an effect keyed on the resulting state.
- **React.memo on MiniBoard never hits, so the whole map re-renders on every state change** (high value, small, `src/ui/MiniBoard.tsx:22, src/ui/MultiverseMap.tsx:163`). MiniBoard is wrapped in React.memo, but MultiverseMap passes `onPress={() => onPressBoard(ref)}` -- a fresh closure on every render -- so the memo comparison always fails. Every board in the multiverse re-renders 64 <View>s on every tap, hover of focus, or bot move. A 10-timeline, 30-turn game is ~300 boards, i.e. ~19,000 views rebuilt per interaction, and MultiverseMap renders every board with no windowing. Fix: change the prop to `onPress: (ref: BoardRef) => void` plus a `boardRef` prop so the handler identity is stable (or memoise per timeline id), and consider a FlatList/windowing pass on the timeline rows once games get long.
- **GameScreen.tsx is 569 lines doing nine unrelated jobs** (high value, medium, `src/ui/GameScreen.tsx`). One component holds: rules derivation from settings, deep-link listening (110-122), the welcome demo multiverse and its three pages (125-166), the autosave debounce (186-192), the bot turn loop (216-224), puzzle solved/failed derivation (197-215), the stats recording guard (88-95), the responsive cell-size maths (231-239), a nine-branch hint ladder (285-308), and the mounting of ten modals. Split it: useDeepLinkCode(onCode), useAutosave(history, setup), useBotTurn(game, bot), usePuzzleOutcome(setup, state, movesUsed) as hooks; welcomePages into its own module; the hint ladder into a pure hintFor(state, selection, ...) function that can be unit-tested; and a <GameModals> component taking one props object. Most of the remainder is then shell shared with multidconnect4.
- **Nothing outside the engine is tested** (high value, medium, `src/engine/__tests__/`). Five test files, all engine-level, plus base64/share. Untested and easy to test as pure functions: app/stats.ts summarise (win attribution per bot key, mostTimelines/longestGame maxima, the local-mode human===null path); app/links.ts codeFromUrl (query, fragment, /load/<code> path form, percent-decoding, and a URL with no code); app/setup.ts looksLikeSavedGame + normaliseSaved (the v1->v2 migration, and rejection of junk); app/narrate.ts (each action type, the endTurn wording, the win/draw suffixes); ui/theme.ts buildTheme (unknown skin/piece ids fall back to index 0, plus the contrast assertions above). Untested and worth a component test once testMatch accepts .tsx: ui/useGame.ts -- specifically undo rewinding through bot replies (useGame.ts:212-217), pressSquare's longest-chain tie-break when several jump chains end on the same square (:180-185), focus following firstPending after a commit, and movesUsed counting in puzzle mode. Also add an engine property test: replaying actionsOf(history) through newGame must reproduce the final state for a few hundred random bot-vs-bot games -- that single test would have caught the commit() ordering bug.
- **The 'new' badge is invisible in both themes** (medium value, trivial, `src/ui/MiniBoard.tsx:89-97, src/ui/MultiverseMap.tsx:150-151`). styles.badge defaults its background to colors.panelRaised and badgeText is always colors.background; the background is only overridden when a ring colour is supplied. MultiverseMap's `isNew` branch sets badge='new' and leaves ring null, so the text is #0d0f1f on #22264a (1.9:1) in dark and #f3f4fb on #e9ebf8 (1.08:1) in light -- effectively blank. Fix: give the badge an explicit readable foreground when no ring is set (colors.text on panelRaised), and add the badge pairings to the palette test suggested above.
- **The bot turn loop is implemented twice, and the engine's version is test-only** (medium value, small, `src/engine/bot.ts:156-167, src/ui/GameScreen.tsx:216-224`). bot.ts exports playTurn (play out the bot's whole turn, guard 64, return every intermediate state) and it is referenced nowhere in src outside its own definition -- only bot.test.ts uses it. GameScreen re-implements the same loop with a 600 ms setTimeout and a re-entrant effect. That means the paced UI loop and the tested loop can diverge, and it is why the replay bug above exists in one and not the other. Make GameScreen drive playTurn (or make playTurn take a per-step callback for the pacing) so there is one implementation.
- **travelTargets is recomputed from scratch inside the bot's inner loop** (medium value, medium, `src/engine/multiverse.ts:191-209, :223-227`). travelTargets walks every board of every timeline for one square. hasAnyAction calls it once per piece (up to 12), passTurn calls hasAnyAction once per mandatory timeline, applyAction ends in passTurn, and chooseAction calls applyAction for every candidate (up to MAX_CANDIDATES=60). A ten-timeline game therefore scans hundreds of thousands of boards per bot move, synchronously on the UI thread -- and this is the real cost of the 600 ms bot pause, not the evaluation. Fix: build the set of past boards-by-parity once per state (they are immutable) and index each board's occupied squares, so travelTargets becomes a set lookup; hasAnyAction can also short-circuit on the first piece with a target.
- **Untrusted share payloads are replayed without shape validation** (medium value, small, `src/app/share.ts:28-47`). decodeGame checks the prefix, that JSON parses, that payload.v === 1 and that payload.a is an array -- then spreads payload.r straight into newGame (so arbitrary attacker-chosen keys land in state.rules, are persisted, and are re-emitted by encodeGame) and feeds each element of payload.a to applyAction. It happens to be safe because the try/catch around applyAction swallows the TypeErrors a malformed action produces, but that is luck, not design, and the same pattern is what the ambientnoiser sibling's cleanSettings and simplacad's CadDocument.restore exist to prevent. Add a cleanRules(r) that picks only the three known booleans and a cleanAction(a) discriminating on type before replay, and test both with hostile inputs (extra keys, wrong types, huge action arrays, a path array of 10^6 entries).
- **Modal chrome is copy-pasted eight times** (medium value, small, `src/ui/Modals.tsx:163-175 and 7 sibling modal files`). backdrop ('rgba(5,6,20,0.85)', flex 1, centred, padding lg), sheet (panel background, radius lg, 1px border, padding lg) and title (22/800) are re-declared verbatim in Modals, MenuModal, NewGameModal, SettingsModal, ShareModal, ExtrasModal, PuzzlesModal, PuzzleResultModal and WelcomeModal, and the `const colors = useTheme(); const styles = useMemo(() => makeStyles(colors), [colors]);` pair appears in 14 components. Extract a <Sheet title=... onClose=...> that renders Modal+backdrop+sheet+title (and can carry accessibilityViewIsModal and the backdrop-tap-to-close that none of them implement today), and a useStyles(makeStyles) helper. Roughly 100 lines go, and every future modal gets the a11y fixes for free.
- **Undocumented tuning constants in the bot** (medium value, small, `src/engine/bot.ts:54-67, :129-149`). boardScore uses 16 for a king, 10 + advance*0.4 for a man; chooseAction subtracts bestCaptureValue * 1.1, subtracts a flat 6 for any travel, adds rng()*0.5 as a tie-break jitter, and level 1 crowns with probability 0.8. None of the numbers is explained, and nothing measures whether level 2 actually beats level 1. MAX_CANDIDATES = 60 is the only one with a comment. Name them as a documented WEIGHTS object with a one-line rationale each, and add the self-play harness so changing one is an experiment rather than a guess -- the chesscheatser sibling's scripts/simulate.ts plus its POWER_THRESHOLDS comment is the model.
- **Dead exports and a dead ternary** (low value, trivial, `src/engine/types.ts:5, src/ui/theme.ts:167, src/engine/board.ts:58, src/app/share.ts:46`). PLAYER_NAMES (types.ts:5) has no reference outside its definition -- names come from theme.playerNames -- and it is also the only line that differs from the sibling's types.ts, so deleting it makes that file shareable verbatim. playerColor (theme.ts:167) and emptyBoard (board.ts:58) are likewise defined and never used. share.ts:46 reads `payload.m === 'bot' ? { mode: 'local' } : DEFAULT_SETUP` where DEFAULT_SETUP is also { mode: 'local' } -- both branches are identical, which hides the real (undocumented) behaviour: a shared bot game silently becomes pass-and-play. Delete the dead exports and either drop the ternary or make it do something and say so in the modal.
- **Magic numbers in layout and timing** (low value, trivial, `src/ui/GameScreen.tsx:190, :221, :231-239`). 250 ms autosave debounce, 600 ms bot pause, the 1.15 landscape aspect threshold, the 0.5/0.42/0.7 width and height fractions and the 24..52 cell clamp are all inline. They are the numbers most likely to need tuning per device class (tablet, foldable, short landscape phone) and per accessibility setting, and none is named or reachable from one place. Lift them into a named layout/timing constants block, and derive the bot pause from whether the search actually took time rather than pausing a fixed 600 ms on top of it.
- **Two modules named theme, and the sound players are never released** (low value, small, `src/ui/theme.ts, src/app/theme.tsx, src/app/sound.ts:21-44`). src/ui/theme.ts (palette data + buildTheme) and src/app/theme.tsx (the React provider) invite mis-imports; rename the data module to palette.ts. In sound.ts, six AudioPlayer instances are created lazily and cached in a module-level map that nothing ever releases, so they outlive any screen and are not cleaned up on web navigation; expo-audio's player.release() should be called from an app-level teardown. Also note player.seekTo(0) returns a promise that is not awaited before play(), so rapid repeat taps can play from the wrong offset.
- **narrate() misdescribes a puzzle's opening state** (low value, trivial, `src/app/narrate.ts:12`). With no lastAction it returns 'The beginning. One board, one timeline.' -- but puzzles are hand-built multiverses (the 'twoboards' puzzle starts with two timelines and five boards) and a loaded share code's history[0] is a fresh game, so the sentence is wrong in the replay bar for any puzzle. Derive it from the state: count timelines and boards rather than asserting one of each.

## Shared across all Platteration repositories

The same gaps recur in every repository; fixing them once as a template and copying it is cheaper than fixing them fourteen times.

### CI and supply chain

1. **No workflow sets `permissions:`** (except the two Pages deploy jobs). Add `permissions: { contents: read }` at the top of every workflow so the `GITHUB_TOKEN` handed to third-party actions cannot write to the repository.
2. **No action is pinned to a commit SHA** (0 of 50 `uses:` lines across the fourteen repositories). `actions/checkout@v4` follows a movable tag; pin to the full 40-character SHA with the version in a comment, and let Dependabot bump it.
3. **No repository has Dependabot or Renovate.** Add `.github/dependabot.yml` with `npm` (or `pip`) and `github-actions` ecosystems, weekly.
4. **No CI step runs `npm audit`** (two workflows pass `--no-audit` explicitly). Add `npm audit --audit-level=high` after `npm ci`; for the Expo apps the current transitive advisories are build-time only (`uuid` via `xcode` via `@expo/config-plugins`), so gate on `high` rather than `moderate` until Expo ships the fix.
5. **`tvsham` runs `npm ci || npm install` in CI and in its Dockerfile.** The fallback silently discards the lockfile guarantee; drop it and fix the lockfile instead.
6. **`selfreportle`, `simplacad` and `phonogeometry` have no lockfile** and install Playwright ad hoc in CI. Add a `package-lock.json` (even with devDependencies only) and use `npm ci`.
7. **Enable secret scanning and push protection** in each repository's settings; nothing is committed today, and this keeps it that way.

### Repository hygiene

8. **Ten repositories have no `LICENSE`** (battleshiple, collectcollect, drawdraw, multidcheckers, multidconnect4, notenote, randostats, selfreportle, simplacad, tvsham). Without one, nobody else may legally use or contribute to the code. The siblings that have one use MIT.
9. **Only `simplacad` has a `SECURITY.md`.** Copy it to the others with a private reporting address.
10. **No repository has a `main` branch.** In all fourteen the default branch is the original `claude/...` feature branch, so branch protection, Dependabot targets and the two GitHub Pages workflows (`abientnoiser`, `chesscheatser` both trigger on `main`/`master`) all point at a branch that does not exist; those deploys have never run. Create `main` from the current branch, make it the default, and protect it.
11. **`drawdraw` is the one repository still on Expo SDK 53** (the rest are on 57). Its eight high-severity `npm audit` findings (`image-size`, `metro`) disappear with the SDK upgrade; it is also the only app not written in TypeScript and the only one pinned to Node 20 in CI.
12. **`multidcheckers` and `multidconnect4` are near-identical copies** (same branch name, same 65-file layout, same dependencies). The timeline/multiverse engine, persistence and share code should live in one shared package so fixes land in both.

### A hardened workflow to copy

```yaml
name: CI
on:
  push:
    branches: ["**"]
  pull_request:
permissions:
  contents: read
concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true
jobs:
  check:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@<full-sha> # v4
      - uses: actions/setup-node@<full-sha> # v4
        with: { node-version-file: .nvmrc, cache: npm }
      - run: npm ci
      - run: npm audit --audit-level=high
      - run: npm run lint --if-present
      - run: npm run typecheck --if-present
      - run: npm test
```

# multidcheckers — security audit (2026-09-11)

A dedicated security pass, separate from and later than the review in `REVIEW.md`. Specialist reviewers read the repository through a combined lens (L13), each required to *demonstrate* a finding rather than argue for it.

**3 findings** — 1 medium, 2 low. Every one was reproduced with command output rather than argued from reading.

## Status

Every finding below was fixed on `claude/repo-review-security-baiyud` in fd1cadb, each with a regression test that was checked by reverting the fix and confirming the test fails. The findings are kept as written so the reasoning behind each change stays with it.

These were deliberately left for a decision rather than guessed at:

- L13-3 — the render-error boundary REVIEW.md's REL-2 asks for. The storage vector that made it urgent is closed at the source, and this suite has no component-render tests to pin it with.

## Findings

### L13-1 · medium — A share code that stays inside both new caps still builds a 502-timeline, 1,107-board multiverse: the map renders 111,679 nodes, and the autosave makes it recur at every launch

`src/app/share.ts`:21 · CWE-400 · reproduced

**Who.** Anyone who can send the victim a link or a pasted code: a chat contact, a QR code, a web page linking multidcheckers://load?code=... or https://<web build>/?code=.... They control the whole base64 payload and therefore the entire replayed action list.

**How.** 1. Offline, replay legal actions through the repo's own engine, always preferring a time travel (each travel appends one board to the source timeline AND forks a brand-new timeline, so it is the action that buys the most boards per byte: ~78 bytes of JSON for two boards). 2. Stop when the encoded code reaches 65,508 characters, just under MAX_CODE_LENGTH = 64*1024; that is 605 actions, well under MAX_ACTIONS = 2000. 3. Send the code as multidcheckers://load?code=... or as ?code= on the web build. 4. On a device with no game in progress (fresh install, or the last game finished, so history.length === 1) GameScreen.arriveCode takes the else branch at GameScreen.tsx:121-124 and calls acceptCode immediately, with no ConfirmModal. 5. decodeGame replays all 605 actions and game.load installs the resulting state. 6. MultiverseMap renders one MiniBoard per board with no virtualisation. 7. 250 ms later the autosave effect writes the 605 actions to AsyncStorage key game.v1 (49,217 bytes, far under any quota), so App.tsx replays them and GameScreen redraws the same map on every subsequent launch.

**Why it matters.** The multiverse map goes from 31 boards / 2,916 render nodes for an ordinary 30-move game to 1,107 boards / 111,679 render nodes — a 38x blow-up — inside a ScrollView roughly 35,000 x 32,000 px. In react-test-renderer on a fast laptop (which allocates no native views at all) that single render takes 3.5 s; on a phone each of those nodes becomes a real Android View / UIView, which is an ANR or an out-of-memory kill. Because the game is persisted as 605 actions and replayed at launch, the app is left in that state permanently: recovery means clearing app data or reinstalling, and if the render OOMs before the user can reach Menu -> New game there is no in-app way out. No confirmation is shown at all when the victim has no game in progress. This is the same rendering weakness REVIEW.md records as BUG-5 (confirmed, never fixed), but the point here is that the caps added for SEC-3 were introduced precisely to stop an oversized code being 'replayed, saved and drawn' (share.ts:36-38 and the test comment at src/engine/__tests__/share.test.ts) and they are expressed in bytes and action counts, neither of which bounds the number of timelines or boards the replay produces.

**Evidence.**

src/app/share.ts:15  const MAX_CODE_LENGTH = 64 * 1024;
src/app/share.ts:21  const MAX_ACTIONS = 2000;
src/app/share.ts:39  if (code.length > MAX_CODE_LENGTH) throw new Error('That game is too large to load.');
src/app/share.ts:54  if (payload.a.length > MAX_ACTIONS) throw new Error('That game has too many moves to load.');
src/ui/MultiverseMap.tsx:114-128  {state.timelines.map((tl) => { ... {tl.boards.map((board, i) => { ... <MiniBoard board={board} ... /> }) }) }   // every board of every timeline, no windowing
src/ui/MiniBoard.tsx:26-45  one Pressable + 8 row Views + 64 cell Views + one View per piece, per board
src/ui/GameScreen.tsx:119-124  hasGameToLoseRef.current = game.history.length > 1; const arriveCode = (code) => { if (hasGameToLoseRef.current) setLinkCode(code); else acceptCodeRef.current(code); };

Measured (node repro.js):
  [1] code chars=65508 (cap 65536)  actions=605 (cap 2000)  travels=501
  [1] decodeGame accepted it in 37ms
  [1] -> history=606 states, timelines=502, boards on the map=1107
  [2] autosave written to AsyncStorage key game.v1: 49217 bytes, 605 actions
  [2] looksLikeSavedGame=true; normaliseSaved replays it in 48ms -> timelines=502 boards=1107

Measured render of the REAL MultiverseMap through jest-expo + react-test-renderer:
  {"label":"ordinary 30-move game","timelines":1,"boards":31,"renderMs":516,"nodes":2916}
  {"label":"hostile share code at the caps","timelines":502,"boards":1107,"renderMs":3545,"nodes":111679}

**Fix.** Bound the thing that actually costs, not only the bytes. In decodeGame, check the replayed multiverse inside the loop and stop early: after each applyAction, reject when history[history.length-1].timelines.length > MAX_TIMELINES or the total board count exceeds MAX_BOARDS (a real game needs perhaps 24 timelines and 200 boards; pick the numbers from the widest real game the map draws comfortably) with its own message, e.g. 'That game has grown too large for this app to draw.' Apply the identical ceiling in setup.normaliseSaved so a code that got through an older build, or a game grown past the ceiling by play, cannot brick the launch; and give looksLikeSavedGame/normaliseSaved the MAX_ACTIONS cap that decodeGame has (today it accepts an actions array of any length). Independently, virtualise MultiverseMap (render only the rows and turn-columns inside the measured viewport, which the component already tracks in `viewport`) so the number of boards stops being a linear multiplier on render cost — that is REVIEW.md BUG-5, still open. Add a test that builds the code at the caps exactly as above and asserts decodeGame rejects it.


### L13-2 · low — urlWithoutCode is not the inverse of codeFromUrl: a /load/<code> anywhere but the last path segment (including inside the hash) is never stripped, so the code is re-imported on every reload

`src/app/links.ts`:36 · CWE-20 · reproduced

**Who.** Whoever sends the victim a link to the web build. They choose the URL shape, and the app reads the code straight out of window.location.

**How.** 1. Send https://<web build>/?x=1#/load/5DCK.<payload> (or .../load/5DCK.<payload>/x, or /a/load/5DCK.<payload>/b/c). The hash form is the important one: the fragment never reaches the server, so any static host that serves index.html at / will load the app. 2. codeFromUrl's second branch, /\/load\/([^/?#]+)/, matches anywhere in the whole href, including in the fragment, so the app imports the code. 3. After a successful import GameScreen calls clearCodeFromUrl, which asks urlWithoutCode for the stripped URL. urlWithoutCode only deletes a `code` search parameter, only clears the hash when the hash itself contains `code=`, and only rewrites the pathname when /load/<segment> is the LAST path segment (/\/load\/[^/?#]+\/?$/). For all three shapes above it finds nothing to change and returns null, so history.replaceState is never called. 4. The code stays in the address bar. Every reload, restore-from-tab or back-navigation re-imports it.

**Why it matters.** The documented guarantee in links.ts ('A code left in the address bar is re-imported on every reload, replacing whatever has been played since') and the test named 'leaves nothing a reload could import again' do not hold for these shapes. On its own the victim gets the 'Load the game from this link?' sheet again on every reload once they have a game in progress — a nuisance and a repeated chance to lose their game by mistapping. Combined with L13-1 it is worse: on a fresh app (history.length === 1) there is no prompt at all, so a reload silently re-runs the expensive import even if the autosave were cleared, making the web denial of service self-sustaining.

**Evidence.**

src/app/links.ts:5-14
  const match = /[?&#]code=([^&#]+)/.exec(url);
  ...
  const path = /\/load\/([^/?#]+)/.exec(url);      // matches ANYWHERE in the href, hash included
  return path ? path[1] : null;
src/app/links.ts:30-41
  url.searchParams.delete('code');
  if (/[?&#]code=/.test(url.hash)) url.hash = '';   // only when the hash holds code=
  url.pathname = url.pathname.replace(/\/load\/[^/?#]+\/?$/, '/');   // only a TRAILING /load/<seg>
  ...
  return after === before ? null : after;
src/ui/GameScreen.tsx:113-116  const acceptCode = (code) => { const problem = loadCode(code); setLinkProblem(problem); if (!problem) clearCodeFromUrl(); };

Measured (node repro.js, step [3]):
  https://ex.com/?code=5DCK.abc          found="5DCK.abc" stripped="/"  stillThere=null
  https://ex.com/load/5DCK.abc           found="5DCK.abc" stripped="/"  stillThere=null
  https://ex.com/load/5DCK.abc/x         found="5DCK.abc" stripped=null stillThere="5DCK.abc"   <<< RE-IMPORT LOOP
  https://ex.com/a/load/5DCK.abc/b/c     found="5DCK.abc" stripped=null stillThere="5DCK.abc"   <<< RE-IMPORT LOOP
  https://ex.com/?x=1#/load/5DCK.abc     found="5DCK.abc" stripped=null stillThere="5DCK.abc"   <<< RE-IMPORT LOOP

**Fix.** Make the two functions a real inverse of each other. Either narrow the reader — anchor the path form so only a code in the last path segment is accepted, /\/load\/([^/?#]+)\/?$/, and do not look inside url.hash for it — or widen the cleaner: strip every /load/<segment> occurrence from the pathname (replace(/\/load\/[^/?#]+/g, '/')) and clear the hash whenever codeFromUrl finds anything in it (if (codeFromUrl('#' + url.hash.replace(/^#/,''))) url.hash = ''). Then pin the property rather than four examples in src/engine/__tests__/links.test.ts: for a generated list of href shapes, assert codeFromUrl(urlWithoutCode(h) ?? h) === null whenever codeFromUrl(h) !== null. Also call clearCodeFromUrl when a code FAILS to load (GameScreen.tsx:113-116 only clears on success), so a rejected code is not retried on every reload either.


### L13-3 · low — The legacy v1/v2 autosave branch hands storage contents to React with no validation at all, and `setup` is unvalidated on both branches, contradicting normaliseSaved's own doc comment

`src/app/setup.ts`:101 · CWE-502 · reproduced

**Who.** Anyone who can write the app's local storage: on the react-native-web build any script running on the same origin (a co-hosted page, e.g. a user-pages host that shares one origin across projects), and on a device anyone with the unlocked handset, adb, root, or a restored Android auto-backup (app.json sets no android.allowBackup, which defaults to true).

**How.** 1. Write AsyncStorage/localStorage key game.v1 with {"version":2,"history":[<anything>],"setup":{...}}. 2. App.tsx calls looksLikeSavedGame, which for version 1 or 2 checks only that `history` is a non-empty array, then normaliseSaved, whose `if (v.version !== 3)` branch returns that array verbatim as the game history. 3. GameScreen/useGame read history[history.length-1] as the live GameState and the engine throws on the first call (pendingTimelines -> state.timelines.filter is not a function) during render. There is no error boundary in App.tsx, so the app shows a blank screen at every launch — and because the value is never cleared, at every launch after that too.

**Why it matters.** Persistent denial of service at launch from a single storage write, and, on the v3 branch too, an attacker-chosen `setup` object reaching live code: `setup.bot.level` flows to chooseAction(live, bot.level) and to BOT_NAMES[bot.level] (an object literal, so BOT_NAMES['__proto__'] yields Object.prototype and React throws 'Objects are not valid as a React child'), and `setup.mode` decides whether the bot loop runs at all. Only the v3 branch's ACTIONS are validated. The function's own comment says 'Storage can hold anything, so every action goes through the engine', which is true only for version 3. This overlaps REVIEW.md REL-2 (confirmed, severity lowered, never fixed); the new part is that the v3 hardening was added right beside the legacy branch without covering it, that `setup` is unvalidated on both branches, and that looksLikeSavedGame puts no cap at all on `actions` where decodeGame caps at 2000.

**Evidence.**

src/app/setup.ts:79-84
  export function looksLikeSavedGame(v: unknown): v is AnySaved {
    ...
    if (s.version === 3) return Array.isArray(s.actions);            // no length cap
    return (s.version === 1 || s.version === 2) && Array.isArray(s.history) && s.history.length > 0;
  }
src/app/setup.ts:96-114
  /** ... Storage can hold anything, so every action goes through the engine. */
  export function normaliseSaved(v: AnySaved) {
    if (v.version !== 3) {
      const history = v.history;
      if (!Array.isArray(history) || history.length === 0) return null;
      return { history, setup: 'setup' in v && v.setup ? v.setup : DEFAULT_SETUP };   // returned raw
    }
    const setup = v.setup && typeof v.setup === 'object' ? v.setup : DEFAULT_SETUP;   // still raw

Measured (node repro.js, step [5]):
  [5] v2 record: looksLikeSavedGame=true, history returned byte-for-byte=true, setup={"mode":"bot","bot":{"level":"__proto__","player":7}}
  [5] first engine call on it throws: TypeError: state.timelines.filter is not a function
  [5] v3 with a huge action list is also accepted with no cap: looksLikeSavedGame=true

**Fix.** Either drop the v1/v2 branch outright (it is a one-release migration that has already shipped) or convert instead of trusting it: map the stored history to history.map((s) => s.lastAction).filter(Boolean) and replay it through applyAction exactly as v3 does, returning null on any throw. Add a cleanSetup(v) beside cleanRules that rebuilds the object from known values only — mode in ('local'|'bot'|'puzzle'), bot only when level is 1|2|3 and player is 0|1, puzzleId only when puzzleById resolves it, `within` and `player` coerced to numbers — and call it on both branches, since setup.bot.level reaches chooseAction and BOT_NAMES. Give looksLikeSavedGame/normaliseSaved the same MAX_ACTIONS ceiling decodeGame uses. Fix the doc comment so it does not claim a guarantee the function does not give, and add an error boundary in App.tsx that clears keys.game so a bad record cannot be a permanent brick.


## Checked and sound

What the reviewers tried and could not break. Recorded so it is not re-raised, and so a future change that undoes one of these is recognisable as a regression.

- Malformed decoded actions: I built 15 hostile action shapes and pushed each through the real decodeGame and the real engine — array elements that are null, a string, a number, a boolean or an array; an object with an unknown `type`; `{type:'move'}` with no fields; `move: null`; squares out of range (99999, 1e9), negative (-5, -7) and non-integer (17.5, 24.5); string coordinates; `timeline: '__proto__'`, `timeline: 'constructor'`, `timeline: 'length'`, `timeline: 4294967295`; `travel` with `from: null`, `from.timeline: '__proto__'` and an out-of-range `to`; and an out-of-order `endTurn`. Every one is rejected and surfaces as the single message 'That code contains a move that is not legal.' Nothing corrupts board state and nothing escapes the try/catch. The sibling multidconnect4's exported `isAction` guard would be defence in depth here rather than a plugged hole, because the engine already binds hard: `sameMove` requires the attacker's move to be element-for-element equal to a move the engine itself generated, `assertPending`/`getTimeline` only accept a value that equals a real Timeline's numeric `id`, `travelTargets` skips any square whose cell is not exactly `null` (so `board.cells['__proto__']`, which is Array.prototype and therefore truthy, is skipped rather than accepted), and `pieceAt`/`placePiece` only ever see indices the engine produced.
- Prototype pollution through the share payload: after decoding '{"v":1,"r":{"__proto__":{"flyingKings":true}},"m":"local","a":[],"__proto__":{"x":1}}', Object.prototype.x is undefined and ({}).flyingKings is undefined. JSON.parse and object spread both create own properties, and cleanRules rebuilds the rules from three `!!` coercions, so `{flyingKings:1}` becomes true but `sneaky:true` does not survive and nothing but the three known keys reaches newGame.
- base64/JSON parser abuse: decode() rejects every character outside the 64-character URL-safe alphabet, so at most 48 KB of JSON can come out of a 64 KB code; JSON.parse of a deeply nested array raises inside decodeGame's try and surfaces as 'That code is damaged and cannot be read.'; the byte cap is applied to the raw string BEFORE whitespace is stripped, so wrapping or padding a code cannot smuggle a larger payload past it; and the action cap is tested against a code the byte cap admits (2001 endTurns is ~50 kB), so the two guards really are independent.
- Engine time complexity under a hostile code: replaying the 605-action code at the caps costs 37-300 ms of CPU, and normaliseSaved replays the same actions in 48 ms. I specifically hunted for a capture-chain explosion, since the attacker chooses the rule variants and flyingKings makes captureChains a recursive search with no bound of its own: 81 random self-play games with flyingKings and backCapture both on produced a maximum of 17 legal moves from any position, a maximum chain of 4 captures, and a worst single legalMoves() call of 13.4 ms. The cost of a hostile code is the render, not the engine.
- A share code cannot choose the game setup: decodeGame always returns {mode:'local'} (both branches of the payload.m ternary are the same object shape), so setup.bot — which flows to chooseAction and BOT_NAMES — is not reachable from a link or a pasted code, only from local storage.
- puzzleById is PUZZLES.find((p) => p.id === id), not a table lookup, so setup.puzzleId cannot reach Object.prototype; stats.records is only ever indexed with the literal 'local' or with `bot${level}`, so no bare attacker string reaches a plain-object lookup; settings are merged with object spread from DEFAULT_SETTINGS, which creates own properties rather than setting a prototype.
- No dangerous sink exists in this app to reach: grepping src + App.tsx + index.ts for eval, new Function, innerHTML, dangerouslySetInnerHTML, WebView, fetch, XMLHttpRequest, Linking.openURL, child_process and path construction returns nothing but the six static require('../../assets/sounds/*.wav') calls in sound.ts. There is no network call of any kind in first-party code.
- The confirmation gate added for SEC-1 does work in the state it was written for: decodeGame is not called until the user confirms (GameScreen.tsx:121-124 stores the code and shows ConfirmModal), so the expensive replay in L13-1 is gated whenever game.history.length > 1. The hole is that a fresh app, or one whose last game finished (savePayload deliberately writes nothing for a finished game), has history.length === 1 and takes the ungated branch.
- Deep-link surface: app.json declares only scheme 'multidcheckers', with no android.intentFilters, no ios.associatedDomains, no android.permissions block and no plugins, so the only exported component is the standard Expo main activity answering that scheme — exactly the documented feature, and the handler does nothing with the URL but pull a code out of it. android.allowBackup is unset and therefore defaults to true (@expo/config-plugins/build/android/AllowBackup.js: 'Defaults to true'), so an adb backup carries settings.v1, game.v1, stats.v1, progress.v1 and entitlements.v1; none of those is a secret today, so I am not raising it as a finding. It does become real the day the store seam is switched on: entitlements.v1 is a plain unsigned {"supporter":true} written by saveEntitlements with no receipt check, and purchases.ts documents flipping STORE_ENABLED as the go-live step, so the Supporter pack would be unlockable by editing or restoring a backup.
- CI and repo posture (outside this lens but checked): .github/workflows/ci.yml pins actions/checkout and actions/setup-node to full commit SHAs and declares permissions: contents: read; no secrets are committed; .gitignore covers *.jks, *.p8, *.p12, *.key, *.mobileprovision, *.pem and .env*; eas.json contains no credentials.


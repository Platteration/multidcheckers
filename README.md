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
  piece sets that also rename the sides; colour-blind markings on pieces.
- **Feel.** Haptics and short synthesized sounds, both switchable. Pieces
  pop into place when they land.
- **Your record.** Games played, wins against each bot, time travels made,
  biggest multiverse, longest game, and puzzles solved.
- **A welcome on first launch** that shows the one idea that matters, with a
  real tiny multiverse, and offers the puzzles.
- **Links.** A game code also loads from a link: `?code=` on the web build
  and the app's own scheme on a device.
- **Fits the screen.** Portrait stacks the board over the map; wide screens
  put them side by side. The map draws a line from each branch to the board
  it split off, and a time travel flies a token across it.
- **Saved automatically.** The game in progress, settings, record, and
  puzzle progress survive closing the app.

## Money, and what will never be for sale

The app is built so it can sell one thing: a **Supporter pack** of cosmetics
(the board skins and piece sets marked ✦, plus future puzzle packs). Nothing
that changes the rules, the bots, or the outcome of a game will ever be sold,
and there are no loot boxes.

Until a billing library is wired in, `STORE_ENABLED` in
`src/app/purchases.ts` is false and every extra is unlocked for everyone. To
go live: implement `purchase` and `restore` in that file against your store
SDK, persist the result, and set the flag to true. The Settings sheet and the
Extras sheet already respect the entitlement.

## Building and shipping

`.github/workflows/ci.yml` runs the typecheck, the tests, and a web export
on every push. `eas.json` has development, preview, and production profiles
for [EAS Build](https://docs.expo.dev/build/introduction/). The icons in
`assets/` are generated, so replace them with real artwork before a store
release.

## Running it

```sh
npm install
npm start          # Expo dev server; scan the QR code with Expo Go
npm run ios        # iOS simulator (macOS)
npm run android    # Android emulator or device
npm run web        # in a browser
```

Quality checks:

```sh
npm test           # unit tests (jest-expo)
npm run typecheck  # tsc --noEmit
```

To produce store builds use [EAS Build](https://docs.expo.dev/build/introduction/)
(`npx eas build --platform ios|android`). The bundle identifiers are set in
`app.json`.

## Project layout

```
App.tsx                    entry: safe area + status bar + GameScreen
src/engine/types.ts        players, board references, turn parity
src/engine/board.ts        one checkers board: moves, jump chains, kings
src/engine/multiverse.ts   timelines, pending boards, time travel, rules, win/draw
src/engine/bot.ts          the three-level computer opponent
src/engine/__tests__/      unit tests for the rules, bots, puzzles, game codes,
                           the autosave, links and the app config
src/puzzles/index.ts       the puzzle set (each verified by a test)
src/app/settings.tsx       persisted settings (theme, skin, sound, variants)
src/app/theme.tsx          resolves settings into the palette screens draw with
src/app/persist.ts         AsyncStorage helpers; app/progress.tsx for puzzle progress
src/app/share.ts           game codes for play by message (app/base64.ts)
src/app/setup.ts           how a game is set up, and the autosave format
src/app/purchases.ts       the store seam; app/entitlements.tsx gates premium looks
src/app/feedback.ts        haptics and sounds (app/sound.ts)
src/ui/useGame.ts          game controller hook: history/undo, selection, bot turns
src/ui/GameScreen.tsx      screen layout, status text, bot loop, replay
src/ui/CheckerBoard.tsx    the big tappable board with the landing animation
src/ui/MiniBoard.tsx       board thumbnails for the map
src/ui/MultiverseMap.tsx   the timeline map (rows = timelines, columns = turns)
src/ui/*Modal.tsx          menu, rules, settings, new game, puzzles, share, extras
src/ui/__tests__/          contrast checks on the header text, which is drawn
                           straight on the background
```

The engine is pure TypeScript with no React dependency, so the rules can be
tested (and reused, e.g. for an AI opponent or online play) without the UI.
It shares its multiverse design with the sibling project
[multidconnect4](https://github.com/Platteration/multidconnect4).

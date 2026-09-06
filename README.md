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
npm test           # engine unit tests (jest-expo)
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
src/engine/multiverse.ts   timelines, pending boards, time travel, win checks
src/engine/__tests__/      unit tests for the rules
src/ui/useGame.ts          game controller hook: history/undo + selection flow
src/ui/CheckerBoard.tsx    the big tappable board
src/ui/MiniBoard.tsx       board thumbnails for the map
src/ui/MultiverseMap.tsx   the timeline map (rows = timelines, columns = turns)
src/ui/Modals.tsx          rules and game-over sheets, shared Button
src/ui/GameScreen.tsx      screen layout and status text
```

The engine is pure TypeScript with no React dependency, so the rules can be
tested (and reused, e.g. for an AI opponent or online play) without the UI.
It shares its multiverse design with the sibling project
[multidconnect4](https://github.com/Platteration/multidconnect4).

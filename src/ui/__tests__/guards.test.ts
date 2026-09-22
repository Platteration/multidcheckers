/**
 * The screen's pure guards, and the proof that the screen is using them. The
 * screen cannot be rendered here (it is React Native all the way down), so
 * that each helper is the one it really calls is checked by reading it. The
 * sibling game's guards.test.ts, against this app's guards: the bot's guard
 * is `botShouldAct` in app/setup.ts and is tested beside the save format in
 * saved.test.ts, so only its wiring is checked here.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { Action, applyAction, index, newGame } from '../../engine';
import { linkNeedsConfirming, squareLabel, travelOrigin } from '../guards';
import type { Selection } from '../useGame';

const source = (file: string): string => readFileSync(join(__dirname, '..', file), 'utf8');

const move = (from: number, to: number): Action => ({ type: 'move', timeline: 0, move: { from, path: [to], captures: [] } });

describe('when the bot may act', () => {
  it('is asked about the live game, not the state on screen', () => {
    // Opening the replay used to force "it is not the human's turn", which
    // started the bot loop instead of stopping it - and the move it chose from
    // the replayed state was then applied to the live game.
    const src = source('GameScreen.tsx');
    expect(src).toMatch(/const live = game\.state;\s*if \(!bot \|\| !botShouldAct\(game\.setup, live, replaying\)\) return;/);
    expect(src).toContain('chooseAction(live, bot.level)');
    expect(src).not.toMatch(/chooseAction\(state\b/);
  });
});

describe('the origin of a picked-up piece', () => {
  // Four moves and a travel: the welcome demo's tiny multiverse.
  const live = [move(index(2, 1), index(3, 0)), move(index(5, 6), index(4, 7)), move(index(2, 3), index(3, 2)), move(index(5, 4), index(4, 5))].reduce(
    (s, a) => applyAction(s, a),
    newGame(),
  );
  const branched = applyAction(live, { type: 'travel', from: { timeline: 0, square: index(3, 2) }, to: { timeline: 0, turn: 2 } });
  const holding: Selection = { kind: 'piece', from: { timeline: 1, square: index(3, 2) }, moves: [] };

  it('is the newest board of the timeline the piece sits on', () => {
    expect(branched.timelines).toHaveLength(2);
    const second = branched.timelines[1];
    expect(travelOrigin(branched, holding, false)).toEqual({ timeline: 1, turn: second.startTurn + second.boards.length - 1 });
    expect(travelOrigin(branched, { kind: 'none' }, false)).toBeNull();
  });

  it('is nothing while replaying, even a state that has that timeline', () => {
    // The state on screen may be the live one; the origin is still not read.
    expect(travelOrigin(branched, holding, true)).toBeNull();
    // The replayed state has one timeline; the held piece is on the second.
    expect(newGame().timelines).toHaveLength(1);
    expect(() => travelOrigin(newGame(), holding, true)).not.toThrow();
    expect(travelOrigin(newGame(), holding, true)).toBeNull();
    // Even asked about the live game, a timeline that is gone is not a throw.
    expect(travelOrigin(newGame(), holding, false)).toBeNull();
  });

  it('is what the screen actually uses, and the replay puts the piece down', () => {
    const src = source('GameScreen.tsx');
    expect(src).toMatch(/const origin = travelOrigin\(state, selection, replaying\)/);
    expect(src).not.toMatch(/latestRefIn/);
    // Both ways into the replay cancel the selection first.
    expect(src.match(/game\.cancel\(\);\s*setReplayIndex\(0\);/g)).toHaveLength(2);
    expect(src).not.toMatch(/onPress: \(\) => setReplayIndex\(0\)/);
  });
});

describe('a game arriving by link', () => {
  it('is offered, not taken, while a game is in progress', () => {
    // The scheme is registered with no host and no path, so any app, QR code
    // or web page can hand the app a code; it used to load at once and the
    // autosave then wrote the replacement over the real game.
    expect(linkNeedsConfirming(1)).toBe(false);
    expect(linkNeedsConfirming(2)).toBe(true);
    expect(linkNeedsConfirming(40)).toBe(true);
  });

  it('is what the screen actually does with a link', () => {
    const src = source('GameScreen.tsx');
    expect(src).toMatch(/hasGameToLoseRef\.current = linkNeedsConfirming\(game\.history\.length\);/);
    expect(src).toMatch(/if \(hasGameToLoseRef\.current\) setLinkCode\(code\);\s*else acceptCodeRef\.current\(code\);/);
    // Both the cold-start URL and every later one go through the offer, and
    // nothing loads a link's code without passing through it.
    expect(src.match(/if \(code\) arriveCodeRef\.current\(code\);/g)).toHaveLength(2);
    expect(src).not.toMatch(/loadCodeRef/);
  });
});

describe('the code the screen offers', () => {
  it('is the one the app would take back, asked for before the buttons are drawn', () => {
    // encodeGame writes a code for any game at all, including one past what
    // decodeGame will replay. Building the sheet's code with it left Copy and
    // Share open on a game that could not be loaded, so the refusal landed on
    // the recipient instead - who was told the sender's real game was fake.
    const src = source('GameScreen.tsx');
    expect(src).toMatch(/shareOffer\(game\.history, game\.setup\)/);
    expect(src).not.toMatch(/encodeGame\(/);
    // Both the code and the reason there is none reach the sheet.
    expect(src).toMatch(/code=\{share\.code\}/);
    expect(src).toMatch(/problem=\{share\.problem\}/);
    // And the link is built from the checked code, never from the raw game.
    expect(src).toMatch(/link=\{share\.code \? webLinkFor\(share\.code\) : null\}/);
  });
});

describe('reduce motion', () => {
  it('reaches the map from the setting, and the map reads it for both of the things it governs', () => {
    // The setting, the prop and the two behaviours behind it could each be
    // deleted with the whole suite green. What the map then does with the prop
    // is pinned where it can be seen running - the flight in mapRender.test.ts,
    // the scroll's `animated` in map.test.ts - so what is left here is the
    // wiring those two cannot see: that the screen resolves the setting at all,
    // hands it to the map, and that the scroll's options come from focusScroll
    // rather than from a hard-coded `animated: true`.
    const screen = source('GameScreen.tsx');
    expect(screen).toMatch(/const reduceMotion = useReduceMotion\(settings\.reduceMotion\);/);
    expect(screen).toMatch(/<MultiverseMap[^/>]*reduceMotion=\{reduceMotion\}/);
    const map = source('MultiverseMap.tsx');
    expect(map).toMatch(/const \{ x, y, animated \} = focusScroll\(focus, viewport, reduceMotion\);/);
    expect(map).toMatch(/horizontal\.current\?\.scrollTo\(\{ x, animated \}\);/);
    expect(map).toMatch(/vertical\.current\?\.scrollTo\(\{ y, animated \}\);/);
  });
});

describe('a saved game that could not be read', () => {
  it('is kept, and said out loud, not replaced in silence', () => {
    // App.tsx tells a record it could not read from no record at all, and the
    // screen is told which it got. The sibling app brings back what it can of
    // a long save and says it came back short; this one refuses to replay
    // it and keeps the record instead, so what must reach the screen is the
    // instruction not to clear it, and the reason, where the hint is.
    const app = source('../../App.tsx');
    expect(app).toMatch(/const restored = restoreSaved\(v\);/);
    expect(app).toMatch(/setSaved\(restored\);/);
    expect(app).toMatch(/if \(restored\.kind === 'unreadable'\) await setAsideGame\(v\);/);
    expect(app).toMatch(/keepStoredGame=\{saved\.kind === 'unreadable'\}/);
    const screen = source('GameScreen.tsx');
    expect(screen).toMatch(/const keepStoredRef = useRef\(!!keepStoredGame\);/);
    expect(screen).toMatch(/saveDecision\(game\.history, game\.setup, !keepStoredRef\.current\)/);
    expect(screen).toMatch(/decision\.kind === 'keep'\) \{[^}]*setSaveNote\(decision\.problem\)/);
    expect(screen).toMatch(/game\.error \?\? linkProblem \?\? saveNote \?\? hint/);
  });
});

describe('square labels', () => {
  const names: readonly [string, string] = ['Red', 'Black'];

  it('name the file, the rank and the piece', () => {
    expect(squareLabel(0, 0, { player: 0, king: false }, names)).toBe('a1, Red man');
    expect(squareLabel(2, 3, { player: 1, king: true }, names)).toBe('d3, Black king');
    expect(squareLabel(7, 7, null, names)).toBe('h8');
  });

  it('say where the held piece may land', () => {
    expect(squareLabel(3, 4, null, names, { capture: false })).toBe('e4, move here');
    expect(squareLabel(3, 4, null, names, { capture: true })).toBe('e4, jump here');
    expect(squareLabel(3, 4, { player: 0, king: false }, names, { capture: true })).toBe('e4, Red man, jump here');
  });

  it('call anything that is not a piece empty, instead of throwing', () => {
    // A corrupt board could hold anything; reading a name off it must not
    // take the whole app down.
    for (const value of [undefined, -1, 2, '0', {}, { player: 7 }, { player: '0', king: true }, { king: true }]) {
      expect(() => squareLabel(0, 0, value, names)).not.toThrow();
      expect(squareLabel(0, 0, value, names)).toBe('a1');
    }
  });

  it('are what the board actually renders', () => {
    const src = source('CheckerBoard.tsx');
    expect(src).toContain('squareLabel(r, c, piece, colors.playerNames, dest)');
    expect(src).not.toMatch(/playerNames\[piece\.player\]/);
  });
});

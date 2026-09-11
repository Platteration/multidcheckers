import { decode, encode } from '../../app/base64';
import { MAX_BOARDS, MAX_TIMELINES, decodeGame, encodeGame, shareOffer, tooLargeToDraw } from '../../app/share';
import { MAX_ACTIONS, actionsOf } from '../../app/setup';
import { Action, GameState, Timeline, applyAction, index, newGame } from '../index';
import { boardsIn, grownTo } from './helpers';

/** A code built by hand, so a payload the app would never write can be tested. */
const codeFor = (payload: unknown): string => '5DCK.' + encode(JSON.stringify(payload));

const step = (from: number, to: number): Action => ({ type: 'move', timeline: 0, move: { from, path: [to], captures: [] } });

const LOCAL = { mode: 'local' } as const;

/** A state of a size no game has to be played to reach: only the counts matter. */
function sized(timelines: number, boards: number): GameState {
  const start = newGame();
  const board = start.timelines[0].boards[0];
  const per = Math.floor(boards / timelines);
  const rows: Timeline[] = Array.from({ length: timelines }, (_, id) => ({
    id,
    startTurn: 0,
    boards: new Array(id === 0 ? boards - per * (timelines - 1) : per).fill(board),
    createdBy: null,
    branchedFrom: null,
    origin: null,
  }));
  return { ...start, timelines: rows };
}

/**
 * The biggest game the fastest-growing legal play reaches before a cap stops
 * it, built once: several tests want the same expensive game.
 */
const OVER_THE_CEILING = grownTo(MAX_BOARDS + 1);

describe('game codes', () => {
  it('round-trips text through base64', () => {
    for (const t of ['', 'a', 'ab', 'abc', 'héllo wörld ✓']) expect(decode(encode(t))).toBe(t);
  });

  it('round-trips a game with a time travel', () => {
    const actions: Action[] = [
      step(index(2, 1), index(3, 0)),
      step(index(5, 6), index(4, 7)),
      step(index(2, 3), index(3, 2)),
      step(index(5, 4), index(4, 5)),
      { type: 'travel', from: { timeline: 0, square: index(3, 2) }, to: { timeline: 0, turn: 2 } },
    ];
    const history = actions.reduce((h, a) => [...h, applyAction(h[h.length - 1], a)], [newGame({ flyingKings: true })]);
    const code = encodeGame(history, { mode: 'local' });
    expect(code.startsWith('5DCK.')).toBe(true);
    const loaded = decodeGame(code);
    expect(loaded.history).toHaveLength(history.length);
    expect(loaded.history[loaded.history.length - 1]).toEqual(history[history.length - 1]);
    expect(loaded.history[0].rules.flyingKings).toBe(true);
  });

  it('rejects junk codes', () => {
    expect(() => decodeGame('hello')).toThrow(/not a 5D/);
    expect(() => decodeGame('5DCK.!!!')).toThrow(/damaged/);
  });

  it('reads a code that a message wrapped', () => {
    // Codes are long and chat clients, email and terminals all break long
    // tokens. None of the whitespace belongs to the alphabet, so a wrapped
    // code used to fail as 'damaged' when it had survived the trip intact.
    const actions: Action[] = [step(index(2, 1), index(3, 0)), step(index(5, 6), index(4, 7))];
    const history = actions.reduce((h, a) => [...h, applyAction(h[h.length - 1], a)], [newGame()]);
    const code = encodeGame(history, { mode: 'local' });
    const wrapped = (code.match(/.{1,40}/g) ?? []).join('\n');
    expect(wrapped).not.toBe(code);
    expect(decodeGame(wrapped).history).toHaveLength(history.length);
    expect(decodeGame(`  \n${code}\r\n `).history).toHaveLength(history.length);
    expect(decodeGame(code.split('').join(' ')).history).toHaveLength(history.length);
  });

  it('takes the rule variants as booleans of its own making', () => {
    // The sender chooses the rules for the game you load, so nothing but the
    // three known keys reaches the engine, and each one as a real boolean.
    const loaded = decodeGame(
      codeFor({ v: 1, r: { flyingKings: 1, backCapture: 0, strictPresent: null, sneaky: true }, m: 'local', a: [] }),
    );
    expect(loaded.history[0].rules).toEqual({ flyingKings: true, backCapture: false, strictPresent: false });
    expect(decodeGame(codeFor({ v: 1, r: null, m: 'local', a: [] })).history[0].rules).toEqual({
      flyingKings: false,
      backCapture: false,
      strictPresent: false,
    });
  });

  it('refuses a code too large to be worth replaying', () => {
    // Every replayed state copies every timeline, and the result is saved and
    // drawn, so an entirely legal code can still be far too big to accept.
    expect(() => decodeGame('5DCK.' + 'A'.repeat(64 * 1024))).toThrow(/too large/);
    // A real game is nowhere near either cap: this one still loads.
    expect(() => decodeGame(codeFor({ v: 1, r: {}, m: 'local', a: [] }))).not.toThrow();
  });

  it('refuses a code with more actions than it will replay', () => {
    // The action cap has to be tested with a code the byte cap lets through,
    // or it is the byte cap being tested twice: 2001 moves are ~197 kB of
    // code and never reach this check, while 2001 of the cheapest action are
    // ~50 kB and only a count of them stops the replay.
    const endTurns = (n: number) => codeFor({ v: 1, r: {}, m: 'local', a: new Array(n).fill({ type: 'endTurn' }) });
    const over = endTurns(2001);
    expect(over.length).toBeLessThan(64 * 1024);
    expect(() => decodeGame(over)).toThrow(/too many moves/);
    // One action fewer is under the cap, so it is replayed and stopped by the
    // rules instead — which is what makes the throw above the count check and
    // nothing else.
    expect(() => decodeGame(endTurns(2000))).toThrow(/not legal/);
  });

  it('refuses a code that replays into more multiverse than an import may', () => {
    // Both caps above are counted on the code, and neither bounds what the code
    // builds: a travel buys two boards and a whole timeline for about 108
    // characters. So this game sits inside both of them - which is what the two
    // expectations below say - and is still refused for its size.
    const code = encodeGame(OVER_THE_CEILING, LOCAL);
    expect(code.length).toBeLessThan(64 * 1024);
    expect(actionsOf(OVER_THE_CEILING).length).toBeLessThan(MAX_ACTIONS);
    expect(() => decodeGame(code)).toThrow(/too large for this app to draw/);
  });

  it('loads the games a person actually plays, however they play them', () => {
    // The ceiling this replaced was sized from bot games and refused a hand
    // played game after 122 actions - five rounds of taking every time travel
    // on offer - while the sending end still handed out the code. These counts
    // are measured play, not the constants under test: 122 actions of it reach
    // 97 timelines and 219 boards, and 400 actions against the strongest bot,
    // far longer than most games, reach 78 timelines and 478 boards.
    const played = grownTo(500);
    expect(actionsOf(played).length).toBeGreaterThan(250);
    expect(played[played.length - 1].timelines.length).toBeGreaterThan(200);
    const loaded = decodeGame(encodeGame(played, LOCAL));
    expect(loaded.history).toHaveLength(played.length);
    expect(loaded.history[loaded.history.length - 1]).toEqual(played[played.length - 1]);
  });

  it('measures the multiverse by both of the things that cost, not just one', () => {
    // Two halves, and the one that fires first in real play is the boards: the
    // game above crosses the board cap while its timelines are still under
    // theirs. A check that lost either half would take a state the map cannot
    // draw. The sizes here are written out rather than derived from the caps,
    // so moving a cap has to be a decision and not an accident.
    expect(tooLargeToDraw(sized(97, 219))).toBe(false); // 122 actions of taking every travel
    expect(tooLargeToDraw(sized(78, 478))).toBe(false); // 400 actions against the strongest bot
    expect(tooLargeToDraw(sized(424, 950))).toBe(false); // 526 actions of taking every travel
    expect(tooLargeToDraw(sized(20, 1400))).toBe(true);
    expect(tooLargeToDraw(sized(700, 700))).toBe(true);
    // Measured, not derived: the fastest-growing legal play crosses the board
    // cap while its timelines are still short of theirs, so the half nobody
    // pinned is the half that decides whether a real game can be sent.
    const last = OVER_THE_CEILING[OVER_THE_CEILING.length - 1];
    expect(boardsIn(last)).toBeGreaterThan(MAX_BOARDS);
    expect(last.timelines.length).toBeLessThan(MAX_TIMELINES);
  });
});

describe('what the share sheet offers', () => {
  it('hands out no code the other end would refuse', () => {
    // The sender cannot un-grow a game. A code offered for a game past any of
    // the caps is one neither player - not even the sender, on a new device -
    // could ever load, and the only sign of it was an error at the far end.
    const offer = shareOffer(OVER_THE_CEILING, LOCAL);
    expect(offer.code).toBeNull();
    expect(offer.problem).toMatch(/cannot be sent/);
    // And what it does offer, the loading end takes.
    const played = grownTo(500);
    const good = shareOffer(played, LOCAL);
    expect(good.problem).toBeNull();
    expect(decodeGame(good.code!).history).toHaveLength(played.length);
  });

  it('refuses on every cap the loading end applies, not only the multiverse', () => {
    // A history of counts: these caps are arithmetic on the actions and the
    // last state, and none of the three needs a game played to reach it.
    const start = newGame();
    const stretch = (n: number, action: Action, state = start): GameState[] => [
      start,
      ...new Array(n).fill({ ...state, lastAction: action }),
    ];
    const move: Action = { type: 'move', timeline: 0, move: { from: index(2, 1), path: [index(3, 0)], captures: [] } };
    expect(shareOffer(stretch(MAX_ACTIONS + 1, { type: 'endTurn' }), LOCAL).problem).toMatch(/more moves than a code/);
    // Under the action cap, over the byte cap: 1,200 moves are about 84 kB.
    expect(shareOffer(stretch(1200, move), LOCAL).problem).toMatch(/too long to send/);
    expect(shareOffer(stretch(3, move, sized(MAX_TIMELINES + 1, MAX_TIMELINES + 1)), LOCAL).problem).toMatch(/timelines/);
  });

  it('has nothing to offer before the first move, or for a puzzle', () => {
    const played = grownTo(20);
    expect(shareOffer([newGame()], LOCAL)).toEqual({ code: null, problem: null });
    expect(shareOffer(played, { mode: 'puzzle', puzzleId: 'twoboards' })).toEqual({ code: null, problem: null });
  });
});

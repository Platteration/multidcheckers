import { decode, encode } from '../../app/base64';
import { MAX_BOARDS, MAX_TIMELINES, decodeGame, encodeGame, shareOffer, tooLargeToDraw } from '../../app/share';
import { MAX_ACTIONS, actionsOf } from '../../app/setup';
import { Action, GameState, Timeline, applyAction, getTimeline, index, latestBoard, newGame } from '../index';
import { boardsIn, grownTo } from './helpers';

/** A code built by hand, so a payload the app would never write can be tested. */
const codeFor = (payload: unknown): string => '5DCK.' + encode(JSON.stringify(payload));

const step = (from: number, to: number): Action => ({ type: 'move', timeline: 0, move: { from, path: [to], captures: [] } });

const LOCAL = { mode: 'local' } as const;

/** A state of a size no game has to be played to reach: only the counts matter. */
function sized(timelines: number, boards: number): GameState {
  const start = newGame();
  const board = latestBoard(getTimeline(start, 0));
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
    const history = actions.reduce((h, a) => [...h, applyAction(h[h.length - 1]!, a)], [newGame({ flyingKings: true })]);
    const code = encodeGame(history, { mode: 'local' });
    expect(code.startsWith('5DCK.')).toBe(true);
    const loaded = decodeGame(code);
    expect(loaded.history).toHaveLength(history.length);
    expect(loaded.history[loaded.history.length - 1]).toEqual(history[history.length - 1]);
    expect(loaded.history[0]?.rules.flyingKings).toBe(true);
  });

  it('rejects junk codes', () => {
    expect(() => decodeGame('hello')).toThrow(/not a 5D/);
    expect(() => decodeGame('5DCK.!!!')).toThrow(/damaged/);
  });

  it('rejects malformed actions before the engine sees them', () => {
    const payload = { v: 1, r: {}, m: 'local', a: [{ type: 'move', timeline: 0, move: { from: 1, path: ['2'], captures: [] } }] };
    expect(() => decodeGame(`5DCK.${encode(JSON.stringify(payload))}`)).toThrow(/invalid move/);
  });
});

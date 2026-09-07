import { decode, encode } from '../../app/base64';
import { decodeGame, encodeGame } from '../../app/share';
import { Action, applyAction, index, newGame } from '../index';

const step = (from: number, to: number): Action => ({ type: 'move', timeline: 0, move: { from, path: [to], captures: [] } });

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
});

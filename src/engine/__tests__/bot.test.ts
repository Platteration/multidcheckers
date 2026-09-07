import { boardFromRows, index, initialBoard } from '../board';
import { BotLevel, chooseAction, enumerateActions, playTurn } from '../bot';
import { Action, GameState, applyAction, newGame, pendingTimelines } from '../multiverse';

const seeded = (seed = 1) => () => {
  seed = (seed * 16807) % 2147483647;
  return (seed - 1) / 2147483646;
};
const step = (timeline: number, from: number, to: number): Action => ({ type: 'move', timeline, move: { from, path: [to], captures: [] } });

function withBoard(rows: string[], toMove: 0 | 1): GameState {
  const board = boardFromRows(rows);
  const boards = toMove === 0 ? [initialBoard(), initialBoard(), board] : [initialBoard(), board];
  return {
    ...newGame(),
    timelines: [{ id: 0, startTurn: 0, boards, createdBy: null, branchedFrom: null, origin: null }],
    toMove,
  };
}

describe('bot', () => {
  it.each([1, 2, 3] as BotLevel[])('level %i takes a winning capture', (level) => {
    const g = withBoard(['........', '........', '........', '........', '........', '...b....', '..r.....', '........'], 0);
    const a = chooseAction(g, level, seeded())!;
    expect(a.type).toBe('move');
    expect((a as { move: { captures: number[] } }).move.captures).toEqual([index(2, 3)]);
  });

  it.each([2, 3] as BotLevel[])('level %i does not walk into a capture when it has a safe move', (level) => {
    // Red man at c3 can step to b4 (safe) or d4 (captured by the black man at e5).
    const g = withBoard(['........', '........', '........', '....b...', '........', '..r.....', '........', 'b.......'], 0);
    const a = chooseAction(g, level, seeded())!;
    expect(a.type).toBe('move');
    expect((a as { move: { path: number[] } }).move.path).toEqual([index(3, 1)]);
  });

  it('level 1 never travels; level 3 may', () => {
    let g = newGame();
    g = [step(0, index(2, 1), index(3, 0)), step(0, index(5, 6), index(4, 7)), step(0, index(2, 3), index(3, 2)), step(0, index(5, 4), index(4, 5))].reduce((s, a) => applyAction(s, a), g);
    expect(enumerateActions(g, 1).every((a) => a.type === 'move')).toBe(true);
    expect(enumerateActions(g, 3).some((a) => a.type === 'travel')).toBe(true);
  });

  it('plays every waiting board before its turn ends', () => {
    let g = newGame();
    g = [step(0, index(2, 1), index(3, 0)), step(0, index(5, 6), index(4, 7)), step(0, index(2, 3), index(3, 2)), step(0, index(5, 4), index(4, 5))].reduce((s, a) => applyAction(s, a), g);
    g = applyAction(g, { type: 'travel', from: { timeline: 0, square: index(3, 2) }, to: { timeline: 0, turn: 2 } });
    expect(pendingTimelines(g)).toHaveLength(2);
    const steps = playTurn(g, { level: 2, player: 1 }, seeded());
    expect(steps).toHaveLength(2);
    expect(steps[1].toMove).toBe(0);
  });

  it('never picks an illegal action over many random games', () => {
    const rng = seeded(3);
    for (let game = 0; game < 3; game++) {
      let g = newGame({ flyingKings: game % 2 === 0, backCapture: game >= 2 });
      let plies = 0;
      while (g.status === 'playing' && plies++ < 120) {
        const level = ((plies % 3) + 1) as BotLevel;
        const a = chooseAction(g, level, rng);
        expect(a).not.toBeNull();
        expect(() => (g = applyAction(g, a!))).not.toThrow();
      }
    }
  });
});

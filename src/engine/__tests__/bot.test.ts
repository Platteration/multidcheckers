import { boardFromRows, index, initialBoard, rowOf } from '../board';
import { BotLevel, chooseAction, enumerateActions, playTurn } from '../bot';
import { Action, GameState, applyAction, hasAnyAction, mandatoryTimelines, newGame, pendingTimelines } from '../multiverse';

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

  it('level 1 takes a crowning move on any draw under 0.8', () => {
    // Red's man on b7 can step onto rank 8 either side and be crowned; the
    // one on f3 can only step to rank 4. No capture is on and Black keeps a
    // move whatever Red does, so no action wins outright and the Novice's
    // crowning preference is the only thing that decides.
    const g = withBoard(['........', '.r......', '......b.', '........', '........', '.....r..', '........', '........'], 0);
    const moves = enumerateActions(g, 1).filter((a): a is Extract<Action, { type: 'move' }> => a.type === 'move');
    // Red crowns on rank 8, row index 7.
    const crowns = (a: Action) => a.type === 'move' && rowOf(a.move.path[a.move.path.length - 1]!) === 7;
    expect(moves.filter(crowns)).toHaveLength(2);
    expect(moves.filter((a) => !crowns(a))).toHaveLength(2);
    expect(moves.some((a) => applyAction(g, a).status !== 'playing')).toBe(false);
    // A draw under 0.8 takes a crowning move, whichever one the next draw picks.
    for (const draw of [0, 0.3, 0.79]) expect(crowns(chooseAction(g, 1, () => draw)!)).toBe(true);
  });

  it('plays every waiting board before its turn ends', () => {
    let g = newGame();
    g = [step(0, index(2, 1), index(3, 0)), step(0, index(5, 6), index(4, 7)), step(0, index(2, 3), index(3, 2)), step(0, index(5, 4), index(4, 5))].reduce((s, a) => applyAction(s, a), g);
    g = applyAction(g, { type: 'travel', from: { timeline: 0, square: index(3, 2) }, to: { timeline: 0, turn: 2 } });
    expect(pendingTimelines(g)).toHaveLength(2);
    const steps = playTurn(g, { level: 2, player: 1 }, seeded());
    expect(steps).toHaveLength(2);
    expect(steps[1]?.toMove).toBe(0);
  });

  // A board can be blocked solid and still allow a time travel. The rules count
  // travels, so that is not a trapped loss and someone has to play it - a bot
  // with nothing to return leaves the game waiting on it forever.
  describe('a board whose only action is a time travel', () => {
    // Red's two men are walled in: every forward square is occupied and every
    // landing square beyond it is taken or off the board. Turn 0 of the same
    // timeline is Red's move with both squares free, so a travel exists.
    const past = boardFromRows(['........', '........', '........', '........', '........', '...b.b..', 'b.b...b.', '........']);
    const now = boardFromRows(['........', '........', '........', '........', '........', '...b.b..', 'b.b...b.', '.r.....r']);
    const stuck: GameState = {
      ...newGame(),
      timelines: [{ id: 0, startTurn: 0, boards: [past, past, now], createdBy: null, branchedFrom: null, origin: null }],
      toMove: 0,
    };

    it('is not a loss, so the rules expect it to be played', () => {
      expect(mandatoryTimelines(stuck).map((tl) => tl.id)).toEqual([0]);
      expect(hasAnyAction(stuck, 0)).toBe(true);
      expect(enumerateActions(stuck, 1).filter((a) => a.type === 'move')).toHaveLength(0);
    });

    it.each([1, 2, 3] as BotLevel[])('level %i plays it instead of stopping', (level) => {
      const a = chooseAction(stuck, level, seeded());
      expect(a).not.toBeNull();
      const next = applyAction(stuck, a!);
      expect(next.timelines.length).toBe(2);
      expect(next.toMove).toBe(1);
    });

    it.each([1, 2, 3] as BotLevel[])('level %i plays its whole turn there', (level) => {
      expect(playTurn(stuck, { level, player: 0 }, seeded()).length).toBeGreaterThan(0);
    });
  });

  it('has an action wherever the rules say the player is not trapped', () => {
    // Derived from hasAnyAction, the same test the trapped-loss rule applies, so
    // a bot that simply forgot a kind of action cannot excuse itself here.
    const rng = seeded(11);
    for (let game = 0; game < 2; game++) {
      let g = newGame({ backCapture: game === 1 });
      let plies = 0;
      while (g.status === 'playing' && plies++ < 90) {
        if (mandatoryTimelines(g).some((tl) => hasAnyAction(g, tl.id))) {
          for (const level of [1, 2, 3] as BotLevel[]) expect(chooseAction(g, level, rng)).not.toBeNull();
        }
        const a = chooseAction(g, 2, rng);
        expect(a).not.toBeNull();
        g = applyAction(g, a!);
      }
    }
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

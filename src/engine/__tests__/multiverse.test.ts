import { boardFromRows, index, initialBoard, legalMoves, pieceAt } from '../board';
import {
  Action,
  GameState,
  IllegalAction,
  applyAction,
  getBoard,
  hasAnyAction,
  latestTurn,
  newGame,
  pendingTimelines,
  resolveTurn,
  travelTargets,
} from '../multiverse';

function play(state: GameState, ...actions: Action[]): GameState {
  return actions.reduce((s, a) => applyAction(s, a), state);
}

const step = (timeline: number, from: number, to: number): Action => ({
  type: 'move',
  timeline,
  move: { from, path: [to], captures: [] },
});

describe('multiverse basics', () => {
  it('starts with one timeline and Red to move', () => {
    const g = newGame();
    expect(g.timelines).toHaveLength(1);
    expect(g.toMove).toBe(0);
    expect(pendingTimelines(g).map((t) => t.id)).toEqual([0]);
    expect(travelTargets(g, 0, index(2, 1))).toEqual([]);
  });

  it('passes the turn after a move', () => {
    const g = play(newGame(), step(0, index(2, 1), index(3, 0)));
    expect(g.toMove).toBe(1);
    expect(latestTurn(g.timelines[0])).toBe(1);
    expect(pieceAt(getBoard(g, { timeline: 0, turn: 1 })!, index(3, 0))).toEqual({ player: 0, king: false });
  });

  it('rejects illegal moves', () => {
    expect(() => applyAction(newGame(), step(0, index(2, 1), index(4, 1)))).toThrow(IllegalAction);
    expect(() => applyAction(newGame(), step(0, index(5, 0), index(4, 1)))).toThrow(IllegalAction);
  });
});

describe('time travel', () => {
  // t0 Red, t1 Black, t2 Red, t3 Black -> t4 Red to move.
  const base = play(
    newGame(),
    step(0, index(2, 1), index(3, 0)),
    step(0, index(5, 6), index(4, 7)),
    step(0, index(2, 3), index(3, 2)),
    step(0, index(5, 4), index(4, 5)),
  );

  it('only offers past boards where it was your move and the square is free', () => {
    expect(base.toMove).toBe(0);
    // The red man now at (3,2) arrived on turn 2, so that square was empty at t0 and t2.
    expect(travelTargets(base, 0, index(3, 2))).toEqual([
      { timeline: 0, turn: 0 },
      { timeline: 0, turn: 2 },
    ]);
    // The man at (3,0) moved on turn 0; its square is only free at t0.
    expect(travelTargets(base, 0, index(3, 0))).toEqual([{ timeline: 0, turn: 0 }]);
    // The red man at (2,5) never moved, so its square is taken on every past board.
    expect(travelTargets(base, 0, index(2, 5))).toEqual([]);
  });

  it('branches a new timeline and removes the piece from the origin', () => {
    const g = play(base, {
      type: 'travel',
      from: { timeline: 0, square: index(3, 2) },
      to: { timeline: 0, turn: 2 },
    });
    expect(g.timelines).toHaveLength(2);
    const origin = getBoard(g, { timeline: 0, turn: 5 })!;
    expect(pieceAt(origin, index(3, 2))).toBeNull();
    expect(pieceAt(origin, index(3, 0))).toEqual({ player: 0, king: false });
    const branch = g.timelines[1];
    expect(branch.startTurn).toBe(3);
    expect(branch.branchedFrom).toEqual({ timeline: 0, turn: 2 });
    expect(branch.origin).toEqual({ timeline: 0, turn: 4 });
    const bb = getBoard(g, { timeline: 1, turn: 3 })!;
    expect(pieceAt(bb, index(3, 2))).toEqual({ player: 0, king: false });
    expect(pieceAt(bb, index(2, 3))).toEqual({ player: 0, king: false }); // still home on the t2 board
    expect(pieceAt(bb, index(4, 5))).toBeNull(); // Black's t3 move never happened here
    expect(g.toMove).toBe(1);
    expect(pendingTimelines(g).map((t) => t.id)).toEqual([0, 1]);
  });

  it('makes the opponent move on every waiting board before the turn passes', () => {
    let g = play(base, {
      type: 'travel',
      from: { timeline: 0, square: index(3, 2) },
      to: { timeline: 0, turn: 2 },
    });
    g = applyAction(g, step(1, index(5, 4), index(4, 5)));
    expect(g.toMove).toBe(1);
    expect(pendingTimelines(g).map((t) => t.id)).toEqual([0]);
    g = applyAction(g, step(0, index(5, 2), index(4, 3)));
    expect(g.toMove).toBe(0);
    expect(pendingTimelines(g).map((t) => t.id)).toEqual([0, 1]);
  });

  it('refuses the wrong piece, parity, or a taken square', () => {
    const notMine: Action = { type: 'travel', from: { timeline: 0, square: index(4, 7) }, to: { timeline: 0, turn: 2 } };
    expect(() => applyAction(base, notMine)).toThrow(IllegalAction);
    const wrongParity: Action = { type: 'travel', from: { timeline: 0, square: index(3, 2) }, to: { timeline: 0, turn: 1 } };
    expect(() => applyAction(base, wrongParity)).toThrow(IllegalAction);
    const taken: Action = { type: 'travel', from: { timeline: 0, square: index(2, 5) }, to: { timeline: 0, turn: 0 } };
    expect(() => applyAction(base, taken)).toThrow(IllegalAction);
  });

  it('lets a piece escape a mandatory capture by leaving the present', () => {
    // Red man at (3,0) can be captured? No: set up a position where Red must
    // capture, and instead travels.
    const g: GameState = {
      ...newGame(),
      timelines: [
        {
          id: 0,
          startTurn: 0,
          boards: [
            initialBoard(),
            initialBoard(),
            boardFromRows([
              '........',
              '........',
              '........',
              '........',
              '...b....',
              '..r.....',
              '.....b..',
              '........',
            ]),
          ],
          createdBy: null,
          branchedFrom: null,
          origin: null,
        },
      ],
    };
    expect(legalMoves(getBoard(g, { timeline: 0, turn: 2 })!, 0)[0].captures).toHaveLength(1);
    const quiet = step(0, index(2, 2), index(3, 1));
    expect(() => applyAction(g, quiet)).toThrow(/must capture/);
    const fled = applyAction(g, { type: 'travel', from: { timeline: 0, square: index(2, 2) }, to: { timeline: 0, turn: 0 } });
    // Red's only piece left the origin board, so Black wins there at once.
    expect(fled.status).toBe('won');
    expect(fled.win).toEqual({ player: 1, board: { timeline: 0, turn: 3 }, reason: 'captured' });
  });
});

describe('winning', () => {
  it('wins by capturing the last piece on any board', () => {
    const g: GameState = {
      ...newGame(),
      timelines: [
        {
          id: 0,
          startTurn: 0,
          boards: [
            initialBoard(),
            initialBoard(),
            boardFromRows([
              '........',
              '........',
              '........',
              '........',
              '........',
              '...b....',
              '..r.....',
              '........',
            ]),
          ],
          createdBy: null,
          branchedFrom: null,
          origin: null,
        },
      ],
    };
    const won = applyAction(g, {
      type: 'move',
      timeline: 0,
      move: { from: index(1, 2), path: [index(3, 4)], captures: [index(2, 3)] },
    });
    expect(won.status).toBe('won');
    expect(won.win).toEqual({ player: 0, board: { timeline: 0, turn: 3 }, reason: 'captured' });
    expect(() => applyAction(won, step(0, 0, 0))).toThrow(IllegalAction);
  });

  it('loses when a waiting board offers no move and no time travel', () => {
    // Black's only piece is boxed in at the top-right corner behind red kings,
    // with nothing to jump, and no past board where its square is free.
    const stuck = boardFromRows([
      '.......b',
      '......R.',
      '.....R..',
      '........',
      '........',
      '........',
      '........',
      '........',
    ]);
    const g: GameState = {
      ...newGame(),
      timelines: [{ id: 0, startTurn: 0, boards: [stuck, stuck, stuck], createdBy: null, branchedFrom: null, origin: null }],
      toMove: 1,
    };
    // Turn 2 is Red's; pretend Red just moved and see what happens to Black.
    const before: GameState = { ...g, toMove: 0, timelines: [{ ...g.timelines[0], boards: [stuck, stuck, stuck, stuck] }] };
    expect(pendingTimelines(before)).toHaveLength(0); // turn 3 is Black's
    const after = resolveTurn(before);
    expect(hasAnyAction({ ...before, toMove: 1 }, 0)).toBe(false);
    expect(after.status).toBe('won');
    expect(after.win).toEqual({ player: 0, board: { timeline: 0, turn: 3 }, reason: 'trapped' });
  });
});

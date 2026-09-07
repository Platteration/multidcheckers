/**
 * Hand-made puzzles. Each one is a full multiverse position plus a goal:
 * win within so many of your own actions. Positions are built from text
 * boards; the tests replay every solution to prove it works.
 */
import { Action, Board, GameState, Player, Rules, boardFromRows, index, newGame } from '../engine';

export interface Puzzle {
  id: string;
  title: string;
  /** One line shown above the board. */
  brief: string;
  /** Longer nudge shown on request. */
  hint: string;
  state: GameState;
  /** The side the person plays. */
  player: Player;
  /** How many of the player's own actions may be used. */
  within: number;
  /** The key move(s). For multi-move puzzles, only the setup moves; the finish is any immediate win. */
  solution: Action[];
}

/** A single timeline whose boards are given oldest first; the last one is "now". */
function fromBoards(boards: Board[], rules: Partial<Rules> = {}): GameState {
  const base = newGame(rules);
  const toMove = ((boards.length - 1) % 2) as Player;
  return {
    ...base,
    toMove,
    timelines: [{ id: 0, startTurn: 0, boards, createdBy: null, branchedFrom: null, origin: null }],
  };
}

const rows = (r: string[]) => boardFromRows(r);
const sq = (row: number, col: number) => index(row, col);

export const PUZZLES: Puzzle[] = [
  {
    id: 'sweep',
    title: 'Clean sweep',
    brief: 'Red to move. Take every black piece in one go.',
    hint: 'A jump that lands next to another enemy keeps going. Start from a2.',
    player: 0,
    within: 1,
    state: fromBoards([
      rows(['........', '........', '........', '........', '........', '........', '........', '........']),
      rows(['........', '........', '........', '........', '........', '........', '........', '........']),
      rows(['........', '.....b..', '........', '...b....', '........', '.b......', 'r.......', '........']),
    ]),
    solution: [{ type: 'move', timeline: 0, move: { from: sq(1, 0), path: [sq(3, 2), sq(5, 4), sq(7, 6)], captures: [sq(2, 1), sq(4, 3), sq(6, 5)] } }],
  },
  {
    id: 'king',
    title: "The king's return",
    brief: 'Red to move. Your king can jump backwards. Use it.',
    hint: 'From e5, jump down-left over d4, then keep going over c2.',
    player: 0,
    within: 1,
    state: fromBoards([
      rows(['........', '........', '........', '........', '........', '........', '........', '........']),
      rows(['........', '........', '........', '........', '........', '........', '........', '........']),
      rows(['........', '........', '........', '...R....', '..b.....', '........', '..b.....', '........']),
    ]),
    solution: [{ type: 'move', timeline: 0, move: { from: sq(4, 3), path: [sq(2, 1), sq(0, 3)], captures: [sq(3, 2), sq(1, 2)] } }],
  },
  {
    id: 'seal',
    title: 'Seal the past',
    brief: "Black's cornered man at a8 once had nowhere to go. Send a man back so he still doesn't.",
    hint: 'Pick up the red man on c6 and tap the glowing board at t0. With c6 filled there, a8 cannot even jump.',
    player: 0,
    within: 1,
    state: fromBoards([
      // t0, Red to move: a8 is blocked by b7 and could only escape by jumping to c6.
      rows(['b.......', '.r......', '........', '........', '.r......', '........', '........', '.r......']),
      // t1, Black to move.
      rows(['b.......', '.r......', '..r.....', '........', '........', '........', '........', '.r......']),
      // t2, now: a man on c6 that can be sent back.
      rows(['b.......', '.r......', '..r.....', '........', '....b...', '........', '........', '.r......']),
    ]),
    solution: [{ type: 'travel', from: { timeline: 0, square: sq(5, 2) }, to: { timeline: 0, turn: 0 } }],
  },
  {
    id: 'flying',
    title: 'Flying finish',
    brief: 'Red to move, flying kings on. One long flight takes both black men.',
    hint: 'From b1 the king flies up the long diagonal over e4, lands on f5, then turns to jump e6.',
    player: 0,
    within: 1,
    state: fromBoards(
      [
        rows(['........', '........', '........', '........', '........', '........', '........', '........']),
        rows(['........', '........', '........', '........', '........', '........', '........', '........']),
        rows(['........', '........', '....b...', '........', '....b...', '........', '........', '.R......']),
      ],
      { flyingKings: true },
    ),
    solution: [{ type: 'move', timeline: 0, move: { from: sq(0, 1), path: [sq(4, 5), sq(6, 3)], captures: [sq(3, 4), sq(5, 4)] } }],
  },
];

export function puzzleById(id: string): Puzzle | undefined {
  return PUZZLES.find((p) => p.id === id);
}

/**
 * Shared test fixtures. Not a test file: `testMatch` only picks up `*.test.ts`.
 */
import {
  Action,
  GameState,
  applyAction,
  latestBoard,
  legalMoves,
  newGame,
  pendingTimelines,
  piecesOf,
  travelTargets,
} from '../index';

/**
 * A game played by someone who takes a time travel whenever one is on offer -
 * every action legal and chosen one at a time, exactly as tapping through the
 * app produces them. It is how a real game grows its multiverse fastest, so it
 * is what the import caps have to be measured against.
 *
 * It asks for the travels of one piece at a time rather than enumerating every
 * action of every timeline, which is the same play an order of magnitude
 * cheaper to generate: 600 actions and 500 timelines in about two seconds
 * rather than half a minute. `stop` decides when the game has grown enough.
 */
export function travelHeavy(stop: (state: GameState) => boolean): GameState[] {
  const history: GameState[] = [newGame()];
  let nth = 0;
  while (!stop(history[history.length - 1])) {
    const state = history[history.length - 1];
    if (state.status !== 'playing') break;
    const action = travelFirst(state, nth++);
    if (!action) break;
    history.push(applyAction(state, action));
  }
  return history;
}

function travelFirst(state: GameState, nth: number): Action | null {
  for (const tl of pendingTimelines(state)) {
    for (const square of piecesOf(latestBoard(tl), state.toMove)) {
      const targets = travelTargets(state, tl.id, square);
      if (targets.length) return { type: 'travel', from: { timeline: tl.id, square }, to: targets[nth % targets.length] };
    }
  }
  for (const tl of pendingTimelines(state)) {
    const moves = legalMoves(latestBoard(tl), state.toMove, state.rules);
    if (moves.length) return { type: 'move', timeline: tl.id, move: moves[0] };
  }
  return null;
}

/** How many boards a state holds, across every timeline. */
export function boardsIn(state: GameState): number {
  return state.timelines.reduce((n, tl) => n + tl.boards.length, 0);
}

/** A game grown until it holds at least this many boards. */
export const grownTo = (boards: number): GameState[] => travelHeavy((s) => boardsIn(s) >= boards);

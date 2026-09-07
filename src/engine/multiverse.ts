/**
 * The multiverse: many checkers boards arranged into timelines, with pieces
 * that can travel into the past.
 *
 * Rules in one breath:
 *  - A timeline is a sequence of boards, one per turn. Red moves on even
 *    turns, Black on odd turns.
 *  - On your turn you must make one move on EVERY timeline whose newest
 *    board is waiting for you. Only then does the turn pass.
 *  - A move is either a normal checkers move (jumps are mandatory), or a time
 *    travel: lift one of your pieces off the newest board and put it on the
 *    same square of a past board where it was also your move. That past
 *    board branches into a brand-new timeline.
 *  - You win the moment your opponent has no pieces left on any board, or
 *    has a board waiting for them with nothing they can do on it.
 *  - Forty moves by each side with no capture, crowning, or time travel is
 *    a draw, so two kings can't chase each other forever.
 */
import {
  Board,
  DEFAULT_RULES,
  Move,
  Rules,
  applyMove,
  crownRow,
  rowOf,
  countPieces,
  initialBoard,
  legalMoves,
  moveTarget,
  pieceAt,
  piecesOf,
  placePiece,
  removePiece,
} from './board';
import { BoardRef, otherPlayer, Player, playerToMoveAt, sameRef } from './types';

export interface Timeline {
  id: number;
  /** Turn index of boards[0]. The root timeline starts at 0. */
  startTurn: number;
  boards: Board[];
  /** Who created this timeline by travelling. null for the root timeline. */
  createdBy: Player | null;
  /** The past board this timeline branched from. */
  branchedFrom: BoardRef | null;
  /** The board the travelling piece left. */
  origin: BoardRef | null;
}

export type Status = 'playing' | 'won' | 'draw';

/** Plies (one move by one player) without progress before the game is drawn. */
export const QUIET_PLIES_FOR_DRAW = 80;

export interface WinInfo {
  player: Player;
  board: BoardRef;
  reason: 'captured' | 'trapped';
}

export type Action =
  | { type: 'move'; timeline: number; move: Move }
  | { type: 'travel'; from: { timeline: number; square: number }; to: BoardRef };

export interface GameState {
  rules: Rules;
  timelines: Timeline[];
  toMove: Player;
  status: Status;
  win: WinInfo | null;
  /** Consecutive plies with no capture, crowning, or time travel. */
  quietPlies: number;
  /** Number of completed full turns (both players moved). Just for display. */
  round: number;
  lastAction: Action | null;
  /** Boards created by the last action, so the UI can highlight them. */
  lastCreated: BoardRef[];
}

export function newGame(rules: Partial<Rules> = {}): GameState {
  return {
    rules: { ...DEFAULT_RULES, ...rules },
    quietPlies: 0,
    timelines: [
      {
        id: 0,
        startTurn: 0,
        boards: [initialBoard()],
        createdBy: null,
        branchedFrom: null,
        origin: null,
      },
    ],
    toMove: 0,
    status: 'playing',
    win: null,
    round: 0,
    lastAction: null,
    lastCreated: [],
  };
}

export function timelineLabel(id: number): string {
  return `Timeline ${id + 1}`;
}

export function getTimeline(state: GameState, id: number): Timeline {
  const tl = state.timelines[id];
  if (!tl) throw new Error(`no timeline ${id}`);
  return tl;
}

export function latestTurn(tl: Timeline): number {
  return tl.startTurn + tl.boards.length - 1;
}

export function latestBoard(tl: Timeline): Board {
  return tl.boards[tl.boards.length - 1];
}

export function latestRef(tl: Timeline): BoardRef {
  return { timeline: tl.id, turn: latestTurn(tl) };
}

export function getBoard(state: GameState, ref: BoardRef): Board | undefined {
  const tl = state.timelines[ref.timeline];
  if (!tl) return undefined;
  return tl.boards[ref.turn - tl.startTurn];
}

export function isLatest(state: GameState, ref: BoardRef): boolean {
  const tl = state.timelines[ref.timeline];
  return !!tl && latestTurn(tl) === ref.turn;
}

/** The latest turn index anywhere in the multiverse. */
export function maxTurn(state: GameState): number {
  return Math.max(...state.timelines.map(latestTurn));
}

/** Timelines whose newest board is waiting for the current player to move. */
export function pendingTimelines(state: GameState): Timeline[] {
  if (state.status !== 'playing') return [];
  return state.timelines.filter((tl) => playerToMoveAt(latestTurn(tl)) === state.toMove);
}

export function isPending(state: GameState, ref: BoardRef): boolean {
  return isLatest(state, ref) && pendingTimelines(state).some((tl) => tl.id === ref.timeline);
}

/**
 * Past boards a piece may travel to from the newest board of `fromTimeline`.
 * A target must be strictly in the past, must not be the newest board of its
 * own timeline (you play those normally), must have been the traveller's
 * move, and must have the piece's square empty.
 */
export function travelTargets(state: GameState, fromTimeline: number, square: number): BoardRef[] {
  if (state.status !== 'playing') return [];
  const from = state.timelines[fromTimeline];
  if (!from) return [];
  const originTurn = latestTurn(from);
  const out: BoardRef[] = [];
  for (const tl of state.timelines) {
    const last = latestTurn(tl);
    tl.boards.forEach((board, i) => {
      const turn = tl.startTurn + i;
      if (turn >= originTurn) return;
      if (turn === last) return;
      if (playerToMoveAt(turn) !== state.toMove) return;
      if (pieceAt(board, square) !== null) return;
      out.push({ timeline: tl.id, turn });
    });
  }
  return out;
}

export function isTravelTarget(state: GameState, fromTimeline: number, square: number, ref: BoardRef): boolean {
  return travelTargets(state, fromTimeline, square).some((t) => sameRef(t, ref));
}

/** Legal checkers moves on the newest board of a timeline for the current player. */
export function legalMovesOn(state: GameState, timeline: number): Move[] {
  const tl = state.timelines[timeline];
  if (!tl) return [];
  return legalMoves(latestBoard(tl), state.toMove, state.rules);
}

/** True when the player to move can do anything at all on this timeline. */
export function hasAnyAction(state: GameState, timeline: number): boolean {
  if (legalMovesOn(state, timeline).length > 0) return true;
  const board = latestBoard(getTimeline(state, timeline));
  return piecesOf(board, state.toMove).some((sq) => travelTargets(state, timeline, sq).length > 0);
}

export class IllegalAction extends Error {}

function assertPending(state: GameState, timeline: number): Timeline {
  const tl = getTimeline(state, timeline);
  if (!pendingTimelines(state).some((p) => p.id === timeline)) {
    throw new IllegalAction(`${timelineLabel(timeline)} is not waiting for a move`);
  }
  return tl;
}

function sameMove(a: Move, b: Move): boolean {
  return (
    a.from === b.from &&
    a.path.length === b.path.length &&
    a.path.every((p, i) => p === b.path[i]) &&
    a.captures.length === b.captures.length &&
    a.captures.every((c, i) => c === b.captures[i])
  );
}

/** Apply an action. Throws IllegalAction when the move is not allowed. */
export function applyAction(state: GameState, action: Action): GameState {
  if (state.status !== 'playing') throw new IllegalAction('the game is over');
  const me = state.toMove;
  const timelines = state.timelines.map((tl) => ({ ...tl, boards: tl.boards.slice() }));
  const created: BoardRef[] = [];
  let quietPlies = 0;

  if (action.type === 'move') {
    const tl = assertPending(state, action.timeline);
    const board = latestBoard(tl);
    const legal = legalMoves(board, me, state.rules);
    if (!legal.some((m) => sameMove(m, action.move))) {
      const mustCapture = legal.some((m) => m.captures.length > 0) && action.move.captures.length === 0;
      throw new IllegalAction(mustCapture ? 'you must capture when you can' : 'that move is not legal');
    }
    timelines[tl.id].boards.push(applyMove(board, action.move));
    created.push(latestRef(timelines[tl.id]));
    const mover = pieceAt(board, action.move.from)!;
    const crowned = !mover.king && rowOf(moveTarget(action.move)) === crownRow(me);
    quietPlies = action.move.captures.length > 0 || crowned ? 0 : state.quietPlies + 1;
  } else {
    const from = assertPending(state, action.from.timeline);
    const originBoard = latestBoard(from);
    const piece = pieceAt(originBoard, action.from.square);
    if (!piece || piece.player !== me) {
      throw new IllegalAction('you can only send your own pieces back in time');
    }
    if (!isTravelTarget(state, from.id, action.from.square, action.to)) {
      throw new IllegalAction('that board cannot be travelled to');
    }
    const target = getBoard(state, action.to)!;
    const arrived = placePiece(target, action.from.square, piece);
    if (!arrived) throw new IllegalAction('that square is taken on the past board');

    timelines[from.id].boards.push(removePiece(originBoard, action.from.square));
    created.push(latestRef(timelines[from.id]));

    const branch: Timeline = {
      id: timelines.length,
      startTurn: action.to.turn + 1,
      boards: [arrived],
      createdBy: me,
      branchedFrom: { ...action.to },
      origin: latestRef(from),
    };
    timelines.push(branch);
    created.push(latestRef(branch));
  }

  const next: GameState = {
    ...state,
    timelines,
    quietPlies,
    lastAction: action,
    lastCreated: created,
  };

  // Wiping a side off any board ends the game. The mover's win takes
  // priority over the loss of moving your last piece away from a board.
  const them = otherPlayer(me);
  for (const ref of created) {
    if (countPieces(getBoard(next, ref)!, them) === 0) {
      return { ...next, status: 'won', win: { player: me, board: ref, reason: 'captured' } };
    }
  }
  for (const ref of created) {
    if (countPieces(getBoard(next, ref)!, me) === 0) {
      return { ...next, status: 'won', win: { player: them, board: ref, reason: 'captured' } };
    }
  }

  if (quietPlies >= QUIET_PLIES_FOR_DRAW) return { ...next, status: 'draw' };
  return resolveTurn(next);
}

/**
 * Pass the turn once the current player has nothing left to do. A player who
 * then has a waiting board with no legal move and no possible time travel
 * is trapped there and loses, just like running out of moves in checkers.
 */
export function resolveTurn(state: GameState): GameState {
  if (state.status !== 'playing') return state;
  if (pendingTimelines(state).length > 0) return state;
  const flipped: GameState = {
    ...state,
    toMove: otherPlayer(state.toMove),
    round: state.toMove === 1 ? state.round + 1 : state.round,
  };
  for (const tl of pendingTimelines(flipped)) {
    if (!hasAnyAction(flipped, tl.id)) {
      return {
        ...flipped,
        status: 'won',
        win: { player: otherPlayer(flipped.toMove), board: latestRef(tl), reason: 'trapped' },
      };
    }
  }
  return flipped;
}


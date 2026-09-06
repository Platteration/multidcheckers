/**
 * A single checkers board (8x8, American rules, simplified). Boards are
 * immutable value objects; every operation returns a new board.
 *
 * Cells are stored row-major with row 0 at the BOTTOM. Red starts at the
 * bottom and moves up; Black starts at the top and moves down. Only the dark
 * squares, where (row + col) is odd, are ever used.
 */
import type { Player } from './types';

export const SIZE = 8;
export const ROWS_OF_PIECES = 3;

export interface Piece {
  readonly player: Player;
  readonly king: boolean;
}

export type Cell = Piece | null;

export interface Board {
  readonly cells: readonly Cell[];
}

export function index(row: number, col: number): number {
  return row * SIZE + col;
}

export function rowOf(i: number): number {
  return Math.floor(i / SIZE);
}

export function colOf(i: number): number {
  return i % SIZE;
}

export function inBounds(row: number, col: number): boolean {
  return row >= 0 && row < SIZE && col >= 0 && col < SIZE;
}

/** Pieces live on the dark squares only. */
export function isPlayable(row: number, col: number): boolean {
  return (row + col) % 2 === 1;
}

export function emptyBoard(): Board {
  return { cells: Array<Cell>(SIZE * SIZE).fill(null) };
}

export function initialBoard(): Board {
  const cells = Array<Cell>(SIZE * SIZE).fill(null);
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (!isPlayable(r, c)) continue;
      if (r < ROWS_OF_PIECES) cells[index(r, c)] = { player: 0, king: false };
      else if (r >= SIZE - ROWS_OF_PIECES) cells[index(r, c)] = { player: 1, king: false };
    }
  }
  return { cells };
}

export function pieceAt(board: Board, at: number): Cell {
  return board.cells[at];
}

export function piecesOf(board: Board, player: Player): number[] {
  const out: number[] = [];
  board.cells.forEach((p, i) => {
    if (p && p.player === player) out.push(i);
  });
  return out;
}

export function countPieces(board: Board, player: Player): number {
  return piecesOf(board, player).length;
}

/** The row a player's men are crowned on. */
export function crownRow(player: Player): number {
  return player === 0 ? SIZE - 1 : 0;
}

/**
 * A complete move: the piece at `from` visits every square in `path` in order
 * (one square for a simple step, one per jump for a capture chain) and removes
 * every piece in `captures`.
 */
export interface Move {
  from: number;
  path: number[];
  captures: number[];
}

export function moveTarget(move: Move): number {
  return move.path[move.path.length - 1];
}

function directionsFor(piece: Piece): ReadonlyArray<readonly [number, number]> {
  if (piece.king) return [[1, -1], [1, 1], [-1, -1], [-1, 1]];
  const dr = piece.player === 0 ? 1 : -1;
  return [[dr, -1], [dr, 1]];
}

function simpleMoves(board: Board, from: number, piece: Piece): Move[] {
  const out: Move[] = [];
  const r = rowOf(from);
  const c = colOf(from);
  for (const [dr, dc] of directionsFor(piece)) {
    const rr = r + dr;
    const cc = c + dc;
    if (inBounds(rr, cc) && board.cells[index(rr, cc)] === null) {
      out.push({ from, path: [index(rr, cc)], captures: [] });
    }
  }
  return out;
}

/**
 * Every maximal capture chain for the piece at `from`. A chain must keep
 * jumping while a jump is available; reaching the crown row as a man ends
 * the chain (the piece is crowned and stops).
 */
function captureChains(board: Board, from: number, piece: Piece): Move[] {
  const out: Move[] = [];
  const visit = (at: number, path: number[], captured: number[]) => {
    const r = rowOf(at);
    const c = colOf(at);
    let extended = false;
    const crownedMidway = !piece.king && path.length > 0 && r === crownRow(piece.player);
    if (!crownedMidway) {
      for (const [dr, dc] of directionsFor(piece)) {
        const midR = r + dr;
        const midC = c + dc;
        const landR = r + dr * 2;
        const landC = c + dc * 2;
        if (!inBounds(landR, landC)) continue;
        const mid = index(midR, midC);
        const land = index(landR, landC);
        const victim = board.cells[mid];
        if (!victim || victim.player === piece.player || captured.includes(mid)) continue;
        // The landing square must be empty, except that a king may circle
        // back through its own starting square during a long chain.
        if (board.cells[land] !== null && land !== from) continue;
        if (path.includes(land)) continue;
        extended = true;
        visit(land, [...path, land], [...captured, mid]);
      }
    }
    if (!extended && path.length > 0) out.push({ from, path, captures: captured });
  };
  visit(from, [], []);
  return out;
}

/** Legal moves for one piece, ignoring the must-capture rule. */
export function rawMovesForPiece(board: Board, from: number): Move[] {
  const piece = board.cells[from];
  if (!piece) return [];
  const captures = captureChains(board, from, piece);
  return captures.length ? captures : simpleMoves(board, from, piece);
}

/**
 * All legal moves for a player. Capturing is mandatory: when any piece can
 * jump, only jumps are legal.
 */
export function legalMoves(board: Board, player: Player): Move[] {
  const all: Move[] = [];
  for (const from of piecesOf(board, player)) {
    all.push(...rawMovesForPiece(board, from));
  }
  const captures = all.filter((m) => m.captures.length > 0);
  return captures.length ? captures : all;
}

export function movesForPiece(board: Board, player: Player, from: number): Move[] {
  return legalMoves(board, player).filter((m) => m.from === from);
}

export function applyMove(board: Board, move: Move): Board {
  const piece = board.cells[move.from];
  if (!piece) throw new Error('no piece to move');
  const cells = board.cells.slice();
  cells[move.from] = null;
  for (const c of move.captures) cells[c] = null;
  const to = moveTarget(move);
  const king = piece.king || rowOf(to) === crownRow(piece.player);
  cells[to] = { player: piece.player, king };
  return { cells };
}

export function removePiece(board: Board, at: number): Board {
  const cells = board.cells.slice();
  cells[at] = null;
  return { cells };
}

/** Put a piece on an empty square. Returns null when the square is taken. */
export function placePiece(board: Board, at: number, piece: Piece): Board | null {
  if (board.cells[at] !== null) return null;
  const cells = board.cells.slice();
  // A man arriving on its crown row is crowned on the spot.
  cells[at] = { player: piece.player, king: piece.king || rowOf(at) === crownRow(piece.player) };
  return { cells };
}

/**
 * Build a board from rows of text, top row first.
 * 'r' red man, 'R' red king, 'b' black man, 'B' black king, '.' empty.
 */
export function boardFromRows(rows: readonly string[]): Board {
  if (rows.length !== SIZE) throw new Error(`expected ${SIZE} rows`);
  const cells = Array<Cell>(SIZE * SIZE).fill(null);
  rows.forEach((text, i) => {
    const row = SIZE - 1 - i;
    const chars = text.replace(/\s+/g, '');
    if (chars.length !== SIZE) throw new Error(`expected ${SIZE} columns in "${text}"`);
    for (let c = 0; c < SIZE; c++) {
      const ch = chars[c];
      const piece: Cell =
        ch === 'r' ? { player: 0, king: false }
        : ch === 'R' ? { player: 0, king: true }
        : ch === 'b' ? { player: 1, king: false }
        : ch === 'B' ? { player: 1, king: true }
        : null;
      cells[index(row, c)] = piece;
    }
  });
  return { cells };
}

/**
 * Small pure helpers for the screen. They are kept free of React (and of any
 * React Native import) so that the rules they encode - what the map may be
 * told while a piece is held, when a link may replace the game, what a square
 * is called - can be tested on their own. Each one exists because getting it
 * wrong broke this app or its twin. The bot's own guard is `botShouldAct` in
 * app/setup.ts, beside the save format it reads.
 */
import { BoardRef, GameState, latestRefIn } from '../engine';
import type { Selection } from './useGame';

/**
 * The board a picked-up piece would leave, so the map can mark it. Null while
 * replaying: the state on screen is an earlier one that may not have the
 * timeline the piece is held on, and asking for a timeline that does not exist
 * throws. Nothing in replay mode uses the origin anyway.
 */
export function travelOrigin(state: GameState, selection: Selection, replaying: boolean): BoardRef | null {
  if (replaying || selection.kind === 'none') return null;
  return latestRefIn(state, selection.from.timeline);
}

/**
 * Whether a game arriving by link should be confirmed before it replaces the
 * one on screen. The app's own scheme is registered with no host and no path,
 * so any other app, any QR code and any web page can hand it a game code, and
 * loading one throws the game in progress away for good: the autosave writes
 * the replacement over it a moment later. A game nobody has moved in yet is
 * worth nothing, so that is the only one a link may take without asking.
 */
export function linkNeedsConfirming(historyLength: number): boolean {
  return historyLength > 1;
}

/**
 * What a screen reader calls one square: its file and rank, the piece on it,
 * and whether the held piece may land there. Anything that is not a piece of
 * one of the two players is an empty square: the board type says a cell holds
 * a piece or null, but a value read out of a board must not be able to take
 * the app down.
 */
export function squareLabel(
  row: number,
  col: number,
  piece: unknown,
  names: readonly [string, string],
  destination?: { capture: boolean } | null,
): string {
  let label = `${String.fromCharCode(97 + col)}${row + 1}`;
  const p = piece as { player?: unknown; king?: unknown } | null | undefined;
  if (p && typeof p === 'object' && (p.player === 0 || p.player === 1)) {
    label += `, ${names[p.player]} ${p.king ? 'king' : 'man'}`;
  }
  if (destination) label += destination.capture ? ', jump here' : ', move here';
  return label;
}

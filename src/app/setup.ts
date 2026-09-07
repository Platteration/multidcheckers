import type { Bot, GameState, Player } from '../engine';

/**
 * How a game is being played: two people sharing the phone, one person
 * against a bot, or one person solving a puzzle (with the strongest bot
 * answering for the other side).
 */
export interface GameSetup {
  mode: 'local' | 'bot' | 'puzzle';
  bot?: Bot;
  /** Puzzle mode only. */
  puzzleId?: string;
  within?: number;
  player?: Player;
}

export const DEFAULT_SETUP: GameSetup = { mode: 'local' };

export interface SavedGame {
  version: 2;
  history: GameState[];
  setup: GameSetup;
}

export function looksLikeSavedGame(v: unknown): v is SavedGame | { version: 1; history: GameState[] } {
  const s = v as { version?: number; history?: unknown };
  return !!s && (s.version === 1 || s.version === 2) && Array.isArray(s.history) && s.history.length > 0;
}

export function normaliseSaved(v: SavedGame | { version: 1; history: GameState[] }): { history: GameState[]; setup: GameSetup } {
  return { history: v.history, setup: 'setup' in v ? v.setup : DEFAULT_SETUP };
}

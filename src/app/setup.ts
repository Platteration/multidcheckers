import type { Bot, Player } from '../engine';
import { Action, GameState, Rules, applyAction, newGame } from '../engine';
import { puzzleById } from '../puzzles';

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

/**
 * Whether the computer, not a person, is expected to act on this state. The
 * replay view shows an earlier state read-only, so the bot never acts there.
 */
export function botShouldAct(setup: GameSetup, state: GameState, replaying: boolean): boolean {
  if (!setup.bot || replaying) return false;
  return state.status === 'playing' && state.toMove === setup.bot.player;
}

/**
 * Whether the game-over sheet should be showing. Like the bot, it reads the
 * LIVE game: the replay of a finished game walks back through states whose
 * status is 'playing', so reading the replayed state would clear the dismissal
 * on the way back and pop the sheet again over the replay bar at the end.
 */
export function gameOverVisible(live: GameState, puzzle: boolean, replaying: boolean, dismissed: boolean): boolean {
  if (puzzle || replaying || dismissed) return false;
  return live.status !== 'playing';
}

/** Just the actions of a game, oldest first: enough to replay it from its start. */
export function actionsOf(history: GameState[]): Action[] {
  return history.slice(1).map((s) => s.lastAction).filter((a): a is Action => !!a);
}

/**
 * The autosave: only the actions, never the states. Every GameState holds every
 * board of every timeline, and JSON.stringify expands the boards that are shared
 * by reference in memory, so writing the history grows with the square of the
 * number of moves and quietly passes the storage quota on a long game.
 */
export interface SavedGame {
  version: 3;
  actions: Action[];
  rules: Rules;
  setup: GameSetup;
}

/** The shape written before the actions-only save. Still read, never written. */
interface SavedGameV2 {
  version: 2;
  history: GameState[];
  setup: GameSetup;
}

type AnySaved = SavedGame | SavedGameV2 | { version: 1; history: GameState[] };

/**
 * What the autosave should write for this game, or null to clear it. A finished
 * game is not kept: it has already been folded into the record, and restoring it
 * on the next launch would fold it in again.
 */
export function savePayload(history: GameState[], setup: GameSetup): SavedGame | null {
  if (history.length <= 1) return null;
  if (history[history.length - 1].status !== 'playing') return null;
  return { version: 3, actions: actionsOf(history), rules: history[0].rules, setup };
}

export function looksLikeSavedGame(v: unknown): v is AnySaved {
  const s = v as { version?: number; history?: unknown; actions?: unknown };
  if (!s) return false;
  if (s.version === 3) return Array.isArray(s.actions);
  return (s.version === 1 || s.version === 2) && Array.isArray(s.history) && s.history.length > 0;
}

/**
 * The rule variants as booleans of our own making. Saved games and shared codes
 * both carry them, and both come from outside, so nothing else reaches newGame:
 * `{"flyingKings": 1}` would otherwise turn the variant on.
 */
export function cleanRules(v: unknown): Partial<Rules> {
  const r = (v ?? {}) as Partial<Rules>;
  return { flyingKings: !!r.flyingKings, backCapture: !!r.backCapture, strictPresent: !!r.strictPresent };
}

/**
 * Turn a saved game back into a history, or null when it cannot be replayed.
 * Storage can hold anything, so every action goes through the engine.
 */
export function normaliseSaved(v: AnySaved): { history: GameState[]; setup: GameSetup } | null {
  if (v.version !== 3) {
    const history = v.history;
    if (!Array.isArray(history) || history.length === 0) return null;
    return { history, setup: 'setup' in v && v.setup ? v.setup : DEFAULT_SETUP };
  }
  const setup = v.setup && typeof v.setup === 'object' ? v.setup : DEFAULT_SETUP;
  const start =
    setup.mode === 'puzzle' && setup.puzzleId ? puzzleById(setup.puzzleId)?.state : newGame(cleanRules(v.rules));
  if (!start) return null;
  const history: GameState[] = [start];
  try {
    for (const action of v.actions) history.push(applyAction(history[history.length - 1], action));
  } catch {
    return null;
  }
  return { history, setup };
}

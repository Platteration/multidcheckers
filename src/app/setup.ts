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

/**
 * A long game is a few hundred actions; this is well past any of them. A pasted
 * code and a stored game both replay an action list from outside the app, so
 * the cap belongs to the replay rather than to either of them: an action can be
 * as little as 25 bytes of code, so thousands of them fit inside a code's byte
 * cap and only a count stops them.
 */
export const MAX_ACTIONS = 2000;

export function looksLikeSavedGame(v: unknown): v is AnySaved {
  const s = v as { version?: number; history?: unknown; actions?: unknown };
  if (!s) return false;
  // A stored list is as much outside input as a pasted code is, and it is
  // replayed the same way, so it gets the same cap. The older shape held one
  // state per action plus the one the game started from.
  if (s.version === 3) return Array.isArray(s.actions) && s.actions.length <= MAX_ACTIONS;
  return (
    (s.version === 1 || s.version === 2) &&
    Array.isArray(s.history) &&
    s.history.length > 0 &&
    s.history.length <= MAX_ACTIONS + 1
  );
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
 * The setup as values of our own making, the way cleanRules does the rules. A
 * saved game carries it and storage can hold anything, so nothing else reaches
 * the app: `mode` decides whether the bot plays at all, `bot.level` picks its
 * search and indexes BOT_NAMES, and `bot.player` decides whose turn is the
 * person's. An unknown puzzle is dropped rather than guessed at.
 */
export function cleanSetup(v: unknown): GameSetup {
  const s = (v ?? {}) as Partial<GameSetup>;
  const setup: GameSetup = { mode: s.mode === 'bot' || s.mode === 'puzzle' ? s.mode : 'local' };
  const bot = s.bot;
  if (bot && (bot.level === 1 || bot.level === 2 || bot.level === 3) && (bot.player === 0 || bot.player === 1)) {
    setup.bot = { level: bot.level, player: bot.player };
  }
  if (setup.mode === 'puzzle') {
    const puzzle = typeof s.puzzleId === 'string' ? puzzleById(s.puzzleId) : undefined;
    if (puzzle) setup.puzzleId = puzzle.id;
    if (typeof s.within === 'number' && Number.isFinite(s.within)) setup.within = s.within;
    if (s.player === 0 || s.player === 1) setup.player = s.player;
  }
  return setup;
}

/**
 * The actions of a saved game, whatever shape it was written in. The older save
 * wrote whole states, and those are no more trustworthy than anything else in
 * storage, so only the actions are taken out of them: the states themselves are
 * dropped and rebuilt by the replay below.
 */
function savedActions(v: AnySaved): Action[] | null {
  if (v.version === 3) return Array.isArray(v.actions) ? v.actions : null;
  const states = v.history as (Partial<GameState> | null)[] | undefined;
  if (!Array.isArray(states) || states.length === 0) return null;
  return states.slice(1).map((s) => s?.lastAction).filter((a): a is Action => !!a);
}

/**
 * Turn a saved game back into a history, or null when it cannot be replayed.
 * Storage can hold anything, so nothing in the record is trusted: the setup is
 * rebuilt from known values, the rules are read as booleans, and every action -
 * including one taken out of an older save's states - goes through the engine.
 *
 * Deliberately without the multiverse ceiling decodeGame applies. A code is
 * somebody else's game arriving in one step, so refusing an outsized one costs
 * the player nothing they had; this is the player's own game, every state of
 * which they reached one action at a time and watched the map draw, so refusing
 * it deletes their work. What bounds this path instead is MAX_ACTIONS, the
 * rules themselves - a game that takes a time travel at every chance draws
 * after 731 actions, at 548 timelines and 1279 boards, which is the most any
 * legal action list can reach - and the map, which draws only the part of
 * itself the screen is over. That worst case replays in under 250 ms and draws
 * 5,698 nodes. An oversized code can no longer reach this path at all: it is
 * refused before there is a game to save.
 */
export function normaliseSaved(v: AnySaved): { history: GameState[]; setup: GameSetup } | null {
  const actions = savedActions(v);
  if (!actions || actions.length > MAX_ACTIONS) return null;
  const setup = cleanSetup('setup' in v ? v.setup : undefined);
  const rules = v.version === 3 ? v.rules : (v.history as (Partial<GameState> | null)[])[0]?.rules;
  const start = setup.mode === 'puzzle' ? puzzleById(setup.puzzleId ?? '')?.state : newGame(cleanRules(rules));
  if (!start) return null;
  const history: GameState[] = [start];
  try {
    for (const action of actions) history.push(applyAction(history[history.length - 1], action));
  } catch {
    return null;
  }
  return { history, setup };
}

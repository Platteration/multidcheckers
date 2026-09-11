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
 * What the autosave should do for this game. Three answers and not two, because
 * a record that must not be written is not the same as one that should be
 * removed: reading the refusal as "clear it" is what turned a game too long to
 * store into a game deleted from the device.
 */
export type SaveDecision =
  /** Write this record over whatever is stored. */
  | { kind: 'write'; payload: SavedGame }
  /** Remove the record: there is nothing to come back to. */
  | { kind: 'clear' }
  /** Leave whatever is stored alone, and say why when the player should know. */
  | { kind: 'keep'; problem: string | null };

/**
 * A finished game is not kept: it has already been folded into the record, and
 * restoring it on the next launch would fold it in again. A game longer than
 * the replay will accept is not written either - and not removed: the record
 * already on the device is the same game, up to the last action that fit, and
 * it is the only copy the player has.
 *
 * `mayClear` is false while there is a stored record this launch could not
 * read (see `restoreSaved`). Nothing was restored from it, so the game on
 * screen is a fresh one the player has not played yet, and removing the record
 * to match it would delete their last game for them.
 */
export function saveDecision(history: GameState[], setup: GameSetup, mayClear = true): SaveDecision {
  const nothingToSave = history.length <= 1 || history[history.length - 1].status !== 'playing';
  if (nothingToSave) return mayClear ? { kind: 'clear' } : { kind: 'keep', problem: null };
  const actions = actionsOf(history);
  // Bounded where the list is written, not only where it is read. The read-side
  // cap refuses a record this long, and a refusal at launch cannot ask the
  // player anything: it lands on a game they can no longer see.
  if (actions.length > MAX_ACTIONS) {
    return {
      kind: 'keep',
      problem: `This game is longer than the app can store, so the copy on this device stops at move ${MAX_ACTIONS}.`,
    };
  }
  return { kind: 'write', payload: { version: 3, actions, rules: history[0].rules, setup } };
}

/**
 * How many actions either path will replay. A pasted code and a stored game
 * both replay an action list from outside the app, so the cap belongs to the
 * replay rather than to either of them: an action can be as little as 25 bytes
 * of code, so thousands of them fit inside a code's byte cap and only a count
 * stops them.
 *
 * Sized from measured play rather than from a guess at what is "a long game":
 * the strongest bot playing itself to the end of a complete game takes about
 * 1,560 actions (177 timelines, 1,738 boards, no adversary and no unusual
 * play), so this leaves a quarter as much again on top of the longest game the
 * app itself can produce. It is not free headroom: a legal 2,000-action list
 * can build well over a thousand timelines, and `normaliseSaved` says what that
 * costs. Passing it does not delete the player's game - `saveDecision` keeps
 * the stored record and says so while the game is still in front of them.
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
  // `mode` decides whether the computer plays, so a bot only survives in a mode
  // that has one: a stored {mode:'local', bot:{...}} would otherwise rebuild as
  // a game the computer plays and the rest of the app calls local.
  if (
    setup.mode !== 'local' &&
    bot &&
    (bot.level === 1 || bot.level === 2 || bot.level === 3) &&
    (bot.player === 0 || bot.player === 1)
  ) {
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
 * it deletes their work.
 *
 * What bounds this path is MAX_ACTIONS and nothing else, and the size that
 * admits is worth writing down honestly, because the numbers that used to be
 * here were wrong. "A game that travels at every chance draws after 731 actions
 * at 548 timelines and 1,279 boards, which is the most any legal action list
 * can reach, and that replays in under 250 ms" is not a maximum: it is one
 * line's draw. Measured:
 *
 *   - The strongest bot playing itself to the end of a game - no adversary, no
 *     unusual play - takes 1,561 actions and reaches 177 timelines and 1,738
 *     boards. That is already past the "most" above on two of its three counts.
 *   - Searching for the fastest-growing legal line found one that runs to 1,634
 *     actions, 1,372 timelines and 3,006 boards before it draws: a 133 kB
 *     record, accepted by looksLikeSavedGame, replayed here in 1.3 s, and drawn
 *     by the windowed map as some 8,300 nodes in about 2 s in a node test
 *     harness. A line that reached the 2,000-action cap would be larger again.
 *
 * The decision stands on those numbers rather than the old ones. Seconds at
 * launch are worse than a quarter of a second, and they are still better than
 * deleting a game somebody played: the alternative is a ceiling that throws
 * away the work of any player whose own game outgrew it, which is exactly what
 * the import ceiling did to sharing until it was resized. What makes seconds
 * the worst case rather than the start of one is that the write side is bounded
 * too (`saveDecision`), so the app cannot store a longer game than this even if
 * one is played; an oversized code cannot reach this path at all, being refused
 * before there is a game to save; and a record that is refused here is kept
 * rather than deleted (`restoreSaved`), so being wrong about the bound costs a
 * slow launch and not somebody's game.
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

/**
 * What a value read out of storage is worth at launch. Three answers and not
 * two, for the same reason `saveDecision` gives three: a record that is there
 * but cannot be replayed is not the absence of a record. It is the player's
 * last game in a shape this build will not take - too long for the replay,
 * written by a later version, or damaged - and the app must not treat it as an
 * empty slot and write a fresh game over it.
 */
export type Restored =
  | { kind: 'game'; history: GameState[]; setup: GameSetup }
  | { kind: 'none' }
  | { kind: 'unreadable' };

export function restoreSaved(v: unknown): Restored {
  if (v === null || v === undefined) return { kind: 'none' };
  const game = looksLikeSavedGame(v) ? normaliseSaved(v) : null;
  if (!game) return { kind: 'unreadable' };
  return { kind: 'game', history: game.history, setup: game.setup };
}

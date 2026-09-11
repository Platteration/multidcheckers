/**
 * Game codes: a whole game squeezed into a string you can paste into a
 * message. Only the actions are stored; loading replays them through the
 * engine, so a tampered code simply fails to load.
 */
import { Action, GameState, Rules, applyAction, newGame } from '../engine';
import { decode, encode } from './base64';
import { DEFAULT_SETUP, GameSetup, MAX_ACTIONS, actionsOf, cleanRules } from './setup';

export { actionsOf };

const PREFIX = '5DCK.';

/** A code for a real game is a few kB. Anything larger is not worth decoding. */
const MAX_CODE_LENGTH = 64 * 1024;

/**
 * How large a multiverse an imported code may build. Neither cap above bounds
 * the result on its own: a time travel adds a board to the timeline it leaves
 * AND forks a new one, so a code buys more multiverse per byte with travels
 * than with anything else, and a code inside both of them still replays into
 * some 500 timelines and 1,100 boards.
 *
 * Sized by measuring the play that grows fastest, not a bot game. A player who
 * takes a time travel at every chance - one action at a time, exactly as
 * tapping through the app produces them - crosses 950 boards after 526 actions,
 * at 424 timelines and 56.9 kB of code, and fills the 64 kB byte cap around
 * action 604, by then holding 500 timelines and 1,102 boards. So these sit just
 * under what the byte cap can deliver: they are what refuses an oversized
 * import, and what the map is then asked to draw stays inside the 513 timelines
 * / 1,115 boards the windowed map was measured at (5,620 nodes, 2.3 s in a node
 * test harness).
 *
 * A travel adds one timeline and two boards, so the two caps sit either side of
 * that ratio and each half is the one that fires for a different kind of game:
 * play with ordinary moves in it crosses the board cap first, a line of nothing
 * but travels crosses the timeline cap first.
 *
 * The numbers they replace (96 timelines / 600 boards) were sized from bot
 * games, which travel far less than a person does: they refused a game played
 * by hand after 122 actions, five rounds in, while the sending end cheerfully
 * handed out the code that nobody could then load. `shareOffer` applies every
 * one of these caps at that end too, so a refusal now reaches the player who
 * can still do something about it. The saved game deliberately has no such
 * ceiling; `normaliseSaved` says why.
 */
export const MAX_TIMELINES = 450;
export const MAX_BOARDS = 950;

/** How many boards a state holds, across every timeline. */
function boardCount(state: GameState): number {
  let boards = 0;
  for (const tl of state.timelines) boards += tl.boards.length;
  return boards;
}

/**
 * Whether a replayed game has grown past what an import may hand this app.
 * Both halves matter: travels grow the timelines, ordinary moves grow only the
 * boards, and either on its own is enough to make a map too big to draw.
 */
export function tooLargeToDraw(state: GameState): boolean {
  return state.timelines.length > MAX_TIMELINES || boardCount(state) > MAX_BOARDS;
}

interface Payload {
  v: 1;
  r: Rules;
  m: GameSetup['mode'];
  a: Action[];
}

export function encodeGame(history: GameState[], setup: GameSetup): string {
  const payload: Payload = { v: 1, r: history[0].rules, m: setup.mode === 'puzzle' ? 'local' : setup.mode, a: actionsOf(history) };
  return PREFIX + encode(JSON.stringify(payload));
}

/** The game as a code to send, or why this game cannot be sent as one. */
export interface ShareOffer {
  /** The code, or null when there is nothing to send or it would not load. */
  code: string | null;
  /** What to tell the sender, when a game they played cannot be sent. */
  problem: string | null;
}

/**
 * What the share sheet may offer. Every cap `decodeGame` applies is applied
 * here as well, to the sender's own live game: a code that would be refused at
 * the other end is never handed out, because a player cannot un-grow a game
 * and neither side would ever be able to load what they sent. The multiverse
 * only grows - actions append boards and timelines and never remove them - so
 * checking the last state is checking every state the replay will pass through.
 */
export function shareOffer(history: GameState[], setup: GameSetup): ShareOffer {
  // A puzzle is the app's own position, not a game to hand on, and a game
  // nobody has moved in yet is nothing to send.
  if (history.length <= 1 || setup.mode === 'puzzle') return { code: null, problem: null };
  const state = history[history.length - 1];
  if (actionsOf(history).length > MAX_ACTIONS) {
    return { code: null, problem: 'This game has more moves than a code can carry, so it cannot be sent. You can still play it here.' };
  }
  if (tooLargeToDraw(state)) {
    return {
      code: null,
      problem: 'This game has grown more timelines and boards than a code can carry, so it cannot be sent. You can still play it here.',
    };
  }
  const code = encodeGame(history, setup);
  if (code.length > MAX_CODE_LENGTH) {
    return { code: null, problem: 'This game has grown too long to send as a code. You can still play it here.' };
  }
  return { code, problem: null };
}

export function decodeGame(code: string): { history: GameState[]; setup: GameSetup } {
  // Replaying a code costs a whole GameState per action, and every timeline is
  // copied into each one, so an entirely legal code can still be far too big to
  // load, save and draw. Refuse the oversized ones before doing any of the work.
  if (code.length > MAX_CODE_LENGTH) throw new Error('That game is too large to load.');
  // Codes are long, and chat clients, email and terminals all wrap long tokens.
  // No whitespace belongs to the alphabet, so drop all of it rather than only
  // the ends: a code that survived a round trip through a message still loads.
  const trimmed = code.replace(/\s+/g, '');
  if (!trimmed.startsWith(PREFIX)) throw new Error('This is not a 5D Checkers game code.');
  let payload: Payload;
  try {
    payload = JSON.parse(decode(trimmed.slice(PREFIX.length))) as Payload;
  } catch {
    throw new Error('That code is damaged and cannot be read.');
  }
  if (payload.v !== 1 || !Array.isArray(payload.a)) throw new Error('That code is from a version this app cannot read.');
  // Its own message, not the byte cap's: only one of the two guards can have
  // fired, and both the reader and the tests should be able to tell which.
  if (payload.a.length > MAX_ACTIONS) throw new Error('That game has too many moves to load.');
  // The sender picks the rule variants, so they are read as booleans of our own
  // making: nothing else from the payload reaches the engine's rules.
  const history: GameState[] = [newGame(cleanRules(payload.r))];
  for (const action of payload.a) {
    try {
      history.push(applyAction(history[history.length - 1], action));
    } catch {
      throw new Error('That code contains a move that is not legal.');
    }
    // Check the size that actually costs, and check it as the replay grows
    // rather than once it has finished growing.
    if (tooLargeToDraw(history[history.length - 1])) throw new Error('That game has grown too large for this app to draw.');
  }
  return { history, setup: payload.m === 'bot' ? { mode: 'local' } : DEFAULT_SETUP };
}

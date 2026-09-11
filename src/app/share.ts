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
 * How large a multiverse an imported code may build. The two caps above are
 * counted on the code and neither bounds the result: a time travel adds a board
 * to the timeline it leaves AND forks a new one, so ~78 bytes of code buys two
 * boards and a whole timeline, and a code inside both caps still replays into
 * 502 timelines and 1107 boards. Sized from real play: 120 actions against the
 * strongest bot make 36 timelines and 156 boards, and 400 of them - far longer
 * than any game played by hand - make 78 and 478, so nothing a friend actually
 * played and sent is refused. The saved game deliberately has no such ceiling;
 * normaliseSaved says why.
 */
const MAX_TIMELINES = 96;
const MAX_BOARDS = 600;

/** Whether a replayed game has grown past what an import may hand this app. */
function tooLargeToDraw(state: GameState): boolean {
  if (state.timelines.length > MAX_TIMELINES) return true;
  let boards = 0;
  for (const tl of state.timelines) boards += tl.boards.length;
  return boards > MAX_BOARDS;
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

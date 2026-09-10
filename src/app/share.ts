/**
 * Game codes: a whole game squeezed into a string you can paste into a
 * message. Only the actions are stored; loading replays them through the
 * engine, so a tampered code simply fails to load.
 */
import { Action, GameState, Rules, applyAction, newGame } from '../engine';
import { decode, encode } from './base64';
import { DEFAULT_SETUP, GameSetup, actionsOf, cleanRules } from './setup';

export { actionsOf };

const PREFIX = '5DCK.';

/** A code for a real game is a few kB. Anything larger is not worth decoding. */
const MAX_CODE_LENGTH = 64 * 1024;
/**
 * A long game is a few hundred actions; this is well past any of them. This is
 * not the byte cap in disguise: an action can be as little as 25 bytes of code,
 * so thousands of them fit inside 64 kB and only a count stops them.
 */
const MAX_ACTIONS = 2000;

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
  }
  return { history, setup: payload.m === 'bot' ? { mode: 'local' } : DEFAULT_SETUP };
}

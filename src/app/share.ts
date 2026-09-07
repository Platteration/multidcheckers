/**
 * Game codes: a whole game squeezed into a string you can paste into a
 * message. Only the actions are stored; loading replays them through the
 * engine, so a tampered code simply fails to load.
 */
import { Action, GameState, Rules, applyAction, newGame } from '../engine';
import { decode, encode } from './base64';
import { DEFAULT_SETUP, GameSetup } from './setup';

const PREFIX = '5DCK.';

interface Payload {
  v: 1;
  r: Rules;
  m: GameSetup['mode'];
  a: Action[];
}

export function actionsOf(history: GameState[]): Action[] {
  return history.slice(1).map((s) => s.lastAction).filter((a): a is Action => !!a);
}

export function encodeGame(history: GameState[], setup: GameSetup): string {
  const payload: Payload = { v: 1, r: history[0].rules, m: setup.mode === 'puzzle' ? 'local' : setup.mode, a: actionsOf(history) };
  return PREFIX + encode(JSON.stringify(payload));
}

export function decodeGame(code: string): { history: GameState[]; setup: GameSetup } {
  const trimmed = code.trim();
  if (!trimmed.startsWith(PREFIX)) throw new Error('This is not a 5D Checkers game code.');
  let payload: Payload;
  try {
    payload = JSON.parse(decode(trimmed.slice(PREFIX.length))) as Payload;
  } catch {
    throw new Error('That code is damaged and cannot be read.');
  }
  if (payload.v !== 1 || !Array.isArray(payload.a)) throw new Error('That code is from a version this app cannot read.');
  const history: GameState[] = [newGame(payload.r)];
  for (const action of payload.a) {
    try {
      history.push(applyAction(history[history.length - 1], action));
    } catch {
      throw new Error('That code contains a move that is not legal.');
    }
  }
  return { history, setup: payload.m === 'bot' ? { mode: 'local' } : DEFAULT_SETUP };
}

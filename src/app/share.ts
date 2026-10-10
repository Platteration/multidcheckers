/**
 * Game codes: a whole game squeezed into a string you can paste into a
 * message. Only the actions are stored; loading replays them through the
 * engine, so a tampered code simply fails to load.
 */
import { Action, GameState, Rules, applyAction, newGame } from '../engine';
import { decode, encode } from './base64';
import { DEFAULT_SETUP, GameSetup } from './setup';

const PREFIX = '5DCK.';
const MAX_CODE_BYTES = 100000;
const MAX_CODE_CHARS = 140000;
const MAX_GAME_ACTIONS = 4000;

function safeParse<T>(text: string): T {
  return JSON.parse(text, (key, value) => {
    return key === '__proto__' || key === 'constructor' || key === 'prototype' ? undefined : value;
  }) as T;
}

interface Payload {
  v: 1;
  r: Rules;
  m: GameSetup['mode'];
  a: Action[];
}

function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

function isBoardRef(value: unknown): value is { timeline: number; turn: number } {
  if (!value || typeof value !== 'object') return false;
  const ref = value as Record<string, unknown>;
  return isInteger(ref.timeline) && ref.timeline >= 0 && isInteger(ref.turn) && ref.turn >= 0;
}

function isMove(value: unknown): value is { from: number; path: number[]; captures: number[] } {
  if (!value || typeof value !== 'object') return false;
  const move = value as Record<string, unknown>;
  const validSquare = (square: unknown): square is number => isInteger(square) && square >= 0 && square < 64;
  return validSquare(move.from) && Array.isArray(move.path) && move.path.length > 0 && move.path.length <= 64 && move.path.every(validSquare)
    && Array.isArray(move.captures) && move.captures.length <= 32 && move.captures.every(validSquare);
}

/** Validate the JSON shape before handing untrusted data to the engine. */
function isAction(value: unknown): value is Action {
  if (!value || typeof value !== 'object') return false;
  const action = value as Record<string, unknown>;
  switch (action.type) {
    case 'move':
      return isInteger(action.timeline) && action.timeline >= 0 && isMove(action.move);
    case 'travel': {
      const from = action.from;
      if (!from || typeof from !== 'object') return false;
      const ref = from as Record<string, unknown>;
      return isInteger(ref.timeline) && ref.timeline >= 0 && isInteger(ref.square)
        && ref.square >= 0 && ref.square < 64 && isBoardRef(action.to);
    }
    case 'endTurn':
      return true;
    default:
      return false;
  }
}

function cleanRules(value: unknown): Rules {
  if (!value || typeof value !== 'object') return { flyingKings: false, backCapture: false, strictPresent: false };
  const rules = value as Record<string, unknown>;
  return { flyingKings: rules.flyingKings === true, backCapture: rules.backCapture === true, strictPresent: rules.strictPresent === true };
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
  if (trimmed.length > MAX_CODE_CHARS) throw new Error('That code is too long to load safely.');
  let payload: Payload;
  try {
    const payloadText = decode(trimmed.slice(PREFIX.length));
    if (payloadText.length > MAX_CODE_BYTES) throw new Error('That code is too long to load safely.');
    payload = safeParse<Payload>(payloadText);
  } catch {
    throw new Error('That code is damaged and cannot be read.');
  }
  if (!payload || typeof payload !== 'object' || payload.v !== 1 || !Array.isArray(payload.a)) throw new Error('That code is from a version this app cannot read.');
  if (payload.a.length > MAX_GAME_ACTIONS) throw new Error('That code is too long to load safely.');
  if (!payload.a.every(isAction)) throw new Error('That code contains an invalid move.');
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

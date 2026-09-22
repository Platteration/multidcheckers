/**
 * Records loaded from storage are untrusted: they may come from an older build
 * (missing fields), a newer one (unknown values), or a hand-edited store — on
 * the web build every key is plain localStorage, on an origin shared with every
 * other app the account publishes. A bare spread of the parsed object passes
 * every value on as it is: a stored `theme` of `"__proto__"` reached
 * `buildTheme`, which indexed the piece set's accent table with it and handed
 * every screen `Object.prototype` as the player colours; a `records` of `null`
 * passed the stats guard and threw the moment the record sheet opened.
 *
 * Everything here clamps to a known value instead, field by field, so one bad
 * field never costs the rest of the record. The tables are `Record<Union, true>`
 * so that adding a member to a type without adding it here fails `tsc`, and
 * every lookup is an own-property one: on a plain object `constructor`,
 * `toString` and `__proto__` are all truthy through `in` or `TABLE[key]`.
 *
 * Only the defaults live elsewhere: they are passed in, because `settings.tsx`
 * and the other providers pull in React and this module must stay free of
 * React Native and the DOM so a plain test can import it.
 */
import { DEFAULT_RULES, type Rules } from '../engine';
import { PIECE_SETS, SKINS } from '../ui/theme';
import type { Entitlements } from './purchases';
import type { Progress } from './progress';
import type { ReduceMotionChoice, Settings, ThemeChoice } from './settings';
import type { Record_, Stats } from './stats';

export const THEMES: Record<ThemeChoice, true> = { system: true, dark: true, light: true };
export const REDUCE_MOTION: Record<ReduceMotionChoice, true> = { system: true, on: true, off: true };

/** Board skin and piece set ids, as the cosmetics tables declare them. */
const idTable = (items: readonly { id: string }[]): Record<string, true> =>
  Object.fromEntries(items.map((item) => [item.id, true] as const));
export const SKIN_IDS: Record<string, true> = idTable(SKINS);
export const PIECE_SET_IDS: Record<string, true> = idTable(PIECE_SETS);

/** The opponents a record is kept for: pass-and-play and the three bot levels. */
export type RecordKey = 'local' | 'bot1' | 'bot2' | 'bot3';
export const RECORD_KEYS: Record<RecordKey, true> = { local: true, bot1: true, bot2: true, bot3: true };

/**
 * Solved puzzle ids kept. The bundled set is smaller than this by two orders of
 * magnitude; the cap is only here so a record the app did not write cannot hand
 * the launch an arbitrarily long list.
 */
export const MAX_SOLVED = 1000;

/**
 * ...and how many entries are even looked at, which is the half that was
 * missing. `[...new Set(p.solved.filter(isString))].slice(0, MAX_SOLVED)` reads
 * like a cap and is not one: the filter copies the whole array, the Set ingests
 * the whole array and the spread copies it again, and only then does the slice
 * apply. Measured on this module: 2,000,000 stored ids cost 880 ms and kept
 * 1,000 of them, on every launch, before the first frame - and on the web build
 * localStorage is shared by origin with every other app the account publishes,
 * so planting such a record needs no access to the phone at all.
 *
 * Two bounds and not one, because either alone leaves a hole: MAX_SOLVED bounds
 * what is kept but not what is walked, and a list of one id repeated a million
 * times never reaches it. Four times the ceiling is room for a record that is
 * mostly duplicates, and still some four hundred times the longest list the app
 * itself can write (one id per bundled puzzle).
 */
export const MAX_SOLVED_SCANNED = MAX_SOLVED * 4;

type Fields = Record<string, unknown>;

function fields(raw: unknown): Fields {
  return raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Fields) : {};
}

/** True when `value` is one of `table`'s own keys — never an inherited one like `constructor` or `toString`. */
function has<T extends string | number>(table: Record<T, unknown>, value: unknown): value is T {
  if (typeof value !== 'string' && typeof value !== 'number') return false;
  return Object.prototype.hasOwnProperty.call(table, value);
}

/** `value` when it is one of `table`'s own keys, else `fallback`. */
function pick<T extends string | number>(value: unknown, table: Record<T, unknown>, fallback: T): T {
  return has(table, value) ? value : fallback;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

/** A counter: whole and not negative, or `fallback`. */
function count(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : fallback;
}

/**
 * The rule variants, one boolean per name the engine knows, unknown names
 * dropped. Strictly `=== true`: `setVariant` only ever writes booleans, so a
 * `1` is not ours. The output always carries every name — the screens read
 * `!!settings.variants.x`, so `false` and absent behave the same.
 */
export function cleanVariants(raw: unknown): Record<keyof Rules, boolean> {
  const v = fields(raw);
  const out = { ...DEFAULT_RULES };
  for (const name of Object.keys(DEFAULT_RULES) as (keyof Rules)[]) out[name] = v[name] === true;
  return out;
}

/** Stored settings, with every unknown or missing field replaced from `fallback`. */
export function cleanSettings(raw: unknown, fallback: Settings): Settings {
  const s = fields(raw);
  return {
    haptics: bool(s.haptics, fallback.haptics),
    sound: bool(s.sound, fallback.sound),
    patterns: bool(s.patterns, fallback.patterns),
    theme: pick(s.theme, THEMES, fallback.theme),
    reduceMotion: pick(s.reduceMotion, REDUCE_MOTION, fallback.reduceMotion),
    skin: pick(s.skin, SKIN_IDS, fallback.skin),
    pieces: pick(s.pieces, PIECE_SET_IDS, fallback.pieces),
    variants: cleanVariants(s.variants),
    welcomed: bool(s.welcomed, fallback.welcomed),
  };
}

function cleanRecord(raw: unknown, fallback: Record_): Record_ {
  const r = fields(raw);
  return { played: count(r.played, fallback.played), won: count(r.won, fallback.won) };
}

/**
 * Lifetime totals. `records` is rebuilt with only the opponents the app
 * records against, each a pair of counters: the record sheet reads
 * `stats.records.local` straight off it, so the field has to be an object.
 */
export function cleanStats(raw: unknown, fallback: Stats): Stats {
  const s = fields(raw);
  const stored = fields(s.records);
  const records: Record<string, Record_> = {};
  for (const key of Object.keys(stored)) {
    if (!has(RECORD_KEYS, key)) continue;
    records[key] = cleanRecord(stored[key], fallback.records[key] ?? { played: 0, won: 0 });
  }
  return {
    games: count(s.games, fallback.games),
    records,
    travels: count(s.travels, fallback.travels),
    mostTimelines: count(s.mostTimelines, fallback.mostTimelines),
    longestGame: count(s.longestGame, fallback.longestGame),
  };
}

/**
 * Solved puzzle ids. An id the bundled set no longer has is harmless: it simply
 * never matches. Walked by hand rather than filtered and de-duplicated, so that
 * both ceilings apply while the list is being read: the walk stops at
 * MAX_SOLVED_SCANNED entries or MAX_SOLVED kept ids, whichever comes first.
 */
export function cleanProgress(raw: unknown, fallback: Progress): Progress {
  const p = fields(raw);
  if (!Array.isArray(p.solved)) return { solved: [...fallback.solved] };
  const solved: string[] = [];
  const seen = new Set<string>();
  const scanned = Math.min(p.solved.length, MAX_SOLVED_SCANNED);
  for (let i = 0; i < scanned && solved.length < MAX_SOLVED; i++) {
    const id: unknown = p.solved[i];
    if (typeof id !== 'string' || seen.has(id)) continue;
    seen.add(id);
    solved.push(id);
  }
  return { solved };
}

/** What the player has unlocked. */
export function cleanEntitlements(raw: unknown, fallback: Entitlements): Entitlements {
  const e = fields(raw);
  return { supporter: bool(e.supporter, fallback.supporter) };
}

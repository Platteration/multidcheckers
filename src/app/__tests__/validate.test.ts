/**
 * What comes back out of storage. On the web build every record is plain
 * localStorage on an origin shared with the sibling app, so nothing here is
 * ours by construction: each validator is fed the names on `Object.prototype`
 * (every one of which is truthy through `in` or a bare `TABLE[key]`), a
 * record of the wrong shape, and its own defaults, which must come back as
 * they went in. The migration is driven against an in-memory AsyncStorage,
 * because which key a record ends up under, and whether the old one is still
 * there, can only be seen from outside the module.
 */
import { Platform } from 'react-native';
import { DEFAULT_RULES } from '../../engine';
import { PIECE_SETS, SKINS } from '../../ui/theme';
import { KEYS, LEGACY_KEYS, StoredRecord, loadJson, migrateLegacyKeys, saveJson } from '../persist';
import { EMPTY_PROGRESS } from '../progress';
import { NO_ENTITLEMENTS } from '../purchases';
import { DEFAULT_SETTINGS, Settings } from '../settings';
import { EMPTY_STATS, Stats } from '../stats';
import {
  MAX_SOLVED,
  PIECE_SET_IDS,
  SKIN_IDS,
  THEMES,
  cleanEntitlements,
  cleanProgress,
  cleanSettings,
  cleanStats,
  cleanVariants,
} from '../validate';

/** AsyncStorage, in memory, with a switch that makes every write fail. */
jest.mock('@react-native-async-storage/async-storage', () => {
  const store = new Map<string, string>();
  const flags = { failWrites: false };
  return {
    __esModule: true,
    __store: store,
    __flags: flags,
    default: {
      getItem: async (key: string) => (store.has(key) ? store.get(key)! : null),
      setItem: async (key: string, value: string) => {
        if (flags.failWrites) throw new Error('QuotaExceededError');
        store.set(key, value);
      },
      removeItem: async (key: string) => {
        store.delete(key);
      },
    },
  };
});
const { __store: mockStore, __flags: mockFlags } = jest.requireMock('@react-native-async-storage/async-storage') as {
  __store: Map<string, string>;
  __flags: { failWrites: boolean };
};

/** `constructor`, `toString`, `__proto__`, ...: the names a plain-object table answers for. */
const PROTOTYPE_NAMES = Object.getOwnPropertyNames(Object.prototype);

/** A record built by JSON.parse, so `__proto__` is an own key and not the prototype. */
const parsed = (json: string): unknown => JSON.parse(json);

const D = DEFAULT_SETTINGS;

/** Every theme, spelled out: dropping one from the table must fail here, not silently shrink the loop. */
const ALL_THEMES: Settings['theme'][] = ['system', 'dark', 'light'];

describe('cleanSettings', () => {
  it('refuses every name on Object.prototype as a theme, skin, piece set or variant', () => {
    expect(PROTOTYPE_NAMES).toContain('constructor');
    for (const name of PROTOTYPE_NAMES) {
      expect(cleanSettings({ theme: name, skin: name, pieces: name }, D)).toEqual(D);
      expect(cleanSettings(parsed(`{"variants":{"${name}":true}}`), D).variants).toEqual(D.variants);
      expect(cleanVariants(parsed(`{"${name}":true}`))).toEqual({ ...DEFAULT_RULES });
    }
  });

  it('hands the defaults back unchanged', () => {
    expect(cleanSettings(D, D)).toEqual(D);
    expect(cleanSettings(parsed(JSON.stringify(D)), D)).toEqual(D);
  });

  it('keeps every theme, every skin, every piece set and every variant', () => {
    for (const theme of ALL_THEMES) expect(cleanSettings({ theme }, D).theme).toBe(theme);
    expect(Object.keys(THEMES)).toEqual(ALL_THEMES);
    for (const { id } of SKINS) expect(cleanSettings({ skin: id }, D).skin).toBe(id);
    for (const { id } of PIECE_SETS) expect(cleanSettings({ pieces: id }, D).pieces).toBe(id);
    for (const name of Object.keys(DEFAULT_RULES)) {
      expect(cleanSettings({ variants: { [name]: true } }, D).variants).toEqual({ ...DEFAULT_RULES, [name]: true });
    }
    // The tables and the cosmetics arrays agree, so a new skin cannot be refused by accident.
    expect(Object.keys(SKIN_IDS)).toEqual(SKINS.map((s) => s.id));
    expect(Object.keys(PIECE_SET_IDS)).toEqual(PIECE_SETS.map((p) => p.id));
  });

  it('falls back one field at a time, never the whole record', () => {
    const s = cleanSettings({ theme: 'neon', skin: 'marble', pieces: 7, haptics: 'yes', sound: false, welcomed: true }, D);
    expect(s).toEqual({ ...D, skin: 'marble', sound: false, welcomed: true });
  });

  it('takes a variant only when it is literally true', () => {
    // `setVariant` writes booleans; `1` is not ours, and a stray name is dropped.
    expect(cleanVariants({ flyingKings: 1, backCapture: 'true', strictPresent: true, popOut: true })).toEqual({
      ...DEFAULT_RULES,
      strictPresent: true,
    });
    expect(cleanVariants(undefined)).toEqual({ ...DEFAULT_RULES });
    expect(cleanVariants([true])).toEqual({ ...DEFAULT_RULES });
  });

  it('survives a record that is not an object at all', () => {
    expect(cleanSettings(null, D)).toEqual(D);
    expect(cleanSettings('wat', D)).toEqual(D);
    expect(cleanSettings([1, 2], D)).toEqual(D);
  });
});

describe('cleanStats', () => {
  it('hands the empty record and a full one back unchanged', () => {
    expect(cleanStats(EMPTY_STATS, EMPTY_STATS)).toEqual(EMPTY_STATS);
    const full: Stats = {
      games: 12,
      records: { local: { played: 4, won: 0 }, bot1: { played: 3, won: 2 }, bot2: { played: 3, won: 1 }, bot3: { played: 2, won: 0 } },
      travels: 9,
      mostTimelines: 5,
      longestGame: 61,
    };
    expect(cleanStats(parsed(JSON.stringify(full)), EMPTY_STATS)).toEqual(full);
  });

  it('rebuilds records as an object the record sheet can read', () => {
    // `records: null` passed the old `typeof games === 'number'` guard and threw on `records.local`.
    expect(cleanStats({ games: 3, records: null }, EMPTY_STATS)).toEqual({ ...EMPTY_STATS, games: 3 });
    expect(cleanStats({ games: 3, records: 'x' }, EMPTY_STATS).records).toEqual({});
    for (const name of PROTOTYPE_NAMES) {
      expect(cleanStats(parsed(`{"records":{"${name}":{"played":1,"won":1}}}`), EMPTY_STATS).records).toEqual({});
    }
  });

  it('keeps counters whole and non-negative', () => {
    const s = cleanStats({ games: -1, travels: 2.5, mostTimelines: '9', longestGame: 40, records: { bot2: { played: 'x', won: 1 } } }, EMPTY_STATS);
    expect(s).toEqual({ ...EMPTY_STATS, longestGame: 40, records: { bot2: { played: 0, won: 1 } } });
  });
});

describe('cleanProgress', () => {
  it('keeps the solved ids, once each, and nothing that is not a string', () => {
    expect(cleanProgress(EMPTY_PROGRESS, EMPTY_PROGRESS)).toEqual(EMPTY_PROGRESS);
    expect(cleanProgress({ solved: ['a', 'b', 'a', 3, null] }, EMPTY_PROGRESS)).toEqual({ solved: ['a', 'b'] });
    expect(cleanProgress({ solved: 'a' }, EMPTY_PROGRESS)).toEqual(EMPTY_PROGRESS);
    expect(cleanProgress(null, EMPTY_PROGRESS)).toEqual(EMPTY_PROGRESS);
  });

  it('bounds a list the app never wrote', () => {
    const solved = Array.from({ length: MAX_SOLVED + 5 }, (_, i) => `p${i}`);
    expect(cleanProgress({ solved }, EMPTY_PROGRESS).solved).toHaveLength(MAX_SOLVED);
  });
});

describe('cleanEntitlements', () => {
  it('reads the one flag as a boolean', () => {
    expect(cleanEntitlements(NO_ENTITLEMENTS, NO_ENTITLEMENTS)).toEqual(NO_ENTITLEMENTS);
    expect(cleanEntitlements({ supporter: true }, NO_ENTITLEMENTS)).toEqual({ supporter: true });
    expect(cleanEntitlements({ supporter: 'yes' }, NO_ENTITLEMENTS)).toEqual(NO_ENTITLEMENTS);
    expect(cleanEntitlements(null, NO_ENTITLEMENTS)).toEqual(NO_ENTITLEMENTS);
  });
});

describe('migrateLegacyKeys', () => {
  const RECORDS = Object.keys(KEYS) as StoredRecord[];
  /** Bytes that are deliberately not valid JSON: the copy must not judge them. */
  const OLD = (r: string) => `{"from":"old ${r}"`;
  const NEW = (r: string) => `{"from":"new ${r}"}`;

  beforeEach(() => {
    mockStore.clear();
    mockFlags.failWrites = false;
    jest.restoreAllMocks();
  });

  it('moves every bare key to its prefixed one and deletes the bare key on a phone', async () => {
    expect(Platform.OS).not.toBe('web');
    for (const r of RECORDS) mockStore.set(LEGACY_KEYS[r], OLD(r));
    await migrateLegacyKeys();
    for (const r of RECORDS) {
      expect(mockStore.get(KEYS[r])).toBe(OLD(r));
      expect(mockStore.has(LEGACY_KEYS[r])).toBe(false);
    }
  });

  it('leaves a store with only new keys alone', async () => {
    for (const r of RECORDS) mockStore.set(KEYS[r], NEW(r));
    await migrateLegacyKeys();
    expect([...mockStore]).toEqual(RECORDS.map((r) => [KEYS[r], NEW(r)]));
  });

  it('lets the new key win when both are present, and clears the old one on a phone', async () => {
    for (const r of RECORDS) {
      mockStore.set(LEGACY_KEYS[r], OLD(r));
      mockStore.set(KEYS[r], NEW(r));
    }
    await migrateLegacyKeys();
    for (const r of RECORDS) {
      expect(mockStore.get(KEYS[r])).toBe(NEW(r));
      expect(mockStore.has(LEGACY_KEYS[r])).toBe(false);
    }
  });

  it('keeps the old key when the write fails, so the next launch can try again', async () => {
    for (const r of RECORDS) mockStore.set(LEGACY_KEYS[r], OLD(r));
    mockFlags.failWrites = true;
    expect(await saveJson('probe', 1)).toBe(false);
    await migrateLegacyKeys();
    for (const r of RECORDS) {
      expect(mockStore.has(KEYS[r])).toBe(false);
      expect(mockStore.get(LEGACY_KEYS[r])).toBe(OLD(r));
    }
    mockFlags.failWrites = false;
    await migrateLegacyKeys();
    for (const r of RECORDS) expect(mockStore.get(KEYS[r])).toBe(OLD(r));
  });

  it('never deletes the bare key on the web, where the origin is shared with the sibling app', async () => {
    jest.replaceProperty(Platform, 'OS', 'web');
    for (const r of RECORDS) mockStore.set(LEGACY_KEYS[r], OLD(r));
    await migrateLegacyKeys();
    for (const r of RECORDS) {
      expect(mockStore.get(KEYS[r])).toBe(OLD(r));
      expect(mockStore.get(LEGACY_KEYS[r])).toBe(OLD(r));
    }
    // Both present afterwards, and still: the new one wins and the old one stays.
    mockStore.set(KEYS.settings, NEW('settings'));
    await migrateLegacyKeys();
    expect(mockStore.get(KEYS.settings)).toBe(NEW('settings'));
    expect(mockStore.get(LEGACY_KEYS.settings)).toBe(OLD('settings'));
  });

  it('is a no-op the second time', async () => {
    for (const r of RECORDS) mockStore.set(LEGACY_KEYS[r], OLD(r));
    await migrateLegacyKeys();
    const after = [...mockStore];
    await migrateLegacyKeys();
    expect([...mockStore]).toEqual(after);
  });

  it('runs on import, and every read waits for it', async () => {
    // A store as an existing player's phone has it, seen by a build that has
    // never run before: the first read of the new key must answer with the
    // old record, with no caller having asked for a migration.
    mockStore.set(LEGACY_KEYS.stats, JSON.stringify({ games: 7 }));
    let fresh!: typeof import('../persist');
    jest.isolateModules(() => {
      fresh = jest.requireActual<typeof import('../persist')>('../persist');
    });
    expect(await fresh.loadJson<{ games: number }>(KEYS.stats)).toEqual({ games: 7 });
    expect(mockStore.has(LEGACY_KEYS.stats)).toBe(false);
    // And this module's own import-time run is what its reads wait on too.
    expect(await loadJson<{ games: number }>(KEYS.stats)).toEqual({ games: 7 });
  });
});

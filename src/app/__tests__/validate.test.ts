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
import { KEYS, LEGACY_KEYS, MigratedRecord, loadJson, migrateLegacyKeys, saveJson, setAsideGame } from '../persist';
import { EMPTY_PROGRESS } from '../progress';
import { NO_ENTITLEMENTS } from '../purchases';
import { DEFAULT_SETTINGS, Settings } from '../settings';
import { EMPTY_STATS, Stats } from '../stats';
import {
  MAX_SOLVED,
  MAX_SOLVED_SCANNED,
  PIECE_SET_IDS,
  REDUCE_MOTION,
  SKIN_IDS,
  THEMES,
  cleanEntitlements,
  cleanProgress,
  cleanSettings,
  cleanStats,
  cleanVariants,
} from '../validate';

/**
 * AsyncStorage, in memory, with a switch that makes every write fail and a hook
 * that fires as a key is read - which is how a call can be staged *inside* the
 * migration, in the window between its look for the new key and its copy of the
 * old one.
 */
jest.mock('@react-native-async-storage/async-storage', () => {
  const store = new Map<string, string>();
  const flags = { failWrites: false };
  const hooks: { onRead?: (key: string) => void } = {};
  return {
    __esModule: true,
    __store: store,
    __flags: flags,
    __hooks: hooks,
    default: {
      getItem: async (key: string) => {
        hooks.onRead?.(key);
        return store.has(key) ? store.get(key)! : null;
      },
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
const {
  __store: mockStore,
  __flags: mockFlags,
  __hooks: mockHooks,
} = jest.requireMock('@react-native-async-storage/async-storage') as {
  __store: Map<string, string>;
  __flags: { failWrites: boolean };
  __hooks: { onRead?: (key: string) => void };
};

/** `constructor`, `toString`, `__proto__`, ...: the names a plain-object table answers for. */
const PROTOTYPE_NAMES = Object.getOwnPropertyNames(Object.prototype);

/** A record built by JSON.parse, so `__proto__` is an own key and not the prototype. */
const parsed = (json: string): unknown => JSON.parse(json);

const D = DEFAULT_SETTINGS;

/** Every theme, spelled out: dropping one from the table must fail here, not silently shrink the loop. */
const ALL_THEMES: Settings['theme'][] = ['system', 'dark', 'light'];
const ALL_MOTION: Settings['reduceMotion'][] = ['system', 'on', 'off'];

describe('cleanSettings', () => {
  it('refuses every name on Object.prototype as a theme, motion, skin, piece set or variant', () => {
    expect(PROTOTYPE_NAMES).toContain('constructor');
    for (const name of PROTOTYPE_NAMES) {
      expect(cleanSettings({ theme: name, reduceMotion: name, skin: name, pieces: name }, D)).toEqual(D);
      expect(cleanSettings(parsed(`{"variants":{"${name}":true}}`), D).variants).toEqual(D.variants);
      expect(cleanVariants(parsed(`{"${name}":true}`))).toEqual({ ...DEFAULT_RULES });
    }
  });

  it('hands the defaults back unchanged', () => {
    expect(cleanSettings(D, D)).toEqual(D);
    expect(cleanSettings(parsed(JSON.stringify(D)), D)).toEqual(D);
  });

  it('keeps every theme, every motion choice, every skin, every piece set and every variant', () => {
    for (const theme of ALL_THEMES) expect(cleanSettings({ theme }, D).theme).toBe(theme);
    expect(Object.keys(THEMES)).toEqual(ALL_THEMES);
    for (const reduceMotion of ALL_MOTION) expect(cleanSettings({ reduceMotion }, D).reduceMotion).toBe(reduceMotion);
    expect(Object.keys(REDUCE_MOTION)).toEqual(ALL_MOTION);
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
    const s = cleanSettings({ theme: 'neon', reduceMotion: true, skin: 'marble', pieces: 7, haptics: 'yes', sound: false, welcomed: true }, D);
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

  it('bounds a list the app never wrote, and bounds it before walking it', () => {
    const solved = Array.from({ length: MAX_SOLVED + 5 }, (_, i) => `p${i}`);
    expect(cleanProgress({ solved }, EMPTY_PROGRESS).solved).toHaveLength(MAX_SOLVED);

    // A cap that runs after the work is not a cap on the work. Counted rather
    // than timed, because a stopwatch says nothing about why it was slow: the
    // list below is fifty times the scan ceiling and every entry is the same
    // id, so nothing is kept after the first and the only thing that can stop
    // the walk is the ceiling on what is read. The previous filter / Set /
    // spread read all of it (measured: 880 ms for two million ids, on every
    // launch) and then kept one.
    let reads = 0;
    const planted = new Proxy(new Array(MAX_SOLVED_SCANNED * 50).fill('sweep'), {
      get(target, key, receiver) {
        if (typeof key === 'string' && /^[0-9]+$/.test(key)) reads++;
        return Reflect.get(target, key, receiver);
      },
    });
    expect(cleanProgress({ solved: planted }, EMPTY_PROGRESS)).toEqual({ solved: ['sweep'] });
    expect(reads).toBeLessThanOrEqual(MAX_SOLVED_SCANNED);
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
  /** The records that have a bare key to move. The set-aside one is newer than the prefix. */
  const RECORDS = Object.keys(LEGACY_KEYS) as MigratedRecord[];
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

  /** A build that has never run before, on a phone that still has the bare keys. */
  function firstLaunch(record: string): typeof import('../persist') {
    mockStore.clear();
    mockStore.set(record, JSON.stringify({ version: 3, from: 'the old key' }));
    let fresh!: typeof import('../persist');
    jest.isolateModules(() => {
      fresh = jest.requireActual<typeof import('../persist')>('../persist');
    });
    return fresh;
  }

  afterEach(() => {
    mockHooks.onRead = undefined;
  });

  it('is waited for by a write, not only by a read', async () => {
    // Staged in the one window where it matters: the save is issued while the
    // migration has already looked for the new key and has not yet copied the
    // old one over. A write that does not wait lands first and the copy then
    // lands on top of it, so the move undoes what the player just did.
    const fresh = firstLaunch(LEGACY_KEYS.game);
    const mine = { version: 3, from: 'the game being played' };
    let saved: Promise<boolean> | null = null;
    mockHooks.onRead = (key) => {
      if (key === LEGACY_KEYS.game && !saved) saved = fresh.saveJson(KEYS.game, mine);
    };
    await fresh.migrated;
    expect(saved).not.toBeNull();
    expect(await saved!).toBe(true);
    expect(JSON.parse(mockStore.get(KEYS.game)!)).toEqual(mine);
  });

  it('is waited for by a removal, which is the one that undoes itself', async () => {
    // The error boundary's "start a new game" and the autosave's clear are both
    // removeKey. A removal that overtakes the migration finds nothing under the
    // new key, and the copy that follows puts the record back: the game that
    // crashed the app returns on the next launch and the one button out of it
    // did nothing.
    const fresh = firstLaunch(LEGACY_KEYS.game);
    const removed = fresh.removeKey(KEYS.game);
    await fresh.migrated;
    await removed;
    expect(mockStore.has(KEYS.game)).toBe(false);
    expect(mockStore.has(LEGACY_KEYS.game)).toBe(false);
  });
});

describe('setting an unreadable game aside', () => {
  const RECORD = { version: 2, history: [{ lastAction: null }] };

  beforeEach(() => {
    mockStore.clear();
    mockFlags.failWrites = false;
  });

  it('copies the record to its own key and only then takes it off the game key', async () => {
    // Kept, not deleted: the record is the only copy of the player's last game
    // and the fault may well be ours. Not offered again either: it fails the
    // same way at every launch, and the replay it fails partway through is the
    // expensive part of one.
    mockStore.set(KEYS.game, JSON.stringify(RECORD));
    expect(await setAsideGame(RECORD)).toBe(true);
    expect(mockStore.has(KEYS.game)).toBe(false);
    expect(JSON.parse(mockStore.get(KEYS.setAside)!)).toEqual(RECORD);
  });

  it('keeps the record where it is when the copy cannot be written', async () => {
    // A full or missing store must not turn "set aside" into "deleted". The
    // next launch finds the record exactly where it was and tries again.
    mockStore.set(KEYS.game, JSON.stringify(RECORD));
    mockFlags.failWrites = true;
    expect(await setAsideGame(RECORD)).toBe(false);
    expect(JSON.parse(mockStore.get(KEYS.game)!)).toEqual(RECORD);
    expect(mockStore.has(KEYS.setAside)).toBe(false);
  });

  it('keeps the most recent one, and touches no other record', async () => {
    mockStore.set(KEYS.settings, '{"haptics":false}');
    mockStore.set(KEYS.setAside, JSON.stringify({ version: 1, history: [] }));
    mockStore.set(KEYS.game, JSON.stringify(RECORD));
    expect(await setAsideGame(RECORD)).toBe(true);
    expect(JSON.parse(mockStore.get(KEYS.setAside)!)).toEqual(RECORD);
    expect(mockStore.get(KEYS.settings)).toBe('{"haptics":false}');
  });
});

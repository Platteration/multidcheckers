/**
 * Local persistence. Everything is best-effort: storage can be missing (web
 * private mode) or corrupt, and the app must still start.
 *
 * Every key the app stores is named here and nowhere else. On the web build
 * AsyncStorage is localStorage keyed by *origin*, and a GitHub Pages project
 * site shares its origin with every other app the account publishes — the
 * sibling game included, which stored the same bare `settings.v1` — so each
 * key carries the app's name. Records read back are untrusted: every reader
 * goes through `validate.ts`, never a bare spread.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

export const KEYS = {
  settings: 'multidcheckers.settings.v1',
  game: 'multidcheckers.game.v1',
  stats: 'multidcheckers.stats.v1',
  progress: 'multidcheckers.progress.v1',
  entitlements: 'multidcheckers.entitlements.v1',
} as const;

export type StoredRecord = keyof typeof KEYS;

/** The bare keys every build before the prefix wrote, one per record. */
export const LEGACY_KEYS: Record<StoredRecord, string> = {
  settings: 'settings.v1',
  game: 'game.v1',
  stats: 'stats.v1',
  progress: 'progress.v1',
  entitlements: 'entitlements.v1',
};

/**
 * Move each record from its bare key to its prefixed one. Per record: if the
 * new key is present it wins (the only way both exist is that a migrated build
 * wrote the new one and then could not delete the old, so the new one is what
 * it has read and written since); otherwise the old bytes are copied verbatim
 * — validation stays at the read boundary, and a record the app cannot parse
 * is still the player's only copy — and the old key is deleted only once the
 * write succeeded, so a full store retries next launch. Running it again is a
 * no-op: the "new present" branch is the idempotence, and there is no flag to
 * lose.
 *
 * On the web the bare key is never deleted. localStorage there is shared by
 * origin, and the bare `settings.v1` may be the sibling app's: both apps copy
 * from it and leave it. Five small orphaned keys are the cost.
 */
export async function migrateLegacyKeys(): Promise<void> {
  const shared = Platform.OS === 'web';
  for (const record of Object.keys(KEYS) as StoredRecord[]) {
    const from = LEGACY_KEYS[record];
    const to = KEYS[record];
    try {
      if ((await AsyncStorage.getItem(to)) !== null) {
        if (!shared) await AsyncStorage.removeItem(from);
        continue;
      }
      const old = await AsyncStorage.getItem(from);
      if (old === null) continue;
      await AsyncStorage.setItem(to, old);
      if (!shared) await AsyncStorage.removeItem(from);
    } catch {
      // Storage missing or full: the old record stays where it was, and the
      // next launch tries again.
    }
  }
}

/** Awaited by every read and write, so no provider can race ahead of the move. */
export const migrated: Promise<void> = migrateLegacyKeys();

export async function loadJson<T>(key: string): Promise<T | null> {
  try {
    await migrated;
    const raw = await AsyncStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

/** True when the value was written. Storage can be full, missing, or too small. */
export async function saveJson(key: string, value: unknown): Promise<boolean> {
  try {
    await migrated;
    await AsyncStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export async function removeKey(key: string): Promise<void> {
  try {
    await migrated;
    await AsyncStorage.removeItem(key);
  } catch {
    // Ignore.
  }
}

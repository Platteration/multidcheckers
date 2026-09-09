/**
 * Local persistence. Everything is best-effort: storage can be missing (web
 * private mode) or corrupt, and the app must still start.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const SETTINGS_KEY = 'settings.v1';
const GAME_KEY = 'game.v1';

export async function loadJson<T>(key: string): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

/** True when the value was written. Storage can be full, missing, or too small. */
export async function saveJson(key: string, value: unknown): Promise<boolean> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export async function removeKey(key: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(key);
  } catch {
    // Ignore.
  }
}

export const keys = { settings: SETTINGS_KEY, game: GAME_KEY };

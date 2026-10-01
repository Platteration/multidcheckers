/**
 * The settings contract, pinned. A renamed storage key silently orphans every
 * player's record, a dropped row or enum member silently loses a preference,
 * and a Reset that reaches past the settings record loses a game — so each is
 * spelled out here as a literal, and a change to any of them has to change
 * this file on purpose.
 */
import React, { useEffect } from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { DEFAULT_RULES } from '../../engine';
import { KEYS, LEGACY_KEYS } from '../persist';
import { DEFAULT_SETTINGS, Settings, SettingsProvider, resetSettings, useSettings } from '../settings';
import { resolveScheme } from '../theme';
import { PIECE_SET_IDS, RECORD_KEYS, REDUCE_MOTION, SKIN_IDS, THEMES } from '../validate';

jest.mock('@react-native-async-storage/async-storage', () => {
  const store = new Map<string, string>();
  return {
    __esModule: true,
    __store: store,
    default: {
      getItem: async (key: string) => (store.has(key) ? store.get(key)! : null),
      setItem: async (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: async (key: string) => {
        store.delete(key);
      },
    },
  };
});
const { __store: store } = jest.requireMock('@react-native-async-storage/async-storage') as { __store: Map<string, string> };

describe('storage keys', () => {
  it('are the six prefixed, versioned keys', () => {
    expect(KEYS).toEqual({
      settings: 'multidcheckers.settings.v1',
      game: 'multidcheckers.game.v1',
      stats: 'multidcheckers.stats.v1',
      progress: 'multidcheckers.progress.v1',
      entitlements: 'multidcheckers.entitlements.v1',
      setAside: 'multidcheckers.setaside.v1',
    });
  });

  it('migrate from the bare keys every earlier build wrote - all but the newest record', () => {
    expect(LEGACY_KEYS).toEqual({
      settings: 'settings.v1',
      game: 'game.v1',
      stats: 'stats.v1',
      progress: 'progress.v1',
      entitlements: 'entitlements.v1',
    });
  });
});

describe('the settings record', () => {
  it('holds exactly these rows', () => {
    expect(Object.keys(DEFAULT_SETTINGS)).toEqual(['haptics', 'sound', 'patterns', 'theme', 'reduceMotion', 'skin', 'pieces', 'variants', 'welcomed']);
    expect(DEFAULT_SETTINGS).toEqual({
      haptics: true,
      sound: true,
      patterns: false,
      theme: 'system',
      reduceMotion: 'system',
      skin: 'classic',
      pieces: 'classic',
      variants: { flyingKings: false, backCapture: false, strictPresent: false },
      welcomed: false,
    });
  });

  it('draws each choice from these tables', () => {
    expect(Object.keys(THEMES)).toEqual(['system', 'dark', 'light']);
    expect(Object.keys(REDUCE_MOTION)).toEqual(['system', 'on', 'off']);
    expect(Object.keys(SKIN_IDS)).toEqual(['classic', 'marble', 'forest', 'midnight', 'cherry']);
    expect(Object.keys(PIECE_SET_IDS)).toEqual(['classic', 'ivory', 'sunset', 'sea']);
    expect(Object.keys(DEFAULT_RULES)).toEqual(['flyingKings', 'backCapture', 'strictPresent']);
    expect(Object.keys(RECORD_KEYS)).toEqual(['local', 'bot1', 'bot2', 'bot3']);
  });
});

describe('theme', () => {
  it('resolves a system choice to dark unless the platform says light', () => {
    // React Native's scheme is null when the OS states no preference, and the app's own default is dark.
    expect(resolveScheme('system', null)).toBe('dark');
    expect(resolveScheme('system', undefined)).toBe('dark');
    expect(resolveScheme('system', 'dark')).toBe('dark');
    expect(resolveScheme('system', 'light')).toBe('light');
    expect(resolveScheme('light', null)).toBe('light');
    expect(resolveScheme('light', 'dark')).toBe('light');
    expect(resolveScheme('dark', 'light')).toBe('dark');
  });
});

describe('reset to defaults', () => {
  const changed: Settings = {
    haptics: false,
    sound: false,
    patterns: true,
    theme: 'light',
    reduceMotion: 'on',
    skin: 'cherry',
    pieces: 'sea',
    variants: { flyingKings: true, backCapture: true, strictPresent: true },
    welcomed: true,
  };

  it('is the defaults with the onboarding flag kept', () => {
    expect(resetSettings(changed)).toEqual({ ...DEFAULT_SETTINGS, welcomed: true });
    expect(resetSettings({ ...changed, welcomed: false })).toEqual(DEFAULT_SETTINGS);
  });

  it('rewrites the settings record and nothing else', async () => {
    const others: Record<string, string> = {
      [KEYS.game]: '{"setup":{"mode":"local"},"actions":[]}',
      [KEYS.stats]: '{"games":4}',
      [KEYS.progress]: '{"solved":["sweep"]}',
      [KEYS.entitlements]: '{"supporter":true}',
      [KEYS.setAside]: '{"version":1,"history":[]}',
    };
    store.clear();
    store.set(KEYS.settings, JSON.stringify(changed));
    for (const [key, value] of Object.entries(others)) store.set(key, value);

    let api!: ReturnType<typeof useSettings>;
    function Grab() {
      const current = useSettings();
      useEffect(() => {
        api = current;
      });
      return null;
    }
    await act(async () => {
      TestRenderer.create(React.createElement(SettingsProvider, null, React.createElement(Grab)));
    });
    expect(api.ready).toBe(true);
    expect(api.settings).toEqual(changed);

    await act(async () => api.reset());
    expect(api.settings).toEqual({ ...DEFAULT_SETTINGS, welcomed: true });
    expect(JSON.parse(store.get(KEYS.settings)!)).toEqual({ ...DEFAULT_SETTINGS, welcomed: true });
    for (const [key, value] of Object.entries(others)) expect(store.get(key)).toBe(value);
    expect(store.size).toBe(6);
  });
});

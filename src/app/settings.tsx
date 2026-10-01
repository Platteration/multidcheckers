import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { DEFAULT_RULES } from '../engine';
import { KEYS, loadJson, saveJson } from './persist';
import { cleanSettings } from './validate';

export type ThemeChoice = 'system' | 'dark' | 'light';
/** Decorative motion: the platform's own preference, or the player's answer either way. */
export type ReduceMotionChoice = 'system' | 'on' | 'off';

export interface Settings {
  /** Vibrate on drops, captures, spins, and wins. */
  haptics: boolean;
  /** Play short sounds. */
  sound: boolean;
  /** Mark pieces with shapes as well as colour, for colour-blind players. */
  patterns: boolean;
  theme: ThemeChoice;
  /** Skip the flight across the map when a piece travels; `system` follows the device. */
  reduceMotion: ReduceMotionChoice;
  /** Board skin id, see ui/skins. */
  skin: string;
  /** Piece set id, see ui/skins. */
  pieces: string;
  /** Optional rule variants, keyed by name; every name the engine knows is present. */
  variants: Record<string, boolean>;
  /** The first-launch walkthrough has been seen (or skipped). */
  welcomed: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  haptics: true,
  sound: true,
  patterns: false,
  theme: 'system',
  reduceMotion: 'system',
  skin: 'classic',
  pieces: 'classic',
  variants: { ...DEFAULT_RULES },
  welcomed: false,
};

interface SettingsApi {
  settings: Settings;
  /** True once stored settings have been read (or found missing). */
  ready: boolean;
  update: (patch: Partial<Settings>) => void;
  setVariant: (name: string, on: boolean) => void;
  /** Every setting back to its default. What the player has already seen stays seen. */
  reset: () => void;
}

/**
 * The record Reset writes: the defaults, with the onboarding flag carried over,
 * because it records what was seen rather than a preference — a reset that
 * brought the welcome back would be a nag, not a default.
 */
export function resetSettings(prev: Settings): Settings {
  return { ...DEFAULT_SETTINGS, welcomed: prev.welcomed };
}

const Ctx = createContext<SettingsApi>({
  settings: DEFAULT_SETTINGS,
  ready: false,
  update: () => {},
  setVariant: () => {},
  reset: () => {},
});

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    // Clamped on the way in, field by field: an unknown theme, skin or piece
    // set would otherwise index a palette table to undefined on every render.
    loadJson<unknown>(KEYS.settings).then((stored) => {
      if (!alive) return;
      if (stored) setSettings(cleanSettings(stored, DEFAULT_SETTINGS));
      setReady(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (ready) void saveJson(KEYS.settings, settings);
  }, [settings, ready]);

  const update = useCallback((patch: Partial<Settings>) => {
    setSettings((s) => ({ ...s, ...patch }));
  }, []);

  const setVariant = useCallback((name: string, on: boolean) => {
    setSettings((s) => ({ ...s, variants: { ...s.variants, [name]: on } }));
  }, []);

  const reset = useCallback(() => setSettings(resetSettings), []);

  const api = useMemo(() => ({ settings, ready, update, setVariant, reset }), [settings, ready, update, setVariant, reset]);
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useSettings(): SettingsApi {
  return useContext(Ctx);
}

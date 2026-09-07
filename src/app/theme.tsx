import React, { createContext, useContext, useMemo } from 'react';
import { useColorScheme } from 'react-native';
import { DEFAULT_THEME, Theme, buildTheme } from '../ui/theme';
import { useSettings } from './settings';

const Ctx = createContext<Theme>(DEFAULT_THEME);

/** Resolves the user's theme choice, skin, and piece set into one palette. */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const { settings } = useSettings();
  const system = useColorScheme();
  const scheme = settings.theme === 'system' ? (system === 'light' ? 'light' : 'dark') : settings.theme;
  const theme = useMemo(() => buildTheme(scheme, settings.skin, settings.pieces), [scheme, settings.skin, settings.pieces]);
  return <Ctx.Provider value={theme}>{children}</Ctx.Provider>;
}

export function useTheme(): Theme {
  return useContext(Ctx);
}

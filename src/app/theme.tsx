import React, { createContext, useContext, useMemo } from 'react';
import { ColorSchemeName, useColorScheme } from 'react-native';
import { DEFAULT_THEME, Scheme, Theme, buildTheme } from '../ui/theme';
import { ThemeChoice, useSettings } from './settings';

const Ctx = createContext<Theme>(DEFAULT_THEME);

/**
 * The scheme a theme choice resolves to. `useColorScheme` is typed non-null
 * but `Appearance.getColorScheme` answers null when the OS states no
 * preference; the app's own default is dark, so anything but light is dark.
 */
export function resolveScheme(choice: ThemeChoice, system: ColorSchemeName | null | undefined): Scheme {
  return choice === 'system' ? (system === 'light' ? 'light' : 'dark') : choice;
}

/** Resolves the user's theme choice, skin, and piece set into one palette. */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const { settings } = useSettings();
  const scheme = resolveScheme(settings.theme, useColorScheme());
  const theme = useMemo(() => buildTheme(scheme, settings.skin, settings.pieces), [scheme, settings.skin, settings.pieces]);
  return <Ctx.Provider value={theme}>{children}</Ctx.Provider>;
}

export function useTheme(): Theme {
  return useContext(Ctx);
}

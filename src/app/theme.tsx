import React, { createContext, useContext, useMemo } from 'react';
import { ColorSchemeName, useColorScheme } from 'react-native';
import { DEFAULT_THEME, PIECE_SETS, SKINS, Scheme, Theme, buildTheme } from '../ui/theme';
import { useEntitlements } from './entitlements';
import { DEFAULT_SETTINGS, Settings, ThemeChoice, useSettings } from './settings';

const Ctx = createContext<Theme>(DEFAULT_THEME);

/**
 * The scheme a theme choice resolves to. `useColorScheme` is typed non-null
 * but `Appearance.getColorScheme` answers null when the OS states no
 * preference; the app's own default is dark, so anything but light is dark.
 */
export function resolveScheme(choice: ThemeChoice, system: ColorSchemeName | null | undefined): Scheme {
  return choice === 'system' ? (system === 'light' ? 'light' : 'dark') : choice;
}

type Look = Pick<Settings, 'skin' | 'pieces'>;

/**
 * The board skin and piece set to draw: the stored choice, or its default where the choice is a ✦
 * look the visitor does not own right now (refunded, signed out, deleted with the account, chosen
 * while everything was free, or the website not yet told what is on). The stored record is never
 * rewritten for it: the choice comes back with the purchase.
 */
export function drawnLook(choice: Look, owns: (premium: boolean) => boolean): Look {
  const premiumSkin = SKINS.find((s) => s.id === choice.skin)?.premium ?? false;
  const premiumPieces = PIECE_SETS.find((p) => p.id === choice.pieces)?.premium ?? false;
  return {
    skin: owns(premiumSkin) ? choice.skin : DEFAULT_SETTINGS.skin,
    pieces: owns(premiumPieces) ? choice.pieces : DEFAULT_SETTINGS.pieces,
  };
}

/**
 * Resolves the user's theme choice, skin, and piece set into one palette, the look through what
 * is owned: mounted below EntitlementsProvider (App.tsx).
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const { settings } = useSettings();
  const { owns } = useEntitlements();
  const scheme = resolveScheme(settings.theme, useColorScheme());
  const { skin, pieces } = drawnLook(settings, owns);
  const theme = useMemo(() => buildTheme(scheme, skin, pieces), [scheme, skin, pieces]);
  return <Ctx.Provider value={theme}>{children}</Ctx.Provider>;
}

export function useTheme(): Theme {
  return useContext(Ctx);
}

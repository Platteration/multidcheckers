/**
 * Colours and cosmetics. A Theme is the fully resolved palette a screen
 * draws with: the light/dark base, plus the chosen board skin and piece set.
 * Use `useTheme()` from app/theme to get the current one.
 */
import type { Player } from '../engine';

export type Scheme = 'dark' | 'light';

/** The colours every screen draws with. */
export interface Theme {
  scheme: Scheme;
  background: string;
  panel: string;
  panelRaised: string;
  border: string;
  text: string;
  textMuted: string;
  travel: string;
  focus: string;
  success: string;
  warning: string;
  danger: string;
  /** Board skin. */
  squareLight: string;
  squareDark: string;
  boardEdge: string;
  /** Piece set. */
  players: readonly [string, string];
  playersEdge: readonly [string, string];
  /** Colour of the crown and markings drawn on each side's pieces. */
  playersInk: readonly [string, string];
  /** A readable colour for text that refers to each player. */
  playerAccent: readonly [string, string];
  /** What each side is called, e.g. "Red" and "Black" for the classic set. */
  playerNames: readonly [string, string];
}

type Base = Omit<
  Theme,
  'squareLight' | 'squareDark' | 'boardEdge' | 'players' | 'playersEdge' | 'playersInk' | 'playerAccent' | 'playerNames'
>;

const DARK: Base = {
  scheme: 'dark',
  background: '#0d0f1f',
  panel: '#171a33',
  panelRaised: '#22264a',
  border: '#2f3466',
  text: '#f1f2ff',
  textMuted: '#9a9fce',
  travel: '#4de1ff',
  focus: '#ffffff',
  success: '#5cf08c',
  warning: '#ffb547',
  danger: '#ff5c7a',
};

const LIGHT: Base = {
  scheme: 'light',
  background: '#f3f4fb',
  panel: '#ffffff',
  panelRaised: '#e9ebf8',
  border: '#cfd3ea',
  text: '#15172b',
  textMuted: '#5b6084',
  travel: '#0a9fc6',
  focus: '#15172b',
  success: '#1e9a54',
  warning: '#b86e00',
  danger: '#d63b57',
};

export interface Skin {
  id: string;
  name: string;
  squareLight: string;
  squareDark: string;
  boardEdge: string;
  /** Cosmetic packs may later be sold; free ones are always available. */
  premium: boolean;
}

export const SKINS: readonly Skin[] = [
  { id: 'classic', name: 'Walnut', squareLight: '#e7d3ad', squareDark: '#8a5a3c', boardEdge: '#5a3a26', premium: false },
  { id: 'marble', name: 'Marble', squareLight: '#f1f1f4', squareDark: '#7c8290', boardEdge: '#4d515c', premium: false },
  { id: 'forest', name: 'Forest', squareLight: '#eae5c8', squareDark: '#4f7a4a', boardEdge: '#2f4a2c', premium: true },
  { id: 'midnight', name: 'Midnight', squareLight: '#3a4062', squareDark: '#1b1f3a', boardEdge: '#12142a', premium: true },
  { id: 'cherry', name: 'Cherry', squareLight: '#f3d9c4', squareDark: '#a8413a', boardEdge: '#6b2620', premium: true },
];

export interface PieceSet {
  id: string;
  name: string;
  /** What each side is called while this set is in use. */
  names: readonly [string, string];
  colors: readonly [string, string];
  edge: readonly [string, string];
  ink: readonly [string, string];
  accent: { dark: readonly [string, string]; light: readonly [string, string] };
  premium: boolean;
}

export const PIECE_SETS: readonly PieceSet[] = [
  {
    id: 'classic',
    name: 'Red & black',
    names: ['Red', 'Black'],
    colors: ['#e8333f', '#262633'],
    edge: ['#8f1620', '#c9cbe6'],
    ink: ['#ffe2e4', '#ffd66b'],
    accent: { dark: ['#e8333f', '#c9cbe6'], light: ['#c4202c', '#262633'] },
    premium: false,
  },
  {
    id: 'ivory',
    name: 'Ivory & ebony',
    names: ['Ivory', 'Ebony'],
    colors: ['#f4ead2', '#1f1a17'],
    edge: ['#b7a77c', '#7d6a58'],
    ink: ['#8a6d2b', '#e8c877'],
    accent: { dark: ['#f4ead2', '#c9b79a'], light: ['#8a6d2b', '#1f1a17'] },
    premium: false,
  },
  {
    id: 'sunset',
    name: 'Amber & violet',
    names: ['Amber', 'Violet'],
    colors: ['#ff9f2e', '#6d3bd9'],
    edge: ['#b0611a', '#3c1f86'],
    ink: ['#4a2a00', '#ffe9b0'],
    accent: { dark: ['#ff9f2e', '#b18cff'], light: ['#b0611a', '#4c25a8'] },
    premium: true,
  },
  {
    id: 'sea',
    name: 'Sea glass',
    names: ['Aqua', 'Navy'],
    colors: ['#6fe3d1', '#1d3557'],
    edge: ['#2a8f80', '#0e1b2f'],
    ink: ['#0e4a42', '#bfe4ff'],
    accent: { dark: ['#6fe3d1', '#9ec5ff'], light: ['#1f7f72', '#1d3557'] },
    premium: true,
  },
];

export function buildTheme(scheme: Scheme, skinId: string, piecesId: string): Theme {
  const base = scheme === 'dark' ? DARK : LIGHT;
  const skin = SKINS.find((s) => s.id === skinId) ?? SKINS[0];
  const set = PIECE_SETS.find((p) => p.id === piecesId) ?? PIECE_SETS[0];
  return {
    ...base,
    squareLight: skin.squareLight,
    squareDark: skin.squareDark,
    boardEdge: skin.boardEdge,
    players: set.colors,
    playersEdge: set.edge,
    playersInk: set.ink,
    playerAccent: set.accent[scheme],
    playerNames: set.names,
  };
}

/** The default theme, for code that runs before a provider exists. */
export const DEFAULT_THEME: Theme = buildTheme('dark', 'classic', 'classic');

export function playerColor(theme: Theme, p: Player): string {
  return theme.players[p];
}

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 };
export const radius = { sm: 6, md: 10, lg: 16, pill: 999 };

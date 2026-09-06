import type { Player } from '../engine';

export const colors = {
  background: '#0d0f1f',
  panel: '#171a33',
  panelRaised: '#22264a',
  border: '#2f3466',
  text: '#f1f2ff',
  textMuted: '#9a9fce',
  squareLight: '#e7d3ad',
  squareDark: '#8a5a3c',
  boardEdge: '#5a3a26',
  travel: '#4de1ff',
  focus: '#ffffff',
  success: '#5cf08c',
  warning: '#ffb547',
  danger: '#ff5c7a',
  players: ['#e8333f', '#262633'] as const,
  playersEdge: ['#8f1620', '#c9cbe6'] as const,
  playersInk: ['#ffe2e4', '#ffd66b'] as const,
};

export function playerColor(p: Player): string {
  return colors.players[p];
}

/** Colour used for text and rings that refer to a player; Black gets a readable light tone. */
export function playerAccent(p: Player): string {
  return p === 0 ? colors.players[0] : colors.playersEdge[1];
}

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 };
export const radius = { sm: 6, md: 10, lg: 16, pill: 999 };

import { buildTheme, PIECE_SETS, SKINS } from '../theme';

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return channels.map((v) => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
    .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
}

function contrast(foreground: string, background: string): number {
  const a = luminance(foreground), b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

describe.each(['light', 'dark'] as const)('%s player labels', (scheme) => {
  test('normal and secondary text remain readable on every panel', () => {
    const theme = buildTheme(scheme, 'classic', 'classic');
    for (const background of [theme.background, theme.panel, theme.panelRaised]) {
      for (const foreground of [theme.text, theme.textMuted]) {
        expect(contrast(foreground, background)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
  test.each(PIECE_SETS)('$name text remains readable in every board skin', (set) => {
    for (const skin of SKINS) {
      const theme = buildTheme(scheme, skin.id, set.id);
      for (const background of [theme.background, theme.panel, theme.panelRaised]) {
        for (const foreground of theme.playerAccent) {
          expect(contrast(foreground, background)).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });
});

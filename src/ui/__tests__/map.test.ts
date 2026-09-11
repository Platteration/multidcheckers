/**
 * Which part of the multiverse map is drawn. Every board on it is a thumbnail
 * of some seventy views and the board count grows with moves x timelines, so
 * what the map costs to draw has to follow the size of the screen rather than
 * the size of the game: a large multiverse, imported or played, would otherwise
 * be a frozen app rather than a map that needs scrolling.
 */
// The map pulls in the thumbnails, which pull in the theme and with it the
// storage the app keeps its settings in. None of that is under test here.
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} },
}));

import { MINI_HEIGHT, MINI_WIDTH } from '../MiniBoard';
import { HEADER, ROW, SLOT, visibleBand } from '../MultiverseMap';

/** A phone-sized map pane, and a few places the player might have scrolled it to. */
const VIEWPORT = { width: 380, height: 260 };
const SCROLLS = [
  { x: 0, y: 0 },
  { x: 37, y: 11 },
  { x: SLOT * 4, y: ROW * 3 },
  { x: SLOT * 240 + 5, y: ROW * 50 + 9 },
];

const turns = (band: { fromTurn: number; toTurn: number }) => band.toTurn - band.fromTurn + 1;
const rows = (band: { fromTimeline: number; toTimeline: number }) => band.toTimeline - band.fromTimeline + 1;

describe('the part of the map that gets drawn', () => {
  it('covers every board the viewport shows', () => {
    // Skipping a board that is on screen is the way windowing goes wrong, so
    // the band is checked against where the map actually puts each thumbnail.
    for (const scroll of SCROLLS) {
      const band = visibleBand(scroll, VIEWPORT);
      for (let turn = 0; turn < 400; turn++) {
        const left = (turn + 1) * SLOT;
        if (left + MINI_WIDTH <= scroll.x || left >= scroll.x + VIEWPORT.width) continue;
        expect(band.fromTurn).toBeLessThanOrEqual(turn);
        expect(band.toTurn).toBeGreaterThanOrEqual(turn);
      }
      for (let timeline = 0; timeline < 400; timeline++) {
        const top = HEADER + timeline * ROW + 8;
        if (top + MINI_HEIGHT <= scroll.y || top >= scroll.y + VIEWPORT.height) continue;
        expect(band.fromTimeline).toBeLessThanOrEqual(timeline);
        expect(band.toTimeline).toBeGreaterThanOrEqual(timeline);
      }
    }
  });

  it('is the size of the screen wherever the map has been scrolled to', () => {
    // Far into the biggest game this app will load, the band is what it is at
    // the start: a screenful, and a couple of rows and columns either side.
    const start = visibleBand({ x: 0, y: 0 }, VIEWPORT);
    const deep = visibleBand({ x: 600 * SLOT, y: 96 * ROW }, VIEWPORT);
    expect(turns(deep)).toBe(turns(start));
    expect(rows(deep)).toBe(rows(start));
    expect(turns(start)).toBeLessThan(VIEWPORT.width / SLOT + 8);
    expect(rows(start)).toBeLessThan(VIEWPORT.height / ROW + 8);
  });
});

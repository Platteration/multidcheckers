/**
 * The map as it is actually rendered. `map.test.ts` covers the arithmetic of
 * the band; this covers the two lines that use it - the row and the column the
 * component skips - and the wiring around them, which is the largest part of
 * the map and had no test at all: both guards could be deleted with the whole
 * suite staying green.
 *
 * The map pulls in the thumbnails, which pull in the theme and with it the
 * storage the app keeps its settings in. None of that is under test here.
 */
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} },
}));

import React from 'react';
import { Animated, ScrollView, StyleSheet } from 'react-native';
import TestRenderer, { ReactTestInstance, ReactTestRenderer, act } from 'react-test-renderer';
import { Action, BoardRef, GameState, Timeline, applyAction, getTimeline, index, latestBoard, newGame, timelineLabel } from '../../engine';
import { ROW, SLOT, MultiverseMap } from '../MultiverseMap';

/** A phone-sized map pane. */
const VIEWPORT = { width: 380, height: 260 };

/**
 * A multiverse of a given size. Nothing here has to be played: the map draws
 * from the counts and the boards, and every board of a real game is shared by
 * reference anyway.
 */
function multiverse(timelines: number, boardsEach: number): GameState {
  const start = newGame();
  const board = latestBoard(getTimeline(start, 0));
  const rows: Timeline[] = Array.from({ length: timelines }, (_, id) => ({
    id,
    startTurn: 0,
    boards: new Array(boardsEach).fill(board),
    createdBy: id === 0 ? null : ((id % 2) as 0 | 1),
    branchedFrom: id === 0 ? null : { timeline: id - 1, turn: 0 },
    origin: id === 0 ? null : { timeline: id - 1, turn: 0 },
  }));
  return { ...start, timelines: rows };
}

const mapElement = (state: GameState, focus: BoardRef, reduceMotion = false) =>
  React.createElement(MultiverseMap, { state, focus, targets: [], origin: null, onPressBoard: () => {}, reduceMotion });

const render = (state: GameState, focus: BoardRef, reduceMotion = false): ReactTestRenderer => {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(mapElement(state, focus, reduceMotion));
  });
  return tree;
};

const scrollViews = (tree: ReactTestRenderer): ReactTestInstance[] => tree.root.findAllByType(ScrollView);

const layout = (tree: ReactTestRenderer, size: { width: number; height: number }) =>
  act(() => {
    (scrollViews(tree)[0]!.props.onLayout as (e: unknown) => void)({ nativeEvent: { layout: { ...size, x: 0, y: 0 } } });
  });

/** The scroll the focus effect's scrollTo would produce, delivered by hand. */
const scrollTo = (tree: ReactTestRenderer, to: { x: number; y: number }) =>
  act(() => {
    const [horizontal, vertical] = scrollViews(tree);
    (horizontal!.props.onScroll as (e: unknown) => void)({ nativeEvent: { contentOffset: { x: to.x, y: 0 } } });
    (vertical!.props.onScroll as (e: unknown) => void)({ nativeEvent: { contentOffset: { x: 0, y: to.y } } });
  });

/** The host views of the tree: one node per thing on screen, composites aside. */
const hosts = (tree: ReactTestRenderer): ReactTestInstance[] => tree.root.findAll((node) => typeof node.type === 'string');

/** Every board actually mounted, by the label the map gives it. */
const drawn = (tree: ReactTestRenderer): string[] =>
  hosts(tree)
    .map((node) => node.props.accessibilityLabel)
    .filter((label): label is string => typeof label === 'string' && / turn \d+,/.test(label));

const labelFor = (ref: BoardRef) => `${timelineLabel(ref.timeline)} turn ${ref.turn}`;
const isDrawn = (tree: ReactTestRenderer, ref: BoardRef) => drawn(tree).some((label) => label.startsWith(labelFor(ref)));

/** Where the focus effect scrolls to for this board. */
const focusOffset = (ref: BoardRef) => ({
  x: Math.max(0, (ref.turn + 1) * SLOT + SLOT / 2 - VIEWPORT.width / 2),
  y: Math.max(0, ref.timeline * ROW + ROW / 2 - VIEWPORT.height / 2),
});

describe('what the map mounts', () => {
  it('draws a screenful of a big multiverse, and keeps a row of space for the rest', () => {
    // 90 timelines of 60 boards is 5,400 thumbnails of some seventy views each,
    // and the map has to skip them in both directions: the rows outside the
    // viewport and, inside the rows it does draw, the turns outside it. The
    // bound is the screen and not either guard - what fits on a 380x260 pane is
    // its own width and height in slots and rows, plus the overscan either
    // side. Measured: 56 boards drawn out of 5,400.
    const state = multiverse(90, 60);
    const tree = render(state, { timeline: 0, turn: 0 });
    layout(tree, VIEWPORT);
    const roomFor = Math.ceil(VIEWPORT.width / SLOT + 6) * Math.ceil(VIEWPORT.height / ROW + 6);
    expect(roomFor).toBeLessThan(5400 / 40);
    expect(drawn(tree).length).toBeGreaterThan(0);
    expect(drawn(tree).length).toBeLessThanOrEqual(roomFor);

    // A row outside the band keeps its height and nothing else. If it did not,
    // the scroll position would stop matching where the boards are, and the map
    // would draw the wrong part of itself.
    const rows = hosts(tree).filter((node) => {
      const style = StyleSheet.flatten(node.props.style as never) as { height?: number } | undefined;
      return !!style && style.height === ROW;
    });
    expect(rows).toHaveLength(state.timelines.length);
  });

  it('follows the focus, and redraws from it when the scroll position stops meaning anything', () => {
    // The player jumps to a board deep in the multiverse; the map scrolls there
    // and the band has to follow, or they are looking at an empty region.
    const focus: BoardRef = { timeline: 80, turn: 9 };
    const tree = render(multiverse(90, 14), focus);
    layout(tree, VIEWPORT);
    scrollTo(tree, focusOffset(focus));
    expect(isDrawn(tree, focus)).toBe(true);
    // And the far corner it came from is no longer mounted.
    expect(isDrawn(tree, { timeline: 0, turn: 0 })).toBe(false);

    // Menu -> New game with the map still scrolled down there: the content
    // shrinks to one timeline under a scroll position deep in the old one.
    // Every platform clamps an over-scrolled offset and reports it, but nothing
    // in the map re-derived the band on its own, so the one path that does not
    // report it left a blank map that scrolling could not fix.
    act(() => {
      tree.update(mapElement(multiverse(1, 3), { timeline: 0, turn: 0 }));
    });
    expect(isDrawn(tree, { timeline: 0, turn: 0 })).toBe(true);
  });

  it('draws around the focus while nothing has been measured', () => {
    // A layout that reports no width leaves the map with no idea where it is.
    // It used to keep the top-left corner in that case - and skip the scroll
    // that would have moved it - so a restored game focused deep in the
    // multiverse showed an empty region for as long as that layout lasted.
    const focus: BoardRef = { timeline: 80, turn: 9 };
    const tree = render(multiverse(90, 14), focus);
    layout(tree, { width: 0, height: 260 });
    expect(isDrawn(tree, focus)).toBe(true);
  });
});

describe('the flight a time travel draws across the map', () => {
  // Four moves and a travel: the same tiny multiverse the welcome pages use.
  const move = (from: number, to: number): Action => ({ type: 'move', timeline: 0, move: { from, path: [to], captures: [] } });
  const travelled = [
    move(index(2, 1), index(3, 0)),
    move(index(5, 6), index(4, 7)),
    move(index(2, 3), index(3, 2)),
    move(index(5, 4), index(4, 5)),
    { type: 'travel', from: { timeline: 0, square: index(3, 2) }, to: { timeline: 0, turn: 2 } } as Action,
  ].reduce((state, action) => applyAction(state, action), newGame());

  /** Animated.timing, stubbed: what is under test is whether it is asked for at all. */
  let timing: jest.SpyInstance;
  beforeEach(() => {
    timing = jest.spyOn(Animated, 'timing').mockImplementation(
      () => ({ start: () => {}, stop: () => {}, reset: () => {} }) as unknown as Animated.CompositeAnimation,
    );
  });
  afterEach(() => timing.mockRestore());

  it('is the one decorative thing on the map, and it flies when motion is not reduced', () => {
    // The state has to be one the map draws a flight for at all, or the test
    // below would pass with the guard deleted.
    expect(travelled.lastAction?.type).toBe('travel');
    expect(travelled.lastCreated).toHaveLength(2);
    const tree = render(travelled, travelled.lastCreated[1]!);
    expect(timing).toHaveBeenCalled();
    act(() => tree.unmount());
  });

  it('is skipped when the player, or their device, asked for less motion', () => {
    // The only thing reduce motion switches off. The scroll still happens, and
    // still lands on the same board: see focusScroll in map.test.ts.
    const tree = render(travelled, travelled.lastCreated[1]!, true);
    expect(timing).not.toHaveBeenCalled();
    act(() => tree.unmount());
  });

  it('starts nothing at all when the last action was not a travel', () => {
    const tree = render(multiverse(3, 4), { timeline: 0, turn: 0 });
    expect(timing).not.toHaveBeenCalled();
    act(() => tree.unmount());
  });
});

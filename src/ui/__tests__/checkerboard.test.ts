/**
 * The big board is told where a square sits as a row and a column and has to
 * hand that square back as one index when it is pressed. Nothing downstream
 * checks the index: GameScreen passes it straight to pressSquare, which reads
 * the piece on it, so the two numbers folding into the right index is the
 * whole of the press - and only a dark square, and only while the board is
 * interactive, may press at all. The sibling game's thumbnail test, for the
 * board that takes presses here: this app's thumbnails carry no place of
 * their own, the map closes over the ref itself.
 */
// The board reads the theme, which reaches the settings store and its storage.
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} },
}));

import React from 'react';
import TestRenderer, { ReactTestInstance, ReactTestRenderer, act } from 'react-test-renderer';
import { SIZE, getTimeline, index, isPlayable, latestBoard, newGame } from '../../engine';
import { CheckerBoard } from '../CheckerBoard';

type Props = React.ComponentProps<typeof CheckerBoard>;

/** Renders a real board on the starting position and finds its 64 squares. */
function render(props: Partial<Props>) {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(
      React.createElement(CheckerBoard, { board: latestBoard(getTimeline(newGame(), 0)), cellSize: 30, interactive: true, ...props }),
    );
  });
  // The Pressable itself carries the handler, the label and `disabled`; the
  // host view it renders carries only the role and an accessibility state.
  const squares: ReactTestInstance[] = tree.root.findAll(
    (node) => node.props.accessibilityRole === 'button' && typeof node.props.disabled === 'boolean',
  );
  return { squares, unmount: () => act(() => tree.unmount()) };
}

const labelOf = (square: ReactTestInstance): string => square.props.accessibilityLabel as string;
const at = (squares: ReactTestInstance[], fileRank: string): ReactTestInstance | undefined =>
  squares.find((s) => labelOf(s) === fileRank || labelOf(s).startsWith(`${fileRank},`));
/** The row and column a square's label names: 'b3' is column 1, row 2. */
const place = (square: ReactTestInstance): { row: number; col: number } => ({
  row: Number(labelOf(square)[1]) - 1,
  col: labelOf(square).charCodeAt(0) - 97,
});

describe('the board', () => {
  it('reports the square it was given, not a transposition of it', () => {
    const pressed: number[] = [];
    const view = render({ onPressSquare: (sq) => pressed.push(sq) });
    expect(view.squares).toHaveLength(SIZE * SIZE);
    // Two different numbers, so swapping them cannot go unnoticed.
    expect(index(2, 1)).not.toBe(index(1, 2));
    act(() => (at(view.squares, 'b3')!.props.onPress as () => void)());
    act(() => (at(view.squares, 'c2')!.props.onPress as () => void)());
    expect(pressed).toEqual([index(2, 1), index(1, 2)]);
    view.unmount();
  });

  it('is pressable only on the dark squares, and only while interactive', () => {
    const live = render({});
    const enabled = live.squares.filter((s) => s.props.disabled === false);
    expect(enabled).toHaveLength(SIZE * SIZE / 2);
    for (const square of enabled) {
      const { row, col } = place(square);
      expect(isPlayable(row, col)).toBe(true);
    }
    live.unmount();

    // A board that is not the player's to play (a past board, the bot's turn,
    // a finished game) takes no press at all.
    const frozen = render({ interactive: false });
    expect(frozen.squares.filter((s) => s.props.disabled === false)).toHaveLength(0);
    frozen.unmount();
  });

  it('has no press handler where the screen passes none', () => {
    const view = render({});
    for (const square of view.squares) expect(square.props.onPress).toBeUndefined();
    view.unmount();
  });

  it('names each square for a screen reader', () => {
    const view = render({ destinations: [{ square: index(3, 0), capture: false }, { square: index(4, 1), capture: true }] });
    // A light square is just its name; a dark one names the piece on it.
    expect(labelOf(at(view.squares, 'a1')!)).toBe('a1');
    expect(labelOf(at(view.squares, 'b1')!)).toBe('b1, Red man');
    expect(labelOf(at(view.squares, 'g8')!)).toBe('g8, Black man');
    // Where the held piece may land, and whether landing there is a capture.
    expect(labelOf(at(view.squares, 'a4')!)).toBe('a4, move here');
    expect(labelOf(at(view.squares, 'b5')!)).toBe('b5, jump here');
    view.unmount();
  });
});

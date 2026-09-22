/**
 * The last line of defence, and what its buttons do. A render that throws
 * unmounts the whole app, and when the value that threw is the saved game it
 * does so again at every launch; the boundary has to be the way out of that -
 * and out of nothing else. The record, the settings and the puzzle progress are
 * not what crashed, so the reset removes the game key alone, and then remounts
 * the tree so the fresh game actually draws.
 *
 * Two ways out and in this order: drawing the tree again costs nothing, so it
 * is offered first, and clearing the saved game spends it, so it is asked for
 * first. Both halves are pinned below - a fallback that deleted the game from
 * its first button, or offered nothing but that, passes neither.
 */
// Storage in memory, so the reset's one removal can be seen - and so the
// providers above the boundary come up at all.
jest.mock('@react-native-async-storage/async-storage', () => {
  const store = new Map<string, string>();
  return {
    __esModule: true,
    default: {
      getItem: async (key: string) => store.get(key) ?? null,
      setItem: async (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: async (key: string) => {
        store.delete(key);
      },
      getAllKeys: async () => [...store.keys()],
    },
  };
});
// The real provider renders nothing until the native side reports its insets,
// which never happens under the test renderer.
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
// The screen is React Native all the way down and is not what is under test.
// This stand-in throws until told to stop, which is what tells a remount from
// a boundary that merely stopped showing its fallback. (The flag is declared
// below the imports: the factory only reads it when the stand-in renders.)
jest.mock('../GameScreen', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    GameScreen: () => {
      if (mockScreen.broken) throw new Error('a render that throws');
      return React.createElement(Text, null, 'the game');
    },
  };
});

import AsyncStorage from '@react-native-async-storage/async-storage';
import React from 'react';
import { Text } from 'react-native';
import TestRenderer, { ReactTestInstance, ReactTestRenderer, act } from 'react-test-renderer';
import App from '../../../App';
import { KEYS } from '../../app/persist';
import { ErrorBoundary } from '../ErrorBoundary';

const mockScreen = { broken: true };

/** Every host node: one per thing on screen, composites aside. */
const hosts = (tree: ReactTestRenderer): ReactTestInstance[] => tree.root.findAll((node) => typeof node.type === 'string');

/** Every string a person could read on screen. */
const texts = (tree: ReactTestRenderer): string[] =>
  hosts(tree)
    .filter((node) => node.type === 'Text')
    .map((node) => node.props.children)
    .filter((c): c is string => typeof c === 'string');

/**
 * The buttons on screen, in the order they are drawn: which comes first is part
 * of what is being pinned.
 */
const buttons = (tree: ReactTestRenderer): string[] =>
  tree.root
    .findAll((node) => node.props.accessibilityRole === 'button' && typeof node.props.onPress === 'function')
    .map((node) => node.findAll((n) => n.type === 'Text').map((n) => n.props.children)[0])
    .filter((label): label is string => typeof label === 'string');

/**
 * The button a person reads this label on. The press handler sits on the
 * Pressable itself, not on the host view it renders, so this is the one place
 * a composite node is looked at.
 */
const button = (tree: ReactTestRenderer, label: string): ReactTestInstance | undefined =>
  tree.root.findAll(
    (node) =>
      node.props.accessibilityRole === 'button' &&
      typeof node.props.onPress === 'function' &&
      node.findAll((n) => n.type === 'Text').some((n) => n.props.children === label),
  )[0];

/** Let the providers' storage reads settle; each one is a promise and a state change. */
const settle = () =>
  act(async () => {
    for (let i = 0; i < 4; i++) await new Promise((resolve) => setTimeout(resolve, 0));
  });

function Thrower(): never {
  throw new Error('a render that throws');
}

/** A boundary around one child. (The props type lists `children`, which is passed as the child.) */
const boundary = (onReset: () => void, child: React.ReactNode) =>
  React.createElement(ErrorBoundary, { onReset } as React.ComponentProps<typeof ErrorBoundary>, child);

/** A record under every key the app keeps, so the reset's reach can be measured. */
async function seedEveryKey(): Promise<void> {
  for (const key of Object.values(KEYS)) await AsyncStorage.setItem(key, JSON.stringify({ seeded: key }));
}

// React reports a caught render error on the console; that report is the
// boundary working, not a failure of the test.
let consoleError: jest.SpyInstance;
beforeEach(() => {
  consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
  mockScreen.broken = true;
});
afterEach(() => consoleError.mockRestore());

describe('the error boundary', () => {
  it('shows its children while nothing throws', () => {
    let tree!: ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(boundary(() => {}, React.createElement(Text, null, 'fine')));
    });
    expect(texts(tree)).toContain('fine');
    expect(texts(tree)).not.toContain('Something went wrong');
    act(() => tree.unmount());
  });

  it('replaces a child that throws with the fallback, and offers the harmless way out first', () => {
    const onReset = jest.fn();
    let tree!: ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(boundary(onReset, React.createElement(Thrower)));
    });
    expect(texts(tree)).toContain('Something went wrong');
    expect(buttons(tree)).toEqual(['Try again', 'Start a new game']);
    expect(onReset).not.toHaveBeenCalled();
    act(() => tree.unmount());
  });

  it('draws its children again on "Try again", without asking the caller for anything', () => {
    // The non-destructive recovery: nothing is spent, so nothing is asked, and
    // the caller - which is what clears storage - is never called at all.
    const onReset = jest.fn();
    const child = { broken: true };
    function Sometimes() {
      if (child.broken) throw new Error('a render that throws');
      return React.createElement(Text, null, 'drawn');
    }
    let tree!: ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(boundary(onReset, React.createElement(Sometimes)));
    });
    expect(texts(tree)).toContain('Something went wrong');
    child.broken = false;
    act(() => (button(tree, 'Try again')!.props.onPress as () => void)());
    expect(texts(tree)).toEqual(['drawn']);
    expect(onReset).not.toHaveBeenCalled();
    act(() => tree.unmount());
  });

  it('asks before it deletes the saved game', () => {
    const onReset = jest.fn();
    let tree!: ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(boundary(onReset, React.createElement(Thrower)));
    });
    // Pressing the destructive button spends nothing yet: it asks.
    act(() => (button(tree, 'Start a new game')!.props.onPress as () => void)());
    expect(onReset).not.toHaveBeenCalled();
    expect(texts(tree)).toContain('Start a new game?');
    expect(buttons(tree)).toEqual(['Delete it and start', 'Keep it']);

    // Backing out leaves the record where it is, and the way back in is intact.
    act(() => (button(tree, 'Keep it')!.props.onPress as () => void)());
    expect(onReset).not.toHaveBeenCalled();
    expect(buttons(tree)).toEqual(['Try again', 'Start a new game']);

    // Only the answer deletes anything.
    act(() => (button(tree, 'Start a new game')!.props.onPress as () => void)());
    act(() => (button(tree, 'Delete it and start')!.props.onPress as () => void)());
    expect(onReset).toHaveBeenCalledTimes(1);
    act(() => tree.unmount());
  });
});

describe('the app around it', () => {
  it('recovers without spending anything when drawing it again is enough', async () => {
    // The first thing offered, and the one that costs nothing: no record is
    // touched, and the screen that failed once draws on the second attempt.
    await seedEveryKey();
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(React.createElement(App));
    });
    await settle();
    expect(texts(tree)).toContain('Something went wrong');

    mockScreen.broken = false;
    await act(async () => (button(tree, 'Try again')!.props.onPress as () => void)());
    await settle();
    expect(texts(tree)).toContain('the game');
    expect([...(await AsyncStorage.getAllKeys())].sort()).toEqual(Object.values(KEYS).sort());
    await act(async () => tree.unmount());
  });

  it('clears only the saved game on reset, and then draws a fresh tree', async () => {
    await seedEveryKey();
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(React.createElement(App));
    });
    await settle();
    // The crash is caught, and the crash alone deletes nothing.
    expect(texts(tree)).toContain('Something went wrong');
    expect(texts(tree)).not.toContain('the game');
    expect([...(await AsyncStorage.getAllKeys())].sort()).toEqual(Object.values(KEYS).sort());

    // The screen would draw now; only the boundary is in the way.
    mockScreen.broken = false;
    await act(async () => (button(tree, 'Start a new game')!.props.onPress as () => void)());
    // ...and the question in the way of that: nothing is removed until it is answered.
    expect([...(await AsyncStorage.getAllKeys())].sort()).toEqual(Object.values(KEYS).sort());
    await act(async () => (button(tree, 'Delete it and start')!.props.onPress as () => void)());
    await settle();

    // The game key is gone and every other record is untouched.
    const kept = [...(await AsyncStorage.getAllKeys())].sort();
    expect(kept).not.toContain(KEYS.game);
    expect(kept).toEqual(
      Object.values(KEYS)
        .filter((key) => key !== KEYS.game)
        .sort(),
    );
    // And the tree was remounted: a boundary left in its failed state would
    // keep showing the fallback over a screen that now renders fine.
    expect(texts(tree)).not.toContain('Something went wrong');
    expect(texts(tree)).toContain('the game');
    await act(async () => tree.unmount());
  });
});

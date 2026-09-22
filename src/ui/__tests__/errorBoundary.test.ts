/**
 * The last line of defence, and what its one button does. A render that throws
 * unmounts the whole app, and when the value that threw is the saved game it
 * does so again at every launch; the boundary's "Start a new game" has to be
 * the way out of that - and out of nothing else. The record, the settings and
 * the puzzle progress are not what crashed, so the reset removes the game key
 * alone, and then remounts the tree so the fresh game actually draws.
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

  it('replaces a child that throws with the fallback, whose button asks for the reset', () => {
    const onReset = jest.fn();
    let tree!: ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(boundary(onReset, React.createElement(Thrower)));
    });
    expect(texts(tree)).toContain('Something went wrong');
    const start = button(tree, 'Start a new game');
    expect(start).toBeDefined();
    expect(onReset).not.toHaveBeenCalled();
    act(() => (start!.props.onPress as () => void)());
    expect(onReset).toHaveBeenCalledTimes(1);
    act(() => tree.unmount());
  });
});

describe('the app around it', () => {
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

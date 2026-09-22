/**
 * The boundary above the providers. errorBoundary.test.ts covers the one below
 * them, which catches everything the screen does; this covers the gap that one
 * cannot see - a provider itself throwing, which unmounted the app to a blank
 * screen with no button on it, because the only boundary was mounted inside the
 * thing that failed.
 *
 * The provider is made to throw by mocking it, which is the only way to stage
 * it: with validate.ts in place no stored record can make one throw today, and
 * that is exactly why the hole was invisible rather than why it is safe.
 */
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
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
// The screen is React Native all the way down (and pulls in expo-audio, which
// does not load outside an app), and it is not what is under test: nothing
// below the provider that throws is ever rendered here.
jest.mock('../GameScreen', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return { GameScreen: () => React.createElement(Text, null, 'the game') };
});
// The one provider under test: everything else about the module stays real, so
// the modules that import useSettings from it still work.
jest.mock('../../app/settings', () => {
  const actual = jest.requireActual('../../app/settings');
  return {
    ...actual,
    SettingsProvider: () => {
      throw new Error('a provider that throws');
    },
  };
});

import React from 'react';
import TestRenderer, { ReactTestRenderer, act } from 'react-test-renderer';
import App from '../../../App';

const texts = (tree: ReactTestRenderer): string[] =>
  tree.root
    .findAll((node) => node.type === 'Text')
    .map((node) => node.props.children)
    .filter((c): c is string => typeof c === 'string');

const labels = (tree: ReactTestRenderer): string[] =>
  tree.root
    .findAll((node) => node.props.accessibilityRole === 'button' && typeof node.props.onPress === 'function')
    .map((node) => node.findAll((n) => n.type === 'Text').map((n) => n.props.children)[0])
    .filter((label): label is string => typeof label === 'string');

let consoleError: jest.SpyInstance;
beforeEach(() => {
  consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => consoleError.mockRestore());

describe('a provider that throws', () => {
  it('reaches a boundary, and the player still gets the two ways out', async () => {
    // Without the outer boundary this render produces nothing at all: no text,
    // no button, no way back from inside the app.
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(React.createElement(App));
    });
    expect(texts(tree)).toContain('Something went wrong');
    expect(labels(tree)).toEqual(['Try again', 'Start a new game']);
    // ...drawn against the app's own palette, which the provider that threw is
    // what would normally supply.
    await act(async () => tree.unmount());
  });
});

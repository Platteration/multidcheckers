/**
 * What the app does at launch with a saved game it cannot replay. The record is
 * refused - replaying half of one rebuilds a game nobody played - and refusing
 * it used to be the whole story: it stayed under the game key, was read and
 * failed again at every launch, and the player was told nothing at all. They
 * simply found a fresh board where their unfinished game had been.
 *
 * battleshiple's rule for the same situation: a save the app fails to play is
 * set aside and not re-offered, not deleted. That is what is pinned here, both
 * halves of it - the record survives, and the launch after it is clean.
 */
jest.mock('@react-native-async-storage/async-storage', () => {
  const store = new Map<string, string>();
  return {
    __esModule: true,
    __store: store,
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
// The screen is React Native all the way down and is not what is under test;
// this stand-in records the props the launch hands it.
jest.mock('../../ui/GameScreen', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    GameScreen: (props: Record<string, unknown>) => {
      mockScreen.props.push(props);
      return React.createElement(Text, null, 'the game');
    },
  };
});

import React from 'react';
import TestRenderer, { ReactTestRenderer, act } from 'react-test-renderer';
import App from '../../../App';
import { KEYS } from '../persist';

const mockScreen: { props: Record<string, unknown>[] } = { props: [] };
const { __store: store } = jest.requireMock('@react-native-async-storage/async-storage') as { __store: Map<string, string> };

/** A record of the player's own that this build will not replay: a state with no action behind it. */
const UNREADABLE = JSON.stringify({ version: 2, setup: { mode: 'local' }, history: [{ timelines: [] }, { lastAction: null }] });

/** Let the providers' storage reads settle; each one is a promise and a state change. */
const settle = () =>
  act(async () => {
    for (let i = 0; i < 6; i++) await new Promise((resolve) => setTimeout(resolve, 0));
  });

/** One launch of the app, from whatever is in the store. */
async function launch(): Promise<ReactTestRenderer> {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = TestRenderer.create(React.createElement(App));
  });
  await settle();
  return tree;
}

beforeEach(() => {
  store.clear();
  mockScreen.props = [];
});

describe('a saved game the app cannot replay', () => {
  it('is set aside at the first launch, and the second launch is a clean one', async () => {
    store.set(KEYS.game, UNREADABLE);
    const first = await launch();
    // Kept, under its own key, byte for byte - and no longer where the launch
    // reads it from.
    expect(store.has(KEYS.game)).toBe(false);
    expect(JSON.parse(store.get(KEYS.setAside)!)).toEqual(JSON.parse(UNREADABLE));
    // The screen is told the record is not ours to clear, so a fresh game
    // started over it cannot quietly write the slot away either.
    expect(mockScreen.props[mockScreen.props.length - 1].keepStoredGame).toBe(true);
    expect(mockScreen.props[mockScreen.props.length - 1].initialHistory).toBeUndefined();
    await act(async () => first.unmount());

    // The next launch: nothing to read, nothing to replay, nothing to say.
    mockScreen.props = [];
    const second = await launch();
    expect(mockScreen.props[mockScreen.props.length - 1].keepStoredGame).toBe(false);
    expect(store.has(KEYS.setAside)).toBe(true);
    await act(async () => second.unmount());
  });

  it('leaves a game it can replay exactly where it is', async () => {
    // The guard on the other side: a good save is resumed, not moved.
    store.set(KEYS.game, JSON.stringify({ version: 3, rules: {}, setup: { mode: 'local' }, actions: [] }));
    const tree = await launch();
    expect(store.has(KEYS.setAside)).toBe(false);
    expect(store.has(KEYS.game)).toBe(true);
    expect(mockScreen.props[mockScreen.props.length - 1].keepStoredGame).toBe(false);
    expect(mockScreen.props[mockScreen.props.length - 1].initialHistory).toBeDefined();
    await act(async () => tree.unmount());
  });
});

/**
 * The reduce-motion hook, under the two things the platforms do that a naive
 * hook gets wrong: the native query rejects when its module is absent (which
 * is exactly this environment), and the web has pages without `matchMedia`,
 * where react-native-web's own query answers true.
 */
import React from 'react';
import { AccessibilityInfo, Platform, Text } from 'react-native';
import TestRenderer, { ReactTestRenderer, act } from 'react-test-renderer';
import type { ReduceMotionChoice } from '../app/settings';
import { useReduceMotion } from '../motion';

function Probe({ setting }: { setting: ReduceMotionChoice }) {
  return React.createElement(Text, null, useReduceMotion(setting) ? 'reduced' : 'full');
}

/** Mount, and let the platform's answer arrive. */
async function render(setting: ReduceMotionChoice): Promise<ReactTestRenderer> {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = TestRenderer.create(React.createElement(Probe, { setting }));
  });
  return tree;
}

const shown = (tree: ReactTestRenderer): string => tree.root.findByType(Text).props.children as string;

const query = jest.mocked(AccessibilityInfo.isReduceMotionEnabled);
// The preset's mock; the overloads are per event name, so it is typed by hand.
const subscribe = AccessibilityInfo.addEventListener as unknown as jest.Mock<{ remove: () => void }, [string, (on: boolean) => void]>;

/** The last `reduceMotionChanged` handler the hook registered. */
const nativeHandler = (): ((on: boolean) => void) => {
  const call = subscribe.mock.calls.filter(([name]) => name === 'reduceMotionChanged').at(-1);
  if (!call) throw new Error('the hook did not subscribe');
  return call[1];
};

type Listener = (e: { matches: boolean }) => void;

/** A `window.matchMedia` that answers `matches` and hands back its change listeners. */
function fakeMatchMedia(matches: boolean) {
  const listeners = new Set<Listener>();
  const media = {
    matches,
    media: '',
    addEventListener: (_: 'change', fn: Listener) => listeners.add(fn),
    removeEventListener: (_: 'change', fn: Listener) => listeners.delete(fn),
  };
  return {
    matchMedia: jest.fn(() => media),
    change: (to: boolean) => listeners.forEach((fn) => fn({ matches: to })),
    listeners,
  };
}

/** Install a `window` for the web branch to read, and hand back the undo. */
function withWindow(win: object | undefined): () => void {
  const g = globalThis as { window?: unknown };
  const had = Object.prototype.hasOwnProperty.call(g, 'window');
  const previous = g.window;
  if (win === undefined) delete g.window;
  else g.window = win;
  return () => {
    if (had) g.window = previous;
    else delete g.window;
  };
}

beforeEach(() => {
  query.mockReset();
  subscribe.mockReset();
  subscribe.mockImplementation(() => ({ remove: jest.fn() }));
  jest.restoreAllMocks();
});

describe('on a phone', () => {
  it('reads the platform, and follows it when it changes', async () => {
    query.mockResolvedValue(false);
    const tree = await render('system');
    expect(shown(tree)).toBe('full');
    act(() => nativeHandler()(true));
    expect(shown(tree)).toBe('reduced');
    act(() => nativeHandler()(false));
    expect(shown(tree)).toBe('full');
  });

  it('takes a platform that already asks for less motion', async () => {
    query.mockResolvedValue(true);
    expect(shown(await render('system'))).toBe('reduced');
  });

  it('reads a rejected query as no preference, not as reduce', async () => {
    // What React Native does when the native module is not there.
    query.mockRejectedValue(new Error('NativeAccessibilityInfoAndroid is not available'));
    expect(shown(await render('system'))).toBe('full');
  });

  it('lets the player override the platform either way', async () => {
    query.mockResolvedValue(true);
    expect(shown(await render('off'))).toBe('full');
    query.mockResolvedValue(false);
    expect(shown(await render('on'))).toBe('reduced');
  });

  it('unsubscribes on unmount', async () => {
    query.mockResolvedValue(false);
    const remove = jest.fn();
    subscribe.mockImplementation(() => ({ remove }));
    const tree = await render('system');
    act(() => tree.unmount());
    expect(remove).toHaveBeenCalledTimes(1);
  });
});

describe('on the web', () => {
  let undo: () => void = () => {};
  beforeEach(() => {
    jest.replaceProperty(Platform, 'OS', 'web');
  });
  afterEach(() => undo());

  it('reads a page without matchMedia as no preference', async () => {
    undo = withWindow({});
    expect(shown(await render('system'))).toBe('full');
    expect(query).not.toHaveBeenCalled();
  });

  it('reads a page with no window at all as no preference', async () => {
    undo = withWindow(undefined);
    expect(shown(await render('system'))).toBe('full');
  });

  it('reads prefers-reduced-motion, and follows it when it changes', async () => {
    const fake = fakeMatchMedia(true);
    undo = withWindow({ matchMedia: fake.matchMedia });
    const tree = await render('system');
    expect(fake.matchMedia).toHaveBeenCalledWith('(prefers-reduced-motion: reduce)');
    expect(shown(tree)).toBe('reduced');
    act(() => fake.change(false));
    expect(shown(tree)).toBe('full');
    act(() => tree.unmount());
    expect(fake.listeners.size).toBe(0);
  });

  it('reads a page that does not prefer reduced motion as full motion', async () => {
    const fake = fakeMatchMedia(false);
    undo = withWindow({ matchMedia: fake.matchMedia });
    expect(shown(await render('system'))).toBe('full');
  });
});

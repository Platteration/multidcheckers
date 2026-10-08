/**
 * The link the app was launched with is answered once. `Linking.getInitialURL`
 * reports the same address for as long as the app runs - React Native keeps
 * the intent or launch option that started it, and react-native-web reads
 * `location.href` once, when the bundle loads - so it is no record of what is
 * still waiting to be answered. The screen asked it again on every mount, and
 * the error boundary mounts the screen again, from both of its buttons: after
 * a render failure, "Start a new game" promised a new game and loaded the
 * link's game instead, with no question asked, even when the player had
 * already declined that link with "Keep playing", and the autosave wrote it
 * over the record the reset had just removed; "Try again" put the declined
 * link's question back in front of them.
 *
 * This mounts the real App and GameScreen, with one sheet below the boundary
 * that can be made to throw, and has the platform report the same link on
 * every call, the way the platform does.
 */
import type { ReactTestInstance, ReactTestRenderer } from 'react-test-renderer';
import { KEYS } from '../../app/persist';
import { SavedGame, actionsOf } from '../../app/setup';
import { encodeGame } from '../../app/share';
import { Action, GameState, Move, applyAction, index, newGame } from '../../engine';

// (babel-jest lifts every jest.mock above these imports.)
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
// The real provider renders nothing until the native side reports its insets.
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
// expo-audio does not load outside an app, and no sound is under test.
jest.mock('../../app/sound', () => ({ playSound: () => {}, setSoundEnabled: () => {} }));
// One sheet that renders with the screen and throws while told to: any render
// failure below the boundary is what puts its two buttons in front of the player.
jest.mock('../StatsModal', () => ({
  StatsModal: () => {
    if (mockFailure.on) throw new Error('a render that throws');
    return null;
  },
}));

const mockFailure = { on: false };

const step = (from: [number, number], to: [number, number], captures: [number, number][] = []): Action => {
  const move: Move = { from: index(...from), path: [index(...to)], captures: captures.map((sq) => index(...sq)) };
  return { type: 'move', timeline: 0, move };
};
const play = (...actions: Action[]): GameState[] => actions.reduce((h, a) => [...h, applyAction(h[h.length - 1]!, a)], [newGame()]);

/** The link's game: a man each, then Black jumps the one on c4 and lands on b3. 23 pieces. */
const LINK_GAME = play(step([2, 1], [3, 2]), step([5, 2], [4, 3]), step([2, 7], [3, 6]), step([4, 3], [2, 1], [[3, 2]]));
const LINK = `multidcheckers://load?code=${encodeURIComponent(encodeGame(LINK_GAME, { mode: 'local' }))}`;
/** The player's own game: Red's man from b3 to c4, and nothing else. */
const OWN_GAME = play(step([2, 1], [3, 2]));

/** The pieces on the big board, read off the squares' labels (guards.ts squareLabel). */
const pieces = (tree: ReactTestRenderer): string[] =>
  tree.root
    .findAll((node) => typeof node.type === 'string' && /^[a-h][1-8], (Red|Black) (man|king)$/.test(String(node.props.accessibilityLabel)))
    .map((node) => String(node.props.accessibilityLabel))
    .sort();

const texts = (tree: ReactTestRenderer): string[] =>
  tree.root
    .findAll((node) => node.type === 'Text')
    .map((node) => node.props.children)
    .filter((c): c is string => typeof c === 'string');

/** The pressable a person reads this label on (the press handler sits on the composite). */
function button(tree: ReactTestRenderer, label: string): ReactTestInstance {
  const found = tree.root.findAll(
    (node) =>
      typeof node.props.onPress === 'function' &&
      node.props.accessibilityRole === 'button' &&
      node.findAll((n) => n.type === 'Text').some((n) => n.props.children === label),
  )[0];
  if (!found) throw new Error(`no button labelled ${label}`);
  return found;
}

const PROMPT = 'Load the game from this link?';
const FAILED = 'Something went wrong';

/**
 * One run of the app: every module loaded afresh, as a launch loads them, so
 * what one case's run remembered is not the next case's. React, the renderer,
 * the app and the mocked storage and Linking all come from that one registry.
 */
async function launch(saved: GameState[] | null) {
  // (jest.isolateModules is not enough here: React Native's components come
  // out of it holding a React other than the renderer's.)
  jest.resetModules();
  const React: typeof import('react') = require('react');
  const renderer: typeof import('react-test-renderer') = require('react-test-renderer');
  const App: typeof import('../../../App').default = require('../../../App').default;
  const storage: typeof import('@react-native-async-storage/async-storage').default = require('@react-native-async-storage/async-storage').default;
  const { Linking }: typeof import('react-native') = require('react-native');
  const { act } = renderer;
  await storage.setItem(KEYS.settings, JSON.stringify({ welcomed: true }));
  if (saved) {
    const record: SavedGame = { version: 3, actions: actionsOf(saved), rules: saved[0]!.rules, setup: { mode: 'local' } };
    await storage.setItem(KEYS.game, JSON.stringify(record));
  }
  // The platform reports the launch link on every call, for the whole run.
  jest.mocked(Linking.getInitialURL).mockResolvedValue(LINK);

  /** Storage reads, the link's promise and the autosave's 250 ms timer, all settled. */
  const settle = () =>
    act(async () => {
      for (let i = 0; i < 6; i++) await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 300));
      for (let i = 0; i < 6; i++) await new Promise((resolve) => setTimeout(resolve, 0));
    });
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = renderer.create(React.createElement(App));
  });
  await settle();
  const press = async (label: string) => {
    await act(async () => (button(tree, label).props.onPress as () => void)());
    await settle();
  };
  /** The game the record holds, as the number of actions in it, or null when there is none. */
  const storedActions = async (): Promise<number | null> => {
    const raw = await storage.getItem(KEYS.game);
    return raw === null ? null : (JSON.parse(raw) as SavedGame).actions.length;
  };
  return {
    tree,
    press,
    storedActions,
    unmount: () => act(async () => tree.unmount()),
    /** A render below the boundary fails; the next render draws again. */
    async crash(): Promise<void> {
      mockFailure.on = true;
      await act(async () => tree.update(React.createElement(App)));
      expect(texts(tree)).toContain(FAILED);
      mockFailure.on = false;
    },
  };
}

// Each case loads the whole app afresh and mounts the real screen: measured
// here at 1.0-2.4 s a case with this file run alone and 1.2-3.7 s in the full
// suite (4.6 s once, for a case that loaded the link's game twice), against
// jest's 5 s default, which a loaded CI runner would cross.
jest.setTimeout(20000);

let consoleError: jest.SpyInstance;
beforeEach(() => {
  // React reports the caught render error on the console; that is the boundary working.
  consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
  mockFailure.on = false;
});
afterEach(() => consoleError.mockRestore());

describe('the link the app was launched with', () => {
  it('is loaded once, and "Start a new game" after a crash starts the new game it promises', async () => {
    // Nobody has moved yet, so the link is taken without asking.
    const app = await launch(null);
    expect(pieces(app.tree)).toHaveLength(23);
    expect(pieces(app.tree)).toContain('b3, Black man');
    expect(await app.storedActions()).toBe(4);

    await app.crash();
    await app.press('Start a new game');
    await app.press('Delete it and start');

    expect(texts(app.tree)).not.toContain(FAILED);
    expect(texts(app.tree)).not.toContain(PROMPT);
    // Twelve men a side where they start, and nothing written back: a game
    // nobody has moved in is not saved.
    expect(pieces(app.tree)).toHaveLength(24);
    expect(pieces(app.tree)).toContain('b3, Red man');
    expect(await app.storedActions()).toBeNull();
    await app.unmount();
  });

  it('stays declined once the player keeps their own game, through either button', async () => {
    const app = await launch(OWN_GAME);
    expect(texts(app.tree)).toContain(PROMPT);
    await app.press('Keep playing');
    expect(pieces(app.tree)).toContain('c4, Red man');

    // Drawing again brings their own game back, and does not ask again.
    await app.crash();
    await app.press('Try again');
    expect(texts(app.tree)).not.toContain(FAILED);
    expect(texts(app.tree)).not.toContain(PROMPT);
    expect(pieces(app.tree)).toContain('c4, Red man');
    expect(await app.storedActions()).toBe(1);

    // Starting over clears their own game, as it says; it does not hand the
    // screen the game they turned down.
    await app.crash();
    await app.press('Start a new game');
    await app.press('Delete it and start');
    expect(texts(app.tree)).not.toContain(PROMPT);
    expect(pieces(app.tree)).toHaveLength(24);
    expect(pieces(app.tree)).toContain('b3, Red man');
    expect(await app.storedActions()).toBeNull();
    await app.unmount();
  });

  it('is still asked about when the player has a game, the first time', async () => {
    // What the once-only read must not cost: the launch link itself.
    const app = await launch(OWN_GAME);
    expect(texts(app.tree)).toContain(PROMPT);
    await app.press('Yes, load it');
    expect(texts(app.tree)).not.toContain(PROMPT);
    expect(pieces(app.tree)).toHaveLength(23);
    expect(pieces(app.tree)).toContain('b3, Black man');
    expect(await app.storedActions()).toBe(4);
    await app.unmount();
  });
});

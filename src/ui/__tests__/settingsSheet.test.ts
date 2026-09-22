/**
 * The settings sheet as it is actually drawn: which rows it offers, what Reset
 * to defaults does, and the rule that keeps the confirmation working on iOS.
 *
 * settings-contract.test.ts pins the record, the enum tables and what a reset
 * writes; none of that says the sheet still draws a row for any of it, or that
 * the destructive button still asks. Both could be deleted with the rest of the
 * suite green - including replacing the confirmation with a bare reset().
 *
 * The one-Modal rule is the other half. React Native presents an iOS Modal from
 * the nearest view controller, and a controller already presenting one refuses
 * the next, so a confirmation opened as a *sibling* Modal of the sheet simply
 * never appears there: Reset to defaults becomes a button that does nothing, on
 * that platform alone, which no Android run and no web check can see.
 */
jest.mock('@react-native-async-storage/async-storage', () => {
  const store = new Map<string, string>();
  return {
    __esModule: true,
    __store: store,
    default: {
      getItem: async (key: string) => (store.has(key) ? store.get(key)! : null),
      setItem: async (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: async (key: string) => {
        store.delete(key);
      },
    },
  };
});

import React, { useEffect } from 'react';
import { Modal } from 'react-native';
import TestRenderer, { ReactTestInstance, ReactTestRenderer, act } from 'react-test-renderer';
import { DEFAULT_SETTINGS, SettingsProvider, useSettings } from '../../app/settings';
import { Button } from '../Modals';
import { Choice, Row, Section, SettingsModal } from '../SettingsModal';

const { __store: store } = jest.requireMock('@react-native-async-storage/async-storage') as { __store: Map<string, string> };

/** Every row the sheet draws, in the order a player scrolls past them. */
const ROWS = ['Vibration', 'Sound', 'Piece markings', 'Theme', 'Reduce motion'];
/** ...and the sections they sit in. The game's own variants are passed in as children. */
const SECTIONS = ['Feel', 'Seeing', 'Look', 'Defaults', 'About'];
/** ...and the buttons under them. */
const BUTTONS = ['Reset to defaults', 'Done'];

const texts = (tree: ReactTestRenderer): string[] =>
  tree.root
    .findAll((node) => node.type === 'Text')
    .map((node) => node.props.children)
    .filter((c): c is string => typeof c === 'string');

/** The pressable a person reads this label on; the handler sits on the composite. */
const button = (tree: ReactTestRenderer, label: string): ReactTestInstance | undefined =>
  tree.root.findAll(
    (node) =>
      node.props.accessibilityRole === 'button' &&
      typeof node.props.onPress === 'function' &&
      node.findAll((n) => n.type === 'Text').some((n) => n.props.children === label),
  )[0];

const press = (tree: ReactTestRenderer, label: string) => {
  const target = button(tree, label);
  expect(target).toBeDefined();
  act(() => (target!.props.onPress as () => void)());
};

/** Modals the platform is being asked to present right now. */
const openModals = (tree: ReactTestRenderer): ReactTestInstance[] =>
  tree.root.findAllByType(Modal).filter((node) => node.props.visible !== false);

type Api = ReturnType<typeof useSettings>;

/** The sheet inside a real settings provider, with a handle on what it stores. */
function open(): { tree: ReactTestRenderer; api: () => Api } {
  let latest!: Api;
  function Probe() {
    const current = useSettings();
    useEffect(() => {
      latest = current;
    });
    return null;
  }
  let tree!: ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(
      React.createElement(
        SettingsProvider,
        null,
        React.createElement(Probe),
        React.createElement(SettingsModal, { visible: true, onClose: () => {} }),
      ),
    );
  });
  return { tree, api: () => latest };
}

beforeEach(() => store.clear());

describe('what the sheet offers', () => {
  it('draws exactly these sections, rows and buttons', () => {
    const { tree } = open();
    expect(tree.root.findAllByType(Section).map((node) => node.props.title)).toEqual(SECTIONS);
    expect(tree.root.findAllByType(Row).map((node) => node.props.label)).toEqual(ROWS);
    expect(tree.root.findAllByType(Button).map((node) => node.props.label)).toEqual(BUTTONS);
    act(() => tree.unmount());
  });

  it('gives Reduce motion its three choices, and writes the one that is picked', async () => {
    // The row is the only way into the setting, and the setting is the only way
    // into the map's flight and its animated scroll (see mapRender.test.ts).
    const { tree, api } = open();
    const row = tree.root.findAllByType(Row).find((node) => node.props.label === 'Reduce motion');
    expect(row).toBeDefined();
    const choice = row!.findByType(Choice);
    expect((choice.props.options as { id: string; label: string }[]).map((o) => o.id)).toEqual(['system', 'on', 'off']);
    expect(choice.props.value).toBe('system');

    await act(async () => (choice.props.onChange as (v: string) => void)('on'));
    expect(api().settings.reduceMotion).toBe('on');
    act(() => tree.unmount());
  });
});

describe('reset to defaults', () => {
  it('asks before it spends anything, and resets only when the answer is yes', async () => {
    const { tree, api } = open();
    await act(async () => api().update({ haptics: false, theme: 'light', reduceMotion: 'on' }));
    expect(api().settings.haptics).toBe(false);

    // Pressing the button changes nothing yet: it asks.
    press(tree, 'Reset to defaults');
    expect(api().settings.haptics).toBe(false);
    expect(texts(tree)).toContain('Reset settings?');

    // Backing out leaves every setting where it was.
    press(tree, 'Keep my settings');
    expect(texts(tree)).not.toContain('Reset settings?');
    expect(api().settings.haptics).toBe(false);
    expect(api().settings.theme).toBe('light');

    // Saying yes is what resets.
    press(tree, 'Reset to defaults');
    await act(async () => (button(tree, 'Reset')!.props.onPress as () => void)());
    expect(api().settings).toEqual({ ...DEFAULT_SETTINGS, welcomed: api().settings.welcomed });
    expect(texts(tree)).not.toContain('Reset settings?');
    expect(texts(tree)).toContain('Settings');
    act(() => tree.unmount());
  });

  it('never asks from a second Modal, which iOS would refuse to present', () => {
    const { tree } = open();
    expect(openModals(tree)).toHaveLength(1);
    press(tree, 'Reset to defaults');
    // The question is up...
    expect(texts(tree)).toContain('Reset settings?');
    // ...inside the sheet's own Modal, not beside it.
    expect(openModals(tree)).toHaveLength(1);
    press(tree, 'Keep my settings');
    expect(openModals(tree)).toHaveLength(1);
    act(() => tree.unmount());
  });
});

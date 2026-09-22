/**
 * The sheet the sender reads. A game past what a code may carry has no code
 * to offer, and the buttons that would have copied one have to be shut, with
 * the reason where the code would have been: a sender who can still press
 * Copy sends a code their opponent's app refuses, and the only person told
 * anything is the opponent - about a real game, in words that call it fake.
 */
// The settings store reaches native storage on import; nothing here uses it.
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} },
}));

import React from 'react';
import TestRenderer, { ReactTestInstance, ReactTestRenderer, act } from 'react-test-renderer';
import { ShareModal } from '../ShareModal';

function open(props: { code: string | null; problem?: string | null }) {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(
      React.createElement(ShareModal, {
        visible: true,
        code: props.code,
        problem: props.problem ?? null,
        onLoad: () => null,
        onClose: () => {},
      }),
    );
  });
  const root = tree.root;
  /** Every button, by the label a person reads on it, and whether it is shut. */
  const buttons = new Map<string, boolean>();
  const isButton = (n: ReactTestInstance) => typeof n.type === 'string' && n.props.accessibilityRole === 'button';
  for (const node of root.findAll(isButton)) {
    const label = node.findAll((n) => n.type === 'Text')[0]?.props.children;
    // What the button reports to a screen reader, not what it was handed.
    const state = node.props.accessibilityState as { disabled?: boolean } | undefined;
    if (typeof label === 'string') buttons.set(label, state?.disabled === true);
  }
  const texts = root
    .findAll((n) => n.type === 'Text')
    .map((n) => n.props.children)
    .filter((c): c is string => typeof c === 'string');
  return { buttons, texts, unmount: () => act(() => tree.unmount()) };
}

describe('the share sheet', () => {
  it('offers the code when there is one to offer', () => {
    const sheet = open({ code: '5DCK.abc' });
    expect(sheet.texts).toContain('5DCK.abc');
    expect(sheet.buttons.get('Copy')).toBe(false);
    expect(sheet.buttons.get('Share…')).toBe(false);
    sheet.unmount();
  });

  it('shuts Copy and Share, and says why, when the game has outgrown a code', () => {
    const why = 'This game has grown more timelines and boards than a code can carry, so it cannot be sent. You can still play it here.';
    const sheet = open({ code: null, problem: why });
    expect(sheet.texts).toContain(why);
    expect(sheet.buttons.get('Copy')).toBe(true);
    expect(sheet.buttons.get('Share…')).toBe(true);
    // And nothing that looks like a code is left on screen to be copied by hand.
    expect(sheet.texts.some((t) => t.startsWith('5DCK.'))).toBe(false);
    sheet.unmount();
  });

  it('still says what to do before the first move', () => {
    const sheet = open({ code: null, problem: null });
    expect(sheet.texts).toContain('Make a move first, then come back here.');
    expect(sheet.buttons.get('Copy')).toBe(true);
    sheet.unmount();
  });
});

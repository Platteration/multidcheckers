/**
 * The first-launch walkthrough reads its pages out of a list it is handed. The
 * screen hands it three, but the list is a prop like any other, and a page
 * looked up in an empty one used to be read anyway: the first `page.title`
 * threw and took the screen with it. A walkthrough with nothing to show now
 * shows nothing, and one with pages still shows them.
 */
import React from 'react';
import TestRenderer, { ReactTestRenderer, act } from 'react-test-renderer';
import { WelcomeModal, WelcomePage } from '../WelcomeModal';

// The sheet reads the theme, which reaches the settings store and its storage.
// (jest.mock is hoisted above the imports.)
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} },
}));

function render(pages: WelcomePage[]): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(
      React.createElement(WelcomeModal, { visible: true, pages, onPuzzles: () => {}, onClose: () => {} }),
    );
  });
  return tree;
}

/** Every host view and text the sheet put on screen. */
const hosts = (tree: ReactTestRenderer) => tree.root.findAll((node) => typeof node.type === 'string');
const texts = (tree: ReactTestRenderer): string[] =>
  tree.root.findAll((node) => typeof node.props.children === 'string').map((node) => String(node.props.children));

describe('the welcome walkthrough', () => {
  it('draws the page it is on', () => {
    const tree = render([{ title: 'First page', body: 'What the first page says.' }]);
    expect(texts(tree)).toEqual(expect.arrayContaining(['First page', 'What the first page says.']));
    act(() => tree.unmount());
  });

  it('draws nothing, rather than throwing, when it is handed no pages', () => {
    const tree = render([]);
    expect(hosts(tree)).toHaveLength(0);
    act(() => tree.unmount());
  });
});

/**
 * Where the game hook puts the focus: on a restored game, on "Go play" and on
 * "Next waiting". Each is one line of useGame, and each could be changed with
 * the rest of the suite green - the engine tests cover which timelines are
 * waiting, not which of them the screen shows.
 *
 * Under the strict-present rule a waiting board ahead of the present is
 * optional, and the first waiting timeline can be one of those. The board the
 * player is sent to is the first one that must be played.
 */
// Feedback plays sounds through expo-audio, which has no native module here and
// is not what is under test.
jest.mock('../../app/sound', () => ({ playSound: () => {}, setSoundEnabled: () => {} }));

import React from 'react';
import TestRenderer, { ReactTestRenderer, act } from 'react-test-renderer';
import { Action, BoardRef, GameState, Rules, applyAction, getTimeline, index, latestRef, mandatoryTimelines, newGame, optionalTimelines, pendingTimelines } from '../../engine';
import { GameController, useGame } from '../useGame';

const move = (from: number, to: number): Action => ({ type: 'move', timeline: 0, move: { from, path: [to], captures: [] } });

/**
 * Four moves and a Red travel back to turn 2: the welcome demo's multiverse.
 * Black is then to move on both timelines, the new one behind the old.
 */
const travelled = (rules: Partial<Rules>): GameState =>
  [
    move(index(2, 1), index(3, 0)),
    move(index(5, 6), index(4, 7)),
    move(index(2, 3), index(3, 2)),
    move(index(5, 4), index(4, 5)),
    { type: 'travel', from: { timeline: 0, square: index(3, 2) }, to: { timeline: 0, turn: 2 } } as Action,
  ].reduce((state, action) => applyAction(state, action), newGame(rules));

/** The hook, mounted on a restored game, with a handle on what it returns now. */
function mount(state: GameState): { game: () => GameController; tree: ReactTestRenderer } {
  let latest!: GameController;
  function Probe() {
    latest = useGame([state]);
    return null;
  }
  let tree!: ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(React.createElement(Probe));
  });
  return { game: () => latest, tree };
}

const newest = (state: GameState, timeline: number): BoardRef => latestRef(getTimeline(state, timeline));

describe('the waiting board the game shows', () => {
  const strict = travelled({ strictPresent: true });

  it('is set up so that the first waiting timeline is not the one that must be played', () => {
    // Otherwise every test below would pass with the preference reversed.
    expect(pendingTimelines(strict).map((tl) => tl.id)).toEqual([0, 1]);
    expect(optionalTimelines(strict).map((tl) => tl.id)).toEqual([0]);
    expect(mandatoryTimelines(strict).map((tl) => tl.id)).toEqual([1]);
  });

  it('is the one that must be played, when a game is restored', () => {
    const { game, tree } = mount(strict);
    expect(game().focus).toEqual(newest(strict, 1));
    act(() => tree.unmount());
  });

  it('is the one that must be played, on Go play', () => {
    const { game, tree } = mount(strict);
    act(() => game().focusBoard({ timeline: 0, turn: 1 }));
    expect(game().focus).toEqual({ timeline: 0, turn: 1 });
    act(() => game().goToWaitingBoard());
    expect(game().focus).toEqual(newest(strict, 1));
    act(() => tree.unmount());
  });

  it('is the first waiting one when every waiting board must be played', () => {
    // Without the strict-present rule nothing is optional.
    const free = travelled({});
    expect(mandatoryTimelines(free).map((tl) => tl.id)).toEqual([0, 1]);
    const { game, tree } = mount(free);
    expect(game().focus).toEqual(newest(free, 0));
    act(() => tree.unmount());
  });

  it('moves on to the next waiting board, and wraps round', () => {
    const { game, tree } = mount(strict);
    act(() => game().nextWaitingBoard());
    expect(game().focus).toEqual(newest(strict, 0));
    act(() => game().nextWaitingBoard());
    expect(game().focus).toEqual(newest(strict, 1));
    act(() => tree.unmount());
  });
});

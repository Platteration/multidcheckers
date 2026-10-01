/**
 * The game in storage, read back through restoreSaved: the sibling game's
 * savedGame.test.ts against this app's setup.ts. saved.test.ts covers the
 * write side and the caps; this is the other half of the twin's set - the
 * record's fidelity, the shapes it cannot trust - and the one place the two
 * apps answer differently, on purpose: a save longer than the replay will
 * take is refused and kept here, where the twin brings back what it can.
 */
import { Action, GameState, applyAction, enumerateActions, index, mandatoryTimelines, newGame } from '../../engine';
import { grownTo, travelHeavy } from '../../engine/__tests__/helpers';
import { PUZZLES } from '../../puzzles';
import { GameSetup, MAX_ACTIONS, Restored, SavedGame, actionsOf, restoreSaved, saveDecision } from '../setup';
import { MAX_BOARDS, shareOffer, tooLargeToDraw } from '../share';

const LOCAL: GameSetup = { mode: 'local' };
const move = (from: number, to: number, timeline = 0): Action => ({ type: 'move', timeline, move: { from, path: [to], captures: [] } });

/** A game with a branch in it: four moves, a travel, then a few quiet moves on both timelines. */
function sampleHistory(): GameState[] {
  const opening: Action[] = [
    move(index(2, 1), index(3, 0)),
    move(index(5, 6), index(4, 7)),
    move(index(2, 3), index(3, 2)),
    move(index(5, 4), index(4, 5)),
    { type: 'travel', from: { timeline: 0, square: index(3, 2) }, to: { timeline: 0, turn: 2 } },
  ];
  const history = opening.reduce((h, a) => [...h, applyAction(h[h.length - 1]!, a)], [newGame()]);
  for (let i = 0; i < 4; i++) {
    const state = history[history.length - 1]!;
    const quiet = enumerateActions(state, 3).find((a) => a.type === 'move' && a.move.captures.length === 0);
    if (!quiet) break;
    history.push(applyAction(state, quiet));
  }
  return history;
}

/** The record the autosave would write for this game. */
function toSaved(history: GameState[], setup: GameSetup): SavedGame {
  const decision = saveDecision(history, setup);
  if (decision.kind !== 'write') throw new Error(`the autosave would not write this game: ${decision.kind}`);
  return decision.payload;
}

/** The record after a trip through storage. */
const stored = (history: GameState[], setup: GameSetup): unknown => JSON.parse(JSON.stringify(toSaved(history, setup)));

/** A restored value that had better be a game. */
function asGame(restored: Restored): { history: GameState[]; setup: GameSetup } {
  if (restored.kind !== 'game') throw new Error(`not a game: ${restored.kind}`);
  return restored;
}

describe('the game in storage', () => {
  it('rebuilds exactly the game that was saved', () => {
    const history = sampleHistory();
    expect(history.length).toBeGreaterThan(6);
    expect(history[history.length - 1]?.timelines).toHaveLength(2);
    const restored = asGame(restoreSaved(stored(history, LOCAL)));
    expect(restored.history).toHaveLength(history.length);
    expect(restored.history).toEqual(history);
    expect(restored.setup).toEqual(LOCAL);
  });

  it('is a fraction of the size of the states it replaces', () => {
    // Every state holds every board of every timeline, and JSON expands the
    // boards that are shared by reference in memory - which is how a long game
    // reached megabytes, past what one AsyncStorage row can hold.
    const history = sampleHistory();
    const asStates = JSON.stringify({ version: 2, history, setup: LOCAL }).length;
    const asActions = JSON.stringify(toSaved(history, LOCAL)).length;
    expect(asActions * 20).toBeLessThan(asStates);
  });

  it('rebuilds a puzzle from the puzzle itself', () => {
    // A won game is not saved, so this needs a puzzle with a move that is not
    // the solution: the first one whose position has a quiet continuation.
    const quietMove = (state: GameState) =>
      enumerateActions(state, 3)
        .map((a) => applyAction(state, a))
        .find((s) => s.status === 'playing');
    const puzzle = PUZZLES.find((p) => quietMove(p.state) !== undefined);
    expect(puzzle).toBeDefined();
    const setup: GameSetup = {
      mode: 'puzzle',
      puzzleId: puzzle!.id,
      player: puzzle!.player,
      within: puzzle!.within,
      bot: { level: 3, player: puzzle!.player === 0 ? 1 : 0 },
    };
    const history = [puzzle!.state, quietMove(puzzle!.state)!];
    const restored = asGame(restoreSaved(stored(history, setup)));
    expect(restored.history).toEqual(history);
    expect(restored.setup).toEqual(setup);
  });

  it('keeps a game that has outgrown what a code is allowed to carry', () => {
    // A save is the player's own game, not a stranger's code: every state in
    // it was reached a move at a time through the app and drew fine on the
    // way. This one is past the size an imported code is refused for, and it
    // has to still be there in the morning, whole.
    const history = grownTo(MAX_BOARDS + 1);
    const last = history[history.length - 1]!;
    // Big enough to be the case under test, counted from the game itself.
    expect(tooLargeToDraw(last)).toBe(true);
    expect(shareOffer(history, LOCAL).code).toBeNull();
    expect(history.length - 1).toBeLessThanOrEqual(MAX_ACTIONS);

    const restored = asGame(restoreSaved(stored(history, LOCAL)));
    expect(restored.history).toHaveLength(history.length);
    expect(restored.history[restored.history.length - 1]).toEqual(last);
  });

  it('refuses a game longer than it will replay, and does not call that "no game"', () => {
    // Where the twin brings back the first MAX_SAVED_ACTIONS of such a save and
    // says it came back short, this app refuses the record and keeps it: the
    // write side never produces one (saveDecision stops writing at the cap and
    // says so while the game is still on screen), so one that is there was
    // written by something else, and it is still the only copy the player
    // has. What must not happen is reading it as an empty slot.
    const actions = Array.from({ length: MAX_ACTIONS + 1 }, (_, i) => move(index(2, 1), index(3, 0), i));
    const started = Date.now();
    const restored = restoreSaved({ version: 3, rules: {}, setup: LOCAL, actions });
    expect(Date.now() - started).toBeLessThan(1000);
    expect(restored).toEqual({ kind: 'unreadable' });
    expect(restored.kind).not.toBe('none');
  });

  it('keeps every move of a long game, which a code carries too', () => {
    // A long evening of taking every travel on offer, well inside both caps:
    // kept here, sendable there.
    let steps = 0;
    const history = travelHeavy(() => steps++ >= 300);
    expect(history.length).toBeGreaterThan(250);
    const last = history[history.length - 1];
    const restored = asGame(restoreSaved(stored(history, LOCAL)));
    expect(restored.history).toHaveLength(history.length);
    expect(restored.history[restored.history.length - 1]).toEqual(last);
    expect(shareOffer(history, LOCAL).code).not.toBeNull();
  });

  it('still reads a save written as whole states', () => {
    const history = sampleHistory();
    const restored = asGame(restoreSaved({ version: 2, history, setup: LOCAL }));
    expect(restored.history).toEqual(history);
  });

  it('reads a version 1 save from before rules existed, without crashing on it', () => {
    // The states in such a save have no `rules`, and the first thing the screen
    // does with a restored state is read state.rules.strictPresent.
    const history = sampleHistory().map((s) => {
      const copy = { ...s } as Partial<GameState>;
      delete copy.rules;
      return copy;
    });
    const restored = asGame(restoreSaved({ version: 1, history }));
    expect(restored.history).toHaveLength(history.length);
    for (const state of restored.history) {
      expect(state.rules).toEqual({ flyingKings: false, backCapture: false, strictPresent: false });
      expect(() => mandatoryTimelines(state)).not.toThrow();
    }
  });
});

describe('a saved game that cannot be trusted', () => {
  const history = sampleHistory();

  const corrupt: unknown[] = [
    'nonsense',
    42,
    {},
    { version: 9, history },
    { version: 2, history: [] },
    { version: 2, history: 'not a list' },
    // A state stripped of the fields the first render reads.
    { version: 2, history: [{ timelines: [], toMove: 0, status: 'playing' }] },
    { version: 2, history: [{ ...history[0] }, { lastAction: null }] },
    { version: 2, history: [{ ...history[0] }, { lastAction: move(index(2, 1), index(3, 0), 4) }] },
    { version: 3, rules: {}, setup: LOCAL, actions: 'not a list' },
    { version: 3, rules: {}, setup: LOCAL, actions: [move(99, 100)] },
    { version: 3, rules: {}, setup: LOCAL, actions: [{ type: 'travel', from: { timeline: 0, square: 17 } }] },
    { version: 3, rules: {}, setup: { mode: 'puzzle', puzzleId: 'no-such-puzzle' }, actions: [] },
  ];

  it('is dropped rather than handed to the screen', () => {
    for (const value of corrupt) {
      expect(() => restoreSaved(value)).not.toThrow();
      const restored = restoreSaved(value);
      // Something was stored, so "no record" is never the answer to a bad one.
      expect(restored.kind).not.toBe('none');
      if (restored.kind === 'game') {
        // Anything that does come back must be a game the screen can draw.
        for (const state of restored.history) {
          expect(Array.isArray(state.timelines)).toBe(true);
          expect(() => mandatoryTimelines(state)).not.toThrow();
        }
      }
    }
    // The ones that carry a real but unusable game are refused outright.
    expect(restoreSaved({ version: 9, history })).toEqual({ kind: 'unreadable' });
    expect(restoreSaved({ version: 2, history: [{ ...history[0] }, { lastAction: move(index(2, 1), index(3, 0), 4) }] })).toEqual({ kind: 'unreadable' });
    expect(restoreSaved({ version: 3, rules: {}, setup: LOCAL, actions: [move(99, 100)] })).toEqual({ kind: 'unreadable' });
    // Nothing stored is its own answer, and the only one that is not a refusal.
    expect(restoreSaved(null)).toEqual({ kind: 'none' });
    expect(restoreSaved(undefined)).toEqual({ kind: 'none' });
  });

  it('refuses a whole-state save that lost the action behind one of its states', () => {
    // Every state after the first records the action that made it. Skipping a
    // state without one and replaying the rest used to rebuild a game the
    // player never played whenever the surrounding actions stayed legal - and
    // the autosave then wrote that game over the record.
    const whole = { version: 2, history, setup: LOCAL };
    expect(restoreSaved(whole).kind).toBe('game');
    const gap = history.map((s, i) => (i === 3 ? { ...s, lastAction: null } : s));
    expect(restoreSaved({ ...whole, history: gap })).toEqual({ kind: 'unreadable' });
    expect(restoreSaved({ version: 2, history: [{ ...history[0] }, { lastAction: null }] })).toEqual({ kind: 'unreadable' });
  });

  it('does not walk a list past the point it stops trusting it', () => {
    // The twin truncates and so must not read the whole list first; this app
    // refuses, and the refusal has to be as cheap. A stored value is still a
    // stored value, and this one is 200 times the ceiling.
    const actions: unknown[] = Array.from({ length: MAX_ACTIONS * 200 }, (_, i) =>
      i < MAX_ACTIONS ? move(index(2, 1), index(3, 0), i) : 'not an action at all',
    );
    const started = Date.now();
    const restored = restoreSaved({ version: 3, rules: {}, setup: LOCAL, actions });
    expect(Date.now() - started).toBeLessThan(1000);
    expect(restored).toEqual({ kind: 'unreadable' });
  });

  it('keeps a bot game only when the bot is one this app has', () => {
    const saved = toSaved(history, { mode: 'bot', bot: { level: 2, player: 1 } });
    expect(asGame(restoreSaved(saved)).setup).toEqual({ mode: 'bot', bot: { level: 2, player: 1 } });
    // The twin falls back to a local game; this app keeps the mode and drops
    // the bot, and botShouldAct reads setup.bot alone, so nobody plays for it.
    const nonsense = { ...saved, setup: { mode: 'bot', bot: { level: 99, player: 'red' } } };
    expect(asGame(restoreSaved(nonsense)).setup).toEqual({ mode: 'bot' });
    // And the actions the record carries are exactly the game's, whatever the setup.
    expect(saved.actions).toEqual(actionsOf(history));
  });
});

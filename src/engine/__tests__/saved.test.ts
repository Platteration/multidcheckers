/**
 * The autosave: what gets written, and what comes back. These cover the two
 * ways a saved game used to go wrong - it grew with the square of the number of
 * moves until it silently stopped fitting in storage, and a finished game was
 * restored and folded into the record again on every launch.
 */
import { boardFromRows, index } from '../board';
import { chooseAction, enumerateActions } from '../bot';
import { GameState, applyAction, newGame } from '../multiverse';
import { PUZZLES, puzzleById } from '../../puzzles';
import {
  DEFAULT_SETUP,
  GameSetup,
  botShouldAct,
  gameOverVisible,
  looksLikeSavedGame,
  normaliseSaved,
  savePayload,
} from '../../app/setup';

const seeded = (seed = 1) => () => {
  seed = (seed * 16807) % 2147483647;
  return (seed - 1) / 2147483646;
};

const LOCAL: GameSetup = { mode: 'local' };

/** A game of `n` actions played by the strongest bot, so timelines pile up. */
function playOut(n: number, from: GameState = newGame()): GameState[] {
  const rng = seeded(7);
  const history: GameState[] = [from];
  while (history.length <= n) {
    const state = history[history.length - 1];
    if (state.status !== 'playing') break;
    const action = chooseAction(state, 3, rng);
    if (!action) break;
    history.push(applyAction(state, action));
  }
  return history;
}

const sizeOf = (v: unknown) => JSON.stringify(v).length;
const wholeHistory = (history: GameState[]) => ({ version: 2, history, setup: LOCAL });

/** One long game, played once; any prefix of a history is itself a history. */
const GAME = playOut(120);

describe('what the autosave writes', () => {
  it('grows with the moves, not with their square', () => {
    const short = GAME.slice(0, 31);
    const long = GAME.slice(0, 61);
    expect(short).toHaveLength(31);
    expect(long).toHaveLength(61);

    // Twice the actions must not cost much more than twice the bytes. The old
    // shape wrote every board of every state, so it more than tripled instead.
    const grew = sizeOf(savePayload(long, LOCAL)) / sizeOf(savePayload(short, LOCAL));
    expect(grew).toBeLessThan(2.5);
    expect(sizeOf(wholeHistory(long)) / sizeOf(wholeHistory(short))).toBeGreaterThan(3);
  });

  it('stays small enough to store on a long game', () => {
    const history = GAME;
    expect(history.length).toBeGreaterThan(100);
    // Web localStorage allows about 5 MB per origin and Android AsyncStorage 6 MB.
    expect(sizeOf(savePayload(history, LOCAL))).toBeLessThan(64 * 1024);
    expect(sizeOf(wholeHistory(history))).toBeGreaterThan(5 * 1024 * 1024);
  });

  it('replays back to exactly the same game', () => {
    const history = GAME.slice(0, 41);
    const restored = normaliseSaved(savePayload(history, LOCAL)!);
    expect(restored).not.toBeNull();
    expect(restored!.history).toHaveLength(history.length);
    expect(restored!.history[restored!.history.length - 1]).toEqual(history[history.length - 1]);
    expect(restored!.setup).toEqual(LOCAL);
  });

  it('keeps the rule variants a game was started with', () => {
    const history = playOut(4, newGame({ flyingKings: true, backCapture: true }));
    const restored = normaliseSaved(savePayload(history, LOCAL)!)!;
    expect(restored.history[0].rules).toEqual(history[0].rules);
  });

  it('rebuilds a puzzle from the puzzle, not from a fresh board', () => {
    const puzzle = puzzleById('twoboards')!;
    const setup: GameSetup = { mode: 'puzzle', puzzleId: puzzle.id, within: puzzle.within, player: puzzle.player };
    // Every puzzle is one move from being won, so take a move that is not it.
    const quiet = enumerateActions(puzzle.state, 3)
      .map((a) => applyAction(puzzle.state, a))
      .find((s) => s.status === 'playing');
    expect(quiet).toBeDefined();
    const history = [puzzle.state, quiet!];
    const restored = normaliseSaved(savePayload(history, setup)!)!;
    expect(restored.history[0]).toEqual(puzzle.state);
    expect(restored.history[1]).toEqual(quiet);
    expect(restored.setup).toEqual(setup);
  });

  it('does not keep a finished game, which would be recorded again on the next launch', () => {
    // Red jumps the last black piece off the board.
    const board = boardFromRows(['........', '........', '........', '........', '....b...', '...r....', '........', '........']);
    const playing: GameState = {
      ...newGame(),
      timelines: [{ id: 0, startTurn: 0, boards: [board, board, board], createdBy: null, branchedFrom: null, origin: null }],
      toMove: 0,
    };
    const won = applyAction(playing, { type: 'move', timeline: 0, move: { from: index(2, 3), path: [index(4, 5)], captures: [index(3, 4)] } });
    expect(won.status).toBe('won');
    // A game still going is saved; the moment it ends the save is cleared.
    expect(savePayload([playing, playing], LOCAL)).not.toBeNull();
    expect(savePayload([playing, won], LOCAL)).toBeNull();
    expect(savePayload(GAME.map((s) => ({ ...s, status: 'draw' as const })), LOCAL)).toBeNull();
  });

  it('has nothing to save before the first move', () => {
    expect(savePayload([newGame()], LOCAL)).toBeNull();
  });
});

describe('what the autosave reads back', () => {
  it('still reads the games saved by earlier versions', () => {
    const history = GAME.slice(0, 9);
    expect(looksLikeSavedGame({ version: 2, history, setup: LOCAL })).toBe(true);
    expect(normaliseSaved({ version: 2, history, setup: LOCAL })).toEqual({ history, setup: LOCAL });
    expect(normaliseSaved({ version: 1, history })).toEqual({ history, setup: DEFAULT_SETUP });
  });

  it('refuses anything that is not a saved game', () => {
    for (const junk of [null, undefined, 3, 'game', {}, { version: 3 }, { version: 2, history: [] }, { version: 9, actions: [] }]) {
      expect(looksLikeSavedGame(junk)).toBe(false);
    }
    expect(looksLikeSavedGame({ version: 3, actions: [] })).toBe(true);
  });

  it('gives up on a game whose actions do not replay', () => {
    const payload = savePayload(GAME.slice(0, 7), LOCAL)!;
    expect(normaliseSaved({ ...payload, actions: [...payload.actions, payload.actions[0]] })).toBeNull();
    expect(normaliseSaved({ ...payload, actions: ['nonsense' as never] })).toBeNull();
    expect(normaliseSaved({ ...payload, setup: { mode: 'puzzle', puzzleId: 'no-such-puzzle' } })).toBeNull();
  });
});

describe('who acts on a state', () => {
  const bot: GameSetup = { mode: 'bot', bot: { level: 2, player: 1 } };
  const start = newGame();
  const afterRed = applyAction(start, { type: 'move', timeline: 0, move: { from: 17, path: [24], captures: [] } });

  it('acts on its own turn in the live game', () => {
    expect(botShouldAct(bot, afterRed, false)).toBe(true);
  });

  it('never acts on a state being replayed', () => {
    // Replaying shows an earlier state; acting on it would append a move chosen
    // for a position that is no longer the live one.
    expect(botShouldAct(bot, afterRed, true)).toBe(false);
    expect(botShouldAct(bot, start, true)).toBe(false);
  });

  it('never acts for the person, or in a game with no bot', () => {
    expect(botShouldAct(bot, start, false)).toBe(false);
    expect(botShouldAct(LOCAL, afterRed, false)).toBe(false);
  });

  it('never acts once the game is over', () => {
    expect(botShouldAct(bot, { ...afterRed, status: 'won' }, false)).toBe(false);
  });
});

describe('the game-over sheet', () => {
  const playing = newGame();
  const finished: GameState = { ...playing, status: 'won' };

  it('shows once the live game is over', () => {
    expect(gameOverVisible(finished, false, false, false)).toBe(true);
    expect(gameOverVisible(playing, false, false, false)).toBe(false);
  });

  it('stays away for the whole of a replay', () => {
    // 'Watch the replay' dismisses the sheet and seeks to the start, and every
    // state before the last one is still 'playing', which clears the dismissal
    // again. The sheet used to pop back over the replay bar at the end because
    // of it, so replaying is enough on its own to keep it away.
    expect(gameOverVisible(finished, false, true, true)).toBe(false);
    expect(gameOverVisible(finished, false, true, false)).toBe(false);
  });

  it('does not come back once dismissed, and never shows for a puzzle', () => {
    // A puzzle has its own result sheet.
    expect(gameOverVisible(finished, false, false, true)).toBe(false);
    expect(gameOverVisible(finished, true, false, false)).toBe(false);
  });
});

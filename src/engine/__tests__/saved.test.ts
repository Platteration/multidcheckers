/**
 * The autosave: what gets written, and what comes back. These cover the two
 * ways a saved game used to go wrong - it grew with the square of the number of
 * moves until it silently stopped fitting in storage, and a finished game was
 * restored and folded into the record again on every launch.
 */
import { boardFromRows, index } from '../board';
import { chooseAction, enumerateActions } from '../bot';
import { Action, GameState, applyAction, newGame, pendingTimelines } from '../multiverse';
import { PUZZLES, puzzleById } from '../../puzzles';
import { decodeGame, encodeGame } from '../../app/share';
import {
  DEFAULT_SETUP,
  GameSetup,
  MAX_ACTIONS,
  SavedGame,
  botShouldAct,
  cleanSetup,
  gameOverVisible,
  looksLikeSavedGame,
  normaliseSaved,
  restoreSaved,
  saveDecision,
} from '../../app/setup';
import { grownTo } from './helpers';

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

/** The record the autosave would write for this game, or null when it writes none. */
const written = (history: GameState[], setup: GameSetup): SavedGame | null => {
  const decision = saveDecision(history, setup);
  return decision.kind === 'write' ? decision.payload : null;
};

/**
 * A history of a given length without playing one: `saveDecision` counts the
 * actions and reads the last state, and neither needs a legal game.
 */
const stretch = (actions: number): GameState[] => {
  const start = newGame();
  const step: GameState = { ...start, lastAction: { type: 'endTurn' } as Action };
  return [start, ...new Array(actions).fill(step)];
};
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
    const grew = sizeOf(written(long, LOCAL)) / sizeOf(written(short, LOCAL));
    expect(grew).toBeLessThan(2.5);
    expect(sizeOf(wholeHistory(long)) / sizeOf(wholeHistory(short))).toBeGreaterThan(3);
  });

  it('stays small enough to store on a long game', () => {
    const history = GAME;
    expect(history.length).toBeGreaterThan(100);
    // Web localStorage allows about 5 MB per origin and Android AsyncStorage 6 MB.
    expect(sizeOf(written(history, LOCAL))).toBeLessThan(64 * 1024);
    expect(sizeOf(wholeHistory(history))).toBeGreaterThan(5 * 1024 * 1024);
  });

  it('replays back to exactly the same game', () => {
    const history = GAME.slice(0, 41);
    const restored = normaliseSaved(written(history, LOCAL)!);
    expect(restored).not.toBeNull();
    expect(restored!.history).toHaveLength(history.length);
    expect(restored!.history[restored!.history.length - 1]).toEqual(history[history.length - 1]);
    expect(restored!.setup).toEqual(LOCAL);
  });

  it('keeps the rule variants a game was started with', () => {
    const history = playOut(4, newGame({ flyingKings: true, backCapture: true }));
    const restored = normaliseSaved(written(history, LOCAL)!)!;
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
    const restored = normaliseSaved(written(history, setup)!)!;
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
    expect(written([playing, playing], LOCAL)).not.toBeNull();
    expect(saveDecision([playing, won], LOCAL)).toEqual({ kind: 'clear' });
    expect(saveDecision(GAME.map((s) => ({ ...s, status: 'draw' as const })), LOCAL)).toEqual({ kind: 'clear' });
  });

  it('has nothing to save before the first move', () => {
    expect(saveDecision([newGame()], LOCAL)).toEqual({ kind: 'clear' });
  });

  it('stops writing a game it cannot store, and does not delete the one that is stored', () => {
    // The read side refuses a list longer than it will replay. Applied only
    // there, that refusal did not decline a long game: it erased it. The record
    // was rejected at launch, a fresh game started, and the autosave wrote that
    // fresh game's "nothing to save" over the record. So the cap is applied
    // here as well, where the player is still looking at the game, and what it
    // does here is stop writing - never clear.
    const long = saveDecision(stretch(MAX_ACTIONS + 1), LOCAL);
    expect(long.kind).toBe('keep');
    expect(long.kind === 'keep' && long.problem).toMatch(/longer than the app can store/);
    // One fewer is written, so it is the count that stopped it.
    expect(saveDecision(stretch(MAX_ACTIONS), LOCAL).kind).toBe('write');
    // And the cap is above the longest game this app can produce on its own:
    // the strongest bot playing itself to the end of a game takes about 1,560
    // actions (measured: 1,561 actions, 177 timelines, 1,738 boards).
    expect(MAX_ACTIONS).toBeGreaterThan(1561);
  });

  it('leaves a record it could not read alone, rather than clearing it for a game nobody played', () => {
    // The fresh game started over an unreadable record has nothing to save, and
    // "nothing to save" used to mean "remove whatever is there" - which is the
    // player's last game, thrown away to match a game they have not played.
    expect(saveDecision([newGame()], LOCAL, false)).toEqual({ kind: 'keep', problem: null });
    const finished = GAME.map((state) => ({ ...state, status: 'draw' as const }));
    expect(saveDecision(finished, LOCAL, false)).toEqual({ kind: 'keep', problem: null });
    // Once the player plays, their own game is written over it, as it should be.
    expect(saveDecision(GAME.slice(0, 5), LOCAL, false).kind).toBe('write');
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

  it('replays an older save rather than trusting the states in it', () => {
    // A v1/v2 record holds whole states, and storage is as much outside input
    // as a share code is. Only the actions are read out of them; the states are
    // rebuilt by the engine, so a record full of nonsense is a game that cannot
    // be replayed rather than a value the first render chokes on.
    const junk = { version: 2 as const, history: [{ timelines: 'nope', rules: 'not-rules' }] as never, setup: LOCAL };
    expect(looksLikeSavedGame(junk)).toBe(true);
    const restored = normaliseSaved(junk)!;
    expect(restored).not.toBeNull();
    expect(pendingTimelines(restored.history[0])).toHaveLength(1);
    expect(restored.history[0]).toEqual(newGame());
  });

  it('rebuilds the setup from values of its own, on either shape of save', () => {
    // setup.bot.level picks the bot's search and indexes BOT_NAMES, and mode
    // decides whether the bot plays at all, so a stored setup does not get to
    // name either: '__proto__' as a level finds Object.prototype on the table.
    const hostile = { mode: 'bot', bot: { level: '__proto__', player: 7 } } as never;
    expect(cleanSetup(hostile)).toEqual({ mode: 'bot' });
    expect(cleanSetup({ mode: 'nonsense' } as never)).toEqual({ mode: 'local' });
    expect(cleanSetup(null)).toEqual(DEFAULT_SETUP);
    expect(cleanSetup({ mode: 'bot', bot: { level: 2, player: 1 } })).toEqual({ mode: 'bot', bot: { level: 2, player: 1 } });
    // `mode` decides whether the computer plays, so a bot in a mode that has
    // none is dropped with the rest of the fields that mode does not use:
    // botShouldAct reads setup.bot alone, so keeping it made a game the app
    // calls local into one the computer plays.
    const localWithBot = cleanSetup({ mode: 'local', bot: { level: 3, player: 0 } });
    expect(localWithBot).toEqual({ mode: 'local' });
    expect(botShouldAct(localWithBot, newGame(), false)).toBe(false);
    // A puzzle keeps the bot that answers for the other side.
    expect(cleanSetup({ mode: 'puzzle', puzzleId: 'twoboards', bot: { level: 3, player: 1 } }).bot).toEqual({ level: 3, player: 1 });
    // An unknown puzzle is dropped, and a save that names one cannot be replayed
    // as an ordinary game instead.
    expect(cleanSetup({ mode: 'puzzle', puzzleId: 'no-such-puzzle' })).toEqual({ mode: 'puzzle' });
    expect(normaliseSaved({ version: 2 as const, history: GAME.slice(0, 5), setup: hostile })!.setup).toEqual({ mode: 'bot' });
  });

  it('restores a game the player played, however large its multiverse grew', () => {
    // A shared code is refused once its multiverse outgrows what an import may
    // carry; the autosave is not, and that difference is on purpose. This game
    // was played one action at a time, every state of it drawn on the way, so
    // refusing it at launch would delete the player's own work - while refusing
    // a pasted code costs them nothing they had. The bounds that are left here
    // are the action cap below and the rules themselves.
    const history = grownTo(400);
    const last = history[history.length - 1];
    // Larger than 1,100 actions of the strongest bot ever built (142 timelines).
    expect(last.timelines.length).toBeGreaterThan(142);
    const restored = normaliseSaved(written(history, LOCAL)!)!;
    expect(restored.history).toHaveLength(history.length);
    expect(restored.history[restored.history.length - 1]).toEqual(last);
    // And a game this size is one the player can still send: the import ceiling
    // used to refuse it at 97 timelines, five rounds into taking every time
    // travel on offer.
    expect(decodeGame(encodeGame(history, LOCAL)).history).toHaveLength(history.length);
  });

  it('tells a record it could not read from having no record at all', () => {
    // What the launch does with each of the three is different, and reading the
    // middle one as "no saved game" is what let a fresh game overwrite it.
    expect(restoreSaved(null)).toEqual({ kind: 'none' });
    expect(restoreSaved(undefined)).toEqual({ kind: 'none' });
    const tooLong = { version: 3 as const, actions: new Array(MAX_ACTIONS + 1).fill({ type: 'endTurn' }), rules: newGame().rules, setup: LOCAL };
    expect(restoreSaved(tooLong)).toEqual({ kind: 'unreadable' });
    expect(restoreSaved({ version: 9, actions: [] })).toEqual({ kind: 'unreadable' });
    expect(restoreSaved('not a game')).toEqual({ kind: 'unreadable' });
    const real = written(GAME.slice(0, 9), LOCAL)!;
    expect(restoreSaved(real)).toEqual({ kind: 'game', history: GAME.slice(0, 9), setup: LOCAL });
  });

  it('refuses a stored action list longer than it will replay', () => {
    // A pasted code has been capped at MAX_ACTIONS since the code caps went in;
    // a stored list is replayed by the same engine and used to have no cap.
    const many = { version: 3 as const, actions: new Array(MAX_ACTIONS + 1).fill({ type: 'endTurn' }), rules: newGame().rules, setup: LOCAL };
    expect(looksLikeSavedGame(many)).toBe(false);
    expect(normaliseSaved(many)).toBeNull();
    // One fewer is accepted by the shape check and stopped by the rules instead.
    const one = { ...many, actions: new Array(MAX_ACTIONS).fill({ type: 'endTurn' }) };
    expect(looksLikeSavedGame(one)).toBe(true);
    expect(normaliseSaved(one)).toBeNull();
  });

  it('gives up on a game whose actions do not replay', () => {
    const payload = written(GAME.slice(0, 7), LOCAL)!;
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

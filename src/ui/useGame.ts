import { useCallback, useMemo, useState } from 'react';
import * as feedback from '../app/feedback';
import { DEFAULT_SETUP, GameSetup } from '../app/setup';
import { Puzzle, puzzleById } from '../puzzles';
import {
  Action,
  BoardRef,
  GameState,
  IllegalAction,
  Move,
  Rules,
  applyAction,
  otherPlayer,
  getTimeline,
  isPending,
  isTravelTarget,
  latestBoard,
  latestRef,
  legalMovesOn,
  moveTarget,
  movesForPiece,
  newGame,
  pendingTimelines,
  travelTargets,
} from '../engine';

export interface PieceRef {
  timeline: number;
  square: number;
}

/**
 * What the player is in the middle of doing.
 *  - none:  tap one of your pieces to pick it up.
 *  - piece: a piece is picked up; tap a highlighted square to move it, or a
 *           glowing board on the map to send it into the past.
 */
export type Selection = { kind: 'none' } | { kind: 'piece'; from: PieceRef; moves: Move[] };

export interface GameController {
  state: GameState;
  /** Every state so far, oldest first. Saved so a game survives closing the app. */
  history: GameState[];
  setup: GameSetup;
  /** True when a person, not the bot, is expected to act now. */
  humanTurn: boolean;
  /** Apply any action directly, e.g. one the bot chose. */
  play: (action: Action) => void;
  /** Throw the game away and start a new one with this setup. */
  startNew: (setup: GameSetup) => void;
  /** Load a puzzle position; the strongest bot answers for the other side. */
  startPuzzle: (puzzle: Puzzle) => void;
  /** Replace the game with one loaded from elsewhere (a shared code). */
  load: (history: GameState[], setup: GameSetup) => void;
  /** In puzzle mode, how many of the player's own actions have been used. */
  movesUsed: number;
  focus: BoardRef;
  selection: Selection;
  targets: BoardRef[];
  /** True when the current player has a jump available on the focused board. */
  mustCapture: boolean;
  error: string | null;
  canUndo: boolean;
  focusBoard: (ref: BoardRef) => void;
  pressSquare: (square: number) => void;
  cancel: () => void;
  undo: () => void;
  restart: () => void;
  goToWaitingBoard: () => void;
  /** Cycle focus through the boards still waiting for the current player. */
  nextWaitingBoard: () => void;
}

const NONE: Selection = { kind: 'none' };

function firstPending(state: GameState): BoardRef | null {
  const p = pendingTimelines(state);
  return p.length ? latestRef(p[0]) : null;
}

export function useGame(initialHistory?: GameState[], rules: Partial<Rules> = {}, initialSetup: GameSetup = DEFAULT_SETUP): GameController {
  const [history, setHistory] = useState<GameState[]>(() => (initialHistory?.length ? initialHistory : [newGame(rules)]));
  const [setup, setSetup] = useState<GameSetup>(initialSetup);
  const [focus, setFocus] = useState<BoardRef>(() => {
    const last = initialHistory?.[initialHistory.length - 1];
    return (last && (last.win?.board ?? firstPending(last))) || { timeline: 0, turn: 0 };
  });
  const [selection, setSelection] = useState<Selection>(NONE);
  const [error, setError] = useState<string | null>(null);

  const state = history[history.length - 1];
  const humanTurn = !(setup.bot && state.toMove === setup.bot.player && state.status === 'playing');
  const movesUsed = useMemo(() => {
    if (setup.mode !== 'puzzle' || setup.player === undefined) return 0;
    let n = 0;
    for (let i = 1; i < history.length; i++) if (history[i - 1].toMove === setup.player) n++;
    return n;
  }, [history, setup]);

  const targets = useMemo(
    () => (selection.kind === 'none' ? [] : travelTargets(state, selection.from.timeline, selection.from.square)),
    [state, selection],
  );

  const mustCapture = useMemo(
    () => isPending(state, focus) && legalMovesOn(state, focus.timeline).some((m) => m.captures.length > 0),
    [state, focus],
  );

  const commit = useCallback(
    (action: Action) => {
      try {
        const next = applyAction(state, action);
        setHistory((h) => [...h, next]);
        setSelection(NONE);
        setError(null);
        if (next.status === 'won' && next.win) {
          feedback.win();
          setFocus(next.win.board);
        } else {
          if (action.type === 'travel') feedback.warp();
          else if (action.move.captures.length > 0) feedback.thud();
          else feedback.tap();
          const created = next.lastCreated.find((r) => r.timeline === focus.timeline);
          const pending = firstPending(next);
          if (pending) setFocus(pending);
          else if (created) setFocus(created);
        }
      } catch (e) {
        feedback.nope();
        setError(e instanceof IllegalAction ? e.message : String(e));
      }
    },
    [state, focus.timeline],
  );

  const focusBoard = useCallback(
    (ref: BoardRef) => {
      setError(null);
      if (selection.kind === 'piece' && isTravelTarget(state, selection.from.timeline, selection.from.square, ref)) {
        commit({ type: 'travel', from: selection.from, to: ref });
        return;
      }
      setFocus(ref);
    },
    [selection, state, commit],
  );

  const pressSquare = useCallback(
    (square: number) => {
      setError(null);
      if (state.status !== 'playing') return;
      if (!isPending(state, focus)) return;

      const board = latestBoard(getTimeline(state, focus.timeline));
      const cell = board.cells[square];

      if (cell && cell.player === state.toMove) {
        if (selection.kind === 'piece' && selection.from.square === square && selection.from.timeline === focus.timeline) {
          setSelection(NONE);
        } else {
          feedback.tap();
          setSelection({
            kind: 'piece',
            from: { timeline: focus.timeline, square },
            moves: movesForPiece(board, state.toMove, square, state.rules),
          });
        }
        return;
      }

      if (selection.kind === 'piece' && selection.from.timeline === focus.timeline) {
        const candidates = selection.moves.filter((m) => moveTarget(m) === square);
        if (candidates.length > 0) {
          // Several jump chains can end on the same square; take the longest.
          const best = candidates.reduce((a, b) => (b.captures.length > a.captures.length ? b : a));
          commit({ type: 'move', timeline: focus.timeline, move: best });
          return;
        }
      }
      setSelection(NONE);
    },
    [state, focus, selection, commit],
  );

  const cancel = useCallback(() => {
    setError(null);
    if (selection.kind === 'piece') {
      setFocus(latestRef(getTimeline(state, selection.from.timeline)));
    }
    setSelection(NONE);
  }, [selection, state]);

  const undo = useCallback(() => {
    if (history.length <= 1) return;
    setError(null);
    setSelection(NONE);
    let next = history.slice(0, -1);
    // Against a bot, rewind through its replies too, back to your own move.
    if (setup.bot) {
      const bot = setup.bot.player;
      while (next.length > 1 && (next[next.length - 1].toMove === bot || next[next.length - 1].status !== 'playing')) {
        next = next.slice(0, -1);
      }
    }
    const prev = next[next.length - 1];
    setHistory(next);
    setFocus(firstPending(prev) ?? { timeline: 0, turn: 0 });
  }, [history, setup]);

  const startNew = useCallback(
    (nextSetup: GameSetup) => {
      setError(null);
      setSelection(NONE);
      setSetup(nextSetup);
      setHistory([newGame(rules)]);
      setFocus({ timeline: 0, turn: 0 });
    },
    [rules],
  );

  const startPuzzle = useCallback((puzzle: Puzzle) => {
    setError(null);
    setSelection(NONE);
    setSetup({
      mode: 'puzzle',
      puzzleId: puzzle.id,
      within: puzzle.within,
      player: puzzle.player,
      bot: { level: 3, player: otherPlayer(puzzle.player) },
    });
    setHistory([puzzle.state]);
    setFocus(firstPending(puzzle.state) ?? { timeline: 0, turn: 0 });
  }, []);

  const load = useCallback((nextHistory: GameState[], nextSetup: GameSetup) => {
    setError(null);
    setSelection(NONE);
    setSetup(nextSetup);
    setHistory(nextHistory);
    const last = nextHistory[nextHistory.length - 1];
    setFocus(last.win?.board ?? firstPending(last) ?? { timeline: 0, turn: 0 });
  }, []);

  const restart = useCallback(() => {
    const puzzle = setup.mode === 'puzzle' && setup.puzzleId ? puzzleById(setup.puzzleId) : undefined;
    if (puzzle) startPuzzle(puzzle);
    else startNew(setup);
  }, [startNew, startPuzzle, setup]);

  const goToWaitingBoard = useCallback(() => {
    const pending = firstPending(state);
    if (pending) setFocus(pending);
  }, [state]);

  const nextWaitingBoard = useCallback(() => {
    const pending = pendingTimelines(state);
    if (pending.length === 0) return;
    const at = pending.findIndex((tl) => tl.id === focus.timeline);
    setFocus(latestRef(pending[(at + 1) % pending.length]));
  }, [state, focus.timeline]);

  return {
    state,
    history,
    setup,
    humanTurn,
    play: commit,
    startNew,
    startPuzzle,
    load,
    movesUsed,
    focus,
    selection,
    targets,
    mustCapture,
    error,
    canUndo: history.length > 1,
    focusBoard,
    pressSquare,
    cancel,
    undo,
    restart,
    goToWaitingBoard,
    nextWaitingBoard,
  };
}

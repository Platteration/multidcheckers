import { useCallback, useMemo, useState } from 'react';
import * as feedback from '../app/feedback';
import {
  Action,
  BoardRef,
  GameState,
  IllegalAction,
  Move,
  applyAction,
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

export function useGame(initialHistory?: GameState[]): GameController {
  const [history, setHistory] = useState<GameState[]>(() => (initialHistory?.length ? initialHistory : [newGame()]));
  const [focus, setFocus] = useState<BoardRef>(() => {
    const last = initialHistory?.[initialHistory.length - 1];
    return (last && (last.win?.board ?? firstPending(last))) || { timeline: 0, turn: 0 };
  });
  const [selection, setSelection] = useState<Selection>(NONE);
  const [error, setError] = useState<string | null>(null);

  const state = history[history.length - 1];

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
            moves: movesForPiece(board, state.toMove, square),
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
    const next = history.slice(0, -1);
    const prev = next[next.length - 1];
    setHistory(next);
    setFocus(firstPending(prev) ?? { timeline: 0, turn: 0 });
  }, [history]);

  const restart = useCallback(() => {
    setError(null);
    setSelection(NONE);
    setHistory([newGame()]);
    setFocus({ timeline: 0, turn: 0 });
  }, []);

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

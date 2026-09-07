/**
 * A computer opponent. Three levels, all built on the same idea: list every
 * legal action for the current player, score what the multiverse looks like
 * afterwards, and pick the best. The only look-ahead is checking what the
 * opponent could capture in reply, which keeps every level instant.
 *
 *  1 "Novice"  - takes captures, likes crowning, otherwise wanders. Never travels.
 *  2 "Tricky"  - counts material after the opponent's best reply, pushes forward.
 *  3 "Paradox" - the above plus time travel when a past board looks better.
 */
import { Board, Move, applyMove, crownRow, legalMoves, moveTarget, pieceAt, piecesOf, rowOf } from './board';
import {
  Action,
  GameState,
  applyAction,
  canEndTurn,
  latestBoard,
  mandatoryTimelines,
  pendingTimelines,
  travelTargets,
} from './multiverse';
import { Player, otherPlayer } from './types';

export type BotLevel = 1 | 2 | 3;

export const BOT_NAMES: Record<BotLevel, string> = { 1: 'Novice', 2: 'Tricky', 3: 'Paradox' };

export interface Bot {
  level: BotLevel;
  player: Player;
}

/** A random source in [0, 1), injectable so tests are deterministic. */
export type Rng = () => number;

/** Every legal action for the player to move, across all waiting boards. */
export function enumerateActions(state: GameState, level: BotLevel): Action[] {
  const out: Action[] = [];
  for (const tl of pendingTimelines(state)) {
    const board = latestBoard(tl);
    for (const move of legalMoves(board, state.toMove, state.rules)) out.push({ type: 'move', timeline: tl.id, move });
    if (level >= 3) {
      for (const square of piecesOf(board, state.toMove)) {
        for (const to of travelTargets(state, tl.id, square)) {
          out.push({ type: 'travel', from: { timeline: tl.id, square }, to });
        }
      }
    }
  }
  return out;
}

/** Material and position for `player` on one board. */
export function boardScore(board: Board, player: Player): number {
  let score = 0;
  for (const sq of piecesOf(board, player)) {
    const piece = pieceAt(board, sq)!;
    if (piece.king) {
      score += 16;
    } else {
      // Men are worth more as they approach the crown row.
      const advance = player === 0 ? rowOf(sq) : crownRow(0) - rowOf(sq);
      score += 10 + advance * 0.4;
    }
  }
  return score;
}

/** The most material the player to move could take with one move on their waiting boards. */
function bestCaptureValue(state: GameState): number {
  let best = 0;
  for (const tl of pendingTimelines(state)) {
    const board = latestBoard(tl);
    for (const move of legalMoves(board, state.toMove, state.rules)) {
      let value = 0;
      for (const c of move.captures) value += pieceAt(board, c)?.king ? 16 : 10;
      if (value > best) best = value;
    }
  }
  return best;
}

/** How good the multiverse looks for `player`: sum over every newest board. */
export function evaluate(state: GameState, player: Player): number {
  if (state.status === 'won' && state.win) return state.win.player === player ? 1e6 : -1e6;
  if (state.status === 'draw') return 0;
  let total = 0;
  for (const tl of state.timelines) {
    const board = latestBoard(tl);
    total += boardScore(board, player) - boardScore(board, otherPlayer(player));
  }
  return total;
}

/** Pick one action for the player to move. Returns null when nothing is legal. */
/** Above this many candidates, time travels are sampled so a big multiverse stays snappy. */
const MAX_CANDIDATES = 60;

export function chooseAction(state: GameState, level: BotLevel, rng: Rng = Math.random): Action | null {
  const me = state.toMove;
  // Under the strict-present rule, bots play what they must and leave the rest for later.
  if (canEndTurn(state) && mandatoryTimelines(state).length === 0) return { type: 'endTurn' };
  let actions = enumerateActions(state, level);
  if (actions.length === 0) return null;
  if (actions.length > MAX_CANDIDATES) {
    const plain = actions.filter((a) => a.type !== 'travel');
    const travels = actions.filter((a) => a.type === 'travel');
    for (let i = travels.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [travels[i], travels[j]] = [travels[j], travels[i]];
    }
    actions = [...plain, ...travels.slice(0, Math.max(0, MAX_CANDIDATES - plain.length))];
  }

  // Immediate wins first, at every level.
  for (const a of actions) {
    const next = applyAction(state, a);
    if (next.status === 'won' && next.win?.player === me) return a;
  }

  if (level === 1) {
    const moves = actions.filter((a): a is Extract<Action, { type: 'move' }> => a.type === 'move');
    const crowning = moves.filter((a) => !pieceAt(latestBoard(state.timelines[a.timeline]), a.move.from)!.king && rowOf(moveTarget(a.move)) === crownRow(me));
    if (crowning.length && rng() < 0.8) return crowning[Math.floor(rng() * crowning.length)];
    // Captures are already forced by the rules; among what is legal, wander.
    return moves[Math.floor(rng() * moves.length)] ?? actions[0];
  }

  let best: Action[] = [];
  let bestScore = -Infinity;
  for (const a of actions) {
    const next = applyAction(state, a);
    let score = evaluate(next, me);
    if (next.status === 'playing') {
      // What can the opponent take straight back?
      const probe = next.toMove === me ? { ...next, toMove: otherPlayer(me) } : next;
      score -= bestCaptureValue(probe) * 1.1;
    }
    // Time travel splits attention; only worth it with a real gain.
    if (a.type === 'travel') score -= 6;
    score += rng() * 0.5;
    if (score > bestScore + 1e-9) {
      bestScore = score;
      best = [a];
    } else if (Math.abs(score - bestScore) <= 1e-9) {
      best.push(a);
    }
  }
  return best[Math.floor(rng() * best.length)] ?? actions[0];
}

/**
 * Play out the bot's whole turn: one action per waiting board until the
 * turn passes or the game ends. Returns every intermediate state.
 */
export function playTurn(state: GameState, bot: Bot, rng: Rng = Math.random): GameState[] {
  const steps: GameState[] = [];
  let current = state;
  let guard = 0;
  while (current.status === 'playing' && current.toMove === bot.player && guard++ < 64) {
    const action = chooseAction(current, bot.level, rng);
    if (!action) break;
    current = applyAction(current, action);
    steps.push(current);
  }
  return steps;
}


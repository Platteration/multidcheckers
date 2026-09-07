import { GameState, colOf, playerToMoveAt, rowOf, timelineLabel } from '../engine';

function squareName(sq: number): string {
  return `${String.fromCharCode(97 + colOf(sq))}${rowOf(sq) + 1}`;
}

/** One sentence describing how `state` came to be, for the replay bar. */
export function narrate(state: GameState, names: readonly [string, string]): string {
  const a = state.lastAction;
  const created = state.lastCreated[0];
  if (a?.type === 'endTurn') return `${names[state.toMove === 0 ? 1 : 0]} ended the turn, leaving boards ahead of the present for later.`;
  if (!a || !created) return 'The beginning. One board, one timeline.';
  const who = names[playerToMoveAt(created.turn - 1)];
  let text: string;
  if (a.type === 'move') {
    const to = a.move.path[a.move.path.length - 1];
    text =
      a.move.captures.length > 0
        ? `${who} jumped from ${squareName(a.move.from)} to ${squareName(to)} on ${timelineLabel(a.timeline)}, taking ${a.move.captures.length}.`
        : `${who} moved ${squareName(a.move.from)} to ${squareName(to)} on ${timelineLabel(a.timeline)}.`;
  } else {
    text = `${who} sent the piece on ${squareName(a.from.square)} from ${timelineLabel(a.from.timeline)} back to turn ${a.to.turn} of ${timelineLabel(a.to.timeline)}, branching ${timelineLabel(state.timelines.length - 1)}.`;
  }
  if (state.status === 'won' && state.win) text += ` ${names[state.win.player]} wins.`;
  if (state.status === 'draw') text += ' The game is drawn.';
  return text;
}

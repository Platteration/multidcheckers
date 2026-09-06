/** Shared primitive types for the multiverse engine. */

export type Player = 0 | 1;

export const PLAYER_NAMES: readonly [string, string] = ['Red', 'Black'];

export function otherPlayer(p: Player): Player {
  return p === 0 ? 1 : 0;
}

/** Identifies one board in the multiverse: which timeline, and which turn on it. */
export interface BoardRef {
  timeline: number;
  turn: number;
}

export function sameRef(a: BoardRef | null | undefined, b: BoardRef | null | undefined): boolean {
  return !!a && !!b && a.timeline === b.timeline && a.turn === b.turn;
}

/** Whose move it is on a board at a given turn index. Red moves on even turns. */
export function playerToMoveAt(turn: number): Player {
  return (turn % 2) as Player;
}

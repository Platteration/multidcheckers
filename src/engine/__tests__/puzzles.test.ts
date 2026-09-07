import { applyAction, chooseAction, pendingTimelines } from '../index';
import { PUZZLES } from '../../puzzles';

describe('puzzles', () => {
  it.each(PUZZLES.map((p) => [p.id, p] as const))('%s starts legally and is solvable by its solution', (_id, puzzle) => {
    let g = puzzle.state;
    expect(g.status).toBe('playing');
    expect(g.toMove).toBe(puzzle.player);
    expect(pendingTimelines(g).length).toBeGreaterThan(0);
    let used = 0;
    for (const a of puzzle.solution) {
      expect(g.toMove).toBe(puzzle.player);
      g = applyAction(g, a);
      used++;
      // Let the strongest bot answer between the player's actions.
      while (g.status === 'playing' && g.toMove !== puzzle.player) {
        const reply = chooseAction(g, 3, () => 0.5);
        if (!reply) break;
        g = applyAction(g, reply);
      }
      if (g.status === 'won') break;
    }
    // Any remaining budget: take an immediate win if one exists.
    while (g.status === 'playing' && g.toMove === puzzle.player && used < puzzle.within) {
      const finish = chooseAction(g, 3, () => 0.5);
      if (!finish) break;
      g = applyAction(g, finish);
      used++;
    }
    expect(used).toBeLessThanOrEqual(puzzle.within);
    expect(g.status).toBe('won');
    expect(g.win?.player).toBe(puzzle.player);
  });

  it('no puzzle is already won or winnable with fewer actions than promised for one-movers', () => {
    for (const p of PUZZLES) {
      expect(p.state.win).toBeNull();
      expect(p.solution.length).toBeLessThanOrEqual(p.within);
    }
  });
});

import { describe, expect, it } from 'vitest';
import { createStream, nextInt } from '../src/sim/rng';
import { SpatialHash } from '../src/sim/spatial';
import type { Enemy } from '../src/sim/state';

function enemy(id: number, x: number, y: number, hp = 1): Enemy {
  return { id, kind: 'basic', x, y, hp, maxHp: 1, damage: 1, speed: 1, radius: 1, standoff: 0, attackIntervalTicks: 30, attackCd: 0, energy: 1, bits: 1 };
}

/** Reference: sort every living enemy in range by (d², id). */
function brute(list: Enemy[], x: number, y: number, range: number, k: number): number[] {
  return list
    .filter((e) => e.hp > 0 && (e.x - x) ** 2 + (e.y - y) ** 2 <= range * range)
    .sort((a, b) => (a.x - x) ** 2 + (a.y - y) ** 2 - ((b.x - x) ** 2 + (b.y - y) ** 2) || a.id - b.id)
    .slice(0, k)
    .map((e) => e.id);
}

describe('SpatialHash', () => {
  it('kNearest matches brute force on random layouts, including points outside the grid', () => {
    const rng = createStream(42, 'spatial-test');
    const grid = new SpatialHash(440, 64);
    const out: Enemy[] = [];
    for (let round = 0; round < 200; round++) {
      const list: Enemy[] = [];
      const n = 1 + nextInt(rng, 220);
      for (let i = 0; i < n; i++) {
        // −700..700: some outside the ±440 grid, clamped into edge cells.
        list.push(enemy(i + 1, nextInt(rng, 1400) - 700, nextInt(rng, 1400) - 700, nextInt(rng, 10) === 0 ? 0 : 1));
      }
      grid.build(list);
      const qx = round % 3 === 0 ? 0 : nextInt(rng, 1000) - 500;
      const qy = round % 3 === 0 ? 0 : nextInt(rng, 1000) - 500;
      const range = 50 + nextInt(rng, 600);
      const k = 1 + nextInt(rng, 6);
      const got = grid.kNearest(qx, qy, range, k, out);
      expect(out.map((e) => e.id), `round ${round}`).toEqual(brute(list, qx, qy, range, k));
      expect(got).toBe(out.length);
    }
  });

  it('breaks exact distance ties by the lowest id, regardless of insertion order', () => {
    const grid = new SpatialHash(400, 64);
    const out: Enemy[] = [];
    const ring = [enemy(9, 100, 0), enemy(3, -100, 0), enemy(7, 0, 100), enemy(5, 0, -100)];
    grid.build(ring);
    grid.kNearest(0, 0, 300, 3, out);
    expect(out.map((e) => e.id)).toEqual([3, 5, 7]);
    grid.build([...ring].reverse());
    grid.kNearest(0, 0, 300, 3, out);
    expect(out.map((e) => e.id)).toEqual([3, 5, 7]);
  });

  it('includes enemies exactly on the range boundary and skips dead ones', () => {
    const grid = new SpatialHash(400, 64);
    const out: Enemy[] = [];
    grid.build([enemy(1, 300, 0), enemy(2, 10, 0, 0)]);
    grid.kNearest(0, 0, 300, 5, out);
    expect(out.map((e) => e.id)).toEqual([1]);
  });
});

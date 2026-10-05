// Proves the spawn ring sits just beyond the visible arena edge, and that the first enemy of wave 1
// is on screen within ~1 s of the wave start in both orientations (data + pure layout).
import { describe, expect, it } from 'vitest';
import { DEFAULT_DATA } from '../src/sim/data';
import type { SimEvent } from '../src/sim/events';
import { createWorld } from '../src/sim/state';
import { step } from '../src/sim/step';
import { circleInRect, makeLayout, ORIENTATIONS, worldToScreen } from '../src/ui/layout';

const data = DEFAULT_DATA;
const MAX_SECONDS = 1;

/** Seconds until an enemy walking in from the ring along -dir first touches the arena rect. */
function secondsToVisible(o: (typeof ORIENTATIONS)[number], dx: number, dy: number): number {
  const L = makeLayout(o, data);
  const e = data.enemies.basic;
  const dt = 1 / data.config.tickHz;
  let r = data.config.spawnRadius;
  for (let t = 0; t <= 10; t += dt) {
    const [sx, sy] = worldToScreen(L, dx * r, dy * r);
    if (circleInRect(L.arena, sx, sy, e.radius * L.scale)) return t;
    r -= e.speed * dt;
  }
  return Infinity;
}

describe('spawn ring vs visible arena', () => {
  it('wave 1 spawns its first enemy on the wave-start tick and it is a basic', () => {
    const w = createWorld(data, { seed: 1, tier: 1 });
    const ev: SimEvent[] = [];
    step(w, data, ev);
    const start = ev.findIndex((e) => e.type === 'waveStart');
    const spawn = ev.find((e) => e.type === 'spawn');
    expect(start).toBeGreaterThanOrEqual(0);
    expect(spawn?.type === 'spawn' && spawn.kind).toBe('basic');
  });

  for (const o of ORIENTATIONS) {
    it(`${o}: spawns start off-screen on the short axis and the ring is outside the range circle`, () => {
      const L = makeLayout(o, data);
      const ringPx = data.config.spawnRadius * L.scale;
      const halfShort = Math.min(L.arena.w, L.arena.h) / 2;
      const halfLong = Math.max(L.arena.w, L.arena.h) / 2;
      expect(ringPx).toBeGreaterThan(halfShort + data.enemies.basic.radius * L.scale);
      // Axis-aligned spawns start fully off-screen on the long axis too (only corners can show them).
      expect(ringPx).toBeGreaterThan(halfLong + data.enemies.basic.radius * L.scale);
      // "Just beyond": no more than ~1 s of walking past the long edge either.
      expect(ringPx - halfLong).toBeLessThan(data.enemies.basic.speed * L.scale);
      expect(data.config.spawnRadius).toBeGreaterThan(data.core.range);
      expect(data.config.spawnRadius).toBeGreaterThan(data.enemies.ranged.standoff);
    });

    it(`${o}: from any of the 64 spawn directions a basic is visible within ${MAX_SECONDS} s`, () => {
      const worst = Math.max(...data.directions.map(([dx, dy]) => secondsToVisible(o, dx, dy)));
      // The first spawn is on the wave-start tick (spawn interval starts at tick 1 of the wave).
      expect(worst).toBeLessThanOrEqual(MAX_SECONDS);
      expect(worst).toBeGreaterThan(0.2); // the ring is not inside the screen
    });

    it(`${o}: in the real sim an enemy is on screen within ${MAX_SECONDS} s of the wave-1 start (10 seeds)`, () => {
      const L = makeLayout(o, data);
      for (let seed = 1; seed <= 10; seed++) {
        const w = createWorld(data, { seed, tier: 1 });
        const ev: SimEvent[] = [];
        let startTick = -1;
        let seenTick = -1;
        while (seenTick < 0 && w.tick < 10 * data.config.tickHz) {
          step(w, data, ev);
          if (startTick < 0 && ev.some((e) => e.type === 'waveStart')) startTick = w.tick;
          ev.length = 0;
          for (const e of w.enemies) {
            const [sx, sy] = worldToScreen(L, e.x, e.y);
            if (circleInRect(L.arena, sx, sy, e.radius * L.scale)) seenTick = w.tick;
          }
        }
        expect(startTick).toBe(1);
        expect((seenTick - startTick) / data.config.tickHz, `seed ${seed}`).toBeLessThanOrEqual(MAX_SECONDS);
      }
    });
  }
});

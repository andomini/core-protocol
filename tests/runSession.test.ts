import { describe, expect, it } from 'vitest';
import { FixedLoop } from '../src/render/loop';
import { RunSession } from '../src/render/RunSession';
import type { SimEvent } from '../src/sim/events';
import { hashWorld } from '../src/sim/hash';
import { createWorld } from '../src/sim/state';
import { stepN, testData } from './helpers';

const tough = testData({}, { health: 1e9 });

describe('FixedLoop', () => {
  it('runs tickHz ticks per second of frames at ×1, twice as many at ×2, none when paused', () => {
    const count = (speed: number): number => {
      const loop = new FixedLoop(30, 4);
      let n = 0;
      for (let i = 0; i < 60; i++) n += loop.frame(1000 / 60, speed);
      return n;
    };
    expect(count(1)).toBeGreaterThanOrEqual(29);
    expect(count(1)).toBeLessThanOrEqual(30);
    expect(count(2)).toBeGreaterThanOrEqual(59);
    expect(count(5)).toBeGreaterThanOrEqual(149);
    expect(count(0)).toBe(0);
  });

  it('is frame-rate independent (30 fps and 144 fps give the same tick count)', () => {
    const run = (fps: number): number => {
      const loop = new FixedLoop(30, 4);
      let n = 0;
      for (let i = 0; i < fps * 10; i++) n += loop.frame(1000 / fps, 1);
      return n;
    };
    expect(Math.abs(run(30) - run(144))).toBeLessThanOrEqual(1);
  });

  it('drops the backlog after a long stall and keeps alpha in 0..1', () => {
    const loop = new FixedLoop(30, 4);
    expect(loop.frame(10_000, 1)).toBe(4);
    expect(loop.alpha()).toBe(0);
    loop.frame(20, 1);
    expect(loop.alpha()).toBeGreaterThan(0);
    expect(loop.alpha()).toBeLessThanOrEqual(1);
  });
});

describe('RunSession', () => {
  it('steps the world exactly like a plain step loop and routes every event in order', () => {
    const s = new RunSession(tough, { seed: 9, tier: 1 });
    const routed: SimEvent[] = [];
    expect(s.advance(1200, (e) => routed.push(e))).toBe(1200);
    const ref = createWorld(tough, { seed: 9, tier: 1 });
    const direct = stepN(ref, tough, 1200);
    expect(hashWorld(s.world)).toBe(hashWorld(ref));
    expect(routed).toEqual(direct);
  });

  it('remembers positions from the start of the last tick for interpolation', () => {
    const s = new RunSession(tough, { seed: 2, tier: 1 });
    s.advance(10, () => {});
    const e = s.world.enemies[0]!;
    const p = s.prevOf(e.id)!;
    const moved = Math.hypot(e.x - p.x, e.y - p.y);
    expect(moved).toBeCloseTo(e.speed / tough.config.tickHz, 6);
  });

  it('a killed enemy is still known with the position where it died', () => {
    const s = new RunSession(tough, { seed: 4, tier: 1 });
    let found = false;
    for (let i = 0; i < 2000 && !found; i++) {
      s.advance(1, (ev) => {
        if (ev.type !== 'kill') return;
        const e = s.lastKnown(ev.enemyId);
        expect(e).toBeDefined();
        expect(s.world.enemies.includes(e!)).toBe(false);
        expect(Math.hypot(e!.x, e!.y)).toBeLessThan(tough.stats.stats.range.base + e!.radius + 1);
        found = true;
      });
    }
    expect(found).toBe(true);
  });

  it('stops advancing once the core is dead', () => {
    const weak = testData({}, { health: 1, regen: 0 });
    const s = new RunSession(weak, { seed: 1, tier: 1 });
    let deaths = 0;
    const ran = s.advance(100_000, (e) => {
      if (e.type === 'death') deaths++;
    });
    expect(s.world.dead).toBe(true);
    expect(deaths).toBe(1);
    expect(ran).toBe(s.world.tick);
    expect(s.advance(10, () => {})).toBe(0);
  });

  it('spawn() puts n enemies of a kind on the spawn ring and emits spawn events', () => {
    const s = new RunSession(tough, { seed: 1, tier: 1 });
    const spawns: SimEvent[] = [];
    s.spawn('tank', 5, (e) => spawns.push(e));
    expect(spawns).toHaveLength(5);
    const tanks = s.world.enemies.filter((e) => e.kind === 'tank');
    expect(tanks).toHaveLength(5);
    for (const t of tanks) expect(Math.hypot(t.x, t.y)).toBeCloseTo(tough.config.spawnRadius, 6);
  });

  it('restart() starts a new run with a new seed and forgets render memory', () => {
    const s = new RunSession(tough, { seed: 1, tier: 1 });
    s.advance(300, () => {});
    const id = s.world.enemies[0]!.id;
    s.restart({ seed: 2, tier: 1 });
    expect(s.world.tick).toBe(0);
    expect(s.world.seed).toBe(2);
    expect(s.prevOf(id)).toBeUndefined();
    expect(s.lastKnown(id)).toBeUndefined();
  });
});

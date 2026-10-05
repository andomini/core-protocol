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
    const s = new RunSession(tough, { seed: 9, tier: 1, protocols: false });
    const routed: SimEvent[] = [];
    expect(s.advance(1200, (e) => routed.push(e))).toBe(1200);
    const ref = createWorld(tough, { seed: 9, tier: 1, protocols: false });
    const direct = stepN(ref, tough, 1200);
    expect(hashWorld(s.world)).toBe(hashWorld(ref));
    expect(routed).toEqual(direct);
  });

  it('remembers positions from the start of the last tick for interpolation', () => {
    const s = new RunSession(tough, { seed: 2, tier: 1, protocols: false });
    s.advance(10, () => {});
    const e = s.world.enemies[0]!;
    const p = s.prevOf(e.id)!;
    const moved = Math.hypot(e.x - p.x, e.y - p.y);
    expect(moved).toBeCloseTo(e.speed / tough.config.tickHz, 6);
  });

  it('a killed enemy is still known with the position where it died', () => {
    const s = new RunSession(tough, { seed: 4, tier: 1, protocols: false });
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
    const s = new RunSession(weak, { seed: 1, tier: 1, protocols: false });
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
    const s = new RunSession(tough, { seed: 1, tier: 1, protocols: false });
    const spawns: SimEvent[] = [];
    s.spawn('tank', 5, (e) => spawns.push(e));
    expect(spawns).toHaveLength(5);
    const tanks = s.world.enemies.filter((e) => e.kind === 'tank');
    expect(tanks).toHaveLength(5);
    for (const t of tanks) expect(Math.hypot(t.x, t.y)).toBeCloseTo(tough.config.spawnRadius, 6);
  });

  it('restart() starts a new run with a new seed and forgets render memory', () => {
    const s = new RunSession(tough, { seed: 1, tier: 1, protocols: false });
    s.advance(300, () => {});
    const id = s.world.enemies[0]!.id;
    s.restart({ seed: 2, tier: 1 });
    expect(s.world.tick).toBe(0);
    expect(s.world.seed).toBe(2);
    expect(s.prevOf(id)).toBeUndefined();
    expect(s.lastKnown(id)).toBeUndefined();
  });

  it('queued commands apply at the start of the next step, are logged with that tick, and replay identically', () => {
    const s = new RunSession(tough, { seed: 3, tier: 1, protocols: false });
    s.advance(900, () => {});
    const e0 = s.world.energy;
    expect(e0).toBeGreaterThan(tough.stats.stats.damage.cost.base);
    s.queue({ type: 'buy', stat: 'damage', count: 1 });
    expect(s.world.levels.damage).toBe(0);
    const routed: SimEvent[] = [];
    s.advance(1, (e) => routed.push(e));
    expect(routed[0]).toMatchObject({ type: 'buy', stat: 'damage', levels: 1 });
    expect(s.world.levels.damage).toBe(1);
    const kills = routed.filter((e) => e.type === 'kill').reduce((t, e) => t + (e.type === 'kill' ? e.energy : 0), 0);
    expect(s.world.energy).toBeCloseTo(e0 - tough.stats.stats.damage.cost.base + kills, 9);
    expect(s.log).toEqual([{ tick: 900, cmd: { type: 'buy', stat: 'damage', count: 1 } }]);
    expect(s.stats.damage).toBe(tough.stats.stats.damage.base + tough.stats.stats.damage.per);
  });

  it('applyPendingNow (paused) is equivalent to applying at the next step', () => {
    const a = new RunSession(tough, { seed: 8, tier: 1, protocols: false });
    const b = new RunSession(tough, { seed: 8, tier: 1, protocols: false });
    a.advance(1000, () => {});
    b.advance(1000, () => {});
    a.queue({ type: 'buy', stat: 'health', count: 'max' });
    b.queue({ type: 'buy', stat: 'health', count: 'max' });
    a.applyPendingNow(() => {});
    expect(a.world.levels.health).toBeGreaterThan(0);
    expect(a.stats.health).toBeGreaterThan(tough.stats.stats.health.base);
    a.advance(500, () => {});
    b.advance(500, () => {});
    expect(hashWorld(a.world)).toBe(hashWorld(b.world));
    expect(a.log).toEqual(b.log);
  });
});

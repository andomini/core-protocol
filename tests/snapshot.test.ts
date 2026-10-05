import { describe, expect, it } from 'vitest';
import { hashWorld } from '../src/sim/hash';
import { MAX_VALUE } from '../src/sim/num';
import { restore, snapshot } from '../src/sim/snapshot';
import { createWorld } from '../src/sim/state';
import { stepN, testData } from './helpers';

const data = testData({}, { health: 1e9 });

describe('snapshot', () => {
  it('a world restored mid-wave continues exactly like an uninterrupted one', () => {
    const straight = createWorld(data, { seed: 77, tier: 2, protocols: false });
    stepN(straight, data, 3000);

    const first = createWorld(data, { seed: 77, tier: 2, protocols: false });
    stepN(first, data, 1500); // tick 1500 = 20 s into wave 2 (mid-wave)
    expect(first.phase).toBe('wave');
    const resumed = restore(snapshot(first));
    stepN(resumed, data, 1500);

    expect(hashWorld(resumed)).toBe(hashWorld(straight));
  });

  it('values near the cap survive the round trip unchanged', () => {
    const w = createWorld(data, { seed: 1, tier: 1, protocols: false });
    stepN(w, data, 30);
    w.energy = 9.87654321e299;
    w.bits = MAX_VALUE;
    w.enemies[0]!.hp = 1.2345678901234567e299;
    const r = restore(snapshot(w));
    expect(JSON.stringify(r)).toBe(JSON.stringify(w));
    expect(r.energy).toBe(9.87654321e299);
    expect(r.bits).toBe(MAX_VALUE);
  });

  it('refuses to snapshot a non-finite value and names it', () => {
    const w = createWorld(data, { seed: 1, tier: 1, protocols: false });
    w.energy = Infinity;
    expect(() => snapshot(w)).toThrow('$.energy');
  });

  it('rejects garbage with a clear snapshot error', () => {
    expect(() => restore('not json')).toThrow(/snapshot/);
    expect(() => restore('{"v":99,"world":{}}')).toThrow(/snapshot.*version/);
    expect(() => restore('{"v":3,"world":{"tick":"x"}}')).toThrow(/snapshot/);
    const w = createWorld(data, { seed: 1, tier: 1, protocols: false });
    const withNull = JSON.stringify({ v: 3, world: { ...w, energy: null } });
    expect(() => restore(withNull)).toThrow(/energy/);
    const noUpgradeStream = JSON.stringify({ v: 3, world: { ...w, rng: { spawn: w.rng.spawn, combat: w.rng.combat } } });
    expect(() => restore(noUpgradeStream)).toThrow(/snapshot: malformed/);
    const pickWithoutOffer = JSON.stringify({ v: 3, world: { ...w, phase: 'pick', offer: [] } });
    expect(() => restore(pickWithoutOffer)).toThrow(/snapshot: malformed/);
  });

  it('rejects a v1 (M1–M2a) snapshot cleanly: derived core stats, no upgrade stream', () => {
    const w = createWorld(data, { seed: 1, tier: 1, protocols: false });
    const { levels: _l, workshop: _w, unlocked: _u, mods: _m, ...rest } = w;
    const v1World = {
      ...rest,
      v: 1,
      core: { hp: 100, maxHp: 100, regen: 0.5, damage: 5, attackSpeed: 1, range: 300, fireCd: 0 },
      rng: { spawn: w.rng.spawn, combat: w.rng.combat },
    };
    expect(() => restore(JSON.stringify({ v: 1, world: v1World }))).toThrow(/snapshot: unsupported version 1/);
    // A v1 world smuggled inside a v3 envelope is still refused.
    expect(() => restore(JSON.stringify({ v: 3, world: v1World }))).toThrow(/snapshot: malformed/);
  });

  it('rejects a v2 (M2b) snapshot: no protocols', () => {
    const w = createWorld(data, { seed: 1, tier: 1, protocols: false });
    const { perks: _p, cardTags: _c, setTiers: _s, offer: _o, timers: _t, boost: _b, ...rest } = w;
    const v2World = { ...rest, v: 2 };
    expect(() => restore(JSON.stringify({ v: 2, world: v2World }))).toThrow(/snapshot: unsupported version 2/);
    expect(() => restore(JSON.stringify({ v: 3, world: v2World }))).toThrow(/snapshot: malformed/);
  });

  it('a snapshot taken after purchases restores levels and continues identically', () => {
    const a = createWorld(data, { seed: 5, tier: 1, protocols: false, unlocked: ['freeUpgrade'] });
    stepN(a, data, 1200);
    a.energy += 500;
    stepN(a, data, 1, [{ type: 'buy', stat: 'damage', count: 5 }, { type: 'buy', stat: 'freeUpgrade', count: 3 }]);
    expect(a.levels.damage).toBe(5);
    const b = restore(snapshot(a));
    stepN(a, data, 600, [{ type: 'buy', stat: 'health', count: 'max' }]);
    stepN(b, data, 600, [{ type: 'buy', stat: 'health', count: 'max' }]);
    expect(hashWorld(b)).toBe(hashWorld(a));
  });
});

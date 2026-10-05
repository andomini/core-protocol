import { describe, expect, it } from 'vitest';
import { hashWorld } from '../src/sim/hash';
import { MAX_VALUE } from '../src/sim/num';
import { restore, snapshot } from '../src/sim/snapshot';
import { createWorld } from '../src/sim/state';
import { stepN, testData } from './helpers';

const data = testData({ core: { health: 1e9 } });

describe('snapshot', () => {
  it('a world restored mid-wave continues exactly like an uninterrupted one', () => {
    const straight = createWorld(data, { seed: 77, tier: 2 });
    stepN(straight, data, 3000);

    const first = createWorld(data, { seed: 77, tier: 2 });
    stepN(first, data, 1500); // tick 1500 = 20 s into wave 2 (mid-wave)
    expect(first.phase).toBe('wave');
    const resumed = restore(snapshot(first));
    stepN(resumed, data, 1500);

    expect(hashWorld(resumed)).toBe(hashWorld(straight));
  });

  it('values near the cap survive the round trip unchanged', () => {
    const w = createWorld(data, { seed: 1, tier: 1 });
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
    const w = createWorld(data, { seed: 1, tier: 1 });
    w.energy = Infinity;
    expect(() => snapshot(w)).toThrow('$.energy');
  });

  it('rejects garbage with a clear snapshot error', () => {
    expect(() => restore('not json')).toThrow(/snapshot/);
    expect(() => restore('{"v":99,"world":{}}')).toThrow(/snapshot.*version/);
    expect(() => restore('{"v":1,"world":{"tick":"x"}}')).toThrow(/snapshot/);
    const w = createWorld(data, { seed: 1, tier: 1 });
    const withNull = JSON.stringify({ v: 1, world: { ...w, energy: null } });
    expect(() => restore(withNull)).toThrow(/energy/);
  });
});

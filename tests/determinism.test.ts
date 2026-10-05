import { describe, expect, it } from 'vitest';
import type { SimEvent } from '../src/sim/events';
import { hashWorld } from '../src/sim/hash';
import { createWorld } from '../src/sim/state';
import { step } from '../src/sim/step';
import { testData } from './helpers';

// 10 minutes of play with a core that survives, so every system keeps running.
const data = testData({ core: { health: 1e9 } });
const TICKS = 10 * 60 * data.config.tickHz;

function run(seed: number) {
  const w = createWorld(data, { seed, tier: 1 });
  const hashes: string[] = [];
  const events: SimEvent[] = [];
  for (let i = 1; i <= TICKS; i++) {
    step(w, data, events);
    events.length = 0;
    if (i % 100 === 0) hashes.push(hashWorld(w));
  }
  return { w, hashes };
}

describe('determinism', () => {
  it('the same seed gives the same state hash every 100 ticks for 10 minutes', () => {
    const a = run(20261005);
    const b = run(20261005);
    expect(a.hashes).toEqual(b.hashes);
    expect(a.w.dead).toBe(false);
    expect(a.w.wave).toBeGreaterThanOrEqual(20);
    expect(a.w.kills).toBeGreaterThan(0);
  });

  it('a different seed gives a different run', () => {
    expect(run(1).hashes.at(-1)).not.toBe(run(2).hashes.at(-1));
  });

  it('hashWorld is 8 hex chars', () => {
    expect(hashWorld(createWorld(data, { seed: 1, tier: 1 }))).toMatch(/^[0-9a-f]{8}$/);
  });
});

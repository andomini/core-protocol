import { describe, expect, it } from 'vitest';
import { applyCommands, type Command } from '../src/sim/commands';
import { STAT_IDS } from '../src/sim/data';
import type { SimEvent } from '../src/sim/events';
import { createWorld, worldStats } from '../src/sim/state';
import { costSum } from '../src/sim/stats';
import { ofType, stepN, testData } from './helpers';

const data = testData({ config: { baseEnemiesPerWave: 0, enemiesPerWaveGrowth: 0 } });
const S = data.stats.stats;

function rich(energy = 1e6, unlocked: string[] = []) {
  const w = createWorld(data, { seed: 3, tier: 1, protocols: false, unlocked });
  w.energy = energy;
  return w;
}

function apply(w: ReturnType<typeof rich>, ...cmds: Command[]): SimEvent[] {
  const ev: SimEvent[] = [];
  applyCommands(w, data, cmds, ev);
  return ev;
}

describe('buy command', () => {
  it('×1 raises the level and spends exactly the level price', () => {
    const w = rich(100);
    const ev = apply(w, { type: 'buy', stat: 'damage', count: 1 });
    expect(w.levels.damage).toBe(1);
    expect(w.energy).toBe(100 - S.damage.cost.base);
    expect(ofType(ev, 'buy')).toEqual([{ type: 'buy', stat: 'damage', levels: 1, level: 1, cost: S.damage.cost.base, free: false }]);
    expect(worldStats(w, data).damage).toBe(S.damage.base + S.damage.per);
  });

  it('×10 is all-or-nothing', () => {
    const w = rich(costSum(S.regen, 0, 10) - 0.01);
    const ev = apply(w, { type: 'buy', stat: 'regen', count: 10 });
    expect(ofType(ev, 'buyRejected')).toEqual([{ type: 'buyRejected', stat: 'regen', reason: 'funds' }]);
    expect(w.levels.regen).toBe(0);
    w.energy += 0.02;
    apply(w, { type: 'buy', stat: 'regen', count: 10 });
    expect(w.levels.regen).toBe(10);
  });

  it('MAX buys every affordable level and stops at the max level', () => {
    const w = rich(1e9);
    apply(w, { type: 'buy', stat: 'range', count: 'max' });
    expect(w.levels.range).toBe(S.range.maxLevel);
    const ev = apply(w, { type: 'buy', stat: 'range', count: 1 });
    expect(ofType(ev, 'buyRejected')[0]?.reason).toBe('maxed');
  });

  it('Health purchases add the new max HP to the current HP; other values are derived, never stored', () => {
    const w = rich(1e6);
    w.core.hp = 50;
    apply(w, { type: 'buy', stat: 'health', count: 3 });
    expect(w.core.hp).toBe(50 + 3 * S.health.per);
    expect(Object.keys(w.core).sort()).toEqual(['fireCd', 'hp', 'shots']);
  });

  it('a locked stat cannot be bought: no change, a buyRejected(locked) event', () => {
    for (const id of STAT_IDS.filter((s) => S[s].lockedByDefault)) {
      const w = rich();
      const before = JSON.stringify(w);
      const ev = apply(w, { type: 'buy', stat: id, count: 1 });
      expect(ev).toEqual([{ type: 'buyRejected', stat: id, reason: 'locked' }]);
      expect(JSON.stringify(w)).toBe(before);
    }
  });

  it('RunOptions.unlocked opens a starred stat', () => {
    const w = rich(1e6, ['multishot', 'bogus']);
    expect(w.unlocked).toEqual(['multishot']);
    apply(w, { type: 'buy', stat: 'multishot', count: 1 });
    expect(w.levels.multishot).toBe(1);
  });

  it('rejects malformed commands (e.g. from a hand-edited log) without touching the world', () => {
    const w = rich();
    const before = JSON.stringify(w);
    const bad = [
      { type: 'buy', stat: 'nope', count: 1 },
      { type: 'buy', stat: 'damage', count: 0 },
      { type: 'buy', stat: 'damage', count: -3 },
      { type: 'buy', stat: 'damage', count: 1.5 },
      { type: 'buy', stat: 'damage', count: Number.NaN },
      { type: 'sell', stat: 'damage', count: 1 },
    ] as unknown as Command[];
    const ev = apply(w, ...bad);
    expect(ev.map((e) => (e.type === 'buyRejected' ? e.reason : e.type))).toEqual(['unknown', 'badCount', 'badCount', 'badCount', 'badCount', 'unknown']);
    expect(JSON.stringify(w)).toBe(before);
  });

  it('a dead world rejects purchases', () => {
    const w = rich();
    w.dead = true;
    expect(apply(w, { type: 'buy', stat: 'damage', count: 1 })[0]).toEqual({ type: 'buyRejected', stat: 'damage', reason: 'dead' });
  });

  it('commands passed to step are applied before the tick advances', () => {
    const w = rich(100);
    const ev = stepN(w, data, 1, [{ type: 'buy', stat: 'damage', count: 1 }]);
    expect(ev[0]?.type).toBe('buy');
    expect(w.tick).toBe(1);
  });
});

describe('Free Upgrade', () => {
  it('with chance 1 every purchase is free; the levels are still added', () => {
    const d = testData({ stats: { stats: { freeUpgrade: { cap: 1 } } } }, { freeUpgrade: 1 });
    const w = createWorld(d, { seed: 1, tier: 1, protocols: false });
    w.energy = 1000;
    const ev: SimEvent[] = [];
    applyCommands(w, d, [{ type: 'buy', stat: 'damage', count: 'max' }], ev);
    expect(w.energy).toBe(1000);
    expect(w.levels.damage).toBeGreaterThan(10);
    expect(ofType(ev, 'buy')[0]).toMatchObject({ free: true, cost: 0 });
  });

  it('rolls on its own stream: purchases never shift the combat or spawn streams', () => {
    const d = testData({}, { freeUpgrade: 0.5, health: 1e9 });
    const plain = createWorld(d, { seed: 9, tier: 1, protocols: false });
    const buyer = createWorld(d, { seed: 9, tier: 1, protocols: false });
    stepN(plain, d, 600);
    stepN(buyer, d, 600);
    buyer.energy = 1e12;
    const ev: SimEvent[] = [];
    // Bits/Wave and Energy/Wave do not change combat before the next wave end.
    for (let i = 0; i < 40; i++) applyCommands(buyer, d, [{ type: 'buy', stat: i % 2 ? 'bitsPerWave' : 'energyPerWave', count: 1 }], ev);
    const frees = ofType(ev, 'buy').filter((e) => e.free).length;
    expect(frees).toBeGreaterThan(5);
    expect(frees).toBeLessThan(35);
    expect(buyer.rng.upgrades).not.toEqual(plain.rng.upgrades);
    expect(buyer.rng.combat).toEqual(plain.rng.combat);
    expect(buyer.rng.spawn).toEqual(plain.rng.spawn);
    stepN(plain, d, 100);
    stepN(buyer, d, 100);
    expect(buyer.rng.combat).toEqual(plain.rng.combat);
    expect(buyer.enemies).toEqual(plain.enemies);
  });
});

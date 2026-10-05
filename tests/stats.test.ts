import { describe, expect, it } from 'vitest';
import { COST_GROWTH_MAX, COST_GROWTH_MIN, DEFAULT_DATA, STAT_IDS, type StatDef } from '../src/sim/data';
import { MAX_VALUE } from '../src/sim/num';
import {
  costSum, effectiveStats, levelCost, maxAffordable, quoteBuy, remainingLevels, statValue, zeroLevels, type Modifier,
} from '../src/sim/stats';
import { testData } from './helpers';

const data = DEFAULT_DATA;
const S = data.stats.stats;
const none = () => ({ workshop: zeroLevels(), run: zeroLevels(), mods: [] as Modifier[] });
const def = (patch: Partial<StatDef>): StatDef => ({ ...S.damage, ...patch });

describe('stat data', () => {
  it('has 18 stats in 3 tabs of 6, every cost growth inside the spec range', () => {
    expect(STAT_IDS).toHaveLength(18);
    for (const tab of ['atk', 'def', 'util'] as const) expect(data.stats.tabs[tab]).toHaveLength(6);
    for (const id of STAT_IDS) {
      expect(S[id].cost.growth).toBeGreaterThanOrEqual(COST_GROWTH_MIN);
      expect(S[id].cost.growth).toBeLessThanOrEqual(COST_GROWTH_MAX);
    }
  });

  it('locks exactly the starred stats by default (Multishot, Lifesteal, Interest, Free Upgrade)', () => {
    expect(STAT_IDS.filter((id) => S[id].lockedByDefault)).toEqual(['multishot', 'lifesteal', 'interest', 'freeUpgrade']);
  });

  it('rejects a cost growth outside [1.07, 1.12] and names the stat', () => {
    expect(() => testData({ stats: { stats: { damage: { cost: { base: 5, growth: 1.2 } } } } })).toThrow(/stats\.damage\.cost\.growth/);
    expect(() => testData({ stats: { stats: { regen: { cost: { base: 5, growth: 1.05 } } } } })).toThrow(/stats\.regen\.cost\.growth/);
  });

  it('rejects a zero base attack speed (a divisor)', () => {
    expect(() => testData({ stats: { stats: { attackSpeed: { base: 0 } } } })).toThrow(/stats\.attackSpeed\.base/);
  });
});

describe('statValue', () => {
  it('additive: base + per × level', () => {
    expect(statValue(def({ base: 5, per: 2, mode: 'add' }), 0)).toBe(5);
    expect(statValue(def({ base: 5, per: 2, mode: 'add' }), 7)).toBe(19);
  });

  it('multiplicative: base × per^level (powInt), clamped', () => {
    expect(statValue(def({ base: 2, per: 1.5, mode: 'mul' }), 3)).toBe(2 * 1.5 * 1.5 * 1.5);
    expect(statValue(def({ base: 2, per: 10, mode: 'mul' }), 400)).toBe(MAX_VALUE);
  });
});

describe('effectiveStats', () => {
  it('level-0 stats are the data base values', () => {
    const s = effectiveStats(data, none());
    for (const id of STAT_IDS) expect(s[id]).toBe(S[id].base);
    expect(s.interestCap).toBe(data.stats.economy.interestCap);
  });

  it('workshop and run levels add up on the same curve', () => {
    const i = none();
    i.workshop.damage = 3;
    i.run.damage = 4;
    expect(effectiveStats(data, i).damage).toBe(statValue(S.damage, 7));
  });

  it('modifiers: all adds first, then all muls, in any list order', () => {
    const i = none();
    const a: Modifier = { stat: 'damage', op: 'mul', value: 2, source: 'a' };
    const b: Modifier = { stat: 'damage', op: 'add', value: 5, source: 'b' };
    const c: Modifier = { stat: 'damage', op: 'mul', value: 1.5, source: 'c' };
    i.mods = [a, b, c];
    const x = effectiveStats(data, i).damage;
    i.mods = [c, a, b];
    expect(effectiveStats(data, i).damage).toBe(x);
    expect(x).toBe((S.damage.base + 5) * 2 * 1.5);
  });

  it('modifiers can target the interest cap', () => {
    const i = none();
    i.mods = [{ stat: 'interestCap', op: 'mul', value: 1.5, source: 'compound' }];
    expect(effectiveStats(data, i).interestCap).toBe(data.stats.economy.interestCap * 1.5);
  });

  it('caps apply after modifiers (Defense % never exceeds its data cap)', () => {
    const i = none();
    i.run.defense = 50;
    i.mods = [{ stat: 'defense', op: 'add', value: 5, source: 'x' }];
    expect(effectiveStats(data, i).defense).toBe(S.defense.cap);
  });

  it('is pure: the inputs are not mutated and the same inputs give equal results', () => {
    const i = none();
    i.run.health = 5;
    const copy = JSON.stringify(i);
    expect(effectiveStats(data, i)).toEqual(effectiveStats(data, i));
    expect(JSON.stringify(i)).toBe(copy);
  });
});

describe('costs', () => {
  it('level cost is base × growth^level', () => {
    const d = S.damage;
    expect(levelCost(d, 0)).toBe(d.cost.base);
    expect(levelCost(d, 10)).toBeCloseTo(d.cost.base * Math.pow(d.cost.growth, 10), 9);
  });

  it('the closed-form sum matches a per-level loop', () => {
    for (const id of STAT_IDS) {
      const d = S[id];
      for (const [L, n] of [[0, 1], [0, 10], [7, 13], [40, 60]] as const) {
        let loop = 0;
        for (let k = 0; k < n; k++) loop += levelCost(d, L + k);
        expect(costSum(d, L, n) / loop).toBeCloseTo(1, 12);
      }
      expect(costSum(d, 5, 0)).toBe(0);
    }
  });

  it('a sum past the value cap is Infinity (never affordable), not a clamped price', () => {
    expect(costSum(S.damage, 0, 20000)).toBe(Infinity);
    expect(costSum(S.damage, 20000, 1)).toBe(Infinity);
  });
});

describe('MAX buy', () => {
  it('buys the largest affordable count', () => {
    const d = S.damage;
    for (const e of [0, 4.99, 5, 10.5, 1234, 1e6]) {
      const n = maxAffordable(d, 3, e);
      expect(costSum(d, 3, n)).toBeLessThanOrEqual(e);
      expect(costSum(d, 3, n + 1)).toBeGreaterThan(e);
    }
  });

  it('respects the max level', () => {
    const d = S.range; // maxLevel 10
    expect(remainingLevels(d, 4)).toBe(6);
    expect(maxAffordable(d, 4, 1e100)).toBe(6);
    expect(maxAffordable(d, 10, 1e100)).toBe(0);
    expect(remainingLevels(S.damage, 1e6)).toBe(Infinity);
  });

  it('handles 1e250 Energy fast, without a per-level loop', () => {
    const d = S.damage;
    const t0 = performance.now();
    const n = maxAffordable(d, 0, 1e250);
    const ms = performance.now() - t0;
    // 5·(1.1^n − 1)/0.1 ≤ 1e250 → n ≈ log(2e248)/log(1.1) ≈ 5999.
    expect(n).toBeGreaterThan(5900);
    expect(n).toBeLessThan(6100);
    expect(costSum(d, 0, n)).toBeLessThanOrEqual(1e250);
    expect(costSum(d, 0, n + 1)).toBeGreaterThan(1e250);
    expect(ms).toBeLessThan(5);
    // At the value cap itself it still terminates.
    expect(maxAffordable(d, 0, MAX_VALUE)).toBeGreaterThan(n);
  });

  it('quoteBuy: ×N is all-or-nothing, clipped to the max level; MAX shows the next level when nothing is affordable', () => {
    const d = S.range;
    expect(quoteBuy(d, 0, 1, 1e9)).toEqual({ levels: 1, cost: costSum(d, 0, 1), affordable: true });
    expect(quoteBuy(d, 5, 10, 1e9)).toEqual({ levels: 5, cost: costSum(d, 5, 5), affordable: true });
    expect(quoteBuy(d, 0, 10, 20).affordable).toBe(false);
    expect(quoteBuy(d, 0, 10, 20).levels).toBe(10);
    expect(quoteBuy(d, 0, 'max', 1)).toEqual({ levels: 1, cost: costSum(d, 0, 1), affordable: false });
    expect(quoteBuy(d, 10, 'max', 1e9)).toEqual({ levels: 0, cost: 0, affordable: false });
    const q = quoteBuy(d, 0, 'max', 100);
    expect(q.affordable).toBe(true);
    expect(q.levels).toBe(maxAffordable(d, 0, 100));
  });
});

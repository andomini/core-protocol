// Soft-wall cost curves (knee + growthAfter) for in-run and workshop prices, and workshop mastery.
import { describe, expect, it } from 'vitest';
import { DEFAULT_DATA, type StatDef, validateData } from '../src/sim/data';
import { curveSum, costSum, maxAffordable } from '../src/sim/stats';
import { DEFAULT_META_DATA, type MetaData, validateMetaData } from '../src/meta/metaData';
import { masteryMul, masteryMuls, workshopCost } from '../src/meta/workshop';
import { buildRunOptions } from '../src/meta/runOptions';
import { defaultMeta } from '../src/meta/state';
import { createWorld, worldStats } from '../src/sim/state';
import { testData } from './helpers';

const S = DEFAULT_DATA.stats.stats;
const def = (cost: StatDef['cost']): StatDef => ({ ...S.damage, cost });
const naive = (c: StatDef['cost'], level: number, n: number) => {
  let s = 0;
  for (let i = level; i < level + n; i++) {
    const k = c.knee ?? Infinity;
    s += c.base * Math.pow(c.growth, Math.min(i, k)) * (i > k ? Math.pow(c.growthAfter!, i - k) : 1);
  }
  return s;
};

describe('soft-wall cost curve', () => {
  it('matches the plain geometric sum below the knee and without one', () => {
    const geo = { base: 5, growth: 1.12 };
    const knee = { base: 5, growth: 1.12, knee: 40, growthAfter: 1.03 };
    for (const [l, n] of [[0, 1], [3, 7], [10, 30]] as const) {
      expect(curveSum(knee, l, n)).toBe(curveSum(geo, l, n));
      expect(costSum(def(geo), l, n)).toBe(curveSum(geo, l, n));
    }
  });

  it('prices each level past the knee by growthAfter, also across the knee', () => {
    const c = { base: 5, growth: 1.12, knee: 40, growthAfter: 1.03 };
    for (const [l, n] of [[35, 10], [40, 1], [41, 1], [60, 25], [0, 100]] as const) {
      expect(Math.abs(curveSum(c, l, n) - naive(c, l, n))).toBeLessThanOrEqual(1 + naive(c, l, n) * 1e-9); // ⌈⌉ only
    }
    // One level past the knee costs growthAfter × the one before it.
    expect(curveSum(c, 51, 1) / curveSum(c, 50, 1)).toBeCloseTo(1.03, 3);
  });

  it('supports a flat tail (growthAfter 1) and stays monotone for MAX buys', () => {
    const c = { base: 5, growth: 1.12, knee: 20, growthAfter: 1 };
    expect(curveSum(c, 30, 4)).toBe(Math.ceil(4 * 5 * Math.pow(1.12, 20)));
    const d = def({ base: 5, growth: 1.12, knee: 30, growthAfter: 1.02 });
    const e = 1e7;
    const n = maxAffordable(d, 10, e);
    expect(costSum(d, 10, n)).toBeLessThanOrEqual(e);
    expect(costSum(d, 10, n + 1)).toBeGreaterThan(e);
  });

  it('rejects a bad knee pair in stats and meta data', () => {
    const lone = structuredClone(DEFAULT_DATA);
    lone.stats.stats.damage.cost = { base: 5, growth: 1.12, knee: 10 };
    expect(() => validateData(lone)).toThrow(/damage\.cost\.growthAfter/);
    expect(() => testData({ stats: { stats: { damage: { cost: { base: 5, growth: 1.12, knee: 10, growthAfter: 1.2 } } } } })).toThrow(/growthAfter/);
    expect(() => testData({ stats: { stats: { damage: { cost: { base: 5, growth: 1.12, knee: 0.5, growthAfter: 1.01 } } } } })).toThrow(/knee/);
    const bad = structuredClone(DEFAULT_META_DATA) as MetaData;
    bad.workshop.default = { base: 16, growth: 1.12, knee: 60, growthAfter: 0.9 };
    expect(() => validateMetaData(bad)).toThrow(/growthAfter/);
  });
});

describe('workshop soft wall and mastery', () => {
  it('workshop prices keep rising gently past the knee', () => {
    const c = DEFAULT_META_DATA.workshop.default;
    const m = defaultMeta();
    m.workshop.damage = c.knee ?? 0;
    const atKnee = workshopCost(m, DEFAULT_META_DATA, 'damage');
    m.workshop.damage = (c.knee ?? 0) + 100;
    const after = workshopCost(m, DEFAULT_META_DATA, 'damage');
    expect(after / atKnee / Math.pow(c.growthAfter ?? c.growth, 100)).toBeCloseTo(1, 4);
  });

  it('mastery multiplies a stat by mul^⌊level/every⌋ through the run options', () => {
    const md = structuredClone(DEFAULT_META_DATA) as MetaData;
    md.workshop.mastery = { every: 10, mul: { damage: 1.1 } };
    const m = defaultMeta();
    m.workshop.damage = 25;
    expect(masteryMul(m, md, 'damage')).toBeCloseTo(1.21, 9);
    expect(masteryMul(m, md, 'health')).toBe(1);
    expect(masteryMuls(m, md)).toEqual({ damage: masteryMul(m, md, 'damage') });
    const w = createWorld(DEFAULT_DATA, buildRunOptions(m, DEFAULT_DATA, md, 1, 1));
    expect(worldStats(w, DEFAULT_DATA).damage).toBeCloseTo((S.damage.base + 25 * S.damage.per) * 1.21, 6);
    m.workshop.damage = 9;
    expect(masteryMuls(m, md)).toEqual({});
  });
});

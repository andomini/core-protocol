// Combat and economy effects of the 18 stats (spec §2.3). Stats are set through data base values so each
// test isolates one effect; the formulas themselves are covered in stats.test.ts.
import { describe, expect, it } from 'vitest';
import type { SimEvent } from '../src/sim/events';
import { dsqrt } from '../src/sim/num';
import { knockBack } from '../src/sim/projectiles';
import { createWorld, worldStats } from '../src/sim/state';
import { spawnEnemy } from '../src/sim/waves';
import { ofType, type StatBases, stepN, testData } from './helpers';

const QUIET = { config: { baseEnemiesPerWave: 0, enemiesPerWaveGrowth: 0 } };

function setup(bases: StatBases = {}, patch = {}) {
  const data = testData({ ...QUIET, ...patch }, bases);
  const w = createWorld(data, { seed: 1, tier: 1, protocols: false });
  stepN(w, data, 1); // start wave 1
  return { data, w };
}

const dist = (e: { x: number; y: number }) => dsqrt(e.x * e.x + e.y * e.y);

describe('crit', () => {
  it('chance 0: never crits; chance 1: every hit is damage × crit factor', () => {
    let s = setup({ critChance: 0, damage: 1, health: 1e9 });
    spawnEnemy(s.w, s.data, 'tank', 200, 0, []);
    let hits = ofType(stepN(s.w, s.data, 200), 'hit');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((h) => !h.crit && h.damage === 1)).toBe(true);

    s = setup({ critChance: 1, critFactor: 3, damage: 1, health: 1e9 });
    spawnEnemy(s.w, s.data, 'tank', 200, 0, []);
    hits = ofType(stepN(s.w, s.data, 200), 'hit');
    expect(hits.every((h) => h.crit && h.damage === 3)).toBe(true);
  });

  it('a 30 % chance crits roughly 30 % of shots, deterministically per seed', () => {
    const run = () => {
      const s = setup({ critChance: 0.3, attackSpeed: 10, damage: 0.001, health: 1e9 });
      spawnEnemy(s.w, s.data, 'boss', 250, 0, []);
      return ofType(stepN(s.w, s.data, 600), 'shot').map((e) => e.crit);
    };
    const a = run();
    expect(run()).toEqual(a);
    const rate = a.filter(Boolean).length / a.length;
    expect(a.length).toBeGreaterThan(150);
    expect(rate).toBeGreaterThan(0.2);
    expect(rate).toBeLessThan(0.4);
  });
});

describe('multishot', () => {
  it('fires one extra projectile per level at the next-nearest distinct targets', () => {
    const { data, w } = setup({ multishot: 2, damage: 0.001 });
    const far = spawnEnemy(w, data, 'tank', 290, 0, []);
    const near = spawnEnemy(w, data, 'tank', 0, 100, []);
    const mid = spawnEnemy(w, data, 'tank', -200, 0, []);
    spawnEnemy(w, data, 'tank', 0, 299.9, []); // 4th nearest: not targeted
    const shots = ofType(stepN(w, data, 1), 'shot');
    expect(shots.map((s) => s.targetId)).toEqual([near.id, mid.id, far.id]);
  });

  it('with fewer targets than projectiles each target still gets one', () => {
    const { data, w } = setup({ multishot: 3, damage: 0.001 });
    const a = spawnEnemy(w, data, 'tank', 100, 0, []);
    expect(ofType(stepN(w, data, 1), 'shot').map((s) => s.targetId)).toEqual([a.id]);
  });
});

describe('defense, thorns, lifesteal, regen', () => {
  it('Defense % reduces incoming damage', () => {
    const { data, w } = setup({ defense: 0.25, damage: 0, regen: 0 });
    const e = spawnEnemy(w, data, 'basic', data.core.radius + data.enemies.basic.radius, 0, []);
    const hits = ofType(stepN(w, data, 1), 'coreHit');
    expect(hits[0]?.damage).toBeCloseTo(e.damage * 0.75, 12);
    expect(w.core.hp).toBeCloseTo(worldStats(w, data).health - e.damage * 0.75, 9);
  });

  it('Defense % is capped by data even when bought past it', () => {
    const { data, w } = setup({ defense: 0.6, damage: 0, regen: 0 });
    w.energy = 1e12;
    stepN(w, data, 1, [{ type: 'buy', stat: 'defense', count: 'max' }]);
    expect(worldStats(w, data).defense).toBe(data.stats.stats.defense.cap);
  });

  it('Thorns reflect a share of melee damage taken (after defense); a lethal reflection pays the kill', () => {
    const { data, w } = setup({ thorns: 0.5, defense: 0.2, damage: 0, regen: 0 });
    const e = spawnEnemy(w, data, 'tank', data.core.radius + data.enemies.tank.radius, 0, []);
    const ev = stepN(w, data, 1);
    const taken = e.damage * 0.8;
    expect(ofType(ev, 'hit')).toEqual([{ type: 'hit', enemyId: e.id, damage: taken * 0.5, crit: false, source: 'thorns' }]);
    expect(e.hp).toBeCloseTo(e.maxHp - taken * 0.5, 9);

    const k = setup({ thorns: 100, damage: 0, regen: 0 });
    spawnEnemy(k.w, k.data, 'basic', k.data.core.radius + k.data.enemies.basic.radius, 0, []);
    expect(ofType(stepN(k.w, k.data, 1), 'kill')).toHaveLength(1);
    expect(k.w.energy).toBeGreaterThan(0);
  });

  it('Thorns ignore ranged attacks', () => {
    const { data, w } = setup({ thorns: 1, damage: 0, regen: 0 });
    spawnEnemy(w, data, 'ranged', data.enemies.ranged.standoff, 0, []);
    const ev = stepN(w, data, 1);
    expect(ofType(ev, 'coreHit')).toHaveLength(1);
    expect(ofType(ev, 'hit')).toHaveLength(0);
  });

  it('Lifesteal heals a share of the damage actually dealt (overkill does not heal), up to max HP', () => {
    const { data, w } = setup({ lifesteal: 0.5, damage: 1000, regen: 0 });
    w.core.hp = 10;
    const e = spawnEnemy(w, data, 'basic', 100, 0, []);
    stepN(w, data, 10);
    expect(w.enemies).toHaveLength(0);
    expect(w.core.hp).toBeCloseTo(10 + e.maxHp * 0.5, 9);
    const s = setup({ lifesteal: 1, damage: 1000, regen: 0 });
    s.w.core.hp = worldStats(s.w, s.data).health - 1;
    spawnEnemy(s.w, s.data, 'tank', 100, 0, []);
    stepN(s.w, s.data, 10);
    expect(s.w.core.hp).toBe(worldStats(s.w, s.data).health);
  });
});

describe('knockback', () => {
  it('pushes a surviving hit enemy outward by knockback × its kind multiplier', () => {
    for (const kind of ['basic', 'tank', 'boss'] as const) {
      const { data, w } = setup({ knockback: 10, damage: 0.001 });
      const e = spawnEnemy(w, data, kind, 150, 0, []);
      let push = Number.NaN;
      for (let i = 0; i < 60 && Number.isNaN(push); i++) {
        const before = dist(e);
        const ev = stepN(w, data, 1);
        // The hit tick moves the enemy inward by its speed, then the hit pushes it out.
        if (ofType(ev, 'hit').length > 0) push = dist(e) - (before - e.speed / data.config.tickHz);
      }
      expect(push, kind).toBeCloseTo(10 * data.enemies[kind].knockback, 6);
    }
  });

  it('never pushes past the spawn ring, and an enemy at the exact centre gets a defined direction', () => {
    const data = testData();
    const w = createWorld(data, { seed: 1, tier: 1, protocols: false });
    const e = spawnEnemy(w, data, 'basic', data.config.spawnRadius - 3, 0, []);
    knockBack(e, data, 50);
    expect(dist(e)).toBeCloseTo(data.config.spawnRadius, 9);
    const c = spawnEnemy(w, data, 'basic', 0, 0, []);
    knockBack(c, data, 7);
    expect(Number.isFinite(c.x) && Number.isFinite(c.y)).toBe(true);
    expect(dist(c)).toBeCloseTo(7, 6);
    const [dx, dy] = data.directions[0]!;
    expect([c.x / 7, c.y / 7]).toEqual([expect.closeTo(dx, 9), expect.closeTo(dy, 9)]);
  });
});

describe('economy', () => {
  it('Energy Bonus and Bits/Kill raise the kill reward by their %', () => {
    const { data, w } = setup({ energyBonus: 0.5, bitsPerKill: 1, damage: 1000 });
    spawnEnemy(w, data, 'basic', 100, 0, []);
    const k = ofType(stepN(w, data, 10), 'kill')[0]!;
    expect(k.energy).toBeCloseTo(data.enemies.basic.energy * 1.5, 12);
    expect(k.bits).toBeCloseTo(data.enemies.basic.bits * data.tiers[0]!.bitsMul * 2, 12);
    expect(w.energy).toBe(k.energy);
  });

  function toWaveEnd(bases: StatBases, energy: number) {
    const data = testData(QUIET, bases);
    const w = createWorld(data, { seed: 1, tier: 1, protocols: false });
    stepN(w, data, 2);
    w.energy = energy;
    const ev: SimEvent[] = stepN(w, data, data.config.waveSeconds * data.config.tickHz);
    return { data, w, reward: ofType(ev, 'waveReward')[0]! };
  }

  it('Energy/Wave and Bits/Wave pay flat at the wave end', () => {
    const { w, reward } = toWaveEnd({ energyPerWave: 7, bitsPerWave: 3 }, 100);
    expect(reward).toEqual({ type: 'waveReward', wave: 1, energy: 7, interest: 0, bits: 3 });
    expect(w.energy).toBe(107);
    expect(w.bits).toBe(3);
  });

  it('Interest pays a % of unspent Energy at the wave end', () => {
    const { w, reward } = toWaveEnd({ interest: 0.1 }, 100);
    expect(reward.interest).toBeCloseTo(10, 12);
    expect(w.energy).toBeCloseTo(110, 12);
  });

  it('Interest is capped by data (interestCap × growth^(wave−1))', () => {
    const { data, w, reward } = toWaveEnd({ interest: 0.5 }, 1e6);
    expect(reward.interest).toBe(data.stats.economy.interestCap);
    expect(w.energy).toBe(1e6 + data.stats.economy.interestCap);
  });

  it('the Interest cap grows with the wave and with interestCap modifiers', () => {
    const data = testData(QUIET, { interest: 0.5 });
    const w = createWorld(data, { seed: 1, tier: 1, protocols: false });
    w.mods.push({ stat: 'interestCap', op: 'mul', value: 2, source: 'test' });
    stepN(w, data, 2);
    w.wave = 5;
    w.energy = 1e9;
    const ev = stepN(w, data, data.config.waveSeconds * data.config.tickHz);
    const r = ofType(ev, 'waveReward')[0]!;
    const e = data.stats.economy;
    expect(r.interest).toBeCloseTo(e.interestCap * 2 * Math.pow(e.interestCapGrowth, 4), 9);
  });
});

describe('attack speed', () => {
  it('fires several volleys in one tick when faster than the tick rate', () => {
    const { data, w } = setup({ attackSpeed: 90, damage: 0.0001 });
    spawnEnemy(w, data, 'boss', 200, 0, []);
    const shots = ofType(stepN(w, data, 30), 'shot');
    expect(shots.length).toBeGreaterThanOrEqual(88);
    expect(shots.length).toBeLessThanOrEqual(91);
  });

  it('banks no shots while nothing is in range', () => {
    const { data, w } = setup({ attackSpeed: 5 });
    stepN(w, data, 300);
    spawnEnemy(w, data, 'boss', 200, 0, []);
    expect(ofType(stepN(w, data, 1), 'shot')).toHaveLength(1);
  });
});

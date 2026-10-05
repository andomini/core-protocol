// Sim support for M4 meta: lab parameters in RunOptions, tier conditions, and the rewarded revive.
import { describe, expect, it } from 'vitest';
import { applyCommands, quoteFor } from '../src/sim/commands';
import { isPickWave } from '../src/sim/perks';
import { restore, snapshot } from '../src/sim/snapshot';
import { createWorld, worldStats } from '../src/sim/state';
import { step } from '../src/sim/step';
import { isBossWave, spawnEnemy } from '../src/sim/waves';
import { ofType, stepN, testData } from './helpers';

describe('lab parameters (RunOptions)', () => {
  it('pickEvery shortens the pick cadence after the listed waves', () => {
    const d = testData();
    expect(isPickWave(d, 15)).toBe(true);
    expect(isPickWave(d, 14)).toBe(false);
    expect(isPickWave(d, 14, 4)).toBe(true);
    expect(isPickWave(d, 18, 4)).toBe(true);
    expect(isPickWave(d, 15, 4)).toBe(false);
    const w = createWorld(d, { seed: 1, tier: 1, pickEvery: 4 });
    expect(w.lab.pickEvery).toBe(4);
  });

  it('rareMul scales the Rare and Epic weights of offers', () => {
    const d = testData();
    let rare0 = 0;
    let rare1 = 0;
    for (let seed = 1; seed <= 300; seed++) {
      const a = createWorld(d, { seed, tier: 1 });
      const b = createWorld(d, { seed, tier: 1, rareMul: 2 });
      rare0 += a.offer.filter((id) => d.perks.perks[id]!.rarity !== 'common').length;
      rare1 += b.offer.filter((id) => d.perks.perks[id]!.rarity !== 'common').length;
    }
    expect(rare1).toBeGreaterThan(rare0 * 1.4);
  });

  it('maxLevelBonus raises a stat cap for this run', () => {
    const d = testData();
    const cap = d.stats.stats.attackSpeed.maxLevel!;
    const w = createWorld(d, { seed: 1, tier: 1, protocols: false, maxLevelBonus: { attackSpeed: 10 } });
    w.levels.attackSpeed = cap;
    w.energy = 1e30;
    expect(quoteFor(w, d, 'attackSpeed', 1).levels).toBe(1);
    const plain = createWorld(d, { seed: 1, tier: 1, protocols: false });
    plain.levels.attackSpeed = cap;
    plain.energy = 1e30;
    expect(quoteFor(plain, d, 'attackSpeed', 1).levels).toBe(0);
  });

  it('startEnergy is granted at run start', () => {
    const w = createWorld(testData(), { seed: 1, tier: 1, startEnergy: 40 });
    expect(w.energy).toBe(40);
  });
});

describe('tier conditions', () => {
  const tiered = () =>
    testData({ config: { baseEnemiesPerWave: 0, enemiesPerWaveGrowth: 0 } }, { health: 1e9, damage: 0 });

  it('enemyRegen heals damaged viruses per second', () => {
    const d = tiered();
    d.tiers[0]!.enemyRegen = 0.1;
    const w = createWorld(d, { seed: 1, tier: 1, protocols: false });
    step(w, d, [], []);
    const e = spawnEnemy(w, d, 'basic', 300, 0, []);
    e.speed = 0;
    e.hp = e.maxHp / 2;
    stepN(w, d, d.config.tickHz);
    expect(e.hp).toBeCloseTo(e.maxHp * 0.6, 6);
    stepN(w, d, d.config.tickHz * 10);
    expect(e.hp).toBe(e.maxHp);
  });

  it('bossEvery overrides the boss cadence; speedMul and rangedRateMul shape spawns', () => {
    const d = tiered();
    d.tiers[1]!.bossEvery = 5;
    d.tiers[1]!.speedMul = 1.25;
    d.tiers[1]!.rangedRateMul = 2;
    expect(isBossWave(d, 5, 2)).toBe(true);
    expect(isBossWave(d, 5, 1)).toBe(false);
    const w = createWorld(d, { seed: 1, tier: 2, protocols: false });
    step(w, d, [], []);
    const r = spawnEnemy(w, d, 'ranged', 300, 0, []);
    expect(r.speed).toBeCloseTo(d.enemies.ranged.speed * 1.25, 9);
    expect(r.attackIntervalTicks).toBeCloseTo((d.enemies.ranged.attackInterval * d.config.tickHz) / 2, 9);
  });
});

describe('revive', () => {
  function deadWorld() {
    const d = testData({ config: { baseEnemiesPerWave: 0, enemiesPerWaveGrowth: 0 } }, { health: 50, regen: 0 });
    const w = createWorld(d, { seed: 1, tier: 1, protocols: false });
    step(w, d, [], []);
    w.bits = 100;
    const e = spawnEnemy(w, d, 'tank', d.core.radius + d.enemies.tank.radius, 0, []);
    e.damage = 1000;
    const far = spawnEnemy(w, d, 'ranged', 360, 0, []);
    far.speed = 0;
    stepN(w, d, 2);
    expect(w.dead).toBe(true);
    return { d, w, far };
  }

  it('revives once: half HP, nearby viruses purged, the world ticks again', () => {
    const { d, w, far } = deadWorld();
    const ev: never[] = [];
    applyCommands(w, d, [{ type: 'revive' }], ev);
    expect(w.dead).toBe(false);
    expect(w.revived).toBe(true);
    expect(w.core.hp).toBeCloseTo(worldStats(w, d).health * d.config.reviveHp, 9);
    expect(w.enemies.map((e) => e.id)).toEqual([far.id]);
    const t = w.tick;
    stepN(w, d, 3);
    expect(w.tick).toBe(t + 3);
    // A second revive in the same run is refused.
    w.dead = true;
    const ev2: { type: string }[] = [];
    applyCommands(w, d, [{ type: 'revive' }], ev2 as never);
    expect(w.dead).toBe(true);
    expect(ev2.some((e) => e.type === 'commandRejected')).toBe(true);
  });

  it('the run-end Bits bonus is not paid twice across a revive', () => {
    const { d, w } = deadWorld();
    w.bitsBonus = 25;
    w.bits = 125;
    applyCommands(w, d, [{ type: 'revive' }], []);
    expect(w.bits).toBe(100);
    expect(w.bitsBonus).toBe(0);
  });

  it('a revive is refused while alive', () => {
    const d = testData();
    const w = createWorld(d, { seed: 1, tier: 1 });
    const ev = stepN(w, d, 0);
    applyCommands(w, d, [{ type: 'revive' }], ev);
    expect(ofType(ev, 'commandRejected')).toHaveLength(1);
  });

  it('the World round-trips through a snapshot with the lab fields', () => {
    const d = testData();
    const w = createWorld(d, { seed: 3, tier: 1, pickEvery: 4, rareMul: 1.5, maxLevelBonus: { range: 10 }, startEnergy: 10 });
    expect(w.v).toBe(5);
    expect(JSON.stringify(restore(snapshot(w)))).toBe(JSON.stringify(w));
  });
});

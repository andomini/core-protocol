import { describe, expect, it } from 'vitest';
import { nearestInRange } from '../src/sim/core';
import type { CoreDef } from '../src/sim/data';
import { createWorld } from '../src/sim/state';
import { spawnEnemy } from '../src/sim/waves';
import { ofType, stepN, testData } from './helpers';

function setup(core: Partial<CoreDef> = {}) {
  const data = testData({ config: { baseEnemiesPerWave: 0, enemiesPerWaveGrowth: 0 }, core });
  const w = createWorld(data, { seed: 1, tier: 1 });
  stepN(w, data, 1); // start wave 1
  return { data, w };
}

describe('combat', () => {
  it('the core kills an enemy in range and earns its energy and bits once', () => {
    const { data, w } = setup();
    spawnEnemy(w, data, 'basic', 100, 0, []);
    const events = stepN(w, data, 120);
    expect(ofType(events, 'kill')).toHaveLength(1);
    expect(w.kills).toBe(1);
    expect(w.energy).toBe(data.enemies.basic.energy);
    expect(w.bits).toBe(data.enemies.basic.bits * data.tiers[0]!.bitsMul);
    expect(w.enemies).toHaveLength(0);
    expect(w.projectiles).toHaveLength(0);
  });

  it('does not shoot at enemies outside its range', () => {
    const { data, w } = setup({ range: 100 });
    spawnEnemy(w, data, 'basic', 400, 0, []);
    expect(ofType(stepN(w, data, 10), 'shot')).toHaveLength(0);
  });

  it('targets the nearest enemy in range, ties broken by the lowest id', () => {
    const { data, w } = setup();
    spawnEnemy(w, data, 'basic', 400, 0, []); // out of range 300
    spawnEnemy(w, data, 'basic', 200, 0, []);
    const c = spawnEnemy(w, data, 'basic', 0, 150, []);
    expect(nearestInRange(w.enemies, data.core.range)?.id).toBe(c.id);
    const d = spawnEnemy(w, data, 'basic', 100, 0, []);
    spawnEnemy(w, data, 'basic', 0, 100, []);
    expect(nearestInRange(w.enemies, data.core.range)?.id).toBe(d.id);
  });

  it('two lethal projectiles on one target pay out once', () => {
    const { data, w } = setup({ attackSpeed: 30, damage: 1000 }); // a shot every tick
    spawnEnemy(w, data, 'basic', 250, 0, []);
    const events = stepN(w, data, 20);
    expect(ofType(events, 'shot').length).toBeGreaterThan(1);
    expect(ofType(events, 'hit')).toHaveLength(1);
    expect(ofType(events, 'kill')).toHaveLength(1);
    expect(w.energy).toBe(data.enemies.basic.energy);
  });

  it('regenerates HP up to the maximum', () => {
    const { data, w } = setup({ regen: 3 });
    w.core.hp = 50;
    stepN(w, data, data.config.tickHz);
    expect(w.core.hp).toBeCloseTo(53, 9);
    w.core.hp = w.core.maxHp - 0.01;
    stepN(w, data, data.config.tickHz);
    expect(w.core.hp).toBe(w.core.maxHp);
  });

  it('a run with default data ends in death within an hour of sim time', () => {
    const data = testData();
    const w = createWorld(data, { seed: 11, tier: 1 });
    const events = stepN(w, data, 60 * 60 * data.config.tickHz);
    expect(w.dead).toBe(true);
    expect(ofType(events, 'death')).toHaveLength(1);
    expect(w.wave).toBeGreaterThanOrEqual(2);
  });
});

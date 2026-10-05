import { describe, expect, it } from 'vitest';
import { createWorld } from '../src/sim/state';
import { spawnEnemy } from '../src/sim/waves';
import { ofType, type StatBases, stepN, testData } from './helpers';

// No random spawns, a harmless core without regen: only the enemies the test places.
const quiet = (core: StatBases = {}) =>
  testData({ config: { baseEnemiesPerWave: 0, enemiesPerWaveGrowth: 0 } }, { damage: 0, regen: 0, ...core });

function setup(core: StatBases = {}) {
  const data = quiet(core);
  const w = createWorld(data, { seed: 1, tier: 1, protocols: false });
  stepN(w, data, 1); // start wave 1
  return { data, w };
}

describe('enemies', () => {
  it('a melee enemy stops at the core edge and hits at its attack interval', () => {
    const { data, w } = setup();
    const stopAt = data.core.radius + data.enemies.basic.radius;
    const e = spawnEnemy(w, data, 'basic', stopAt + 3, 0, []); // 2 ticks of travel at 1.5 px/tick
    expect(ofType(stepN(w, data, 3), 'coreHit')).toHaveLength(1);
    expect(e.x).toBeCloseTo(stopAt, 6);
    expect(w.core.hp).toBe(data.stats.stats.health.base - e.damage);
    expect(ofType(stepN(w, data, e.attackIntervalTicks - 2), 'coreHit')).toHaveLength(0);
    expect(ofType(stepN(w, data, 1), 'coreHit')).toHaveLength(1);
  });

  it('a ranged enemy stops at its standoff and shoots from there', () => {
    const { data, w } = setup();
    const standoff = data.enemies.ranged.standoff;
    const e = spawnEnemy(w, data, 'ranged', standoff + 2, 0, []);
    const hits = ofType(stepN(w, data, 3), 'coreHit');
    expect(hits).toEqual([{ type: 'coreHit', enemyId: e.id, damage: e.damage, ranged: true, blocked: false }]);
    expect(e.x).toBeCloseTo(standoff, 6);
  });

  it('the core dies once and the world then freezes', () => {
    const { data, w } = setup({ health: 1 });
    spawnEnemy(w, data, 'basic', data.core.radius + data.enemies.basic.radius, 0, []);
    const events = stepN(w, data, 1);
    expect(ofType(events, 'death')).toEqual([{ type: 'death', wave: 1, tick: w.tick, bonusBits: 0 }]);
    expect(w.dead).toBe(true);
    expect(w.core.hp).toBe(0);
    const tick = w.tick;
    expect(stepN(w, data, 10)).toEqual([]);
    expect(w.tick).toBe(tick);
  });

  it('an enemy at the exact center produces no NaN', () => {
    const { data, w } = setup();
    const e = spawnEnemy(w, data, 'basic', 0, 0, []);
    const hits = ofType(stepN(w, data, 3), 'coreHit');
    expect(hits.length).toBeGreaterThan(0);
    expect(Number.isFinite(e.x) && Number.isFinite(e.y)).toBe(true);
    expect(Number.isFinite(w.core.hp)).toBe(true);
  });
});

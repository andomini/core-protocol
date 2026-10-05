import { describe, expect, it } from 'vitest';
import { DEFAULT_DATA } from '../src/sim/data';
import { MAX_VALUE } from '../src/sim/num';
import { createWorld } from '../src/sim/state';
import { enemiesPerWave, scaleForWave } from '../src/sim/waves';
import { ofType, stepN, testData } from './helpers';

// A core that cannot die, so long runs stay alive regardless of later combat tasks.
const tough = () => testData({}, { health: 1e9 });

describe('waves', () => {
  it('the first tick starts wave 1 (no boss)', () => {
    const data = tough();
    const w = createWorld(data, { seed: 1, tier: 1, protocols: false });
    expect(ofType(stepN(w, data, 1), 'waveStart')).toEqual([{ type: 'waveStart', wave: 1, boss: false }]);
  });

  it('wave 1 ends on tick 780 and wave 2 starts on tick 901', () => {
    const data = tough();
    const w = createWorld(data, { seed: 1, tier: 1, protocols: false });
    const first = stepN(w, data, 900);
    expect(ofType(first, 'waveEnd')).toEqual([{ type: 'waveEnd', wave: 1 }]);
    expect(ofType(first, 'waveStart').map((e) => e.wave)).toEqual([1]);
    expect(ofType(stepN(w, data, 1), 'waveStart').map((e) => e.wave)).toEqual([2]);
  });

  it('wave 1 spawns enemiesPerWave(1) basic enemies on the spawn circle', () => {
    const data = tough();
    const w = createWorld(data, { seed: 3, tier: 1, protocols: false });
    const spawns = ofType(stepN(w, data, 780), 'spawn');
    expect(spawns).toHaveLength(enemiesPerWave(data, 1));
    for (const s of spawns) {
      expect(s.kind).toBe('basic');
      expect(Math.sqrt(s.x * s.x + s.y * s.y)).toBeCloseTo(data.config.spawnRadius, 6);
    }
  });

  it('every 10th wave starts with a boss and kinds respect firstWave', () => {
    const data = tough();
    const w = createWorld(data, { seed: 5, tier: 1, protocols: false });
    const events = stepN(w, data, 1 + 9 * 900);
    const starts = ofType(events, 'waveStart');
    expect(starts.at(-1)).toEqual({ type: 'waveStart', wave: 10, boss: true });
    expect(starts.filter((s) => s.boss).map((s) => s.wave)).toEqual([10]);

    let wave = 0;
    let bossSpawns = 0;
    for (const e of events) {
      if (e.type === 'waveStart') wave = e.wave;
      if (e.type === 'spawn') {
        if (e.kind === 'boss') bossSpawns++;
        else expect(data.enemies[e.kind].firstWave).toBeLessThanOrEqual(wave);
      }
    }
    expect(bossSpawns).toBe(1);
  });

  it('enemiesPerWave grows and respects the cap', () => {
    const data = testData({ config: { maxEnemiesPerWave: 10 } });
    expect(enemiesPerWave(data, 1)).toBe(7);
    expect(enemiesPerWave(data, 2)).toBe(9);
    expect(enemiesPerWave(data, 3)).toBe(10);
    expect(enemiesPerWave(data, 100)).toBe(10);
  });

  it('enemy scaling stays finite at wave 10 000 on the last tier', () => {
    const t = DEFAULT_DATA.tiers.at(-1)!;
    const hp = scaleForWave(DEFAULT_DATA.enemies.boss.hp, t.hpMul, t.hpGrowth, 10_000);
    expect(Number.isFinite(hp)).toBe(true);
    expect(hp).toBeLessThanOrEqual(MAX_VALUE);
    expect(hp).toBeGreaterThan(1e100);
    expect(scaleForWave(1, 1, 2, 5000)).toBe(MAX_VALUE);
  });

  it('rejects an out-of-range tier', () => {
    expect(() => createWorld(DEFAULT_DATA, { seed: 1, tier: 0 })).toThrow(/tier/);
    expect(() => createWorld(DEFAULT_DATA, { seed: 1, tier: 7 })).toThrow(/tier/);
  });
});

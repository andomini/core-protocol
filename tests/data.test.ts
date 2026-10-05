import { describe, expect, it } from 'vitest';
import { DEFAULT_DATA, ENEMY_KINDS, validateData } from '../src/sim/data';
import { testData } from './helpers';

describe('game data', () => {
  it('default data is valid and complete', () => {
    expect(() => validateData(structuredClone(DEFAULT_DATA))).not.toThrow();
    for (const k of ENEMY_KINDS) expect(DEFAULT_DATA.enemies[k]).toBeDefined();
    expect(DEFAULT_DATA.tiers).toHaveLength(6);
  });

  it('has 64 unit direction vectors', () => {
    expect(DEFAULT_DATA.directions).toHaveLength(64);
    for (const [x, y] of DEFAULT_DATA.directions) expect(Math.abs(x * x + y * y - 1)).toBeLessThan(1e-9);
  });

  it('wave and pause lengths are whole ticks', () => {
    const c = DEFAULT_DATA.config;
    expect(c.waveSeconds * c.tickHz).toBe(780);
    expect(c.pauseSeconds * c.tickHz).toBe(120);
  });

  it('rejects a NaN enemy stat and names it', () => {
    expect(() => testData({ enemies: { basic: { hp: NaN } } })).toThrow(/enemies\.basic\.hp/);
  });

  it('rejects a zero attack speed (would divide by zero)', () => {
    expect(() => testData({}, { attackSpeed: 0 })).toThrow(/stats\.attackSpeed\.base/);
  });

  it('rejects a negative knockback multiplier', () => {
    expect(() => testData({ enemies: { tank: { knockback: -1 } } })).toThrow(/enemies\.tank\.knockback/);
  });

  it('rejects empty tiers', () => {
    expect(() => validateData({ ...structuredClone(DEFAULT_DATA), tiers: [] })).toThrow(/tiers/);
  });

  it('rejects a basic enemy that cannot spawn on wave 1', () => {
    expect(() => testData({ enemies: { basic: { firstWave: 2 } } })).toThrow(/basic/);
  });
});

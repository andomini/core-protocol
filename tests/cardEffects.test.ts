// Cards (M5) reach the sim as resolved effects in RunOptions.cards; new mechanics for card effects.
import { describe, expect, it } from 'vitest';
import type { Effect } from '../src/sim/perkData';
import { perkProfile } from '../src/sim/perks';
import { restore, snapshot } from '../src/sim/snapshot';
import { createWorld, type RunOptions, worldStats } from '../src/sim/state';
import { combatStats, step } from '../src/sim/step';
import { spawnEnemy } from '../src/sim/waves';
import { ofType, stepN, testData } from './helpers';

const quiet = () => testData({ config: { baseEnemiesPerWave: 0, enemiesPerWaveGrowth: 0 } }, { health: 1000, regen: 0 });
const card = (id: string, ...effects: Effect[]) => ({ id, effects });

function world(cards: RunOptions['cards'], d = quiet()) {
  const w = createWorld(d, { seed: 1, tier: 1, protocols: false, cards });
  step(w, d, [], []);
  return { d, w };
}

describe('card effects', () => {
  it('stat effects become modifiers once (source card:<id>)', () => {
    const { d, w } = world([card('damage', { type: 'statMul', stat: 'damage', value: 1.2 })]);
    const base = worldStats(createWorld(d, { seed: 1, tier: 1, protocols: false }), d).damage;
    expect(worldStats(w, d).damage).toBeCloseTo(base * 1.2, 9);
    expect(w.mods.filter((m) => m.source === 'card:damage')).toHaveLength(1);
    expect(w.cards.map((c) => c.id)).toEqual(['damage']);
  });

  it('Overclock (periodic damageBoost): ×3 damage for its window, then back', () => {
    const { d, w } = world([card('overclock', { type: 'periodic', action: 'damageBoost', everySec: 2, seconds: 1, value: 3 })]);
    const e = spawnEnemy(w, d, 'tank', 250, 0, []);
    e.speed = 0;
    e.hp = e.maxHp = 1e12;
    const base = worldStats(w, d).damage;
    stepN(w, d, 2 * d.config.tickHz + 1);
    expect(combatStats(w, d, perkProfile(w, d)).damage).toBeCloseTo(base * 3, 9);
    stepN(w, d, d.config.tickHz + 2);
    expect(combatStats(w, d, perkProfile(w, d)).damage).toBeCloseTo(base, 9);
  });

  it('Tesla Coil (periodic tesla): a bolt from the core hits the nearest enemy in range', () => {
    const { d, w } = world([card('tesla', { type: 'periodic', action: 'tesla', everySec: 1, seconds: 1, value: 2 })]);
    w.core.fireCd = 1e9; // no regular shots
    const e = spawnEnemy(w, d, 'tank', 200, 0, []);
    e.speed = 0;
    e.hp = e.maxHp = 1e6;
    const ev = stepN(w, d, d.config.tickHz + 1);
    const bolts = ofType(ev, 'lightning').filter((x) => x.fromId === 0);
    expect(bolts.length).toBe(1);
    expect(bolts[0]!.targets).toEqual([e.id]);
    const hit = ofType(ev, 'hit').find((h) => h.source === 'tesla');
    expect(hit!.damage).toBeCloseTo(worldStats(w, d).damage * 2, 9);
  });

  it('Barrier (shield): a share of max HP at each wave start absorbs core damage first', () => {
    const { d, w } = world([card('barrier', { type: 'shield', frac: 0.2 })]);
    expect(w.shield).toBeCloseTo(worldStats(w, d).health * 0.2, 9);
    const e = spawnEnemy(w, d, 'basic', d.core.radius + d.enemies.basic.radius, 0, []);
    e.damage = 50;
    const hp0 = w.core.hp;
    stepN(w, d, 1);
    expect(w.core.hp).toBe(hp0);
    expect(w.shield).toBeCloseTo(worldStats(w, d).health * 0.2 - 50, 9);
  });

  it('Kernel Panic (conditional coreHpBelow): ×2 damage below 10 % HP', () => {
    const { d, w } = world([card('panic', { type: 'conditional', when: 'coreHpBelow', frac: 0.1, damageMul: 2 })]);
    const base = worldStats(w, d).damage;
    expect(combatStats(w, d, perkProfile(w, d)).damage).toBeCloseTo(base, 9);
    w.core.hp = worldStats(w, d).health * 0.05;
    expect(combatStats(w, d, perkProfile(w, d)).damage).toBeCloseTo(base * 2, 9);
  });

  it('Time Dilation (rule enemySpeed): viruses move slower', () => {
    const { d, w } = world([card('dilation', { type: 'ruleChange', rule: 'enemySpeed', op: 'mul', value: 0.5 })]);
    const e = spawnEnemy(w, d, 'basic', 300, 0, []);
    stepN(w, d, 1);
    expect(300 - e.x).toBeCloseTo((d.enemies.basic.speed * 0.5) / d.config.tickHz, 9);
  });

  it('Wave Skip: a skipped wave spawns nothing and pays its rewards; boss waves are never skipped', () => {
    const d = testData({}, { health: 1e9 });
    const w = createWorld(d, { seed: 1, tier: 1, protocols: false, cards: [card('skip', { type: 'waveSkip', chance: 1 })] });
    const ev = stepN(w, d, 1 + 9 * 900 + 5);
    const skips = ofType(ev, 'waveSkip');
    expect(skips.map((s) => s.wave)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(skips[0]!.energy).toBeGreaterThan(0);
    let wave = 0;
    let earlySpawns = 0;
    for (const e of ev) {
      if (e.type === 'waveStart') wave = e.wave;
      if (e.type === 'spawn' && wave < 10) earlySpawns++;
    }
    expect(earlySpawns).toBe(0);
    expect(ofType(ev, 'spawn').filter((s) => s.kind === 'boss')).toHaveLength(1);
    expect(w.energy).toBeGreaterThan(0);
  });

  it('cards and the shield survive a snapshot (World v5)', () => {
    const { w } = world([card('barrier', { type: 'shield', frac: 0.2 }), card('damage', { type: 'statMul', stat: 'damage', value: 1.2 })]);
    expect(w.v).toBe(5);
    expect(JSON.stringify(restore(snapshot(w)))).toBe(JSON.stringify(w));
  });
});

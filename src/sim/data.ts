import configJson from '../data/config.json';
import coreJson from '../data/core.json';
import directionsJson from '../data/directions.json';
import enemiesJson from '../data/enemies.json';
import tiersJson from '../data/tiers.json';

export type EnemyKind = 'basic' | 'fast' | 'tank' | 'ranged' | 'boss';
export const ENEMY_KINDS: readonly EnemyKind[] = ['basic', 'fast', 'tank', 'ranged', 'boss'];

export interface EnemyDef {
  /** Base HP at wave 1 on tier 1. */
  hp: number;
  /** Base damage per attack. */
  damage: number;
  /** World px per second. */
  speed: number;
  radius: number;
  /** Seconds between attacks. */
  attackInterval: number;
  /** 0 = melee (stops at the core edge); > 0 = stops at this distance from the center and shoots. */
  standoff: number;
  /** Base Energy per kill. */
  energy: number;
  /** Base Bits per kill. */
  bits: number;
  /** First wave it can appear in as a regular spawn. */
  firstWave: number;
  /** Relative integer spawn weight among unlocked regular kinds; 0 = never a regular spawn. */
  weight: number;
}

export interface TierDef {
  hpMul: number;
  damageMul: number;
  bitsMul: number;
  /** Per-wave HP multiplier: HP = base × hpMul × hpGrowth^(wave−1). */
  hpGrowth: number;
  damageGrowth: number;
}

export interface CoreDef {
  radius: number;
  health: number;
  /** HP per second. */
  regen: number;
  damage: number;
  /** Shots per second. */
  attackSpeed: number;
  range: number;
  /** World px per second. */
  projectileSpeed: number;
}

export interface SimConfig {
  tickHz: number;
  waveSeconds: number;
  pauseSeconds: number;
  bossEvery: number;
  spawnRadius: number;
  baseEnemiesPerWave: number;
  enemiesPerWaveGrowth: number;
  maxEnemiesPerWave: number;
  /** Per-wave Energy reward multiplier. */
  energyGrowth: number;
  /** Per-wave Bits reward multiplier. */
  bitsGrowth: number;
}

export interface GameData {
  config: SimConfig;
  core: CoreDef;
  enemies: Record<EnemyKind, EnemyDef>;
  tiers: TierDef[];
  /** 64 unit vectors around the circle (see tools/gen-directions.ts). */
  directions: [number, number][];
}

function check(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`data: ${msg}`);
}
function nonNeg(x: number, where: string): void {
  check(Number.isFinite(x) && x >= 0, `${where} must be a finite number ≥ 0, got ${x}`);
}
function positive(x: number, where: string): void {
  check(Number.isFinite(x) && x > 0, `${where} must be a finite number > 0, got ${x}`);
}
function wholeNonNeg(x: number, where: string): void {
  check(Number.isInteger(x) && x >= 0, `${where} must be a whole number ≥ 0, got ${x}`);
}

/** Throws `Error('data: …')` naming the first bad field; returns `d` unchanged when valid. */
export function validateData(d: GameData): GameData {
  const c = d.config;
  check(Number.isInteger(c.tickHz) && c.tickHz > 0, `config.tickHz must be a positive integer, got ${c.tickHz}`);
  positive(c.waveSeconds, 'config.waveSeconds');
  nonNeg(c.pauseSeconds, 'config.pauseSeconds');
  check(
    Number.isInteger(c.waveSeconds * c.tickHz) && Number.isInteger(c.pauseSeconds * c.tickHz),
    'config.waveSeconds/pauseSeconds × tickHz must be whole ticks',
  );
  check(Number.isInteger(c.bossEvery) && c.bossEvery > 0, `config.bossEvery must be a positive integer, got ${c.bossEvery}`);
  positive(c.spawnRadius, 'config.spawnRadius');
  nonNeg(c.baseEnemiesPerWave, 'config.baseEnemiesPerWave');
  nonNeg(c.enemiesPerWaveGrowth, 'config.enemiesPerWaveGrowth');
  wholeNonNeg(c.maxEnemiesPerWave, 'config.maxEnemiesPerWave');
  positive(c.energyGrowth, 'config.energyGrowth');
  positive(c.bitsGrowth, 'config.bitsGrowth');

  const k = d.core;
  positive(k.radius, 'core.radius');
  positive(k.health, 'core.health');
  nonNeg(k.regen, 'core.regen');
  nonNeg(k.damage, 'core.damage');
  positive(k.attackSpeed, 'core.attackSpeed');
  positive(k.range, 'core.range');
  positive(k.projectileSpeed, 'core.projectileSpeed');

  for (const kind of ENEMY_KINDS) {
    const e = d.enemies[kind];
    check(e !== undefined, `enemies.${kind} is missing`);
    const at = `enemies.${kind}`;
    positive(e.hp, `${at}.hp`);
    nonNeg(e.damage, `${at}.damage`);
    positive(e.speed, `${at}.speed`);
    positive(e.radius, `${at}.radius`);
    positive(e.attackInterval, `${at}.attackInterval`);
    nonNeg(e.standoff, `${at}.standoff`);
    nonNeg(e.energy, `${at}.energy`);
    nonNeg(e.bits, `${at}.bits`);
    check(Number.isInteger(e.firstWave) && e.firstWave >= 1, `${at}.firstWave must be a whole number ≥ 1`);
    wholeNonNeg(e.weight, `${at}.weight`);
  }
  check(
    d.enemies.basic.firstWave === 1 && d.enemies.basic.weight > 0,
    'enemies.basic must be spawnable from wave 1 (firstWave 1, weight > 0)',
  );

  check(d.tiers.length > 0, 'tiers must not be empty');
  d.tiers.forEach((t, i) => {
    positive(t.hpMul, `tiers[${i}].hpMul`);
    positive(t.damageMul, `tiers[${i}].damageMul`);
    positive(t.bitsMul, `tiers[${i}].bitsMul`);
    positive(t.hpGrowth, `tiers[${i}].hpGrowth`);
    positive(t.damageGrowth, `tiers[${i}].damageGrowth`);
  });

  check(d.directions.length === 64, `directions must have 64 entries, got ${d.directions.length}`);
  d.directions.forEach(([x, y], i) => {
    check(Number.isFinite(x) && Number.isFinite(y) && Math.abs(x * x + y * y - 1) < 1e-9, `directions[${i}] must be a unit vector`);
  });
  return d;
}

export const DEFAULT_DATA: GameData = validateData({
  config: configJson as SimConfig,
  core: coreJson as CoreDef,
  enemies: enemiesJson as Record<EnemyKind, EnemyDef>,
  tiers: tiersJson as TierDef[],
  directions: directionsJson as [number, number][],
});

import configJson from '../data/config.json';
import coreJson from '../data/core.json';
import directionsJson from '../data/directions.json';
import enemiesJson from '../data/enemies.json';
import perksJson from '../data/perks.json';
import setsJson from '../data/sets.json';
import statsJson from '../data/stats.json';
import { type PerksData, type SetsData, validatePerks, validateSets } from './perkData';
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
  /** Multiplier on the core's Knockback distance (heavy enemies resist). */
  knockback: number;
  /** 🔑 Keys dropped on death (the boss). */
  keys: number;
}

export interface TierDef {
  hpMul: number;
  damageMul: number;
  bitsMul: number;
  /** Per-wave HP multiplier: HP = base × hpMul × hpGrowth^(wave−1). */
  hpGrowth: number;
  damageGrowth: number;
  /** Tier condition (spec §3.2): viruses regenerate this share of max HP per second. */
  enemyRegen?: number;
  /** Tier condition: a boss every N waves instead of config.bossEvery ("Swarm"). */
  bossEvery?: number;
  /** Tier condition: ranged viruses attack this many times as often. */
  rangedRateMul?: number;
  /** Tier condition: every virus moves this much faster. */
  speedMul?: number;
  /** Short condition label for the tier picker ('' = none). */
  condition?: string;
}

/** Fixed core geometry; every upgradable core value lives in `stats.json`. */
export interface CoreDef {
  radius: number;
  /** World px per second. */
  projectileSpeed: number;
}

export { STAT_IDS, type StatId } from './statIds';
import { STAT_IDS, type StatId } from './statIds';
export type TabId = 'atk' | 'def' | 'util';
export const TAB_IDS: readonly TabId[] = ['atk', 'def', 'util'];
export type StatFormat = 'num' | 'int' | 'pct' | 'mult' | 'perSec' | 'plus';
const STAT_FORMATS: readonly StatFormat[] = ['num', 'int', 'pct', 'mult', 'perSec', 'plus'];

export interface StatDef {
  tab: TabId;
  name: string;
  /** Value at level 0. */
  base: number;
  /** Per-level effect: 'add' → base + per·L; 'mul' → base·per^L. */
  per: number;
  mode: 'add' | 'mul';
  /** Highest in-run level (labs raise it in M4); absent = unlimited. */
  maxLevel?: number;
  /** Upper bound on the effective value (after modifiers). */
  cap?: number;
  /** Price of the next level from level L: base × growth^L. */
  cost: { base: number; growth: number };
  format: StatFormat;
  /** Locked until a lab node unlocks it (M4); RunOptions.unlocked overrides. */
  lockedByDefault: boolean;
}

export interface EconomyDef {
  /** Interest paid at wave end is at most interestCap × interestCapGrowth^(wave−1) (× modifiers). */
  interestCap: number;
  interestCapGrowth: number;
}

export interface StatsData {
  tabs: Record<TabId, StatId[]>;
  stats: Record<StatId, StatDef>;
  economy: EconomyDef;
}

/** Allowed range for the in-run cost growth factor (spec §2.3). */
export const COST_GROWTH_MIN = 1.07;
export const COST_GROWTH_MAX = 1.12;

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
  /** Share of the regular enemies a boss wave still spawns (0..1). */
  bossWaveEnemyMul: number;
  /** Spatial hash cell size, world px. */
  hashCell: number;
  /** Rewarded revive: core HP share restored, and viruses within this radius (world px) are purged. */
  reviveHp: number;
  reviveClearRadius: number;
}

export interface GameData {
  config: SimConfig;
  core: CoreDef;
  enemies: Record<EnemyKind, EnemyDef>;
  tiers: TierDef[];
  stats: StatsData;
  perks: PerksData;
  sets: SetsData;
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

/** Stats whose value 0 would break the sim (a divisor or a must-have). */
const POSITIVE_STATS: readonly StatId[] = ['attackSpeed', 'health', 'range'];

function validateStats(s: StatsData): void {
  check(s !== undefined && s.stats !== undefined && s.tabs !== undefined, 'stats is missing');
  const seen = new Set<string>();
  for (const tab of TAB_IDS) {
    const ids = s.tabs[tab];
    check(Array.isArray(ids) && ids.length === 6, `stats.tabs.${tab} must list 6 stats`);
    for (const id of ids) {
      check((STAT_IDS as readonly string[]).includes(id), `stats.tabs.${tab}: unknown stat "${id}"`);
      check(!seen.has(id), `stats.tabs: "${id}" is listed twice`);
      seen.add(id);
      check(s.stats[id]?.tab === tab, `stats.${id}.tab must be "${tab}"`);
    }
  }
  for (const id of STAT_IDS) {
    const def = s.stats[id];
    const at = `stats.${id}`;
    check(def !== undefined, `${at} is missing`);
    check(seen.has(id), `${at} is not in any tab`);
    check(typeof def.name === 'string' && def.name.length > 0, `${at}.name must be a non-empty string`);
    nonNeg(def.base, `${at}.base`);
    check(def.mode === 'add' || def.mode === 'mul', `${at}.mode must be "add" or "mul"`);
    if (def.mode === 'mul') positive(def.per, `${at}.per`);
    else nonNeg(def.per, `${at}.per`);
    if (def.maxLevel !== undefined) check(Number.isInteger(def.maxLevel) && def.maxLevel >= 1, `${at}.maxLevel must be a whole number ≥ 1`);
    if (def.cap !== undefined) positive(def.cap, `${at}.cap`);
    check(def.cost !== undefined, `${at}.cost is missing`);
    positive(def.cost.base, `${at}.cost.base`);
    check(
      Number.isFinite(def.cost.growth) && def.cost.growth >= COST_GROWTH_MIN && def.cost.growth <= COST_GROWTH_MAX,
      `${at}.cost.growth must be in [${COST_GROWTH_MIN}, ${COST_GROWTH_MAX}], got ${def.cost.growth}`,
    );
    check(STAT_FORMATS.includes(def.format), `${at}.format must be one of ${STAT_FORMATS.join('|')}`);
    check(typeof def.lockedByDefault === 'boolean', `${at}.lockedByDefault must be a boolean`);
  }
  for (const id of POSITIVE_STATS) positive(s.stats[id].base, `stats.${id}.base`);
  positive(s.economy?.interestCap, 'stats.economy.interestCap');
  positive(s.economy?.interestCapGrowth, 'stats.economy.interestCapGrowth');
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

  positive(c.hashCell, 'config.hashCell');
  check(Number.isFinite(c.reviveHp) && c.reviveHp > 0 && c.reviveHp <= 1, 'config.reviveHp must be in (0, 1]');
  nonNeg(c.reviveClearRadius, 'config.reviveClearRadius');
  check(Number.isFinite(c.bossWaveEnemyMul) && c.bossWaveEnemyMul >= 0 && c.bossWaveEnemyMul <= 1, 'config.bossWaveEnemyMul must be in [0, 1]');
  const k = d.core;
  positive(k.radius, 'core.radius');
  positive(k.projectileSpeed, 'core.projectileSpeed');
  validateStats(d.stats);
  validatePerks(d.perks);
  validateSets(d.sets);

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
    nonNeg(e.knockback, `${at}.knockback`);
    wholeNonNeg(e.keys, `${at}.keys`);
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
    if (t.enemyRegen !== undefined) nonNeg(t.enemyRegen, `tiers[${i}].enemyRegen`);
    if (t.bossEvery !== undefined) check(Number.isInteger(t.bossEvery) && t.bossEvery > 0, `tiers[${i}].bossEvery must be a positive integer`);
    if (t.rangedRateMul !== undefined) positive(t.rangedRateMul, `tiers[${i}].rangedRateMul`);
    if (t.speedMul !== undefined) positive(t.speedMul, `tiers[${i}].speedMul`);
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
  stats: statsJson as StatsData,
  perks: perksJson as unknown as PerksData,
  sets: setsJson as unknown as SetsData,
  directions: directionsJson as [number, number][],
});

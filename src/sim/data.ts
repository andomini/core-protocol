import bootJson from '../data/boot.json'; // boot
import configJson from '../data/config.json';
import coreJson from '../data/core.json';
import crystalJson from '../data/crystal.json';
import mutationsJson from '../data/mutations.json';
import territoryJson from '../data/territory.json';
import directionsJson from '../data/directions.json';
import enemiesJson from '../data/enemies.json';
import perksJson from '../data/perks.json';
import setsJson from '../data/sets.json';
import statsJson from '../data/stats.json';
import structuresJson from '../data/structures.json';
import pulseJson from '../data/pulse.json'; // pulse
import { type PerksData, type SetsData, STRUCTURE_KINDS, type StructureKind, TAGS, type Tag, validatePerks, validateSets } from './perkData';
import { hexDist, isNeighbour } from './hex'; // boot
import tiersJson from '../data/tiers.json';

export type EnemyKind = 'basic' | 'fast' | 'tank' | 'ranged' | 'boss' | 'leech' | 'spore' | 'carrier' | 'phage';
/** Spawn-order list; the four uniqueness-plan kinds (B2) come last so older kinds keep their weighted-pick slots. */
export const ENEMY_KINDS: readonly EnemyKind[] = ['basic', 'fast', 'tank', 'ranged', 'boss', 'leech', 'spore', 'carrier', 'phage'];

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
  // Kind mechanics (uniqueness plan item 7; notes in 2026-10-20-uniqueness-notes-b2.md). Absent = no such mechanic.
  /** Leech: Bits stolen from the run per core hit (base, scaled like kill Bits: × tier bitsMul × bitsGrowth^(wave−1)). */
  steal?: number;
  /** Leech: its kill pays back the carried Bits × this. */
  returnMul?: number;
  /** Spore: copies it splits into on death. */
  splitCount?: number;
  /** Spore: each copy's share of the parent's max HP, damage, Energy and Bits. */
  splitShare?: number;
  /** Spore: each copy's radius relative to the parent's. */
  splitRadius?: number;
  /** Spore: generations that still split (1 = the copies do not split again). */
  splitGens?: number;
  /** Carrier: other viruses within this distance (centre to centre, world px) take less damage while it lives. */
  auraRadius?: number;
  /** Carrier: the share of damage its aura removes (0..1); auras do not stack, carriers do not shield carriers. */
  auraReduce?: number;
  /** Phage: damage multiplier against structures; it walks to the nearest standing wall segment or station. */
  structureMul?: number;
  /** Phage: gap (world px) between its body and the structure it latches onto. */
  latch?: number;
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
export type TabId = 'atk' | 'def' | 'util' | 'build';
export const TAB_IDS: readonly TabId[] = ['atk', 'def', 'util', 'build'];
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
  /** Highest the cap can be raised to by `capAdd` effects (absent = the cap cannot move). */
  capMax?: number;
  /** Price of the next level from level L: base × growth^L (soft wall: growthAfter past `knee`, see CostCurve). */
  cost: CostCurve;
  format: StatFormat;
  /** Locked until a lab node unlocks it (M4); RunOptions.unlocked overrides. */
  lockedByDefault: boolean;
  /** BUILD stats: the in-run buy is locked until one of these structures is built (its firewall fusion is at tier I+); the workshop sells it regardless. */
  needs?: StructureKind[];
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

/**
 * A level price curve: base × growth^L up to the `knee` level, then the price keeps rising by the gentler
 * `growthAfter` per level (1 = flat), so a stat never hits a hard exponential wall. Both soft-wall fields
 * are optional and go together; without them the curve is plain geometric.
 */
export interface CostCurve {
  base: number;
  growth: number;
  knee?: number;
  growthAfter?: number;
}

/** Checks the optional soft-wall pair of a cost curve; `at` names it in the error. */
export function checkKnee(c: CostCurve, at: string): void {
  if (c.knee === undefined && c.growthAfter === undefined) return;
  if (!(c.knee !== undefined && Number.isInteger(c.knee) && c.knee >= 1)) throw new Error(`data: ${at}.knee must be a whole number ≥ 1 (with growthAfter)`);
  if (!(typeof c.growthAfter === 'number' && Number.isFinite(c.growthAfter) && c.growthAfter >= 1 && c.growthAfter <= c.growth))
    throw new Error(`data: ${at}.growthAfter must be in [1, growth], got ${c.growthAfter}`);
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
  /** The breach widens: every arenaGrowEvery waves the spawn ring grows by arenaGrowStep, up to arenaMaxRadius. */
  arenaGrowEvery: number;
  arenaGrowStep: number;
  arenaMaxRadius: number;
  /** Share of the arena growth applied to virus speed (1 = they cross the wider ring in the same time). */
  arenaSpeedScale: number;
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
  /** Damage share of each extra Multishot projectile (the first shot is full damage). */
  multishotDamage: number;
  /** Seconds between two knockbacks of the same enemy. */
  knockbackCooldown: number;
  /** Late wall: from this wave, enemy HP and damage get an extra ×lateGrowth per wave. */
  lateWave: number;
  lateGrowth: number;
  reviveClearRadius: number;
}

/** The core's crystal (protocol modules on a hex grid around the core). */
export interface CrystalDef {
  /** Hex size (center to corner), world px. */
  cellSize: number;
  /** Rings 0..coreRing are the core itself; modules go into rings coreRing+1..maxRing. */
  coreRing: number;
  maxRing: number;
  /** The crystal grows with the breach: +1 ring every ringEvery waves, up to maxRingCap. */
  ringEvery: number;
  maxRingCap: number;
  /** Auto-placement score weights. */
  /** `link`: per neighbour of another tag (a fusion link, spec 2026-10-15 §1). `linkNear` × the tier index
   * reached: when the slot completes a pair's next fusion tier from exactly one link short (spec 2026-10-16 §6). */
  auto: { sameTag: number; sectorMatch: number; sectorEmpty: number; ring: number; link: number; linkNear: number };
}

/** The arena's hex territory: ours vs infected cells. */
export interface TerritoryDef {
  cellSize: number;
  /** Cells whose center is within this distance start as ours. */
  startRadius: number;
  /** Every N ticks each living, non-frozen virus infects the cell under it. */
  infectEvery: number;
  /** Every N ticks infected cells touching our ground (no virus, no nest on them) turn ours again. */
  regrowEvery: number;
  bossInfectRing: number;
  /** A kill cleanses its cell and the rings around it up to this. */
  cleanseRing: number;
  /** Kill Energy × (energyBase + energyPerOwned × owned share). */
  energyBase: number;
  energyPerOwned: number;
  overloadDamage: number;
  cryoSlow: number;
  chainDamage: number;
  miningEnergy: number;
  firewallDamage: number;
  infectedSpeed: number;
  /** Far kills pay more: Energy and Bits × (1 + farPer100 × (distance − farFrom) / 100) beyond farFrom. */
  farFrom: number;
  farPer100: number;
  /** Nests: each arena growth plants nestsPerGrow in the new ground (at most maxNests alive). A nest on an
   *  infected cell spawns nestKind every nestEvery wave ticks; reclaiming its cell destroys it for a payout. */
  nestsPerGrow: number;
  maxNests: number;
  /** Nests sit at most this far out, so a long-Range core can still reclaim them. */
  nestMaxRadius: number;
  nestEvery: number;
  nestKind: EnemyKind;
  nestEnergy: number;
  nestBits: number;
  /** c2: the Territory Beacon (src/sim/beacon.ts). */
  beacon: BeaconDef;
}

/** c2: a buildable beacon planted at the infection front (Command 'beacon'). */
export interface BeaconDef {
  /** Energy: cost × costGrowth^(beacons built this run) × config.energyGrowth^(wave − 1). */
  cost: number;
  costGrowth: number;
  /** At most this many standing at once (≤ 6). */
  max: number;
  /** Hex rings around its cell that infection cannot enter. */
  radius: number;
  /** Every N ticks it cleanses one more ring (up to radius, then keeps the whole disc clean). */
  cleanseEvery: number;
  /** Max HP as a share of the core's max HP (× Structure Health), like walls. */
  hp: number;
  /** Standing through this many wave ends pays holdReward Bits (× tier bitsMul × bitsGrowth^(wave − 1)) and claims its disc for the run. */
  holdWaves: number;
  holdReward: number;
  /** Viruses passing within this distance (px) turn on it; phages hunt it anywhere. */
  aggro: number;
  bodyRadius: number;
  /** Placement band: at least minDist from the core, at most rangeShare × Range (and inside the arena). */
  minDist: number;
  rangeShare: number;
}

/** c2: the beacon block of territory.json. */
export function validateBeacon(b: BeaconDef | undefined): void {
  check(b !== null && typeof b === 'object', 'territory.beacon must be an object');
  const v = b!;
  positive(v.cost, 'territory.beacon.cost');
  check(Number.isFinite(v.costGrowth) && v.costGrowth >= 1, 'territory.beacon.costGrowth must be ≥ 1');
  check(Number.isInteger(v.max) && v.max >= 1 && v.max <= 6, 'territory.beacon.max must be a whole number in [1, 6]');
  check(Number.isInteger(v.radius) && v.radius >= 1, 'territory.beacon.radius must be a positive integer');
  check(Number.isInteger(v.cleanseEvery) && v.cleanseEvery > 0, 'territory.beacon.cleanseEvery must be a positive integer');
  check(Number.isFinite(v.hp) && v.hp > 0 && v.hp <= 1, 'territory.beacon.hp must be in (0, 1]');
  check(Number.isInteger(v.holdWaves) && v.holdWaves >= 1, 'territory.beacon.holdWaves must be a positive integer');
  nonNeg(v.holdReward, 'territory.beacon.holdReward');
  for (const k of ['aggro', 'bodyRadius', 'minDist'] as const) nonNeg(v[k], `territory.beacon.${k}`);
  check(Number.isFinite(v.rangeShare) && v.rangeShare > 0 && v.rangeShare <= 1, 'territory.beacon.rangeShare must be in (0, 1]');
}

/** Virus mutations: the genome learns the build's dominant tag. */
export interface MutationsDef {
  startWave: number;
  every: number;
  maxLevel: number;
  /** Each gene level × (1 − perLevel) on the countered effect. */
  perLevel: Record<Tag, number>;
  /** The first gene level of a tag counts only this share of a level (a softer first mutation); later levels count 1. */
  firstLevelScale: number;
}

// boot
/** One boot sector (uniqueness plan item 1): a starter crystal of pre-arranged modules of one tag. */
export interface BootSector {
  id: string;
  tag: Tag;
  name: string;
  blurb: string;
  /** The tag whose module beside the cluster would make the first fusion link (shown as a hint). */
  partner: Tag;
  /** Modules in placement order: the first touches the core block, each next one touches an earlier one. */
  modules: { perk: string; slot: [number, number] }[];
}

// boot
/** Boot sectors: before wave 1 the run offers `offerSize` of them (drawn from the seed). */
export interface BootData {
  offerSize: number;
  /** Schedule waves whose protocol pick a taken boot sector stands in for (its modules are those picks). */
  skipPicks: number[];
  sectors: BootSector[];
}

/** Firewall-fusion structures (spec 2026-10-15): fixed geometry; the strength of each kind lives in the sets.json ladders. */
export interface StructuresDef {
  wall: {
    /** Ring radius with the crystal at its base size; grows `ringStep` per crystal ring beyond `crystal.maxRing`. */
    minRadius: number;
    ringStep: number;
    /** The ring never exceeds Range minus this, so the core can always shoot what stands at the wall. */
    rangeMargin: number;
    /** Segments, one per 60° sector (the six SECTOR_DIRS). */
    segments: number;
    /** A segment is contested while a virus stands in its sector within wallR + this. */
    contestDist: number;
  };
  turret: {
    /** Barrel length (world px): where the shot leaves the turret (render only). */
    muzzle: number;
    /** Seconds between two shots at rateMul 1. */
    shotSec: number;
  };
  mine: {
    /** A mine goes off when a virus comes within this (plus its own radius). */
    trigger: number;
    /** Mines are planted this far outside the wall ring: [near, far] (world px). */
    band: [number, number];
  };
  station: {
    /**
     * Stations stand this far inside the wall ring (world px). With the crystal at its biggest ring (maxRingCap) its corner
     * cells reach out to about the station's distance: a drawn overlap only, nothing collides with the crystal.
     */
    inset: number;
    /** Hit radius: a melee virus stops this far (plus its own radius) from the centre. */
    radius: number;
    /** A virus not held by a wall segment turns to the nearest station within this distance. */
    aggro: number;
  };
}

/** Pulse (uniqueness plan item 4): the core's active ring, its effect by the dominant tag (src/sim/pulse.ts). */
export interface PulseDef {
  cooldownSec: number;
  /** Ring radius = this × Range. */
  radiusRangeMul: number;
  /** The dominant tag needs at least this set count; below it the plain pulse fires. */
  minCount: number;
  /** × (1 + tierPower × set tier steps of the dominant tag) on every effect. */
  tierPower: number;
  /** Cooldown × (1 − tierCooldown × set tier steps), at least 0.2. */
  tierCooldown: number;
  /** Lab node autoPulse: fires when ready and at least minTargets viruses are in the ring. */
  autoPulse: { minTargets: number };
  none: { damageMul: number; knockback: number };
  overload: { damageMul: number };
  cryo: { damageMul: number; freezeSec: number };
  chain: { damageMul: number; maxTargets: number };
  mining: { damageMul: number; energyMul: number; bitsMul: number };
  firewall: { damageMul: number; shieldFrac: number; shieldCapFrac: number; knockback: number };
}

export interface GameData {
  config: SimConfig;
  core: CoreDef;
  enemies: Record<EnemyKind, EnemyDef>;
  tiers: TierDef[];
  stats: StatsData;
  perks: PerksData;
  sets: SetsData;
  crystal: CrystalDef;
  territory: TerritoryDef;
  mutations: MutationsDef;
  structures: StructuresDef;
  pulse: PulseDef; // pulse
  /** Boot sectors (uniqueness plan item 1). */
  boot: BootData;
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

// boot
/** Boot sectors: known perks of the sector's tag, distinct crystal hexes, each placed where a new module may go. */
function validateBoot(d: GameData): void {
  const b = d.boot;
  check(b !== undefined && Array.isArray(b.sectors) && b.sectors.length > 0, 'boot.sectors must not be empty');
  check(Number.isInteger(b.offerSize) && b.offerSize >= 1 && b.offerSize <= b.sectors.length, 'boot.offerSize must be a whole number in 1..sectors');
  check(Array.isArray(b.skipPicks) && b.skipPicks.every((v) => Number.isInteger(v) && v >= 1), 'boot.skipPicks must be whole wave numbers ≥ 1');
  const ids = new Set<string>();
  const inner = d.crystal.coreRing + 1;
  for (const s of b.sectors) {
    const at = `boot.${s.id}`;
    check(typeof s.id === 'string' && s.id !== '' && !ids.has(s.id), `boot: sector id "${s.id}" must be unique and non-empty`);
    ids.add(s.id);
    check((TAGS as readonly string[]).includes(s.tag), `${at}.tag must be a tag`);
    check((TAGS as readonly string[]).includes(s.partner) && s.partner !== s.tag, `${at}.partner must be another tag`);
    check(typeof s.name === 'string' && s.name !== '' && typeof s.blurb === 'string', `${at}: name and blurb are required`);
    check(Array.isArray(s.modules) && s.modules.length >= 1, `${at}.modules must not be empty`);
    const placed: [number, number][] = [];
    for (const m of s.modules) {
      const p = d.perks.perks[m.perk];
      check(p !== undefined && p.tag === s.tag, `${at}: "${m.perk}" must be a ${s.tag} perk`);
      check(p!.requires === undefined, `${at}: "${m.perk}" needs a locked stat`);
      check(!placed.some((_, i) => s.modules[i]!.perk === m.perk), `${at}: "${m.perk}" is listed twice`);
      const [q, r] = Array.isArray(m.slot) ? m.slot : [NaN, NaN];
      const ring = hexDist(q, r);
      check(Number.isInteger(q) && Number.isInteger(r) && ring >= inner && ring <= d.crystal.maxRing, `${at}: slot of "${m.perk}" must be a crystal hex`);
      check(!placed.some(([a, c]) => a === q && c === r), `${at}: slot of "${m.perk}" is taken`);
      check(ring === inner || placed.some(([a, c]) => isNeighbour(q, r, a, c)), `${at}: "${m.perk}" must touch the core block or an earlier module`);
      placed.push([q, r]);
    }
  }
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
    if (def.capMax !== undefined) check(def.cap !== undefined && def.capMax >= def.cap, `${at}.capMax needs a cap and must be ≥ it`);
    check(def.cost !== undefined, `${at}.cost is missing`);
    positive(def.cost.base, `${at}.cost.base`);
    check(
      Number.isFinite(def.cost.growth) && def.cost.growth >= COST_GROWTH_MIN && def.cost.growth <= COST_GROWTH_MAX,
      `${at}.cost.growth must be in [${COST_GROWTH_MIN}, ${COST_GROWTH_MAX}], got ${def.cost.growth}`,
    );
    checkKnee(def.cost, `${at}.cost`);
    check(STAT_FORMATS.includes(def.format), `${at}.format must be one of ${STAT_FORMATS.join('|')}`);
    check(typeof def.lockedByDefault === 'boolean', `${at}.lockedByDefault must be a boolean`);
    if (def.needs !== undefined) {
      check(Array.isArray(def.needs) && def.needs.length > 0, `${at}.needs must be a non-empty list of structure kinds`);
      for (const k of def.needs) check((STRUCTURE_KINDS as readonly string[]).includes(k), `${at}.needs: unknown structure "${k}"`);
    }
    check(def.needs !== undefined || def.tab !== 'build', `${at}: a BUILD stat must say which structure it needs`);
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
  check(Number.isInteger(c.arenaGrowEvery) && c.arenaGrowEvery > 0, 'config.arenaGrowEvery must be a positive integer');
  nonNeg(c.arenaGrowStep, 'config.arenaGrowStep');
  check(c.arenaMaxRadius >= c.spawnRadius, 'config.arenaMaxRadius must be ≥ spawnRadius');
  nonNeg(c.arenaSpeedScale, 'config.arenaSpeedScale');
  nonNeg(c.baseEnemiesPerWave, 'config.baseEnemiesPerWave');
  nonNeg(c.enemiesPerWaveGrowth, 'config.enemiesPerWaveGrowth');
  wholeNonNeg(c.maxEnemiesPerWave, 'config.maxEnemiesPerWave');
  positive(c.energyGrowth, 'config.energyGrowth');
  positive(c.bitsGrowth, 'config.bitsGrowth');

  positive(c.hashCell, 'config.hashCell');
  check(Number.isFinite(c.reviveHp) && c.reviveHp > 0 && c.reviveHp <= 1, 'config.reviveHp must be in (0, 1]');
  nonNeg(c.knockbackCooldown, 'config.knockbackCooldown');
  check(Number.isInteger(c.lateWave) && c.lateWave >= 1, 'config.lateWave must be a whole number ≥ 1');
  check(Number.isFinite(c.lateGrowth) && c.lateGrowth >= 1, 'config.lateGrowth must be ≥ 1');
  check(Number.isFinite(c.multishotDamage) && c.multishotDamage > 0 && c.multishotDamage <= 1, 'config.multishotDamage must be in (0, 1]');
  nonNeg(c.reviveClearRadius, 'config.reviveClearRadius');
  check(Number.isFinite(c.bossWaveEnemyMul) && c.bossWaveEnemyMul >= 0 && c.bossWaveEnemyMul <= 1, 'config.bossWaveEnemyMul must be in [0, 1]');
  const k = d.core;
  positive(k.radius, 'core.radius');
  positive(k.projectileSpeed, 'core.projectileSpeed');
  validateStats(d.stats);
  validatePerks(d.perks);
  validateSets(d.sets);
  // A cap raise needs a cap that can move.
  for (const [id, pdef] of Object.entries(d.perks.perks))
    for (const e of pdef.effects)
      if (e.type === 'capAdd') check(d.stats.stats[e.stat].capMax !== undefined, `perks.${id}: capAdd on ${e.stat}, which has no capMax`);
  const cr = d.crystal;
  positive(cr?.cellSize, 'crystal.cellSize');
  wholeNonNeg(cr.coreRing, 'crystal.coreRing');
  check(Number.isInteger(cr.maxRing) && cr.maxRing > cr.coreRing, 'crystal.maxRing must be a whole number > coreRing');
  check(Number.isInteger(cr.ringEvery) && cr.ringEvery > 0, 'crystal.ringEvery must be a positive integer');
  check(Number.isInteger(cr.maxRingCap) && cr.maxRingCap >= cr.maxRing, 'crystal.maxRingCap must be a whole number ≥ maxRing');
  for (const k of ['sameTag', 'sectorMatch', 'sectorEmpty', 'ring', 'link', 'linkNear'] as const) nonNeg(cr.auto?.[k], `crystal.auto.${k}`);
  const tr = d.territory;
  positive(tr?.cellSize, 'territory.cellSize');
  nonNeg(tr.startRadius, 'territory.startRadius');
  check(Number.isInteger(tr.infectEvery) && tr.infectEvery > 0, 'territory.infectEvery must be a positive integer');
  check(Number.isInteger(tr.regrowEvery) && tr.regrowEvery > 0, 'territory.regrowEvery must be a positive integer');
  wholeNonNeg(tr.bossInfectRing, 'territory.bossInfectRing');
  wholeNonNeg(tr.cleanseRing, 'territory.cleanseRing');
  for (const k of ['energyBase', 'energyPerOwned', 'overloadDamage', 'chainDamage', 'miningEnergy', 'firewallDamage', 'infectedSpeed'] as const) nonNeg(tr[k], `territory.${k}`);
  for (const k of ['farFrom', 'farPer100', 'nestEnergy', 'nestBits', 'nestMaxRadius'] as const) nonNeg(tr[k], `territory.${k}`);
  for (const k of ['nestsPerGrow', 'maxNests'] as const) wholeNonNeg(tr[k], `territory.${k}`);
  check(Number.isInteger(tr.nestEvery) && tr.nestEvery > 0, 'territory.nestEvery must be a positive integer');
  check(tr.nestKind in d.enemies && tr.nestKind !== 'boss', 'territory.nestKind must be a non-boss enemy kind');
  check(Number.isFinite(tr.cryoSlow) && tr.cryoSlow >= 0 && tr.cryoSlow < 1, 'territory.cryoSlow must be in [0, 1)');
  validateBeacon(tr.beacon); // c2
  const sw = d.structures?.wall;
  positive(sw?.minRadius, 'structures.wall.minRadius');
  nonNeg(sw.ringStep, 'structures.wall.ringStep');
  nonNeg(sw.rangeMargin, 'structures.wall.rangeMargin');
  check(sw.segments === 6, 'structures.wall.segments must be 6 (one per sector)');
  nonNeg(sw.contestDist, 'structures.wall.contestDist');
  check(sw.minRadius > d.core.radius, 'structures.wall.minRadius must lie outside the core');
  positive(d.structures.turret?.muzzle, 'structures.turret.muzzle');
  positive(d.structures.turret.shotSec, 'structures.turret.shotSec');
  positive(d.structures.mine?.trigger, 'structures.mine.trigger');
  const band = d.structures.mine.band;
  check(Array.isArray(band) && band.length === 2 && Number.isFinite(band[0]) && Number.isFinite(band[1]) && band[0] >= 0 && band[0] <= band[1], 'structures.mine.band must be [near, far] with 0 ≤ near ≤ far');
  positive(d.structures.station?.inset, 'structures.station.inset');
  positive(d.structures.station.radius, 'structures.station.radius');
  positive(d.structures.station.aggro, 'structures.station.aggro');
  check(sw.minRadius - d.structures.station.inset > d.core.radius, 'structures.station.inset must keep stations outside the core');
  const mu = d.mutations;
  check(Number.isInteger(mu?.startWave) && mu.startWave >= 1, 'mutations.startWave must be a whole number ≥ 1');
  check(Number.isInteger(mu.every) && mu.every >= 1, 'mutations.every must be a whole number ≥ 1');
  wholeNonNeg(mu.maxLevel, 'mutations.maxLevel');
  for (const t of TAGS) {
    const v = mu.perLevel?.[t];
    check(Number.isFinite(v) && v >= 0 && v * mu.maxLevel < 1, `mutations.perLevel.${t} must be ≥ 0 and × maxLevel < 1`);
  }
  check(Number.isFinite(mu.firstLevelScale) && mu.firstLevelScale > 0 && mu.firstLevelScale <= 1, 'mutations.firstLevelScale must be in (0, 1]');
  validateBoot(d);

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
    validateMechanics(e, at);
  }
  check((d.enemies.leech.steal ?? 0) > 0, 'enemies.leech must steal (steal > 0)');
  check((d.enemies.spore.splitCount ?? 0) > 0, 'enemies.spore must split (splitCount > 0)');
  check((d.enemies.carrier.auraReduce ?? 0) > 0, 'enemies.carrier must shield (auraReduce > 0)');
  check((d.enemies.phage.structureMul ?? 0) > 0, 'enemies.phage must hunt structures (structureMul > 0)');
  check(d.enemies.phage.standoff > 0, 'enemies.phage must be ranged without a structure (standoff > 0)');
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

  // pulse
  const pu = d.pulse;
  positive(pu?.cooldownSec, 'pulse.cooldownSec');
  positive(pu.radiusRangeMul, 'pulse.radiusRangeMul');
  check(Number.isInteger(pu.minCount) && pu.minCount >= 1, 'pulse.minCount must be a whole number ≥ 1');
  nonNeg(pu.tierPower, 'pulse.tierPower');
  check(Number.isFinite(pu.tierCooldown) && pu.tierCooldown >= 0 && pu.tierCooldown < 1, 'pulse.tierCooldown must be in [0, 1)');
  check(Number.isInteger(pu.autoPulse?.minTargets) && pu.autoPulse.minTargets >= 1, 'pulse.autoPulse.minTargets must be a whole number ≥ 1');
  for (const k of ['none', 'overload', 'cryo', 'chain', 'mining', 'firewall'] as const) nonNeg(pu[k]?.damageMul, `pulse.${k}.damageMul`);
  nonNeg(pu.none.knockback, 'pulse.none.knockback');
  positive(pu.cryo.freezeSec, 'pulse.cryo.freezeSec');
  check(Number.isInteger(pu.chain.maxTargets) && pu.chain.maxTargets >= 1, 'pulse.chain.maxTargets must be a whole number ≥ 1');
  nonNeg(pu.mining.energyMul, 'pulse.mining.energyMul');
  nonNeg(pu.mining.bitsMul, 'pulse.mining.bitsMul');
  positive(pu.firewall.shieldFrac, 'pulse.firewall.shieldFrac');
  check(Number.isFinite(pu.firewall.shieldCapFrac) && pu.firewall.shieldCapFrac >= pu.firewall.shieldFrac, 'pulse.firewall.shieldCapFrac must be ≥ shieldFrac');
  nonNeg(pu.firewall.knockback, 'pulse.firewall.knockback');

  check(d.directions.length === 64, `directions must have 64 entries, got ${d.directions.length}`);
  d.directions.forEach(([x, y], i) => {
    check(Number.isFinite(x) && Number.isFinite(y) && Math.abs(x * x + y * y - 1) < 1e-9, `directions[${i}] must be a unit vector`);
  });
  return d;
}

/** The optional kind-mechanic fields of an enemy definition: each group complete or absent, values in range. */
function validateMechanics(e: EnemyDef, at: string): void {
  if (e.steal !== undefined || e.returnMul !== undefined) {
    positive(e.steal as number, `${at}.steal`);
    nonNeg(e.returnMul as number, `${at}.returnMul`);
  }
  if (e.splitCount !== undefined || e.splitShare !== undefined || e.splitRadius !== undefined || e.splitGens !== undefined) {
    check(Number.isInteger(e.splitCount) && e.splitCount! >= 1 && e.splitCount! <= 4, `${at}.splitCount must be a whole number in [1, 4]`);
    check(Number.isFinite(e.splitShare) && e.splitShare! > 0 && e.splitShare! < 1, `${at}.splitShare must be in (0, 1)`);
    check(Number.isFinite(e.splitRadius) && e.splitRadius! > 0 && e.splitRadius! <= 1, `${at}.splitRadius must be in (0, 1]`);
    check(Number.isInteger(e.splitGens) && e.splitGens! >= 1 && e.splitGens! <= 2, `${at}.splitGens must be 1 or 2`);
  }
  if (e.auraRadius !== undefined || e.auraReduce !== undefined) {
    positive(e.auraRadius as number, `${at}.auraRadius`);
    check(Number.isFinite(e.auraReduce) && e.auraReduce! > 0 && e.auraReduce! < 1, `${at}.auraReduce must be in (0, 1)`);
  }
  if (e.structureMul !== undefined || e.latch !== undefined) {
    positive(e.structureMul as number, `${at}.structureMul`);
    nonNeg(e.latch as number, `${at}.latch`);
  }
}

export const DEFAULT_DATA: GameData = validateData({
  config: configJson as SimConfig,
  core: coreJson as CoreDef,
  enemies: enemiesJson as Record<EnemyKind, EnemyDef>,
  tiers: tiersJson as TierDef[],
  stats: statsJson as StatsData,
  perks: perksJson as unknown as PerksData,
  sets: setsJson as unknown as SetsData,
  crystal: crystalJson as CrystalDef,
  territory: territoryJson as TerritoryDef,
  mutations: mutationsJson as unknown as MutationsDef,
  structures: structuresJson as StructuresDef,
  pulse: pulseJson as PulseDef, // pulse
  boot: bootJson as unknown as BootData,
  directions: directionsJson as [number, number][],
});

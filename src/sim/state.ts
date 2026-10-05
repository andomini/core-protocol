import { type EnemyKind, type GameData, STAT_IDS, type StatId } from './data';
import { createStream, type RngState } from './rng';
import { canonicalLevels, type CoreStats, effectiveStats, type Levels, type Modifier } from './stats';

// The World is plain JSON: no classes, Maps or functions, so it can be hashed and snapshotted.

export interface Enemy {
  id: number;
  kind: EnemyKind;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  damage: number;
  /** World px per second. */
  speed: number;
  radius: number;
  standoff: number;
  attackIntervalTicks: number;
  /** Ticks until the next attack; ≤ 0 = ready. */
  attackCd: number;
  energy: number;
  bits: number;
}

export interface Projectile {
  id: number;
  targetId: number;
  x: number;
  y: number;
  damage: number;
  crit: boolean;
}

/** Only true state: max HP, damage, range… are derived (see worldStats). */
export interface CoreState {
  hp: number;
  /** Ticks until the next shot; ≤ 0 = ready. */
  fireCd: number;
}

export const WORLD_VERSION = 2;

export interface World {
  v: 2;
  seed: number;
  /** 1-based index into GameData.tiers. */
  tier: number;
  tick: number;
  wave: number;
  phase: 'wave' | 'pause';
  /** Ticks elapsed in the current phase. */
  phaseTick: number;
  spawnQueue: EnemyKind[];
  spawnInterval: number;
  nextSpawnTick: number;
  core: CoreState;
  /** Levels bought in this run (canonical STAT_IDS key order). */
  levels: Levels;
  /** Workshop levels this run started with (M4 fills them). */
  workshop: Levels;
  /** Stats unlocked beyond the defaults (lab nodes, M4), in STAT_IDS order. */
  unlocked: StatId[];
  /** Stat modifiers from perks, sets, cards (M3/M5 append). */
  mods: Modifier[];
  enemies: Enemy[];
  projectiles: Projectile[];
  nextId: number;
  energy: number;
  bits: number;
  kills: number;
  dead: boolean;
  /** Separate streams so purchases (upgrades) never perturb combat or spawns. */
  rng: { spawn: RngState; combat: RngState; upgrades: RngState };
}

export interface RunOptions {
  seed: number;
  tier: number;
  workshop?: Partial<Record<StatId, number>>;
  /** Locked-by-default stats to unlock for this run (lab nodes in M4; `?unlockall=1` in dev). */
  unlocked?: readonly string[];
}

/** The effective stats of this world right now (derived; never stored in the World). */
export function worldStats(w: World, data: GameData): CoreStats {
  return effectiveStats(data, { workshop: w.workshop, run: w.levels, mods: w.mods });
}

export function createWorld(data: GameData, opts: RunOptions): World {
  if (!Number.isInteger(opts.tier) || opts.tier < 1 || opts.tier > data.tiers.length) {
    throw new Error(`createWorld: tier ${opts.tier} is out of range 1..${data.tiers.length}`);
  }
  if (!Number.isInteger(opts.seed)) throw new Error(`createWorld: seed must be an integer, got ${opts.seed}`);
  const workshop = canonicalLevels(opts.workshop);
  const levels = canonicalLevels(undefined);
  const unlocked = STAT_IDS.filter((id) => opts.unlocked?.includes(id) === true);
  const mods: Modifier[] = [];
  const health = effectiveStats(data, { workshop, run: levels, mods }).health;
  return {
    v: 2,
    seed: opts.seed,
    tier: opts.tier,
    tick: 0,
    wave: 0,
    // Start "at the end of a pause" so the first step starts wave 1 and emits its event.
    phase: 'pause',
    phaseTick: data.config.pauseSeconds * data.config.tickHz,
    spawnQueue: [],
    spawnInterval: 1,
    nextSpawnTick: 1,
    core: { hp: health, fireCd: 0 },
    levels,
    workshop,
    unlocked,
    mods,
    enemies: [],
    projectiles: [],
    nextId: 1,
    energy: 0,
    bits: 0,
    kills: 0,
    dead: false,
    rng: { spawn: createStream(opts.seed, 'spawn'), combat: createStream(opts.seed, 'combat'), upgrades: createStream(opts.seed, 'upgrades') },
  };
}

import type { EnemyKind, GameData } from './data';
import { createStream, type RngState } from './rng';

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
}

export interface CoreState {
  hp: number;
  maxHp: number;
  regen: number;
  damage: number;
  attackSpeed: number;
  range: number;
  /** Ticks until the next shot; ≤ 0 = ready. */
  fireCd: number;
}

export interface World {
  v: 1;
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
  enemies: Enemy[];
  projectiles: Projectile[];
  nextId: number;
  energy: number;
  bits: number;
  kills: number;
  dead: boolean;
  rng: { spawn: RngState; combat: RngState };
}

export interface RunOptions {
  seed: number;
  tier: number;
}

export function createWorld(data: GameData, opts: RunOptions): World {
  if (!Number.isInteger(opts.tier) || opts.tier < 1 || opts.tier > data.tiers.length) {
    throw new Error(`createWorld: tier ${opts.tier} is out of range 1..${data.tiers.length}`);
  }
  if (!Number.isInteger(opts.seed)) throw new Error(`createWorld: seed must be an integer, got ${opts.seed}`);
  const k = data.core;
  return {
    v: 1,
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
    core: { hp: k.health, maxHp: k.health, regen: k.regen, damage: k.damage, attackSpeed: k.attackSpeed, range: k.range, fireCd: 0 },
    enemies: [],
    projectiles: [],
    nextId: 1,
    energy: 0,
    bits: 0,
    kills: 0,
    dead: false,
    rng: { spawn: createStream(opts.seed, 'spawn'), combat: createStream(opts.seed, 'combat') },
  };
}

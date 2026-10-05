import { ENEMY_KINDS, type EnemyKind, type GameData } from './data';
import type { SimEvent } from './events';
import { clampValue, powInt } from './num';
import { nextInt, pickWeighted } from './rng';
import type { Enemy, World } from './state';

/** Regular spawns are spread over this share of the wave, so the last ones still arrive in time. */
const SPAWN_WINDOW = 0.8;

export function waveTicks(data: GameData): number {
  return data.config.waveSeconds * data.config.tickHz;
}

export function pauseTicks(data: GameData): number {
  return data.config.pauseSeconds * data.config.tickHz;
}

export function enemiesPerWave(data: GameData, wave: number): number {
  const c = data.config;
  return Math.min(c.maxEnemiesPerWave, Math.floor(c.baseEnemiesPerWave + wave * c.enemiesPerWaveGrowth));
}

export function isBossWave(data: GameData, wave: number): boolean {
  return wave > 0 && wave % data.config.bossEvery === 0;
}

/** base × mul × growth^(wave − 1), clamped to MAX_VALUE. */
export function scaleForWave(base: number, mul: number, growth: number, wave: number): number {
  return clampValue(base * mul * powInt(growth, wave - 1));
}

function startWave(w: World, data: GameData, events: SimEvent[]): void {
  w.wave += 1;
  w.phase = 'wave';
  w.phaseTick = 0;
  const boss = isBossWave(data, w.wave);
  const kinds = ENEMY_KINDS.filter((k) => k !== 'boss' && data.enemies[k].weight > 0 && data.enemies[k].firstWave <= w.wave);
  const weights = kinds.map((k) => data.enemies[k].weight);
  const queue: EnemyKind[] = boss ? ['boss'] : [];
  const n = enemiesPerWave(data, w.wave);
  for (let i = 0; i < n; i++) queue.push(pickWeighted(w.rng.spawn, kinds, weights));
  w.spawnQueue = queue;
  w.spawnInterval = queue.length > 0 ? Math.max(1, Math.floor((waveTicks(data) * SPAWN_WINDOW) / queue.length)) : 1;
  w.nextSpawnTick = 1;
  events.push({ type: 'waveStart', wave: w.wave, boss });
}

/** Creates an enemy scaled for the current wave and tier; also used directly by tests. */
export function spawnEnemy(w: World, data: GameData, kind: EnemyKind, x: number, y: number, events: SimEvent[]): Enemy {
  const def = data.enemies[kind];
  const tier = data.tiers[w.tier - 1]!;
  const c = data.config;
  const wave = Math.max(1, w.wave);
  const hp = scaleForWave(def.hp, tier.hpMul, tier.hpGrowth, wave);
  const e: Enemy = {
    id: w.nextId++,
    kind,
    x,
    y,
    hp,
    maxHp: hp,
    damage: scaleForWave(def.damage, tier.damageMul, tier.damageGrowth, wave),
    speed: def.speed,
    radius: def.radius,
    standoff: def.standoff,
    attackIntervalTicks: def.attackInterval * c.tickHz,
    attackCd: 0,
    energy: scaleForWave(def.energy, 1, c.energyGrowth, wave),
    bits: scaleForWave(def.bits, tier.bitsMul, c.bitsGrowth, wave),
  };
  w.enemies.push(e);
  events.push({ type: 'spawn', id: e.id, kind, x, y });
  return e;
}

/** Advances the wave/pause timer by one tick, starting waves and spawning due enemies. */
export function advanceWave(w: World, data: GameData, events: SimEvent[]): void {
  if (w.phase === 'pause') {
    if (w.phaseTick < pauseTicks(data)) {
      w.phaseTick += 1;
      return;
    }
    startWave(w, data, events);
  }
  w.phaseTick += 1;
  const r = data.config.spawnRadius;
  while (w.spawnQueue.length > 0 && w.phaseTick >= w.nextSpawnTick) {
    const kind = w.spawnQueue.shift()!;
    const [dx, dy] = data.directions[nextInt(w.rng.spawn, data.directions.length)]!;
    spawnEnemy(w, data, kind, dx * r, dy * r, events);
    w.nextSpawnTick += w.spawnInterval;
  }
  if (w.phaseTick >= waveTicks(data)) {
    w.phase = 'pause';
    w.phaseTick = 0;
    events.push({ type: 'waveEnd', wave: w.wave });
  }
}

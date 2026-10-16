import { ENEMY_KINDS, type EnemyKind, type GameData } from './data';
import { pauseTicks, scaleForWave, waveTicks } from './economy';
import type { SimEvent } from './events';
import { clampValue, powInt } from './num';
import { geneMean, mutate, resetGeneAcc } from './mutations';
import { boostActive, enterPick, isPickWave, maxMarks, type PerkProfile, perkProfile } from './perks';
import { chance, createStream, nextInt, pickWeighted } from './rng';
import type { Enemy, World } from './state';
import type { CoreStats } from './stats';
import { payStations, prepareStructures, wallRadius } from './structures';
import { arenaRadius, arenaSpeed, crystalRing, terrainFor } from './territory';

// Wave timing and wave scaling live in economy.ts (structures.ts needs them too); re-exported for the existing importers.
export { pauseTicks, scaleForWave, waveTicks };

/** Regular spawns are spread over this share of the wave, so the last ones still arrive in time. */
const SPAWN_WINDOW = 0.8;

export function enemiesPerWave(data: GameData, wave: number): number {
  const c = data.config;
  return Math.min(c.maxEnemiesPerWave, Math.floor(c.baseEnemiesPerWave + wave * c.enemiesPerWaveGrowth));
}

/** Boss waves: every `config.bossEvery` waves, or the tier's own cadence (the "Swarm" condition). */
export function isBossWave(data: GameData, wave: number, tier = 1): boolean {
  const every = data.tiers[tier - 1]?.bossEvery ?? data.config.bossEvery;
  return wave > 0 && wave % every === 0;
}

function startWave(w: World, data: GameData, st: CoreStats, prof: PerkProfile, events: SimEvent[]): void {
  w.wave += 1;
  w.phase = 'wave';
  w.phaseTick = 0;
  // The virus learns the build's dominant tag (spec 2026-10-14 §C), from the tick-averaged set counts (2026-10-16 §5).
  mutate(w, data, geneMean(w), events);
  resetGeneAcc(w);
  // The breach widens (config.arenaGrowEvery): new ground with nests, and the crystal may gain a ring.
  const radius = arenaRadius(data, w.wave);
  const before = arenaRadius(data, w.wave - 1);
  if (radius !== before) {
    const ring = crystalRing(data, w.wave);
    const nests = plantNests(w, data, st, prof, before);
    events.push({ type: 'arenaGrow', radius, ring, ringGrew: ring !== crystalRing(data, w.wave - 1), nests });
  }
  const boss = isBossWave(data, w.wave, w.tier);
  const kinds = ENEMY_KINDS.filter((k) => k !== 'boss' && data.enemies[k].weight > 0 && data.enemies[k].firstWave <= w.wave);
  const weights = kinds.map((k) => data.enemies[k].weight);
  const queue: EnemyKind[] = boss ? ['boss'] : [];
  // A boss wave brings fewer regular viruses (the boss is the wave's threat, not an extra on top).
  const n = Math.floor(enemiesPerWave(data, w.wave) * (boss ? data.config.bossWaveEnemyMul : 1));
  for (let i = 0; i < n; i++) queue.push(pickWeighted(w.rng.spawn, kinds, weights));
  w.marks.plan = markPlan(w.seed, w.wave, n, maxMarks(data));
  // Barrier (card): the shield refills at every wave start.
  if (prof.shieldFrac > 0) w.shield = clampValue(st.health * prof.shieldFrac);
  // Structures (spec 2026-10-15): this wave's wall ring, repairs and push-out (before the Wave Skip return: the ring is per wave).
  prepareStructures(w, data, st, prof, events);
  // Wave Skip (card): a regular wave may be skipped on its own stream; its kill rewards are paid at once.
  if (!boss && prof.waveSkip > 0 && queue.length > 0 && chance(createStream(w.seed, `skip:${w.wave}`), prof.waveSkip)) {
    const tier = data.tiers[w.tier - 1]!;
    let energy = 0;
    let bits = 0;
    for (const k of queue) {
      energy += scaleForWave(data.enemies[k].energy, 1, data.config.energyGrowth, w.wave);
      bits += scaleForWave(data.enemies[k].bits, tier.bitsMul, data.config.bitsGrowth, w.wave);
    }
    energy = clampValue(energy * (1 + st.energyBonus) * (boostActive(w) ? data.perks.boost.energyMul : 1));
    bits = clampValue(bits * (1 + st.bitsPerKill));
    w.energy = clampValue(w.energy + energy);
    w.bits = clampValue(w.bits + bits);
    queue.length = 0;
    w.marks.plan = [];
    events.push({ type: 'waveStart', wave: w.wave, boss });
    events.push({ type: 'waveSkip', wave: w.wave, energy, bits });
    w.spawnQueue = queue;
    w.spawnInterval = 1;
    w.nextSpawnTick = 1;
    return;
  }
  w.spawnQueue = queue;
  w.spawnInterval = queue.length > 0 ? Math.max(1, Math.floor((waveTicks(data) * SPAWN_WINDOW) / queue.length)) : 1;
  w.nextSpawnTick = 1;
  events.push({ type: 'waveStart', wave: w.wave, boss });
}

/**
 * Bounty Marks (spec 2026-10-16): which of a wave's `n` regular spawns are Marked, on the wave's own stream
 * (createStream(seed, 'mark:' + wave)) so Marks never perturb spawns or combat. Up to `max` distinct entries,
 * each the spawn-queue length left when that virus spawns (1 = the last); the first `count` (the tier's) apply.
 */
export function markPlan(seed: number, wave: number, n: number, max: number): number[] {
  const plan: number[] = [];
  if (max <= 0 || n <= 0) return plan;
  const rng = createStream(seed, `mark:${wave}`);
  while (plan.length < Math.min(max, n)) {
    const r = 1 + nextInt(rng, n);
    if (!plan.includes(r)) plan.push(r);
  }
  return plan;
}

/** Marks a fresh spawn when the Bounty Marks tier says so: the boss (from tier III), or a planned regular virus. */
function markSpawn(w: World, e: Enemy, left: number, prof: PerkProfile): void {
  const m = prof.mark;
  if (m === null) return;
  if (e.kind === 'boss') {
    if (m.bossBitsMul > 0) e.marked = true;
    return;
  }
  const i = w.marks.plan.indexOf(left);
  if (i >= 0 && i < m.count) e.marked = true;
}

/**
 * Creates an enemy scaled for the current wave and tier (× the enemyHp rule, e.g. Greedy Protocol);
 * also used directly by tests and the dev spawner.
 */
export function spawnEnemy(w: World, data: GameData, kind: EnemyKind, x: number, y: number, events: SimEvent[], hpMul = perkProfile(w, data).rules.enemyHp): Enemy {
  const def = data.enemies[kind];
  const tier = data.tiers[w.tier - 1]!;
  const c = data.config;
  const wave = Math.max(1, w.wave);
  // Late wall: from config.lateWave on, HP and damage grow by an extra factor per wave, so every build
  // eventually meets a wall (no endless snowball); meta progress pushes the wall back.
  const late = powInt(c.lateGrowth, Math.max(0, wave - c.lateWave));
  const hp = clampValue(scaleForWave(def.hp, tier.hpMul, tier.hpGrowth, wave) * hpMul * late);
  const e: Enemy = {
    id: w.nextId++,
    kind,
    x,
    y,
    hp,
    maxHp: hp,
    damage: clampValue(scaleForWave(def.damage, tier.damageMul, tier.damageGrowth, wave) * late),
    speed: def.speed * (tier.speedMul ?? 1) * arenaSpeed(data, wave),
    radius: def.radius,
    standoff: def.standoff,
    attackIntervalTicks: (def.attackInterval * c.tickHz) / (def.standoff > 0 ? (tier.rangedRateMul ?? 1) : 1),
    attackCd: 0,
    energy: scaleForWave(def.energy, 1, c.energyGrowth, wave),
    bits: scaleForWave(def.bits, tier.bitsMul, c.bitsGrowth, wave),
    slow: 0,
    slowUntil: 0,
    frozenUntil: 0,
    kbUntil: 0,
  };
  w.enemies.push(e);
  events.push({ type: 'spawn', id: e.id, kind, x, y });
  return e;
}

/** Plants nests on infected cells just inside the old spawn ring `r0` (rng.spawn); returns how many. */
function plantNests(w: World, data: GameData, st: CoreStats, prof: PerkProfile, r0: number): number {
  const t = data.territory;
  // No nest inside the wall ring (a nest planted there would spawn viruses behind the wall); without a wall the pool is untouched.
  const ring = prof.structures.wall !== undefined ? wallRadius(data, st, w.wave) + data.structures.wall.contestDist : 0;
  const g = terrainFor(data);
  // The band just inside the old edge (now well within the wider ring), capped at nestMaxRadius.
  const hi = Math.min(r0, t.nestMaxRadius);
  const lo = Math.max(0, hi - 3 * t.cellSize);
  const pool: number[] = [];
  for (let i = 0; i < g.x.length; i++) {
    if (w.terrain[i] === 0 && g.d2[i]! >= lo * lo && g.d2[i]! <= hi * hi && g.d2[i]! >= ring * ring && !w.nests.includes(i)) pool.push(i);
  }
  let n = 0;
  while (n < t.nestsPerGrow && w.nests.length < t.maxNests && pool.length > 0) {
    w.nests.push(pool.splice(nextInt(w.rng.spawn, pool.length), 1)[0]!);
    n += 1;
  }
  return n;
}

/** A nest whose cell was reclaimed is destroyed and pays out; a living one spawns every nestEvery wave ticks. */
function updateNests(w: World, data: GameData, events: SimEvent[], hpMul: number): void {
  if (w.nests.length === 0) return;
  const t = data.territory;
  const g = terrainFor(data);
  const spawnNow = w.phase === 'wave' && w.phaseTick > 0 && w.phaseTick % t.nestEvery === 0;
  const wave = Math.max(1, w.wave);
  const keep: number[] = [];
  for (const id of w.nests) {
    const x = g.x[id]!;
    const y = g.y[id]!;
    if (w.terrain[id] === 1) {
      const energy = clampValue(t.nestEnergy * powInt(data.config.energyGrowth, wave));
      const bits = clampValue(t.nestBits * powInt(data.config.bitsGrowth, wave));
      w.energy = clampValue(w.energy + energy);
      w.bits = clampValue(w.bits + bits);
      events.push({ type: 'nestDestroyed', x, y, energy, bits });
      continue;
    }
    keep.push(id);
    if (spawnNow) spawnEnemy(w, data, t.nestKind, x, y, events, hpMul);
  }
  w.nests = keep;
}

/**
 * End-of-wave income: Interest on unspent Energy (capped: interestCap × interestCapGrowth^(wave−1)),
 * then flat Energy/Wave (× the rewarded boost) and Bits/Wave.
 */
export function payWaveRewards(w: World, data: GameData, st: CoreStats, events: SimEvent[]): void {
  const cap = clampValue(st.interestCap * powInt(data.stats.economy.interestCapGrowth, Math.max(0, w.wave - 1)));
  const interest = Math.min(clampValue(w.energy * st.interest), cap);
  const perWave = clampValue(st.energyPerWave * (boostActive(w) ? data.perks.boost.energyMul : 1));
  w.energy = clampValue(w.energy + interest + perWave);
  w.bits = clampValue(w.bits + st.bitsPerWave);
  events.push({ type: 'waveReward', wave: w.wave, energy: perWave, interest, bits: st.bitsPerWave });
}

/**
 * Advances the wave/pause timer by one tick, starting waves, spawning due enemies and paying wave ends.
 * A wave end that is a pick wave (≥ 2; the wave-1 pick opens the run) opens a protocol pick.
 */
export function advanceWave(w: World, data: GameData, st: CoreStats, prof: PerkProfile, events: SimEvent[]): void {
  updateNests(w, data, events, prof.rules.enemyHp);
  if (w.phase === 'pause') {
    if (w.phaseTick < pauseTicks(data)) {
      w.phaseTick += 1;
      return;
    }
    startWave(w, data, st, prof, events);
  }
  w.phaseTick += 1;
  const r = arenaRadius(data, w.wave);
  while (w.spawnQueue.length > 0 && w.phaseTick >= w.nextSpawnTick) {
    const left = w.spawnQueue.length;
    const kind = w.spawnQueue.shift()!;
    const [dx, dy] = data.directions[nextInt(w.rng.spawn, data.directions.length)]!;
    markSpawn(w, spawnEnemy(w, data, kind, dx * r, dy * r, events, prof.rules.enemyHp), left, prof);
    w.nextSpawnTick += w.spawnInterval;
  }
  if (w.phaseTick >= waveTicks(data)) {
    w.phase = 'pause';
    w.phaseTick = 0;
    events.push({ type: 'waveEnd', wave: w.wave });
    payWaveRewards(w, data, st, events);
    payStations(w, data, st, prof, events);
    if (w.protocols && w.wave >= 2 && isPickWave(data, w.wave, w.lab.pickEvery)) enterPick(w, data, events);
  }
}

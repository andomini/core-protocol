// Tier bosses (uniqueness plan item 8, c1; notes in docs/superpowers/plans/2026-10-20-uniqueness-notes-c1.md).
// Each tier names a boss in bosses.json: an `enemies.boss` scaled by its numbers, with one mechanic keyed by its data
// fields (not by the id): a telegraphed shield, a brood on every step of HP lost, an Energy drain that heals, a Carrier
// aura (viruses.ts), a far standoff, a forced mutation plus an enrage. The tier's FINALE wave always brings its boss.
// Boss state lives in optional Enemy fields (boss, finale, bt, brood, drained, enraged): no World version bump.
import type { BossDef, GameData } from './data';
import { scaleForWave } from './economy';
import type { SimEvent } from './events';
import { dominantTag, geneMean } from './mutations';
import { clampValue } from './num';
import type { Enemy, World } from './state';
import { spawnEnemy } from './waves';

/** The tier boss's definition for `e` (undefined: not a tier boss). */
export function bossDef(data: GameData, e: Enemy): BossDef | undefined {
  return e.boss === undefined ? undefined : data.bosses.bosses[e.boss];
}

/** The boss id of `tier` (undefined: the plain boss). */
export function tierBossId(data: GameData, tier: number): string | undefined {
  return data.tiers[tier - 1]?.boss;
}

/** The tier's FINALE wave: a guaranteed boss wave whose boss kill unlocks the next tier. */
export function isFinaleWave(data: GameData, wave: number, tier: number): boolean {
  const f = data.tiers[tier - 1]?.finale;
  return f !== undefined && wave === f;
}

/**
 * A freshly spawned `boss` becomes its tier's boss: HP × hpMul (× finaleHpMul on the FINALE), radius, speed, damage and
 * the ranged overrides; the Mutagen forces its genome levels at once (the dominant tag, as at a mutation wave).
 */
export function applyBoss(w: World, data: GameData, e: Enemy, events: SimEvent[]): void {
  const tier = data.tiers[w.tier - 1]!;
  const id = tier.boss;
  if (id === undefined) return;
  const b = data.bosses.bosses[id]!;
  const finale = isFinaleWave(data, w.wave, w.tier);
  const hp = clampValue(e.maxHp * b.hpMul * (finale ? data.bosses.finaleHpMul : 1));
  e.hp = hp;
  e.maxHp = hp;
  e.radius = b.radius;
  e.speed = e.speed * b.speedMul;
  e.damage = clampValue(e.damage * b.damageMul);
  if (b.standoff !== undefined) e.standoff = b.standoff;
  if (b.standoff !== undefined || b.attackInterval !== undefined) {
    const sec = b.attackInterval ?? data.enemies.boss.attackInterval;
    e.attackIntervalTicks = (sec * data.config.tickHz) / (e.standoff > 0 ? (tier.rangedRateMul ?? 1) : 1);
  }
  e.boss = id;
  e.bt = 0;
  if (finale) e.finale = true;
  const n = b.mutations ?? 0;
  for (let i = 0; i < n; i++) {
    const t = dominantTag(w, data, geneMean(w));
    if (t === null) break;
    w.genome[t] += 1;
    events.push({ type: 'mutation', tag: t, level: w.genome[t] });
    events.push({ type: 'bossMech', enemyId: e.id, boss: id, mech: 'mutate', x: e.x, y: e.y, value: w.genome[t] });
  }
}

/** Shield cycle at boss age `bt` (ticks): 0 = open, 1 = telegraph, 2 = shielded. No shield → 0. */
export function shieldPhase(data: GameData, def: BossDef | undefined, bt: number): 0 | 1 | 2 {
  if (def === undefined || def.shieldEvery === undefined) return 0;
  const hz = data.config.tickHz;
  const every = Math.max(1, Math.floor(def.shieldEvery * hz));
  const up = every - Math.floor(def.shieldSec! * hz);
  const warn = up - Math.floor(def.shieldWarn! * hz);
  const t = bt % every;
  return t >= up ? 2 : t >= warn ? 1 : 0;
}

/** Share (0..1) of the current shield or telegraph phase already elapsed (render cue). */
export function shieldProgress(data: GameData, def: BossDef | undefined, bt: number): number {
  if (def === undefined || def.shieldEvery === undefined) return 0;
  const hz = data.config.tickHz;
  const every = Math.max(1, Math.floor(def.shieldEvery * hz));
  const sec = Math.floor(def.shieldSec! * hz);
  const up = every - sec;
  const wn = Math.floor(def.shieldWarn! * hz);
  const t = bt % every;
  if (t >= up) return (t - up) / Math.max(1, sec);
  if (t >= up - wn) return (t - (up - wn)) / Math.max(1, wn);
  return 0;
}

/** True while `e` is a shielded boss: hits do nothing. */
export function bossShielded(data: GameData, e: Enemy): boolean {
  return e.boss !== undefined && shieldPhase(data, bossDef(data, e), e.bt ?? 0) === 2;
}

/** Every tick of a living tier boss (updateEnemies, before the freeze check: the clock runs while frozen). */
export function tickBoss(data: GameData, e: Enemy, events: SimEvent[]): void {
  const b = bossDef(data, e);
  if (b === undefined) return;
  const bt = (e.bt ?? 0) + 1;
  e.bt = bt;
  if (b.shieldEvery !== undefined) {
    const was = shieldPhase(data, b, bt - 1);
    const now = shieldPhase(data, b, bt);
    if (now !== was) events.push({ type: 'bossMech', enemyId: e.id, boss: e.boss!, mech: now === 1 ? 'shieldWarn' : now === 2 ? 'shieldUp' : 'shieldDown', x: e.x, y: e.y });
  }
  if (b.enrageAt !== undefined && e.enraged !== true && e.hp < e.maxHp * b.enrageAt) {
    e.enraged = true;
    e.speed = e.speed * b.enrageSpeed!;
    events.push({ type: 'bossMech', enemyId: e.id, boss: e.boss!, mech: 'enrage', x: e.x, y: e.y });
  }
}

/**
 * Broodmother: after a hit that leaves it alive, every `broodStep` of max HP lost since the last brood releases
 * `broodCount` × `broodKind` around it (fixed directions by id and brood index, no RNG draw). The brood does not split.
 */
export function broodCheck(w: World, data: GameData, e: Enemy, hpMul: number, events: SimEvent[]): void {
  const b = bossDef(data, e);
  if (b === undefined || b.broodStep === undefined || e.hp <= 0) return;
  const due = Math.floor((1 - e.hp / e.maxHp) / b.broodStep);
  const kind = b.broodKind!;
  const dirs = data.directions;
  const stride = Math.max(1, Math.floor(dirs.length / b.broodCount!));
  const off = e.radius * 1.2;
  while ((e.brood ?? 0) < due) {
    const k = e.brood ?? 0;
    e.brood = k + 1;
    for (let i = 0; i < b.broodCount!; i++) {
      const [dx, dy] = dirs[(e.id * 7 + k * 3 + i * stride) % dirs.length]!;
      const c = spawnEnemy(w, data, kind, e.x + dx * off, e.y + dy * off, events, hpMul);
      c.gen = data.enemies[kind].splitGens ?? 0;
    }
    events.push({ type: 'bossMech', enemyId: e.id, boss: e.boss!, mech: 'brood', x: e.x, y: e.y, value: e.brood });
  }
}

/**
 * Siphon: a landed core hit drains `drainEnergy` (wave-scaled like kill Energy) from the run, never below 0, and heals
 * `drainHeal` of max HP in proportion to what it got; the kill pays the drained Energy back × drainReturn.
 */
export function drainCore(w: World, data: GameData, e: Enemy, events: SimEvent[]): void {
  const b = bossDef(data, e);
  if (b === undefined || b.drainEnergy === undefined) return;
  const want = scaleForWave(b.drainEnergy, 1, data.config.energyGrowth, Math.max(1, w.wave));
  const got = Math.min(Math.max(0, w.energy), want);
  if (!(got > 0)) return;
  w.energy = clampValue(w.energy - got);
  e.drained = clampValue((e.drained ?? 0) + got);
  e.hp = Math.min(e.maxHp, clampValue(e.hp + e.maxHp * b.drainHeal! * (got / want)));
  events.push({ type: 'bossMech', enemyId: e.id, boss: e.boss!, mech: 'drain', x: e.x, y: e.y, value: got });
}

/** Siphon: the Energy its kill pays back on top of its own reward (0 when it drained none). */
export function drainedReturn(data: GameData, e: Enemy): number {
  const d = e.drained ?? 0;
  return d > 0 ? clampValue(d * (bossDef(data, e)?.drainReturn ?? 0)) : 0;
}

// Run statistics (The Tower-style "Stats"): collected from sim events outside the World (render layer),
// saved with the run snapshot, folded into lifetime totals when the run is paid out.
import { ENEMY_KINDS, type EnemyKind } from '../sim/data';
import type { SimEvent } from '../sim/events';

export type DamageSource = 'shot' | 'bounce' | 'lightning' | 'tesla' | 'thorns';
export const DAMAGE_SOURCES: readonly DamageSource[] = ['shot', 'bounce', 'lightning', 'tesla', 'thorns'];

export interface RunStats {
  /** Sim ticks played (from the world) and real time with the game running (ms). */
  realMs: number;
  kills: Record<EnemyKind, number>;
  /** Damage actually dealt (no overkill) by source. */
  damage: Record<DamageSource, number>;
  critDamage: number;
  hits: number;
  crits: number;
  maxHit: number;
  /** Damage the core took, by kind of attacker (after defense and shield). */
  takenMelee: number;
  takenRanged: number;
  hitsTaken: number;
  blocked: number;
  absorbed: number;
  healedLifesteal: number;
  energyFromKills: number;
  energySpent: number;
  levelsBought: number;
  freeUpgrades: number;
  bitsFromKills: number;
  keysFromKills: number;
  picks: number;
  rerolls: number;
  boosts: number;
  revives: number;
  waveSkips: number;
  freezes: number;
  bolts: number;
}

const kinds = (): Record<EnemyKind, number> => Object.fromEntries(ENEMY_KINDS.map((k) => [k, 0])) as Record<EnemyKind, number>;
const sources = (): Record<DamageSource, number> => Object.fromEntries(DAMAGE_SOURCES.map((k) => [k, 0])) as Record<DamageSource, number>;

export function emptyRunStats(): RunStats {
  return {
    realMs: 0,
    kills: kinds(),
    damage: sources(),
    critDamage: 0,
    hits: 0,
    crits: 0,
    maxHit: 0,
    takenMelee: 0,
    takenRanged: 0,
    hitsTaken: 0,
    blocked: 0,
    absorbed: 0,
    healedLifesteal: 0,
    energyFromKills: 0,
    energySpent: 0,
    levelsBought: 0,
    freeUpgrades: 0,
    bitsFromKills: 0,
    keysFromKills: 0,
    picks: 0,
    rerolls: 0,
    boosts: 0,
    revives: 0,
    waveSkips: 0,
    freezes: 0,
    bolts: 0,
  };
}

/** Folds one sim event into the stats. */
export function recordEvent(s: RunStats, e: SimEvent): void {
  switch (e.type) {
    case 'hit':
      s.damage[e.source] += e.dealt;
      s.hits += 1;
      if (e.crit) {
        s.crits += 1;
        s.critDamage += e.dealt;
      }
      if (e.damage > s.maxHit) s.maxHit = e.damage;
      s.healedLifesteal += e.healed;
      return;
    case 'kill':
      s.kills[e.kind] += 1;
      s.energyFromKills += e.energy;
      s.bitsFromKills += e.bits;
      s.keysFromKills += e.keys;
      return;
    case 'coreHit':
      s.hitsTaken += 1;
      if (e.blocked) s.blocked += 1;
      s.absorbed += e.absorbed;
      if (e.ranged) s.takenRanged += e.damage;
      else s.takenMelee += e.damage;
      return;
    case 'buy':
      s.energySpent += e.cost;
      s.levelsBought += e.levels;
      if (e.free) s.freeUpgrades += 1;
      return;
    case 'perkPicked':
      s.picks += 1;
      return;
    case 'pickOffer':
      if (e.rerolls > 0) s.rerolls += 1;
      return;
    case 'boost':
      s.boosts += 1;
      return;
    case 'revive':
      s.revives += 1;
      return;
    case 'waveSkip':
      s.waveSkips += 1;
      return;
    case 'freeze':
      s.freezes += 1;
      return;
    case 'freezeAll':
      s.freezes += e.count;
      return;
    case 'lightning':
      s.bolts += 1;
      return;
    default:
      return;
  }
}

export function totalDamage(s: RunStats): number {
  let t = 0;
  for (const k of DAMAGE_SOURCES) t += s.damage[k];
  return t;
}

export function totalKills(k: Record<EnemyKind, number>): number {
  let t = 0;
  for (const x of ENEMY_KINDS) t += k[x];
  return t;
}

/** Normalises a stored blob (missing fields → 0). */
export function validateRunStats(raw: unknown): RunStats {
  const s = emptyRunStats();
  if (typeof raw !== 'object' || raw === null) return s;
  const r = raw as Record<string, unknown>;
  const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) && x >= 0 ? x : 0);
  for (const [k, v] of Object.entries(s)) {
    if (typeof v === 'number') (s as unknown as Record<string, number>)[k] = num(r[k]);
  }
  for (const k of ENEMY_KINDS) s.kills[k] = num((r.kills as Record<string, unknown> | undefined)?.[k]);
  for (const k of DAMAGE_SOURCES) s.damage[k] = num((r.damage as Record<string, unknown> | undefined)?.[k]);
  return s;
}

export interface LifetimeStats {
  runs: number;
  realMs: number;
  simTicks: number;
  waves: number;
  kills: Record<EnemyKind, number>;
  damage: number;
  maxHit: number;
  hitsTaken: number;
  bitsEarned: number;
  keysEarned: number;
  energyEarned: number;
  levelsBought: number;
  picks: number;
  revives: number;
}

export function emptyLifetime(): LifetimeStats {
  return { runs: 0, realMs: 0, simTicks: 0, waves: 0, kills: kinds(), damage: 0, maxHit: 0, hitsTaken: 0, bitsEarned: 0, keysEarned: 0, energyEarned: 0, levelsBought: 0, picks: 0, revives: 0 };
}

export function validateLifetime(raw: unknown): LifetimeStats {
  const l = emptyLifetime();
  if (typeof raw !== 'object' || raw === null) return l;
  const r = raw as Record<string, unknown>;
  const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) && x >= 0 ? x : 0);
  for (const [k, v] of Object.entries(l)) if (typeof v === 'number') (l as unknown as Record<string, number>)[k] = num(r[k]);
  for (const k of ENEMY_KINDS) l.kills[k] = num((r.kills as Record<string, unknown> | undefined)?.[k]);
  return l;
}

export interface RunTotals {
  waves: number;
  simTicks: number;
  bits: number;
  keys: number;
  energyEarned: number;
}

/** Adds a finished run (its stats and settlement) to the lifetime totals. */
export function addRunToLifetime(l: LifetimeStats, s: RunStats, t: RunTotals): void {
  l.runs += 1;
  l.realMs += s.realMs;
  l.simTicks += t.simTicks;
  l.waves += t.waves;
  for (const k of ENEMY_KINDS) l.kills[k] += s.kills[k];
  l.damage += totalDamage(s);
  l.maxHit = Math.max(l.maxHit, s.maxHit);
  l.hitsTaken += s.hitsTaken;
  l.bitsEarned += t.bits;
  l.keysEarned += t.keys;
  l.energyEarned += t.energyEarned;
  l.levelsBought += s.levelsBought;
  l.picks += s.picks;
  l.revives += s.revives;
}

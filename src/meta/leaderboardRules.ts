// Leaderboard rules shared by the client and the replay verifier (spec 2026-10-16-leaderboards-design.md):
// the loadout claim a submission carries, the RunOptions it rebuilds, the daily challenge (seed + fixed
// loadout from data), UTC day/week keys, and the Bits allowance a tier-board loadout is checked against.
import lbJson from '../data/leaderboard.json';
import { type GameData, STAT_IDS, type StatId } from '../sim/data';
import type { RunOptions } from '../sim/state';
import { curveSum } from '../sim/stats';
import { cardDef, cardSlots, loadoutBonus } from './cards';
import { labEffects } from './labs';
import { labNode, type MetaData } from './metaData';
import { buildRunOptions } from './runOptions';
import { defaultMeta, type MetaState } from './state';
import { workshopCurve, workshopMax, workshopUnlocked } from './workshop';

export interface DailyLoadout {
  id: string;
  workshop: Partial<Record<StatId, number>>;
  labs: string[];
  cards: Record<string, number>;
}

export interface LeaderboardData {
  minWave: number;
  /** A longer command log is not accepted (client: the run is not ranked). */
  maxLogEntries: number;
  /** paidAttemptsPerDay: daily attempts per UTC day that pay Bits/Keys (later ones only rank). */
  daily: { tier: number; paidAttemptsPerDay: number; loadouts: DailyLoadout[] };
  /** Tier boards: a loadout may cost up to freeBits + earnedMul × Bits earned in the player's verified runs. */
  allowance: { freeBits: number; earnedMul: number };
}

export const LEADERBOARD: LeaderboardData = lbJson as unknown as LeaderboardData;

/**
 * What a ranked run was started with: workshop levels, owned lab nodes and the equipped cards (id → copies,
 * in loadout order). The verifier rebuilds the RunOptions from it, so a submission cannot carry made-up effects.
 */
export interface LoadoutClaim {
  workshop: Partial<Record<StatId, number>>;
  labs: string[];
  cards: Record<string, number>;
}

export function claimFromMeta(m: MetaState, md: MetaData): LoadoutClaim {
  const cards: Record<string, number> = {};
  for (const id of m.loadout.slice(0, cardSlots(m, md))) if ((m.cards[id] ?? 0) > 0) cards[id] = m.cards[id]!;
  return { workshop: { ...m.workshop }, labs: [...m.labs], cards };
}

export function metaFromClaim(c: LoadoutClaim): MetaState {
  return { ...defaultMeta(), workshop: { ...c.workshop }, labs: [...c.labs], cards: { ...c.cards }, loadout: Object.keys(c.cards) };
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const isCount = (x: unknown, max: number): x is number => typeof x === 'number' && Number.isInteger(x) && x >= 0 && x <= max;

/** Why a claim is impossible in this build, or null when it is a loadout a real save could have. */
export function claimError(raw: unknown, data: GameData, md: MetaData): string | null {
  if (!isObj(raw) || !isObj(raw.workshop) || !Array.isArray(raw.labs) || !isObj(raw.cards)) return 'claim: bad shape';
  const labs = raw.labs;
  if (!labs.every((x): x is string => typeof x === 'string' && labNode(md, x) !== undefined)) return 'claim: unknown lab node';
  if (new Set(labs).size !== labs.length) return 'claim: duplicate lab node';
  for (const id of labs) if (!labNode(md, id)!.requires.every((r) => labs.includes(r))) return `claim: lab ${id} without its prerequisites`;
  const m = metaFromClaim({ workshop: {}, labs, cards: {} });
  for (const [id, lvl] of Object.entries(raw.workshop)) {
    if (!(STAT_IDS as readonly string[]).includes(id)) return `claim: unknown stat ${id}`;
    const stat = id as StatId;
    if (!isCount(lvl, 1e6) || lvl > workshopMax(m, data, md, stat)) return `claim: bad workshop level for ${id}`;
    if (lvl > 0 && !workshopUnlocked(m, data, md, stat)) return `claim: workshop ${id} is locked`;
  }
  const ids = Object.keys(raw.cards);
  if (ids.length > cardSlots(m, md)) return 'claim: more cards than slots';
  for (const id of ids) {
    if (!cardDef(id)) return `claim: unknown card ${id}`;
    const n = raw.cards[id];
    if (!isCount(n, 1e6) || n < 1) return `claim: bad copies for ${id}`;
  }
  return null;
}

/** The RunOptions a claim starts a run with: exactly buildRunOptions on a save holding only that loadout. */
export function runOptionsFromClaim(c: LoadoutClaim, data: GameData, md: MetaData, tier: number, seed: number): RunOptions {
  return buildRunOptions(metaFromClaim(c), data, md, tier, seed);
}

/** Bits a save must have spent on the claim: every workshop level on its price curve plus the lab nodes. */
export function loadoutBits(c: LoadoutClaim, md: MetaData): number {
  let s = 0;
  for (const [id, lvl] of Object.entries(c.workshop) as [StatId, number][]) s += curveSum(workshopCurve(md, id), 0, lvl);
  for (const id of c.labs) s += labNode(md, id)?.cost ?? 0;
  return s;
}

/** A generous ceiling on the Bits a run paid out: World.bits × lab and card multipliers × the rewarded doubling. */
export function earnedBits(worldBits: number, c: LoadoutClaim, md: MetaData): number {
  const m = metaFromClaim(c);
  return Math.floor(worldBits * labEffects(m, md).bitsMul * loadoutBonus(m, md).bitsMul * md.ads.doubleBits);
}

/** The most a tier-board loadout may cost for a player with `verifiedBits` earned in verified runs. */
export function allowanceBits(verifiedBits: number, lb: LeaderboardData = LEADERBOARD): number {
  return lb.allowance.freeBits + lb.allowance.earnedMul * Math.max(0, verifiedBits);
}

const DAY_MS = 86_400_000;

/** UTC date "YYYY-MM-DD" of an epoch-ms time. */
export function dayKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Days since 1970-01-01 for a "YYYY-MM-DD" key (NaN if malformed). */
export function dayIndex(day: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return NaN;
  const t = Date.parse(`${day}T00:00:00Z`);
  return Number.isFinite(t) && dayKey(t) === day ? Math.floor(t / DAY_MS) : NaN;
}

/** Weekly season key: the UTC date of the Monday (00:00 UTC) starting the week of `ms`. */
export function weekKey(ms: number): string {
  const d = Math.floor(ms / DAY_MS);
  // 1970-01-01 was a Thursday: (d + 3) mod 7 = days since Monday.
  return dayKey((d - ((d + 3) % 7)) * DAY_MS);
}

/** Everyone's seed for the daily challenge of `day`: FNV-1a over "core-protocol:daily:<day>" (never 0). */
export function dailySeed(day: string): number {
  const s = `core-protocol:daily:${day}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0 || 1;
}

/** The fixed loadout of `day` (rotates through leaderboard.json daily.loadouts by day index). */
export function dailyLoadout(day: string, lb: LeaderboardData = LEADERBOARD): DailyLoadout {
  const n = lb.daily.loadouts.length;
  const i = dayIndex(day);
  return lb.daily.loadouts[(((Number.isFinite(i) ? i : 0) % n) + n) % n]!;
}

export function dailyClaim(day: string, lb: LeaderboardData = LEADERBOARD): LoadoutClaim {
  const l = dailyLoadout(day, lb);
  return { workshop: { ...l.workshop }, labs: [...l.labs], cards: { ...l.cards } };
}

/** The daily challenge run: the day's seed, the data's tier and the day's fixed loadout (the player's meta is not used). */
/** The day's run; `seed` is the server-issued one (secret daily seeds), else the public dailySeed(day). */
export function dailyRunOptions(day: string, data: GameData, md: MetaData, lb: LeaderboardData = LEADERBOARD, seed: number = dailySeed(day)): RunOptions {
  return runOptionsFromClaim(dailyClaim(day, lb), data, md, lb.daily.tier, seed);
}

/** Same loadout (key order ignored). */
export function sameClaim(a: LoadoutClaim, b: LoadoutClaim): boolean {
  const norm = (c: LoadoutClaim) =>
    JSON.stringify([
      Object.entries(c.workshop)
        .filter(([, v]) => (v ?? 0) > 0)
        .sort(),
      [...c.labs].sort(),
      Object.entries(c.cards).sort(),
    ]);
  return norm(a) === norm(b);
}

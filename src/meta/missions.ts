// Daily missions (uniqueness plan item 10): 3 missions a UTC day, picked deterministically from the day index
// (leaderboardRules dayKey/dayIndex), targets scaled to the player, progress folded in at settlement, Keys
// paid once on completion. Plus the Home "NEXT" track: the nearest tier / Bits / Keys goals.
// Pure and deterministic: `now` is always passed in; no Math.random, no Date.now().
import missionsJson from '../data/missions.json';
import type { GameData, StatId } from '../sim/data';
import { TAGS, type Tag } from '../sim/perkData';
import { fusionTierIndex } from '../sim/crystal';
import { tagCounts } from '../sim/perks';
import type { World } from '../sim/state';
import { CARDS } from './cards';
import { labState } from './labs';
import { dayIndex, dayKey } from './leaderboardRules';
import { type MetaData, unlockWaveFor } from './metaData';
import type { RunStats } from './runStats';
import type { MetaState } from './state';
import { workshopCost, workshopMax, workshopUnlocked } from './workshop';

export const MISSION_KINDS = ['wave', 'kills', 'fusion', 'nests', 'levels', 'bits', 'tagWave', 'waves', 'beacon'] as const; // c2: beacon
export type MissionKind = (typeof MISSION_KINDS)[number];
export const SCALE_REFS = ['bestWave', 'avgKills', 'avgLevels', 'avgBits', 'avgWaves'] as const;
export type ScaleRef = (typeof SCALE_REFS)[number];

export interface MissionDef {
  id: string;
  kind: MissionKind;
  /** best: the best single run counts; sum: every run of the day adds up. */
  mode: 'best' | 'sum';
  /** {n} target, {t} tier, {r} target as a roman numeral, {tag} the day's set. */
  text: string;
  /** Lowest target by the player's unlocked tier (index tier − 1; the last entry repeats). */
  targets: number[];
  /** Target = max(targets[tier], ref × frac) rounded down to `step` (0 → two significant digits). */
  scale?: { by: ScaleRef; frac: number };
  step?: number;
  /** Keys paid on completion, by the player's unlocked tier. */
  reward: number[];
}

export interface MissionsData {
  perDay: number;
  /** Mixed into the day hash so the pick sequence is not the daily-challenge one. */
  salt: number;
  templates: MissionDef[];
}

/** One of the day's missions, frozen when the day starts (an unlock later that day does not move it). */
export interface DailyMission {
  id: string;
  target: number;
  reward: number;
  /** wave: the tier the run must be on (or above); others 1. */
  tier: number;
  /** tagWave: the set that must be the largest at the end of the run. */
  tag: Tag | null;
}

export interface MissionsState {
  /** UTC "YYYY-MM-DD" the list belongs to ('' = none yet). */
  day: string;
  list: DailyMission[];
  progress: number[];
  claimed: boolean[];
  /** The last settled run's key and what it added to `sum` missions (a revived run settles again: no double count). */
  last: { key: string; add: number[] } | null;
}

/** What a finished run did, as far as missions care (built where RunResult is built; World is read only). */
export interface MissionRun {
  tier: number;
  wave: number;
  kills: number;
  nests: number;
  levels: number;
  /** Best fusion tier index reached by any pair (I = 1 … Apex = 4). */
  fusion: number;
  /** The largest set at the end of the run (ties in TAGS order), or null. */
  dominant: Tag | null;
  /** Run identity (seed): with MetaState.runs it recognises a revived run settling a second time. */
  seed: number;
  /** c2: wave ends survived by standing beacons this run (World.beaconWaves); absent = 0. */
  beacons?: number;
}

export interface MissionDelta {
  index: number;
  before: number;
  after: number;
  target: number;
  /** Completed by this run (Keys paid now). */
  done: boolean;
  keys: number;
}

function check(c: boolean, msg: string): void {
  if (!c) throw new Error(`missions data: ${msg}`);
}

export function validateMissions(d: MissionsData): MissionsData {
  check(Number.isInteger(d.perDay) && d.perDay >= 1, 'perDay must be a whole number ≥ 1');
  check(Number.isInteger(d.salt), 'salt must be an integer');
  check(Array.isArray(d.templates) && d.templates.length >= d.perDay, 'needs at least perDay templates');
  const ids = new Set<string>();
  const kinds = new Set<string>();
  for (const t of d.templates) {
    const at = `template ${t.id}`;
    check(typeof t.id === 'string' && !ids.has(t.id), `${at}: missing or duplicate id`);
    ids.add(t.id);
    check((MISSION_KINDS as readonly string[]).includes(t.kind), `${at}: unknown kind ${t.kind}`);
    kinds.add(t.kind);
    check(t.mode === 'best' || t.mode === 'sum', `${at}: mode must be best or sum`);
    check(typeof t.text === 'string' && /\{[nr]\}/.test(t.text), `${at}: text needs {n} or {r}`);
    check(t.kind !== 'tagWave' || t.text.includes('{tag}'), `${at}: tagWave text needs {tag}`);
    check(Array.isArray(t.targets) && t.targets.length > 0 && t.targets.every((x) => Number.isFinite(x) && x >= 1), `${at}: targets must be numbers ≥ 1`);
    check(Array.isArray(t.reward) && t.reward.length > 0 && t.reward.every((x) => Number.isInteger(x) && x >= 1), `${at}: reward must be whole Keys ≥ 1`);
    if (t.scale !== undefined) {
      check((SCALE_REFS as readonly string[]).includes(t.scale.by), `${at}: unknown scale.by ${t.scale.by}`);
      check(Number.isFinite(t.scale.frac) && t.scale.frac > 0, `${at}: scale.frac must be > 0`);
    }
    check(t.step === undefined || (Number.isInteger(t.step) && t.step >= 0), `${at}: step must be a whole number ≥ 0`);
  }
  check(kinds.size >= d.perDay, 'needs at least perDay distinct kinds');
  return d;
}

export const MISSIONS: MissionsData = validateMissions(missionsJson as unknown as MissionsData);

export function emptyMissions(): MissionsState {
  return { day: '', list: [], progress: [], claimed: [], last: null };
}

export function missionDef(id: string, md: MissionsData = MISSIONS): MissionDef | undefined {
  return md.templates.find((t) => t.id === id);
}

/** A small integer hash (murmur3 finaliser over two words). */
function hash2(a: number, b: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ b;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  h = Math.imul(h ^ (h >>> 15), 0x27d4eb2f);
  return (h ^ (h >>> 16)) >>> 0;
}

const at = <T>(xs: readonly T[], i: number): T => xs[Math.max(0, Math.min(xs.length - 1, i))]!;

/** Rounds down to `step`, or to two significant digits when step is 0. */
function roundTarget(x: number, step: number): number {
  if (step > 0) return Math.floor(x / step) * step;
  if (x < 100) return Math.floor(x);
  const p = Math.pow(10, Math.floor(Math.log10(x)) - 1);
  return Math.floor(x / p) * p;
}

/** The highest tier the player has a best wave on (1 if none). */
export function refTier(m: MetaState): number {
  let t = 1;
  for (let i = 1; i <= m.tierUnlocked; i++) if ((m.best[String(i)] ?? 0) > 0) t = i;
  return t;
}

function scaleRef(m: MetaState, by: ScaleRef): number {
  const l = m.lifetime;
  const runs = Math.max(1, l.runs);
  switch (by) {
    case 'bestWave':
      return m.best[String(refTier(m))] ?? 0;
    case 'avgKills': {
      let k = 0;
      for (const v of Object.values(l.kills)) k += v;
      return l.runs > 0 ? k / runs : 0;
    }
    case 'avgLevels':
      return l.runs > 0 ? l.levelsBought / runs : 0;
    case 'avgBits':
      return l.runs > 0 ? l.bitsEarned / runs : 0;
    case 'avgWaves':
      return l.runs > 0 ? l.waves / runs : 0;
  }
}

/** The target a template gets for this player today. */
export function missionTarget(t: MissionDef, m: MetaState): number {
  const ti = m.tierUnlocked - 1;
  const floor = at(t.targets, ti);
  const scaled = t.scale ? roundTarget(scaleRef(m, t.scale.by) * t.scale.frac, t.step ?? 0) : 0;
  return Math.max(floor, scaled);
}

/** The day's missions for this player: `perDay` templates of distinct kinds, ordered by a hash of the day index. */
export function missionsFor(day: string, m: MetaState, md: MissionsData = MISSIONS): DailyMission[] {
  const di = dayIndex(day);
  const d = Number.isFinite(di) ? di : 0;
  const order = md.templates.map((t, i) => ({ t, h: hash2(d, md.salt + i * 7919) })).sort((a, b) => a.h - b.h || (a.t.id < b.t.id ? -1 : 1));
  const out: DailyMission[] = [];
  const kinds = new Set<MissionKind>();
  for (const { t } of order) {
    if (out.length >= md.perDay) break;
    if (kinds.has(t.kind)) continue;
    kinds.add(t.kind);
    out.push({
      id: t.id,
      target: missionTarget(t, m),
      reward: at(t.reward, m.tierUnlocked - 1),
      tier: t.kind === 'wave' ? refTier(m) : 1,
      tag: t.kind === 'tagWave' ? TAGS[hash2(d, md.salt ^ 0x5a5a) % TAGS.length]! : null,
    });
  }
  return out;
}

/** Starts a new mission day when the UTC day of `now` differs from the stored one. Returns the (current) state. */
export function ensureMissionDay(m: MetaState, now: number, md: MissionsData = MISSIONS): MissionsState {
  const day = dayKey(now);
  if (m.missions.day !== day) {
    const list = missionsFor(day, m, md);
    m.missions = { day, list, progress: list.map(() => 0), claimed: list.map(() => false), last: null };
  }
  return m.missions;
}

/** Milliseconds until the next UTC midnight (the mission reset). */
export function msToReset(now: number): number {
  const DAY = 86_400_000;
  return DAY - (((now % DAY) + DAY) % DAY);
}

const ROMAN = ['0', 'I', 'II', 'III', 'IV', 'V'];

export function missionText(dm: DailyMission, data: GameData, md: MissionsData = MISSIONS): string {
  const t = missionDef(dm.id, md);
  if (!t) return dm.id;
  return t.text
    .replace('{n}', formatCount(dm.target))
    .replace('{r}', ROMAN[dm.target] ?? String(dm.target))
    .replace('{t}', String(dm.tier))
    .replace('{tag}', dm.tag ? data.sets.tags[dm.tag].name.toUpperCase() : '');
}

function formatCount(n: number): string {
  if (n < 10_000) return String(Math.floor(n));
  if (n < 1e6) return `${Math.floor(n / 100) / 10}K`.replace('.0K', 'K');
  return `${Math.floor(n / 1e5) / 10}M`.replace('.0M', 'M');
}

/** How far one run gets a mission (its value for this mission). */
export function runValue(kind: MissionKind, dm: DailyMission, r: MissionRun, bits: number): number {
  switch (kind) {
    case 'wave':
      return r.tier >= dm.tier ? r.wave : 0;
    case 'kills':
      return r.kills;
    case 'fusion':
      return r.fusion;
    case 'nests':
      return r.nests;
    case 'levels':
      return r.levels;
    case 'bits':
      return bits;
    case 'tagWave':
      return r.dominant !== null && r.dominant === dm.tag ? r.wave : 0;
    case 'waves':
      return Math.max(0, r.wave - 1);
    case 'beacon': // c2
      return r.beacons ?? 0;
  }
}

/**
 * Folds a settled run into the day's missions (starting a new day if needed) and pays the Keys of the missions
 * it completes (once: `claimed`). `bits` = the Bits the settlement paid. A revived run that settles again
 * (same seed and run count, see BattleScene revive) first takes back what it added to `sum` missions.
 */
export function applyMissions(m: MetaState, r: MissionRun, bits: number, now: number, md: MissionsData = MISSIONS): MissionDelta[] {
  const s = ensureMissionDay(m, now, md);
  const key = `${m.runs}:${r.seed}`;
  const prev = s.last && s.last.key === key ? s.last.add : null;
  const add: number[] = [];
  const out: MissionDelta[] = [];
  s.list.forEach((dm, i) => {
    const t = missionDef(dm.id, md);
    if (!t) {
      add.push(0);
      return;
    }
    const before = s.progress[i] ?? 0;
    const v = runValue(t.kind, dm, r, bits);
    let after: number;
    if (t.mode === 'sum') {
      const base = Math.max(0, before - (prev?.[i] ?? 0));
      after = base + v;
      add.push(v);
    } else {
      after = Math.max(before, v);
      add.push(0);
    }
    s.progress[i] = after;
    let done = false;
    let keys = 0;
    if (!s.claimed[i] && after >= dm.target) {
      s.claimed[i] = true;
      done = true;
      keys = dm.reward;
      m.keys += keys;
    }
    out.push({ index: i, before, after, target: dm.target, done, keys });
  });
  s.last = { key, add };
  return out;
}

/** Mission-relevant facts of a dead world and its run stats (read only). */
export function missionRun(w: World, data: GameData, stats: Pick<RunStats, 'levelsBought' | 'nests'>): MissionRun {
  let fusion = 0;
  for (const [k, links] of Object.entries(w.fusionBest)) if (data.sets.fusions[k] !== undefined) fusion = Math.max(fusion, fusionTierIndex(data, k, links));
  const c = tagCounts(w, data);
  let dominant: Tag | null = null;
  for (const t of TAGS) if (c[t] > 0 && (dominant === null || c[t] > c[dominant])) dominant = t;
  return { tier: w.tier, wave: w.wave, kills: w.kills, nests: stats.nests, levels: stats.levelsBought, fusion, dominant, seed: w.seed, beacons: w.beaconWaves ?? 0 }; // c2: beacons
}

export function validateMissionsState(raw: unknown, md: MissionsData = MISSIONS): MissionsState {
  const s = emptyMissions();
  if (typeof raw !== 'object' || raw === null) return s;
  const r = raw as Record<string, unknown>;
  if (typeof r.day !== 'string' || !Array.isArray(r.list)) return s;
  const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) && x >= 0 ? x : 0);
  const list: DailyMission[] = [];
  for (const x of r.list) {
    const o = x as Partial<DailyMission> | null;
    if (!o || typeof o.id !== 'string' || !missionDef(o.id, md)) return emptyMissions();
    list.push({ id: o.id, target: Math.max(1, num(o.target)), reward: Math.floor(num(o.reward)), tier: Math.max(1, Math.floor(num(o.tier))), tag: (TAGS as readonly unknown[]).includes(o.tag) ? (o.tag as Tag) : null });
  }
  s.day = r.day.slice(0, 10);
  s.list = list;
  const pr = Array.isArray(r.progress) ? r.progress : [];
  const cl = Array.isArray(r.claimed) ? r.claimed : [];
  s.progress = list.map((_, i) => num(pr[i]));
  s.claimed = list.map((_, i) => cl[i] === true);
  const last = r.last as { key?: unknown; add?: unknown } | null;
  if (last && typeof last.key === 'string' && Array.isArray(last.add)) s.last = { key: last.key, add: list.map((_, i) => num((last.add as unknown[])[i])) };
  return s;
}

// ---- The NEXT track (Home) ------------------------------------------------------------------------------

export interface Goal {
  kind: 'tier' | 'bits' | 'keys';
  label: string;
  have: number;
  need: number;
}

/** Bits to reach the next workshop mastery step of `stat` (meta.json workshop.mastery.every). */
function masteryStepCost(m: MetaState, md: MetaData, stat: StatId, every: number): { cost: number; level: number } {
  const lvl = m.workshop[stat] ?? 0;
  const next = (Math.floor(lvl / every) + 1) * every;
  let cost = 0;
  const probe: MetaState = { ...m, workshop: { ...m.workshop } };
  for (let l = lvl; l < next; l++) {
    probe.workshop[stat] = l;
    cost += workshopCost(probe, md, stat);
  }
  return { cost, level: next };
}

/**
 * The three nearest goals: the next tier unlock (best wave vs its requirement; past the last tier, the next
 * milestone), the cheapest Bits goal (an available lab node or the next workshop mastery step) and, once the
 * Cards tab is open, the next card pack (Keys).
 */
export function nextGoals(m: MetaState, data: GameData, md: MetaData): Goal[] {
  const out: Goal[] = [];
  const t = m.tierUnlocked;
  if (t < data.tiers.length) {
    out.push({ kind: 'tier', label: `TIER ${t + 1} · wave ${unlockWaveFor(md, t)} on T${t}`, have: m.best[String(t)] ?? 0, need: unlockWaveFor(md, t) });
  } else {
    const w = md.milestones.waves.find((x) => !m.milestones.includes(`${t}:${x}`));
    if (w !== undefined) out.push({ kind: 'tier', label: `MILESTONE · wave ${w} on T${t}`, have: m.best[String(t)] ?? 0, need: w });
  }
  let bits: Goal | null = null;
  for (const n of md.labs.nodes) {
    if (labState(m, md, n.id) !== 'available') continue;
    if (!bits || n.cost < bits.need) bits = { kind: 'bits', label: `LAB · ${n.name}`, have: m.bits, need: n.cost };
  }
  const ms = md.workshop.mastery;
  if (ms) {
    for (const id of Object.keys(ms.mul) as StatId[]) {
      if (!workshopUnlocked(m, data, md, id)) continue;
      const step = masteryStepCost(m, md, id, ms.every);
      if (step.level > workshopMax(m, data, md, id)) continue;
      if (!bits || step.cost < bits.need) bits = { kind: 'bits', label: `MASTERY · ${data.stats.stats[id].name} LV ${step.level}`, have: m.bits, need: step.cost };
    }
  }
  if (bits) out.push(bits);
  if (m.firstRunDone) out.push({ kind: 'keys', label: 'CARD PACK', have: m.keys, need: CARDS.pack.price });
  return out;
}

/** A mission row for the death screen: the run's progress delta and the Keys it paid. */
export interface MissionLine {
  text: string;
  before: number;
  after: number;
  target: number;
  /** Completed by this run. */
  done: boolean;
  /** Completed (now or earlier today). */
  claimed: boolean;
  keys: number;
}

export function missionLines(m: MetaState, s: { missions?: MissionDelta[] }, data: GameData, md: MissionsData = MISSIONS): MissionLine[] {
  const out: MissionLine[] = [];
  for (const d of s.missions ?? []) {
    const dm = m.missions.list[d.index];
    if (!dm) continue;
    out.push({ text: missionText(dm, data, md), before: d.before, after: d.after, target: d.target, done: d.done, claimed: m.missions.claimed[d.index] === true, keys: d.keys });
  }
  return out;
}

/** "120/300" style progress, capped at the target. */
export function progressText(have: number, need: number): string {
  return `${formatCount(Math.min(have, need))}/${formatCount(need)}`;
}

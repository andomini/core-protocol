// Run settlement: Bits (× labs, × rewarded doubling), Keys (boss drops + milestones), best wave, tier unlock.
import { fusionTierIndex } from '../sim/crystal';
import type { GameData } from '../sim/data';
import { labEffects } from './labs';
import { type MetaData, unlockWaveFor } from './metaData';
import { applyMissions, type MissionDelta, type MissionRun } from './missions';
import type { MetaState } from './state';

export interface RunResult {
  tier: number;
  wave: number;
  /** Bits earned in the run (World.bits at death). */
  bits: number;
  /** Keys dropped in the run (World.keys). */
  keys: number;
  /** The ×2 Bits rewarded ad was watched. */
  doubled: boolean;
  /** Card multiplier (Bits Plus) carried with the run. */
  bitsMul?: number;
  /** Best fusion tier (link count) each pair reached in the run (World.fusionBest) — feeds the Codex. */
  fusionsReached?: Record<string, number>;
  /** What the run did for the daily missions (meta/missions.ts missionRun); absent → missions untouched. */
  missions?: MissionRun;
  /** Settlement time (epoch ms): picks the mission day. Required with `missions`. */
  now?: number;
  /** c1: the tier the run's FINALE kill already unlocked mid-run (unlockByFinale); reported as `tierUnlocked`. */
  finaleUnlocked?: number;
}

export interface Settlement {
  bits: number;
  keys: number;
  milestones: number[];
  newBest: boolean;
  /** The tier this run unlocked (0 = none). */
  tierUnlocked: number;
  /** One-off Codex Bits (already in `bits`): pairs that reached III for the first time. */
  codexBits: number;
  /** Pairs newly entered in the Codex this run. */
  codexNew: string[];
  /** A daily attempt beyond the day's paid ones: ranked, but no Bits or Keys. */
  unpaid?: boolean;
  /** Daily mission progress this run made (in list order); Keys of completed ones are already in the save. */
  missions?: MissionDelta[];
  /** Keys the completed missions paid (not in `keys`, which a revive takes back; missions stay claimed). */
  missionKeys?: number;
}

export function settleRun(m: MetaState, data: GameData, md: MetaData, r: RunResult): Settlement {
  const e = labEffects(m, md);
  let bits = Math.floor(r.bits * e.bitsMul * (r.bitsMul ?? 1) * (r.doubled ? md.ads.doubleBits : 1));
  let keys = Math.floor(r.keys);
  const milestones: number[] = [];
  md.milestones.waves.forEach((w, i) => {
    const id = `${r.tier}:${w}`;
    if (r.wave >= w && !m.milestones.includes(id)) {
      m.milestones.push(id);
      milestones.push(w);
      keys += md.milestones.keys[i]! + (r.tier - 1) * md.milestones.keysPerTier;
    }
  });
  const key = String(r.tier);
  const newBest = r.wave > (m.best[key] ?? 0);
  if (newBest) m.best[key] = r.wave;
  let tierUnlocked = 0;
  if (r.wave >= unlockWaveFor(md, r.tier) && r.tier === m.tierUnlocked && m.tierUnlocked < data.tiers.length) {
    m.tierUnlocked += 1;
    tierUnlocked = m.tierUnlocked;
  }
  // c1: a FINALE kill unlocked the next tier mid-run (the wave rule above then finds it already open).
  if (tierUnlocked === 0 && r.finaleUnlocked !== undefined && r.finaleUnlocked > 0) tierUnlocked = r.finaleUnlocked;
  // Fusion Codex: record the best tier per pair; the first III pays md.codex.bits once (flat, not × labs/ad).
  let codexBits = 0;
  const codexNew: string[] = [];
  for (const [k, tier] of Object.entries(r.fusionsReached ?? {})) {
    if (data.sets.fusions[k] === undefined) continue;
    const idx = fusionTierIndex(data, k, tier);
    const was = m.codex[k] ?? 0;
    if (idx <= was) continue;
    if (was === 0) codexNew.push(k);
    if (was < 3 && idx >= 3) codexBits += md.codex.bits;
    m.codex[k] = idx;
  }
  bits += codexBits;
  m.bits += bits;
  m.keys += keys;
  const ms = settleMissions(m, r, bits);
  m.runs += 1;
  m.firstRunDone = true;
  return { bits, keys, milestones, newBest, tierUnlocked, codexBits, codexNew, ...ms };
}

/**
 * c1: the FINALE boss of `tier` died — the next tier opens at once (the same rule as reaching the unlock wave:
 * only from the highest unlocked tier, never past the last). Returns the tier unlocked, 0 = none.
 */
export function unlockByFinale(m: MetaState, data: GameData, tier: number): number {
  if (tier !== m.tierUnlocked || m.tierUnlocked >= data.tiers.length) return 0;
  m.tierUnlocked += 1;
  return m.tierUnlocked;
}

/**
 * A daily-challenge run (fixed loadout, shared seed): pays its Bits (× the player's own lab and ad
 * multipliers) and dropped Keys only — no best wave, milestones, tier unlock or Codex, which belong to the
 * player's own loadout on their tier.
 */
export function settleDaily(m: MetaState, md: MetaData, r: Pick<RunResult, 'bits' | 'keys' | 'doubled' | 'missions' | 'now'>, day: string, paidPerDay: number): Settlement {
  // Only the first `paidPerDay` attempts of a challenge day pay (leaderboard.json daily.paidAttemptsPerDay): the
  // daily is a short, strong fixed loadout, and unlimited restarts would make it the best Bits farm in the game.
  if (m.dailyPaid.day !== day) m.dailyPaid = { day, n: 0 };
  const paid = m.dailyPaid.n < paidPerDay;
  m.dailyPaid.n += 1;
  const e = labEffects(m, md);
  const bits = paid ? Math.floor(r.bits * e.bitsMul * (r.doubled ? md.ads.doubleBits : 1)) : 0;
  const keys = paid ? Math.floor(r.keys) : 0;
  m.bits += bits;
  m.keys += keys;
  // Practice attempts (unpaid) do not count for missions either: restarts would farm them.
  const ms = paid ? settleMissions(m, r, bits) : {};
  m.runs += 1;
  m.firstRunDone = true;
  return { bits, keys, milestones: [], newBest: false, tierUnlocked: 0, codexBits: 0, codexNew: [], ...(paid ? {} : { unpaid: true }), ...ms };
}

/** Daily missions at settlement (before `runs` counts the run: the run key of a revived run stays the same). */
function settleMissions(m: MetaState, r: Pick<RunResult, 'missions' | 'now'>, bits: number): Pick<Settlement, 'missions' | 'missionKeys'> {
  if (!r.missions || r.now === undefined) return {};
  const missions = applyMissions(m, r.missions, bits, r.now);
  return { missions, missionKeys: missions.reduce((a, d) => a + d.keys, 0) };
}

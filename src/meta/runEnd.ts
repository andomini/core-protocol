// Run settlement: Bits (× labs, × rewarded doubling), Keys (boss drops + milestones), best wave, tier unlock.
import type { GameData } from '../sim/data';
import { labEffects } from './labs';
import { type MetaData, unlockWaveFor } from './metaData';
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
}

export interface Settlement {
  bits: number;
  keys: number;
  milestones: number[];
  newBest: boolean;
  /** The tier this run unlocked (0 = none). */
  tierUnlocked: number;
}

export function settleRun(m: MetaState, data: GameData, md: MetaData, r: RunResult): Settlement {
  const e = labEffects(m, md);
  const bits = Math.floor(r.bits * e.bitsMul * (r.bitsMul ?? 1) * (r.doubled ? md.ads.doubleBits : 1));
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
  m.bits += bits;
  m.keys += keys;
  m.runs += 1;
  m.firstRunDone = true;
  return { bits, keys, milestones, newBest, tierUnlocked };
}

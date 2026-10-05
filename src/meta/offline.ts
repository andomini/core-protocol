// Offline income (spec §3.5): Bits for time away, from the best wave on the highest tier, capped by labs.
import type { GameData } from '../sim/data';
import { labEffects } from './labs';
import type { MetaData } from './metaData';
import type { MetaState } from './state';

export interface OfflineReward {
  bits: number;
  hours: number;
}

export function offlineReward(m: MetaState, data: GameData, md: MetaData, now: number): OfflineReward {
  if (m.lastSeen <= 0 || now <= m.lastSeen) return { bits: 0, hours: 0 };
  const awayMin = (now - m.lastSeen) / 60000;
  if (awayMin < md.offline.minMinutes) return { bits: 0, hours: 0 };
  let tier = 0;
  let wave = 0;
  for (const [k, v] of Object.entries(m.best)) {
    const t = Number(k);
    if (v > 0 && t > tier) {
      tier = t;
      wave = v;
    }
  }
  if (tier === 0) return { bits: 0, hours: 0 };
  const hours = Math.min(awayMin / 60, labEffects(m, md).offlineCapHours);
  const tierMul = data.tiers[tier - 1]?.bitsMul ?? 1;
  return { bits: Math.floor(wave * md.offline.bitsPerWaveHour * tierMul * hours), hours };
}

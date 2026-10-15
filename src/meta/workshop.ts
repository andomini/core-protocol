// Workshop (spec §3.1): permanent stat levels bought with Bits; they set each stat's starting value in a run.
import type { GameData, StatId } from '../sim/data';
import { labEffects } from './labs';
import type { MetaData } from './metaData';
import type { MetaState } from './state';

export function workshopCurve(md: MetaData, stat: StatId) {
  return md.workshop.stats[stat] ?? md.workshop.default;
}

/** Bits for the next workshop level of `stat` (geometric; past the curve's knee it grows by growthAfter). */
export function workshopCost(m: MetaState, md: MetaData, stat: StatId): number {
  const c = workshopCurve(md, stat);
  const lvl = m.workshop[stat] ?? 0;
  if (c.knee === undefined || lvl <= c.knee) return Math.ceil(c.base * Math.pow(c.growth, lvl));
  return Math.ceil(c.base * Math.pow(c.growth, c.knee) * Math.pow(c.growthAfter!, lvl - c.knee));
}

/** Mastery multiplier on `stat` from its workshop level: mul^⌊level/every⌋ (1 when the stat has none). */
export function masteryMul(m: MetaState, md: MetaData, stat: StatId): number {
  return masteryAt(md, stat, m.workshop[stat] ?? 0);
}

/** The mastery multiplier a workshop `level` of `stat` gives. */
export function masteryAt(md: MetaData, stat: StatId, level: number): number {
  const ms = md.workshop.mastery;
  const x = ms?.mul[stat];
  if (ms === undefined || x === undefined || x <= 1) return 1;
  return Math.pow(x, Math.floor(level / ms.every));
}

/** Every stat's mastery multiplier above 1 (for RunOptions.workshopMul). */
export function masteryMuls(m: MetaState, md: MetaData): Partial<Record<StatId, number>> {
  const out: Partial<Record<StatId, number>> = {};
  for (const id of Object.keys(md.workshop.mastery?.mul ?? {}) as StatId[]) {
    const x = masteryMul(m, md, id);
    if (x > 1) out[id] = x;
  }
  return out;
}

export function workshopUnlocked(m: MetaState, data: GameData, md: MetaData, stat: StatId): boolean {
  return !data.stats.stats[stat].lockedByDefault || labEffects(m, md).unlocked.includes(stat);
}

/** The workshop level cap: the stat's in-run max level (if any) plus lab bonuses. */
export function workshopMax(m: MetaState, data: GameData, md: MetaData, stat: StatId): number {
  const max = data.stats.stats[stat].maxLevel;
  return max === undefined ? Infinity : max + (labEffects(m, md).maxLevelBonus[stat] ?? 0);
}

export function buyWorkshop(m: MetaState, data: GameData, md: MetaData, stat: StatId): boolean {
  if (!workshopUnlocked(m, data, md, stat)) return false;
  const lvl = m.workshop[stat] ?? 0;
  if (lvl >= workshopMax(m, data, md, stat)) return false;
  const cost = workshopCost(m, md, stat);
  if (m.bits < cost) return false;
  m.bits -= cost;
  m.workshop[stat] = lvl + 1;
  return true;
}

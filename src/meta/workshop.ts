// Workshop (spec §3.1): permanent stat levels bought with Bits; they set each stat's starting value in a run.
import type { GameData, StatId } from '../sim/data';
import { labEffects } from './labs';
import type { MetaData } from './metaData';
import type { MetaState } from './state';

export function workshopCurve(md: MetaData, stat: StatId) {
  return md.workshop.stats[stat] ?? md.workshop.default;
}

/** Bits for the next workshop level of `stat`. */
export function workshopCost(m: MetaState, md: MetaData, stat: StatId): number {
  const c = workshopCurve(md, stat);
  return Math.ceil(c.base * Math.pow(c.growth, m.workshop[stat] ?? 0));
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

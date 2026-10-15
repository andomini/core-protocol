// Virus mutations (spec 2026-10-14 §C): from `startWave`, every `every` waves the genome gains a level
// against the build's dominant tag (the highest set count). Gene effects are folded into the perk profile
// and the combat stats; nothing else reads the genome.

import type { GameData } from './data';
import type { SimEvent } from './events';
import { TAGS, type Tag } from './perkData';
import type { World } from './state';

export function blankGenome(): Record<Tag, number> {
  const g = {} as Record<Tag, number>;
  for (const t of TAGS) g[t] = 0;
  return g;
}

export function isMutationWave(data: GameData, wave: number): boolean {
  const m = data.mutations;
  return wave >= m.startWave && (wave - m.startWave) % m.every === 0;
}

/** The tag the virus learns next: the highest set count (ties in TAGS order), or null when nothing is held. */
export function dominantTag(w: World, data: GameData, c: Record<Tag, number>): Tag | null {
  let best: Tag | null = null;
  for (const t of TAGS) {
    if (w.genome[t] >= data.mutations.maxLevel || c[t] <= 0) continue;
    if (best === null || c[t] > c[best]) best = t;
  }
  return best;
}

/** Called at each wave start with the set counts (perks.tagCounts): a mutation wave adds a gene level. */
export function mutate(w: World, data: GameData, counts: Record<Tag, number>, events: SimEvent[]): void {
  if (!isMutationWave(data, w.wave)) return;
  const t = dominantTag(w, data, counts);
  if (t === null) return;
  w.genome[t] += 1;
  events.push({ type: 'mutation', tag: t, level: w.genome[t] });
}

/** Share of the countered effect the virus still lets through for gene `t` (1 = no gene). */
export function geneKeep(w: World, data: GameData, t: Tag): number {
  return Math.max(0, 1 - data.mutations.perLevel[t] * w.genome[t]);
}

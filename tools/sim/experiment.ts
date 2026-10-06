// What-if experiments for the progression sim: a deep-merge patch for game/meta data plus quick multipliers.
import type { MetaData } from '../../src/meta/metaData';
import { type GameData, validateData } from '../../src/sim/data';

export interface Experiment {
  /** Deep-merged into the game data (src/data/*.json shapes). */
  data?: Record<string, unknown>;
  /** Deep-merged into the meta data (meta.json shape; labs via labCostMul). */
  meta?: Record<string, unknown>;
  labCostMul?: number;
  workshopBaseMul?: number;
  workshopGrowthAdd?: number;
}

function merge(t: Record<string, unknown>, p: Record<string, unknown>): void {
  for (const [k, v] of Object.entries(p)) {
    if (v !== null && typeof v === 'object' && !Array.isArray(v) && typeof t[k] === 'object' && t[k] !== null) merge(t[k] as Record<string, unknown>, v as Record<string, unknown>);
    else t[k] = v;
  }
}

/** Mutates the given data objects in place (call once, in an isolated worker). */
export function applyExperiment(d: GameData, m: MetaData, e: Experiment): void {
  if (e.data) merge(d as unknown as Record<string, unknown>, e.data);
  if (e.meta) merge(m as unknown as Record<string, unknown>, e.meta);
  if (e.labCostMul) for (const n of m.labs.nodes) n.cost = Math.round(n.cost * e.labCostMul);
  const ws = [m.workshop.default, ...Object.values(m.workshop.stats)];
  if (e.workshopBaseMul) for (const c of ws) c!.base = Math.max(1, Math.round(c!.base * e.workshopBaseMul));
  if (e.workshopGrowthAdd) for (const c of ws) c!.growth = Math.round((c!.growth + e.workshopGrowthAdd) * 1000) / 1000;
  validateData(d);
}

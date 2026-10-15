// Meta-progression data (spec §3): workshop prices, tier unlocks, milestones, offline income, labs.
import labsJson from '../data/labs.json';
import metaJson from '../data/meta.json';
import { checkKnee, type CostCurve, STAT_IDS, type StatId } from '../sim/data';

/** Workshop price curve: the same shape as an in-run cost (geometric, optional soft-wall knee). */
export type PriceCurve = CostCurve;

/** Workshop mastery: every `every` workshop levels of a listed stat multiply its in-run value by `mul[stat]`. */
export interface Mastery {
  every: number;
  mul: Partial<Record<StatId, number>>;
}

/**
 * Price-change refund: a save made before `economy` paid its workshop levels on the `from` curve; on load
 * it gets back what it paid above today's prices (MetaState.economy records the version).
 */
export interface Refund {
  economy: number;
  from: PriceCurve;
}

export type LabEffect =
  | { type: 'speed'; value: number }
  | { type: 'unlock'; stat: StatId }
  | { type: 'maxLevel'; stat: StatId; value: number }
  | { type: 'perkChoice' }
  | { type: 'freeReroll' }
  | { type: 'rareMul'; value: number }
  | { type: 'pickEvery'; value: number }
  | { type: 'cardSlot' }
  | { type: 'presets' }
  | { type: 'bitsMul'; value: number }
  | { type: 'startEnergy'; value: number }
  | { type: 'offlineCap'; hours: number };

export interface LabNode {
  id: string;
  branch: string;
  name: string;
  cost: number;
  requires: string[];
  effect: LabEffect;
}

export interface MetaData {
  workshop: { default: PriceCurve; stats: Partial<Record<StatId, PriceCurve>>; mastery?: Mastery; refund?: Refund };
  /** Wave to reach on tier t to unlock tier t+1: `unlockWaves[t-1]`, else `unlockWave`. */
  tiers: { unlockWave: number; unlockWaves?: number[] };
  milestones: { waves: number[]; keys: number[]; keysPerTier: number };
  offline: { bitsPerWaveHour: number; capHours: number; minMinutes: number };
  ads: { doubleBits: number };
  labs: { branches: { id: string; name: string }[]; nodes: LabNode[] };
}

function check(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`meta data: ${msg}`);
}

export function validateMetaData(d: MetaData): MetaData {
  const curve = (c: PriceCurve, at: string) => {
    check(c.base > 0 && c.growth > 1, `${at} needs base > 0 and growth > 1`);
    checkKnee(c, `meta ${at}`);
  };
  curve(d.workshop.default, 'workshop.default');
  for (const [id, c] of Object.entries(d.workshop.stats)) {
    check((STAT_IDS as readonly string[]).includes(id), `workshop.stats.${id} is not a stat`);
    curve(c!, `workshop.stats.${id}`);
  }
  const ms = d.workshop.mastery;
  if (ms !== undefined) {
    check(Number.isInteger(ms.every) && ms.every >= 1, 'workshop.mastery.every must be a whole number ≥ 1');
    for (const [id, x] of Object.entries(ms.mul)) {
      check((STAT_IDS as readonly string[]).includes(id), `workshop.mastery.mul.${id} is not a stat`);
      check(typeof x === 'number' && Number.isFinite(x) && x >= 1, `workshop.mastery.mul.${id} must be ≥ 1`);
    }
  }
  const rf = d.workshop.refund;
  if (rf !== undefined) {
    check(Number.isInteger(rf.economy) && rf.economy >= 2, 'workshop.refund.economy must be a whole number ≥ 2');
    curve(rf.from, 'workshop.refund.from');
  }
  check(d.milestones.waves.length === d.milestones.keys.length, 'milestones.waves and keys differ in length');
  const ids = new Set<string>();
  const branches = new Set(d.labs.branches.map((b) => b.id));
  for (const n of d.labs.nodes) {
    check(!ids.has(n.id), `duplicate lab ${n.id}`);
    ids.add(n.id);
    check(branches.has(n.branch), `lab ${n.id}: unknown branch ${n.branch}`);
    check(n.cost > 0, `lab ${n.id}: cost must be > 0`);
    const e = n.effect;
    if (e.type === 'unlock' || e.type === 'maxLevel') check((STAT_IDS as readonly string[]).includes(e.stat), `lab ${n.id}: unknown stat`);
  }
  for (const n of d.labs.nodes) for (const r of n.requires) check(ids.has(r), `lab ${n.id}: unknown prerequisite ${r}`);
  return d;
}

export const DEFAULT_META_DATA: MetaData = validateMetaData({ ...(metaJson as unknown as Omit<MetaData, 'labs'>), labs: labsJson as unknown as MetaData['labs'] });

/** Wave to reach on `tier` to unlock the next one. */
export function unlockWaveFor(md: MetaData, tier: number): number {
  return md.tiers.unlockWaves?.[tier - 1] ?? md.tiers.unlockWave;
}

export function labNode(md: MetaData, id: string): LabNode | undefined {
  return md.labs.nodes.find((n) => n.id === id);
}

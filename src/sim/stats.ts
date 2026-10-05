// In-run stats (spec §2.3): values derived from data + levels + modifiers, costs, and the MAX buy.
// The World stores only levels and modifiers; every derived value comes from effectiveStats().

import { type GameData, STAT_IDS, type StatDef, type StatId } from './data';
import { clampValue, MAX_VALUE, powInt } from './num';

export type Levels = Record<StatId, number>;

/** What a modifier can target: any stat, plus the Interest cap (Compound perk, 💰 6-set). */
export type ModTarget = StatId | 'interestCap';

/** A flat (`add`) or multiplicative (`mul`) change from a perk, set, card… (M3/M5 append these). */
export interface Modifier {
  stat: ModTarget;
  op: 'add' | 'mul';
  value: number;
  /** Who granted it (for the UI and debugging); has no effect on the value. */
  source: string;
}

export interface StatInputs {
  /** Permanent workshop levels (M4); they set the starting value on the same curve. */
  workshop: Readonly<Levels>;
  /** Levels bought in this run. */
  run: Readonly<Levels>;
  mods: readonly Modifier[];
}

/** Every effective in-run value the sim reads. `interestCap` is the wave-1 cap (scaled per wave). */
export type CoreStats = Record<StatId, number> & { interestCap: number };

/** All levels 0, keys in canonical STAT_IDS order (key order matters for the state hash). */
export function zeroLevels(): Levels {
  const out = {} as Levels;
  for (const id of STAT_IDS) out[id] = 0;
  return out;
}

/** Copies `src` into canonical key order; missing or invalid entries become 0. */
export function canonicalLevels(src: Partial<Record<string, number>> | undefined): Levels {
  const out = zeroLevels();
  if (src === undefined) return out;
  for (const id of STAT_IDS) {
    const v = src[id];
    if (typeof v === 'number' && Number.isInteger(v) && v > 0) out[id] = v;
  }
  return out;
}

/** The stat's value at `level` before modifiers. */
export function statValue(def: StatDef, level: number): number {
  if (def.mode === 'mul') return clampValue(def.base * powInt(def.per, level));
  return clampValue(def.base + def.per * level);
}

export function effectiveStats(data: GameData, inputs: StatInputs): CoreStats {
  const defs = data.stats.stats;
  const out = {} as CoreStats;
  for (const id of STAT_IDS) out[id] = statValue(defs[id], inputs.workshop[id] + inputs.run[id]);
  out.interestCap = data.stats.economy.interestCap;
  if (inputs.mods.length > 0) {
    // Adds first, then muls: the result does not depend on the order perks were taken in.
    for (const m of inputs.mods) if (m.op === 'add') out[m.stat] = clampValue(out[m.stat] + m.value);
    for (const m of inputs.mods) if (m.op === 'mul') out[m.stat] = clampValue(out[m.stat] * m.value);
  }
  for (const id of STAT_IDS) {
    const cap = defs[id].cap;
    if (cap !== undefined && out[id] > cap) out[id] = cap;
    if (out[id] < 0) out[id] = 0;
  }
  return out;
}

/** Price of the next level when the stat is at `level`. */
export function levelCost(def: StatDef, level: number): number {
  return costSum(def, level, 1);
}

/**
 * Total price of levels `level … level+n−1`: ⌈base·c^L·(c^n − 1)/(c − 1)⌉, via powInt. Whole Energy, so
 * the HUD's floored Energy and the shown price agree exactly on affordability. Monotone in n.
 * Returns Infinity (never affordable, never stored) when the price would pass MAX_VALUE.
 */
export function costSum(def: StatDef, level: number, n: number): number {
  if (n <= 0) return 0;
  const c = def.cost.growth;
  const a = powInt(c, level);
  const q = powInt(c, n);
  if (a >= MAX_VALUE || q >= MAX_VALUE) return Infinity;
  const s = (def.cost.base * a * (q - 1)) / (c - 1);
  return s > MAX_VALUE ? Infinity : Math.ceil(s);
}

/** Levels still purchasable in this run (Infinity without a max level). */
export function remainingLevels(def: StatDef, level: number): number {
  return def.maxLevel === undefined ? Infinity : Math.max(0, def.maxLevel - level);
}

/** Largest n with costSum(level, n) ≤ energy, within the max level. Exponential + binary search: O(log² n). */
export function maxAffordable(def: StatDef, level: number, energy: number): number {
  const rem = remainingLevels(def, level);
  if (rem <= 0 || costSum(def, level, 1) > energy) return 0;
  let lo = 1; // affordable
  let hi = 2; // candidate upper bound
  while (hi <= rem && costSum(def, level, hi) <= energy) {
    lo = hi;
    hi *= 2;
  }
  if (lo >= rem) return rem;
  hi = Math.min(hi, rem + 1); // first count known (or assumed past rem) to be unaffordable
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (costSum(def, level, mid) <= energy) lo = mid;
    else hi = mid;
  }
  return lo;
}

export interface BuyQuote {
  /** Levels this buy would add (for an unaffordable MAX: the next single level, for display). */
  levels: number;
  /** Total Energy for `levels`. */
  cost: number;
  affordable: boolean;
}

/**
 * The one quote both the sim (to accept a buy) and the UI (price + glow) use.
 * ×N is all-or-nothing, clipped to the remaining levels; MAX buys every affordable level.
 */
export function quoteBuy(def: StatDef, level: number, count: number | 'max', energy: number): BuyQuote {
  const rem = remainingLevels(def, level);
  if (rem <= 0) return { levels: 0, cost: 0, affordable: false };
  if (count === 'max') {
    const n = maxAffordable(def, level, energy);
    if (n === 0) return { levels: 1, cost: costSum(def, level, 1), affordable: false };
    return { levels: n, cost: costSum(def, level, n), affordable: true };
  }
  const n = Math.min(count, rem);
  const cost = costSum(def, level, n);
  return { levels: n, cost, affordable: cost <= energy };
}

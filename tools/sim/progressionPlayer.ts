// One simulated player's whole progression: chained runs, payouts, workshop / labs / cards spending, ads.
// Pure Node (no workers here): progression.ts runs many of these in parallel worker threads.
import botJson from './bot.json';
import { CARDS, cardDef, claimFreePack, equip, grantStarter, openPack, starsFor, unequip } from '../../src/meta/cards';
import { buyLab, labEffects, labState } from '../../src/meta/labs';
import { DEFAULT_META_DATA as M, unlockWaveFor } from '../../src/meta/metaData';
import { buildRunOptions } from '../../src/meta/runOptions';
import { settleRun } from '../../src/meta/runEnd';
import { defaultMeta, type MetaState } from '../../src/meta/state';
import { buyWorkshop, workshopCost, workshopMax, workshopUnlocked } from '../../src/meta/workshop';
import { DEFAULT_DATA as D, STAT_IDS, type StatId } from '../../src/sim/data';
import type { PickPolicyName, PolicyName } from './bot';
import { runBot } from './runner';

export type Strategy = 'balanced' | 'workshop' | 'labs' | 'casual';

export interface PlayerConfig {
  id: number;
  strategy: Strategy;
  /** Watches the rewarded ads (×2 Bits, free pack). */
  ads: boolean;
  maxHours: number;
  maxRuns: number;
  /** Sim-minute cap per run (a run reaching it counts as "runaway"). */
  runCapMin: number;
}

export interface RunRow {
  run: number;
  tier: number;
  wave: number;
  simMin: number;
  /** Cumulative real hours (sim time at the player's speed + menu time). */
  hours: number;
  bits: number;
  keys: number;
  buys: number;
  workshop: number;
  labs: number;
  cards: number;
  capped: boolean;
}

export interface PlayerResult {
  cfg: PlayerConfig;
  rows: RunRow[];
  /** Real hours when tier t was unlocked (index t; 0 = never). */
  tierAt: number[];
  /** Longest stretch without a new best wave on the tier being played. */
  plateau: { hours: number; runs: number; tier: number; wave: number };
  labsOwned: string[];
  workshopLevels: Partial<Record<StatId, number>>;
  final: { tier: number; best: Record<string, number>; bits: number; keys: number; cards: number };
}

const MENU_MIN = 0.5;
const useful = new Set<string>((botJson as { useful: string[] }).useful);

/** A small deterministic RNG for the meta layer (packs) so a player is reproducible. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function cheapestWorkshop(m: MetaState): { id: StatId; cost: number } | null {
  let best: { id: StatId; cost: number } | null = null;
  for (const id of STAT_IDS) {
    if (!useful.has(id) || !workshopUnlocked(m, D, M, id) || (m.workshop[id] ?? 0) >= workshopMax(m, D, M, id)) continue;
    const c = workshopCost(m, M, id);
    if (!best || c < best.cost) best = { id, cost: c };
  }
  return best;
}

function cheapestLab(m: MetaState): { id: string; cost: number } | null {
  const xs = M.labs.nodes.filter((n) => labState(m, M, n.id) === 'available').sort((a, b) => a.cost - b.cost);
  return xs.length ? { id: xs[0]!.id, cost: xs[0]!.cost } : null;
}

/** Spends Bits by strategy; returns the number of purchases. */
function spend(m: MetaState, s: Strategy, r: () => number): number {
  let n = 0;
  for (let guard = 0; guard < 10000; guard++) {
    const w = cheapestWorkshop(m);
    const l = cheapestLab(m);
    let did = false;
    if (s === 'labs') {
      if (l && m.bits >= l.cost) did = buyLab(m, M, l.id);
      else if (!l && w && m.bits >= w.cost) did = buyWorkshop(m, D, M, w.id);
      // Saves for the next lab while one is available (except trivially cheap workshop levels).
      else if (l && w && w.cost < l.cost * 0.05 && m.bits >= w.cost) did = buyWorkshop(m, D, M, w.id);
    } else if (s === 'workshop') {
      if (w && m.bits >= w.cost) did = buyWorkshop(m, D, M, w.id);
      else if (l && m.bits >= l.cost && (!w || l.cost < w.cost * 3)) did = buyLab(m, M, l.id);
    } else if (s === 'casual') {
      // Random affordable purchase; stops at the first miss.
      const opts: (() => boolean)[] = [];
      if (w && m.bits >= w.cost) opts.push(() => buyWorkshop(m, D, M, w.id));
      if (l && m.bits >= l.cost) opts.push(() => buyLab(m, M, l.id));
      if (opts.length) did = opts[Math.floor(r() * opts.length)]!();
    } else {
      // balanced: a lab when affordable, else the cheapest workshop level.
      if (l && m.bits >= l.cost) did = buyLab(m, M, l.id);
      else if (w && m.bits >= w.cost) did = buyWorkshop(m, D, M, w.id);
    }
    if (!did) return n;
    n++;
  }
  return n;
}

const RARITY_SCORE = { common: 1, rare: 2, epic: 3 } as const;

/** Opens affordable packs and equips the best cards (rarity × stars). */
function manageCards(m: MetaState, r: () => number): void {
  while (openPack(m, r)) {
    /* open all */
  }
  const owned = Object.keys(m.cards).filter((id) => (m.cards[id] ?? 0) > 0);
  const score = (id: string) => RARITY_SCORE[cardDef(id)!.rarity] * 10 + starsFor(m.cards[id]!);
  owned.sort((a, b) => score(b) - score(a));
  for (const id of [...m.loadout]) unequip(m, id);
  for (const id of owned) equip(m, M, id);
}

export function simulatePlayer(cfg: PlayerConfig): PlayerResult {
  const m = defaultMeta();
  const r = rng(cfg.id * 7919 + 13);
  const rows: RunRow[] = [];
  const tierAt = Array.from({ length: D.tiers.length + 1 }, () => 0);
  tierAt[1] = 0.000001;
  let hours = 0;
  let lastFree = -1e9;
  let plateau = { hours: 0, runs: 0, tier: 1, wave: 0 };
  let streak = { start: 0, runs: 0, tier: 1, best: 0 };
  const buy: PolicyName = cfg.strategy === 'casual' ? 'round-robin' : 'greedy';
  const pick: PickPolicyName = cfg.strategy === 'casual' ? 'random-pick' : 'greedy-pick';
  /** Bits per real minute last observed on each tier (players farm the best one). */
  const rate: Record<number, number> = {};
  for (let run = 1; run <= cfg.maxRuns && hours < cfg.maxHours; run++) {
    // Push the highest tier every 3rd run (or when untried); otherwise farm the tier with the best Bits/min.
    let tier = m.tierUnlocked;
    if (run % 3 !== 0 && rate[tier] !== undefined) {
      for (let t = 1; t < m.tierUnlocked; t++) if ((rate[t] ?? 0) > (rate[tier] ?? 0)) tier = t;
    }
    const res = runBot(D, buy, buildRunOptions(m, D, M, tier, cfg.id * 100003 + run), cfg.runCapMin, pick);
    const speed = cfg.strategy === 'casual' ? Math.min(2, labEffects(m, M).speeds.at(-1)!) : labEffects(m, M).speeds.at(-1)!;
    hours += (res.simMinutes / speed + MENU_MIN) / 60;
    const capped = !res.dead;
    rate[tier] = res.world.bits / Math.max(0.1, res.simMinutes / speed + MENU_MIN);
    const prevBest = m.best[String(tier)] ?? 0;
    const s = settleRun(m, D, M, { tier, wave: res.wave, bits: res.world.bits, keys: res.world.keys, doubled: cfg.ads, bitsMul: buildRunOptions(m, D, M, tier, 0).metaBonus?.bitsMul });
    if (s.tierUnlocked && !tierAt[s.tierUnlocked]) tierAt[s.tierUnlocked] = hours;
    // Plateau: runs on the same tier without beating that tier's best wave.
    if (tier !== streak.tier || res.wave > prevBest) streak = { start: hours, runs: 0, tier, best: Math.max(prevBest, res.wave) };
    else {
      streak.runs++;
      if (hours - streak.start > plateau.hours) plateau = { hours: hours - streak.start, runs: streak.runs, tier, wave: streak.best };
    }
    if (m.firstRunDone) grantStarter(m, r);
    if (cfg.ads && hours - lastFree >= CARDS.pack.freeEveryHours) {
      m.freePackAt = 0; // the sim's clock is play hours, not wall time
      claimFreePack(m, r, 1);
      lastFree = hours;
    }
    manageCards(m, r);
    const buys = spend(m, cfg.strategy, r);
    rows.push({
      run,
      tier,
      wave: res.wave,
      simMin: Math.round(res.simMinutes * 10) / 10,
      hours: Math.round(hours * 1000) / 1000,
      bits: s.bits,
      keys: s.keys,
      buys,
      workshop: Object.values(m.workshop).reduce((a, b) => a + (b ?? 0), 0),
      labs: m.labs.length,
      cards: m.loadout.length,
      capped,
    });
    if (m.tierUnlocked === D.tiers.length && (m.best[String(D.tiers.length)] ?? 0) >= unlockWaveFor(M, D.tiers.length)) break;
  }
  return {
    cfg,
    rows,
    tierAt,
    plateau,
    labsOwned: [...m.labs],
    workshopLevels: { ...m.workshop },
    final: { tier: m.tierUnlocked, best: { ...m.best }, bits: Math.floor(m.bits), keys: m.keys, cards: Object.keys(m.cards).length },
  };
}

// Bot policies for headless balance runs (spec §6). Tools may use floats freely; they only issue
// commands, exactly like the UI, so a bot run is replayable from its log.
//   none         never buys (baseline)
//   greedy       buys the cheapest affordable useful upgrade (×1), as a sensible first-time player would; fires the Pulse when
//                ready and the autoPulse crowd (pulse.json) is in its ring (so do atk-first and def-first)
//                (BUILD rows count once their structure stands: turret/mine as ATK, structure HP/regen as DEF, station income as UTIL)
//                and a structure upgrade (structures.json upgrades) when its Energy / tab weight is the cheapest (bot.json structUpgrades)
//   atk-first    greedy, but ATK prices count 4× cheaper (tools/sim/bot.json)
//   def-first    the same for DEF
//   round-robin  cycles through the useful stats in panel order, saving up for the next one
import botJson from './bot.json';
import { type Command, isUnlocked, quoteFor } from '../../src/sim/commands';
import { type GameData, STAT_IDS, type StatId, type TabId } from '../../src/sim/data';
import type { World } from '../../src/sim/state';
import { type StructureKind, TAGS, type Tag } from '../../src/sim/perkData';
import { bootSector, structureBuilt, tagCounts } from '../../src/sim/perks';
import { structLevel, structUpgradeCost, upgradableKinds } from '../../src/sim/structLevels';
import { pulseWorth } from '../../src/sim/pulse';
import { type CrystalDiff, crystalDiff, crystalSlots, freeSlots, fusionSteps, movePreview, needsPlacement, slotGains } from '../../src/sim/crystal';
import { crystalRing } from '../../src/sim/territory';
import { createStream, nextInt } from '../../src/sim/rng';

export type PolicyName = 'none' | 'greedy' | 'atk-first' | 'def-first' | 'round-robin';
export const POLICIES: PolicyName[] = ['none', 'greedy', 'atk-first', 'def-first', 'round-robin'];
/** The workshop's "useful" stats (meta tools share it); the BUILD rows are in-run only, and only bought once unlocked. */
export const USEFUL: readonly StatId[] = STAT_IDS.filter((id) => (botJson.useful as string[]).includes(id));
/** BUILD stat → the tab whose weight it takes. */
const BUILD_AS = botJson.build as Partial<Record<StatId, TabId>>;
const BUILD: readonly StatId[] = STAT_IDS.filter((id) => BUILD_AS[id] !== undefined);
/** Structure kind → the tab whose weight its upgrade takes. */
const STRUCT_AS = botJson.structUpgrades as Partial<Record<StructureKind, TabId>>;

/** Energy for the next upgrade level of `kind`, or null when it cannot be bought (not built, maxed, no ladder). */
function structCost(w: World, data: GameData, kind: StructureKind): number | null {
  if (STRUCT_AS[kind] === undefined || !structureBuilt(w, data, kind)) return null;
  const c = structUpgradeCost(data, kind, structLevel(w, data, kind));
  return Number.isFinite(c) ? c : null;
}
/** What an in-run bot may buy: the useful stats, then the BUILD rows (isUnlocked leaves them out until the structure stands). */
export const RUN_STATS: readonly StatId[] = [...USEFUL, ...BUILD];

export interface Bot {
  name: PolicyName;
  /** Commands to issue before the next step. */
  decide(w: World, data: GameData): Command[];
}

function buyable(w: World, data: GameData, id: StatId): boolean {
  return isUnlocked(w, data, id) && quoteFor(w, data, id, 1).levels > 0;
}

function weighted(name: 'greedy' | 'atk-first' | 'def-first'): Bot {
  const weight = botJson.tabWeight[name] as Record<TabId, number>;
  return {
    name,
    decide(w, data) {
      let best: StatId | null = null;
      let bestScore = Infinity;
      for (const id of RUN_STATS) {
        if (!buyable(w, data, id)) continue;
        const score = quoteFor(w, data, id, 1).cost / weight[BUILD_AS[id] ?? data.stats.stats[id].tab];
        if (score < bestScore) {
          bestScore = score;
          best = id;
        }
      }
      // Structure upgrades compete on the same footing: Energy / the weight of the tab they count as.
      let kindBest: StructureKind | null = null;
      for (const kind of upgradableKinds(data)) {
        const c = structCost(w, data, kind);
        if (c === null) continue;
        const score = c / weight[STRUCT_AS[kind]!];
        if (score < bestScore) {
          bestScore = score;
          kindBest = kind;
        }
      }
      // Pulse (uniqueness plan item 4): fired whenever ready with the autoPulse rule's crowd in the ring.
      const out: Command[] = pulseWorth(w, data) ? [{ type: 'pulse' }] : [];
      // Save up for the best-value option rather than buying a worse one now.
      if (kindBest !== null) {
        if (w.energy >= structCost(w, data, kindBest)!) out.push({ type: 'upgradeStruct', kind: kindBest });
        return out;
      }
      if (best === null || !quoteFor(w, data, best, 1).affordable) return out;
      out.push({ type: 'buy', stat: best, count: 1 });
      return out;
    },
  };
}

function roundRobin(): Bot {
  let next = 0;
  return {
    name: 'round-robin',
    decide(w, data) {
      for (let tries = 0; tries < RUN_STATS.length; tries++) {
        const id = RUN_STATS[next % RUN_STATS.length]!;
        if (!buyable(w, data, id)) {
          next++;
          continue;
        }
        if (!quoteFor(w, data, id, 1).affordable) return [];
        next++;
        return [{ type: 'buy', stat: id, count: 1 }];
      }
      return [];
    },
  };
}

export function makeBot(name: PolicyName): Bot {
  switch (name) {
    case 'none':
      return { name, decide: () => [] };
    case 'round-robin':
      return roundRobin();
    default:
      return weighted(name);
  }
}

// ---------------------------------------------------------------------------------------------------------
// Protocol pick policies (M3). A run = a buy policy × a pick policy.
//   first        always the first card (baseline)
//   greedy-pick  highest rarity; among equals, a card of a held tag (most-held first); else offer order
//   random-pick  a uniform random card (its own seeded stream: replayable)
//   fusion-pick  the card (and free hex) whose module raises the crystal score most (set/fusion tiers and links, see bot.json "crystal"), rarity as a tie-break; used by --crystal arrange
//   tag:<tag>    the best card of its tag when offered (rarity first); otherwise greedy-pick
// The run-start boot offer (boot sectors): first → sector 0; greedy-pick / random-pick → a random sector (bot RNG);
// fusion-pick → the best crystal score (ties: offer order); tag:<tag> → its tag when offered, else sector 0.

export type PickPolicyName = 'first' | 'greedy-pick' | 'random-pick' | 'fusion-pick' | `tag:${Tag}`;
export const TAG_PICKS: PickPolicyName[] = TAGS.map((t) => `tag:${t}` as const);
export const PICK_POLICIES: PickPolicyName[] = ['first', 'greedy-pick', 'random-pick', 'fusion-pick', ...TAG_PICKS];

const RANK = { common: 0, rare: 1, epic: 2 } as const;

export interface Picker {
  name: PickPolicyName;
  /** Index of the card to take from the open offer. */
  choose(w: World, data: GameData): number;
  /** Index of the boot sector to take from the open boot offer. */
  boot(w: World, data: GameData): number;
}

/** The pick command for the open pick: pickBoot while the boot offer is open, else pickPerk via `perk`. */
export function pickCommand(w: World, data: GameData, picker: Picker, perk: () => Command): Command {
  return w.bootOffer.length > 0 ? { type: 'pickBoot', index: picker.boot(w, data) } : perk();
}

/** The boot sector whose modules raise the crystal score most (fusion-pick); ties keep offer order. */
export function bestBoot(w: World, data: GameData): number {
  let best = 0;
  let bestScore = -Infinity;
  w.bootOffer.forEach((id, i) => {
    const s = bootSector(data, id)!;
    const perks = { ...w.perks };
    for (const m of s.modules) perks[m.perk] = (perks[m.perk] ?? 0) + 1;
    const modules = [...w.crystal, ...s.modules.map((m) => ({ q: m.slot[0], r: m.slot[1], perk: m.perk, tag: s.tag }))];
    const rarity = s.modules.reduce((sum, m) => sum + RANK[data.perks.perks[m.perk]!.rarity], 0);
    const score = diffScore(data, crystalDiff(w, data, modules, perks)) + CW.rarity * rarity;
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  });
  return best;
}

function greedyIndex(w: World, data: GameData, filter: (id: string) => boolean = () => true): number {
  const counts = tagCounts(w, data);
  let best = -1;
  let bestScore = -Infinity;
  w.offer.forEach((id, i) => {
    if (!filter(id)) return;
    const p = data.perks.perks[id]!;
    const score = RANK[p.rarity] * 100 + counts[p.tag];
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  });
  return best;
}

export function makePicker(name: PickPolicyName, seed: number): Picker {
  const bootRng = createStream(seed, 'bot-boot');
  const randomBoot = (w: World) => nextInt(bootRng, w.bootOffer.length);
  if (name === 'first') return { name, choose: () => 0, boot: () => 0 };
  if (name === 'fusion-pick') return { name, choose: (w, data) => fusionPick(w, data).index, boot: bestBoot };
  if (name === 'greedy-pick') return { name, choose: (w, data) => Math.max(0, greedyIndex(w, data)), boot: randomBoot };
  if (name === 'random-pick') {
    const rng = createStream(seed, 'bot-random-pick');
    return { name, choose: (w) => nextInt(rng, w.offer.length), boot: randomBoot };
  }
  const tag = name.slice(4) as Tag;
  if (!TAGS.includes(tag)) throw new Error(`unknown pick policy ${name}`);
  return {
    name,
    boot: (w, data) => Math.max(0, w.bootOffer.findIndex((id) => bootSector(data, id)?.tag === tag)),
    choose(w, data) {
      const own = greedyIndex(w, data, (id) => data.perks.perks[id]!.tag === tag);
      return own >= 0 ? own : Math.max(0, greedyIndex(w, data));
    },
  };
}

// ---------------------------------------------------------------------------------------------------------
// Crystal play (spec 2026-10-16 phase 0). 'auto' leaves every module where autoSlot puts it; 'arrange' picks
// the card + hex with the best crystal score (fusion-pick) and then hill-climbs over movePreview after each
// pick: the best single move or swap that raises the score, repeated until none does.

export type CrystalMode = 'auto' | 'arrange';
const CW = botJson.crystal;

/** Number of ladder steps reached by `tier` (0 = none): the step index the score counts. */
const stepOf = (ladder: readonly number[], tier: number) => ladder.filter((t) => t <= tier).length;

/** The value of a crystal change for the bot: set and fusion tier steps weigh most, stacks and links (capped at the top tier) are progress. */
export function diffScore(data: GameData, d: CrystalDiff): number {
  let score = 0;
  const top = data.sets.fusionTiers.at(-1)!;
  for (const s of d.sets) score += CW.setTier * (stepOf(data.sets.tiers, s.tierTo) - stepOf(data.sets.tiers, s.tierFrom)) + CW.setCount * (s.to - s.from);
  for (const f of d.fusions) {
    score += CW.fusionTier * (stepOf(fusionSteps(data, f.key), f.tierTo) - stepOf(fusionSteps(data, f.key), f.tierFrom)) + CW.link * (Math.min(f.to, top) - Math.min(f.from, top));
  }
  return score;
}

/** The crystal gain of taking perk `id` and, for a new module, the free hex that gains most (undefined: autoSlot / a stack). */
export function bestSlot(w: World, data: GameData, id: string): { gain: number; slot?: [number, number] } {
  if (!needsPlacement(w, id)) {
    const d = slotGains(w, data, id);
    return { gain: d === null ? 0 : diffScore(data, d) };
  }
  let gain = -Infinity;
  let slot: [number, number] | undefined;
  for (const s of freeSlots(w, data)) {
    const d = slotGains(w, data, id, s);
    const g = d === null ? -Infinity : diffScore(data, d);
    if (g > gain) {
      gain = g;
      slot = s;
    }
  }
  return slot === undefined ? { gain: 0 } : { gain, slot };
}

/** The offered card with the best crystal gain (+ rarity, + a held tag) and, for a new module, the free hex that gains most. */
export function fusionPick(w: World, data: GameData): { index: number; slot?: [number, number] } {
  const counts = tagCounts(w, data);
  let best = { index: 0, slot: undefined as [number, number] | undefined };
  let bestScore = -Infinity;
  w.offer.forEach((id, i) => {
    const p = data.perks.perks[id]!;
    const { gain, slot } = bestSlot(w, data, id);
    const score = gain + CW.rarity * RANK[p.rarity] + CW.held * counts[p.tag];
    if (score > bestScore) {
      bestScore = score;
      best = { index: i, slot };
    }
  });
  return best;
}

export interface Arranger {
  /** Zero or one moveModule command for this step; it re-evaluates after each pick (and when the crystal grows a ring). */
  decide(w: World, data: GameData): Command[];
}

export function makeArranger(): Arranger {
  let key = '';
  let moves = 0;
  let done = true;
  return {
    decide(w, data) {
      if (w.phase === 'pick' || w.dead || w.crystal.length < 2) return [];
      const k = `${w.picks}:${crystalRing(data, w.wave)}`;
      if (k !== key) {
        key = k;
        moves = 0;
        done = false;
      }
      if (done) return [];
      const slots = crystalSlots(data, crystalRing(data, w.wave));
      let best: Command | null = null;
      let bestGain = 1e-9;
      for (const m of w.crystal) {
        for (const [q, r] of slots) {
          if (q === m.q && r === m.r) continue;
          const d = movePreview(w, data, [m.q, m.r], [q, r]);
          if (d === null) continue;
          const g = diffScore(data, d);
          if (g > bestGain) {
            bestGain = g;
            best = { type: 'moveModule', from: [m.q, m.r], to: [q, r] };
          }
        }
      }
      if (best === null || ++moves > CW.maxMoves) {
        done = true;
        return [];
      }
      return [best];
    },
  };
}

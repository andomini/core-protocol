// Bot policies for headless balance runs (spec §6). Tools may use floats freely; they only issue
// commands, exactly like the UI, so a bot run is replayable from its log.
//   none         never buys (baseline)
//   greedy       buys the cheapest affordable useful upgrade (×1), as a sensible first-time player would
//                (BUILD rows count once their structure stands: turret/mine as ATK, structure HP/regen as DEF, station income as UTIL)
//   atk-first    greedy, but ATK prices count 4× cheaper (tools/sim/bot.json)
//   def-first    the same for DEF
//   round-robin  cycles through the useful stats in panel order, saving up for the next one
import botJson from './bot.json';
import { type Command, isUnlocked, quoteFor } from '../../src/sim/commands';
import { type GameData, STAT_IDS, type StatId, type TabId } from '../../src/sim/data';
import type { World } from '../../src/sim/state';
import { TAGS, type Tag } from '../../src/sim/perkData';
import { tagCounts } from '../../src/sim/perks';
import { createStream, nextInt } from '../../src/sim/rng';

export type PolicyName = 'none' | 'greedy' | 'atk-first' | 'def-first' | 'round-robin';
export const POLICIES: PolicyName[] = ['none', 'greedy', 'atk-first', 'def-first', 'round-robin'];
/** The workshop's "useful" stats (meta tools share it); the BUILD rows are in-run only, and only bought once unlocked. */
export const USEFUL: readonly StatId[] = STAT_IDS.filter((id) => (botJson.useful as string[]).includes(id));
/** BUILD stat → the tab whose weight it takes. */
const BUILD_AS = botJson.build as Partial<Record<StatId, TabId>>;
const BUILD: readonly StatId[] = STAT_IDS.filter((id) => BUILD_AS[id] !== undefined);
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
      // Save up for the best-value option rather than buying a worse one now.
      if (best === null || !quoteFor(w, data, best, 1).affordable) return [];
      return [{ type: 'buy', stat: best, count: 1 }];
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
//   tag:<tag>    the best card of its tag when offered (rarity first); otherwise greedy-pick

export type PickPolicyName = 'first' | 'greedy-pick' | 'random-pick' | `tag:${Tag}`;
export const TAG_PICKS: PickPolicyName[] = TAGS.map((t) => `tag:${t}` as const);
export const PICK_POLICIES: PickPolicyName[] = ['first', 'greedy-pick', 'random-pick', ...TAG_PICKS];

const RANK = { common: 0, rare: 1, epic: 2 } as const;

export interface Picker {
  name: PickPolicyName;
  /** Index of the card to take from the open offer. */
  choose(w: World, data: GameData): number;
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
  if (name === 'first') return { name, choose: () => 0 };
  if (name === 'greedy-pick') return { name, choose: (w, data) => Math.max(0, greedyIndex(w, data)) };
  if (name === 'random-pick') {
    const rng = createStream(seed, 'bot-random-pick');
    return { name, choose: (w) => nextInt(rng, w.offer.length) };
  }
  const tag = name.slice(4) as Tag;
  if (!TAGS.includes(tag)) throw new Error(`unknown pick policy ${name}`);
  return {
    name,
    choose(w, data) {
      const own = greedyIndex(w, data, (id) => data.perks.perks[id]!.tag === tag);
      return own >= 0 ? own : Math.max(0, greedyIndex(w, data));
    },
  };
}

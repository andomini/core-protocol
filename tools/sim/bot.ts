// Bot policies for headless balance runs (spec §6). Tools may use floats freely; they only issue
// commands, exactly like the UI, so a bot run is replayable from its log.
//   none         never buys (baseline)
//   greedy       buys the cheapest affordable useful upgrade (×1), as a sensible first-time player would
//   atk-first    greedy, but ATK prices count 4× cheaper (tools/sim/bot.json)
//   def-first    the same for DEF
//   round-robin  cycles through the useful stats in panel order, saving up for the next one
import botJson from './bot.json';
import { type Command, isUnlocked, quoteFor } from '../../src/sim/commands';
import { type GameData, STAT_IDS, type StatId, type TabId } from '../../src/sim/data';
import type { World } from '../../src/sim/state';

export type PolicyName = 'none' | 'greedy' | 'atk-first' | 'def-first' | 'round-robin';
export const POLICIES: PolicyName[] = ['none', 'greedy', 'atk-first', 'def-first', 'round-robin'];
export const USEFUL: readonly StatId[] = STAT_IDS.filter((id) => (botJson.useful as string[]).includes(id));

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
      for (const id of USEFUL) {
        if (!buyable(w, data, id)) continue;
        const score = quoteFor(w, data, id, 1).cost / weight[data.stats.stats[id].tab];
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
      for (let tries = 0; tries < USEFUL.length; tries++) {
        const id = USEFUL[next % USEFUL.length]!;
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

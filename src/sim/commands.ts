// Player commands. Every player action reaches the sim as a command; RunSession stamps each with the
// tick it applies on and logs it, so a seed + log replays the run exactly (spec §6).

import { type GameData, STAT_IDS, type StatId } from './data';
import type { SimEvent } from './events';
import { clampValue } from './num';
import { pickPerk, type ProtocolReject, rerollOffer, takeBoost } from './perks';
import { chance } from './rng';
import { quoteBuy, type BuyQuote } from './stats';
import { type World, worldStats } from './state';

export type BuyCount = number | 'max';

export type Command =
  | { type: 'buy'; stat: StatId; count: BuyCount }
  /** Takes card `index` of the open protocol offer. */
  | { type: 'pickPerk'; index: number }
  /** A new offer: `free` (lab node) or `ad` (after a watched rewarded ad). */
  | { type: 'reroll'; via: 'free' | 'ad' }
  /** Rewarded boost: × Energy for the next waves (pick screen only, with a cooldown). */
  | { type: 'boost' };

export interface LoggedCommand {
  /** World tick before the step that applies it (applied first thing in that step). */
  tick: number;
  cmd: Command;
}

export function isStatId(s: unknown): s is StatId {
  return typeof s === 'string' && (STAT_IDS as readonly string[]).includes(s);
}

export function isUnlocked(w: World, data: GameData, stat: StatId): boolean {
  return !data.stats.stats[stat].lockedByDefault || w.unlocked.includes(stat);
}

function validCount(c: unknown): c is BuyCount {
  return c === 'max' || (typeof c === 'number' && Number.isInteger(c) && c >= 1);
}

/** What a buy would do now; the UI uses this same quote for its price and glow. */
export function quoteFor(w: World, data: GameData, stat: StatId, count: BuyCount): BuyQuote {
  return quoteBuy(data.stats.stats[stat], w.levels[stat], count, w.energy);
}

function reject(events: SimEvent[], stat: unknown, reason: Extract<SimEvent, { type: 'buyRejected' }>['reason']): void {
  events.push({ type: 'buyRejected', stat: typeof stat === 'string' ? stat : String(stat), reason });
}

function buy(w: World, data: GameData, stat: unknown, count: unknown, events: SimEvent[]): void {
  if (w.dead) return reject(events, stat, 'dead');
  if (!isStatId(stat)) return reject(events, stat, 'unknown');
  if (!validCount(count)) return reject(events, stat, 'badCount');
  if (!isUnlocked(w, data, stat)) return reject(events, stat, 'locked');
  const q = quoteFor(w, data, stat, count);
  if (q.levels === 0) return reject(events, stat, 'maxed');
  if (!q.affordable) return reject(events, stat, 'funds');
  const before = worldStats(w, data);
  // Free Upgrade: one roll per accepted purchase on its own stream, so buying never shifts combat or
  // spawn randomness. Free means the whole batch is free: the expected refund (p × cost) is the same
  // as rolling every level separately, but stays O(1) for a MAX buy.
  const free = chance(w.rng.upgrades, before.freeUpgrade);
  if (!free) w.energy = clampValue(Math.max(0, w.energy - q.cost));
  w.levels[stat] += q.levels;
  const after = worldStats(w, data);
  // Health purchases also fill the new HP; the value itself is always derived.
  if (after.health > before.health) w.core.hp = clampValue(w.core.hp + (after.health - before.health));
  if (w.core.hp > after.health) w.core.hp = after.health;
  events.push({ type: 'buy', stat, levels: q.levels, level: w.levels[stat], cost: free ? 0 : q.cost, free });
}

function protocol(events: SimEvent[], cmd: string, r: ProtocolReject | null): void {
  if (r !== null) events.push({ type: 'commandRejected', cmd, reason: r });
}

/** Applies commands in order. Invalid ones change nothing and emit `buyRejected` / `commandRejected`. */
export function applyCommands(w: World, data: GameData, cmds: readonly Command[], events: SimEvent[]): void {
  for (const cmd of cmds) {
    const c = cmd as { type?: unknown; stat?: unknown; count?: unknown; index?: unknown; via?: unknown };
    if (c.type === 'buy') buy(w, data, c.stat, c.count, events);
    else if (c.type === 'pickPerk') protocol(events, 'pickPerk', pickPerk(w, data, c.index, events));
    else if (c.type === 'reroll') protocol(events, 'reroll', rerollOffer(w, data, c.via, events));
    else if (c.type === 'boost') protocol(events, 'boost', takeBoost(w, data, events));
    else if (typeof c.stat === 'string') reject(events, c.stat, 'unknown');
    else events.push({ type: 'commandRejected', cmd: String(c.type), reason: 'unknown' });
  }
}

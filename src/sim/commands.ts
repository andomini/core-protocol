// Player commands. Every player action reaches the sim as a command; RunSession stamps each with the
// tick it applies on and logs it, so a seed + log replays the run exactly (spec §6).

import { type GameData, STAT_IDS, type StatId } from './data';
import type { SimEvent } from './events';
import { clampValue } from './num';
import { fusionStructure, moveCrystalModule, pickBoot, pickPerk, type ProtocolReject, rerollOffer, structureBuilt, structureFusionNames, takeBoost } from './perks';
import { pulseCommand } from './pulse'; // pulse
import { STRUCTURE_KINDS, type StructureKind } from './perkData'; // C4
import { chance } from './rng';
import { structLevel, structUpgradeCost, structUpgradeDef } from './structLevels'; // C4
import { quoteBuy, type BuyQuote } from './stats';
import { type World, worldStats } from './state';

export type BuyCount = number | 'max';

export type Command =
  | { type: 'buy'; stat: StatId; count: BuyCount }
  /** Takes card `index` of the open protocol offer; `slot` = crystal hex [q, r] for a new module (else auto). */
  | { type: 'pickPerk'; index: number; slot?: [number, number] }
  // boot
  /** Takes boot sector `index` of the run-start boot offer (its modules on their hexes). */
  | { type: 'pickBoot'; index: number }
  /** Moves the crystal module at `from` to hex `to`; a module at `to` swaps places with it (spec 2026-10-15 §2). */
  | { type: 'moveModule'; from: [number, number]; to: [number, number] }
  /** A new offer: `free` (lab node) or `ad` (after a watched rewarded ad). */
  | { type: 'reroll'; via: 'free' | 'ad' }
  /** Rewarded boost: × Energy for the next waves (pick screen only, with a cooldown). */
  | { type: 'boost' }
  /** Rewarded revive after death: once per run, part of the HP back, nearby viruses purged. */
  | { type: 'revive'; hp?: number }
  /** pulse: the core's Pulse ring (src/sim/pulse.ts); rejected with `cooldown` while it recharges. */
  | { type: 'pulse' }
  /** C4: buys the next upgrade level of a structure kind (src/sim/structLevels.ts) with Energy; levels are per kind. */
  | { type: 'upgradeStruct'; kind: StructureKind };

export interface LoggedCommand {
  /** World tick before the step that applies it (applied first thing in that step). */
  tick: number;
  cmd: Command;
}

export function isStatId(s: unknown): s is StatId {
  return typeof s === 'string' && (STAT_IDS as readonly string[]).includes(s);
}

/** A BUILD stat is waiting for a structure: true while none of the structures it upgrades is built (its fusion is at tier 0). */
export function awaitsStructure(w: World, data: GameData, stat: StatId): boolean {
  const needs = data.stats.stats[stat].needs;
  return needs !== undefined && !needs.some((kind) => structureBuilt(w, data, kind));
}

/** Open for purchase: not behind a lab node, and (BUILD stats) its structure stands. Bought levels persist through link breaks. */
export function isUnlocked(w: World, data: GameData, stat: StatId): boolean {
  return (!data.stats.stats[stat].lockedByDefault || w.unlocked.includes(stat)) && !awaitsStructure(w, data, stat);
}

/** What a locked row tells the player: "needs Wall/Relay" (a short name for each structure that would open it) for a BUILD stat, else null (a lab node unlocks it). */
export function buildNeedText(w: World, data: GameData, stat: StatId): string | null {
  if (!awaitsStructure(w, data, stat)) return null;
  const names = data.stats.stats[stat].needs!.flatMap((kind) => structureFusionNames(data, kind));
  return `needs ${[...new Set(names)].join('/')}`;
}

function validCount(c: unknown): c is BuyCount {
  return c === 'max' || (typeof c === 'number' && Number.isInteger(c) && c >= 1);
}

/** What a buy would do now; the UI uses this same quote for its price and glow. */
export function quoteFor(w: World, data: GameData, stat: StatId, count: BuyCount): BuyQuote {
  const def = data.stats.stats[stat];
  const bonus = w.lab.maxBonus[stat] ?? 0;
  const eff = bonus > 0 && def.maxLevel !== undefined ? { ...def, maxLevel: def.maxLevel + bonus } : def;
  return quoteBuy(eff, w.levels[stat], count, w.energy);
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

/** Rewarded revive: once per run; HP back to `reviveHp`, viruses near the core purged (no rewards). */
function revive(w: World, data: GameData, hp: unknown, events: SimEvent[]): ProtocolReject | null {
  if (!w.dead) return 'phase';
  if (w.revived) return 'used';
  w.dead = false;
  w.revived = true;
  // The run-end bonus was paid at death; it is paid again (on the new total) at the next death.
  w.bits = clampValue(Math.max(0, w.bits - w.bitsBonus));
  w.bitsBonus = 0;
  const r2 = data.config.reviveClearRadius * data.config.reviveClearRadius;
  w.enemies = w.enemies.filter((e) => e.x * e.x + e.y * e.y > r2);
  w.projectiles = [];
  // Structures stand again with the core (nothing the revived run could not have rebuilt later). Only what is on the
  // field now: an unlinked kind stays as it was (a damaged one counted as destroyed when the link broke) and so does
  // a station above the current count.
  for (const s of w.structs) {
    const built = fusionStructure(w, data, s.kind);
    if (built === undefined) continue;
    if (s.kind === 'wall' ? s.slot >= data.structures.wall.segments : s.kind !== 'mine' && s.slot >= (built.count ?? 0)) continue;
    if (s.share > 0 && s.share < 1) s.share = 1;
    else if (s.share <= 0) {
      s.share = 1;
      s.downUntilTick = 0;
      events.push({ type: 'structUp', sid: s.id, kind: s.kind, x: s.x, y: s.y });
    }
  }
  // Second Wind (card) revives with its own HP share; the rewarded revive uses config.reviveHp.
  const share = typeof hp === 'number' && hp > 0 && hp <= 1 ? hp : data.config.reviveHp;
  w.core.hp = clampValue(worldStats(w, data).health * share);
  events.push({ type: 'revive', hp: w.core.hp });
  return null;
}

// C4: structure upgrades. No Free Upgrade roll (that stays with the stat buys, on its own stream).
function upgradeStruct(w: World, data: GameData, kind: unknown, events: SimEvent[]): void {
  const no = (reason: Extract<SimEvent, { type: 'structUpgradeRejected' }>['reason']) => {
    events.push({ type: 'structUpgradeRejected', kind: String(kind), reason });
  };
  if (w.dead) return no('dead');
  if (!(STRUCTURE_KINDS as readonly unknown[]).includes(kind)) return no('unknown');
  const k = kind as StructureKind;
  if (structUpgradeDef(data, k) === undefined || !structureBuilt(w, data, k)) return no('locked');
  const level = structLevel(w, data, k);
  const cost = structUpgradeCost(data, k, level);
  if (!Number.isFinite(cost)) return no('maxed');
  if (w.energy < cost) return no('funds');
  w.energy = clampValue(Math.max(0, w.energy - cost));
  w.structLevels = { ...w.structLevels, [k]: level + 1 };
  events.push({ type: 'structUpgrade', kind: k, level: level + 1, cost });
}

function protocol(events: SimEvent[], cmd: string, r: ProtocolReject | null): void {
  if (r !== null) events.push({ type: 'commandRejected', cmd, reason: r });
}

/** Applies commands in order. Invalid ones change nothing and emit `buyRejected` / `commandRejected`. */
export function applyCommands(w: World, data: GameData, cmds: readonly Command[], events: SimEvent[]): void {
  for (const cmd of cmds) {
    const c = cmd as { type?: unknown; stat?: unknown; count?: unknown; index?: unknown; via?: unknown };
    if (c.type === 'buy') buy(w, data, c.stat, c.count, events);
    else if (c.type === 'pickPerk') protocol(events, 'pickPerk', pickPerk(w, data, c.index, events, (cmd as { slot?: unknown }).slot));
    else if (c.type === 'pickBoot') protocol(events, 'pickBoot', pickBoot(w, data, c.index, events)); // boot
    else if (c.type === 'moveModule') {
      const m = cmd as { from?: unknown; to?: unknown };
      protocol(events, 'moveModule', moveCrystalModule(w, data, m.from, m.to, events));
    } else if (c.type === 'reroll') protocol(events, 'reroll', rerollOffer(w, data, c.via, events));
    else if (c.type === 'boost') protocol(events, 'boost', takeBoost(w, data, events));
    else if (c.type === 'pulse') protocol(events, 'pulse', pulseCommand(w, data, events)); // pulse
    else if (c.type === 'upgradeStruct') upgradeStruct(w, data, (cmd as { kind?: unknown }).kind, events); // C4
    else if (c.type === 'revive') protocol(events, 'revive', revive(w, data, (cmd as { hp?: unknown }).hp, events));
    else if (typeof c.stat === 'string') reject(events, c.stat, 'unknown');
    else events.push({ type: 'commandRejected', cmd: String(c.type), reason: 'unknown' });
  }
}

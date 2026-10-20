// Protocols (spec §2.4): pick schedule, offers (rarity, pity, tag weighting, locked perks), picks, rerolls,
// the rewarded boost, tag counting (perks + card tags), set and fusion tiers, and the derived perk profile
// that the combat code reads. Stat effects become World.mods once (at pick / tier activation; a tier that
// switches off takes its mods back); everything else is derived from the perk stacks and tiers by
// perkProfile(), never stored.

import type { BootSector, GameData, StatId } from './data';
import type { SimEvent } from './events';
import { type CrystalShape, crystalTagCounts, crystalShape, freeSlots, fusionEffects, fusionLinkCounts, fusionLinks, fusionSteps, fusionTierAt, fusionTierIndex, isSlot, ladderTier, moveModule, placeModule } from './crystal';
import { geneKeep } from './mutations';
import { clampValue, powInt } from './num';
import { ownedShare } from './territory';
import { applyStructLevels } from './structLevels'; // C4
import { type Effect, FREEZE_ALL_MAX_SHARE, fusionKeys, MARK_FIELDS, type MarkValues, RARITIES, type Rarity, RULE_IDS, type Rules, type StructureKind, type StructureValues, TAGS, type Tag } from './perkData';
import { createStream, nextInt, pickWeighted } from './rng';
import type { World } from './state';
import { effectiveStats, type Modifier } from './stats';

/** A periodic effect's state: `next` = tick (everySec) or wave (everyWaves) it is ready; active while tick ≤ `until`. */
export interface Timer {
  next: number;
  until: number;
}

export function perkIds(data: GameData): string[] {
  return Object.keys(data.perks.perks);
}

/**
 * True when a pick opens for wave `wave` (1, 3, 5, 8, 10, then every 5 after the last listed wave).
 * `every` > 0 overrides the cadence after the listed waves (lab node).
 */
// boot
/** isPickWave for this run: a taken boot sector stands in for the picks at `boot.skipPicks`. */
export function pickDue(w: World, data: GameData, wave: number, everyOverride = 0): boolean {
  if (w.boot !== '' && data.boot.skipPicks.includes(wave)) return false;
  return isPickWave(data, wave, everyOverride);
}

export function isPickWave(data: GameData, wave: number, everyOverride = 0): boolean {
  const { waves } = data.perks.schedule;
  const every = everyOverride > 0 ? everyOverride : data.perks.schedule.every;
  if (waves.includes(wave)) return true;
  const last = waves[waves.length - 1]!;
  return wave > last && (wave - last) % every === 0;
}

/** Raw count per tag: 1 per perk stack plus 1 per card tag (what the run "holds", for offers). */
export function rawTagCounts(w: World, data: GameData): Record<Tag, number> {
  const out = {} as Record<Tag, number>;
  for (const t of TAGS) out[t] = 0;
  for (const id of perkIds(data)) {
    const n = w.perks[id] ?? 0;
    if (n > 0) out[data.perks.perks[id]!.tag] += n;
  }
  for (const t of w.cardTags) out[t] += 1;
  return out;
}

/**
 * Set count per tag (spec 2026-10-14 §A): the stacks of the largest connected cluster of that tag's
 * crystal modules, plus 1 per card tag.
 */
export function tagCounts(w: World, _data: GameData): Record<Tag, number> {
  return crystalTagCounts(w);
}

export function heldTags(w: World, data: GameData): Tag[] {
  const c = rawTagCounts(w, data);
  return TAGS.filter((t) => c[t] > 0);
}

/** Highest set tier reached with `count` (0 if none). */
export function tierFor(data: GameData, count: number): number {
  return ladderTier(data.sets.tiers, count);
}

/** Next tier above `count`, or 0 when the top tier is reached. */
export function nextTier(data: GameData, count: number): number {
  for (const t of data.sets.tiers) if (count < t) return t;
  return 0;
}

/** Highest fusion tier reached with `links` (0 if none; tiers are link counts, sets.fusionTiers). */
export function fusionTierFor(data: GameData, links: number): number {
  return ladderTier(data.sets.fusionTiers, links);
}

/** Next fusion tier above `links`, or 0 when the top tier is reached. */
export function nextFusionTier(data: GameData, links: number, key?: string): number {
  for (const t of key === undefined ? data.sets.fusionTiers : fusionSteps(data, key)) if (links < t) return t;
  return 0;
}

function statUnlocked(w: World, data: GameData, stat: StatId): boolean {
  return !data.stats.stats[stat].lockedByDefault || w.unlocked.includes(stat);
}

/** Can this perk be offered now: below max stacks and its required stat (if any) unlocked. */
export function perkEligible(w: World, data: GameData, id: string): boolean {
  const d = data.perks.perks[id]!;
  if ((w.perks[id] ?? 0) >= d.maxStacks) return false;
  return d.requires === undefined || statUnlocked(w, data, d.requires);
}

type Slot = 'tag' | 'rare' | 'any';

/**
 * Builds an offer of `w.offerSize` distinct eligible perks. Its RNG depends only on the seed, the pick
 * number and the reroll index, so purchases, combat and earlier rerolls never change an offer.
 * - Tag weighting: when the run holds tags, one card carries a held tag (if any such perk is eligible).
 * - Pity: after `pityAfter` picks whose offers had no Rare+, one card is Rare or Epic.
 * The rest are random by rarity weight; the final order is shuffled.
 */
export function generateOffer(w: World, data: GameData, rerolls: number): string[] {
  const pd = data.perks;
  const rng = createStream(w.seed, `perks:${w.picks + 1}:${rerolls}`);
  const ids = perkIds(data);
  const held = heldTags(w, data);
  const slots: Slot[] = [];
  if (held.length > 0) slots.push('tag');
  if (w.pity >= pd.offer.pityAfter) slots.push('rare');
  while (slots.length < w.offerSize) slots.push('any');
  slots.length = w.offerSize;
  // Lab node: × weight on Rare/Epic (integer weights for pickWeighted).
  const mul = (r: Rarity): number => (r === 'common' ? pd.offer.rarityWeights[r] : Math.round(pd.offer.rarityWeights[r] * w.lab.rareMul));
  const weights = RARITIES.map(mul);
  const rareWeights = RARITIES.map((r) => (r === 'common' ? 0 : mul(r)));
  const offer: string[] = [];
  for (const slot of slots) {
    const rarity = pickWeighted(rng, RARITIES, slot === 'rare' ? rareWeights : weights);
    // Fallback order when the drawn rarity has nothing eligible: the other Rare+ first for a pity slot.
    const order: Rarity[] = slot === 'rare' ? [rarity, rarity === 'rare' ? 'epic' : 'rare', 'common'] : [rarity, ...RARITIES.filter((r) => r !== rarity)];
    const ok = (id: string, tagOnly: boolean): boolean =>
      !offer.includes(id) && perkEligible(w, data, id) && (!tagOnly || held.includes(pd.perks[id]!.tag));
    let pick: string | undefined;
    for (const tagOnly of slot === 'tag' ? [true, false] : [false]) {
      for (const r of order) {
        const cand = ids.filter((id) => pd.perks[id]!.rarity === r && ok(id, tagOnly));
        if (cand.length > 0) {
          pick = cand[nextInt(rng, cand.length)];
          break;
        }
      }
      if (pick !== undefined) break;
    }
    if (pick !== undefined) offer.push(pick);
  }
  // Shuffle so the weighted card is not always first.
  for (let i = offer.length - 1; i > 0; i--) {
    const j = nextInt(rng, i + 1);
    const t = offer[i]!;
    offer[i] = offer[j]!;
    offer[j] = t;
  }
  return offer;
}

export function offerHasRarePlus(data: GameData, offer: readonly string[]): boolean {
  return offer.some((id) => data.perks.perks[id]!.rarity !== 'common');
}

/** Opens a pick (the world stops ticking). Returns false when nothing is eligible (no pick). */
export function enterPick(w: World, data: GameData, events: SimEvent[] | null): boolean {
  const offer = generateOffer(w, data, 0);
  if (offer.length === 0) return false;
  w.phase = 'pick';
  w.offer = offer;
  w.rerolls = 0;
  events?.push({ type: 'pickOffer', pick: w.picks + 1, wave: w.wave, offer: [...offer], rerolls: 0 });
  return true;
}

function maxHealth(w: World, data: GameData): number {
  return effectiveStats(data, { workshop: w.workshop, run: w.levels, mods: w.mods }).health;
}

/** Appends an effect list's stat changes to World.mods, `stacks` times each. */
export function appendStatMods(w: World, effects: readonly Effect[], stacks: number, source: string): void {
  for (const e of effects) {
    if (e.type !== 'statAdd' && e.type !== 'statMul' && e.type !== 'capAdd') continue;
    for (let i = 0; i < stacks; i++) {
      const m: Modifier = { stat: e.stat, op: e.type === 'statAdd' ? 'add' : e.type === 'statMul' ? 'mul' : 'cap', value: e.value, source };
      w.mods.push(m);
    }
  }
}

/**
 * Moves one ladder (a set's or a fusion's) from tier `prev` to `next`: tiers newly reached add their stat
 * mods and arm their periodic timers (source `<prefix>:<t>`, timers `<source>:<i>`); tiers no longer reached
 * take both back. Tiers in between are untouched, so a ladder that drops and comes back never doubles up.
 * Wave-charged (immunity) timers outlive a drop: they are inert while the tier is off (only the profile's
 * periodic list reads them), and rebuilding the tier must not recharge a spent window.
 */
function shiftTier(w: World, data: GameData, prefix: string, ladder: readonly number[], effectsAt: (t: number) => readonly Effect[], prev: number, next: number): void {
  for (const t of ladder) {
    const source = `${prefix}:${t}`;
    if (t > prev && t <= next) {
      const effects = effectsAt(t);
      appendStatMods(w, effects, 1, source);
      effects.forEach((e, i) => {
        if (e.type !== 'periodic') return;
        // Seconds-based effects first fire one period after activation; wave-charged ones start charged
        // (unless an earlier activation of this tier already spent the charge).
        const key = `${source}:${i}`;
        if (e.action === 'immunity') w.timers[key] ??= { next: 0, until: -1 };
        else w.timers[key] = { next: w.tick + Math.round(e.everySec * data.config.tickHz), until: -1 };
      });
    } else if (t > next && t <= prev) {
      w.mods = w.mods.filter((m) => m.source !== source);
      const effects = effectsAt(t);
      effects.forEach((e, i) => {
        if (e.type === 'periodic' && e.action !== 'immunity') delete w.timers[`${source}:${i}`];
      });
    }
  }
}

/**
 * Brings set and fusion tiers in line with the crystal now (spec 2026-10-15 §3): called after every crystal
 * change (pick, move, run start). Tiers are live: a move that breaks a cluster or a contact switches the
 * tier off. `setTier` / `fusion` events only for tiers that changed.
 */
export function refreshCrystal(w: World, data: GameData, events: SimEvent[] | null): void {
  keepHealthShare(w, data, () => refreshTiers(w, data, events));
}

function refreshTiers(w: World, data: GameData, events: SimEvent[] | null): void {
  const counts = tagCounts(w, data);
  // Gene averaging (spec 2026-10-16 §5): the set counts held now, summed every tick by accumulateCrystal.
  for (const tag of TAGS) w.tagCountsNow[tag] = counts[tag];
  for (const tag of TAGS) {
    const prev = w.setTiers[tag];
    const tier = tierFor(data, counts[tag]);
    if (tier === prev) continue;
    shiftTier(w, data, `set:${tag}`, data.sets.tiers, (t) => data.sets.sets[tag][String(t)]!, prev, tier);
    w.setTiers[tag] = tier;
    events?.push({ type: 'setTier', tag, tier, prev });
  }
  // Weld (spec 2026-10-16 §3): a rise waits in fusionPending until settleWeld (weldTicks with the link count
  // unchanged; a new link count or target restarts the wait); a drop applies at once and cancels the wait.
  const links = fusionLinkCounts(w, data);
  for (const key of fusionKeys()) {
    const n = links[key] ?? 0;
    const prev = w.fusionTiers[key] ?? 0;
    const tier = fusionTierAt(data, key, n, counts);
    if (tier > prev) {
      const p = w.fusionPending[key];
      if (p === undefined || p.links !== n || p.tier !== tier) w.fusionPending[key] = { tier, links: n, sinceTick: w.tick };
      continue;
    }
    delete w.fusionPending[key];
    if (tier !== prev) setFusionTier(w, data, key, prev, tier, events);
  }
}

function setFusionTier(w: World, data: GameData, key: string, prev: number, tier: number, events: SimEvent[] | null): void {
  shiftTier(w, data, `fusion:${key}`, fusionSteps(data, key), (t) => fusionEffects(data, key, t), prev, tier);
  if (tier > 0) w.fusionTiers[key] = tier;
  else delete w.fusionTiers[key];
  // The run's best tier per pair (stored like fusionTiers): RunResult.fusionsReached for the Codex.
  if (tier > (w.fusionBest[key] ?? 0)) w.fusionBest[key] = tier;
  const l = fusionLinks(w, data).find((f) => f.key === key);
  const a = l ? w.crystal[l.a]! : null;
  const b = l ? w.crystal[l.b]! : null;
  events?.push({ type: 'fusion', key, tier, prev, a: a ? [a.q, a.r] : null, b: b ? [b.q, b.r] : null });
}

/**
 * Weld (spec 2026-10-16 §3), once per tick before the profile: pending fusion rises whose link count held for
 * weldTicks apply now (HP share kept, like any crystal change).
 */
export function settleWeld(w: World, data: GameData, events: SimEvent[] | null): void {
  if (Object.keys(w.fusionPending).length === 0) return;
  for (const key of fusionKeys()) {
    const p = w.fusionPending[key];
    if (p === undefined || w.tick - p.sinceTick < data.sets.weldTicks) continue;
    delete w.fusionPending[key];
    const prev = w.fusionTiers[key] ?? 0;
    if (p.tier !== prev) keepHealthShare(w, data, () => setFusionTier(w, data, key, prev, p.tier, events));
  }
}

/**
 * Rebuilds every set and fusion tier from the crystal under the current rules (snapshot migration of runs
 * saved before crystal combos v2, whose tiers and `set:` / `fusion:` mods came from older ladders and global
 * link counts). Tiers apply at once (no weld: they were held before the save); timers that still exist keep
 * their progress; the HP share is kept.
 */
export function rebuildCrystal(w: World, data: GameData): void {
  const stale = (k: string) => k.startsWith('set:') || k.startsWith('fusion:');
  const oldTimers: World['timers'] = {};
  keepHealthShare(w, data, () => {
    w.mods = w.mods.filter((m) => !stale(m.source));
    for (const k of Object.keys(w.timers)) {
      if (!stale(k)) continue;
      oldTimers[k] = w.timers[k]!;
      delete w.timers[k];
    }
    for (const t of TAGS) w.setTiers[t] = 0;
    w.fusionTiers = {};
    w.fusionPending = {};
    refreshTiers(w, data, null);
    for (const key of fusionKeys()) {
      const p = w.fusionPending[key];
      if (p === undefined) continue;
      delete w.fusionPending[key];
      setFusionTier(w, data, key, 0, p.tier, null);
    }
    for (const k of Object.keys(w.timers)) if (oldTimers[k] !== undefined) w.timers[k] = oldTimers[k];
  });
}

/** Every tick: Lattice (sum of fusion tier indices, spec 2026-10-16 §4) and gene (set counts, §5) accumulators. */
export function accumulateCrystal(w: World, data: GameData): void {
  w.latticeSum = clampValue(w.latticeSum + latticeNow(w, data));
  w.latticeTicks += 1;
  for (const t of TAGS) w.geneAcc[t] = clampValue(w.geneAcc[t] + w.tagCountsNow[t]);
  w.geneTicks += 1;
}

/** The Lattice now: the sum of fusion tier indices (I = 1 … Apex = 4) on the crystal this tick. */
export function latticeNow(w: World, data: GameData): number {
  let sum = 0;
  for (const key in w.fusionTiers) sum += fusionTierIndex(data, key, w.fusionTiers[key]!);
  return sum;
}

/** The run's tick-averaged Lattice (what run-end Bits are multiplied by): 0 before the first tick. */
export function latticeMean(w: World): number {
  return w.latticeTicks > 0 ? w.latticeSum / w.latticeTicks : 0;
}

/** Run-end Bits bonus share from the Lattice: latticeCoef × the tick-averaged Lattice, at most latticeMax. */
export function latticeBonus(w: World, data: GameData): number {
  return Math.min(data.sets.latticeCoef * latticeMean(w), data.sets.latticeMax);
}

/** Run-end Bits multiplier from the Lattice: 1 + latticeBonus. */
export function latticeMul(w: World, data: GameData): number {
  return 1 + latticeBonus(w, data);
}

/** Run start: sets completed by card tags alone, then the boot sector pick (`boot`), else the opening (wave-1) pick. */
export function initProtocols(w: World, data: GameData, boot = true): void {
  refreshCrystal(w, data, null);
  if (w.protocols && boot && enterBoot(w, data)) return;
  if (w.protocols && isPickWave(data, 1)) enterPick(w, data, null);
}

// ---------------------------------------------------------------------------------------------------------
// boot — Boot sectors (uniqueness plan item 1): before wave 1 the run offers `boot.offerSize` starter crystals
// (boot.json), drawn from the seed alone. Taking one grants its modules on their hexes (set tier 2 at once);
// then the wave-1 protocol pick opens as usual (if the schedule has one), else the run starts.

export function bootSector(data: GameData, id: string): BootSector | undefined {
  return data.boot.sectors.find((s) => s.id === id);
}

/** True while the boot pick is open (phase `pick` with a boot offer, no protocol offer). */
export function bootOpen(w: World): boolean {
  return w.phase === 'pick' && w.bootOffer.length > 0;
}

/** The boot offer: `offerSize` distinct sectors in a seed-only order (stream `boot`), so nothing else shifts it. */
export function generateBootOffer(w: World, data: GameData): string[] {
  const rng = createStream(w.seed, 'boot');
  const ids = data.boot.sectors.map((s) => s.id);
  // Partial Fisher–Yates: the first offerSize entries.
  const n = Math.min(data.boot.offerSize, ids.length);
  for (let i = 0; i < n; i++) {
    const j = i + nextInt(rng, ids.length - i);
    const t = ids[i]!;
    ids[i] = ids[j]!;
    ids[j] = t;
  }
  return ids.slice(0, n);
}

/** Opens the boot pick at run start (the world waits in `pick`). False when there is nothing to offer. */
function enterBoot(w: World, data: GameData): boolean {
  if (w.crystal.length > 0) return false;
  const offer = generateBootOffer(w, data);
  if (offer.length === 0) return false;
  w.phase = 'pick';
  w.bootOffer = offer;
  return true;
}

/**
 * The pickBoot command: takes sector `index` of the boot offer and grants its modules on their hexes (a hex
 * that is no longer free falls back to the auto slot), then opens the wave-1 protocol pick (if scheduled).
 */
export function pickBoot(w: World, data: GameData, index: unknown, events: SimEvent[]): ProtocolReject | null {
  if (w.dead) return 'dead';
  if (!bootOpen(w)) return 'phase';
  if (!Number.isInteger(index) || (index as number) < 0 || (index as number) >= w.bootOffer.length) return 'index';
  const sector = bootSector(data, w.bootOffer[index as number]!);
  if (sector === undefined) return 'index';
  w.bootOffer = [];
  w.boot = sector.id;
  w.phase = 'pause';
  for (const m of sector.modules) {
    const free = freeSlots(w, data).some(([q, r]) => q === m.slot[0] && r === m.slot[1]);
    grantPerk(w, data, m.perk, events, free ? [m.slot[0], m.slot[1]] : undefined);
  }
  refreshCrystal(w, data, events);
  const modules = w.crystal.filter((c) => sector.modules.some((m) => m.perk === c.perk)).map((c): [number, number] => [c.q, c.r]);
  events.push({ type: 'bootPicked', id: sector.id, tag: sector.tag, modules });
  if (w.protocols && pickDue(w, data, 1)) enterPick(w, data, events);
  return null;
}

/** Changes that may move max HP keep the current HP consistent (as a Health purchase does). */
function withHealth(w: World, data: GameData, fn: () => void): void {
  const before = maxHealth(w, data);
  fn();
  const after = maxHealth(w, data);
  if (after > before) w.core.hp = clampValue(w.core.hp + (after - before));
  if (w.core.hp > after) w.core.hp = after;
}

/**
 * Crystal moves keep the HP share instead: switching a Health bonus off and back on with free moves must
 * not heal (a full core stays full, a core at 30 % stays at 30 %).
 */
function keepHealthShare(w: World, data: GameData, fn: () => void): void {
  const before = maxHealth(w, data);
  fn();
  const after = maxHealth(w, data);
  if (after === before) return;
  w.core.hp = w.core.hp >= before ? after : clampValue((w.core.hp * after) / before);
}

/**
 * Adds one stack of `id` (crystal module, stat mods once, set tiers). Used by the pick command and by
 * tests. `slot` places a new module there (it must be free; check with crystal.freeSlots), else auto.
 */
export function grantPerk(w: World, data: GameData, id: string, events: SimEvent[] | null, slot?: [number, number]): void {
  withHealth(w, data, () => {
    w.perks[id] = (w.perks[id] ?? 0) + 1;
    placeModule(w, data, id, slot);
    appendStatMods(w, data.perks.perks[id]!.effects, 1, `perk:${id}`);
    const m = w.crystal.find((c) => c.perk === id);
    events?.push({ type: 'perkPicked', id, stacks: w.perks[id]!, module: m ? [m.q, m.r] : null });
  });
  withHealth(w, data, () => refreshTiers(w, data, events));
}

export type ProtocolReject = 'dead' | 'phase' | 'index' | 'noReroll' | 'cooldown' | 'used' | 'slot' | 'empty' | 'link';

/**
 * The moveModule command (spec 2026-10-15 §2): moves (or swaps) a crystal module while the core is alive,
 * then refreshes set and fusion tiers. When it is offered is the UI's call (picks and the pause menu).
 */
export function moveCrystalModule(w: World, data: GameData, from: unknown, to: unknown, events: SimEvent[]): ProtocolReject | null {
  if (w.dead) return 'dead';
  const r = moveModule(w, data, from, to);
  if (r !== null) return r;
  refreshCrystal(w, data, events);
  return null;
}

/**
 * Takes card `index` of the open offer; the world resumes into the between-waves pause. `slot` ([q, r])
 * places a new module there; without it the module goes to the auto slot. A bad slot rejects the pick.
 */
export function pickPerk(w: World, data: GameData, index: unknown, events: SimEvent[], slot?: unknown): ProtocolReject | null {
  if (w.dead) return 'dead';
  if (w.phase !== 'pick' || w.bootOffer.length > 0) return 'phase'; // boot: not during the boot pick
  if (!Number.isInteger(index) || (index as number) < 0 || (index as number) >= w.offer.length) return 'index';
  const offer = w.offer;
  const id = offer[index as number]!;
  let at: [number, number] | undefined;
  if (slot !== undefined && slot !== null && !w.crystal.some((m) => m.perk === id)) {
    if (!isSlot(slot) || !freeSlots(w, data).some(([q, r]) => q === slot[0] && r === slot[1])) return 'slot';
    at = [slot[0], slot[1]];
  }
  w.pity = offerHasRarePlus(data, offer) ? 0 : w.pity + 1;
  w.picks += 1;
  w.offer = [];
  w.rerolls = 0;
  w.phase = 'pause';
  grantPerk(w, data, id, events, at);
  return null;
}

/** A new offer for the same pick: `free` uses a lab reroll, `ad` follows a watched rewarded ad. */
export function rerollOffer(w: World, data: GameData, via: unknown, events: SimEvent[]): ProtocolReject | null {
  if (w.dead) return 'dead';
  if (w.phase !== 'pick' || w.bootOffer.length > 0) return 'phase'; // boot: not during the boot pick
  if (via !== 'free' && via !== 'ad') return 'index';
  if (w.rerolls >= data.perks.offer.maxRerolls) return 'noReroll';
  if (via === 'free') {
    if (w.freeRerolls <= 0) return 'noReroll';
    w.freeRerolls -= 1;
  }
  const rerolls = w.rerolls + 1;
  const offer = generateOffer(w, data, rerolls);
  if (offer.length > 0) w.offer = offer;
  w.rerolls = rerolls;
  events.push({ type: 'pickOffer', pick: w.picks + 1, wave: w.wave, offer: [...w.offer], rerolls });
  return null;
}

/** Can the rewarded boost be taken now (pick phase, cooldown over)? */
export function boostAvailable(w: World, data: GameData): boolean {
  if (w.dead || w.phase !== 'pick' || w.bootOffer.length > 0) return false;
  return w.boost.from === 0 || w.wave + 1 >= w.boost.from + data.perks.boost.cooldownWaves;
}

/** Rewarded boost: × Energy for the next `waves` waves (the waves after this pick). */
export function takeBoost(w: World, data: GameData, events: SimEvent[]): ProtocolReject | null {
  if (w.dead) return 'dead';
  if (w.phase !== 'pick' || w.bootOffer.length > 0) return 'phase'; // boot: not during the boot pick
  if (!boostAvailable(w, data)) return 'cooldown';
  w.boost = { from: w.wave + 1, until: w.wave + data.perks.boost.waves };
  events.push({ type: 'boost', from: w.boost.from, until: w.boost.until });
  return null;
}

export function boostActive(w: World): boolean {
  return w.boost.from > 0 && w.wave >= w.boost.from && w.wave <= w.boost.until;
}

// ---------------------------------------------------------------------------------------------------------
// Derived profile: what the combat code reads every tick.

export type PeriodicEffect = Extract<Effect, { type: 'periodic' }>;

export interface PerkProfile {
  rules: Rules;
  /** On-hit slow strength and its duration in ticks. */
  slowOnHit: number;
  slowTicks: number;
  freezeChance: number;
  /** Freeze duration in ticks (rule freezeSeconds already applied). */
  freezeTicks: number;
  lightningChance: number;
  critLightning: boolean;
  /** Damage multipliers by target state. */
  slowedMul: number;
  frozenMul: number;
  hpBelowFrac: number;
  hpBelowMul: number;
  /** Every Nth projectile × nthMul (nthEvery 0 = off). */
  nthEvery: number;
  nthMul: number;
  /** Cold aura: enemies within auraFrac × range move auraSlow slower. */
  auraFrac: number;
  auraSlow: number;
  /** Extra Energy share per kill, boss multipliers, Keys per boss. */
  killEnergy: number;
  bossEnergyMul: number;
  bossBitsMul: number;
  bossKeys: number;
  /** Active periodic effects with their timer keys. */
  periodic: { key: string; e: PeriodicEffect }[];
  /** Kernel Panic: × damage while the core is below a share of max HP. */
  coreHpBelowFrac: number;
  coreHpBelowMul: number;
  /** Barrier: shield = this share of max HP at each wave start. */
  shieldFrac: number;
  /** Wave Skip chance per regular wave. */
  waveSkip: number;
  /** Fusions: kill Energy × by how the kill happened; lightning freezes; Thorns slow; core hits strike back. */
  critKillMul: number;
  frozenKillMul: number;
  chainKillMul: number;
  lightningFreezeTicks: number;
  thornsSlow: number;
  thornsSlowTicks: number;
  /** Fusion structures by kind, folded field-wise (max) over the reached tiers; absent = not built. */
  structures: Partial<Record<StructureKind, StructureValues>>;
  /** Bounty Marks folded over the reached tiers (null = no Marks); `markTurrets`: Bastion turrets prefer Marks (both fusions ≥ II). */
  mark: MarkValues | null;
  markTurrets: boolean;
  /** The crystal's sectors, reach and muzzles this tick (spec 2026-10-14 §A). */
  shape: CrystalShape;
  /** Share of the territory that is ours (§B). */
  owned: number;
  /** Gene keeps (§C): crit bonus, slows, kill Energy, Defense/Thorns (lightning/bounce/freeze go into rules). */
  geneCrit: number;
  geneSlow: number;
  geneEnergy: number;
  geneGuard: number;
}

function blankProfile(data: GameData): PerkProfile {
  return {
    rules: { ...data.perks.rules },
    slowOnHit: 0,
    slowTicks: 0,
    freezeChance: 0,
    freezeTicks: 0,
    lightningChance: 0,
    critLightning: false,
    slowedMul: 1,
    frozenMul: 1,
    hpBelowFrac: 0,
    hpBelowMul: 1,
    nthEvery: 0,
    nthMul: 1,
    auraFrac: 0,
    auraSlow: 0,
    killEnergy: 0,
    bossEnergyMul: 1,
    bossBitsMul: 1,
    bossKeys: 0,
    periodic: [],
    coreHpBelowFrac: 0,
    coreHpBelowMul: 1,
    shieldFrac: 0,
    waveSkip: 0,
    critKillMul: 1,
    frozenKillMul: 1,
    chainKillMul: 1,
    lightningFreezeTicks: 0,
    thornsSlow: 0,
    thornsSlowTicks: 0,
    structures: {},
    mark: null,
    markTurrets: false,
    shape: { sectors: [null, null, null, null, null, null], reach: [0, 0, 0, 0, 0, 0], tips: [] },
    owned: 0,
    geneCrit: 1,
    geneSlow: 1,
    geneEnergy: 1,
    geneGuard: 1,
  };
}

/** Tiers add up like set tiers, but a structure ladder only raises: the field-wise max over what was reached. */
function foldStructure(into: Partial<Record<StructureKind, StructureValues>>, e: Extract<Effect, { type: 'structure' }>): void {
  const acc = (into[e.kind] ??= {});
  for (const [k, v] of Object.entries(e)) if (k !== 'type' && k !== 'kind') acc[k] = Math.max(acc[k] ?? 0, v as number);
}

/** Mark ladders fold field-wise: max, except the jackpot cadence (fewer Marks per jackpot is better: min). */
function foldMark(p: { mark: MarkValues | null }, e: Extract<Effect, { type: 'mark' }>): void {
  if (p.mark === null) {
    const blank = {} as MarkValues;
    for (const f of MARK_FIELDS) blank[f] = 0;
    p.mark = blank;
  }
  const m = p.mark;
  for (const f of MARK_FIELDS) {
    const v = e[f];
    if (v === undefined) continue;
    m[f] = f === 'jackpotEvery' && m[f] > 0 ? Math.min(m[f], v) : Math.max(m[f], v);
  }
}

/** Bounty Marks as the fusion ladders fold them (the HUD's view of the profile), null = no Marks. */
export function fusionMark(w: World, data: GameData): MarkValues | null {
  const p: { mark: MarkValues | null } = { mark: null };
  for (const key of fusionKeys()) {
    const tier = w.fusionTiers[key] ?? 0;
    if (tier === 0) continue;
    for (const t of fusionSteps(data, key)) {
      if (t > tier) break;
      for (const e of fusionEffects(data, key, t)) if (e.type === 'mark') foldMark(p, e);
    }
  }
  return p.mark;
}

/** Fusion keys whose ladders carry Marks (cached per GameData). */
const MARK_KEYS = new WeakMap<GameData, string[]>();
function markKeys(data: GameData): string[] {
  let k = MARK_KEYS.get(data);
  if (k === undefined) {
    k = fusionKeys().filter((key) => fusionSteps(data, key).some((t) => fusionEffects(data, key, t).some((e) => e.type === 'mark')));
    MARK_KEYS.set(data, k);
  }
  return k;
}

/** Most Marks any ladder step asks for (the per-wave Mark plan draws this many). */
export function maxMarks(data: GameData): number {
  let n = 0;
  for (const key of markKeys(data)) for (const t of fusionSteps(data, key)) for (const e of fusionEffects(data, key, t)) if (e.type === 'mark') n = Math.max(n, e.count ?? 0);
  return n;
}

/** One structure kind as the fusion ladders alone fold it (cheap; the renderer's view of the profile), undefined = not built. */
export function fusionStructure(w: World, data: GameData, kind: StructureKind): StructureValues | undefined {
  const into: Partial<Record<StructureKind, StructureValues>> = {};
  for (const key of fusionKeys()) {
    const tier = w.fusionTiers[key] ?? 0;
    for (const t of data.sets.fusionTiers) {
      if (t > tier) break;
      for (const e of data.sets.fusions[key]!.tiers[String(t)]!) if (e.type === 'structure' && e.kind === kind) foldStructure(into, e);
    }
  }
  applyStructLevels(w, data, into); // C4
  return into[kind];
}

/** Per structure kind: the fusions that build it, each with the link tier where the kind first appears. Built once per GameData (the data is immutable). */
const BUILDERS = new WeakMap<GameData, Partial<Record<StructureKind, { key: string; tier: number }[]>>>();

function structureBuilders(data: GameData, kind: StructureKind): readonly { key: string; tier: number }[] {
  let all = BUILDERS.get(data);
  if (all === undefined) BUILDERS.set(data, (all = {}));
  let list = all[kind];
  if (list === undefined) {
    list = [];
    for (const key of fusionKeys()) {
      const tier = data.sets.fusionTiers.find((t) => data.sets.fusions[key]!.tiers[String(t)]!.some((e) => e.type === 'structure' && e.kind === kind));
      if (tier !== undefined) list.push({ key, tier });
    }
    all[kind] = list;
  }
  return list;
}

/** Whether a fusion link tier high enough to build `kind` is reached. Same answer as `fusionStructure(...) !== undefined`, without folding or allocating. */
export function structureBuilt(w: World, data: GameData, kind: StructureKind): boolean {
  for (const b of structureBuilders(data, kind)) if ((w.fusionTiers[b.key] ?? 0) >= b.tier) return true;
  return false;
}

/** Short names of the firewall fusions that build `kind` ("Wall" for the Ice Wall), empty when none does. */
export function structureFusionNames(data: GameData, kind: StructureKind): string[] {
  return structureBuilders(data, kind).map((b) => data.sets.fusions[b.key]!.short ?? data.sets.fusions[b.key]!.name);
}

/** Folds every held perk (× stacks), every reached set and fusion tier and the cards into one profile. Pure; O(perks + sets). */
export function perkProfile(w: World, data: GameData): PerkProfile {
  const p = blankProfile(data);
  const hz = data.config.tickHz;
  const add = {} as Record<string, number>;
  const mul = {} as Record<string, number>;
  let freezeSeconds = 0;
  const fold = (e: Effect, n: number, key: string): void => {
    switch (e.type) {
      case 'statAdd':
      case 'statMul':
      case 'capAdd':
        return; // already in World.mods
      case 'onHit':
        if (e.action === 'slow') {
          p.slowOnHit += e.strength * n;
          p.slowTicks = Math.max(p.slowTicks, Math.round(e.seconds * hz));
        } else if (e.action === 'freeze') {
          p.freezeChance += e.chance * n;
          freezeSeconds = Math.max(freezeSeconds, e.seconds);
        } else p.lightningChance += e.chance * n;
        return;
      case 'onCrit':
        p.critLightning = true;
        return;
      case 'onKill':
        if (e.kind === 'boss') {
          if (e.energyMul !== undefined) p.bossEnergyMul *= 1 + (e.energyMul - 1) * n;
          if (e.bitsMul !== undefined) p.bossBitsMul *= 1 + (e.bitsMul - 1) * n;
          if (e.keys !== undefined) p.bossKeys += e.keys * n;
        } else if (e.energy !== undefined) p.killEnergy += e.energy * n;
        return;
      case 'periodic':
        p.periodic.push({ key, e });
        return;
      case 'conditional':
        if (e.when === 'innerRange') {
          p.auraFrac = Math.max(p.auraFrac, e.frac);
          p.auraSlow += e.slow * n;
        } else {
          const m = 1 + (e.damageMul - 1) * n;
          if (e.when === 'targetSlowed') p.slowedMul *= m;
          else if (e.when === 'targetFrozen') p.frozenMul *= m;
          else if (e.when === 'coreHpBelow') {
            p.coreHpBelowFrac = Math.max(p.coreHpBelowFrac, e.frac);
            p.coreHpBelowMul *= m;
          } else if (e.when === 'targetHpBelow') {
            p.hpBelowFrac = Math.max(p.hpBelowFrac, e.frac);
            p.hpBelowMul *= m;
          } else if (e.when === 'nthShot') {
            p.nthEvery = p.nthEvery === 0 ? e.every : Math.min(p.nthEvery, e.every);
            p.nthMul *= m;
          }
        }
        return;
      case 'ruleChange':
        if (e.op === 'add') add[e.rule] = (add[e.rule] ?? 0) + e.value * n;
        else mul[e.rule] = (mul[e.rule] ?? 1) * powInt(e.value, n);
        return;
      case 'shield':
        p.shieldFrac = Math.max(p.shieldFrac, e.frac);
        return;
      case 'waveSkip':
        p.waveSkip += e.chance * n;
        return;
      case 'killBonus': {
        const m = 1 + (e.energyMul - 1) * n;
        if (e.when === 'crit') p.critKillMul *= m;
        else if (e.when === 'frozen') p.frozenKillMul *= m;
        else p.chainKillMul *= m;
        return;
      }
      case 'lightningFreeze':
        p.lightningFreezeTicks = Math.max(p.lightningFreezeTicks, Math.round(e.seconds * hz));
        return;
      case 'thornsSlow':
        p.thornsSlow = Math.max(p.thornsSlow, e.strength);
        p.thornsSlowTicks = Math.max(p.thornsSlowTicks, Math.round(e.seconds * hz));
        return;
      case 'structure':
        foldStructure(p.structures, e);
        return;
      case 'mark':
        foldMark(p, e);
        return;
    }
  };
  const pd = data.perks.perks;
  for (const id of perkIds(data)) {
    const n = w.perks[id] ?? 0;
    if (n > 0) for (const e of pd[id]!.effects) fold(e, n, `perk:${id}`);
  }
  for (const tag of TAGS) {
    const tier = w.setTiers[tag];
    if (tier === 0) continue;
    for (const t of data.sets.tiers) {
      if (t > tier) break;
      data.sets.sets[tag][String(t)]!.forEach((e, i) => fold(e, 1, `set:${tag}:${t}:${i}`));
    }
  }
  for (const key of fusionKeys()) {
    const tier = w.fusionTiers[key] ?? 0;
    if (tier === 0) continue;
    for (const t of fusionSteps(data, key)) {
      if (t > tier) break;
      fusionEffects(data, key, t).forEach((e, i) => fold(e, 1, `fusion:${key}:${t}:${i}`));
    }
  }
  for (const c of w.cards) c.effects.forEach((e, i) => fold(e, 1, `card:${c.id}:${i}`));
  applyStructLevels(w, data, p.structures); // C4: bought structure levels on top of the ladders
  // Bounty Marks × Bastion (spec 2026-10-16 synergies): both at II or more → turrets prefer the Marked target.
  if (p.mark !== null && p.structures.turret !== undefined) {
    const ii = data.sets.fusionTiers[1] ?? Infinity;
    p.markTurrets = markKeys(data).some((k) => (w.fusionTiers[k] ?? 0) >= ii) && structureBuilders(data, 'turret').some((b) => (w.fusionTiers[b.key] ?? 0) >= ii);
  }
  for (const r of RULE_IDS) p.rules[r] = clampValue((p.rules[r] + (add[r] ?? 0)) * (mul[r] ?? 1));
  // Genes (spec 2026-10-14 §C): Antifreeze shortens every freeze, Insulation weakens bounces and lightning.
  const chain = geneKeep(w, data, 'chain');
  p.rules.lightningDamage = clampValue(p.rules.lightningDamage * chain);
  p.rules.bounceDamage = clampValue(p.rules.bounceDamage * chain);
  p.geneSlow = geneKeep(w, data, 'cryo');
  p.rules.freezeSeconds = clampValue(p.rules.freezeSeconds * p.geneSlow);
  p.geneCrit = geneKeep(w, data, 'overload');
  p.geneEnergy = geneKeep(w, data, 'mining');
  p.geneGuard = geneKeep(w, data, 'firewall');
  p.shape = crystalShape(w, data);
  p.owned = ownedShare(w, data);
  p.freezeTicks = Math.max(1, Math.round(freezeSeconds * p.rules.freezeSeconds * hz));
  return p;
}

/** Ticks a periodic effect lasts (freeze-all is stretched by the freezeSeconds rule, like every freeze). */
export function periodicTicks(data: GameData, prof: PerkProfile, e: PeriodicEffect): number {
  // Freeze-all is stretched by freezeSeconds but never beyond FREEZE_ALL_MAX_SHARE of its period (no freeze lock).
  const s = e.action === 'freezeAll' ? Math.min(e.seconds * prof.rules.freezeSeconds, FREEZE_ALL_MAX_SHARE * e.everySec) : e.seconds;
  return Math.max(1, Math.round(s * data.config.tickHz));
}

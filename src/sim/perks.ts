// Protocols (spec §2.4): pick schedule, offers (rarity, pity, tag weighting, locked perks), picks, rerolls,
// the rewarded boost, tag counting (perks + card tags), set tiers, and the derived perk profile that the
// combat code reads. Stat effects become World.mods once (at pick / set activation); everything else is
// derived from the perk stacks and set tiers by perkProfile(), never stored.

import type { GameData, StatId } from './data';
import type { SimEvent } from './events';
import { clampValue, powInt } from './num';
import { type Effect, RARITIES, type Rarity, RULE_IDS, type Rules, TAGS, type Tag } from './perkData';
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
export function isPickWave(data: GameData, wave: number, everyOverride = 0): boolean {
  const { waves } = data.perks.schedule;
  const every = everyOverride > 0 ? everyOverride : data.perks.schedule.every;
  if (waves.includes(wave)) return true;
  const last = waves[waves.length - 1]!;
  return wave > last && (wave - last) % every === 0;
}

/** Count toward each tag: 1 per perk stack plus 1 per card tag. */
export function tagCounts(w: World, data: GameData): Record<Tag, number> {
  const out = {} as Record<Tag, number>;
  for (const t of TAGS) out[t] = 0;
  for (const id of perkIds(data)) {
    const n = w.perks[id] ?? 0;
    if (n > 0) out[data.perks.perks[id]!.tag] += n;
  }
  for (const t of w.cardTags) out[t] += 1;
  return out;
}

export function heldTags(w: World, data: GameData): Tag[] {
  const c = tagCounts(w, data);
  return TAGS.filter((t) => c[t] > 0);
}

/** Highest set tier reached with `count` (0 if none). */
export function tierFor(data: GameData, count: number): number {
  let tier = 0;
  for (const t of data.sets.tiers) if (count >= t) tier = t;
  return tier;
}

/** Next tier above `count`, or 0 when the top tier is reached. */
export function nextTier(data: GameData, count: number): number {
  for (const t of data.sets.tiers) if (count < t) return t;
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
    if (e.type !== 'statAdd' && e.type !== 'statMul') continue;
    for (let i = 0; i < stacks; i++) {
      const m: Modifier = { stat: e.stat, op: e.type === 'statAdd' ? 'add' : 'mul', value: e.value, source };
      w.mods.push(m);
    }
  }
}

/** Raises tiers reached by the current counts: stat mods once, periodic timers armed, `setTier` events. */
export function applySetTiers(w: World, data: GameData, events: SimEvent[] | null): void {
  const counts = tagCounts(w, data);
  for (const tag of TAGS) {
    const reached = tierFor(data, counts[tag]);
    for (const t of data.sets.tiers) {
      if (t <= w.setTiers[tag] || t > reached) continue;
      const effects = data.sets.sets[tag][String(t)]!;
      const source = `set:${tag}:${t}`;
      appendStatMods(w, effects, 1, source);
      effects.forEach((e, i) => {
        if (e.type !== 'periodic') return;
        // Seconds-based effects first fire one period after activation; wave-charged ones start charged.
        w.timers[`${source}:${i}`] = { next: e.action === 'immunity' ? 0 : w.tick + Math.round(e.everySec * data.config.tickHz), until: -1 };
      });
      events?.push({ type: 'setTier', tag, tier: t });
    }
    if (reached > w.setTiers[tag]) w.setTiers[tag] = reached;
  }
}

/** Run start: sets completed by card tags alone, then the opening (wave-1) pick. */
export function initProtocols(w: World, data: GameData): void {
  applySetTiers(w, data, null);
  if (w.protocols && isPickWave(data, 1)) enterPick(w, data, null);
}

/** Changes that may move max HP keep the current HP consistent (as a Health purchase does). */
function withHealth(w: World, data: GameData, fn: () => void): void {
  const before = maxHealth(w, data);
  fn();
  const after = maxHealth(w, data);
  if (after > before) w.core.hp = clampValue(w.core.hp + (after - before));
  if (w.core.hp > after) w.core.hp = after;
}

/** Adds one stack of `id` (stat mods once, set tiers). Used by the pick command and by tests. */
export function grantPerk(w: World, data: GameData, id: string, events: SimEvent[] | null): void {
  withHealth(w, data, () => {
    w.perks[id] = (w.perks[id] ?? 0) + 1;
    appendStatMods(w, data.perks.perks[id]!.effects, 1, `perk:${id}`);
    events?.push({ type: 'perkPicked', id, stacks: w.perks[id]! });
    applySetTiers(w, data, events);
  });
}

export type ProtocolReject = 'dead' | 'phase' | 'index' | 'noReroll' | 'cooldown' | 'used';

/** Takes card `index` of the open offer; the world resumes into the between-waves pause. */
export function pickPerk(w: World, data: GameData, index: unknown, events: SimEvent[]): ProtocolReject | null {
  if (w.dead) return 'dead';
  if (w.phase !== 'pick') return 'phase';
  if (!Number.isInteger(index) || (index as number) < 0 || (index as number) >= w.offer.length) return 'index';
  const offer = w.offer;
  const id = offer[index as number]!;
  w.pity = offerHasRarePlus(data, offer) ? 0 : w.pity + 1;
  w.picks += 1;
  w.offer = [];
  w.rerolls = 0;
  w.phase = 'pause';
  grantPerk(w, data, id, events);
  return null;
}

/** A new offer for the same pick: `free` uses a lab reroll, `ad` follows a watched rewarded ad. */
export function rerollOffer(w: World, data: GameData, via: unknown, events: SimEvent[]): ProtocolReject | null {
  if (w.dead) return 'dead';
  if (w.phase !== 'pick') return 'phase';
  if (via !== 'free' && via !== 'ad') return 'index';
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
  if (w.dead || w.phase !== 'pick') return false;
  return w.boost.from === 0 || w.wave + 1 >= w.boost.from + data.perks.boost.cooldownWaves;
}

/** Rewarded boost: × Energy for the next `waves` waves (the waves after this pick). */
export function takeBoost(w: World, data: GameData, events: SimEvent[]): ProtocolReject | null {
  if (w.dead) return 'dead';
  if (w.phase !== 'pick') return 'phase';
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
  };
}

/** Folds every held perk (× stacks) and every reached set tier into one profile. Pure; O(perks + sets). */
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
  for (const c of w.cards) c.effects.forEach((e, i) => fold(e, 1, `card:${c.id}:${i}`));
  for (const r of RULE_IDS) p.rules[r] = clampValue((p.rules[r] + (add[r] ?? 0)) * (mul[r] ?? 1));
  p.freezeTicks = Math.max(1, Math.round(freezeSeconds * p.rules.freezeSeconds * hz));
  return p;
}

/** Ticks a periodic effect lasts (freeze-all is stretched by the freezeSeconds rule, like every freeze). */
export function periodicTicks(data: GameData, prof: PerkProfile, e: PeriodicEffect): number {
  const s = e.action === 'freezeAll' ? e.seconds * prof.rules.freezeSeconds : e.seconds;
  return Math.max(1, Math.round(s * data.config.tickHz));
}

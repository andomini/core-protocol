// Protocol (perk) and set data types + validation (spec §2.4, §5: effects are data with a small set of types).
// Pure: imported by data.ts. No numbers live here; everything comes from src/data/perks.json and sets.json.

import { STAT_IDS, type StatId } from './statIds';
import type { ModTarget } from './stats';

export const TAGS = ['overload', 'cryo', 'chain', 'mining', 'firewall'] as const;
export type Tag = (typeof TAGS)[number];

export const RARITIES = ['common', 'rare', 'epic'] as const;
export type Rarity = (typeof RARITIES)[number];

/** Mechanic parameters that perks and sets change with `ruleChange` (base values in perks.json `rules`). */
export const RULE_IDS = [
  'bounces', 'bounceDamage', 'bounceRange',
  'lightningTargets', 'lightningDamage', 'lightningRange',
  'freezeSeconds', 'slowBonus', 'slowCap',
  'enemyHp', 'thornsRanged', 'runEndBits', 'bossLightning', 'enemySpeed',
] as const;
export type RuleId = (typeof RULE_IDS)[number];
export type Rules = Record<RuleId, number>;

export const EFFECT_TYPES = ['statAdd', 'statMul', 'onHit', 'onCrit', 'onKill', 'periodic', 'conditional', 'ruleChange', 'shield', 'waveSkip', 'capAdd', 'killBonus', 'lightningFreeze', 'thornsSlow', 'structure'] as const;
export type EffectType = (typeof EFFECT_TYPES)[number];

/** Battlefield structures a firewall fusion builds (spec 2026-10-15). The wall, turret, mine and station are simulated. */
export const STRUCTURE_KINDS = ['wall', 'turret', 'mine', 'station'] as const;
export type StructureKind = (typeof STRUCTURE_KINDS)[number];

/** Every number a `structure` effect can carry (the union over the kinds; STRUCTURE_FIELDS says which kind takes which). */
export type StructureField =
  | 'hpFrac' | 'regrowSec' | 'shatterRadius' | 'shatterSec'
  | 'count' | 'dmgFrac' | 'rateMul' | 'range' | 'targets' | 'frenzyBelow' | 'frenzyMul'
  | 'perWave' | 'max' | 'dmgMul' | 'blast' | 'arcs'
  | 'energy' | 'rebuildWaves' | 'bits' | 'streakStep' | 'streakMax';

/** How a structure field is checked: `pos` > 0, `frac` in (0, 1], `nonNeg` ≥ 0, else a whole number in [min, max]. */
type FieldRule = { pos: true } | { frac: true } | { min: number; max: number } | { nonNeg: true };
/** Per kind: every field a `structure` effect may set; `req` fields must all be set once the kind first appears in a ladder. */
export const STRUCTURE_FIELDS: Record<StructureKind, Record<string, { rule: FieldRule; req: boolean }>> = {
  wall: {
    hpFrac: { rule: { frac: true }, req: true },
    regrowSec: { rule: { pos: true }, req: false },
    shatterRadius: { rule: { pos: true }, req: false },
    shatterSec: { rule: { pos: true }, req: false },
  },
  turret: {
    count: { rule: { min: 0, max: 6 }, req: true },
    dmgFrac: { rule: { pos: true }, req: true },
    rateMul: { rule: { pos: true }, req: true },
    range: { rule: { pos: true }, req: true },
    targets: { rule: { min: 1, max: 8 }, req: true },
    frenzyBelow: { rule: { frac: true }, req: false },
    frenzyMul: { rule: { pos: true }, req: false },
  },
  mine: {
    perWave: { rule: { min: 1, max: 12 }, req: true },
    max: { rule: { min: 1, max: 12 }, req: true },
    dmgMul: { rule: { pos: true }, req: true },
    blast: { rule: { pos: true }, req: true },
    targets: { rule: { min: 1, max: 8 }, req: true },
    arcs: { rule: { min: 0, max: 8 }, req: true },
  },
  station: {
    count: { rule: { min: 0, max: 6 }, req: true },
    hpFrac: { rule: { frac: true }, req: true },
    energy: { rule: { pos: true }, req: true },
    rebuildWaves: { rule: { min: 1, max: 100 }, req: true },
    bits: { rule: { nonNeg: true }, req: true },
    streakStep: { rule: { pos: true }, req: false },
    streakMax: { rule: { pos: true }, req: false },
  },
};

/** The numbers of one structure kind as folded over a fusion's reached tiers (field-wise max; larger is always better). */
export type StructureValues = Record<string, number>;

export type Effect =
  /** A flat change to a stat (or the Interest cap), appended to World.mods once per stack. */
  | { type: 'statAdd'; stat: ModTarget; value: number }
  /** A multiplier on a stat, appended to World.mods once per stack (stacks compound). */
  | { type: 'statMul'; stat: ModTarget; value: number }
  /** Projectile hits: slow (strength × stacks for `seconds`), freeze (chance × stacks), lightning (chance × stacks). */
  | { type: 'onHit'; action: 'slow'; strength: number; seconds: number }
  | { type: 'onHit'; action: 'freeze'; chance: number; seconds: number }
  | { type: 'onHit'; action: 'lightning'; chance: number }
  /** Every critical hit throws lightning (targets/damage from the rules). */
  | { type: 'onCrit'; action: 'lightning' }
  /** Kill rewards: +energy share per stack; × energy/bits (1 + (m − 1)·stacks); + keys per stack; `kind` filters. */
  | { type: 'onKill'; kind?: 'boss'; energy?: number; energyMul?: number; bitsMul?: number; keys?: number }
  /** Timed triggers (sets): every `everySec` seconds or charged every `everyWaves` waves. */
  | { type: 'periodic'; action: 'overdrive'; everySec: number; seconds: number; value: number }
  | { type: 'periodic'; action: 'freezeAll'; everySec: number; seconds: number }
  | { type: 'periodic'; action: 'immunity'; everyWaves: number; seconds: number; hpBelow: number }
  /** Cards: × damage for `seconds` every `everySec` (Overclock); a bolt from the core at the nearest enemy (Tesla Coil, `value` × damage). */
  | { type: 'periodic'; action: 'damageBoost'; everySec: number; seconds: number; value: number }
  | { type: 'periodic'; action: 'tesla'; everySec: number; seconds: number; value: number }
  /** Situational damage / slow: damage × (1 + (m − 1)·stacks) when the condition holds. */
  | { type: 'conditional'; when: 'targetSlowed' | 'targetFrozen'; damageMul: number }
  | { type: 'conditional'; when: 'targetHpBelow'; frac: number; damageMul: number }
  | { type: 'conditional'; when: 'nthShot'; every: number; damageMul: number }
  | { type: 'conditional'; when: 'innerRange'; frac: number; slow: number }
  /** Core damage × (1 + (m − 1)·stacks) while the core is below `frac` of its max HP (Kernel Panic). */
  | { type: 'conditional'; when: 'coreHpBelow'; frac: number; damageMul: number }
  /** A mechanic parameter: add (× stacks) or mul (^stacks). */
  | { type: 'ruleChange'; rule: RuleId; op: 'add' | 'mul'; value: number }
  /** A shield worth `frac` of max HP at every wave start; it absorbs core damage first (Barrier). */
  | { type: 'shield'; frac: number }
  /** Chance that a regular wave is skipped: nothing spawns, its kill rewards are paid at once (Wave Skip). */
  | { type: 'waveSkip'; chance: number }
  /** Raises a capped stat's cap by `value` per stack, up to the stat's `capMax` (Hardening). */
  | { type: 'capAdd'; stat: StatId; value: number }
  /** Kill Energy × (1 + (m − 1)·stacks) when the killing hit was a crit, the target was frozen, or it came from a bounce / lightning. */
  | { type: 'killBonus'; when: 'crit' | 'frozen' | 'chain'; energyMul: number }
  /** Lightning also freezes every enemy it hits for `seconds`. */
  | { type: 'lightningFreeze'; seconds: number }
  /** A Thorns hit slows its attacker by `strength` for `seconds`. */
  | { type: 'thornsSlow'; strength: number; seconds: number }
  /** A fusion's battlefield structure; the fields are per kind (STRUCTURE_FIELDS), a tier lists only what it raises. */
  | ({ type: 'structure'; kind: StructureKind } & { [F in StructureField]?: number });

export interface PerkDef {
  name: string;
  tag: Tag;
  rarity: Rarity;
  maxStacks: number;
  /** A trade-off perk (a bonus with a cost). */
  tradeoff?: boolean;
  /** Stays out of the offer pool until this (lab-locked) stat is unlocked. */
  requires?: StatId;
  effects: Effect[];
}

export interface PerksData {
  /** Picks at these waves, then every `every` waves after the last one. */
  schedule: { waves: number[]; every: number };
  offer: { size: number; sizeLab: number; rarityWeights: Record<Rarity, number>; pityAfter: number };
  /** Free rerolls per run with the lab node (RunOptions.freeReroll). */
  freeRerolls: number;
  /** Rewarded boost: × Energy for `waves` waves, at most once every `cooldownWaves`. */
  boost: { energyMul: number; waves: number; cooldownWaves: number };
  rules: Rules;
  perks: Record<string, PerkDef>;
}

export type SetTierKey = '2' | '4' | '6';
/** A fusion's ladder: tier key (a link count from `fusionTiers`) → the effects it adds (tiers add up). */
export interface FusionDef {
  name: string;
  /** Phone-row label ("Wall", "Relay") for the BUILD rows' "needs ..." text; defaults to `name`. */
  short?: string;
  tiers: Record<string, Effect[]>;
  /** Apex (spec 2026-10-16 §2): one optional step past the top tier at `apexLinks` links, only while both tags' set counts are ≥ sets.apexSet. Stored as tier `apexLinks`. */
  apex?: Effect[];
  apexLinks?: number;
}

export interface SetsData {
  tags: Record<Tag, { name: string }>;
  tiers: number[];
  sets: Record<Tag, Record<string, Effect[]>>;
  /** Fusion tiers (spec 2026-10-15 §1): links (shared edges between the pair's modules) each tier needs. */
  fusionTiers: number[];
  /** Cap on the product of the kill-Energy fusion multipliers (crit x frozen x chain) in hitEnemy. */
  howCap: number;
  /** Apex gate: both tags' set counts must be at least this (spec 2026-10-16 §2). */
  apexSet: number;
  /** Weld: a fusion tier rise applies after this many ticks with the pair's link count unchanged (§3). */
  weldTicks: number;
  /** Lattice: run-end Bits × (1 + latticeCoef × the tick-averaged sum of fusion tier indices) (§4). */
  latticeCoef: number;
  /** One fusion per tag pair, keyed "a+b" in TAGS order (fusionKey). */
  fusions: Record<string, FusionDef>;
}

/** Canonical key of a tag pair: "a+b" with a before b in TAGS order. */
export function fusionKey(x: Tag, y: Tag): string {
  return TAGS.indexOf(x) < TAGS.indexOf(y) ? `${x}+${y}` : `${y}+${x}`;
}

/** Every tag pair's key, in TAGS order. */
export function fusionKeys(): string[] {
  const out: string[] = [];
  for (let i = 0; i < TAGS.length; i++) for (let j = i + 1; j < TAGS.length; j++) out.push(`${TAGS[i]}+${TAGS[j]}`);
  return out;
}

function check(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`data: ${msg}`);
}
const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
function pos(x: unknown, at: string): void {
  check(finite(x) && x > 0, `${at} must be a finite number > 0, got ${String(x)}`);
}
function frac(x: unknown, at: string): void {
  check(finite(x) && x > 0 && x <= 1, `${at} must be in (0, 1], got ${String(x)}`);
}
function wholePos(x: unknown, at: string): void {
  check(Number.isInteger(x) && (x as number) >= 1, `${at} must be a whole number ≥ 1, got ${String(x)}`);
}

const MOD_TARGETS: readonly string[] = [...STAT_IDS, 'interestCap'];

export function validateEffect(e: Effect, at: string, allowStructure = false): void {
  check(e !== null && typeof e === 'object' && (EFFECT_TYPES as readonly string[]).includes(e.type), `${at}.type must be one of ${EFFECT_TYPES.join('|')}`);
  switch (e.type) {
    case 'statAdd':
    case 'statMul':
      check(MOD_TARGETS.includes(e.stat), `${at}.stat: unknown stat "${String(e.stat)}"`);
      check(finite(e.value), `${at}.value must be finite`);
      if (e.type === 'statMul') pos(e.value, `${at}.value`);
      return;
    case 'capAdd':
      check((STAT_IDS as readonly string[]).includes(e.stat), `${at}.stat: unknown stat "${String(e.stat)}"`);
      pos(e.value, `${at}.value`);
      return;
    case 'onHit':
      if (e.action === 'slow') {
        frac(e.strength, `${at}.strength`);
        pos(e.seconds, `${at}.seconds`);
      } else if (e.action === 'freeze') {
        frac(e.chance, `${at}.chance`);
        pos(e.seconds, `${at}.seconds`);
      } else if (e.action === 'lightning') {
        frac(e.chance, `${at}.chance`);
      } else check(false, `${at}.action must be slow|freeze|lightning`);
      return;
    case 'onCrit':
      check(e.action === 'lightning', `${at}.action must be lightning`);
      return;
    case 'onKill':
      check(e.kind === undefined || e.kind === 'boss', `${at}.kind must be absent or "boss"`);
      check(e.energy !== undefined || e.energyMul !== undefined || e.bitsMul !== undefined || e.keys !== undefined, `${at} has no reward`);
      if (e.energy !== undefined) pos(e.energy, `${at}.energy`);
      if (e.energyMul !== undefined) pos(e.energyMul, `${at}.energyMul`);
      if (e.bitsMul !== undefined) pos(e.bitsMul, `${at}.bitsMul`);
      if (e.keys !== undefined) wholePos(e.keys, `${at}.keys`);
      return;
    case 'periodic':
      pos(e.seconds, `${at}.seconds`);
      if (e.action === 'overdrive') {
        pos(e.everySec, `${at}.everySec`);
        pos(e.value, `${at}.value`);
      } else if (e.action === 'freezeAll') {
        pos(e.everySec, `${at}.everySec`);
        // Freeze-lock guard: the base freeze may cover at most this share of its period (periodicTicks clamps the multiplied one).
        check(e.seconds <= FREEZE_ALL_MAX_SHARE * e.everySec, `${at}.seconds must be <= ${FREEZE_ALL_MAX_SHARE} x everySec`);
      } else if (e.action === 'immunity') {
        wholePos(e.everyWaves, `${at}.everyWaves`);
        frac(e.hpBelow, `${at}.hpBelow`);
      } else if (e.action === 'damageBoost' || e.action === 'tesla') {
        pos(e.everySec, `${at}.everySec`);
        pos(e.value, `${at}.value`);
      } else check(false, `${at}.action must be overdrive|freezeAll|immunity|damageBoost|tesla`);
      return;
    case 'conditional':
      if (e.when === 'innerRange') {
        frac(e.frac, `${at}.frac`);
        frac(e.slow, `${at}.slow`);
        return;
      }
      check(['targetSlowed', 'targetFrozen', 'targetHpBelow', 'nthShot', 'coreHpBelow'].includes(e.when), `${at}.when is unknown`);
      pos(e.damageMul, `${at}.damageMul`);
      if (e.when === 'targetHpBelow' || e.when === 'coreHpBelow') frac(e.frac, `${at}.frac`);
      if (e.when === 'nthShot') check(Number.isInteger(e.every) && e.every >= 2, `${at}.every must be a whole number ≥ 2`);
      return;
    case 'ruleChange':
      check((RULE_IDS as readonly string[]).includes(e.rule), `${at}.rule: unknown rule "${String(e.rule)}"`);
      check(e.op === 'add' || e.op === 'mul', `${at}.op must be add|mul`);
      check(finite(e.value), `${at}.value must be finite`);
      if (e.op === 'mul') pos(e.value, `${at}.value`);
      return;
    case 'shield':
      frac(e.frac, `${at}.frac`);
      return;
    case 'waveSkip':
      frac(e.chance, `${at}.chance`);
      return;
    case 'killBonus':
      check(e.when === 'crit' || e.when === 'frozen' || e.when === 'chain', `${at}.when must be crit|frozen|chain`);
      pos(e.energyMul, `${at}.energyMul`);
      return;
    case 'lightningFreeze':
      pos(e.seconds, `${at}.seconds`);
      return;
    case 'thornsSlow':
      frac(e.strength, `${at}.strength`);
      pos(e.seconds, `${at}.seconds`);
      return;
    case 'structure': {
      // Only fusion ladders build structures: the renderer folds those alone (fusionStructure) and must agree with the sim.
      check(allowStructure, `${at}: structure effects belong in sets.fusions only`);
      check((STRUCTURE_KINDS as readonly string[]).includes(e.kind), `${at}.kind must be one of ${STRUCTURE_KINDS.join('|')}`);
      const fields = STRUCTURE_FIELDS[e.kind];
      for (const [k, v] of Object.entries(e)) {
        if (k === 'type' || k === 'kind') continue;
        const f = fields[k];
        check(f !== undefined, `${at}.${k}: unknown ${e.kind} field`);
        const r = f!.rule;
        if ('pos' in r) pos(v, `${at}.${k}`);
        else if ('frac' in r) frac(v, `${at}.${k}`);
        else if ('nonNeg' in r) check(finite(v) && v >= 0, `${at}.${k} must be a finite number ≥ 0, got ${String(v)}`);
        else check(Number.isInteger(v) && (v as number) >= r.min && (v as number) <= r.max, `${at}.${k} must be a whole number in ${r.min}..${r.max}, got ${String(v)}`);
      }
      return;
    }
  }
}

export function validatePerks(p: PerksData): void {
  check(p !== undefined && p.perks !== undefined, 'perks is missing');
  check(Array.isArray(p.schedule?.waves) && p.schedule.waves.length > 0, 'perks.schedule.waves must be a non-empty list');
  p.schedule.waves.forEach((w, i) => {
    wholePos(w, `perks.schedule.waves[${i}]`);
    if (i > 0) check(w > p.schedule.waves[i - 1]!, 'perks.schedule.waves must be increasing');
  });
  wholePos(p.schedule.every, 'perks.schedule.every');
  wholePos(p.offer?.size, 'perks.offer.size');
  wholePos(p.offer.sizeLab, 'perks.offer.sizeLab');
  check(p.offer.sizeLab >= p.offer.size, 'perks.offer.sizeLab must be ≥ size');
  for (const r of RARITIES) check(Number.isInteger(p.offer.rarityWeights?.[r]) && p.offer.rarityWeights[r] >= 0, `perks.offer.rarityWeights.${r} must be a whole number ≥ 0`);
  check(p.offer.rarityWeights.common + p.offer.rarityWeights.rare + p.offer.rarityWeights.epic > 0, 'perks.offer.rarityWeights must not all be 0');
  check(p.offer.rarityWeights.rare + p.offer.rarityWeights.epic > 0, 'perks.offer.rarityWeights: pity needs Rare or Epic weight');
  wholePos(p.offer.pityAfter, 'perks.offer.pityAfter');
  check(Number.isInteger(p.freeRerolls) && p.freeRerolls >= 0, 'perks.freeRerolls must be a whole number ≥ 0');
  pos(p.boost?.energyMul, 'perks.boost.energyMul');
  wholePos(p.boost.waves, 'perks.boost.waves');
  wholePos(p.boost.cooldownWaves, 'perks.boost.cooldownWaves');
  for (const r of RULE_IDS) check(finite(p.rules?.[r]) && p.rules[r] >= 0, `perks.rules.${r} must be a finite number ≥ 0`);
  const ids = Object.keys(p.perks);
  check(ids.length > 0, 'perks.perks must not be empty');
  for (const id of ids) {
    const d = p.perks[id]!;
    const at = `perks.perks.${id}`;
    check(typeof d.name === 'string' && d.name.length > 0, `${at}.name must be a non-empty string`);
    check((TAGS as readonly string[]).includes(d.tag), `${at}.tag must be one of ${TAGS.join('|')}`);
    check((RARITIES as readonly string[]).includes(d.rarity), `${at}.rarity must be one of ${RARITIES.join('|')}`);
    wholePos(d.maxStacks, `${at}.maxStacks`);
    if (d.requires !== undefined) check((STAT_IDS as readonly string[]).includes(d.requires), `${at}.requires: unknown stat "${d.requires}"`);
    check(Array.isArray(d.effects) && d.effects.length > 0, `${at}.effects must be a non-empty list`);
    d.effects.forEach((e, i) => validateEffect(e, `${at}.effects[${i}]`));
  }
}

/** Largest share of its period a freeze-all may keep the field frozen (validator and clamp). */
export const FREEZE_ALL_MAX_SHARE = 0.6;

export function validateSets(s: SetsData): void {
  check(s !== undefined && s.sets !== undefined && s.tags !== undefined, 'sets is missing');
  check(Array.isArray(s.tiers) && s.tiers.length > 0, 'sets.tiers must be a non-empty list');
  pos(s.howCap, 'sets.howCap');
  check(s.howCap >= 1, 'sets.howCap must be >= 1');
  wholePos(s.apexSet, 'sets.apexSet');
  wholePos(s.weldTicks, 'sets.weldTicks');
  check(finite(s.latticeCoef) && s.latticeCoef >= 0, 'sets.latticeCoef must be a finite number >= 0');
  s.tiers.forEach((t, i) => {
    wholePos(t, `sets.tiers[${i}]`);
    if (i > 0) check(t > s.tiers[i - 1]!, 'sets.tiers must be increasing');
  });
  for (const tag of TAGS) {
    check(typeof s.tags[tag]?.name === 'string', `sets.tags.${tag}.name is missing`);
    const set = s.sets[tag];
    check(set !== undefined, `sets.sets.${tag} is missing`);
    for (const key of Object.keys(set)) check(s.tiers.includes(Number(key)), `sets.sets.${tag}.${key} is not a tier`);
    for (const t of s.tiers) {
      const eff = set[String(t)];
      check(Array.isArray(eff) && eff.length > 0, `sets.sets.${tag}.${t} must list effects`);
      eff!.forEach((e, i) => validateEffect(e, `sets.sets.${tag}.${t}[${i}]`));
    }
  }
  check(Array.isArray(s.fusionTiers) && s.fusionTiers.length > 0, 'sets.fusionTiers must be a non-empty list');
  s.fusionTiers.forEach((t, i) => {
    wholePos(t, `sets.fusionTiers[${i}]`);
    if (i > 0) check(t > s.fusionTiers[i - 1]!, 'sets.fusionTiers must be increasing');
  });
  check(s.fusions !== null && typeof s.fusions === 'object', 'sets.fusions is missing');
  const keys = fusionKeys();
  for (const key of Object.keys(s.fusions)) check(keys.includes(key), `sets.fusions.${key} is not a tag pair "a+b" in tag order`);
  for (const key of keys) {
    const f = s.fusions[key];
    check(f !== undefined && typeof f.name === 'string' && f.name.length > 0, `sets.fusions.${key}.name is missing`);
    check(f!.short === undefined || (typeof f!.short === 'string' && f!.short.length > 0), `sets.fusions.${key}.short must be a non-empty string`);
    check(f!.tiers !== null && typeof f!.tiers === 'object', `sets.fusions.${key}.tiers is missing`);
    for (const t of Object.keys(f!.tiers)) check(s.fusionTiers.includes(Number(t)), `sets.fusions.${key}.tiers.${t} is not a fusion tier`);
    for (const t of s.fusionTiers) {
      const eff = f!.tiers[String(t)];
      // An empty ladder step is allowed (a tier kept for the link count whose effects are pending a redesign).
      check(Array.isArray(eff), `sets.fusions.${key}.tiers.${t} must list effects`);
      eff!.forEach((e, i) => validateEffect(e, `sets.fusions.${key}.tiers.${t}[${i}]`, true));
    }
    validateStructureLadder(key, f!, s.fusionTiers);
    if (f!.apex !== undefined || f!.apexLinks !== undefined) {
      check(!key.endsWith('+firewall'), `sets.fusions.${key}: firewall fusions have no apex`);
      check(Array.isArray(f!.apex) && f!.apex.length > 0, `sets.fusions.${key}.apex must list effects`);
      wholePos(f!.apexLinks as number, `sets.fusions.${key}.apexLinks`);
      check(f!.apexLinks! > s.fusionTiers[s.fusionTiers.length - 1]!, `sets.fusions.${key}.apexLinks must be above the top fusion tier`);
      f!.apex!.forEach((e, i) => validateEffect(e, `sets.fusions.${key}.apex[${i}]`));
    }
  }
}

/**
 * Folds a fusion's `structure` effects tier by tier like the profile does (field-wise max) and checks the
 * ladder: a kind's required fields are all set once it first appears (so a typo in tier I cannot leave a
 * structure without a count), no later tier lowers a field (larger is always better), perWave ≤ max.
 */
function validateStructureLadder(key: string, f: FusionDef, tiers: readonly number[]): void {
  const folded: Partial<Record<StructureKind, StructureValues>> = {};
  for (const t of tiers) {
    f.tiers[String(t)]!.forEach((e, i) => {
      if (e.type !== 'structure') return;
      const at = `sets.fusions.${key}.tiers.${t}[${i}]`;
      const first = folded[e.kind] === undefined;
      const acc = (folded[e.kind] ??= {});
      for (const [k, v] of Object.entries(e)) {
        if (k === 'type' || k === 'kind') continue;
        check(acc[k] === undefined || (v as number) >= acc[k]!, `${at}.${k} lowers ${e.kind}.${k} (${String(v)} < ${acc[k]}): ladder values must not decrease`);
        acc[k] = v as number;
      }
      if (first) for (const [k, d] of Object.entries(STRUCTURE_FIELDS[e.kind])) check(!d.req || acc[k] !== undefined, `${at}: ${e.kind} is missing "${k}" at its first tier`);
      if (acc.perWave !== undefined && acc.max !== undefined) check(acc.perWave <= acc.max, `${at}: mine perWave must be ≤ max`);
      // The streak multiplier is min(streakMax, 1 + streakStep × streak): without a cap ≥ 1 it would silently stay at 1.
      if (acc.streakStep !== undefined) check(acc.streakMax !== undefined && acc.streakMax >= 1, `${at}: station streakStep needs a streakMax ≥ 1`);
    });
  }
}

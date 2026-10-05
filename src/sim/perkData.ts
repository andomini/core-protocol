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

export const EFFECT_TYPES = ['statAdd', 'statMul', 'onHit', 'onCrit', 'onKill', 'periodic', 'conditional', 'ruleChange', 'shield', 'waveSkip'] as const;
export type EffectType = (typeof EFFECT_TYPES)[number];

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
  | { type: 'waveSkip'; chance: number };

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
export interface SetsData {
  tags: Record<Tag, { name: string }>;
  tiers: number[];
  sets: Record<Tag, Record<string, Effect[]>>;
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

export function validateEffect(e: Effect, at: string): void {
  check(e !== null && typeof e === 'object' && (EFFECT_TYPES as readonly string[]).includes(e.type), `${at}.type must be one of ${EFFECT_TYPES.join('|')}`);
  switch (e.type) {
    case 'statAdd':
    case 'statMul':
      check(MOD_TARGETS.includes(e.stat), `${at}.stat: unknown stat "${String(e.stat)}"`);
      check(finite(e.value), `${at}.value must be finite`);
      if (e.type === 'statMul') pos(e.value, `${at}.value`);
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

export function validateSets(s: SetsData): void {
  check(s !== undefined && s.sets !== undefined && s.tags !== undefined, 'sets is missing');
  check(Array.isArray(s.tiers) && s.tiers.length > 0, 'sets.tiers must be a non-empty list');
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
}

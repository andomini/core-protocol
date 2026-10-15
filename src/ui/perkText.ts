// Player-facing text for protocols and set bonuses, generated from the effect data (no copy in code that
// can drift from the numbers). Short lines: they sit on cards and in the "My protocols" panel.

import type { GameData, StatId } from '../sim/data';
import type { Effect, Tag } from '../sim/perkData';
import type { ModTarget } from '../sim/stats';

const round = (x: number): string => String(Math.round(x * 100) / 100);
/** Percent: whole numbers from 10 % up, one decimal below (2.5 %). */
const pct = (x: number): string => {
  const v = x * 100;
  return `${Math.abs(v) >= 10 ? Math.round(v) : Math.round(v * 10) / 10}%`;
};
/** "+15%" for 1.15, "−25%" for 0.75. */
const signedPct = (mul: number): string => (mul >= 1 ? `+${pct(mul - 1)}` : `−${pct(1 - mul)}`);

function statName(data: GameData, stat: ModTarget): string {
  if (stat === 'interestCap') return 'Interest cap';
  return data.stats.stats[stat as StatId].name;
}

function statAdd(data: GameData, stat: ModTarget, v: number): string {
  if (stat === 'interestCap') return `+${round(v)} Interest cap`;
  const def = data.stats.stats[stat as StatId];
  switch (def.format) {
    case 'pct':
      return `+${pct(v)} ${def.name}`;
    case 'perSec':
      return `+${round(v)} ${def.name}/s`;
    default:
      return `+${round(v)} ${def.name}`;
  }
}

const RULE_TEXT: Partial<Record<string, (op: 'add' | 'mul', v: number) => string>> = {
  bounces: (op, v) => (op === 'add' ? `+${round(v)} bounce` : `Bounces ×${round(v)}`),
  bounceDamage: (op, v) => (op === 'mul' ? `${signedPct(v)} bounce damage` : `+${pct(v)} bounce damage`),
  bounceRange: (op, v) => (op === 'mul' ? `${signedPct(v)} bounce range` : `+${round(v)} bounce range`),
  lightningTargets: (op, v) => (op === 'add' ? `Lightning +${round(v)} target` : `Lightning targets ×${round(v)}`),
  lightningDamage: (op, v) => (op === 'mul' ? `${signedPct(v)} lightning damage` : `+${pct(v)} lightning damage`),
  lightningRange: (op, v) => (op === 'mul' ? `${signedPct(v)} lightning range` : `+${round(v)} lightning range`),
  freezeSeconds: (op, v) => (op === 'mul' ? `Freezes last ×${round(v)}` : `Freezes +${round(v)}s`),
  slowBonus: (_op, v) => `Slows +${pct(v)}`,
  slowCap: (_op, v) => `Slow cap +${pct(v)}`,
  enemySpeed: (op, v) => (op === 'mul' ? `Viruses ${signedPct(v)} speed` : `Viruses +${pct(v)} speed`),
  enemyHp: (op, v) => (op === 'mul' ? `Enemies ${signedPct(v)} HP` : `Enemies +${pct(v)} HP`),
  thornsRanged: () => 'Thorns also reflect ranged hits',
  runEndBits: (op, v) => (op === 'mul' ? `${signedPct(v)} Bits at run end` : `+${pct(v)} Bits at run end`),
  bossLightning: () => 'Bosses get struck by lightning',
};

/** A structure effect (spec 2026-10-15): only the fields the tier sets, so each ladder step reads as what it adds. */
function structureLine(data: GameData, e: Extract<Effect, { type: 'structure' }>): string {
  const parts: string[] = [];
  if (e.kind === 'wall') {
    // The rules of the wall are spelled out once, on the plain tier-I line; later tiers only say what they add.
    const plain = e.regrowSec === undefined && e.shatterRadius === undefined;
    if (e.hpFrac !== undefined) parts.push(`${data.structures.wall.segments} wall segments, ${pct(e.hpFrac)} Health each${plain ? '; viruses must break through; quiet segments are repaired each wave' : ''}`);
    if (e.regrowSec !== undefined) parts.push(`a broken segment regrows after ${round(e.regrowSec)}s`);
    if (e.shatterRadius !== undefined && e.shatterSec !== undefined) {
      parts.push(`Shatter: a breaking segment freezes viruses within ${round(e.shatterRadius)}px for ${round(e.shatterSec)}s`);
    }
  } else {
    parts.push(`${e.kind} structure`);
  }
  const line = parts.join('; ');
  return line.charAt(0).toUpperCase() + line.slice(1);
}

/** One line describing a single effect (one stack). */
export function effectLine(data: GameData, e: Effect): string {
  switch (e.type) {
    case 'statMul':
      return `${signedPct(e.value)} ${statName(data, e.stat)}`;
    case 'statAdd':
      return statAdd(data, e.stat, e.value);
    case 'onHit':
      if (e.action === 'slow') return `Hits slow ${pct(e.strength)} for ${round(e.seconds)}s`;
      if (e.action === 'freeze') return `${pct(e.chance)} chance to freeze ${round(e.seconds)}s`;
      return `${pct(e.chance)} chance: lightning`;
    case 'onCrit':
      return 'Crits throw lightning';
    case 'onKill': {
      const parts: string[] = [];
      if (e.energy) parts.push(`+${pct(e.energy)} Energy`);
      if (e.energyMul) parts.push(`×${round(e.energyMul)} Energy`);
      if (e.bitsMul) parts.push(`×${round(e.bitsMul)} Bits`);
      if (e.keys) parts.push(`+${round(e.keys)} Key`);
      if (e.kind === 'boss') return `Bosses: ${parts.join(', ')}`;
      return `${parts.join(', ')} per kill`;
    }
    case 'periodic':
      if (e.action === 'overdrive') return `Every ${round(e.everySec)}s: ×${round(e.value)} attack speed for ${round(e.seconds)}s`;
      if (e.action === 'freezeAll') return `Every ${round(e.everySec)}s: freeze all for ${round(e.seconds)}s`;
      if (e.action === 'damageBoost') return `Every ${round(e.everySec)}s: ×${round(e.value)} damage for ${round(e.seconds)}s`;
      if (e.action === 'tesla') return `Every ${round(e.everySec)}s: bolt for ×${round(e.value)} damage`;
      return `Below ${pct(e.hpBelow)} HP: ${round(e.seconds)}s immunity (every ${round(e.everyWaves)} waves)`;
    case 'conditional':
      switch (e.when) {
        case 'targetSlowed':
          return `${signedPct(e.damageMul)} damage to slowed`;
        case 'targetFrozen':
          return `${signedPct(e.damageMul)} damage to frozen`;
        case 'nthShot':
          return `Every ${round(e.every)}th shot ×${round(e.damageMul)}`;
        case 'targetHpBelow':
          return `×${round(e.damageMul)} damage below ${pct(e.frac)} HP`;
        case 'innerRange':
          return `Slow ${pct(e.slow)} in inner ${pct(e.frac)} of range`;
        case 'coreHpBelow':
          return `×${round(e.damageMul)} damage below ${pct(e.frac)} HP`;
      }
      return '';
    case 'shield':
      return `Shield ${pct(e.frac)} HP each wave`;
    case 'waveSkip':
      return `${pct(e.chance)} chance to skip a wave (rewards kept)`;
    case 'capAdd': {
      const def = data.stats.stats[e.stat];
      // Absolute: "Defense cap 78%" reads better than a raise of a number the player never sees.
      return `${def.name} cap ${pct(Math.min((def.cap ?? 0) + e.value, def.capMax ?? def.cap ?? 0))}`;
    }
    case 'killBonus': {
      const who = e.when === 'crit' ? 'Crit kills' : e.when === 'frozen' ? 'Frozen kills' : 'Bounce & lightning kills';
      return `${who}: ×${round(e.energyMul)} Energy`;
    }
    case 'lightningFreeze':
      return `Lightning freezes for ${round(e.seconds)}s`;
    case 'thornsSlow':
      return `Thorns slow attackers ${pct(e.strength)} for ${round(e.seconds)}s`;
    case 'structure':
      return structureLine(data, e);
    case 'retaliate':
      return `Each virus attack: bolt back for ×${round(e.damageMul)} Damage`;
    case 'ruleChange': {
      const f = RULE_TEXT[e.rule];
      return f ? f(e.op, e.value) : `${e.rule} ${e.op === 'mul' ? '×' : '+'}${round(e.value)}`;
    }
  }
}

/** Lines for one stack of a perk (what taking it adds). */
export function perkLines(data: GameData, id: string): string[] {
  return data.perks.perks[id]!.effects.map((e) => effectLine(data, e));
}

/** Lines for `stacks` stacks of a perk, totals folded where the effect stacks linearly or compounds. */
export function totalLines(data: GameData, id: string, stacks: number): string[] {
  const n = Math.max(1, stacks);
  return data.perks.perks[id]!.effects.map((e) => {
    switch (e.type) {
      case 'statMul': {
        let m = 1;
        for (let i = 0; i < n; i++) m *= e.value;
        return effectLine(data, { ...e, value: m });
      }
      case 'statAdd':
      case 'capAdd':
        return effectLine(data, { ...e, value: e.value * n });
      case 'ruleChange':
        if (e.op === 'add') return effectLine(data, { ...e, value: e.value * n });
        return effectLine(data, e);
      case 'onHit':
        if (e.action === 'slow') return effectLine(data, { ...e, strength: e.strength * n });
        if (e.action === 'freeze') return effectLine(data, { ...e, chance: e.chance * n });
        return effectLine(data, { ...e, chance: e.chance * n });
      case 'onKill':
        return effectLine(data, { ...e, energy: e.energy !== undefined ? e.energy * n : undefined, keys: e.keys !== undefined ? e.keys * n : undefined });
      case 'conditional':
        if ('damageMul' in e) return effectLine(data, { ...e, damageMul: 1 + (e.damageMul - 1) * n } as Effect);
        return effectLine(data, { ...e, slow: e.slow * n });
      default:
        return effectLine(data, e);
    }
  });
}

/** Lines for taking one more stack of an owned perk: "now → after" where the total changes. */
export function upgradeLines(data: GameData, id: string, stacks: number): string[] {
  const now = totalLines(data, id, stacks);
  const next = totalLines(data, id, stacks + 1);
  return next.map((l, i) => {
    const a = now[i]!;
    if (l === a) return l;
    // Drop the shared leading words: "Every 10th shot ×3 → ×5".
    let cut = 0;
    for (let k = 0; k < Math.min(a.length, l.length) && a[k] === l[k]; k++) if (a[k] === ' ') cut = k + 1;
    return `${a} → ${l.slice(cut)}`;
  });
}

export interface SetProgress {
  count: number;
  /** Highest tier reached (0 = none). */
  tier: number;
  /** Next tier threshold, 0 when maxed. */
  next: number;
  /** The next tier's bonus (first effect), '' when maxed. */
  nextText: string;
}

export function setProgress(data: GameData, tag: Tag, count: number): SetProgress {
  let tier = 0;
  let next = 0;
  for (const t of data.sets.tiers) {
    if (count >= t) tier = t;
    else if (next === 0) next = t;
  }
  const effs = next > 0 ? data.sets.sets[tag][String(next)] : undefined;
  return { count, tier, next, nextText: effs && effs[0] ? effectLine(data, effs[0]) : '' };
}

export interface SetLadderRow {
  tier: number;
  /** Reached: tiers stack, every reached tier stays on. */
  on: boolean;
  text: string;
}

/** Every tier of a set with its bonus, lit up to the reached tier. */
export function setLadder(data: GameData, tag: Tag, reached: number): SetLadderRow[] {
  return data.sets.tiers.map((t) => ({ tier: t, on: t <= reached, text: setTierLines(data, tag, t).join(' · ') }));
}

/** Lines for one fusion tier (`tier` = its link count, sets.fusionTiers): what that tier adds. */
export function fusionLines(data: GameData, key: string, tier: number): string[] {
  return (data.sets.fusions[key]!.tiers[String(tier)] ?? []).map((e) => effectLine(data, e));
}

/** What a fusion at `tier` does in all: the lines of every tier up to it (tiers add up). */
export function fusionReachedLines(data: GameData, key: string, tier: number): string[] {
  return data.sets.fusionTiers.filter((t) => t <= tier).flatMap((t) => fusionLines(data, key, t));
}

/** Every tier of a fusion with its bonus, lit up to the reached tier. */
export function fusionLadder(data: GameData, key: string, reached: number): SetLadderRow[] {
  return data.sets.fusionTiers.map((t) => ({ tier: t, on: t <= reached, text: fusionLines(data, key, t).join(' · ') }));
}

/** A fusion tier's level as a roman numeral (link counts 1 / 3 / 5 → I / II / III); '' for none. */
export function fusionLevel(data: GameData, tier: number): string {
  const i = data.sets.fusionTiers.indexOf(tier);
  return i < 0 ? '' : (['I', 'II', 'III', 'IV', 'V'][i] ?? String(i + 1));
}

/** The fusion's two tags, in key order. */
export function fusionTags(key: string): [Tag, Tag] {
  const [a, b] = key.split('+') as [Tag, Tag];
  return [a, b];
}

/** Lines for a set tier (all its effects). */
export function setTierLines(data: GameData, tag: Tag, tier: number): string[] {
  return (data.sets.sets[tag][String(tier)] ?? []).map((e) => effectLine(data, e));
}

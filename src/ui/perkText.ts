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
  enemyHp: (op, v) => (op === 'mul' ? `Enemies ${signedPct(v)} HP` : `Enemies +${pct(v)} HP`),
  thornsRanged: () => 'Thorns also reflect ranged hits',
  runEndBits: (op, v) => (op === 'mul' ? `${signedPct(v)} Bits at run end` : `+${pct(v)} Bits at run end`),
  bossLightning: () => 'Bosses get struck by lightning',
};

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
      }
      return '';
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

/** Lines for a set tier (all its effects). */
export function setTierLines(data: GameData, tag: Tag, tier: number): string[] {
  return (data.sets.sets[tag][String(tier)] ?? []).map((e) => effectLine(data, e));
}

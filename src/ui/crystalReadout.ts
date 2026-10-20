// The crystal editor's readout (uniqueness plan item 11): what a hovered placement or move would change, as at
// most three plain sentences ("Overload set 4 → 6: +30% Damage", "Breaks Minefield I"). Phaser-free so the
// wording is unit-tested (tests/crystalReadout.test.ts); CrystalEditor draws the lines.

import type { CrystalDiff } from '../sim/crystal';
import type { GameData } from '../sim/data';
import { nextFusionTier, nextTier } from '../sim/perks';
import { TEXT_DIM } from '../render/palette';
import { fusionLevel, fusionLines, setTierLines } from './perkText';

export const GREEN = '#2bffb0';
export const RED = '#ff3b5c';
const SECTOR_NAMES = ['east', 'north-east', 'north-west', 'west', 'south-west', 'south-east'];

export interface ReadoutLine {
  text: string;
  color: string;
  /** The same sentence without its effect part, for a readout row too narrow for `text`. */
  brief?: string;
}

/**
 * The first effect of a tier as a short phrase for the readout: no brackets, the first clause only
 * ("6 wall segments, 4% Health each"; "1 station inside the wall").
 */
export function effectPhrase(lines: readonly string[]): string {
  let s = (lines[0] ?? '').replace(/\s*\([^)]*\)/g, '');
  s = s.split(';')[0]!.trim();
  if (s.length > 36 && s.includes(':')) s = s.split(':')[0]!.trim();
  return s;
}

/**
 * What a fall costs: "back to 2 turrets" when the lower tier is the same effect with smaller numbers, else
 * "loses <the higher tier's phrase>" ('' when it lists nothing).
 */
function fell(from: readonly string[], to: readonly string[]): string {
  const a = effectPhrase(from);
  const b = effectPhrase(to);
  // Same words (plurals aside: first four letters) with other numbers → the same effect, scaled.
  const shape = (x: string): string =>
    x.split(':')[0]!.replace(/[\d.]+/g, '#').trim().split(/\s+/).map((w) => w.slice(0, 4)).join(' ');
  const sa = shape(a);
  const sb = shape(b);
  if (a && b && (sa.startsWith(sb) || sb.startsWith(sa))) return `back to ${b.split(':')[0]!.trim()}`;
  return a ? `loses ${a}` : '';
}

/** A sentence with an effect phrase after a colon, plus its brief form (no phrase). */
function said(head: string, phrase: string, color: string): ReadoutLine {
  return phrase ? { text: `${head}: ${phrase}`, color, brief: head } : { text: head, color };
}

/**
 * Readout lines for a diff (at most three plain sentences, tier changes first): green when a tier rises, red
 * when it falls, dim for progress. "Opens Overload 2-set: +10% Damage", "Thermal Shock II → III: +50% damage to
 * frozen", "Breaks Minefield I", "Network 2/3 links toward II", "West ground turns Cryo".
 */
export function diffLines(data: GameData, d: CrystalDiff | null): ReadoutLine[] {
  if (!d) return [{ text: 'Not allowed here', color: RED }];
  const out: ReadoutLine[] = [];
  for (const s of d.sets) {
    const name = data.sets.tags[s.tag].name;
    const a = s.tierFrom;
    const b = s.tierTo;
    if (b > a) out.push(said(a === 0 ? `Opens ${name} ${b}-set` : `${name} set ${a} → ${b}`, effectPhrase(setTierLines(data, s.tag, b)), GREEN));
    else if (b < a) out.push(b === 0 ? { text: `Breaks ${name} ${a}-set`, color: RED } : said(`${name} set ${a} → ${b}`, fell(setTierLines(data, s.tag, a), setTierLines(data, s.tag, b)), RED));
    else {
      const next = nextTier(data, s.to);
      out.push({ text: next > 0 ? `${name} ${s.to}/${next} toward the ${next}-set` : `${name} ${s.to}: top set`, color: TEXT_DIM });
    }
  }
  for (const f of d.fusions) {
    const name = data.sets.fusions[f.key]!.name;
    const a = f.tierFrom;
    const b = f.tierTo;
    const lv = (t: number): string => fusionLevel(data, t);
    if (b > a) out.push(said(a === 0 ? `Opens ${name} ${lv(b)}` : `${name} ${lv(a)} → ${lv(b)}`, effectPhrase(fusionLines(data, f.key, b)), GREEN));
    else if (b < a) out.push(b === 0 ? { text: `Breaks ${name} ${lv(a)}`, color: RED } : said(`${name} ${lv(a)} → ${lv(b)}`, fell(fusionLines(data, f.key, a), fusionLines(data, f.key, b)), RED));
    else {
      const next = nextFusionTier(data, f.to, f.key);
      out.push({ text: next > 0 ? `${name} ${f.to}/${next} links toward ${lv(next)}` : `${name} ${f.to} links: top tier`, color: TEXT_DIM });
    }
  }
  for (const s of d.sectors) {
    const sector = SECTOR_NAMES[s.sector]!;
    const head = `${sector[0]!.toUpperCase()}${sector.slice(1)} ground`;
    out.push({ text: s.to === null ? `${head} goes blank` : `${head} turns ${data.sets.tags[s.to].name}`, color: TEXT_DIM });
  }
  if (out.length === 0) return [{ text: 'No change', color: TEXT_DIM }];
  // Tier changes first; at most three lines.
  const ranked = [...out.filter((l) => l.color !== TEXT_DIM), ...out.filter((l) => l.color === TEXT_DIM)];
  if (ranked.length <= 3) return ranked;
  return [ranked[0]!, ranked[1]!, { text: `+${ranked.length - 2} more`, color: TEXT_DIM }];
}

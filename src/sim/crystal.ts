// The crystal (spec 2026-10-14 §A): every protocol is a hex module bolted to the core. A new perk id adds a
// module in a free hex next to the core block or to another module; more stacks of a held perk upgrade its
// module. Sets count the largest connected same-tag cluster (its modules' stacks). The six sectors take
// the tag of their modules and colour the territory (§B). Modules of two tags that touch form fusion links
// (spec 2026-10-15 §1), and modules can move or swap (§2). Everything here is derived from World.crystal.

import type { GameData } from './data';
import { dsqrt } from './num';
import { hexDist, hexToPixel, isNeighbour, ring, sectorOf } from './hex';
import { fusionKey, fusionKeys, TAGS, type Tag } from './perkData';
import type { World } from './state';
import { crystalRing } from './territory';

export interface Module {
  q: number;
  r: number;
  perk: string;
  tag: Tag;
}

/** Every module hex of the crystal up to ring `maxRing` (default: the starting size), in canonical order (ring by ring, then around the ring). */
export function crystalSlots(data: GameData, maxRing = data.crystal.maxRing): [number, number][] {
  const out: [number, number][] = [];
  for (let k = data.crystal.coreRing + 1; k <= maxRing; k++) out.push(...ring(k));
  return out;
}

function occupied(w: World, q: number, r: number): boolean {
  return w.crystal.some((m) => m.q === q && m.r === r);
}

/** Hexes a new module may take now: empty, touching the core block or a module. */
export function freeSlots(w: World, data: GameData): [number, number][] {
  const inner = data.crystal.coreRing + 1;
  return crystalSlots(data, crystalRing(data, w.wave)).filter(
    ([q, r]) => !occupied(w, q, r) && (hexDist(q, r) === inner || w.crystal.some((m) => isNeighbour(q, r, m.q, m.r))),
  );
}

export function moduleSector(data: GameData, q: number, r: number): number {
  const [x, y] = hexToPixel(q, r, data.crystal.cellSize);
  return sectorOf(x, y);
}

/** Perk stacks by id (World.perks, or a preview's copy). */
type Stacks = Readonly<Record<string, number>>;

/** Tag of each sector: the most stacks among its modules (ties → the tag placed first); null when empty. */
function sectorTagsOf(modules: readonly Module[], perks: Stacks, data: GameData): (Tag | null)[] {
  const out: (Tag | null)[] = [];
  for (let s = 0; s < 6; s++) {
    let best: Tag | null = null;
    let bestN = 0;
    const sum = {} as Record<Tag, number>;
    for (const m of modules) {
      if (moduleSector(data, m.q, m.r) !== s) continue;
      sum[m.tag] = (sum[m.tag] ?? 0) + (perks[m.perk] ?? 0);
      // Strictly more wins, so on a tie the tag that reached the count first (placed first) stays.
      if (sum[m.tag]! > bestN) {
        bestN = sum[m.tag]!;
        best = m.tag;
      }
    }
    out.push(best);
  }
  return out;
}

export function sectorTags(w: World, data: GameData): (Tag | null)[] {
  return sectorTagsOf(w.crystal, w.perks, data);
}

/** Deterministic best slot for a new `tag` module (spec §A), or null when the crystal is full. */
export function autoSlot(w: World, data: GameData, tag: Tag): [number, number] | null {
  const a = data.crystal.auto;
  const sectors = sectorTags(w, data);
  let best: [number, number] | null = null;
  let bestScore = -Infinity;
  for (const [q, r] of freeSlots(w, data)) {
    let same = 0;
    let links = 0;
    for (const m of w.crystal) {
      if (!isNeighbour(q, r, m.q, m.r)) continue;
      if (m.tag === tag) same += 1;
      else links += 1;
    }
    const st = sectors[moduleSector(data, q, r)];
    const score = same * a.sameTag + links * a.link + (st === tag ? a.sectorMatch : 0) + (st === null ? a.sectorEmpty : 0) - hexDist(q, r) * a.ring;
    if (score > bestScore) {
      bestScore = score;
      best = [q, r];
    }
  }
  return best;
}

export function isSlot(s: unknown): s is [number, number] {
  return Array.isArray(s) && s.length === 2 && Number.isInteger(s[0]) && Number.isInteger(s[1]);
}

/**
 * Bolts `perk`'s module on (at `slot`, or the auto slot). A perk that already has a module keeps it (a
 * stack upgrades it). Returns false only for an invalid `slot`; a full crystal places nothing.
 */
export function placeModule(w: World, data: GameData, perk: string, slot: unknown): boolean {
  if (w.crystal.some((m) => m.perk === perk)) return true;
  const tag = data.perks.perks[perk]!.tag;
  let at: [number, number] | null;
  if (slot === undefined || slot === null) at = autoSlot(w, data, tag);
  else {
    if (!isSlot(slot) || !freeSlots(w, data).some(([q, r]) => q === slot[0] && r === slot[1])) return false;
    at = [slot[0], slot[1]];
  }
  if (at !== null) w.crystal.push({ q: at[0], r: at[1], perk, tag });
  return true;
}

/** True when picking `perk` adds a new module (it has none yet), i.e. the player gets to place it. */
export function needsPlacement(w: World, perk: string): boolean {
  return !w.crystal.some((m) => m.perk === perk);
}

function clusterOf(modules: readonly Module[], perks: Stacks, i: number): { members: number[]; stacks: number } {
  const tag = modules[i]!.tag;
  const members = [i];
  const seen: boolean[] = modules.map((_, j) => j === i);
  let stacks = 0;
  for (let k = 0; k < members.length; k++) {
    const m = modules[members[k]!]!;
    stacks += perks[m.perk] ?? 0;
    for (let j = 0; j < modules.length; j++) {
      const n = modules[j]!;
      if (!seen[j] && n.tag === tag && isNeighbour(m.q, m.r, n.q, n.r)) {
        seen[j] = true;
        members.push(j);
      }
    }
  }
  return { members, stacks };
}

/** The connected same-tag cluster around module `i`: its module indices and their summed stacks. */
export function moduleCluster(w: World, i: number): { members: number[]; stacks: number } {
  return clusterOf(w.crystal, w.perks, i);
}

function clusterCountsOf(modules: readonly Module[], perks: Stacks): Record<Tag, number> {
  const out = {} as Record<Tag, number>;
  for (const t of TAGS) out[t] = 0;
  const seen: boolean[] = modules.map(() => false);
  for (let i = 0; i < modules.length; i++) {
    if (seen[i]) continue;
    const c = clusterOf(modules, perks, i);
    for (const j of c.members) seen[j] = true;
    const tag = modules[i]!.tag;
    if (c.stacks > out[tag]) out[tag] = c.stacks;
  }
  return out;
}

/** Per tag: the stacks of its largest connected cluster of modules. */
export function clusterCounts(w: World, _data: GameData): Record<Tag, number> {
  return clusterCountsOf(w.crystal, w.perks);
}

/** One fusion link (spec 2026-10-15 §1): a shared edge between modules `a` and `b` of different tags. */
export interface FusionLink {
  a: number;
  b: number;
  key: string;
}

function linksOf(modules: readonly Module[]): FusionLink[] {
  const out: FusionLink[] = [];
  for (let i = 0; i < modules.length; i++) {
    const m = modules[i]!;
    for (let j = i + 1; j < modules.length; j++) {
      const n = modules[j]!;
      if (n.tag !== m.tag && isNeighbour(m.q, m.r, n.q, n.r)) out.push({ a: i, b: j, key: fusionKey(m.tag, n.tag) });
    }
  }
  return out;
}

function linkCountsOf(modules: readonly Module[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const l of linksOf(modules)) out[l.key] = (out[l.key] ?? 0) + 1;
  return out;
}

/** Every link on the crystal, in module index order. */
export function fusionLinks(w: World, _data: GameData): FusionLink[] {
  return linksOf(w.crystal);
}

/** Links per tag pair (pairs without a link are absent). */
export function fusionLinkCounts(w: World, _data: GameData): Record<string, number> {
  return linkCountsOf(w.crystal);
}

/** Highest step of an ascending `ladder` reached with `n` (0 if none): set tiers by stacks, fusion tiers by links. */
export function ladderTier(ladder: readonly number[], n: number): number {
  let tier = 0;
  for (const t of ladder) if (n >= t) tier = t;
  return tier;
}

/** True when every module reaches the core block through touching modules (an empty crystal is). */
export function crystalConnected(modules: readonly Module[], data: GameData): boolean {
  const inner = data.crystal.coreRing + 1;
  const seen: boolean[] = modules.map((m) => hexDist(m.q, m.r) === inner);
  const queue: number[] = [];
  seen.forEach((s, i) => s && queue.push(i));
  for (let k = 0; k < queue.length; k++) {
    const m = modules[queue[k]!]!;
    for (let j = 0; j < modules.length; j++) {
      if (seen[j]) continue;
      const n = modules[j]!;
      if (isNeighbour(m.q, m.r, n.q, n.r)) {
        seen[j] = true;
        queue.push(j);
      }
    }
  }
  return queue.length === modules.length;
}

/** Why a move is refused: no module at `from`; `to` is no crystal hex (or is `from`); the crystal would come apart. */
export type MoveReject = 'empty' | 'slot' | 'link';

/** The crystal after moving the module at `from` to `to` (swapping with the module there), as a copy. */
function movedModules(w: World, data: GameData, from: unknown, to: unknown): Module[] | MoveReject {
  if (!isSlot(from)) return 'empty';
  const i = w.crystal.findIndex((m) => m.q === from[0] && m.r === from[1]);
  if (i < 0) return 'empty';
  if (!isSlot(to)) return 'slot';
  const d = hexDist(to[0], to[1]);
  if (d <= data.crystal.coreRing || d > crystalRing(data, w.wave) || (to[0] === from[0] && to[1] === from[1])) return 'slot';
  const out = w.crystal.map((m) => ({ ...m }));
  const j = out.findIndex((m) => m.q === to[0] && m.r === to[1]);
  out[i]!.q = to[0];
  out[i]!.r = to[1];
  if (j >= 0) {
    // A swap keeps every occupied hex occupied, so the crystal stays connected.
    out[j]!.q = from[0];
    out[j]!.r = from[1];
    return out;
  }
  return crystalConnected(out, data) ? out : 'link';
}

/**
 * Moves the module at `from` to the crystal hex `to` (spec 2026-10-15 §2): an empty `to` takes it, a module
 * there swaps places with it. Every module keeps its index (placement order still breaks ties). The caller
 * refreshes set and fusion tiers (perks.refreshCrystal).
 */
export function moveModule(w: World, data: GameData, from: unknown, to: unknown): MoveReject | null {
  const out = movedModules(w, data, from, to);
  if (typeof out === 'string') return out;
  for (let i = 0; i < out.length; i++) {
    w.crystal[i]!.q = out[i]!.q;
    w.crystal[i]!.r = out[i]!.r;
  }
  return null;
}

/** What a crystal change would do (only what changes): set counts and tiers, links and fusion tiers, sector tags. */
export interface CrystalDiff {
  sets: { tag: Tag; from: number; to: number; tierFrom: number; tierTo: number }[];
  fusions: { key: string; from: number; to: number; tierFrom: number; tierTo: number }[];
  sectors: { sector: number; from: Tag | null; to: Tag | null }[];
}

/** Diff from the crystal now to `modules` with `perks` (set counts include card tags, as tagCounts does). */
export function crystalDiff(w: World, data: GameData, modules: readonly Module[], perks: Stacks = w.perks): CrystalDiff {
  const out: CrystalDiff = { sets: [], fusions: [], sectors: [] };
  const c0 = clusterCountsOf(w.crystal, w.perks);
  const c1 = clusterCountsOf(modules, perks);
  for (const tag of TAGS) {
    const cards = w.cardTags.filter((t) => t === tag).length;
    const from = c0[tag] + cards;
    const to = c1[tag] + cards;
    if (from !== to) out.sets.push({ tag, from, to, tierFrom: ladderTier(data.sets.tiers, from), tierTo: ladderTier(data.sets.tiers, to) });
  }
  const l0 = linkCountsOf(w.crystal);
  const l1 = linkCountsOf(modules);
  for (const key of fusionKeys()) {
    const from = l0[key] ?? 0;
    const to = l1[key] ?? 0;
    if (from !== to) out.fusions.push({ key, from, to, tierFrom: ladderTier(data.sets.fusionTiers, from), tierTo: ladderTier(data.sets.fusionTiers, to) });
  }
  const s0 = sectorTagsOf(w.crystal, w.perks, data);
  const s1 = sectorTagsOf(modules, perks, data);
  for (let s = 0; s < 6; s++) if (s0[s] !== s1[s]) out.sectors.push({ sector: s, from: s0[s] ?? null, to: s1[s] ?? null });
  return out;
}

/**
 * What one more stack of `perk` would do: a new module goes to `slot` (or the auto slot when omitted); a
 * held perk upgrades its module. Null for a slot a new module may not take.
 */
export function slotGains(w: World, data: GameData, perk: string, slot?: [number, number]): CrystalDiff | null {
  const perks = { ...w.perks, [perk]: (w.perks[perk] ?? 0) + 1 };
  if (!needsPlacement(w, perk)) return crystalDiff(w, data, w.crystal, perks);
  const tag = data.perks.perks[perk]!.tag;
  const at = slot ?? autoSlot(w, data, tag);
  if (at === null) return crystalDiff(w, data, w.crystal, perks);
  if (!freeSlots(w, data).some(([q, r]) => q === at[0] && r === at[1])) return null;
  return crystalDiff(w, data, [...w.crystal, { q: at[0], r: at[1], perk, tag }], perks);
}

/** What moving the module at `from` to `to` would do, or null when the move is refused. */
export function movePreview(w: World, data: GameData, from: unknown, to: unknown): CrystalDiff | null {
  const out = movedModules(w, data, from, to);
  return typeof out === 'string' ? null : crystalDiff(w, data, out);
}

/** The crystal's body per sector: how far it reaches, where shots leave from, which tag colours it. */
export interface CrystalShape {
  sectors: (Tag | null)[];
  /** Distance from the center at which melee viruses of this sector stop (before their own radius). */
  reach: number[];
  /** Muzzle per sector: the outermost module's center, or the core (0, 0). */
  tips: [number, number][];
}

export function crystalShape(w: World, data: GameData): CrystalShape {
  const reach = [0, 0, 0, 0, 0, 0].map(() => data.core.radius);
  const tips: [number, number][] = [0, 0, 0, 0, 0, 0].map(() => [0, 0]);
  const tipD = [0, 0, 0, 0, 0, 0];
  const size = data.crystal.cellSize;
  for (const m of w.crystal) {
    const [x, y] = hexToPixel(m.q, m.r, size);
    const s = sectorOf(x, y);
    const d = dsqrt(x * x + y * y);
    if (d + size > reach[s]!) reach[s] = d + size;
    if (d > tipD[s]!) {
      tipD[s] = d;
      tips[s] = [x, y];
    }
  }
  return { sectors: sectorTags(w, data), reach, tips };
}

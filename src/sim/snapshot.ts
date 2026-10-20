import { crystalTagCounts } from './crystal';
import type { GameData } from './data';
import { SECTOR_DIRS } from './hex';
import { assertFiniteDeep } from './num';
import { rebuildCrystal } from './perks';
import { fusionKeys, STRUCTURE_KINDS, TAGS } from './perkData';
import { type World, WORLD_VERSION } from './state';
import { canonicalLevels } from './stats';

/** Bumped with the World shape: v1 (M1–M2a) derived core stats; v2 (M2b) had no protocols (M3). */
export const SNAPSHOT_VERSION = 8; // v8: pulse fields + boot sector (bootOffer, boot); a v7 snapshot migrates

/** Serializes the whole world. Throws if any value is non-finite (JSON would turn it into null). */
export function snapshot(w: World): string {
  assertFiniteDeep(w);
  return JSON.stringify({ v: SNAPSHOT_VERSION, world: w });
}

/** One saved structure: a known kind, a slot in range (a bad one would crash the first tick), a share in [0, 1], plain numbers elsewhere. */
function validStruct(x: unknown): boolean {
  if (x === null || typeof x !== 'object') return false;
  const s = x as Record<string, unknown>;
  const num = (k: string) => typeof s[k] === 'number';
  return (
    ((STRUCTURE_KINDS as readonly unknown[]).includes(s.kind) || s.kind === 'beacon') && // c2: the Territory Beacon
    Number.isInteger(s.id) &&
    Number.isInteger(s.slot) &&
    (s.slot as number) >= 0 &&
    (s.slot as number) < (s.kind === 'mine' ? 12 : SECTOR_DIRS.length) &&
    num('share') &&
    (s.share as number) >= 0 &&
    (s.share as number) <= 1 &&
    num('x') &&
    num('y') &&
    num('cd') &&
    num('streak') &&
    num('powered') &&
    num('downUntilTick')
  );
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return x !== null && typeof x === 'object' && !Array.isArray(x);
}

function isTagRecord(x: unknown): boolean {
  return isRecord(x) && TAGS.every((t) => typeof x[t] === 'number');
}

function tagRecord(v: number): Record<(typeof TAGS)[number], number> {
  const out = {} as Record<(typeof TAGS)[number], number>;
  for (const t of TAGS) out[t] = v;
  return out;
}

/** Parses a snapshot back into a World; every failure is an Error mentioning "snapshot". */
export function restore(s: string, data?: GameData): World {
  let parsed: unknown;
  try {
    parsed = JSON.parse(s);
  } catch (err) {
    throw new Error(`snapshot: invalid JSON (${(err as Error).message})`);
  }
  const o = parsed as { v?: unknown; world?: unknown } | null;
  // v7 snapshot (no pulse / boot sector fields): upgraded below.
  if (o === null || typeof o !== 'object' || (o.v !== SNAPSHOT_VERSION && o.v !== 7)) {
    throw new Error(`snapshot: unsupported version ${String(o?.v)}`);
  }
  const w = o.world as Partial<World> | null | undefined;
  // boot: runs saved before boot sectors (v7) had no boot pick: none open, none taken.
  if (o.v === 7 && w !== null && typeof w === 'object' && (w as { v?: unknown }).v === 7) {
    (w as { v: number }).v = WORLD_VERSION;
    w.bootOffer ??= [];
    w.boot ??= '';
  }
  if (
    w === null ||
    typeof w !== 'object' ||
    ((w.v as number) !== WORLD_VERSION && (w.v as number) !== 7) ||
    typeof w.tick !== 'number' ||
    !Array.isArray(w.enemies) ||
    !Array.isArray(w.projectiles) ||
    typeof w.core !== 'object' ||
    w.core === null ||
    typeof w.lab !== 'object' ||
    w.lab === null ||
    typeof w.revived !== 'boolean' ||
    !Array.isArray(w.cards) ||
    typeof w.shield !== 'number' ||
    !Array.isArray(w.crystal) ||
    !Array.isArray(w.terrain) ||
    !Array.isArray(w.nests) ||
    typeof w.genome !== 'object' ||
    w.genome === null ||
    typeof w.levels !== 'object' ||
    typeof w.workshop !== 'object' ||
    !Array.isArray(w.unlocked) ||
    !Array.isArray(w.mods) ||
    typeof w.perks !== 'object' ||
    w.perks === null ||
    !Array.isArray(w.cardTags) ||
    typeof w.setTiers !== 'object' ||
    w.setTiers === null ||
    !Array.isArray(w.offer) ||
    !Array.isArray(w.bootOffer) || // boot
    typeof w.boot !== 'string' || // boot
    (w.offer.length > 0 && w.bootOffer.length > 0) || // boot
    (w.phase === 'pick') !== (w.offer.length > 0 || w.bootOffer.length > 0) ||
    typeof w.timers !== 'object' ||
    w.timers === null ||
    typeof w.boost !== 'object' ||
    w.boost === null ||
    typeof w.rng !== 'object' ||
    w.rng === null ||
    !Array.isArray(w.rng.spawn) ||
    !Array.isArray(w.rng.combat) ||
    !Array.isArray(w.rng.upgrades)
  ) {
    throw new Error('snapshot: malformed world');
  }
  // Runs saved before fusion tiers (none, or the first fusion pass): none reached yet, and anything the old
  // pass applied is dropped; the next crystal change (pick or move) recomputes them.
  if (w.fusionTiers === undefined) {
    w.fusionTiers = {};
    w.mods = w.mods.filter((m) => !m.source.startsWith('fusion:'));
    for (const k of Object.keys(w.timers)) if (k.startsWith('fusion:')) delete w.timers[k];
  } else if (
    w.fusionTiers === null ||
    typeof w.fusionTiers !== 'object' ||
    Object.values(w.fusionTiers).some((t) => !Number.isInteger(t) || (t as number) < 0)
  ) {
    throw new Error('snapshot: malformed world');
  }
  // Runs saved before structures (spec 2026-10-15): none built, no ring yet. The old firewall fusion ladders put stat
  // mods and timers into the run under `fusion:<key>:<tier>` that the new ladders have no entry to remove; they are
  // dropped with the tiers, and the next crystal change (pick or move) rebuilds the tiers from the new data. The ring
  // and the structures then appear at the next wave start (syncStructures keeps wallR 0 until prepareStructures).
  if (w.structs === undefined) {
    w.structs = [];
    for (const key of fusionKeys().filter((k) => k.endsWith('+firewall'))) {
      const prefix = `fusion:${key}:`;
      w.mods = w.mods.filter((m) => !m.source.startsWith(prefix));
      for (const k of Object.keys(w.timers)) if (k.startsWith(prefix)) delete w.timers[k];
      delete w.fusionTiers[key];
    }
  }
  if (w.wallR === undefined) w.wallR = 0;
  if (!Array.isArray(w.structs) || typeof w.wallR !== 'number' || !w.structs.every(validStruct)) {
    throw new Error('snapshot: malformed world');
  }
  // Runs saved before crystal combos v2 (spec 2026-10-16 phase 1): no weld waiting, empty Lattice and gene
  // accumulators (the gene mean falls back to the counts now), no frost, blueprint or Marks yet. Their tiers
  // were built by the old rules (global links, old ladders): with `data`, they are rebuilt below.
  const preV2 = w.fusionPending === undefined;
  w.fusionPending ??= {};
  w.latticeSum ??= 0;
  w.latticeTicks ??= 0;
  w.geneAcc ??= tagRecord(0);
  w.geneTicks ??= 0;
  w.tagCountsNow ??= crystalTagCounts(w as World);
  w.frost ??= {};
  w.blueprint ??= [];
  w.marks ??= { killed: 0, jackpots: 0, plan: [] };
  // Phase 2: no Mark plan yet (the next wave start draws one); the best tiers start from the tiers now.
  if (isRecord(w.marks)) w.marks.plan ??= [];
  if (w.fusionBest === undefined && isRecord(w.fusionTiers)) w.fusionBest = { ...w.fusionTiers };
  if (
    !isRecord(w.fusionPending) ||
    !Object.values(w.fusionPending).every((p) => isRecord(p) && Number.isInteger(p.tier) && Number.isInteger(p.links) && Number.isInteger(p.sinceTick)) ||
    typeof w.latticeSum !== 'number' ||
    !Number.isInteger(w.latticeTicks) ||
    !Number.isInteger(w.geneTicks) ||
    !isTagRecord(w.geneAcc) ||
    !isTagRecord(w.tagCountsNow) ||
    !isRecord(w.frost) ||
    !Array.isArray(w.blueprint) ||
    !isRecord(w.marks) ||
    typeof w.marks.killed !== 'number' ||
    typeof w.marks.jackpots !== 'number' ||
    !Array.isArray(w.marks.plan) ||
    !w.marks.plan.every((x) => Number.isInteger(x)) ||
    !isRecord(w.fusionBest) ||
    !Object.values(w.fusionBest).every((x) => Number.isInteger(x))
  ) {
    throw new Error('snapshot: malformed world');
  }
  // pulse: runs saved before v8 have no Pulse yet (ready now, none fired, no autoPulse).
  w.pulseReadyTick ??= 0;
  w.pulseCount ??= 0;
  w.pulseLastTag ??= 'none';
  w.pulseAuto ??= false;
  if (
    typeof w.pulseReadyTick !== 'number' ||
    !Number.isInteger(w.pulseCount) ||
    !(w.pulseLastTag === 'none' || (TAGS as readonly unknown[]).includes(w.pulseLastTag)) ||
    typeof w.pulseAuto !== 'boolean'
  ) {
    throw new Error('snapshot: malformed world');
  }
  w.v = WORLD_VERSION;
  // Runs saved before the BUILD tab (spec 2026-10-15 Upgrades): its six stats start at level 0, in canonical key order.
  w.levels = canonicalLevels(w.levels);
  w.workshop = canonicalLevels(w.workshop);
  delete (w as { fusions?: unknown }).fusions;
  try {
    assertFiniteDeep(w);
  } catch (err) {
    throw new Error(`snapshot: ${(err as Error).message}`);
  }
  if (preV2 && data !== undefined) rebuildCrystal(w as World, data);
  return w as World;
}

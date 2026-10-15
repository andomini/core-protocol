// Firewall-fusion structures (spec 2026-10-15): buildings on the battlefield that follow the fusion tiers
// live. Phase 1: the Ice Wall, six segments on a ring around the core (one per 60° sector). Everything is
// derived from the perk profile every tick; the World only stores each entry's HP share and down timer.
// Viruses hit the first thing in their way: a standing segment, else the core.

import type { GameData } from './data';
import type { SimEvent } from './events';
import { SECTOR_DIRS, sectorOf } from './hex';
import { clampValue, dsqrt } from './num';
import type { StructureValues } from './perkData';
import type { PerkProfile } from './perks';
import { gridFor } from './spatial';
import type { Enemy, Struct, World } from './state';
import type { CoreStats } from './stats';
import { crystalRing } from './territory';

export interface StructGeometry {
  /** Wall ring radius for this wave (world px). */
  wallR: number;
  /** Wall segments in play: 0 while the wall is not built (or before the first wave set its ring). */
  segments: number;
}

/** Where the structures are right now. `wall` = the folded wall values (profile, or fusionStructure() for the renderer). */
export function structureGeometry(w: World, data: GameData, wall: StructureValues | undefined): StructGeometry {
  return { wallR: w.wallR, segments: wall !== undefined && w.wallR > 0 ? data.structures.wall.segments : 0 };
}

/**
 * The wall ring for `wave`: grows with the crystal's rings past their base, never beyond Range minus a
 * margin (the core must be able to shoot what stands at the wall).
 */
export function wallRadius(data: GameData, st: CoreStats, wave: number): number {
  const c = data.structures.wall;
  const grown = c.minRadius + c.ringStep * (crystalRing(data, wave) - data.crystal.maxRing);
  return clampValue(Math.max(data.core.radius + 1, Math.min(st.range - c.rangeMargin, grown)));
}

/** Max HP of one wall segment: a share of the core's Health, so every Health purchase upgrades the wall. */
export function wallMaxHp(st: CoreStats, wall: StructureValues): number {
  return clampValue(st.health * (wall.hpFrac ?? 0));
}

/** Fills `out[sector]` with the standing wall segment of that sector (null = none); true when any stands. */
export function activeWalls(w: World, prof: PerkProfile, out: (Struct | null)[]): boolean {
  let any = false;
  for (let i = 0; i < 6; i++) out[i] = null;
  if (prof.structures.wall === undefined || w.wallR <= 0) return false;
  for (const s of w.structs) {
    if (s.kind === 'wall' && s.share > 0 && w.tick >= s.downUntilTick) {
      out[s.slot] = s;
      any = true;
    }
  }
  return any;
}

const have: boolean[] = [false, false, false, false, false, false];
const standing: (Struct | null)[] = [null, null, null, null, null, null];
const contested: boolean[] = [false, false, false, false, false, false];
const nearS: Enemy[] = [];
/** Wall segments that broke this tick with Shatter on; updateStructures resolves them against the fresh grid. */
const shatterX: number[] = [];
const shatterY: number[] = [];

/** Drops last tick's pending Shatters (a tick that ended in the core's death never resolved them). */
export function clearShatter(): void {
  shatterX.length = 0;
  shatterY.length = 0;
}

/**
 * Creates the entries the profile asks for (ids from nextId, so the array stays in id order), keeps the
 * render cache (x, y) in step with `wallR`, and turns a damaged entry whose kind went dormant (link broken)
 * into a destroyed one: unlinking never saves a building. Undamaged entries keep share 1 and come back as they were.
 */
export function syncStructures(w: World, data: GameData, prof: PerkProfile, events: SimEvent[]): void {
  const geo = structureGeometry(w, data, prof.structures.wall);
  for (let i = 0; i < 6; i++) have[i] = false;
  for (const s of w.structs) if (s.kind === 'wall') have[s.slot] = true;
  for (let i = 0; i < geo.segments; i++) {
    if (!have[i]) w.structs.push({ id: w.nextId++, kind: 'wall', slot: i, x: 0, y: 0, share: 1, cd: 0, streak: 0, powered: 0, downUntilTick: 0 });
  }
  for (const s of w.structs) {
    if (s.kind !== 'wall') continue;
    const dir = SECTOR_DIRS[s.slot]!;
    s.x = dir[0] * w.wallR;
    s.y = dir[1] * w.wallR;
    // A segment that went down with the link (no timer then) gets the regrow timer once the wall is back at tier II.
    if (s.share <= 0 && s.downUntilTick <= 0 && prof.structures.wall?.regrowSec !== undefined) {
      s.downUntilTick = w.tick + Math.max(1, Math.round(prof.structures.wall.regrowSec * data.config.tickHz));
    }
    if (s.slot >= geo.segments && s.share > 0 && s.share < 1) {
      s.share = 0;
      s.downUntilTick = 0;
      events.push({ type: 'structDown', sid: s.id, kind: s.kind, x: s.x, y: s.y });
    }
  }
}

/**
 * Wave start (after the shield refill): fixes this wave's ring, repairs the segments no virus is contesting
 * (leftovers of the last wave stand at the wall, so a contested segment keeps its damage), and if the ring
 * grew pushes viruses trapped inside it back out to the wall.
 */
export function prepareStructures(w: World, data: GameData, st: CoreStats, prof: PerkProfile, events: SimEvent[]): void {
  const before = w.wallR;
  w.wallR = wallRadius(data, st, w.wave);
  syncStructures(w, data, prof, events);
  if (prof.structures.wall === undefined) return;
  const reach = w.wallR + data.structures.wall.contestDist;
  for (let i = 0; i < 6; i++) contested[i] = false;
  for (const e of w.enemies) {
    if (e.hp > 0 && dsqrt(e.x * e.x + e.y * e.y) <= reach) contested[sectorOf(e.x, e.y)] = true;
  }
  for (const s of w.structs) {
    if (s.kind !== 'wall' || contested[s.slot] || s.share >= 1 || w.tick < s.downUntilTick) continue;
    const wasDown = s.share <= 0;
    s.share = 1;
    s.downUntilTick = 0;
    if (wasDown) events.push({ type: 'structUp', sid: s.id, kind: s.kind, x: s.x, y: s.y });
  }
  if (w.wallR <= before) return;
  activeWalls(w, prof, standing);
  for (const e of w.enemies) {
    if (e.hp <= 0 || standing[sectorOf(e.x, e.y)] === null) continue;
    const d = dsqrt(e.x * e.x + e.y * e.y);
    const out = w.wallR + e.radius;
    if (d >= out) continue;
    // Radial push; a virus exactly on the core has no direction, so it goes out along its sector's axis.
    const dir = d > 0 ? [e.x / d, e.y / d] : SECTOR_DIRS[0]!;
    e.x = dir[0]! * out;
    e.y = dir[1]! * out;
  }
}

/** A segment's HP ran out: it goes down (regrowing after `regrowSec` from tier II, else at the next uncontested wave start). */
export function breakSegment(w: World, data: GameData, prof: PerkProfile, s: Struct, events: SimEvent[]): void {
  const wall = prof.structures.wall!;
  s.share = 0;
  s.downUntilTick = wall.regrowSec !== undefined ? w.tick + Math.max(1, Math.round(wall.regrowSec * data.config.tickHz)) : 0;
  events.push({ type: 'structDown', sid: s.id, kind: s.kind, x: s.x, y: s.y });
  if (wall.shatterRadius !== undefined) {
    shatterX.push(s.x);
    shatterY.push(s.y);
  }
}

/** After the spatial hash is built: segments regrow, and the Shatters queued by this tick's breaks freeze their neighbours. */
export function updateStructures(w: World, data: GameData, prof: PerkProfile, events: SimEvent[]): void {
  const wall = prof.structures.wall;
  if (wall !== undefined && w.wallR > 0) {
    if (wall.regrowSec !== undefined) {
      for (const s of w.structs) {
        if (s.kind !== 'wall' || s.share > 0 || s.downUntilTick <= 0 || w.tick < s.downUntilTick) continue;
        s.share = 1;
        s.downUntilTick = 0;
        events.push({ type: 'structUp', sid: s.id, kind: s.kind, x: s.x, y: s.y });
      }
    }
    if (wall.shatterRadius !== undefined && wall.shatterSec !== undefined) {
      // Freezes stretch with the freezeSeconds rule like every other freeze (Antifreeze gene shortens them).
      const until = w.tick + Math.max(1, Math.round(wall.shatterSec * prof.rules.freezeSeconds * data.config.tickHz));
      for (let i = 0; i < shatterX.length; i++) {
        gridFor(data).kNearest(shatterX[i]!, shatterY[i]!, wall.shatterRadius, 8, nearS);
        for (const e of nearS) {
          if (e.hp <= 0) continue;
          e.frozenUntil = Math.max(e.frozenUntil, until);
          events.push({ type: 'freeze', enemyId: e.id });
        }
      }
    }
  }
  clearShatter();
}

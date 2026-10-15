// Firewall-fusion structures (spec 2026-10-15): buildings on the battlefield that follow the fusion tiers
// live. The Ice Wall: six segments on a ring around the core (one per 60° sector); viruses hit the first thing
// in their way, a standing segment, else the core. The Bastion: indestructible turrets on the ring. The
// Minefield: mines planted each wave just outside it. Everything is derived from the perk profile every tick;
// the World only stores each entry's HP share, cooldown and down timer.

import { ENEMY_KINDS, type GameData } from './data';
import type { SimEvent } from './events';
import { SECTOR_DIRS, sectorOf } from './hex';
import { clampValue, dsqrt } from './num';
import type { StructureKind, StructureValues } from './perkData';
import type { PerkProfile } from './perks';
import { hitEnemy, lightning } from './projectiles';
import { createStream, nextInt } from './rng';
import { gridFor } from './spatial';
import type { Enemy, Struct, World } from './state';
import type { CoreStats } from './stats';
import { crystalRing } from './territory';

export interface StructGeometry {
  /** Wall ring radius for this wave (world px). */
  wallR: number;
  /** Wall segments in play: 0 while the wall is not built (or before the first wave set its ring). */
  segments: number;
  /** Turrets in play (same condition: they stand on the ring). */
  turrets: number;
}

/** Where the structures are right now. `built` = the folded values per kind (the profile's, or fusionStructure() per kind for the renderer). */
export function structureGeometry(w: World, data: GameData, built: Partial<Record<StructureKind, StructureValues>>): StructGeometry {
  const ring = w.wallR > 0;
  return {
    wallR: w.wallR,
    segments: built.wall !== undefined && ring ? data.structures.wall.segments : 0,
    turrets: built.turret !== undefined && ring ? built.turret.count ?? 0 : 0,
  };
}

/** The sector turret `slot` stands in: a fixed order, so a turret never moves when the Bastion grows (1 → 0; 2 → 0, 2; 3 → 0, 2, 4). */
export const TURRET_SECTORS: readonly number[] = [0, 2, 4, 1, 3, 5];

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
const haveTurret: boolean[] = [false, false, false, false, false, false];
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
  const geo = structureGeometry(w, data, prof.structures);
  for (let i = 0; i < 6; i++) have[i] = haveTurret[i] = false;
  for (const s of w.structs) {
    if (s.kind === 'wall') have[s.slot] = true;
    else if (s.kind === 'turret') haveTurret[s.slot] = true;
  }
  for (let i = 0; i < geo.segments; i++) {
    if (!have[i]) w.structs.push({ id: w.nextId++, kind: 'wall', slot: i, x: 0, y: 0, share: 1, cd: 0, streak: 0, powered: 0, downUntilTick: 0 });
  }
  for (let i = 0; i < geo.turrets; i++) {
    if (!haveTurret[i]) w.structs.push({ id: w.nextId++, kind: 'turret', slot: i, x: 0, y: 0, share: 1, cd: 0, streak: 0, powered: 0, downUntilTick: 0 });
  }
  for (const s of w.structs) {
    if (s.kind === 'turret') {
      // Render cache only (a dormant or surplus turret is not drawn or fired).
      const dir = SECTOR_DIRS[TURRET_SECTORS[s.slot]!]!;
      s.x = dir[0] * w.wallR;
      s.y = dir[1] * w.wallR;
      continue;
    }
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
  plantMines(w, data, prof);
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

/**
 * Wave start: the Minefield plants `perWave` more mines (up to `max` on the field) in the thin band just outside
 * the wall, on its own random stream so the combat and spawn streams never see them. Only a built Minefield plants.
 */
function plantMines(w: World, data: GameData, prof: PerkProfile): void {
  const mine = prof.structures.mine;
  if (mine === undefined) return;
  // Survivors are renumbered so `slot` stays the index among the mines.
  let placed = 0;
  for (const s of w.structs) if (s.kind === 'mine') s.slot = placed++;
  const n = Math.min(mine.perWave ?? 0, (mine.max ?? 0) - placed);
  if (n <= 0) return;
  const rng = createStream(w.seed, `mines:${w.wave}`);
  const [near, far] = data.structures.mine.band;
  for (let i = 0; i < n; i++) {
    const dir = data.directions[nextInt(rng, data.directions.length)]!;
    const r = w.wallR + near + ((far - near) * nextInt(rng, 1024)) / 1023;
    w.structs.push({ id: w.nextId++, kind: 'mine', slot: placed + i, x: dir[0] * r, y: dir[1] * r, share: 1, cd: 0, streak: 0, powered: 0, downUntilTick: 0 });
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

/** True while a wall segment is down (broken, or waiting to regrow): the Bastion's Frenzy reads it. */
function wallBroken(w: World, prof: PerkProfile): boolean {
  if (prof.structures.wall === undefined || w.wallR <= 0) return false;
  for (const s of w.structs) if (s.kind === 'wall' && s.share <= 0) return true;
  return false;
}

/** The largest virus radius of this data set: how far past a mine's trigger a virus's centre can be and still set it off. */
function maxEnemyRadius(data: GameData): number {
  let r = 0;
  for (const k of ENEMY_KINDS) r = Math.max(r, data.enemies[k].radius);
  return r;
}

/**
 * Bastion: each standing turret counts its cooldown down (faster in Frenzy) and, when ready with a virus in
 * range, hits its nearest `targets` for a share of the core's Damage. No projectile, no crit, no random draw.
 */
function fireTurrets(w: World, data: GameData, st: CoreStats, prof: PerkProfile, turret: StructureValues, kills0: number, events: SimEvent[]): void {
  const count = turret.count ?? 0;
  const frenzy = turret.frenzyBelow !== undefined && (w.core.hp < st.health * turret.frenzyBelow || wallBroken(w, prof));
  const rate = (turret.rateMul ?? 1) * (frenzy ? turret.frenzyMul ?? 1 : 1);
  const period = data.config.tickHz * data.structures.turret.shotSec;
  const damage = clampValue(st.damage * (turret.dmgFrac ?? 0));
  const targets = turret.targets ?? 1;
  for (const s of w.structs) {
    if (s.kind !== 'turret' || s.slot >= count) continue;
    if (s.cd > 0) s.cd -= rate;
    if (s.cd > 0) continue;
    // Dead viruses stay in this tick's grid: ask for one more per kill made so far.
    gridFor(data).kNearest(s.x, s.y, turret.range ?? 0, targets + (w.kills - kills0), nearS);
    if (nearS.length === 0) continue;
    const ids: number[] = [];
    const hit: Enemy[] = [];
    for (const e of nearS) {
      if (e.hp <= 0) continue;
      if (hit.length >= targets) break;
      hit.push(e);
      ids.push(e.id);
    }
    if (hit.length === 0) continue;
    s.cd += period;
    events.push({ type: 'turretShot', sid: s.id, targetIds: ids, x: s.x, y: s.y });
    for (const e of hit) hitEnemy(w, data, st, prof, e, damage, false, 'turret', events);
  }
}

/**
 * Minefield: a mine goes off when a virus comes within the trigger distance (plus its radius): the blast hits the
 * nearest `targets` viruses around it, `arcs` of them throw lightning on, and the mine is spent.
 */
function detonateMines(w: World, data: GameData, st: CoreStats, prof: PerkProfile, mine: StructureValues, kills0: number, events: SimEvent[]): void {
  const trigger = data.structures.mine.trigger;
  const reach = trigger + maxEnemyRadius(data);
  const blast = mine.blast ?? 0;
  const targets = mine.targets ?? 1;
  const arcs = mine.arcs ?? 0;
  const damage = clampValue(st.damage * (mine.dmgMul ?? 0));
  const grid = gridFor(data);
  for (let i = 0; i < w.structs.length; ) {
    const s = w.structs[i]!;
    if (s.kind !== 'mine') {
      i += 1;
      continue;
    }
    let tripped = false;
    // Nearest few by centre distance: a big virus can set a mine off from further out than a small one.
    grid.kNearest(s.x, s.y, reach, 4 + (w.kills - kills0), nearS);
    for (const e of nearS) {
      if (e.hp <= 0) continue;
      const dx = e.x - s.x;
      const dy = e.y - s.y;
      const t = trigger + e.radius;
      if (dx * dx + dy * dy <= t * t) {
        tripped = true;
        break;
      }
    }
    if (!tripped) {
      i += 1;
      continue;
    }
    events.push({ type: 'mineBlast', x: s.x, y: s.y, r: blast });
    grid.kNearest(s.x, s.y, blast, targets + (w.kills - kills0), nearS);
    let hits = 0;
    for (const e of nearS) {
      if (e.hp <= 0) continue;
      if (hits >= targets) break;
      hitEnemy(w, data, st, prof, e, damage, false, 'mine', events);
      // The first `arcs` victims throw lightning on (their own neighbours, at the core's Damage like a shot's lightning).
      if (hits < arcs) lightning(w, data, st, prof, e, clampValue(st.damage), events);
      hits += 1;
    }
    w.structs.splice(i, 1);
  }
}

/**
 * After the spatial hash is built: segments regrow, the Shatters queued by this tick's breaks freeze their
 * neighbours, then the Bastion fires and the Minefield goes off.
 */
export function updateStructures(w: World, data: GameData, st: CoreStats, prof: PerkProfile, events: SimEvent[]): void {
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
  const kills0 = w.kills;
  const turret = prof.structures.turret;
  if (turret !== undefined && w.wallR > 0) fireTurrets(w, data, st, prof, turret, kills0, events);
  const mine = prof.structures.mine;
  if (mine !== undefined) detonateMines(w, data, st, prof, mine, kills0, events);
}

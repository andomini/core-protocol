// The territory (spec 2026-10-14 §B): the arena is a hex map of cells that are ours (1) or infected (0).
// Viruses infect the cell under them every `infectEvery` ticks, kills cleanse; an owned cell takes the tag
// of its crystal sector and buffs or debuffs the viruses on it. Geometry is derived from data and cached;
// only the 0/1 cells live in World.terrain.

import type { GameData } from './data';
import { dsqrt } from './num';
import { hexDist, hexToPixel, pixelToHex, sectorOf } from './hex';
import type { Tag } from './perkData';
import type { Enemy, World } from './state';

export interface TerrainGrid {
  /** Cell centers (world px), index = cell id. */
  x: number[];
  y: number[];
  q: number[];
  r: number[];
  sector: number[];
  /** Squared distance of each cell from the core. */
  d2: number[];
  /** Neighbour cell ids (only cells inside the map). */
  nbr: number[][];
  /** Axial → cell id lookup over the bounding box; −1 outside the map. */
  span: number;
  lookup: Int32Array;
}

const grids = new WeakMap<GameData, TerrainGrid>();

export function terrainFor(data: GameData): TerrainGrid {
  let g = grids.get(data);
  if (g !== undefined) return g;
  const size = data.territory.cellSize;
  const R = data.config.arenaMaxRadius + size;
  const span = Math.ceil(R / size) + 2;
  const side = 2 * span + 1;
  const lookup = new Int32Array(side * side).fill(-1);
  const grid: TerrainGrid = { x: [], y: [], q: [], r: [], sector: [], d2: [], nbr: [], span, lookup };
  for (let r = -span; r <= span; r++) {
    for (let q = -span; q <= span; q++) {
      const [x, y] = hexToPixel(q, r, size);
      if (x * x + y * y > R * R) continue;
      lookup[(r + span) * side + (q + span)] = grid.x.length;
      grid.x.push(x);
      grid.y.push(y);
      grid.q.push(q);
      grid.r.push(r);
      grid.sector.push(sectorOf(x, y));
      grid.d2.push(x * x + y * y);
    }
  }
  for (let i = 0; i < grid.x.length; i++) {
    const out: number[] = [];
    for (const [dq, dr] of [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]] as const) {
      const j = cellId(grid, grid.q[i]! + dq, grid.r[i]! + dr);
      if (j >= 0) out.push(j);
    }
    grid.nbr.push(out);
  }
  grids.set(data, grid);
  return grid;
}

export function cellId(g: TerrainGrid, q: number, r: number): number {
  if (q < -g.span || q > g.span || r < -g.span || r > g.span) return -1;
  const side = 2 * g.span + 1;
  return g.lookup[(r + g.span) * side + (q + g.span)]!;
}

/** Cell id under world point (x, y), or −1 outside the map. */
export function cellAt(data: GameData, x: number, y: number): number {
  const g = terrainFor(data);
  const [q, r] = pixelToHex(x, y, data.territory.cellSize);
  return cellId(g, q, r);
}

/** The starting map: cells within startRadius are ours. */
export function initialTerrain(data: GameData): number[] {
  const g = terrainFor(data);
  const r2 = data.territory.startRadius * data.territory.startRadius;
  return g.x.map((x, i) => (x * x + g.y[i]! * g.y[i]! <= r2 ? 1 : 0));
}

/** Sets cell `id` and every cell within `rings` of it to `v`. */
function paint(w: World, g: TerrainGrid, id: number, rings: number, v: number): void {
  if (id < 0) return;
  w.terrain[id] = v;
  if (rings <= 0) return;
  const q0 = g.q[id]!;
  const r0 = g.r[id]!;
  for (let dr = -rings; dr <= rings; dr++) {
    for (let dq = -rings; dq <= rings; dq++) {
      if (hexDist(dq, dr) > rings) continue;
      const j = cellId(g, q0 + dq, r0 + dr);
      if (j >= 0) w.terrain[j] = v;
    }
  }
}

/** Infection pass: every infectEvery ticks each living, non-frozen virus infects its cell (a boss, a ring).
 *  Every regrowEvery ticks the owned ground heals one ring outward (see regrow). */
export function updateTerritory(w: World, data: GameData): void {
  const t = data.territory;
  if (w.tick % t.regrowEvery === 0) regrow(w, data);
  if (w.tick % t.infectEvery !== 0) return;
  const g = terrainFor(data);
  for (const e of w.enemies) {
    if (e.hp <= 0 || w.tick <= e.frozenUntil) continue;
    paint(w, g, cellAt(data, e.x, e.y), e.kind === 'boss' ? t.bossInfectRing : 0, 0);
  }
}

/**
 * Regrowth: an infected cell inside the current arena turns ours again when it touches an owned cell and
 * has no living virus and no nest on it. One ring per pass (decided on the cells before the pass), so
 * ground the viruses no longer reach heals as a moving front instead of staying red for the whole run.
 */
function regrow(w: World, data: GameData): void {
  const g = terrainFor(data);
  const R = arenaRadius(data, w.wave) + data.territory.cellSize;
  const busy = new Uint8Array(w.terrain.length);
  for (const e of w.enemies) {
    if (e.hp <= 0) continue;
    const id = cellAt(data, e.x, e.y);
    if (id >= 0) busy[id] = 1;
  }
  for (const id of w.nests) busy[id] = 1;
  const heal: number[] = [];
  for (let i = 0; i < w.terrain.length; i++) {
    if (w.terrain[i] !== 0 || busy[i] === 1 || g.d2[i]! > R * R) continue;
    if (g.nbr[i]!.some((j) => w.terrain[j] === 1)) heal.push(i);
  }
  for (const i of heal) w.terrain[i] = 1;
}

/** A kill cleanses the cell under the virus and the rings around it. */
export function cleanse(w: World, data: GameData, e: Enemy): void {
  paint(w, terrainFor(data), cellAt(data, e.x, e.y), data.territory.cleanseRing, 1);
}

/** The breach widens (config.arenaGrowEvery): the spawn ring radius at `wave`. */
export function arenaRadius(data: GameData, wave: number): number {
  const c = data.config;
  return Math.min(c.arenaMaxRadius, c.spawnRadius + c.arenaGrowStep * Math.floor(Math.max(0, wave) / c.arenaGrowEvery));
}

/** The crystal grows with the breach: its outer module ring at `wave` (crystal.ringEvery). */
export function crystalRing(data: GameData, wave: number): number {
  const c = data.crystal;
  return Math.min(c.maxRingCap, c.maxRing + Math.floor(Math.max(0, wave) / c.ringEvery));
}

/** Far kills pay more: the Energy/Bits multiplier for a kill at world point (x, y). */
export function farMul(data: GameData, x: number, y: number): number {
  const t = data.territory;
  return 1 + (t.farPer100 * Math.max(0, dsqrt(x * x + y * y) - t.farFrom)) / 100;
}

/** Virus speed multiplier at `wave`: the wider ring is crossed in about the same time. */
export function arenaSpeed(data: GameData, wave: number): number {
  const c = data.config;
  return 1 + c.arenaSpeedScale * (arenaRadius(data, wave) / c.spawnRadius - 1);
}

/** Owned share of the cells inside the current arena (cells beyond the spawn ring don't count yet). */
export function ownedShare(w: World, data: GameData): number {
  if (w.terrain.length === 0) return 0;
  const g = terrainFor(data);
  const R = arenaRadius(data, w.wave) + data.territory.cellSize;
  const R2 = R * R;
  let n = 0;
  let all = 0;
  for (let i = 0; i < w.terrain.length; i++) {
    if (g.d2[i]! > R2) continue;
    all += 1;
    n += w.terrain[i]!;
  }
  return all === 0 ? 0 : n / all;
}

/** What is under a virus: 'out' (off the map), 'infected', 'own' (no sector tag) or the sector's tag. */
export type Ground = 'out' | 'infected' | 'own' | Tag;

export function groundAt(w: World, data: GameData, sectors: readonly (Tag | null)[], x: number, y: number): Ground {
  const id = cellAt(data, x, y);
  if (id < 0) return 'out';
  if (w.terrain[id] !== 1) return 'infected';
  return sectors[terrainFor(data).sector[id]!] ?? 'own';
}

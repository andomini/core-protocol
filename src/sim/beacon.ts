// c2: the Territory Beacon (uniqueness plan item 9). The player's one act on the map: `Command { type: 'beacon' }`
// plants a beacon at the infection front of the most infected sector (no tap needed; the choice is a pure function
// of the World). While it stands, infection cannot enter its disc (territory.ts `guarded`) and it cleanses one more
// ring every `cleanseEvery` ticks; viruses that pass close turn on it and phages hunt it (enemies.ts). Standing
// through `holdWaves` wave ends pays Bits and claims the disc for the rest of the run.
//
// It is a `Struct` of kind 'beacon' reusing the plain fields (no new Struct fields, no snapshot bump):
// slot = index among standing beacons, x/y = its cell's centre (true state; syncStructures leaves it alone),
// share = HP share, cd = ticks to the next cleanse, streak = wave ends held, powered = rings cleansed so far.

import type { GameData } from './data';
import { scaleForWave } from './economy';
import type { SimEvent } from './events';
import { hexDist } from './hex';
import { clampValue, powInt } from './num';
import { type Struct, type World, worldStats } from './state';
import type { CoreStats } from './stats';
import { arenaRadius, cellAt, guarded, ownCells, terrainFor } from './territory';

export type BeaconReject = 'dead' | 'phase' | 'max' | 'funds' | 'front';

/** Energy for the next beacon: cost × costGrowth^(built this run) × energyGrowth^(wave − 1). */
export function beaconCost(w: World, data: GameData): number {
  const b = data.territory.beacon;
  return clampValue(b.cost * powInt(b.costGrowth, w.beacons ?? 0) * powInt(data.config.energyGrowth, Math.max(0, w.wave - 1)));
}

/** Max HP of a beacon: the core's max HP × hp × Structure Health. */
export function beaconMaxHp(data: GameData, st: CoreStats): number {
  return clampValue(st.health * data.territory.beacon.hp * st.structHealth);
}

/** Fills `out` with the standing beacons (id order); returns how many. */
export function activeBeacons(w: World, out: Struct[]): number {
  out.length = 0;
  for (const s of w.structs) if (s.kind === 'beacon' && s.share > 0) out.push(s);
  return out.length;
}

export function beaconCount(w: World): number {
  let n = 0;
  for (const s of w.structs) if (s.kind === 'beacon' && s.share > 0) n += 1;
  return n;
}

/**
 * The cell the next beacon would stand on, or −1 when the arena holds no infected ground. The sector with the
 * most infected cells inside the arena (ties: the lower sector), then in that sector, within the placement band
 * (minDist … min(arena, rangeShare × Range)) and outside any standing beacon's disc: the infected cell nearest the
 * core (the front), else the farthest band cell (ties: the lower cell id).
 */
export function beaconSite(w: World, data: GameData, range: number): number {
  const g = terrainFor(data);
  const b = data.territory.beacon;
  const R = arenaRadius(data, w.wave);
  const R2 = R * R;
  const counts = [0, 0, 0, 0, 0, 0];
  let total = 0;
  for (let i = 0; i < w.terrain.length; i++) {
    if (w.terrain[i] !== 0 || g.d2[i]! > R2) continue;
    counts[g.sector[i]!]! += 1;
    total += 1;
  }
  if (total === 0) return -1;
  let sec = 0;
  for (let k = 1; k < 6; k++) if (counts[k]! > counts[sec]!) sec = k;
  const hi = Math.min(R, range * b.rangeShare);
  const lo = Math.min(b.minDist, hi);
  let best = -1;
  let bestD2 = 0;
  let far = -1;
  let farD2 = -1;
  for (let i = 0; i < w.terrain.length; i++) {
    const d2 = g.d2[i]!;
    if (g.sector[i] !== sec || d2 < lo * lo || d2 > hi * hi || guarded(w, data, i)) continue;
    if (w.terrain[i] === 0 && (best < 0 || d2 < bestD2)) {
      best = i;
      bestD2 = d2;
    }
    if (d2 > farD2) {
      far = i;
      farD2 = d2;
    }
  }
  return best >= 0 ? best : far;
}

/** Command 'beacon': plants one at beaconSite for beaconCost Energy. */
export function placeBeacon(w: World, data: GameData, events: SimEvent[]): BeaconReject | null {
  const b = data.territory.beacon;
  if (w.dead) return 'dead';
  if (w.phase === 'pick') return 'phase';
  if (beaconCount(w) >= b.max) return 'max';
  const cost = beaconCost(w, data);
  if (w.energy < cost) return 'funds';
  const id = beaconSite(w, data, worldStats(w, data).range);
  if (id < 0) return 'front';
  const g = terrainFor(data);
  w.energy = clampValue(Math.max(0, w.energy - cost));
  w.beacons = (w.beacons ?? 0) + 1;
  let slot = 0;
  while (w.structs.some((s) => s.kind === 'beacon' && s.slot === slot)) slot += 1;
  const s: Struct = { id: w.nextId++, kind: 'beacon', slot, x: g.x[id]!, y: g.y[id]!, share: 1, cd: b.cleanseEvery, streak: 0, powered: 0, downUntilTick: 0 };
  w.structs.push(s);
  ownCells(w, data, id, 0);
  events.push({ type: 'beaconPlaced', sid: s.id, x: s.x, y: s.y, cost });
  return null;
}

/** A virus brought it down: it is gone (no rubble), the held waves are lost. */
export function destroyBeacon(w: World, s: Struct, events: SimEvent[]): void {
  s.share = 0;
  const i = w.structs.indexOf(s);
  if (i >= 0) w.structs.splice(i, 1);
  events.push({ type: 'beaconLost', sid: s.id, x: s.x, y: s.y, held: s.streak });
}

/** Adds the cells within `rings` of `id` to the run's claimed set (sorted, unique). */
function claim(w: World, data: GameData, id: number, rings: number): number {
  const g = terrainFor(data);
  const set = new Set(w.claimed ?? []);
  const before = set.size;
  for (let i = 0; i < g.x.length; i++) if (hexDist(g.q[i]! - g.q[id]!, g.r[i]! - g.r[id]!) <= rings) set.add(i);
  w.claimed = [...set].sort((a, b) => a - b);
  return w.claimed.length - before;
}

/**
 * Per tick (after the death check): each standing beacon cleanses one more ring every cleanseEvery ticks; at a
 * wave end (the tick advanceWave left the wave) it counts one held wave, and at holdWaves it pays holdReward Bits
 * (× tier bitsMul × bitsGrowth^(wave − 1)), claims its disc and retires, so the next one can push further out.
 */
export function updateBeacons(w: World, data: GameData, events: SimEvent[]): void {
  if (w.structs.length === 0) return;
  const b = data.territory.beacon;
  const waveEnd = w.phase !== 'wave' && w.phaseTick === 0 && w.wave > 0;
  for (let i = 0; i < w.structs.length; ) {
    const s = w.structs[i]!;
    if (s.kind !== 'beacon') {
      i += 1;
      continue;
    }
    const id = cellAt(data, s.x, s.y);
    s.cd -= 1;
    if (s.cd <= 0) {
      s.cd = b.cleanseEvery;
      s.powered = Math.min(b.radius, s.powered + 1);
      ownCells(w, data, id, s.powered);
      events.push({ type: 'beaconCleanse', sid: s.id, x: s.x, y: s.y, ring: s.powered });
    }
    if (waveEnd) {
      s.streak += 1;
      w.beaconWaves = (w.beaconWaves ?? 0) + 1;
      if (s.streak >= b.holdWaves) {
        const bits = scaleForWave(b.holdReward, data.tiers[w.tier - 1]!.bitsMul, data.config.bitsGrowth, Math.max(1, w.wave));
        w.bits = clampValue(w.bits + bits);
        ownCells(w, data, id, b.radius);
        const cells = id >= 0 ? claim(w, data, id, b.radius) : 0;
        w.beaconClaims = (w.beaconClaims ?? 0) + 1;
        w.structs.splice(i, 1);
        events.push({ type: 'beaconClaimed', sid: s.id, x: s.x, y: s.y, bits, cells });
        continue;
      }
      events.push({ type: 'beaconHold', sid: s.id, held: s.streak, need: b.holdWaves });
    }
    i += 1;
  }
}

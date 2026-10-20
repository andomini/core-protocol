// c2: the Territory Beacon (uniqueness plan item 9): placement, cost, the guarded disc, the hold goal, destruction,
// snapshot round-trip and the data block's validation.
import { describe, expect, it } from 'vitest';
import { beaconCost, beaconMaxHp, beaconSite } from '../src/sim/beacon';
import { applyCommands } from '../src/sim/commands';
import { type GameData, validateBeacon } from '../src/sim/data';
import { scaleForWave } from '../src/sim/economy';
import type { SimEvent } from '../src/sim/events';
import { hashWorld } from '../src/sim/hash';
import { hexDist } from '../src/sim/hex';
import { restore, snapshot } from '../src/sim/snapshot';
import { createWorld, type Enemy, type Struct, type World, worldStats } from '../src/sim/state';
import { step } from '../src/sim/step';
import { arenaRadius, cellAt, guarded, terrainFor } from '../src/sim/territory';
import { spawnEnemy } from '../src/sim/waves';
import { ofType, stepN, testData } from './helpers';
import { missionDef, missionRun } from '../src/meta/missions';

const quiet = () => testData({ config: { baseEnemiesPerWave: 0, enemiesPerWaveGrowth: 0 } });

function world(d: GameData, seed = 5): World {
  const w = createWorld(d, { seed, tier: 1, protocols: false });
  w.energy = 1e6;
  return w;
}

/** Leaves infected ground (inside the arena) only in sector `sec`. */
function infectOnly(w: World, d: GameData, sec: number): void {
  const g = terrainFor(d);
  const R = arenaRadius(d, w.wave);
  for (let i = 0; i < w.terrain.length; i++) {
    if (g.d2[i]! <= R * R && g.sector[i] !== sec) w.terrain[i] = 1;
  }
}

function place(w: World, d: GameData): SimEvent[] {
  const ev: SimEvent[] = [];
  applyCommands(w, d, [{ type: 'beacon' }], ev);
  return ev;
}

const beaconOf = (w: World): Struct | undefined => w.structs.find((s) => s.kind === 'beacon');

/** A virus that neither moves nor attacks unless asked. */
function virus(w: World, d: GameData, x: number, y: number, speed = 0): Enemy {
  const e = spawnEnemy(w, d, 'basic', x, y, []);
  e.hp = e.maxHp = 1e9;
  e.speed = speed;
  return e;
}

describe('beacon: placement', () => {
  it('plants at the infection front of the most infected sector, the same way every time', () => {
    const d = quiet();
    const a = world(d);
    const b = world(d);
    infectOnly(a, d, 2);
    infectOnly(b, d, 2);
    const ev = place(a, d);
    place(b, d);
    const s = beaconOf(a)!;
    expect(ofType(ev, 'beaconPlaced')).toHaveLength(1);
    expect(s).toEqual(beaconOf(b));
    const g = terrainFor(d);
    const id = cellAt(d, s.x, s.y);
    expect(g.sector[id]).toBe(2);
    // The front: the infected cell of that sector nearest the core inside the band.
    const hi = Math.min(arenaRadius(d, a.wave), worldStats(a, d).range * d.territory.beacon.rangeShare);
    const fresh = world(d);
    infectOnly(fresh, d, 2);
    const nearer = fresh.terrain.some((v, i) => v === 0 && g.sector[i] === 2 && g.d2[i]! < g.d2[id]! && g.d2[i]! >= d.territory.beacon.minDist ** 2 && g.d2[i]! <= hi * hi);
    expect(nearer).toBe(false);
    expect(fresh.terrain[id]).toBe(0);
    expect(beaconSite(fresh, d, worldStats(fresh, d).range)).toBe(id);
  });

  it('is refused without Energy, with one standing (max) and without infected ground', () => {
    const d = quiet();
    const w = world(d);
    w.energy = 0;
    expect(ofType(place(w, d), 'commandRejected')).toEqual([{ type: 'commandRejected', cmd: 'beacon', reason: 'funds' }]);
    w.energy = 1e6;
    expect(ofType(place(w, d), 'beaconPlaced')).toHaveLength(1);
    expect(ofType(place(w, d), 'commandRejected')[0]!.reason).toBe('max');
    const clean = world(d);
    clean.terrain.fill(1);
    expect(ofType(place(clean, d), 'commandRejected')[0]!.reason).toBe('front');
    expect(clean.energy).toBe(1e6);
  });

  it('costs Energy, and each beacon built this run costs costGrowth × more', () => {
    const d = quiet();
    const w = world(d);
    const b = d.territory.beacon;
    const c0 = beaconCost(w, d);
    expect(c0).toBeCloseTo(b.cost, 9);
    place(w, d);
    expect(w.energy).toBeCloseTo(1e6 - c0, 6);
    expect(w.beacons).toBe(1);
    expect(beaconCost(w, d)).toBeCloseTo(c0 * b.costGrowth, 9);
    w.wave = 5;
    expect(beaconCost(w, d)).toBeCloseTo(b.cost * b.costGrowth * d.config.energyGrowth ** 4, 9);
  });
});

describe('beacon: the guarded disc', () => {
  it('cleanses ring by ring, and infection cannot enter its radius (but does outside)', () => {
    const d = quiet();
    const w = world(d);
    infectOnly(w, d, 2);
    place(w, d);
    const s = beaconOf(w)!;
    const b = d.territory.beacon;
    const g = terrainFor(d);
    const c = cellAt(d, s.x, s.y);
    const ring = (i: number) => hexDist(g.q[i]! - g.q[c]!, g.r[i]! - g.r[c]!);
    const ev = stepN(w, d, b.cleanseEvery * b.radius);
    expect(ofType(ev, 'beaconCleanse').map((e) => e.ring)).toEqual(Array.from({ length: b.radius }, (_, k) => k + 1));
    const disc = w.terrain.map((_, i) => i).filter((i) => ring(i) <= b.radius);
    expect(disc.every((i) => w.terrain[i] === 1)).toBe(true);
    // A virus on the disc's edge cannot infect it; one just outside does.
    const inside = disc.find((i) => ring(i) === b.radius)!;
    const outside = w.terrain.map((_, i) => i).find((i) => ring(i) === b.radius + 2 && w.terrain[i] === 1)!;
    expect(guarded(w, d, inside)).toBe(true);
    expect(guarded(w, d, outside)).toBe(false);
    virus(w, d, g.x[inside]!, g.y[inside]!);
    virus(w, d, g.x[outside]!, g.y[outside]!);
    stepN(w, d, d.territory.infectEvery);
    expect(w.terrain[inside]).toBe(1);
    expect(w.terrain[outside]).toBe(0);
  });

  it('draws a virus passing within aggro, which hits it instead of the core', () => {
    const d = quiet();
    const w = world(d);
    infectOnly(w, d, 2);
    place(w, d);
    const s = beaconOf(w)!;
    const e = virus(w, d, s.x * 1.15, s.y * 1.15, 45);
    const ev = stepN(w, d, 30 * 6);
    expect(ofType(ev, 'coreHit')).toHaveLength(0);
    const hits = ofType(ev, 'structHit').filter((h) => h.kind === 'beacon');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.enemyId).toBe(e.id);
    expect(s.share).toBeLessThan(1);
  });
});

describe('beacon: hold goal and loss', () => {
  it('pays holdReward × tier bitsMul once after holdWaves wave ends, claims its disc and retires', () => {
    const d = quiet();
    const w = world(d);
    infectOnly(w, d, 2);
    place(w, d);
    const s = beaconOf(w)!;
    const c = cellAt(d, s.x, s.y);
    const b = d.territory.beacon;
    const cycle = (d.config.waveSeconds + d.config.pauseSeconds) * d.config.tickHz + 2;
    const ev: SimEvent[] = [];
    let bitsAt = 0;
    for (let t = 0; t < cycle * (b.holdWaves + 2); t++) {
      const before = w.bits;
      const evs: SimEvent[] = [];
      step(w, d, [], evs);
      if (evs.some((e) => e.type === 'beaconClaimed')) bitsAt = w.bits - before - ofType(evs, 'waveReward').reduce((a, e) => a + e.bits, 0);
      ev.push(...evs);
    }
    expect(ofType(ev, 'beaconHold').map((e) => e.held)).toEqual(Array.from({ length: b.holdWaves - 1 }, (_, k) => k + 1));
    const claims = ofType(ev, 'beaconClaimed');
    expect(claims).toHaveLength(1);
    const wave = ofType(ev, 'waveEnd')[b.holdWaves - 1]!.wave;
    const want = scaleForWave(b.holdReward, d.tiers[0]!.bitsMul, d.config.bitsGrowth, wave);
    expect(claims[0]!.bits).toBeCloseTo(want, 9);
    expect(bitsAt).toBeCloseTo(want, 6);
    expect(beaconOf(w)).toBeUndefined();
    expect(w.beaconClaims).toBe(1);
    expect(w.beaconWaves).toBe(b.holdWaves);
    expect(w.claimed).toContain(c);
    expect(claims[0]!.cells).toBe(w.claimed!.length);
    // Claimed ground stays ours for the run.
    const g = terrainFor(d);
    virus(w, d, g.x[c]!, g.y[c]!);
    stepN(w, d, d.territory.infectEvery * 2);
    expect(w.terrain[c]).toBe(1);
    expect(guarded(w, d, c)).toBe(true);
  });

  it('a beacon brought to 0 HP is gone, and its disc can be infected again', () => {
    const d = quiet();
    const w = world(d);
    infectOnly(w, d, 2);
    place(w, d);
    const s = beaconOf(w)!;
    const c = cellAt(d, s.x, s.y);
    const e = virus(w, d, s.x, s.y);
    e.damage = beaconMaxHp(d, worldStats(w, d)) * 2;
    const ev = stepN(w, d, 60);
    expect(ofType(ev, 'beaconLost')).toEqual([{ type: 'beaconLost', sid: s.id, x: s.x, y: s.y, held: 0 }]);
    expect(beaconOf(w)).toBeUndefined();
    expect(guarded(w, d, c)).toBe(false);
    stepN(w, d, d.territory.infectEvery);
    expect(w.terrain[c]).toBe(0);
    // A new one may be placed (the cost kept growing).
    expect(ofType(place(w, d), 'beaconPlaced')).toHaveLength(1);
    expect(w.beacons).toBe(2);
  });
});

describe('beacon: snapshot and data', () => {
  it('round-trips through a snapshot and runs on identically', () => {
    const d = quiet();
    const w = world(d);
    infectOnly(w, d, 2);
    place(w, d);
    stepN(w, d, 200);
    w.claimed = [3, 7, 11];
    const r = restore(snapshot(w), d);
    expect(JSON.stringify(r)).toBe(JSON.stringify(w));
    stepN(w, d, 300);
    stepN(r, d, 300);
    expect(hashWorld(r)).toBe(hashWorld(w));
  });

  it('a world without beacons keeps no beacon fields', () => {
    const d = quiet();
    const w = world(d);
    stepN(w, d, 120);
    expect('beacons' in w || 'claimed' in w || 'beaconWaves' in w || 'beaconClaims' in w).toBe(false);
  });

  it('validates the beacon block', () => {
    const ok = quiet().territory.beacon;
    expect(() => validateBeacon(ok)).not.toThrow();
    expect(() => validateBeacon(undefined)).toThrow();
    for (const bad of [{ max: 7 }, { max: 0 }, { hp: 0 }, { radius: 1.5 }, { cleanseEvery: 0 }, { holdWaves: 0 }, { costGrowth: 0.9 }, { rangeShare: 0 }, { cost: -1 }]) {
      expect(() => validateBeacon({ ...ok, ...bad })).toThrow();
    }
    expect(() => testData({ territory: { beacon: { max: 9 } } })).toThrow(/beacon\.max/);
  });
});

describe('beacon: mission', () => {
  it('"hold beacons N waves" counts the run\'s held wave ends', () => {
    const d = quiet();
    const w = world(d);
    expect(missionRun(w, d, { levelsBought: 0, nests: 0 }).beacons).toBe(0);
    w.beaconWaves = 4;
    expect(missionRun(w, d, { levelsBought: 0, nests: 0 }).beacons).toBe(4);
    const t = missionDef('beacon')!;
    expect(t.kind).toBe('beacon');
    expect(t.text).toContain('{n}');
  });
});

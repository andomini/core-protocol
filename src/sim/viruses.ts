// Kind mechanics of the uniqueness-plan viruses (item 7; notes in docs/superpowers/plans/2026-10-20-uniqueness-notes-b2.md):
// Leech steals Bits per core hit and pays them back ×returnMul on death, Spore splits into smaller copies, Carrier
// shields the viruses around it. (Phage's structure hunt lives in enemies.ts, next to the wall/station logic.)
// Every mechanic is keyed by its data fields (`steal`, `splitCount`, `auraReduce`), not by the kind's name.
import type { GameData } from './data';
import { scaleForWave } from './economy';
import type { SimEvent } from './events';
import { clampValue } from './num';
import type { Enemy, World } from './state';

/** Leech: one landed core hit takes `steal` (wave-scaled) Bits from the run, never below 0, and carries them. */
export function stealBits(w: World, data: GameData, e: Enemy, events: SimEvent[]): void {
  const steal = data.enemies[e.kind].steal ?? 0;
  if (!(steal > 0) || !(w.bits > 0)) return;
  const want = scaleForWave(steal, data.tiers[w.tier - 1]!.bitsMul, data.config.bitsGrowth, Math.max(1, w.wave));
  const bits = Math.min(w.bits, want);
  w.bits = clampValue(w.bits - bits);
  e.carried = clampValue((e.carried ?? 0) + bits);
  events.push({ type: 'steal', enemyId: e.id, bits, carried: e.carried });
}

/** Leech: the Bits a kill pays back on top of its own reward (0 when it carries none). */
export function carriedReturn(data: GameData, e: Enemy): number {
  const c = e.carried ?? 0;
  return c > 0 ? clampValue(c * (data.enemies[e.kind].returnMul ?? 1)) : 0;
}

/**
 * Spore: a dead spore of generation < splitGens bursts into `splitCount` copies around its centre (fixed directions from
 * data.directions by id: no RNG draw), each with `splitShare` of its max HP, damage and rewards and `splitRadius` of its
 * size. The copies are the same kind with `gen` + 1; they never carry a Mark.
 */
export function splitSpore(w: World, data: GameData, e: Enemy, events: SimEvent[]): void {
  const def = data.enemies[e.kind];
  const n = def.splitCount ?? 0;
  const gen = e.gen ?? 0;
  if (n <= 0 || gen >= (def.splitGens ?? 0)) return;
  const share = def.splitShare!;
  const dirs = data.directions;
  const stride = Math.max(1, Math.floor(dirs.length / n));
  const off = e.radius * 0.7;
  const ids: number[] = [];
  const hp = clampValue(e.maxHp * share);
  for (let i = 0; i < n; i++) {
    const [dx, dy] = dirs[(e.id * 7 + i * stride) % dirs.length]!;
    const c: Enemy = {
      id: w.nextId++,
      kind: e.kind,
      x: e.x + dx * off,
      y: e.y + dy * off,
      hp,
      maxHp: hp,
      damage: clampValue(e.damage * share),
      speed: e.speed,
      radius: e.radius * def.splitRadius!,
      standoff: e.standoff,
      attackIntervalTicks: e.attackIntervalTicks,
      attackCd: 0,
      energy: clampValue(e.energy * share),
      bits: clampValue(e.bits * share),
      slow: 0,
      slowUntil: 0,
      frozenUntil: 0,
      kbUntil: 0,
      gen: gen + 1,
    };
    w.enemies.push(c);
    ids.push(c.id);
    events.push({ type: 'spawn', id: c.id, kind: c.kind, x: c.x, y: c.y });
  }
  events.push({ type: 'split', enemyId: e.id, kind: e.kind, x: e.x, y: e.y, ids });
}

// Carrier aura: the living carriers of this tick, rebuilt when the world, tick, id counter or enemy list changes.
const carriers: Enemy[] = [];
let cacheWorld: World | null = null;
let cacheTick = -1;
let cacheId = -1;
let cacheList: Enemy[] | null = null;
let cacheLen = -1;

function carriersOf(w: World, data: GameData): Enemy[] {
  if (cacheWorld === w && cacheTick === w.tick && cacheId === w.nextId && cacheList === w.enemies && cacheLen === w.enemies.length) return carriers;
  carriers.length = 0;
  for (const c of w.enemies) if (auraReduceOf(data, c) > 0) carriers.push(c);
  cacheWorld = w;
  cacheTick = w.tick;
  cacheId = w.nextId;
  cacheList = w.enemies;
  cacheLen = w.enemies.length;
  return carriers;
}

/** True when the data has any aura kind that can spawn (a cheap skip for every hit otherwise). */
let auraData: GameData | null = null;
let auraAny = false;
function auraKinds(data: GameData): boolean {
  if (auraData !== data) {
    auraData = data;
    auraAny = (data.enemies.carrier.auraReduce ?? 0) > 0 || Object.values(data.bosses.bosses).some((b) => (b.auraReduce ?? 0) > 0);
  }
  return auraAny;
}

/** c1: the aura a virus holds — its kind's (Carrier) or its tier boss's (Swarm Lord); 0 = none. */
function auraReduceOf(data: GameData, e: Enemy): number {
  if (e.boss !== undefined) return data.bosses.bosses[e.boss]?.auraReduce ?? 0;
  return data.enemies[e.kind].auraReduce ?? 0;
}

function auraRadiusOf(data: GameData, e: Enemy): number {
  if (e.boss !== undefined) return data.bosses.bosses[e.boss]?.auraRadius ?? 0;
  return data.enemies[e.kind].auraRadius ?? 0;
}

/**
 * Carrier: the damage multiplier for a hit on `e` — 1 − auraReduce when a living carrier (not `e`, and `e` not itself a
 * carrier) stands within its auraRadius, else 1. Auras do not stack.
 */
export function auraMul(w: World, data: GameData, e: Enemy): number {
  if (!auraKinds(data)) return 1;
  if (auraReduceOf(data, e) > 0) return 1;
  const list = carriersOf(w, data);
  let best = 0;
  for (const c of list) {
    if (c.hp <= 0) continue;
    const r = auraRadiusOf(data, c);
    const dx = c.x - e.x;
    const dy = c.y - e.y;
    if (dx * dx + dy * dy <= r * r) best = Math.max(best, auraReduceOf(data, c));
  }
  return 1 - best;
}

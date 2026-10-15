import type { Command } from '../src/sim/commands';
import mechanicsFixture from './fixtures/mechanics-m3.json';
import { DEFAULT_DATA, validateData, type GameData, type StatId } from '../src/sim/data';
import type { SimEvent } from '../src/sim/events';
import type { World } from '../src/sim/state';
import { step } from '../src/sim/step';

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends readonly unknown[] ? T[K] : T[K] extends object ? DeepPartial<T[K]> : T[K];
};

function merge(target: Record<string, unknown>, patch: Record<string, unknown>): void {
  for (const [k, v] of Object.entries(patch)) {
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      merge(target[k] as Record<string, unknown>, v as Record<string, unknown>);
    } else {
      target[k] = v;
    }
  }
}

export type StatBases = Partial<Record<StatId, number>>;

/**
 * Territory with no effect (no income scaling, no cell buffs, no haste), so tests of older mechanics keep
 * their exact numbers; territory tests patch the values they check (or use DEFAULT_DATA).
 */
export const NEUTRAL_TERRITORY = {
  energyBase: 1,
  energyPerOwned: 0,
  overloadDamage: 1,
  cryoSlow: 0,
  chainDamage: 1,
  miningEnergy: 1,
  firewallDamage: 1,
  infectedSpeed: 1,
} as const;

/** Deep clone of DEFAULT_DATA with a neutral territory, `patch` applied and stat base values overridden, validated. */
export function testData(patch: DeepPartial<GameData> = {}, bases: StatBases = {}): GameData {
  const d = structuredClone(DEFAULT_DATA);
  Object.assign(d.territory, NEUTRAL_TERRITORY);
  merge(d as unknown as Record<string, unknown>, patch as Record<string, unknown>);
  for (const [id, v] of Object.entries(bases)) d.stats.stats[id as StatId].base = v;
  return validateData(d);
}

/**
 * Like `testData`, but with the protocol and set values pinned to `tests/fixtures/mechanics-m3.json`, so
 * mechanics tests check how effects work, not the current balance numbers (tuned in `src/data`).
 */
export function mechanicsData(patch: DeepPartial<GameData> = {}, bases: StatBases = {}): GameData {
  const pinned = structuredClone(mechanicsFixture) as unknown as Record<string, unknown>;
  merge(pinned, patch as Record<string, unknown>);
  return testData(pinned as DeepPartial<GameData>, bases);
}

/** Steps `n` ticks (passing `cmds` to the first step) and returns every event produced, oldest first. */
export function stepN(w: World, data: GameData, n: number, cmds: readonly Command[] = []): SimEvent[] {
  const events: SimEvent[] = [];
  for (let i = 0; i < n; i++) step(w, data, i === 0 ? cmds : [], events);
  return events;
}

export function ofType<T extends SimEvent['type']>(events: readonly SimEvent[], type: T): Extract<SimEvent, { type: T }>[] {
  return events.filter((e): e is Extract<SimEvent, { type: T }> => e.type === type);
}

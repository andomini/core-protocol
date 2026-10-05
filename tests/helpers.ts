import { DEFAULT_DATA, validateData, type GameData } from '../src/sim/data';
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

/** Deep clone of DEFAULT_DATA with `patch` applied, validated. */
export function testData(patch: DeepPartial<GameData> = {}): GameData {
  const d = structuredClone(DEFAULT_DATA);
  merge(d as unknown as Record<string, unknown>, patch as Record<string, unknown>);
  return validateData(d);
}

/** Steps `n` ticks and returns every event produced, oldest first. */
export function stepN(w: World, data: GameData, n: number): SimEvent[] {
  const events: SimEvent[] = [];
  for (let i = 0; i < n; i++) step(w, data, events);
  return events;
}

export function ofType<T extends SimEvent['type']>(events: readonly SimEvent[], type: T): Extract<SimEvent, { type: T }>[] {
  return events.filter((e): e is Extract<SimEvent, { type: T }> => e.type === type);
}

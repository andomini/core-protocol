import { assertFiniteDeep } from './num';
import type { World } from './state';

export const SNAPSHOT_VERSION = 1;

/** Serializes the whole world. Throws if any value is non-finite (JSON would turn it into null). */
export function snapshot(w: World): string {
  assertFiniteDeep(w);
  return JSON.stringify({ v: SNAPSHOT_VERSION, world: w });
}

/** Parses a snapshot back into a World; every failure is an Error mentioning "snapshot". */
export function restore(s: string): World {
  let parsed: unknown;
  try {
    parsed = JSON.parse(s);
  } catch (err) {
    throw new Error(`snapshot: invalid JSON (${(err as Error).message})`);
  }
  const o = parsed as { v?: unknown; world?: unknown } | null;
  if (o === null || typeof o !== 'object' || o.v !== SNAPSHOT_VERSION) {
    throw new Error(`snapshot: unsupported version ${String(o?.v)}`);
  }
  const w = o.world as Partial<World> | null | undefined;
  if (
    w === null ||
    typeof w !== 'object' ||
    typeof w.tick !== 'number' ||
    !Array.isArray(w.enemies) ||
    !Array.isArray(w.projectiles) ||
    typeof w.core !== 'object'
  ) {
    throw new Error('snapshot: malformed world');
  }
  try {
    assertFiniteDeep(w);
  } catch (err) {
    throw new Error(`snapshot: ${(err as Error).message}`);
  }
  return w as World;
}

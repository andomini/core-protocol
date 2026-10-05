import { assertFiniteDeep } from './num';
import { type World, WORLD_VERSION } from './state';

/** Bumped with the World shape: v1 (M1–M2a) derived core stats; v2 (M2b) had no protocols (M3). */
export const SNAPSHOT_VERSION = 3;

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
    w.v !== WORLD_VERSION ||
    typeof w.tick !== 'number' ||
    !Array.isArray(w.enemies) ||
    !Array.isArray(w.projectiles) ||
    typeof w.core !== 'object' ||
    w.core === null ||
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
    (w.phase === 'pick') !== (w.offer.length > 0) ||
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
  try {
    assertFiniteDeep(w);
  } catch (err) {
    throw new Error(`snapshot: ${(err as Error).message}`);
  }
  return w as World;
}

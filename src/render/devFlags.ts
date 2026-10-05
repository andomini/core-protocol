// Dev-only query flags and data overrides. In production builds import.meta.env.DEV is false, so every
// flag reads as off and the overrides are dead code.
//   ?stress=1  200 enemies kept alive on the ring, a core that cannot die, speed ×5, FPS readout
//   ?weak=1    a core that dies in wave 1 (death overlay checks)
//   ?seed=N    fixed run seed

import devJson from '../data/dev.json';
import { ENEMY_KINDS, type GameData, validateData } from '../sim/data';

export interface DevFlags {
  stress: boolean;
  weak: boolean;
  seed: number | null;
}

export const DEV_TUNING = devJson;

export function readFlags(search: string): DevFlags {
  if (!import.meta.env.DEV) return { stress: false, weak: false, seed: null };
  const q = new URLSearchParams(search);
  const seed = q.get('seed');
  return { stress: q.get('stress') === '1', weak: q.get('weak') === '1', seed: seed !== null && /^-?\d+$/.test(seed) ? Number(seed) : null };
}

/** The data a battle runs on: the defaults, or a patched dev copy. */
export function battleData(base: GameData, f: DevFlags): GameData {
  if (!f.stress && !f.weak) return base;
  const d = structuredClone(base);
  if (f.stress) {
    const s = devJson.stress;
    d.core.health = s.coreHealth;
    d.core.attackSpeed = s.coreAttackSpeed;
    for (const k of ENEMY_KINDS) d.enemies[k].hp *= s.enemyHpMul;
  }
  if (f.weak) {
    d.core.health = devJson.weak.coreHealth;
    d.core.regen = devJson.weak.coreRegen;
  }
  return validateData(d);
}

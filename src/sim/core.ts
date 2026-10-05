import type { GameData } from './data';
import type { SimEvent } from './events';
import { clampValue } from './num';
import { chance } from './rng';
import { gridFor } from './spatial';
import type { Enemy, Projectile, World } from './state';
import type { CoreStats } from './stats';

/** Nearest living enemy within `range` of the core; ties go to the lowest id (deterministic). Brute force (tests). */
export function nearestInRange(enemies: readonly Enemy[], range: number): Enemy | undefined {
  const r2 = range * range;
  let best: Enemy | undefined;
  let bestD = Infinity;
  for (const e of enemies) {
    if (e.hp <= 0) continue;
    const d = e.x * e.x + e.y * e.y;
    if (d > r2) continue;
    if (d < bestD || (d === bestD && best !== undefined && e.id < best.id)) {
      best = e;
      bestD = d;
    }
  }
  return best;
}

const targets: Enemy[] = [];

/**
 * Regenerates the core and fires when the cooldown is ready and a target exists: one projectile at the
 * nearest enemy plus one per Multishot level at the next-nearest distinct enemies. Each projectile rolls
 * its own crit on the combat stream. Attack speeds above tickHz fire several volleys in one tick.
 */
export function updateCore(w: World, data: GameData, st: CoreStats, events: SimEvent[]): void {
  const c = w.core;
  const hz = data.config.tickHz;
  if (c.hp < st.health) c.hp = Math.min(st.health, clampValue(c.hp + st.regen / hz));
  if (c.fireCd > 0) c.fireCd -= 1;
  if (c.fireCd > 0 || !(st.attackSpeed > 0)) return;
  const grid = gridFor(data);
  grid.build(w.enemies);
  const n = grid.kNearest(0, 0, st.range, 1 + Math.floor(st.multishot), targets);
  if (n === 0) return; // stays ready until something comes into range
  const interval = hz / st.attackSpeed;
  while (c.fireCd <= 0) {
    for (let i = 0; i < n; i++) {
      const t = targets[i]!;
      const crit = chance(w.rng.combat, st.critChance);
      const damage = clampValue(crit ? st.damage * st.critFactor : st.damage);
      const p: Projectile = { id: w.nextId++, targetId: t.id, x: 0, y: 0, damage, crit };
      w.projectiles.push(p);
      events.push({ type: 'shot', projectileId: p.id, targetId: t.id, crit });
    }
    c.fireCd += interval;
  }
}

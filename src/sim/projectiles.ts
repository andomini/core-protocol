import type { GameData } from './data';
import type { SimEvent } from './events';
import { clampValue, dsqrt } from './num';
import type { Enemy, Projectile, World } from './state';
import type { CoreStats } from './stats';

/** Below this distance from the core the outward direction is undefined; knockback uses directions[0]. */
const CENTER_EPS = 1e-9;

/** Pushes `e` away from the core by `dist` world px, never past the spawn ring (nor inward). */
export function knockBack(e: Enemy, data: GameData, dist: number): void {
  if (!(dist > 0)) return;
  const d = dsqrt(e.x * e.x + e.y * e.y);
  let ux: number;
  let uy: number;
  if (d < CENTER_EPS) {
    [ux, uy] = data.directions[0]!;
  } else {
    ux = e.x / d;
    uy = e.y / d;
  }
  const to = Math.max(d, Math.min(d + dist, data.config.spawnRadius));
  e.x = ux * to;
  e.y = uy * to;
}

/**
 * Applies damage; on the killing blow pays the reward (with Energy Bonus / Bits/Kill) exactly once.
 * Projectile hits also heal by Lifesteal (of the damage actually dealt) and knock surviving enemies back.
 */
export function hitEnemy(
  w: World,
  data: GameData,
  st: CoreStats,
  e: Enemy,
  damage: number,
  crit: boolean,
  source: 'shot' | 'thorns',
  events: SimEvent[],
): void {
  if (e.hp <= 0 || !(damage > 0)) return;
  const dealt = Math.min(damage, e.hp);
  e.hp = clampValue(e.hp - damage);
  events.push({ type: 'hit', enemyId: e.id, damage, crit, source });
  if (source === 'shot' && st.lifesteal > 0 && w.core.hp < st.health) {
    w.core.hp = Math.min(st.health, clampValue(w.core.hp + dealt * st.lifesteal));
  }
  if (e.hp <= 0) {
    const energy = clampValue(e.energy * (1 + st.energyBonus));
    const bits = clampValue(e.bits * (1 + st.bitsPerKill));
    w.energy = clampValue(w.energy + energy);
    w.bits = clampValue(w.bits + bits);
    w.kills += 1;
    events.push({ type: 'kill', enemyId: e.id, kind: e.kind, energy, bits });
    return;
  }
  if (source === 'shot' && st.knockback > 0) knockBack(e, data, st.knockback * data.enemies[e.kind].knockback);
}

/** Moves homing projectiles; resolves hits; removes spent projectiles and dead enemies. */
export function updateProjectiles(w: World, data: GameData, st: CoreStats, events: SimEvent[]): void {
  const stepLen = data.core.projectileSpeed / data.config.tickHz;
  const byId = new Map<number, Enemy>();
  for (const e of w.enemies) byId.set(e.id, e);
  const flying: Projectile[] = [];
  for (const p of w.projectiles) {
    const t = byId.get(p.targetId);
    if (t === undefined || t.hp <= 0) continue; // target gone: the projectile fizzles
    const dx = t.x - p.x;
    const dy = t.y - p.y;
    const d = dsqrt(dx * dx + dy * dy);
    if (d <= stepLen + t.radius) {
      hitEnemy(w, data, st, t, p.damage, p.crit, 'shot', events);
      continue;
    }
    // d > stepLen + radius > 0 here, so the division is safe.
    p.x += (dx / d) * stepLen;
    p.y += (dy / d) * stepLen;
    flying.push(p);
  }
  w.projectiles = flying;
  w.enemies = w.enemies.filter((e) => e.hp > 0);
}

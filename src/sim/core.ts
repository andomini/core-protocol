import type { GameData } from './data';
import type { SimEvent } from './events';
import type { Enemy, Projectile, World } from './state';

/** Nearest living enemy within `range` of the core; ties go to the lowest id (deterministic). */
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

/** Regenerates the core and fires one projectile when the cooldown is ready and a target exists. */
export function updateCore(w: World, data: GameData, events: SimEvent[]): void {
  const c = w.core;
  const hz = data.config.tickHz;
  if (c.hp < c.maxHp) c.hp = Math.min(c.maxHp, c.hp + c.regen / hz);
  if (c.fireCd > 0) c.fireCd -= 1;
  if (c.fireCd > 0) return;
  const target = nearestInRange(w.enemies, c.range);
  if (target === undefined) return; // stays ready until something comes into range
  const p: Projectile = { id: w.nextId++, targetId: target.id, x: 0, y: 0, damage: c.damage };
  w.projectiles.push(p);
  events.push({ type: 'shot', projectileId: p.id, targetId: target.id });
  c.fireCd += hz / c.attackSpeed;
}

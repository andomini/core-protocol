import type { GameData } from './data';
import type { SimEvent } from './events';
import { clampValue, dsqrt } from './num';
import type { Enemy, Projectile, World } from './state';

/** Applies damage; on the killing blow pays the reward exactly once. */
export function hitEnemy(w: World, e: Enemy, damage: number, events: SimEvent[]): void {
  if (e.hp <= 0) return;
  e.hp -= damage;
  events.push({ type: 'hit', enemyId: e.id, damage });
  if (e.hp <= 0) {
    w.energy = clampValue(w.energy + e.energy);
    w.bits = clampValue(w.bits + e.bits);
    w.kills += 1;
    events.push({ type: 'kill', enemyId: e.id, kind: e.kind, energy: e.energy, bits: e.bits });
  }
}

/** Moves homing projectiles; resolves hits; removes spent projectiles and dead enemies. */
export function updateProjectiles(w: World, data: GameData, events: SimEvent[]): void {
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
      hitEnemy(w, t, p.damage, events);
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

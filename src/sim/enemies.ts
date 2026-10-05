import type { GameData } from './data';
import type { SimEvent } from './events';
import { dsqrt } from './num';
import type { World } from './state';

/** Distance tolerance for "arrived": guards against endless sub-ulp moves at the stop point. */
const ARRIVE_EPS = 1e-6;

/** Moves enemies toward the core; arrived enemies attack it on their own cooldown. */
export function updateEnemies(w: World, data: GameData, events: SimEvent[]): void {
  const perTick = 1 / data.config.tickHz;
  const coreRadius = data.core.radius;
  for (const e of w.enemies) {
    const stopAt = e.standoff > 0 ? e.standoff : coreRadius + e.radius;
    const dist = dsqrt(e.x * e.x + e.y * e.y);
    if (dist > stopAt + ARRIVE_EPS) {
      // dist > stopAt > 0 here, so the division is safe.
      const move = Math.min(e.speed * perTick, dist - stopAt);
      e.x -= (e.x / dist) * move;
      e.y -= (e.y / dist) * move;
      continue;
    }
    e.attackCd -= 1;
    if (e.attackCd <= 0) {
      e.attackCd += e.attackIntervalTicks;
      w.core.hp -= e.damage;
      events.push({ type: 'coreHit', enemyId: e.id, damage: e.damage, ranged: e.standoff > 0 });
    }
  }
}

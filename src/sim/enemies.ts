import type { GameData } from './data';
import type { SimEvent } from './events';
import { clampValue, dsqrt } from './num';
import { hitEnemy } from './projectiles';
import type { World } from './state';
import type { CoreStats } from './stats';

/** Distance tolerance for "arrived": guards against endless sub-ulp moves at the stop point. */
const ARRIVE_EPS = 1e-6;

/**
 * Moves enemies toward the core; arrived enemies attack it on their own cooldown. Defense % reduces the
 * damage taken; Thorns reflect a share of melee damage taken back at the attacker.
 */
export function updateEnemies(w: World, data: GameData, st: CoreStats, events: SimEvent[]): void {
  const perTick = 1 / data.config.tickHz;
  const coreRadius = data.core.radius;
  const taken = 1 - st.defense;
  for (const e of w.enemies) {
    if (e.hp <= 0) continue;
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
      const damage = clampValue(e.damage * taken);
      w.core.hp = clampValue(w.core.hp - damage);
      const ranged = e.standoff > 0;
      events.push({ type: 'coreHit', enemyId: e.id, damage, ranged });
      if (!ranged && st.thorns > 0) hitEnemy(w, data, st, e, clampValue(damage * st.thorns), false, 'thorns', events);
    }
  }
}

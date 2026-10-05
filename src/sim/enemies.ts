import type { GameData } from './data';
import type { SimEvent } from './events';
import { clampValue, dsqrt } from './num';
import type { PerkProfile } from './perks';
import { hitEnemy, inAura, isFrozen } from './projectiles';
import type { World } from './state';
import type { CoreStats } from './stats';

/** Distance tolerance for "arrived": guards against endless sub-ulp moves at the stop point. */
const ARRIVE_EPS = 1e-6;

/** Movement slow for `e` this tick: on-hit slow and Cold Aura (each + the 🧊 bonus), capped. */
export function slowFactor(w: World, e: World['enemies'][number], st: CoreStats, prof: PerkProfile): number {
  const r = prof.rules;
  let s = 0;
  if (w.tick <= e.slowUntil && e.slow > 0) s += e.slow + r.slowBonus;
  if (inAura(e, st, prof)) s += prof.auraSlow + r.slowBonus;
  return Math.min(r.slowCap, s);
}

/** True while a 🛡 immunity window is active. */
export function immune(w: World, prof: PerkProfile): boolean {
  for (const { key, e } of prof.periodic) if (e.action === 'immunity' && w.tick <= (w.timers[key]?.until ?? -1)) return true;
  return false;
}

/** Starts a charged 🛡 immunity window when a hit would drop HP below its threshold. */
function tryImmunity(w: World, data: GameData, st: CoreStats, prof: PerkProfile, damage: number, events: SimEvent[]): boolean {
  for (const { key, e } of prof.periodic) {
    if (e.action !== 'immunity') continue;
    const t = w.timers[key] ?? (w.timers[key] = { next: 0, until: -1 });
    if (w.wave < t.next || w.core.hp - damage >= st.health * e.hpBelow) continue;
    t.until = w.tick + Math.max(1, Math.round(e.seconds * data.config.tickHz));
    t.next = w.wave + e.everyWaves;
    events.push({ type: 'immunity', untilTick: t.until });
    return true;
  }
  return false;
}

/**
 * Moves enemies toward the core; arrived enemies attack it on their own cooldown. Slows scale both the
 * movement and the attack cadence; frozen enemies neither move nor attack. Defense % reduces the damage taken; an immunity window blocks
 * it; Thorns reflect a share of melee damage (and ranged with the 🛡 4-set) back at the attacker.
 */
export function updateEnemies(w: World, data: GameData, st: CoreStats, prof: PerkProfile, events: SimEvent[]): void {
  const perTick = 1 / data.config.tickHz;
  const coreRadius = data.core.radius;
  const taken = 1 - st.defense;
  for (const e of w.enemies) {
    if (e.hp <= 0 || isFrozen(w, e)) continue;
    const stopAt = e.standoff > 0 ? e.standoff : coreRadius + e.radius;
    const dist = dsqrt(e.x * e.x + e.y * e.y);
    // Cryo slows both movement and the attack cadence (a slowed virus also hits less often).
    const pace = 1 - slowFactor(w, e, st, prof);
    if (dist > stopAt + ARRIVE_EPS) {
      // dist > stopAt > 0 here, so the division is safe.
      const move = Math.min(e.speed * pace * perTick, dist - stopAt);
      e.x -= (e.x / dist) * move;
      e.y -= (e.y / dist) * move;
      continue;
    }
    e.attackCd -= pace;
    if (e.attackCd <= 0) {
      e.attackCd += e.attackIntervalTicks;
      const ranged = e.standoff > 0;
      let damage = clampValue(e.damage * taken);
      const blocked = immune(w, prof) || tryImmunity(w, data, st, prof, damage, events);
      if (blocked) damage = 0;
      w.core.hp = clampValue(w.core.hp - damage);
      events.push({ type: 'coreHit', enemyId: e.id, damage, ranged, blocked });
      const reflects = !ranged || prof.rules.thornsRanged > 0;
      if (reflects && st.thorns > 0 && damage > 0) hitEnemy(w, data, st, prof, e, clampValue(damage * st.thorns), false, 'thorns', events);
    }
  }
}

import type { GameData } from './data';
import type { SimEvent } from './events';
import { clampValue, dsqrt } from './num';
import type { PerkProfile } from './perks';
import { hitEnemy, inAura, isFrozen } from './projectiles';
import { sectorOf } from './hex';
import type { Enemy, Struct, World } from './state';
import { activeWalls, breakSegment, clearShatter, wallMaxHp } from './structures';
import { groundAt } from './territory';
import type { CoreStats } from './stats';

/** Distance tolerance for "arrived": guards against endless sub-ulp moves at the stop point. */
const ARRIVE_EPS = 1e-6;

/** Scratch: the standing wall segment per sector for this tick (null = open). */
const walls: (Struct | null)[] = [null, null, null, null, null, null];

/**
 * Movement slow for `e` this tick: on-hit slow, Cold Aura (each + the 🧊 bonus) and a 🧊 cell, shrunk by
 * the Antifreeze gene, capped.
 */
export function slowFactor(w: World, e: World['enemies'][number], st: CoreStats, prof: PerkProfile, data: GameData): number {
  const r = prof.rules;
  let s = 0;
  if (w.tick <= e.slowUntil && e.slow > 0) s += e.slow + r.slowBonus;
  if (inAura(e, st, prof)) s += prof.auraSlow + r.slowBonus;
  if (groundAt(w, data, prof.shape.sectors, e.x, e.y) === 'cryo') s += data.territory.cryoSlow;
  return Math.min(r.slowCap, s * prof.geneSlow);
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

/** Thorns answer a hit that landed for `damage` (core or wall): reflect a share, and Frostbite-style slow the attacker. */
function reflectThorns(w: World, data: GameData, st: CoreStats, prof: PerkProfile, e: Enemy, damage: number, ranged: boolean, events: SimEvent[]): void {
  const reflects = !ranged || prof.rules.thornsRanged > 0;
  if (!reflects || st.thorns <= 0 || damage <= 0) return;
  hitEnemy(w, data, st, prof, e, clampValue(damage * st.thorns), false, 'thorns', events);
  // Ice Wall / Frostbite (fusion): Thorns also slow the attacker.
  if (prof.thornsSlow > 0 && e.hp > 0) {
    e.slow = Math.max(w.tick <= e.slowUntil ? e.slow : 0, prof.thornsSlow);
    e.slowUntil = Math.max(e.slowUntil, w.tick + prof.thornsSlowTicks);
  }
}

/** A virus hits the wall segment in its way: Defense applies, Thorns answer, and at 0 HP the segment goes down. */
function attackWall(w: World, data: GameData, st: CoreStats, prof: PerkProfile, e: Enemy, seg: Struct, walls: (Struct | null)[], events: SimEvent[]): void {
  const ranged = e.standoff > 0;
  const damage = clampValue(e.damage * (1 - st.defense));
  const maxHp = wallMaxHp(st, prof.structures.wall!);
  seg.share = maxHp > 0 ? Math.max(0, seg.share - damage / maxHp) : 0;
  events.push({ type: 'structHit', sid: seg.id, kind: seg.kind, x: seg.x, y: seg.y, enemyId: e.id, damage, ranged });
  reflectThorns(w, data, st, prof, e, damage, ranged, events);
  if (seg.share <= 0) {
    walls[seg.slot] = null;
    breakSegment(w, data, prof, seg, events);
  }
}

/**
 * Moves enemies toward the core; arrived enemies attack it on their own cooldown. Slows scale both the
 * movement and the attack cadence; frozen enemies neither move nor attack. Defense % reduces the damage taken; an immunity window blocks
 * it; Thorns reflect a share of melee damage (and ranged with the 🛡 4-set) back at the attacker.
 * Structures (spec 2026-10-15): a virus outside a standing wall segment of its sector stops at the wall and hits it
 * instead of the core (ranged too); once the segment is down, or for a virus already inside the ring, the way is open.
 */
export function updateEnemies(w: World, data: GameData, st: CoreStats, prof: PerkProfile, events: SimEvent[]): void {
  const perTick = 1 / data.config.tickHz;
  const coreRadius = data.core.radius;
  const taken = 1 - st.defense;
  // Tier condition: viruses regenerate a share of max HP per second.
  const regen = (data.tiers[w.tier - 1]?.enemyRegen ?? 0) * perTick;
  clearShatter();
  const anyWall = activeWalls(w, prof, walls);
  for (const e of w.enemies) {
    if (e.hp <= 0) continue;
    if (regen > 0 && e.hp < e.maxHp) e.hp = Math.min(e.maxHp, e.hp + e.maxHp * regen);
    if (isFrozen(w, e)) continue;
    // Melee viruses crash into the crystal: they stop at its reach in their sector (spec 2026-10-14 §A).
    const reach = Math.max(coreRadius, prof.shape.reach[sectorOf(e.x, e.y)] ?? 0);
    const dist = dsqrt(e.x * e.x + e.y * e.y);
    const seg = anyWall ? walls[sectorOf(e.x, e.y)] ?? null : null;
    const wallStop = w.wallR + e.radius;
    const atWall = seg !== null && dist >= wallStop - ARRIVE_EPS;
    const stopAt = atWall
      ? Math.max(e.standoff, wallStop)
      : e.standoff > 0
        ? Math.max(e.standoff, reach + e.radius)
        : reach + e.radius;
    const ground = groundAt(w, data, prof.shape.sectors, e.x, e.y);
    // Cryo slows both movement and the attack cadence (a slowed virus also hits less often).
    const pace = 1 - slowFactor(w, e, st, prof, data);
    if (dist > stopAt + ARRIVE_EPS) {
      // dist > stopAt > 0 here, so the division is safe. Infected ground speeds viruses up.
      const haste = ground === 'infected' ? data.territory.infectedSpeed : 1;
      const move = Math.min(e.speed * pace * haste * prof.rules.enemySpeed * perTick, dist - stopAt);
      e.x -= (e.x / dist) * move;
      e.y -= (e.y / dist) * move;
      continue;
    }
    e.attackCd -= pace;
    if (e.attackCd <= 0) {
      e.attackCd += e.attackIntervalTicks;
      if (atWall) {
        attackWall(w, data, st, prof, e, seg, walls, events);
        continue;
      }
      const ranged = e.standoff > 0;
      // A virus standing on 🛡 ground hits softer.
      let damage = clampValue(e.damage * taken * (ground === 'firewall' ? data.territory.firewallDamage : 1));
      const blocked = immune(w, prof) || tryImmunity(w, data, st, prof, damage, events);
      if (blocked) damage = 0;
      // Barrier (card) absorbs first.
      let absorbed = 0;
      if (w.shield > 0 && damage > 0) {
        absorbed = Math.min(w.shield, damage);
        w.shield -= absorbed;
        damage -= absorbed;
      }
      w.core.hp = clampValue(w.core.hp - damage);
      events.push({ type: 'coreHit', enemyId: e.id, damage, ranged, blocked, absorbed });
      reflectThorns(w, data, st, prof, e, damage, ranged, events);
      // Grounding (fusion): every attack on the core is answered by a bolt from the core.
      if (prof.retaliateMul > 0 && e.hp > 0) {
        events.push({ type: 'lightning', fromId: 0, targets: [e.id] });
        hitEnemy(w, data, st, prof, e, clampValue(st.damage * prof.retaliateMul), false, 'lightning', events);
      }
    }
  }
}

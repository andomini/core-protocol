// Pulse (uniqueness plan 2026-10-20, item 4): the one active verb in combat. Tap the core (or Space) and it
// emits a ring of radius `radiusRangeMul` × Range whose effect follows the build's dominant tag (the highest
// set count on the crystal now). It then cools down for `cooldownSec` (shorter with that tag's set tier).
// The `autoPulse` lab node fires it by itself as soon as it is ready and enough viruses are inside the ring.
// Every number lives in src/data/pulse.json.

import type { GameData } from './data';
import type { SimEvent } from './events';
import { clampValue } from './num';
import { type PerkProfile, perkProfile, type ProtocolReject } from './perks';
import { TAGS, type Tag } from './perkData';
import { hitEnemy, knockBack } from './projectiles';
import { type Enemy, type World, worldStats } from './state';
import type { CoreStats } from './stats';

/** The tag the pulse takes: the highest set count ≥ minCount (ties in TAGS order), or null (the plain pulse). */
export function pulseTag(w: World, data: GameData): Tag | null {
  let best: Tag | null = null;
  for (const t of TAGS) {
    const c = w.tagCountsNow[t];
    if (c < data.pulse.minCount) continue;
    if (best === null || c > w.tagCountsNow[best]) best = t;
  }
  return best;
}

/** Set tier steps reached by `tag` (0 for none, 1 for a 2-set, …). */
function tierSteps(w: World, data: GameData, tag: Tag | null): number {
  if (tag === null) return 0;
  let n = 0;
  for (const t of data.sets.tiers) if (t <= w.setTiers[tag]) n++;
  return n;
}

/** × on every pulse effect from the dominant tag's set tier. */
export function pulsePower(w: World, data: GameData, tag: Tag | null): number {
  return 1 + data.pulse.tierPower * tierSteps(w, data, tag);
}

/** Cooldown in ticks after a pulse of `tag`. */
export function pulseCooldownTicks(w: World, data: GameData, tag: Tag | null): number {
  const k = Math.max(0.2, 1 - data.pulse.tierCooldown * tierSteps(w, data, tag));
  return Math.max(1, Math.round(data.pulse.cooldownSec * data.config.tickHz * k));
}

/** Ring radius (world px) for these stats. */
export function pulseRadius(data: GameData, st: CoreStats): number {
  return clampValue(st.range * data.pulse.radiusRangeMul);
}

/** Ready: alive, not picking, cooldown over. */
export function pulseReady(w: World): boolean {
  return !w.dead && w.phase !== 'pick' && w.tick >= w.pulseReadyTick;
}

/** Share of the cooldown done (1 = ready), for the HUD ring. */
export function pulseCharge(w: World, data: GameData): number {
  if (w.tick >= w.pulseReadyTick) return 1;
  const total = pulseCooldownTicks(w, data, w.pulseLastTag === 'none' ? null : w.pulseLastTag);
  return Math.max(0, Math.min(1, 1 - (w.pulseReadyTick - w.tick) / total));
}

/** Living viruses inside the ring, in World order (id order: deterministic). */
export function pulseTargets(w: World, r: number): Enemy[] {
  const r2 = r * r;
  const out: Enemy[] = [];
  for (const e of w.enemies) if (e.hp > 0 && e.x * e.x + e.y * e.y <= r2) out.push(e);
  return out;
}

/** True when a pulse now would be worth it under the autoPulse rule (ready + at least minTargets in the ring). */
export function pulseWorth(w: World, data: GameData, st?: CoreStats): boolean {
  if (!pulseReady(w) || w.enemies.length < data.pulse.autoPulse.minTargets) return false;
  const r = pulseRadius(data, st ?? worldStats(w, data));
  const r2 = r * r;
  let n = 0;
  for (const e of w.enemies) if (e.hp > 0 && e.x * e.x + e.y * e.y <= r2 && ++n >= data.pulse.autoPulse.minTargets) return true;
  return false;
}

/** Fires the pulse now (the caller checked pulseReady). */
export function firePulse(w: World, data: GameData, st: CoreStats, prof: PerkProfile, events: SimEvent[]): void {
  const P = data.pulse;
  const tag = pulseTag(w, data);
  const power = pulsePower(w, data, tag);
  const r = pulseRadius(data, st);
  const hit = pulseTargets(w, r);
  w.pulseReadyTick = w.tick + pulseCooldownTicks(w, data, tag);
  w.pulseCount += 1;
  w.pulseLastTag = tag ?? 'none';
  const dmg = (mul: number) => clampValue(st.damage * mul * power);
  let energy = 0;
  let bits = 0;
  let shield = 0;
  const push = (dist: number) => {
    for (const e of hit) if (e.hp > 0) knockBack(e, data, dist * power * data.enemies[e.kind].knockback, w.wave);
  };
  switch (tag) {
    case null:
      for (const e of hit) hitEnemy(w, data, st, prof, e, dmg(P.none.damageMul), false, 'pulse', events);
      push(P.none.knockback);
      break;
    case 'overload':
      for (const e of hit) hitEnemy(w, data, st, prof, e, dmg(P.overload.damageMul), false, 'pulse', events);
      break;
    case 'cryo': {
      const until = w.tick + Math.max(1, Math.round(P.cryo.freezeSec * power * data.config.tickHz));
      for (const e of hit) {
        e.frozenUntil = Math.max(e.frozenUntil, until);
        events.push({ type: 'freeze', enemyId: e.id });
      }
      for (const e of hit) hitEnemy(w, data, st, prof, e, dmg(P.cryo.damageMul), false, 'pulse', events);
      break;
    }
    case 'chain': {
      const arcs = hit.slice(0, Math.max(0, Math.floor(P.chain.maxTargets)));
      if (arcs.length > 0) events.push({ type: 'lightning', fromId: 0, targets: arcs.map((e) => e.id) });
      for (const e of arcs) hitEnemy(w, data, st, prof, e, dmg(P.chain.damageMul), false, 'lightning', events);
      break;
    }
    case 'mining':
      // Harvest: every virus in the ring pays its kill Energy and Bits once now (it does not have to die).
      for (const e of hit) {
        energy += e.energy * P.mining.energyMul * power;
        bits += e.bits * P.mining.bitsMul * power;
      }
      energy = clampValue(energy);
      bits = clampValue(bits);
      w.energy = clampValue(w.energy + energy);
      w.bits = clampValue(w.bits + bits);
      for (const e of hit) hitEnemy(w, data, st, prof, e, dmg(P.mining.damageMul), false, 'pulse', events);
      break;
    case 'firewall': {
      const cap = st.health * P.firewall.shieldCapFrac;
      const before = w.shield;
      w.shield = clampValue(Math.max(before, Math.min(cap, before + st.health * P.firewall.shieldFrac * power)));
      shield = w.shield - before;
      for (const e of hit) hitEnemy(w, data, st, prof, e, dmg(P.firewall.damageMul), false, 'pulse', events);
      push(P.firewall.knockback);
      break;
    }
  }
  events.push({ type: 'pulse', tag, x: 0, y: 0, radius: r, targets: hit.length, energy, bits, shield });
}

/** The `pulse` command: fires when ready, else changes nothing. */
export function pulseCommand(w: World, data: GameData, events: SimEvent[]): ProtocolReject | null {
  if (w.dead) return 'dead';
  if (w.phase === 'pick') return 'phase';
  if (!pulseReady(w)) return 'cooldown';
  firePulse(w, data, worldStats(w, data), perkProfile(w, data), events);
  return null;
}

/** autoPulse lab node (step, after the spatial hash): fire as soon as it is ready and minTargets viruses are in the ring. */
export function autoPulse(w: World, data: GameData, st: CoreStats, prof: PerkProfile, events: SimEvent[]): void {
  if (w.pulseAuto && pulseWorth(w, data, st)) firePulse(w, data, st, prof, events);
}

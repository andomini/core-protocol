import type { GameData } from './data';
import type { SimEvent } from './events';
import { scaleForWave } from './economy';
import { clampValue, dsqrt } from './num';
import { boostActive, type PerkProfile } from './perks';
import { chance } from './rng';
import { gridFor } from './spatial';
import type { MarkValues } from './perkData';
import type { Enemy, Projectile, World } from './state';
import { arenaRadius, cleanse, farMul, groundAt } from './territory';
import type { CoreStats } from './stats';
import { auraMul, carriedReturn, splitSpore } from './viruses';

/** Below this distance from the core the outward direction is undefined; knockback uses directions[0]. */
const CENTER_EPS = 1e-9;

/** Pushes `e` away from the core by `dist` world px, never past the spawn ring (nor inward). */
export function knockBack(e: Enemy, data: GameData, dist: number, wave: number): void {
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
  const to = Math.max(d, Math.min(d + dist, arenaRadius(data, wave)));
  e.x = ux * to;
  e.y = uy * to;
}

export function isFrozen(w: World, e: Enemy): boolean {
  return w.tick <= e.frozenUntil;
}

/** Inside the Cold Aura (inner share of the core's range). */
export function inAura(e: Enemy, st: CoreStats, prof: PerkProfile): boolean {
  if (!(prof.auraSlow > 0)) return false;
  const r = prof.auraFrac * st.range;
  return e.x * e.x + e.y * e.y <= r * r;
}

/** Slowed by anything (on-hit slow, aura or freeze): the condition Shatter reads. */
export function isSlowed(w: World, e: Enemy, st: CoreStats, prof: PerkProfile): boolean {
  return (w.tick <= e.slowUntil && e.slow > 0) || isFrozen(w, e) || inAura(e, st, prof);
}

/** Damage multiplier from conditional effects on the target's state (slowed, frozen, low HP). */
export function conditionalMul(w: World, e: Enemy, st: CoreStats, prof: PerkProfile): number {
  let m = 1;
  if (prof.slowedMul !== 1 && isSlowed(w, e, st, prof)) m *= prof.slowedMul;
  if (prof.frozenMul !== 1 && isFrozen(w, e)) m *= prof.frozenMul;
  if (prof.hpBelowMul !== 1 && e.hp <= e.maxHp * prof.hpBelowFrac) m *= prof.hpBelowMul;
  return m;
}

/** `bounce`: a projectile's later hits; `tesla`: the Tesla Coil card's bolt from the core. */
/** `turret`, `mine`: the Bastion's shots and the Minefield's blasts (spec 2026-10-15); mines count as chain. */
/** `pulse`: the core's Pulse ring (src/sim/pulse.ts); its chain arcs count as `lightning`. */
export type HitSource = 'shot' | 'bounce' | 'thorns' | 'lightning' | 'tesla' | 'turret' | 'mine' | 'pulse';

/**
 * Applies damage; on the killing blow pays the reward (Energy Bonus, Energy Siphon, boss multipliers, boost,
 * Bits/Kill, Keys) exactly once. Projectile hits also heal by Lifesteal (of the damage actually dealt) and
 * knock surviving enemies back.
 */
export function hitEnemy(
  w: World,
  data: GameData,
  st: CoreStats,
  prof: PerkProfile,
  e: Enemy,
  damage: number,
  crit: boolean,
  source: HitSource,
  events: SimEvent[],
): void {
  if (e.hp <= 0 || !(damage > 0)) return;
  // A Carrier's aura (B2) shields the viruses around it from every source.
  const aura = auraMul(w, data, e);
  if (aura < 1) damage = clampValue(damage * aura);
  // Ground under the target (spec 2026-10-14 §B): ⚡ cells amplify every hit, 🔗 cells bounces and lightning.
  const ground = groundAt(w, data, prof.shape.sectors, e.x, e.y);
  if (ground === 'overload') damage = clampValue(damage * data.territory.overloadDamage);
  else if (ground === 'chain' && (source === 'bounce' || source === 'lightning' || source === 'mine')) damage = clampValue(damage * data.territory.chainDamage);
  const dealt = Math.min(damage, e.hp);
  e.hp = clampValue(e.hp - damage);
  const projectile = source === 'shot' || source === 'bounce';
  let healed = 0;
  if (projectile && st.lifesteal > 0 && w.core.hp < st.health) {
    const before = w.core.hp;
    w.core.hp = Math.min(st.health, clampValue(w.core.hp + dealt * st.lifesteal));
    healed = w.core.hp - before;
  }
  events.push({ type: 'hit', enemyId: e.id, damage, dealt, crit, source, healed });
  if (e.hp <= 0) {
    const boss = e.kind === 'boss';
    const boost = boostActive(w) ? data.perks.boost.energyMul : 1;
    // Territory income: the owned share scales kill Energy; 💰 ground pays extra; Encryption (gene) takes a cut.
    const t = data.territory;
    const land = (t.energyBase + t.energyPerOwned * prof.owned) * (ground === 'mining' ? t.miningEnergy : 1) * prof.geneEnergy;
    // Mines lie just outside the wall: their kills pay the near-ground rate, not the far-out bonus.
    const far = source === 'mine' ? 1 : farMul(data, e.x, e.y);
    // Fusions: crit kills, frozen kills and bounce/lightning kills pay more Energy.
    let how = 1;
    if (crit) how *= prof.critKillMul;
    if (isFrozen(w, e)) how *= prof.frozenKillMul;
    if (source === 'bounce' || source === 'lightning' || source === 'tesla' || source === 'mine') how *= prof.chainKillMul;
    // The crit x frozen x chain product is capped (data.sets.howCap) so stacked fusions cannot blow a kill up.
    how = Math.min(how, data.sets.howCap);
    // Bounty Marks (spec 2026-10-16): reward lines outside the `how` cap. The boss Mark pays × bossBitsMul Bits only.
    const m = e.marked === true ? prof.mark : null;
    let markEnergy = 1;
    let markBits = 1;
    if (m !== null) {
      if (boss) markBits = Math.max(1, m.bossBitsMul);
      else {
        markEnergy = Math.max(1, m.energyMul);
        markBits = Math.max(1, m.bitsMul);
      }
      if (crit && m.critMul > 1) {
        markEnergy *= m.critMul;
        markBits *= m.critMul;
      }
    }
    const energy = clampValue(e.energy * (1 + st.energyBonus + prof.killEnergy) * (boss ? prof.bossEnergyMul : 1) * boost * land * far * how * markEnergy);
    // A Leech pays back what it stole × returnMul, outside every Bits multiplier.
    const returned = carriedReturn(data, e);
    const bits = clampValue(e.bits * (1 + st.bitsPerKill) * (boss ? prof.bossBitsMul : 1) * far * markBits + returned);
    const keys = data.enemies[e.kind].keys + (boss ? prof.bossKeys : 0);
    w.energy = clampValue(w.energy + energy);
    w.bits = clampValue(w.bits + bits);
    w.keys = clampValue(w.keys + keys);
    w.kills += 1;
    cleanse(w, data, e);
    events.push(returned > 0 ? { type: 'kill', enemyId: e.id, kind: e.kind, energy, bits, keys, returned } : { type: 'kill', enemyId: e.id, kind: e.kind, energy, bits, keys });
    if (m !== null) payMark(w, data, m, e, energy, bits, events);
    splitSpore(w, data, e, events);
    return;
  }
  // At most one knockback per enemy per cooldown: Multishot volleys must not pin the whole crowd.
  if (projectile && st.knockback > 0 && w.tick >= e.kbUntil) {
    knockBack(e, data, st.knockback * data.enemies[e.kind].knockback, w.wave);
    e.kbUntil = w.tick + Math.round(data.config.knockbackCooldown * data.config.tickHz);
  }
}

/** A Mark was killed: count it; every `jackpotEvery` Marks pay the Bounty jackpot (scaled for the wave), at most `jackpotCap` per run. */
function payMark(w: World, data: GameData, m: MarkValues, e: Enemy, energy: number, bits: number, events: SimEvent[]): void {
  w.marks.killed += 1;
  events.push({ type: 'markKill', enemyId: e.id, x: e.x, y: e.y, energy, bits });
  if (m.jackpotEvery <= 0 || m.jackpot <= 0 || w.marks.jackpots >= m.jackpotCap || w.marks.killed % m.jackpotEvery !== 0) return;
  const jackpot = scaleForWave(m.jackpot, data.tiers[w.tier - 1]!.bitsMul, data.config.bitsGrowth, Math.max(1, w.wave));
  w.bits = clampValue(w.bits + jackpot);
  w.marks.jackpots += 1;
  events.push({ type: 'bountyJackpot', bits: jackpot, n: w.marks.jackpots, x: e.x, y: e.y });
}

const near: Enemy[] = [];

/**
 * Chain lightning from `from`: the nearest living enemies (spatial hash, built this tick) within the
 * lightning range, `lightningDamage` × the hit's damage each. Lightning hits proc nothing further.
 */
export function lightning(w: World, data: GameData, st: CoreStats, prof: PerkProfile, from: Enemy, damage: number, events: SimEvent[]): void {
  const n = Math.floor(prof.rules.lightningTargets);
  if (n <= 0) return;
  // +1 for the source itself; dead or stale entries are skipped below.
  gridFor(data).kNearest(from.x, from.y, prof.rules.lightningRange, n + 1, near);
  const targets: number[] = [];
  const hit: Enemy[] = [];
  for (const e of near) {
    if (e.id === from.id || e.hp <= 0) continue;
    if (hit.length >= n) break;
    hit.push(e);
    targets.push(e.id);
  }
  if (targets.length === 0) return;
  events.push({ type: 'lightning', fromId: from.id, targets });
  const base = damage * prof.rules.lightningDamage;
  for (const e of hit) {
    hitEnemy(w, data, st, prof, e, clampValue(base * conditionalMul(w, e, st, prof)), false, 'lightning', events);
    // Superconductor (fusion): survivors freeze.
    if (prof.lightningFreezeTicks > 0 && e.hp > 0) {
      e.frozenUntil = Math.max(e.frozenUntil, w.tick + prof.lightningFreezeTicks);
      events.push({ type: 'freeze', enemyId: e.id });
    }
  }
}

/** The nearest living enemy within bounce range of `from` that this projectile has not hit. */
function bounceTarget(data: GameData, prof: PerkProfile, p: Projectile, from: Enemy): Enemy | undefined {
  const k = p.hits.length + 2;
  gridFor(data).kNearest(from.x, from.y, prof.rules.bounceRange, k, near);
  for (const e of near) if (e.hp > 0 && e.id !== from.id && !p.hits.includes(e.id)) return e;
  return undefined;
}

/** A projectile reached `t`: damage, on-hit procs (first hit only), then maybe a bounce. Returns true if it flies on. */
function resolveHit(w: World, data: GameData, st: CoreStats, prof: PerkProfile, p: Projectile, t: Enemy, events: SimEvent[]): boolean {
  hitEnemy(w, data, st, prof, t, clampValue(p.damage * conditionalMul(w, t, st, prof)), p.crit, p.hits.length === 0 ? 'shot' : 'bounce', events);
  const alive = t.hp > 0;
  // On-hit procs (slow, freeze, lightning) fire only on a projectile's first hit, not on its bounces:
  // otherwise 🔗 bounces spread 🧊 crowd control over the whole pile and chains multiply.
  const first = p.hits.length === 0;
  if (alive && first && prof.slowOnHit > 0) {
    t.slow = prof.slowOnHit;
    t.slowUntil = w.tick + prof.slowTicks;
  }
  if (alive && first && prof.freezeChance > 0 && chance(w.rng.combat, prof.freezeChance)) {
    t.frozenUntil = Math.max(t.frozenUntil, w.tick + prof.freezeTicks);
    events.push({ type: 'freeze', enemyId: t.id });
  }
  const arc =
    first &&
    ((prof.lightningChance > 0 && chance(w.rng.combat, prof.lightningChance)) ||
      (p.crit && prof.critLightning) ||
      (t.kind === 'boss' && prof.rules.bossLightning > 0));
  if (arc) lightning(w, data, st, prof, t, p.damage, events);
  if (p.bounces <= 0) return false;
  const next = bounceTarget(data, prof, p, t);
  if (next === undefined) return false;
  p.hits.push(t.id);
  p.targetId = next.id;
  p.x = t.x;
  p.y = t.y;
  p.damage = clampValue(p.damage * prof.rules.bounceDamage);
  p.bounces -= 1;
  events.push({ type: 'bounce', projectileId: p.id, fromId: t.id, toId: next.id });
  return true;
}

/** Moves homing projectiles; resolves hits (procs, bounces); removes spent projectiles and dead enemies. */
export function updateProjectiles(w: World, data: GameData, st: CoreStats, prof: PerkProfile, events: SimEvent[]): void {
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
      if (resolveHit(w, data, st, prof, p, t, events)) flying.push(p);
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

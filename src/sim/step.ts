import { applyCommands, type Command } from './commands';
import { updateCore } from './core';
import type { GameData } from './data';
import { updateEnemies } from './enemies';
import type { SimEvent } from './events';
import { clampValue } from './num';
import { type PerkProfile, periodicTicks, perkProfile } from './perks';
import { updateProjectiles } from './projectiles';
import { gridFor } from './spatial';
import { type World, worldStats } from './state';
import type { CoreStats } from './stats';
import { advanceWave } from './waves';

/**
 * Seconds-based periodic set effects (Overdrive, global freeze): fire when due and at least one enemy is
 * alive (a trigger never goes to waste on an empty arena), then re-arm one period later.
 */
export function runPeriodic(w: World, data: GameData, prof: PerkProfile, events: SimEvent[]): void {
  for (const { key, e } of prof.periodic) {
    if (e.action === 'immunity') continue; // reactive: see enemies.ts
    const every = Math.max(1, Math.round(e.everySec * data.config.tickHz));
    const t = w.timers[key] ?? (w.timers[key] = { next: w.tick + every, until: -1 });
    if (w.tick < t.next || w.enemies.length === 0) continue;
    t.until = w.tick + periodicTicks(data, prof, e);
    t.next = w.tick + every;
    if (e.action === 'overdrive') {
      events.push({ type: 'overdrive', untilTick: t.until });
    } else {
      for (const en of w.enemies) en.frozenUntil = Math.max(en.frozenUntil, t.until);
      events.push({ type: 'freezeAll', count: w.enemies.length, untilTick: t.until });
    }
  }
}

/** Effective stats for combat this tick: the derived stats plus temporary effects (Overdrive). */
export function combatStats(w: World, data: GameData, prof: PerkProfile): CoreStats {
  const st = worldStats(w, data);
  for (const { key, e } of prof.periodic) {
    if (e.action === 'overdrive' && w.tick <= (w.timers[key]?.until ?? -1)) st.attackSpeed = clampValue(st.attackSpeed * e.value);
  }
  return st;
}

/**
 * Advances the world by one tick (1/tickHz s). A dead world, or one waiting for a protocol pick, does not
 * change (beyond the commands).
 * Order: commands → [pick? stop] → periodic effects → waves/spawns → enemies move & attack → death check →
 * spatial hash → core regen & fire → projectiles (hits, procs, bounces).
 * Commands come first, before anything else touches the world, so applying them between two steps is
 * exactly the same as passing them to the next step (RunSession relies on this while paused or picking).
 */
export function step(w: World, data: GameData, commands: readonly Command[], events: SimEvent[]): void {
  if (commands.length > 0) applyCommands(w, data, commands, events);
  if (w.dead || w.phase === 'pick') return;
  w.tick += 1;
  const prof = perkProfile(w, data);
  runPeriodic(w, data, prof, events);
  const st = combatStats(w, data, prof);
  if (w.core.hp > st.health) w.core.hp = st.health;
  advanceWave(w, data, st, prof, events);
  updateEnemies(w, data, st, prof, events);
  if (w.core.hp <= 0) {
    w.core.hp = 0;
    w.dead = true;
    const bonusBits = clampValue(w.bits * (prof.rules.runEndBits - 1));
    w.bits = clampValue(w.bits + bonusBits);
    w.bitsBonus = bonusBits;
    events.push({ type: 'death', wave: w.wave, tick: w.tick, bonusBits });
    return;
  }
  gridFor(data).build(w.enemies);
  updateCore(w, data, st, prof, events);
  updateProjectiles(w, data, st, prof, events);
}

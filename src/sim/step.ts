import { applyCommands, type Command } from './commands';
import { updateCore } from './core';
import type { GameData } from './data';
import { updateEnemies } from './enemies';
import type { SimEvent } from './events';
import { updateProjectiles } from './projectiles';
import { type World, worldStats } from './state';
import { advanceWave } from './waves';

/**
 * Advances the world by one tick (1/tickHz s). A dead world does not change.
 * Order: commands → waves/spawns → enemies move & attack → death check → core regen & fire → projectiles.
 * Commands come first, before anything else touches the world, so applying them between two steps is
 * exactly the same as passing them to the next step (RunSession relies on this while paused).
 */
export function step(w: World, data: GameData, commands: readonly Command[], events: SimEvent[]): void {
  if (commands.length > 0) applyCommands(w, data, commands, events);
  if (w.dead) return;
  w.tick += 1;
  const st = worldStats(w, data);
  if (w.core.hp > st.health) w.core.hp = st.health;
  advanceWave(w, data, st, events);
  updateEnemies(w, data, st, events);
  if (w.core.hp <= 0) {
    w.core.hp = 0;
    w.dead = true;
    events.push({ type: 'death', wave: w.wave, tick: w.tick });
    return;
  }
  updateCore(w, data, st, events);
  updateProjectiles(w, data, st, events);
}

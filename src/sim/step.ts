import type { GameData } from './data';
import { updateEnemies } from './enemies';
import type { SimEvent } from './events';
import type { World } from './state';
import { advanceWave } from './waves';

/** Advances the world by one tick (1/tickHz s). A dead world does not change. */
export function step(w: World, data: GameData, events: SimEvent[]): void {
  if (w.dead) return;
  w.tick += 1;
  advanceWave(w, data, events);
  updateEnemies(w, data, events);
  if (w.core.hp <= 0) {
    w.core.hp = 0;
    w.dead = true;
    events.push({ type: 'death', wave: w.wave, tick: w.tick });
  }
}

// Deterministic replay of a command log (spec §6): used by the golden replay test, tools and debugging.

import type { Command, LoggedCommand } from './commands';
import type { GameData } from './data';
import type { SimEvent } from './events';
import { hashWorld } from './hash';
import { createWorld, type RunOptions, type World } from './state';
import { step } from './step';

export interface ReplayResult {
  world: World;
  /** hashWorld after every `hashEvery` ticks: index i ↔ tick (i + 1)·hashEvery. */
  hashes: string[];
}

/**
 * Rebuilds a run from its options and log: each logged command is passed to the step that starts at its
 * tick. The log must be in tick order. Runs exactly `ticks` steps (a dead world simply stops changing).
 */
export function replay(data: GameData, opts: RunOptions, log: readonly LoggedCommand[], ticks: number, hashEvery = 100): ReplayResult {
  const world = createWorld(data, opts);
  const hashes: string[] = [];
  const events: SimEvent[] = [];
  const batch: Command[] = [];
  let li = 0;
  for (let t = 0; t < ticks; t++) {
    batch.length = 0;
    // Matched on the world tick: after death it stops advancing and late (rejected) commands still apply.
    while (li < log.length && log[li]!.tick <= world.tick) {
      if (log[li]!.tick < world.tick) throw new Error(`replay: log out of order at entry ${li} (tick ${log[li]!.tick} < ${world.tick})`);
      batch.push(log[li++]!.cmd);
    }
    step(world, data, batch, events);
    events.length = 0;
    if ((t + 1) % hashEvery === 0) hashes.push(hashWorld(world));
  }
  return { world, hashes };
}

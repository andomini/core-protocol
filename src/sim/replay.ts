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

/**
 * Replays a finished run to its end (leaderboard verification, spec 2026-10-16-leaderboards): steps until the
 * core is dead and every logged command (post-death ones and a revive included) has been applied. Throws on
 * a log out of tick order, a command whose tick is never reached (stuck at a pick, or past death) or a run
 * longer than `maxTicks`. The result is the World the live session ended with (same hashWorld).
 */
export function replayToEnd(data: GameData, opts: RunOptions, log: readonly LoggedCommand[], maxTicks: number): World {
  const world = createWorld(data, opts);
  const events: SimEvent[] = [];
  const batch: Command[] = [];
  let li = 0;
  for (;;) {
    batch.length = 0;
    while (li < log.length && log[li]!.tick <= world.tick) {
      if (log[li]!.tick < world.tick) throw new Error(`replay: log out of order at entry ${li} (tick ${log[li]!.tick} < ${world.tick})`);
      batch.push(log[li++]!.cmd);
    }
    if (batch.length === 0 && world.dead && li >= log.length) return world;
    const before = world.tick;
    step(world, data, batch, events);
    events.length = 0;
    if (world.tick > maxTicks) throw new Error(`replay: run exceeds ${maxTicks} ticks`);
    if (batch.length === 0 && world.tick === before) {
      // Neither a command nor a tick: dead or waiting at a pick with the next command in the future.
      throw new Error(`replay: stuck at tick ${world.tick} (${world.dead ? 'dead' : world.phase}) with ${log.length - li} commands left`);
    }
  }
}

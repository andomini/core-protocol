// Owns a running World: steps it, routes sim events after every step, and keeps render-only memory
// outside the World — positions at the start of the last tick (for interpolation) and references to
// the enemies that existed before the step (so a `kill` can be drawn where the enemy actually died).
// No Phaser here: unit-tested in Node.

import type { EnemyKind, GameData } from '../sim/data';
import type { SimEvent } from '../sim/events';
import { createWorld, type Enemy, type RunOptions, type World } from '../sim/state';
import { step } from '../sim/step';
import { spawnEnemy } from '../sim/waves';

export interface Vec {
  x: number;
  y: number;
}

export type EventSink = (e: SimEvent) => void;

export class RunSession {
  world: World;
  private readonly prev = new Map<number, Vec>();
  private readonly free: Vec[] = [];
  /** Enemies alive before the current step, by id (references into the previous World arrays). */
  private readonly before = new Map<number, Enemy>();
  private readonly events: SimEvent[] = [];

  constructor(
    readonly data: GameData,
    opts: RunOptions,
  ) {
    this.world = createWorld(data, opts);
  }

  /** Runs up to `ticks` sim ticks (fewer once the core is dead); events go to `onEvent` after each tick. */
  advance(ticks: number, onEvent: EventSink): number {
    let ran = 0;
    for (; ran < ticks && !this.world.dead; ran++) {
      this.capture();
      step(this.world, this.data, this.events);
      this.flush(onEvent);
    }
    return ran;
  }

  /** Position at the start of the last tick; undefined for entities created during it. */
  prevOf(id: number): Vec | undefined {
    return this.prev.get(id);
  }

  /** The enemy as of the end of the last tick, including one removed in that tick (killed). */
  lastKnown(id: number): Enemy | undefined {
    return this.before.get(id) ?? this.world.enemies.find((e) => e.id === id);
  }

  /** Dev/stress: spawns `n` enemies on the spawn ring, spread over the direction table. */
  spawn(kind: EnemyKind, n: number, onEvent: EventSink): void {
    const dirs = this.data.directions;
    const r = this.data.config.spawnRadius;
    for (let i = 0; i < n; i++) {
      const [dx, dy] = dirs[(this.world.nextId * 23 + i * 7) % dirs.length]!;
      spawnEnemy(this.world, this.data, kind, dx * r, dy * r, this.events);
    }
    this.flush(onEvent);
  }

  /** A fresh run; all render memory is dropped (entity ids restart at 1). */
  restart(opts: RunOptions): void {
    this.world = createWorld(this.data, opts);
    this.releasePrev();
    this.before.clear();
    this.events.length = 0;
  }

  private flush(onEvent: EventSink): void {
    for (const e of this.events) onEvent(e);
    this.events.length = 0;
  }

  private releasePrev(): void {
    for (const v of this.prev.values()) this.free.push(v);
    this.prev.clear();
  }

  private capture(): void {
    this.releasePrev();
    this.before.clear();
    const w = this.world;
    for (const e of w.enemies) {
      this.before.set(e.id, e);
      this.keep(e.id, e.x, e.y);
    }
    for (const p of w.projectiles) this.keep(p.id, p.x, p.y);
  }

  private keep(id: number, x: number, y: number): void {
    const v = this.free.pop() ?? { x: 0, y: 0 };
    v.x = x;
    v.y = y;
    this.prev.set(id, v);
  }
}

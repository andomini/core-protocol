// Owns a running World: steps it, routes sim events after every step, and keeps render-only memory
// outside the World — positions at the start of the last tick (for interpolation) and references to
// the enemies that existed before the step (so a `kill` can be drawn where the enemy actually died).
// Player commands are queued here, stamped with the tick they apply on and logged (seed + log = replay).
// No Phaser here: unit-tested in Node.

import { applyCommands, type Command, type LoggedCommand } from '../sim/commands';
import type { EnemyKind, GameData } from '../sim/data';
import type { SimEvent } from '../sim/events';
import { createWorld, type Enemy, type RunOptions, type World, worldStats } from '../sim/state';
import type { CoreStats } from '../sim/stats';
import { step } from '../sim/step';
import { spawnEnemy } from '../sim/waves';

export interface Vec {
  x: number;
  y: number;
}

export type EventSink = (e: SimEvent) => void;

const NO_COMMANDS: readonly Command[] = [];

export class RunSession {
  world: World;
  opts: RunOptions;
  /** Effective stats as of the last step or command (derived; refreshed by this class). */
  stats: CoreStats;
  /** Every command applied this run, stamped with the world tick it was applied at. */
  log: LoggedCommand[] = [];
  private pending: Command[] = [];
  private readonly prev = new Map<number, Vec>();
  private readonly free: Vec[] = [];
  /** Enemies alive before the current step, by id (references into the previous World arrays). */
  private readonly before = new Map<number, Enemy>();
  private readonly events: SimEvent[] = [];

  constructor(
    readonly data: GameData,
    opts: RunOptions,
  ) {
    this.opts = opts;
    this.world = createWorld(data, opts);
    this.stats = worldStats(this.world, data);
  }

  /** Queues a command for the start of the next step. */
  queue(cmd: Command): void {
    this.pending.push(cmd);
  }

  get hasPending(): boolean {
    return this.pending.length > 0;
  }

  /** True while a protocol offer is open (the world does not tick until a pickPerk). */
  get picking(): boolean {
    return this.world.phase === 'pick';
  }

  /**
   * Runs up to `ticks` sim ticks (fewer once the core is dead or a protocol pick is waiting for a
   * command); events go to `onEvent` after each tick.
   */
  advance(ticks: number, onEvent: EventSink): number {
    let ran = 0;
    for (; ran < ticks && !this.world.dead && !(this.picking && this.pending.length === 0); ran++) {
      this.capture();
      step(this.world, this.data, this.takePending(), this.events);
      this.flush(onEvent);
    }
    if (ran > 0) this.stats = worldStats(this.world, this.data);
    return ran;
  }

  /**
   * Applies queued commands now, without stepping (used while paused or after death). Because `step`
   * applies commands before touching anything else, this is identical to passing them to the next step,
   * so the logged tick stays valid for replay.
   */
  applyPendingNow(onEvent: EventSink): void {
    if (this.pending.length === 0) return;
    applyCommands(this.world, this.data, this.takePending(), this.events);
    this.stats = worldStats(this.world, this.data);
    this.flush(onEvent);
  }

  private takePending(): readonly Command[] {
    if (this.pending.length === 0) return NO_COMMANDS;
    const cmds = this.pending;
    this.pending = [];
    for (const cmd of cmds) this.log.push({ tick: this.world.tick, cmd });
    return cmds;
  }

  /** Position at the start of the last tick; undefined for entities created during it. */
  prevOf(id: number): Vec | undefined {
    return this.prev.get(id);
  }

  /** The enemy as of the end of the last tick, including one removed in that tick (killed). */
  lastKnown(id: number): Enemy | undefined {
    return this.before.get(id) ?? this.world.enemies.find((e) => e.id === id);
  }

  /** Dev/stress: spawns `n` enemies on the spawn ring, spread over the direction table
   *  (or starting at direction index `dir`, 0 = +x, 16 = +y). */
  spawn(kind: EnemyKind, n: number, onEvent: EventSink, dir?: number): void {
    const dirs = this.data.directions;
    const r = this.data.config.spawnRadius;
    for (let i = 0; i < n; i++) {
      const at = dir === undefined ? this.world.nextId * 23 + i * 7 : dir + i * 3;
      const [dx, dy] = dirs[((at % dirs.length) + dirs.length) % dirs.length]!;
      spawnEnemy(this.world, this.data, kind, dx * r, dy * r, this.events);
    }
    this.flush(onEvent);
  }

  /** A fresh run; all render memory is dropped (entity ids restart at 1). */
  restart(opts: RunOptions): void {
    this.adopt(createWorld(this.data, opts), opts);
  }

  /** Continues a saved run: `world` comes from a snapshot, `opts` are the options it was created with. */
  adopt(world: World, opts: RunOptions): void {
    this.opts = opts;
    this.world = world;
    this.stats = worldStats(this.world, this.data);
    this.log = [];
    this.pending = [];
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

// Persistence for meta progress and the in-progress run (spec §2.5): two versioned slots over the portal
// key-value store (CrazyGames data module where available, else localStorage).
import type { KeyValue, LoadStatus } from '../portal/storage';
import { SaveSlot } from '../portal/storage';
import type { GameData } from '../sim/data';
import { restore, snapshot } from '../sim/snapshot';
import type { RunOptions, World } from '../sim/state';
import type { MetaData } from './metaData';
import { type RunStats, validateRunStats } from './runStats';
import { defaultMeta, type MetaState, validateMeta } from './state';
import { migrateEconomy } from './workshop';
import { emptyMissions } from './missions';
import type { LoggedCommand } from '../sim/commands';
import type { LoadoutClaim } from './leaderboardRules';

export const META_KEY = 'core-protocol.meta';
export const RUN_KEY = 'core-protocol.run';
/** Largest command log kept in the run save (localStorage holds ~5 MB per origin, shared with the meta save). */
export const MAX_SAVED_LOG_CHARS = 2_500_000;

/** Which leaderboard a run goes to: its tier board, or the daily board of `day`. */
export interface RunBoard {
  kind: 'tier' | 'daily';
  day: string | null;
}

/**
 * Leaderboard side of a run save (v2): the full command log since tick 0 and the loadout claim, so a
 * resumed run still submits a complete replay. null log / claim → the run is unranked.
 */
export interface RunReplayInfo {
  log: LoggedCommand[] | null;
  claim: LoadoutClaim | null;
  board: RunBoard | null;
  /** Build commit the run was started on: a run resumed on another build is unranked (its replay would mix sims). */
  commit: string | null;
  /** The server-issued start (POST /v1/runs/start) the run was played from; null → started offline, unranked. */
  start: RunStartInfo | null;
}

/** A ranked run's start: the signed token, the seed it carries and when the server issued it. */
export interface RunStartInfo {
  token: string;
  seed: number;
  startedAt: number;
}

function validStart(x: unknown): RunStartInfo | null {
  const s = x as Partial<RunStartInfo> | null;
  if (!s || typeof s !== 'object' || typeof s.token !== 'string' || !Number.isInteger(s.seed) || typeof s.startedAt !== 'number') return null;
  return { token: s.token, seed: s.seed as number, startedAt: s.startedAt };
}

interface RunSave extends RunReplayInfo {
  snapshot: string;
  opts: RunOptions;
  savedAt: number;
  stats?: RunStats;
}

export interface SavedRun extends RunReplayInfo {
  world: World;
  opts: RunOptions;
  savedAt: number;
  stats: RunStats;
}

/** Meta slot v1 → v2: daily missions (meta/missions.ts) start empty; the first Home visit picks the day's three. */
export const META_MIGRATIONS = {
  1: (d: unknown) => (d === null || typeof d !== 'object' ? d : { ...(d as object), missions: emptyMissions() }),
};

/** Run slot v1 → v2: saves from before leaderboards carry no log, so they resume unranked. */
export const RUN_MIGRATIONS = {
  1: (d: unknown) => (d === null || typeof d !== 'object' ? d : { ...(d as object), log: null, claim: null, board: null, commit: null }),
};

function validBoard(x: unknown): RunBoard | null {
  const b = x as Partial<RunBoard> | null;
  if (!b || typeof b !== 'object') return null;
  if (b.kind === 'tier') return { kind: 'tier', day: null };
  if (b.kind === 'daily' && typeof b.day === 'string') return { kind: 'daily', day: b.day };
  return null;
}

export class MetaStore {
  meta: MetaState;
  readonly status: LoadStatus;
  /** Bits refunded on load for workshop levels bought at older, higher prices (Home announces it once). */
  refunded = 0;
  /**
   * Called when a save did not reach durable storage (quota full). Returns true if it freed space (main.ts:
   * the leaderboard's offline queue), and the save is retried once.
   */
  onSaveFailed: (() => boolean) | null = null;
  private readonly slot: SaveSlot<MetaState>;
  private readonly runSlot: SaveSlot<RunSave | null>;

  constructor(
    private readonly kv: KeyValue,
    private readonly data: GameData,
    md: MetaData,
    private readonly now: () => number = () => Date.now(),
  ) {
    this.slot = new SaveSlot<MetaState>(kv, { key: META_KEY, version: 2, migrations: META_MIGRATIONS, defaults: defaultMeta, validate: (x) => validateMeta(x, data, md) });
    const r = this.slot.load();
    this.meta = r.data;
    this.status = r.status;
    this.refunded = migrateEconomy(this.meta, md);
    this.runSlot = new SaveSlot<RunSave | null>(kv, {
      key: RUN_KEY,
      version: 2,
      migrations: RUN_MIGRATIONS,
      defaults: () => null,
      validate: (x) => {
        const o = x as Partial<RunSave> | null;
        if (o === null) return null;
        if (typeof o !== 'object' || typeof o.snapshot !== 'string' || typeof o.opts !== 'object' || o.opts === null) throw new Error('run save: bad shape');
        return {
          snapshot: o.snapshot,
          opts: o.opts as RunOptions,
          savedAt: typeof o.savedAt === 'number' ? o.savedAt : 0,
          stats: validateRunStats(o.stats),
          log: Array.isArray(o.log) ? (o.log as LoggedCommand[]) : null,
          claim: o.claim && typeof o.claim === 'object' ? (o.claim as LoadoutClaim) : null,
          board: validBoard(o.board),
          commit: typeof o.commit === 'string' ? o.commit : null,
          // Absent in saves from before server-issued starts: such a run resumes unranked (no version bump).
          start: validStart(o.start),
        };
      },
    });
  }

  /** Persists the meta state, stamping `lastSeen` (offline income counts from here). */
  save(): void {
    this.meta.lastSeen = this.now();
    this.write(this.slot, this.meta);
  }

  /** A save that failed for lack of space is retried once after `onSaveFailed` freed some. */
  private write<T>(slot: SaveSlot<T>, data: T): boolean {
    if (slot.save(data)) return true;
    if (slot.isReadOnly || !this.onSaveFailed?.()) return false;
    return slot.save(data);
  }

  /** Saves the run in progress (never a dead one). Failures are silent: a lost snapshot only costs a Continue. */
  saveRun(w: World, opts: RunOptions, stats?: RunStats, replay: RunReplayInfo = { log: null, claim: null, board: null, commit: null, start: null }): void {
    if (w.dead) return;
    try {
      // A log too big for the store would make every later save fail (stale Continue): drop it (→ unranked).
      const log = replay.log && JSON.stringify(replay.log).length <= MAX_SAVED_LOG_CHARS ? replay.log : null;
      const save: RunSave = { snapshot: snapshot(w), opts, savedAt: this.now(), stats, log, claim: replay.claim, board: replay.board, commit: replay.commit, start: replay.start };
      this.write<RunSave | null>(this.runSlot, save);
    } catch {
      /* a non-finite value: keep the previous snapshot */
    }
  }

  /** The server start token of the saved run (without restoring its world), or null. */
  savedStartToken(): string | null {
    return this.runSlot.load().data?.start?.token ?? null;
  }

  hasRun(): boolean {
    return this.loadRun() !== null;
  }

  /** The saved run, or null. An unreadable snapshot is dropped. */
  loadRun(): SavedRun | null {
    const r = this.runSlot.load();
    if (r.data === null) {
      if (r.status === 'corrupt') this.clearRun();
      return null;
    }
    try {
      const d = r.data;
      return { world: restore(d.snapshot, this.data), opts: d.opts, savedAt: d.savedAt, stats: validateRunStats(d.stats), log: d.log, claim: d.claim, board: d.board, commit: d.commit, start: d.start };
    } catch {
      this.clearRun();
      return null;
    }
  }

  clearRun(): void {
    this.kv.removeItem(RUN_KEY);
  }
}

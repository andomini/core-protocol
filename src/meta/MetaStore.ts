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

export const META_KEY = 'core-protocol.meta';
export const RUN_KEY = 'core-protocol.run';

interface RunSave {
  snapshot: string;
  opts: RunOptions;
  savedAt: number;
  stats?: RunStats;
}

export interface SavedRun {
  world: World;
  opts: RunOptions;
  savedAt: number;
  stats: RunStats;
}

export class MetaStore {
  meta: MetaState;
  readonly status: LoadStatus;
  private readonly slot: SaveSlot<MetaState>;
  private readonly runSlot: SaveSlot<RunSave | null>;

  constructor(
    private readonly kv: KeyValue,
    data: GameData,
    md: MetaData,
    private readonly now: () => number = () => Date.now(),
  ) {
    this.slot = new SaveSlot<MetaState>(kv, { key: META_KEY, version: 1, defaults: defaultMeta, validate: (x) => validateMeta(x, data, md) });
    const r = this.slot.load();
    this.meta = r.data;
    this.status = r.status;
    this.runSlot = new SaveSlot<RunSave | null>(kv, {
      key: RUN_KEY,
      version: 1,
      defaults: () => null,
      validate: (x) => {
        const o = x as Partial<RunSave> | null;
        if (o === null) return null;
        if (typeof o !== 'object' || typeof o.snapshot !== 'string' || typeof o.opts !== 'object' || o.opts === null) throw new Error('run save: bad shape');
        return { snapshot: o.snapshot, opts: o.opts as RunOptions, savedAt: typeof o.savedAt === 'number' ? o.savedAt : 0, stats: validateRunStats(o.stats) };
      },
    });
  }

  /** Persists the meta state, stamping `lastSeen` (offline income counts from here). */
  save(): void {
    this.meta.lastSeen = this.now();
    this.slot.save(this.meta);
  }

  /** Saves the run in progress (never a dead one). Failures are silent: a lost snapshot only costs a Continue. */
  saveRun(w: World, opts: RunOptions, stats?: RunStats): void {
    if (w.dead) return;
    try {
      this.runSlot.save({ snapshot: snapshot(w), opts, savedAt: this.now(), stats });
    } catch {
      /* a non-finite value: keep the previous snapshot */
    }
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
      return { world: restore(r.data.snapshot), opts: r.data.opts, savedAt: r.data.savedAt, stats: validateRunStats(r.data.stats) };
    } catch {
      this.clearRun();
      return null;
    }
  }

  clearRun(): void {
    this.kv.removeItem(RUN_KEY);
  }
}

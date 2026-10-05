// Storage (spec §5 "Save"): a localStorage-shaped key-value store, plus a versioned save slot with
// migrations and a corrupted-data fallback. Never throws: blocked storage (private mode, iframe policy,
// quota) degrades to memory, and a bad blob degrades to defaults with the raw text kept in `<key>.bak`.

/** The localStorage API subset that CrazyGames' data module mirrors. */
export interface KeyValue {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** In-memory store (tests, and the fallback when localStorage is blocked). */
export function memoryKV(init: Record<string, string> = {}): KeyValue & { dump(): Record<string, string> } {
  const m = new Map(Object.entries(init));
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, String(v)),
    removeItem: (k) => void m.delete(k),
    dump: () => Object.fromEntries(m),
  };
}

/**
 * localStorage with every call in try/catch. If a write fails (blocked or full), the value is kept in
 * memory for this session so a later read in the same session still sees it.
 */
export function localKV(): KeyValue {
  const mem = memoryKV();
  const ls = (): Storage | null => {
    try {
      return typeof localStorage === 'undefined' ? null : localStorage;
    } catch {
      return null;
    }
  };
  return {
    getItem(k) {
      const v = mem.getItem(k);
      if (v !== null) return v;
      try {
        return ls()?.getItem(k) ?? null;
      } catch {
        return null;
      }
    },
    setItem(k, v) {
      try {
        const s = ls();
        if (!s) throw new Error('no localStorage');
        s.setItem(k, v);
        mem.removeItem(k);
      } catch {
        mem.setItem(k, v);
      }
    },
    removeItem(k) {
      mem.removeItem(k);
      try {
        ls()?.removeItem(k);
      } catch {
        /* blocked */
      }
    },
  };
}

/** The stored shape: `{v, data}`. */
export interface Envelope<T> {
  v: number;
  data: T;
}

/** `migrations[n]` turns version-n data into version-(n+1) data. */
export type Migrations = Record<number, (data: unknown) => unknown>;

export interface SlotOptions<T> {
  key: string;
  version: number;
  defaults: () => T;
  migrations?: Migrations;
  /**
   * Normalises loaded (and migrated) data into a valid T: fills missing fields, drops junk. Throw to
   * treat the blob as corrupt. Defaults to an identity cast.
   */
  validate?: (data: unknown) => T;
}

/** How a load went. `fresh`: nothing stored. `corrupt` / `future`: defaults, raw blob copied to `<key>.bak`. */
export type LoadStatus = 'fresh' | 'ok' | 'migrated' | 'corrupt' | 'future';

export interface LoadResult<T> {
  data: T;
  status: LoadStatus;
  /** The version the blob was stored with (null for fresh/corrupt). */
  from: number | null;
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

/**
 * One versioned save slot (e.g. M4's meta save, M2.5's run snapshot). Load before save: a slot whose
 * stored version is newer than this build's (an older cached build) refuses to save, so it never
 * overwrites progress made in a newer build.
 */
export class SaveSlot<T> {
  private readOnly = false;
  private readonly migrations: Migrations;
  private readonly validate: (data: unknown) => T;

  constructor(
    private readonly kv: KeyValue,
    private readonly opts: SlotOptions<T>,
  ) {
    if (!Number.isInteger(opts.version) || opts.version < 1) throw new Error(`SaveSlot ${opts.key}: version must be an integer ≥ 1`);
    this.migrations = opts.migrations ?? {};
    // The chain must be unbroken from the oldest supported version up to the current one.
    const keys = Object.keys(this.migrations).map(Number);
    const oldest = keys.length ? Math.min(...keys) : opts.version;
    for (let v = oldest; v < opts.version; v++) {
      if (typeof this.migrations[v] !== 'function') throw new Error(`SaveSlot ${opts.key}: missing migration ${v} → ${v + 1}`);
    }
    this.validate = opts.validate ?? ((d) => d as T);
  }

  get key(): string {
    return this.opts.key;
  }

  /** Whether save() is disabled because the stored blob is from a newer build. */
  get isReadOnly(): boolean {
    return this.readOnly;
  }

  load(): LoadResult<T> {
    const raw = this.kv.getItem(this.opts.key);
    this.readOnly = false;
    if (raw === null || raw === '') return { data: this.opts.defaults(), status: 'fresh', from: null };
    let env: unknown;
    try {
      env = JSON.parse(raw);
    } catch {
      return this.fallback(raw, 'corrupt', null);
    }
    if (!isRecord(env) || !Number.isInteger(env.v) || (env.v as number) < 1 || !('data' in env)) {
      return this.fallback(raw, 'corrupt', null);
    }
    const from = env.v as number;
    if (from > this.opts.version) {
      this.readOnly = true;
      return this.fallback(raw, 'future', from);
    }
    try {
      let data: unknown = env.data;
      for (let v = from; v < this.opts.version; v++) {
        const m = this.migrations[v];
        if (!m) throw new Error(`no migration ${v} → ${v + 1}`);
        data = m(data);
      }
      return { data: this.validate(data), status: from === this.opts.version ? 'ok' : 'migrated', from };
    } catch {
      return this.fallback(raw, 'corrupt', from);
    }
  }

  /** Writes `{v, data}`. Returns false if the slot is read-only (newer stored version) or serialisation failed. */
  save(data: T): boolean {
    if (this.readOnly) return false;
    let json: string;
    try {
      json = JSON.stringify({ v: this.opts.version, data } satisfies Envelope<T>);
    } catch {
      return false;
    }
    this.kv.setItem(this.opts.key, json);
    return true;
  }

  clear(): void {
    this.kv.removeItem(this.opts.key);
    this.readOnly = false;
  }

  private fallback(raw: string, status: 'corrupt' | 'future', from: number | null): LoadResult<T> {
    // Keep the unreadable blob so support (or a later build) can recover it.
    this.kv.setItem(`${this.opts.key}.bak`, raw);
    return { data: this.opts.defaults(), status, from };
  }
}

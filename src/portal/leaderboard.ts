// Online leaderboards client (spec docs/superpowers/specs/2026-10-16-leaderboards-design.md §API).
// Fail-soft by design: every call resolves (never throws) to {ok} or {ok:false, status, error}, each request
// is capped by a timeout, and finished runs go through an offline queue persisted in a SaveSlot, retried on
// an interval, on the browser's `online` event and at the next start. The game never waits on the network.
import type { PortalName, PortalUser } from './Portal';
import { type KeyValue, SaveSlot } from './storage';

export const LB_KEY = 'core-protocol.leaderboard';
export const LB_TIMEOUT_MS = 8000;
export const LB_QUEUE_MAX = 20;
export const LB_RETRY_MS = 60_000;
/** The server's replay cap (characters of the JSON or `gz:` string). */
export const LB_MAX_REPLAY = 1_000_000;
const RECENT_MAX = 30;
const FRIEND_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export type BoardKind = 'tier' | 'daily' | 'weekly';
export type BoardScope = 'global' | 'friends';
export type RunKind = 'tier' | 'daily';

export interface LbIdentity {
  id: string;
  secret: string;
  name: string;
  friendCode: string;
  portal: string;
  /** Linked to a CrazyGames account (name comes from the portal, no rename). */
  linked: boolean;
}

/** POST /v1/runs body. */
export interface RunSubmission {
  kind: RunKind;
  tier: number;
  day: string | null;
  wave: number;
  ticks: number;
  hash: string;
  commit: string;
  /** JSON `{v:1, seed, tier, claim, log}`, or `gz:`+base64 of it. */
  replay: string;
}

export interface BoardEntry {
  rank: number;
  name: string;
  friendCode: string;
  badges: number;
  wave: number;
  at: number;
  status: 'verified' | 'verifying';
  me?: boolean;
}

export interface Board {
  board: string;
  scope: BoardScope;
  total: number;
  entries: BoardEntry[];
  me: { rank: number; wave: number; status: string } | null;
  tier?: number;
  week?: string;
  day?: string;
  endsAt?: number;
}

export interface Friend {
  name: string;
  friendCode: string;
  badges: number;
  since: number;
}

export type LbResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string };

/** What happened to one submitted run, keyed by `hash:ticks`. */
export interface RunOutcome {
  key: string;
  kind: RunKind;
  tier: number;
  day: string | null;
  wave: number;
  state: 'queued' | 'pending' | 'verified' | 'rejected' | 'flagged' | 'dropped';
  id?: number;
  error?: string;
}

interface QueuedRun {
  sub: RunSubmission;
  queuedAt: number;
  tries: number;
}

interface LbSave {
  identity: LbIdentity | null;
  queue: QueuedRun[];
  recent: RunOutcome[];
}

export type LbHealth = 'unknown' | 'ok' | 'offline' | 'unavailable';

export interface LeaderboardOptions {
  /** API origin (without /v1). Empty → the feature is off and every call answers `disabled`. */
  base: string;
  kv: KeyValue;
  portal: PortalName;
  /** The portal account, if any (CrazyGames): links the player and names it. */
  portalUser?: () => Promise<PortalUser | null>;
  fetch?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
}

const runKey = (s: { hash: string; ticks: number }) => `${s.hash}:${s.ticks}`;

/** Ranked runs need a clean build of a commit (the server replays that commit's sim). */
export function rankedBuild(commit: string): boolean {
  return /^[0-9a-f]{40}$/.test(commit);
}

/** Client mirror of the server's name rule; returns an error message or null. */
export function nameError(raw: string): string | null {
  const n = raw.trim().replace(/\s+/g, ' ');
  if (n.length < 3 || n.length > 20) return '3–20 characters';
  if (!/^[A-Za-z0-9][A-Za-z0-9 _.-]*[A-Za-z0-9]$/.test(n)) return 'letters, digits, space _ . - only';
  return null;
}

/** Friend code as typed (any case, dashes, spaces) → canonical 6 chars, or null. */
export function normalizeFriendCode(raw: string): string | null {
  const c = raw.toUpperCase().replace(/[\s-]/g, '');
  if (c.length !== 6) return null;
  for (const ch of c) if (!FRIEND_ALPHABET.includes(ch)) return null;
  return c;
}

/** `gz:` + base64(gzip(text)) where CompressionStream exists, else the text itself. */
export async function compressReplay(text: string): Promise<string> {
  const CS = (globalThis as { CompressionStream?: typeof CompressionStream }).CompressionStream;
  if (!CS || text.startsWith('gz:')) return text;
  try {
    const stream = new Blob([text]).stream().pipeThrough(new CS('gzip'));
    const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return `gz:${btoa(bin)}`;
  } catch {
    return text;
  }
}

function validateSave(x: unknown): LbSave {
  const o = (x ?? {}) as Partial<LbSave>;
  const id = o.identity as Partial<LbIdentity> | null | undefined;
  const identity =
    id && typeof id.id === 'string' && typeof id.secret === 'string'
      ? { id: id.id, secret: id.secret, name: String(id.name ?? ''), friendCode: String(id.friendCode ?? ''), portal: String(id.portal ?? 'local'), linked: !!id.linked }
      : null;
  const queue = Array.isArray(o.queue) ? o.queue.filter((q): q is QueuedRun => !!q && typeof q === 'object' && !!(q as QueuedRun).sub && typeof (q as QueuedRun).sub.replay === 'string') : [];
  const recent = Array.isArray(o.recent) ? o.recent.filter((r): r is RunOutcome => !!r && typeof (r as RunOutcome).key === 'string') : [];
  return { identity, queue: queue.slice(-LB_QUEUE_MAX), recent: recent.slice(-RECENT_MAX) };
}

export class Leaderboard {
  readonly enabled: boolean;
  health: LbHealth = 'unknown';
  private readonly base: string;
  private readonly slot: SaveSlot<LbSave>;
  private state: LbSave = { identity: null, queue: [], recent: [] };
  private readonly fetchFn: typeof fetch;
  private readonly now: () => number;
  private readonly timeoutMs: number;
  private registering: Promise<LbIdentity | null> | null = null;
  private flushing: Promise<void> | null = null;
  private portalChecked = false;
  private loaded = false;
  private listeners: (() => void)[] = [];

  constructor(private readonly opts: LeaderboardOptions) {
    this.base = opts.base.replace(/\/+$/, '');
    this.enabled = this.base !== '';
    this.fetchFn = opts.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
    this.now = opts.now ?? (() => Date.now());
    this.timeoutMs = opts.timeoutMs ?? LB_TIMEOUT_MS;
    this.slot = new SaveSlot<LbSave>(opts.kv, { key: LB_KEY, version: 1, defaults: () => ({ identity: null, queue: [], recent: [] }), validate: validateSave });
  }

  /** Loads the saved identity + queue (after portal init: the CrazyGames data module may hold them). */
  load(): void {
    if (this.loaded) return;
    this.loaded = true;
    this.state = this.slot.load().data;
  }

  /** Loads, registers in the background, flushes the queue, and retries it on a timer / when back online. */
  start(): void {
    this.load();
    if (!this.enabled) return;
    void this.ensurePlayer().then(() => this.flush());
    setInterval(() => {
      if (this.state.queue.length > 0) void this.flush();
    }, LB_RETRY_MS);
    if (typeof window !== 'undefined') window.addEventListener('online', () => void this.flush());
  }

  /** Called whenever identity, queue or outcomes change (open panels re-render). */
  onChange(cb: () => void): () => void {
    this.listeners.push(cb);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== cb);
    };
  }

  get identity(): LbIdentity | null {
    return this.state.identity;
  }

  /** Runs waiting to be uploaded (offline / server busy). */
  get queued(): readonly RunSubmission[] {
    return this.state.queue.map((q) => q.sub);
  }

  outcome(key: string): RunOutcome | null {
    return this.state.recent.find((r) => r.key === key) ?? null;
  }

  /** My runs the server has not verified yet, or that never left this device. */
  unverified(): RunOutcome[] {
    return this.state.recent.filter((r) => r.state === 'queued' || r.state === 'pending');
  }

  // ------------------------------------------------------------------ transport

  private async request<T>(method: string, path: string, body?: unknown, auth = false): Promise<LbResult<T>> {
    if (!this.enabled) return { ok: false, status: 0, error: 'disabled' };
    const headers: Record<string, string> = {};
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (auth) {
      const id = this.state.identity;
      if (!id) return { ok: false, status: 401, error: 'auth' };
      headers.authorization = `Bearer ${id.id}.${id.secret}`;
    }
    const ac = typeof AbortController === 'function' ? new AbortController() : null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<never>((_, rej) => {
        timer = setTimeout(() => {
          ac?.abort();
          rej(new Error('timeout'));
        }, this.timeoutMs);
      });
      const res = await Promise.race([
        this.fetchFn(`${this.base}/v1${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: ac?.signal }),
        timeout,
      ]);
      let data: unknown = null;
      try {
        data = await Promise.race([res.json(), timeout]);
      } catch {
        data = null;
      }
      if (res.status >= 500) {
        this.health = 'unavailable';
        return { ok: false, status: res.status, error: 'unavailable' };
      }
      this.health = 'ok';
      if (!res.ok) {
        const err = data && typeof data === 'object' && typeof (data as { error?: unknown }).error === 'string' ? (data as { error: string }).error : `http-${res.status}`;
        return { ok: false, status: res.status, error: err };
      }
      return { ok: true, data: data as T };
    } catch {
      this.health = 'offline';
      return { ok: false, status: 0, error: 'offline' };
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  /** An authenticated call; a rejected credential (deleted player, lost secret) re-registers once. */
  private async authed<T>(method: string, path: string, body?: unknown): Promise<LbResult<T>> {
    if (!this.enabled) return { ok: false, status: 0, error: 'disabled' };
    if (!(await this.ensurePlayer())) return { ok: false, status: this.health === 'ok' ? 401 : 0, error: this.health === 'ok' ? 'auth' : 'offline' };
    const r = await this.request<T>(method, path, body, true);
    if (r.ok || r.status !== 401) return r;
    this.state.identity = null;
    this.persist();
    if (!(await this.ensurePlayer())) return r;
    return this.request<T>(method, path, body, true);
  }

  private persist(): void {
    this.slot.save(this.state);
    for (const l of this.listeners) l();
  }

  private async portalAccount(): Promise<PortalUser | null> {
    if (this.portalChecked || !this.opts.portalUser) return null;
    this.portalChecked = true;
    try {
      return await Promise.race([this.opts.portalUser(), new Promise<null>((r) => setTimeout(() => r(null), this.timeoutMs))]);
    } catch {
      return null;
    }
  }

  // ------------------------------------------------------------------ players

  /** The player, registering on first use (and linking a CrazyGames account once one is signed in). */
  ensurePlayer(): Promise<LbIdentity | null> {
    if (!this.enabled) return Promise.resolve(null);
    this.load();
    if (this.registering) return this.registering;
    const cur = this.state.identity;
    if (cur && (cur.linked || this.portalChecked || !this.opts.portalUser)) return Promise.resolve(cur);
    this.registering = (async () => {
      const user = cur?.linked ? null : await this.portalAccount();
      if (cur && !user) return cur;
      const body: Record<string, unknown> = { portal: this.opts.portal };
      if (user) body.cgToken = user.token;
      const r = await this.request<LbIdentity>('POST', '/players', body);
      if (!r.ok) return this.state.identity;
      const d = r.data;
      this.state.identity = { id: d.id, secret: d.secret, name: d.name, friendCode: d.friendCode, portal: d.portal, linked: !!d.linked };
      this.persist();
      return this.state.identity;
    })().finally(() => {
      this.registering = null;
    });
    return this.registering;
  }

  me(): Promise<LbResult<LbIdentity & { verifiedBits: number; canRename: boolean; badges: number }>> {
    return this.authed('GET', '/players/me');
  }

  async rename(name: string): Promise<LbResult<{ name: string }>> {
    const bad = nameError(name);
    if (bad) return { ok: false, status: 400, error: bad };
    const r = await this.authed<{ name: string }>('PATCH', '/players/me', { name: name.trim().replace(/\s+/g, ' ') });
    if (r.ok && this.state.identity) {
      this.state.identity.name = r.data.name;
      this.persist();
    }
    return r;
  }

  /** Deletes the online profile and every run (server side), then forgets the local identity and queue. */
  async deleteMe(): Promise<LbResult<{ deleted: boolean }>> {
    const r = this.state.identity ? await this.request<{ deleted: boolean }>('DELETE', '/players/me', undefined, true) : ({ ok: true, data: { deleted: true } } as const);
    if (r.ok || r.status === 401) {
      this.state = { identity: null, queue: [], recent: [] };
      this.portalChecked = true; // no silent re-link in this session
      this.persist();
      return { ok: true, data: { deleted: true } };
    }
    return r;
  }

  // ------------------------------------------------------------------ friends

  friends(): Promise<LbResult<{ code: string; following: Friend[] }>> {
    return this.authed('GET', '/friends');
  }

  addFriend(raw: string): Promise<LbResult<{ friend: Friend }>> {
    const code = normalizeFriendCode(raw);
    if (!code) return Promise.resolve({ ok: false, status: 400, error: 'bad-code' });
    if (code === this.state.identity?.friendCode) return Promise.resolve({ ok: false, status: 400, error: 'self' });
    return this.authed('POST', '/friends', { code });
  }

  removeFriend(code: string): Promise<LbResult<unknown>> {
    return this.authed('DELETE', `/friends/${encodeURIComponent(code)}`);
  }

  // ------------------------------------------------------------------ boards

  /** `arg` is the tier for tier/weekly boards, the day (or null = today) for the daily board. */
  board(kind: BoardKind, arg: number | string | null, scope: BoardScope = 'global', limit = 50): Promise<LbResult<Board>> {
    const path = kind === 'daily' ? `/boards/daily${arg ? `/${arg}` : ''}` : `/boards/${kind}/${Number(arg) || 1}`;
    const q = `?scope=${scope}&limit=${Math.max(1, Math.min(100, limit))}`;
    // Authenticated when we have an identity (the server then pins `me`); public otherwise.
    return this.state.identity ? this.authed<Board>('GET', path + q) : this.request<Board>('GET', path + q);
  }

  daily(): Promise<LbResult<{ day: string; dayIndex: number; seed: number; endsAt: number; week: string; weekEndsAt: number }>> {
    return this.request('GET', '/daily');
  }

  // ------------------------------------------------------------------ runs

  /**
   * Queues a finished run and tries to upload it now. Resolves with its outcome (queued while offline);
   * the queue survives reloads, so an offline run is submitted later.
   */
  async submit(sub: RunSubmission): Promise<RunOutcome> {
    this.load();
    const key = runKey(sub);
    const base: RunOutcome = { key, kind: sub.kind, tier: sub.tier, day: sub.day, wave: sub.wave, state: 'queued' };
    if (!this.enabled) return { ...base, state: 'dropped', error: 'disabled' };
    if (!this.state.queue.some((q) => runKey(q.sub) === key)) {
      this.state.queue.push({ sub, queuedAt: this.now(), tries: 0 });
      while (this.state.queue.length > LB_QUEUE_MAX) this.state.queue.shift();
    }
    this.record(base);
    this.persist();
    // Compress before upload (and so the persisted queue stays small).
    const z = await compressReplay(sub.replay);
    const q = this.state.queue.find((x) => runKey(x.sub) === key);
    if (q && z !== q.sub.replay) {
      q.sub = { ...q.sub, replay: z };
      this.persist();
    }
    await this.flush();
    return this.outcome(key) ?? base;
  }

  /** Uploads queued runs in order; stops at the first transient failure (offline, 5xx, 429). */
  flush(): Promise<void> {
    if (!this.enabled) return Promise.resolve();
    if (this.flushing) return this.flushing;
    this.flushing = (async () => {
      this.load();
      while (this.state.queue.length > 0) {
        const q = this.state.queue[0]!;
        const key = runKey(q.sub);
        const prev = this.outcome(key);
        const base: RunOutcome = prev ?? { key, kind: q.sub.kind, tier: q.sub.tier, day: q.sub.day, wave: q.sub.wave, state: 'queued' };
        if (q.sub.replay.length > LB_MAX_REPLAY) {
          this.state.queue.shift();
          this.record({ ...base, state: 'dropped', error: 'too-large' });
          this.persist();
          continue;
        }
        const r = await this.authed<{ id: number; status: string }>('POST', '/runs', q.sub);
        if (r.ok) {
          this.state.queue.shift();
          const st = r.data.status === 'verified' || r.data.status === 'rejected' || r.data.status === 'flagged' ? r.data.status : 'pending';
          this.record({ ...base, state: st, id: r.data.id });
          this.persist();
          continue;
        }
        if (r.status === 0 || r.status >= 500 || r.status === 429 || r.status === 401) {
          q.tries += 1;
          this.persist();
          return;
        }
        // A permanent refusal (bad day, unranked build, banned…): retrying cannot help.
        this.state.queue.shift();
        this.record({ ...base, state: 'dropped', error: r.error });
        this.persist();
      }
    })().finally(() => {
      this.flushing = null;
    });
    return this.flushing;
  }

  /** My rank on the board a run went to (tier board, or the day's board), or null. */
  async rankFor(kind: RunKind, tier: number, day: string | null): Promise<{ rank: number; total: number; status: string } | null> {
    const r = await this.board(kind === 'daily' ? 'daily' : 'tier', kind === 'daily' ? day : tier, 'global', 1);
    if (!r.ok || !r.data.me) return null;
    return { rank: r.data.me.rank, total: r.data.total, status: r.data.me.status };
  }

  private record(o: RunOutcome): void {
    const i = this.state.recent.findIndex((r) => r.key === o.key);
    if (i >= 0) this.state.recent.splice(i, 1);
    this.state.recent.push(o);
    while (this.state.recent.length > RECENT_MAX) this.state.recent.shift();
  }
}

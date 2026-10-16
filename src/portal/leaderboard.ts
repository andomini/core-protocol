// Online leaderboards client (spec docs/superpowers/specs/2026-10-16-leaderboards-design.md §API).
// Fail-soft by design: every call resolves (never throws) to {ok} or {ok:false, status, error}, each request
// is capped by a timeout, and finished runs go through an offline queue persisted in a SaveSlot, retried on
// an interval, on the browser's `online` event and at the next start. The game never waits on the network.
// Registration is lazy (first RANKS open or first queued run), so players who never touch leaderboards cost
// the server nothing.
import { dailySeed, dayIndex, dayKey } from '../meta/leaderboardRules';
import type { PortalName, PortalUser } from './Portal';
import { type KeyValue, SaveSlot } from './storage';

export const LB_KEY = 'core-protocol.leaderboard';
export const LB_TIMEOUT_MS = 8000;
export const LB_QUEUE_MAX = 20;
export const LB_RETRY_MS = 60_000;
/** A queued run is given up after this many failed uploads (offline attempts do not count) or this age. */
export const LB_MAX_TRIES = 30;
export const LB_MAX_AGE_MS = 7 * 86_400_000;
/** After this many failed uploads in a row a run goes to the back of the queue, so it cannot block the others. */
export const LB_ROTATE_AFTER = 3;
/** Replay characters the persisted queue may hold (localStorage is ~5 MB per origin, shared with the saves). */
export const LB_QUEUE_CHARS = 1_500_000;
/** Upload timeout: the base timeout plus 1 s per 50 KB of replay (slow mobile uplinks). */
export const uploadTimeoutMs = (base: number, chars: number): number => base + 1000 * Math.ceil(chars / 50_000);
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

/** A daily challenge to play: by the server's day and seed when online, else the device's (then unranked). */
export interface DailyChallenge {
  day: string;
  seed: number;
  /** Epoch ms (server clock) when the day ends. */
  endsAt: number;
  /** From the server: only these can be ranked (the seed may be secret, the device clock may be off). */
  online: boolean;
}

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
  /** Registration back-off after a refused attempt (rate limit, server error). */
  private regFails = 0;
  private regRetryAt = 0;
  /** Server clock − device clock (ms), from the last GET /daily. */
  private clockOffset = 0;
  private dailyCache: DailyChallenge | null = null;
  private flushing: Promise<void> | null = null;
  private portalChecked = false;
  /** Set by deleteMe: no portal (re-)linking for the rest of the session. */
  private portalOff = false;
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

  /** Loads, flushes a queue left from earlier sessions, and retries it on a timer / when back online. */
  start(): void {
    this.load();
    if (!this.enabled) return;
    if (this.state.queue.length > 0) void this.flush();
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

  private async request<T>(method: string, path: string, body?: unknown, auth = false, timeoutMs = this.timeoutMs): Promise<LbResult<T>> {
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
    let timedOut = false;
    try {
      const timeout = new Promise<never>((_, rej) => {
        timer = setTimeout(() => {
          timedOut = true;
          ac?.abort();
          rej(new Error('timeout'));
        }, timeoutMs);
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
      const code = data && typeof data === 'object' && typeof (data as { error?: unknown }).error === 'string' ? (data as { error: string }).error : null;
      if (res.status >= 500) {
        this.health = 'unavailable';
        return { ok: false, status: res.status, error: res.status === 503 && code ? code : 'unavailable' };
      }
      this.health = 'ok';
      if (!res.ok) return { ok: false, status: res.status, error: code ?? `http-${res.status}` };
      return { ok: true, data: data as T };
    } catch {
      // A timeout is not "offline": a large upload on a slow link is retried, counted, and eventually rotated.
      this.health = 'offline';
      return { ok: false, status: 0, error: timedOut ? 'timeout' : 'offline' };
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  /**
   * An authenticated call; a rejected credential (deleted player, lost secret) re-registers once. The old
   * identity is kept (and stays saved) until a new one exists, so an outage never logs the player out.
   */
  private async authed<T>(method: string, path: string, body?: unknown, timeoutMs?: number): Promise<LbResult<T>> {
    if (!this.enabled) return { ok: false, status: 0, error: 'disabled' };
    if (!(await this.ensurePlayer())) return { ok: false, status: this.health === 'ok' ? 401 : 0, error: this.health === 'ok' ? 'auth' : 'offline' };
    const r = await this.request<T>(method, path, body, true, timeoutMs);
    if (r.ok || r.status !== 401) return r;
    if (!(await this.register('replace'))) return r;
    return this.request<T>(method, path, body, true, timeoutMs);
  }

  /**
   * Saves identity + queue + outcomes. When storage is full, queued runs are dropped (oldest first) until the
   * save fits: losing an upload beats losing the identity, and the queue must never crowd out the game save.
   */
  private persist(): void {
    while (!this.slot.save(this.state) && !this.slot.isReadOnly && this.state.queue.length > 0) {
      const q = this.state.queue.shift()!;
      this.record({ ...this.baseOutcome(q.sub), state: 'dropped', error: 'storage' });
    }
    for (const l of this.listeners) l();
  }

  /** Storage is full (the game save failed): drops the offline queue. Returns whether anything was freed. */
  freeSpace(): boolean {
    if (this.state.queue.length === 0) return false;
    for (const q of this.state.queue.splice(0)) this.record({ ...this.baseOutcome(q.sub), state: 'dropped', error: 'storage' });
    this.persist();
    return true;
  }

  private baseOutcome(sub: RunSubmission): RunOutcome {
    return this.outcome(runKey(sub)) ?? { key: runKey(sub), kind: sub.kind, tier: sub.tier, day: sub.day, wave: sub.wave, state: 'queued' };
  }

  /** Drops the oldest queued runs beyond LB_QUEUE_MAX runs or LB_QUEUE_CHARS characters (the newest is kept). */
  private trimQueue(): void {
    const q = this.state.queue;
    let chars = q.reduce((n, x) => n + x.sub.replay.length, 0);
    while (q.length > 1 && (q.length > LB_QUEUE_MAX || chars > LB_QUEUE_CHARS)) {
      const old = q.shift()!;
      chars -= old.sub.replay.length;
      this.record({ ...this.baseOutcome(old.sub), state: 'dropped', error: 'queue-full' });
    }
  }

  private async portalAccount(): Promise<PortalUser | null> {
    if (!this.opts.portalUser) return null;
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
    return this.register(cur ? 'link' : 'new');
  }

  /**
   * POST /players. 'new': no identity yet. 'link': try to link the anonymous identity to the signed-in portal
   * account (once per session). 'replace': the saved credential was refused; the identity is swapped only
   * when the new one exists. A refused CrazyGames link (linking off, stale token) falls back to an anonymous
   * player. After a rate limit / server error, attempts back off (5 s doubling, up to 30 min).
   */
  private register(mode: 'new' | 'link' | 'replace'): Promise<LbIdentity | null> {
    if (this.registering) return this.registering;
    const cur = this.state.identity;
    const fallback = mode === 'link' ? cur : null;
    if (this.now() < this.regRetryAt) return Promise.resolve(fallback);
    this.registering = (async () => {
      let user: PortalUser | null = null;
      if (mode === 'replace') user = cur?.linked && !this.portalOff ? await this.portalAccount() : null;
      else if (!this.portalChecked && !this.portalOff) {
        this.portalChecked = true;
        user = await this.portalAccount();
      }
      if (mode === 'link' && !user) return cur;
      const portal = { portal: this.opts.portal };
      let r = await this.request<LbIdentity>('POST', '/players', user ? { ...portal, cgToken: user.token } : portal);
      if (!r.ok && user && mode !== 'link' && (r.error === 'cg-disabled' || (r.status >= 400 && r.status < 500 && r.status !== 429))) {
        r = await this.request<LbIdentity>('POST', '/players', portal);
      }
      if (!r.ok) {
        if (r.status === 429 || r.status >= 500) {
          this.regFails += 1;
          this.regRetryAt = this.now() + Math.min(30 * 60_000, 5000 * 2 ** Math.min(this.regFails - 1, 10));
        }
        return fallback;
      }
      this.regFails = 0;
      this.regRetryAt = 0;
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
      this.portalOff = true;
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

  daily(): Promise<LbResult<{ day: string; dayIndex: number; seed: number; endsAt: number; week: string; weekEndsAt: number; now?: number }>> {
    return this.request('GET', '/daily');
  }

  /** Device time corrected by the server clock (known after a GET /daily). */
  serverNow(): number {
    return this.now() + this.clockOffset;
  }

  /**
   * Today's challenge by the server's day and seed (cached until the day ends). Offline or disabled: the
   * device's day with the public seed, marked offline (such a run is not ranked).
   */
  async dailyChallenge(): Promise<DailyChallenge> {
    const c = this.dailyCache;
    if (c && this.serverNow() < c.endsAt) return c;
    const r = await this.daily();
    if (r.ok && typeof r.data.day === 'string' && Number.isInteger(r.data.seed)) {
      if (typeof r.data.now === 'number') this.clockOffset = r.data.now - this.now();
      this.dailyCache = { day: r.data.day, seed: r.data.seed, endsAt: r.data.endsAt, online: true };
      return this.dailyCache;
    }
    const day = dayKey(this.now());
    return { day, seed: dailySeed(day), endsAt: (dayIndex(day) + 1) * 86_400_000, online: false };
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
    // Compressed before it is first persisted: an uncompressed log could overflow localStorage.
    const replay = await compressReplay(sub.replay);
    if (!this.state.queue.some((q) => runKey(q.sub) === key)) {
      this.state.queue.push({ sub: { ...sub, replay }, queuedAt: this.now(), tries: 0 });
    }
    this.record(base);
    this.trimQueue();
    this.persist();
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
        const r = await this.authed<{ id: number; status: string }>('POST', '/runs', q.sub, uploadTimeoutMs(this.timeoutMs, q.sub.replay.length));
        if (r.ok) {
          this.state.queue.shift();
          const st = r.data.status === 'verified' || r.data.status === 'rejected' || r.data.status === 'flagged' ? r.data.status : 'pending';
          this.record({ ...base, state: st, id: r.data.id });
          this.persist();
          continue;
        }
        if (r.status === 0 || r.status >= 500 || r.status === 429 || r.status === 401) {
          // Offline is nobody's fault; a timeout or a server refusal counts against this run.
          if (r.error !== 'offline') q.tries += 1;
          if (q.tries >= LB_MAX_TRIES || this.now() - q.queuedAt > LB_MAX_AGE_MS) {
            this.state.queue.shift();
            this.record({ ...base, state: 'dropped', error: `gave up: ${r.error}` });
            this.persist();
            continue;
          }
          // A run that keeps failing (too big for this link…) goes to the back: the others still upload.
          if (q.tries > 0 && q.tries % LB_ROTATE_AFTER === 0 && this.state.queue.length > 1) this.state.queue.push(this.state.queue.shift()!);
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

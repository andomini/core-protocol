/**
 * Leaderboard verifier: runs on the owner's PC (systemd user timer, see README.md).
 *
 * 1. GET  /v1/admin/pending          → runs waiting for a verdict (no replay bodies)
 * 2. GET  /v1/admin/replay/:id       → the replay string (text)
 * 3. replay it with the game's own sim AT THE RUN'S BUILD COMMIT: a git worktree per commit in
 *    CACHE (git-ignored), node_modules symlinked from the repo, and the entry
 *    `tools/leaderboard/verifyEntry.ts` of that commit run as a child process (stdin VerifyInput,
 *    stdout VerifyOutput). A commit without that file predates ranked play → rejected.
 * 4. POST /v1/admin/verdict          → verified | rejected | flagged (+ earnedBits, loadoutBits)
 * 5. POST /v1/admin/close-week       → for the last few finished weeks (idempotent server side).
 *
 * Transient problems (commit not fetched yet, API errors) leave the run pending; a run still stuck after
 * STALE_HOURS is rejected so it does not block the weekly close forever. A run whose entry crashes or times
 * out (a hostile replay: memory, CPU) gets a strike in CACHE/strikes.json and is rejected at MAX_STRIKES.
 * Pending runs are paged with a cursor, so skipped runs never starve the ones behind them.
 *
 * Usage: tsx server/verifier/verify.ts [--once-id <runId>] [--dry-run]
 * Env (see verifier.env.example): LB_URL, ADMIN_TOKEN, REPO, CACHE, BATCH, MAX_RUNS, TIMEOUT_MS,
 * STALE_HOURS, MAX_STRIKES, KEEP_WORKTREES, ENTRY_MEMORY_MB.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { minElapsedMs } from '../src/runs';

export interface PendingRun {
  id: number;
  playerId: string;
  kind: 'tier' | 'daily';
  tier: number;
  day: string | null;
  week: string;
  wave: number;
  ticks: number;
  hash: string;
  commit: string;
  createdAt: number;
  verifiedBits: number;
  /** The seed issued with the run's start token (daily: the day's seed, which may be secret). Absent on legacy rows. */
  seed?: number;
  /** When the server issued the run's start token (ms). Absent on legacy rows. */
  startedAt?: number | null;
}

/** What the commit's `tools/leaderboard/verifyEntry.ts` prints (entry contract v1). */
export interface EntryOutput {
  entry: number;
  status: 'verified' | 'rejected' | 'flagged';
  reason?: string;
  earnedBits: number;
  loadoutBits: number;
}

export interface Verdict {
  id: number;
  status: 'verified' | 'rejected' | 'flagged';
  reason?: string;
  earnedBits?: number;
  loadoutBits?: number;
}

/** A run that could not be checked this time (it stays pending). */
export class Transient extends Error {}

/** The entry crashed or timed out on this run: may be the replay's fault, so it counts as a strike. */
export class Fault extends Transient {}

export interface Deps {
  now(): number;
  /** Pending runs with id > `after`, oldest first. */
  pending(limit: number, after: number): Promise<PendingRun[]>;
  replay(id: number): Promise<string>;
  /** Runs the entry of `commit`; throws Transient when it could not run, returns null when the build has no entry. */
  check(commit: string, input: object): Promise<EntryOutput | null>;
  verdict(v: Verdict): Promise<void>;
  closeWeek(week: string): Promise<string>;
  /** Adds a strike to run `id` and returns its total (persisted across passes). */
  strike(id: number): number;
  log(msg: string): void;
}

export interface Options {
  batch: number;
  maxRuns: number;
  staleMs: number;
  /** Entry crashes/timeouts after which a run is rejected. */
  maxStrikes: number;
}

const DAY_MS = 86_400_000;

/** Monday (UTC) of the week containing `ms`, as YYYY-MM-DD; same rule as the Worker and the game. */
export function weekKey(ms: number): string {
  const d = Math.floor(ms / DAY_MS);
  return new Date((d - ((d + 3) % 7)) * DAY_MS).toISOString().slice(0, 10);
}

/** The last `n` finished weeks, oldest first. */
export function finishedWeeks(now: number, n: number): string[] {
  const cur = Date.parse(`${weekKey(now)}T00:00:00Z`);
  const out: string[] = [];
  for (let i = n; i >= 1; i--) out.push(weekKey(cur - i * 7 * DAY_MS));
  return out;
}

/** Largest decompressed replay read here (same cap as the entry's MAX_REPLAY_TEXT). */
const MAX_REPLAY_TEXT = 16_000_000;

/** The `seed` field of a stored replay (JSON, or "gz:" + base64(gzip(JSON))); null when it cannot be read. */
export function replaySeed(s: string): number | null {
  try {
    const text = s.startsWith('gz:') ? gunzipSync(Buffer.from(s.slice(3), 'base64'), { maxOutputLength: MAX_REPLAY_TEXT }).toString('utf8') : s;
    if (text.length > MAX_REPLAY_TEXT) return null;
    const p = JSON.parse(text) as { seed?: unknown };
    return typeof p === 'object' && p !== null && typeof p.seed === 'number' ? p.seed : null;
  } catch {
    return null;
  }
}

/**
 * Checks that need only the server's start record, made here rather than in the build's entry so they also
 * hold for builds whose entry predates them: the replay must use the issued seed, and the run must have
 * taken at least the real time its ticks need at the fastest game speed.
 */
export function startError(run: PendingRun, replay: string): string | null {
  if (run.seed === undefined || run.startedAt === undefined || run.startedAt === null) return 'no server start';
  if (replaySeed(replay) !== run.seed) return 'seed: not the issued one';
  if (run.createdAt - run.startedAt < minElapsedMs(run.ticks)) return 'too fast';
  return null;
}

/** One verifier pass. Returns counts per outcome. */
export async function verifyPending(deps: Deps, opt: Options): Promise<Record<string, number>> {
  const counts: Record<string, number> = { verified: 0, rejected: 0, flagged: 0, skipped: 0, errors: 0 };
  // Bits credited earlier in this pass: the pending list carries each player's total as of the fetch.
  const credited = new Map<string, number>();
  let after = 0;
  let done = 0;
  while (done < opt.maxRuns) {
    const runs = await deps.pending(Math.min(50, opt.batch), after);
    if (runs.length === 0) break;
    for (const run of runs) {
      after = Math.max(after, run.id);
      if (done >= opt.maxRuns) break;
      done++;
      let v: Verdict;
      try {
        const replay = await deps.replay(run.id);
        const verifiedBits = run.verifiedBits + (credited.get(run.playerId) ?? 0);
        const bad = startError(run, replay);
        const out = bad !== null ? { entry: 1, status: 'rejected' as const, reason: bad, earnedBits: 0, loadoutBits: 0 } : await deps.check(run.commit, {
          kind: run.kind,
          tier: run.tier,
          day: run.day,
          ...(run.seed === undefined ? {} : { seed: run.seed }),
          wave: run.wave,
          ticks: run.ticks,
          hash: run.hash,
          replay,
          verifiedBits,
        });
        if (out === null) {
          v = { id: run.id, status: 'rejected', reason: `build ${run.commit.slice(0, 10)} has no verifier entry` };
        } else {
          // Daily runs use a fixed loadout: their Bits do not raise the player's loadout allowance. A flagged run
          // keeps its Bits on the server, credited only if the owner overturns it to verified.
          const earned = out.status !== 'rejected' && run.kind === 'tier' ? out.earnedBits : 0;
          v = { id: run.id, status: out.status, earnedBits: earned, loadoutBits: out.loadoutBits, ...(out.reason ? { reason: out.reason } : {}) };
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (e instanceof Fault && deps.strike(run.id) >= opt.maxStrikes) {
          v = { id: run.id, status: 'rejected', reason: `unverifiable: ${msg}`.slice(0, 300) };
        } else if (deps.now() - run.createdAt > opt.staleMs) {
          v = { id: run.id, status: 'rejected', reason: `unverifiable: ${msg}`.slice(0, 300) };
        } else {
          deps.log(`run ${run.id}: skipped (${msg})`);
          counts.skipped!++;
          continue;
        }
      }
      try {
        await deps.verdict(v);
      } catch (e) {
        // The run stays pending and is retried next pass; carry on with the others.
        deps.log(`run ${run.id}: verdict not posted (${e instanceof Error ? e.message : String(e)})`);
        counts.errors!++;
        continue;
      }
      if (v.status === 'verified' && (v.earnedBits ?? 0) > 0) credited.set(run.playerId, (credited.get(run.playerId) ?? 0) + v.earnedBits!);
      counts[v.status]!++;
      deps.log(`run ${run.id} (${run.kind} t${run.tier} wave ${run.wave}): ${v.status}${v.reason ? ` — ${v.reason}` : ''}`);
    }
  }
  for (const week of finishedWeeks(deps.now(), 4)) {
    try {
      const r = await deps.closeWeek(week);
      if (r) deps.log(`week ${week}: ${r}`);
    } catch (e) {
      deps.log(`week ${week}: not closed (${e instanceof Error ? e.message : String(e)})`);
    }
  }
  return counts;
}

// ------------------------------------------------------------------------------- real deps

function git(repo: string, args: string[]): { ok: boolean; out: string } {
  const r = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8' });
  return { ok: r.status === 0, out: `${r.stdout ?? ''}${r.stderr ?? ''}`.trim() };
}

const ENTRY = 'tools/leaderboard/verifyEntry.ts';

/** A checked-out worktree for `commit` (cached; the oldest beyond `keep` are removed). */
function worktree(repo: string, cache: string, commit: string, keep: number, fetched: { done: boolean }): string {
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error(`bad commit ${commit}`);
  const dir = join(cache, commit);
  if (existsSync(join(dir, '.git'))) {
    const t = new Date();
    utimesSync(dir, t, t);
    return dir;
  }
  if (!git(repo, ['cat-file', '-e', `${commit}^{commit}`]).ok) {
    if (!fetched.done) {
      fetched.done = true;
      git(repo, ['fetch', '--quiet', 'origin']);
    }
    if (!git(repo, ['cat-file', '-e', `${commit}^{commit}`]).ok) throw new Transient(`commit ${commit.slice(0, 10)} not in the repo`);
  }
  mkdirSync(cache, { recursive: true });
  git(repo, ['worktree', 'prune']);
  const add = git(repo, ['worktree', 'add', '--detach', '--force', dir, commit]);
  if (!add.ok) throw new Transient(`worktree: ${add.out}`);
  const nm = join(repo, 'node_modules');
  if (!existsSync(join(dir, 'node_modules'))) symlinkSync(nm, join(dir, 'node_modules'), 'dir');
  // Keep the cache small.
  const dirs = readdirSync(cache)
    .filter((d) => /^[0-9a-f]{40}$/.test(d) && d !== commit)
    .map((d) => ({ d, t: statSync(join(cache, d)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  for (const { d } of dirs.slice(Math.max(0, keep - 1))) {
    git(repo, ['worktree', 'remove', '--force', join(cache, d)]);
    rmSync(join(cache, d), { recursive: true, force: true });
  }
  return dir;
}

function runEntry(tsx: string, cwd: string, input: object, timeoutMs: number, memoryMb: number): Promise<EntryOutput> {
  return new Promise((res, rej) => {
    // A heap cap: a hostile replay (huge log, gzip bomb) aborts the child instead of the owner's PC.
    const env = { ...process.env, NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --max-old-space-size=${memoryMb}`.trim() };
    const child = spawn(tsx, [join(cwd, ENTRY)], { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      rej(new Fault(`timeout after ${timeoutMs} ms`));
    }, timeoutMs);
    child.stdout.on('data', (b: Buffer) => (out += b.toString()));
    child.stderr.on('data', (b: Buffer) => (err += b.toString()));
    child.on('error', (e) => {
      clearTimeout(timer);
      rej(new Transient(e.message));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) return rej(new Fault(`entry exited ${code}: ${err.trim().split('\n').slice(-3).join(' | ')}`));
      try {
        const line = out.trim().split('\n').pop() ?? '';
        const o = JSON.parse(line) as EntryOutput;
        if (!['verified', 'rejected', 'flagged'].includes(o.status)) throw new Error(`status ${String(o.status)}`);
        res(o);
      } catch (e) {
        rej(new Fault(`bad entry output: ${(e as Error).message}`));
      }
    });
    child.stdin.end(JSON.stringify(input));
  });
}

async function api(base: string, token: string, method: string, path: string, body?: unknown): Promise<Response> {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  return res;
}

async function apiJson<T>(base: string, token: string, method: string, path: string, body?: unknown): Promise<T> {
  const res = await api(base, token, method, path, body);
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path}: HTTP ${res.status} ${text.slice(0, 200)}`);
  return JSON.parse(text) as T;
}

function envNum(name: string, def: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : def;
}

async function main(): Promise<void> {
  const here = dirname(fileURLToPath(import.meta.url));
  const base = (process.env.LB_URL ?? '').replace(/\/+$/, '');
  const token = process.env.ADMIN_TOKEN ?? '';
  if (!base || !token) throw new Error('LB_URL and ADMIN_TOKEN must be set (server/verifier/verifier.env)');
  const repo = resolve(process.env.REPO || join(here, '..', '..'));
  const cache = resolve(process.env.CACHE || join(repo, '.verifier-cache'));
  const tsx = join(repo, 'node_modules', '.bin', 'tsx');
  if (!existsSync(tsx)) throw new Error(`${tsx} missing: run npm install in ${repo}`);
  const dry = process.argv.includes('--dry-run');
  const keep = envNum('KEEP_WORKTREES', 6);
  const timeoutMs = envNum('TIMEOUT_MS', 300_000);
  const memoryMb = envNum('ENTRY_MEMORY_MB', 1024);
  const fetched = { done: false };
  const strikesFile = join(cache, 'strikes.json');
  const strikes: Record<string, number> = (() => {
    try {
      return JSON.parse(readFileSync(strikesFile, 'utf8')) as Record<string, number>;
    } catch {
      return {};
    }
  })();
  const log = (m: string): void => void process.stdout.write(`${new Date().toISOString()} ${m}\n`);

  const deps: Deps = {
    now: () => Date.now(),
    pending: async (limit, after) => (await apiJson<{ runs: PendingRun[] }>(base, token, 'GET', `/v1/admin/pending?limit=${limit}&after=${after}`)).runs,
    replay: async (id) => {
      const res = await api(base, token, 'GET', `/v1/admin/replay/${id}`);
      if (res.status === 404) return ''; // lost replay: the entry rejects an empty payload
      if (!res.ok) throw new Transient(`replay ${id}: HTTP ${res.status}`);
      return res.text();
    },
    check: async (commit, input) => {
      const dir = worktree(repo, cache, commit, keep, fetched);
      if (!existsSync(join(dir, ENTRY))) return null;
      return runEntry(tsx, dir, input, timeoutMs, memoryMb);
    },
    verdict: async (v) => {
      if (dry) return log(`dry-run verdict ${JSON.stringify(v)}`);
      await apiJson(base, token, 'POST', '/v1/admin/verdict', v);
    },
    closeWeek: async (week) => {
      if (dry) return '';
      const res = await api(base, token, 'POST', '/v1/admin/close-week', { week });
      const b = (await res.json().catch(() => ({}))) as { already?: boolean; awarded?: number; error?: string };
      if (res.ok) return b.already ? '' : `closed, ${b.awarded ?? 0} badges`;
      throw new Error(b.error ?? `HTTP ${res.status}`);
    },
    strike: (id) => {
      strikes[id] = (strikes[id] ?? 0) + 1;
      if (!dry) {
        mkdirSync(cache, { recursive: true });
        writeFileSync(strikesFile, JSON.stringify(strikes));
      }
      return strikes[id]!;
    },
    log,
  };
  const counts = await verifyPending(deps, {
    batch: envNum('BATCH', 20),
    maxRuns: envNum('MAX_RUNS', 200),
    staleMs: envNum('STALE_HOURS', 48) * 3_600_000,
    maxStrikes: envNum('MAX_STRIKES', 2),
  });
  log(`done: ${JSON.stringify(counts)}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    process.stderr.write(`${e instanceof Error ? (e.stack ?? e.message) : String(e)}\n`);
    process.exit(1);
  });
}

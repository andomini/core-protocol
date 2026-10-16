// Server-issued run starts (spec docs/superpowers/specs/2026-10-16-leaderboards-design.md §3.2): POST /v1/runs/start
// hands out the run's seed and a signed token holding the start time; POST /v1/runs checks it, so a seed cannot be
// shopped for offline and a replay cannot be submitted faster than it could have been played.
// Each start is a `run_starts` row: only the player's newest START_KEEP starts of a kind stay valid, so seeds cannot
// be stockpiled and shopped for later, and the row counts the token's uses atomically (RUNS_PER_TOKEN).
// The Worker imports nothing from the game: PACE and TOKEN_MAX_AGE_MS mirror src/data/leaderboard.json `pace` and
// `startTokenMaxAgeDays` (test/api.test.ts keeps them equal), as time.ts mirrors the day rules.
import { b64url, fromB64url, hmacKey, hmacSign, hmacVerify } from './crypto';
import { DAY_MS } from './time';

/** Honest ceiling: tickHz 30 × the top speed ×5 = 150 ticks per real second (FixedLoop drops any backlog). */
export const PACE = { maxTicksPerSec: 150, slack: 0.9, graceMs: 1000 } as const;
/**
 * A long idle run plus the client's 7-day offline queue. Hoarding is bounded by START_KEEP, not by this age: the
 * client uses a pooled start for at most half of it (leaderboard.json `startPoolMaxAgeDays`), so a run always has
 * at least the other half to finish and be submitted.
 */
export const TOKEN_MAX_AGE_MS = 28 * DAY_MS;
/**
 * A new start voids all but the player's newest START_KEEP unused starts of its kind (one a run was submitted on
 * no longer counts). Honest play holds at most the run in progress, finished runs not yet uploaded and the pooled
 * next start, plus the pool refills during a long run (one per `startPoolMaxAgeDays`): the client stops fetching
 * starts while START_KEEP − 2 runs of a kind wait in its queue, and the server issues none while the pending cap
 * holds its uploads back. An account never holds more than 5 unplayed seeds. Mirrors leaderboard.json `startKeep`.
 */
export const START_KEEP = 5;
/** One start may be submitted twice: at the first death and, after a revive, at the final one (a longer run). */
export const RUNS_PER_TOKEN = 2;

/** The least real time (ms) a run of `ticks` takes from its start to its submission. */
export function minElapsedMs(ticks: number): number {
  return Math.max(0, Math.floor(((ticks * 1000) / PACE.maxTicksPerSec) * PACE.slack) - PACE.graceMs);
}

export type RunKind = 'tier' | 'daily';

export interface RunToken {
  v: 1;
  /** Player id. */
  p: string;
  k: RunKind;
  /** The challenge day (daily), else null. */
  d: string | null;
  /** The issued seed. */
  s: number;
  /** Server time of the start (ms). */
  a: number;
  /** The `run_starts` row id. */
  i: number;
}

const SHAPE = /^[A-Za-z0-9_-]{20,400}\.[A-Za-z0-9_-]{43}$/;
const macInput = (payloadB64: string): string => `core-protocol:run:${payloadB64}`;

export async function signRunToken(secret: string, t: RunToken): Promise<string> {
  const payload = b64url(new TextEncoder().encode(JSON.stringify(t)));
  return `${payload}.${b64url(await hmacSign(await hmacKey(secret), macInput(payload)))}`;
}

/** The token's payload if its shape and MAC are good and it is a v1 token; otherwise null. */
export async function readRunToken(secret: string, token: string): Promise<RunToken | null> {
  if (!SHAPE.test(token)) return null;
  const [payload, mac] = token.split('.') as [string, string];
  if (!(await hmacVerify(await hmacKey(secret), macInput(payload), fromB64url(mac)))) return null;
  try {
    const o = JSON.parse(new TextDecoder().decode(fromB64url(payload))) as Partial<RunToken>;
    const okKind = o.k === 'tier' || o.k === 'daily';
    const okDay = o.d === null || typeof o.d === 'string';
    if (o.v !== 1 || typeof o.p !== 'string' || !okKind || !okDay || !Number.isInteger(o.s) || !Number.isInteger(o.a) || !Number.isInteger(o.i) || (o.i as number) < 1)
      return null;
    return o as RunToken;
  } catch {
    return null;
  }
}

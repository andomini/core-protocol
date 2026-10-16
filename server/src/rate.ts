// Fixed-window rate limits in D1 (one upsert per limited request; only writes are limited). Each row carries
// its window's end (`exp`): the Worker's daily cron deletes expired rows, so the table stays small.
import type { Env } from './db';
import { HttpError } from './http';

export interface Rule {
  n: number;
  sec: number;
}

export const LIMITS = {
  /** Successful registrations per IP (checked before, counted after: failed attempts cost nothing). */
  register: { n: 30, sec: 3600 },
  /** CrazyGames re-registrations (new device secret) per account. */
  cgRegister: { n: 20, sec: 3600 },
  rename: { n: 10, sec: 86400 },
  submit: { n: 60, sec: 3600 },
  /** Submissions per IP (many fresh players behind one address). */
  submitIp: { n: 200, sec: 3600 },
  /** Replay bytes per player and day (a run's replay is ≤ 1 MB; typical runs are ~10-100 KB gzipped). */
  submitBytes: { n: 20_000_000, sec: 86400 },
  /** Replay bytes per IP and day. */
  submitBytesIp: { n: 100_000_000, sec: 86400 },
  friends: { n: 60, sec: 3600 },
} as const satisfies Record<string, Rule>;

const window = (rule: Rule, now: number): number => Math.floor(now / 1000 / rule.sec);

/** Counts `weight` against `key` and throws 429 when the window's total exceeds `rule.n`. */
export async function limit(env: Env, key: string, rule: Rule, now: number, weight = 1): Promise<void> {
  const win = window(rule, now);
  const row = await env.DB.prepare(
    `INSERT INTO rate (key, win, n, exp) VALUES (?1, ?2, ?3, ?4)
     ON CONFLICT(key) DO UPDATE SET n = CASE WHEN rate.win = excluded.win THEN rate.n + excluded.n ELSE excluded.n END, win = excluded.win, exp = excluded.exp
     RETURNING n`,
  )
    .bind(key, win, weight, (win + 1) * rule.sec * 1000)
    .first<{ n: number }>();
  if ((row?.n ?? 0) > rule.n) throw new HttpError(429, 'rate-limited');
}

/** Throws 429 when `key` has already used up its window, without counting this request. */
export async function peek(env: Env, key: string, rule: Rule, now: number): Promise<void> {
  const row = await env.DB.prepare('SELECT win, n FROM rate WHERE key = ?1').bind(key).first<{ win: number; n: number }>();
  if (row && row.win === window(rule, now) && row.n >= rule.n) throw new HttpError(429, 'rate-limited');
}

/** Cron: drops rows whose window is over. */
export async function purgeRate(env: Env, now: number): Promise<number> {
  const r = await env.DB.prepare('DELETE FROM rate WHERE exp < ?1').bind(now).run();
  return r.meta.changes ?? 0;
}

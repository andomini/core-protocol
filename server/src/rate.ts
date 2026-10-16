// Fixed-window rate limits in D1 (one upsert per limited request; only writes are limited).
import type { Env } from './db';
import { HttpError } from './http';

export const LIMITS = {
  register: { n: 10, sec: 3600 },
  rename: { n: 10, sec: 86400 },
  submit: { n: 60, sec: 3600 },
  friends: { n: 60, sec: 3600 },
} as const;

export async function limit(env: Env, key: string, rule: { n: number; sec: number }, now: number): Promise<void> {
  const win = Math.floor(now / 1000 / rule.sec);
  const row = await env.DB.prepare(
    `INSERT INTO rate (key, win, n) VALUES (?1, ?2, 1)
     ON CONFLICT(key) DO UPDATE SET n = CASE WHEN rate.win = excluded.win THEN rate.n + 1 ELSE 1 END, win = excluded.win
     RETURNING n`,
  )
    .bind(key, win)
    .first<{ n: number }>();
  if ((row?.n ?? 0) > rule.n) throw new HttpError(429, 'rate-limited');
}

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { b64url, fromB64url } from '../src/crypto';
import type { Env } from '../src/db';
import { daySeed, handle, runCron } from '../src/index';
import { limit, LIMITS } from '../src/rate';
import { checkName, isProfane } from '../src/names';
import { minElapsedMs, PACE, RUNS_PER_TOKEN, signRunToken, START_KEEP, TOKEN_MAX_AGE_MS } from '../src/runs';
import { DAY_MS, dailySeed, dayIndex, weekKey } from '../src/time';
import { fakeD1 } from './d1fake';

const T0 = Date.parse('2026-10-16T12:00:00Z'); // a Friday; week 2026-10-12
const SHA = 'a'.repeat(40);
const ADMIN = 'admin-token-for-tests';
const RUN_SECRET = 'run-secret-for-tests';

let env: Env;
let now = T0;

beforeEach(async () => {
  env = { DB: fakeD1(), ADMIN_TOKEN: ADMIN, RUN_SECRET, CORS_ORIGINS: 'https://*.crazygames.com,http://localhost:*' };
  now = T0;
  // Only registered builds are ranked (verifier/builds.ts add).
  await env.DB.prepare('INSERT INTO builds (commit_sha, note, added_at) VALUES (?1, ?2, ?3)').bind(SHA, 'test', T0).run();
});

interface Res<T = Record<string, unknown>> {
  status: number;
  body: T;
  headers: Headers;
}

async function call<T = Record<string, any>>(method: string, path: string, opts: { body?: unknown; token?: string; ip?: string; headers?: Record<string, string> } = {}): Promise<Res<T>> {
  const headers: Record<string, string> = { 'cf-connecting-ip': opts.ip ?? '1.2.3.4', ...opts.headers };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  const res = await handle(new Request(`https://lb.test${path}`, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) }), env, now);
  const text = await res.text();
  return { status: res.status, body: (text && res.headers.get('content-type')?.includes('json') ? JSON.parse(text) : text) as T, headers: res.headers };
}

async function newPlayer(name?: string, ip?: string): Promise<{ token: string; id: string; code: string; name: string }> {
  const r = await call('POST', '/v1/players', { body: { portal: 'local', ...(name ? { name } : {}) }, ip });
  expect(r.status).toBe(201);
  return { token: `${r.body.id}.${r.body.secret}`, id: r.body.id, code: r.body.friendCode, name: r.body.name };
}

/** POST /v1/runs/start as the player holding `token`, with the server clock at `at`. */
async function start(token: string, kind = 'tier', at = now): Promise<{ kind: string; day: string | null; seed: number; startedAt: number; token: string }> {
  const keep = now;
  now = at;
  try {
    const r = await call('POST', '/v1/runs/start', { token, body: { kind } });
    expect(r.status).toBe(200);
    return r.body as never;
  } finally {
    now = keep;
  }
}

let seq = 0;
/** A run body without a token (for a start the test issued itself). */
function body(over: Record<string, unknown> = {}) {
  seq++;
  return { kind: 'tier', tier: 1, wave: 10, ticks: 1000 + seq, hash: (0x10000000 + seq).toString(16), commit: SHA, replay: '{"v":1}', ...over };
}

/**
 * A run body with its own start token, issued far enough back that the pace check passes (a daily token inside
 * the run's day; `now` moves forward when the day began too recently).
 */
async function run(token: string, over: Record<string, unknown> = {}) {
  seq++;
  const base: Record<string, unknown> = { kind: 'tier', tier: 1, wave: 10, ticks: 1000 + seq, hash: (0x10000000 + seq).toString(16), commit: SHA, replay: '{"v":1}', ...over };
  const need = minElapsedMs(Number(base.ticks) || 0) + 1000;
  let at = now - need;
  const day = base.kind === 'daily' && typeof base.day === 'string' ? dayIndex(base.day) : NaN;
  if (Number.isFinite(day)) at = Math.min(Math.max(at, day * DAY_MS), (day + 1) * DAY_MS - 1);
  if (now - at < need) now = at + need;
  // Tests submit many runs per player: the hourly start limit is tested on its own.
  await env.DB.prepare("DELETE FROM rate WHERE key LIKE 'start:%'").run();
  const s = await start(token, base.kind === 'daily' ? 'daily' : 'tier', at);
  return { ...base, token: s.token, ...over };
}

const admin = (method: string, path: string, body?: unknown) => call(method, path, { token: ADMIN, body });

async function submitAndVerify(token: string, over: Record<string, unknown> = {}, status = 'verified', earnedBits = 100) {
  const s = await call('POST', '/v1/runs', { token, body: await run(token, over) });
  expect(s.status).toBe(202);
  const v = await admin('POST', '/v1/admin/verdict', { id: s.body.id, status, earnedBits, loadoutBits: 0 });
  expect(v.status).toBe(200);
  return s.body.id as number;
}

describe('time keys (same vectors as tests/leaderboard.test.ts in the game)', () => {
  it('day index, Monday week and daily seed', () => {
    expect(dayIndex('2026-10-16')).toBe(20742);
    expect(weekKey(T0)).toBe('2026-10-12');
    expect(weekKey(Date.parse('2026-10-11T23:59:59Z'))).toBe('2026-10-05');
    expect(dailySeed('2026-10-16')).toBe(1682601640);
  });
});

describe('names', () => {
  it('limits length and charset and filters profanity', () => {
    expect(checkName('  Neon   Rider ')).toBe('Neon Rider');
    expect(() => checkName('ab')).toThrow('name-length');
    expect(() => checkName('x'.repeat(21))).toThrow('name-length');
    expect(() => checkName('bad<name>')).toThrow('name-charset');
    expect(() => checkName('-dash')).toThrow('name-charset');
    expect(() => checkName('Fu_ck3r')).toThrow('name-profane');
    expect(isProfane('5h1t')).toBe(true);
    expect(isProfane('Grape Classic Huynh')).toBe(false);
  });
});

describe('players', () => {
  it('registers with an auto nickname, reads and renames itself', async () => {
    const p = await newPlayer();
    expect(p.name).toMatch(/^[A-Z][a-z]+[A-Z][a-z]+-\d{4}$/);
    expect(p.code).toMatch(/^[A-Z2-9]{6}$/);
    const me = await call('GET', '/v1/players/me', { token: p.token });
    expect(me.body).toMatchObject({ id: p.id, name: p.name, friendCode: p.code, canRename: true, verifiedBits: 0 });
    expect((await call('PATCH', '/v1/players/me', { token: p.token, body: { name: 'Core Hero' } })).body).toEqual({ name: 'Core Hero' });
    expect((await call('PATCH', '/v1/players/me', { token: p.token, body: { name: 'shitlord' } })).body.error).toBe('name-profane');
    expect((await call('GET', '/v1/players/me', { token: `${p.id}.${'x'.repeat(43)}` })).status).toBe(401);
    expect((await call('GET', '/v1/players/me')).status).toBe(401);
  });

  it('rate-limits successful registrations per address; failed attempts cost nothing', async () => {
    for (let i = 0; i < 5; i++) expect((await call('POST', '/v1/players', { body: { name: 'ab' }, ip: '9.9.9.9' })).status).toBe(400);
    for (let i = 0; i < LIMITS.register.n; i++) await newPlayer(undefined, '9.9.9.9');
    expect((await call('POST', '/v1/players', { body: {}, ip: '9.9.9.9' })).status).toBe(429);
    await newPlayer(undefined, '9.9.9.8');
    now += 3_600_000;
    await newPlayer(undefined, '9.9.9.9');
  });

  it('the daily cron purges expired rate rows', async () => {
    await newPlayer();
    const count = async () => (await env.DB.prepare('SELECT COUNT(*) AS n FROM rate').first<{ n: number }>())!.n;
    expect(await count()).toBeGreaterThan(0);
    await runCron(env, now);
    expect(await count()).toBeGreaterThan(0);
    await runCron(env, now + 2 * 3_600_000);
    expect(await count()).toBe(0);
  });

  it('deletes an account with its runs, bests and follows', async () => {
    const p = await newPlayer();
    const q = await newPlayer();
    await submitAndVerify(p.token);
    await call('POST', '/v1/friends', { token: q.token, body: { code: p.code } });
    expect((await call('DELETE', '/v1/players/me', { token: p.token })).body).toEqual({ deleted: true });
    expect((await call('GET', '/v1/boards/tier/1')).body.entries).toEqual([]);
    expect((await call('GET', '/v1/friends', { token: q.token })).body.following).toEqual([]);
  });
});

describe('CrazyGames accounts', () => {
  async function keys() {
    const kp = (await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, [
      'sign',
      'verify',
    ])) as CryptoKeyPair;
    const spki = new Uint8Array(await crypto.subtle.exportKey('spki', kp.publicKey));
    const pem = `-----BEGIN PUBLIC KEY-----\n${btoa(String.fromCharCode(...spki))}\n-----END PUBLIC KEY-----`;
    const sign = async (payload: object, alg = 'RS256') => {
      const enc = (o: object) => b64url(new TextEncoder().encode(JSON.stringify(o)));
      const head = `${enc({ alg, typ: 'JWT' })}.${enc(payload)}`;
      const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', kp.privateKey, new TextEncoder().encode(head)));
      return `${head}.${b64url(sig)}`;
    };
    return { pem, sign };
  }

  it('links a verified user token to one player; the same account on a new device gets the same player', async () => {
    const k = await keys();
    env.CG_PUBLIC_KEY_PEM = k.pem;
    env.CG_GAME_ID = '20267';
    const payload = { userId: 'UOuZBKgj', gameId: '20267', username: 'RustyCake.ZU9H', exp: Math.floor(now / 1000) + 3600 };
    const a = await call('POST', '/v1/players', { body: { portal: 'crazygames', cgToken: await k.sign(payload) } });
    expect(a.status).toBe(201);
    expect(a.body).toMatchObject({ name: 'RustyCake.ZU9H', linked: true, portal: 'crazygames' });
    const b = await call('POST', '/v1/players', { body: { portal: 'crazygames', cgToken: await k.sign({ ...payload, username: 'RustyCake2' }) } });
    expect(b.status).toBe(200);
    expect(b.body.id).toBe(a.body.id);
    expect(b.body.name).toBe('RustyCake2');
    // The old device keeps working (its secret is not replaced), up to the newest few device secrets.
    expect((await call('GET', '/v1/players/me', { token: `${a.body.id}.${a.body.secret}` })).status).toBe(200);
    const older = [];
    for (let i = 0; i < 6; i++) older.push((await call('POST', '/v1/players', { body: { portal: 'crazygames', cgToken: await k.sign({ ...payload, username: 'RustyCake2' }) } })).body);
    expect((await call('GET', '/v1/players/me', { token: `${b.body.id}.${b.body.secret}` })).status).toBe(401);
    expect((await call('GET', '/v1/players/me', { token: `${older[5]!.id}.${older[5]!.secret}` })).status).toBe(200);
    // The first device's secret is the player's own (players.secret_hash): never pruned.
    expect((await call('GET', '/v1/players/me', { token: `${a.body.id}.${a.body.secret}` })).status).toBe(200);
    const tok = `${older[5]!.id}.${older[5]!.secret}`;
    const me = await call('GET', '/v1/players/me', { token: tok });
    expect(me.body.canRename).toBe(false);
    expect((await call('PATCH', '/v1/players/me', { token: tok, body: { name: 'Other' } })).status).toBe(403);
  });

  it('without CG_GAME_ID, account linking is off (503 cg-disabled; the client registers anonymously)', async () => {
    const k = await keys();
    env.CG_PUBLIC_KEY_PEM = k.pem;
    const r = await call('POST', '/v1/players', { body: { portal: 'crazygames', cgToken: await k.sign({ userId: 'u', gameId: '1', username: 'X', exp: Math.floor(now / 1000) + 60 }) } });
    expect(r).toMatchObject({ status: 503, body: { error: 'cg-disabled' } });
  });

  it('refuses forged, expired, wrong-game and non-RS256 tokens', async () => {
    const k = await keys();
    const other = await keys();
    env.CG_PUBLIC_KEY_PEM = k.pem;
    env.CG_GAME_ID = '20267';
    const ok = { userId: 'u1', gameId: '20267', username: 'Someone', exp: Math.floor(now / 1000) + 3600 };
    const reg = (t: string) => call('POST', '/v1/players', { body: { cgToken: t } });
    expect((await reg(await other.sign(ok))).body.error).toBe('cg-token');
    expect((await reg(await k.sign({ ...ok, exp: Math.floor(now / 1000) - 3600 }))).body.error).toBe('cg-token-expired');
    expect((await reg(await k.sign({ ...ok, gameId: '1' }))).body.error).toBe('cg-token-game');
    expect((await reg(await k.sign(ok, 'none'))).body.error).toBe('cg-token');
    expect((await reg('a.b')).status).toBe(401);
  });
});

describe('runs and boards', () => {
  it('validates submissions', async () => {
    const p = await newPlayer();
    const post = async (o: Record<string, unknown>) => call('POST', '/v1/runs', { token: p.token, body: await run(p.token, o) });
    expect((await post({ commit: `${SHA}-dirty` })).body.error).toBe('build-not-ranked');
    expect((await post({ kind: 'weekly' })).body.error).toBe('bad-kind');
    expect((await post({ tier: 0 })).body.error).toBe('bad-tier');
    expect((await post({ hash: 'XYZ' })).body.error).toBe('bad-hash');
    expect((await post({ kind: 'daily', day: '2026-10-14' })).body.error).toBe('bad-day');
    expect((await post({ replay: 'x'.repeat(1_000_001) })).status).toBe(413);
    expect((await post({ kind: 'daily', day: '2026-10-15' })).status).toBe(202); // yesterday: crossed midnight
    expect((await call('POST', '/v1/runs', { body: await run(p.token) })).status).toBe(401);
    for (const replay of ['', 'not a replay', 'gz:not base64!', '{"v":1']) expect((await post({ replay })).body.error).toBe('bad-replay');
  });

  it('ranks only registered, unretired builds', async () => {
    const p = await newPlayer();
    const other = 'c'.repeat(40);
    expect((await call('POST', '/v1/runs', { token: p.token, body: await run(p.token, { commit: other }) })).body.error).toBe('build-not-ranked');
    expect((await call('POST', '/v1/admin/builds', { body: { commit: other } })).status).toBe(401);
    expect((await admin('POST', '/v1/admin/builds', { commit: other, note: 'v1.2' })).body.builds).toContainEqual(expect.objectContaining({ commit: other, note: 'v1.2', retiredAt: null }));
    expect((await call('POST', '/v1/runs', { token: p.token, body: await run(p.token, { commit: other }) })).status).toBe(202);
    await admin('POST', '/v1/admin/builds', { commit: other, retired: true });
    expect((await call('POST', '/v1/runs', { token: p.token, body: await run(p.token, { commit: other }) })).body.error).toBe('build-not-ranked');
    expect((await admin('POST', '/v1/admin/builds', { commit: 'nope' })).body.error).toBe('bad-commit');
  });

  it('counts stored replay bytes per player and day', async () => {
    const p = await newPlayer();
    const replay = `{${'x'.repeat(5000)}}`;
    expect((await call('POST', '/v1/runs', { token: p.token, body: await run(p.token, { replay }) })).status).toBe(202);
    const row = await env.DB.prepare("SELECT n FROM rate WHERE key = ?1").bind(`bytes:${p.id}`).first<{ n: number }>();
    expect(row?.n).toBe(replay.length);
    await limit(env, `bytes:${p.id}`, LIMITS.submitBytes, now, LIMITS.submitBytes.n - replay.length - 10);
    expect((await call('POST', '/v1/runs', { token: p.token, body: await run(p.token, { replay }) })).status).toBe(429);
    now += 86_400_000;
    expect((await call('POST', '/v1/runs', { token: p.token, body: await run(p.token, { replay }) })).status).toBe(202);
  });

  it('a duplicate submission returns the same run', async () => {
    const p = await newPlayer();
    const body = await run(p.token);
    const a = await call('POST', '/v1/runs', { token: p.token, body });
    const b = await call('POST', '/v1/runs', { token: p.token, body });
    expect(b.body.id).toBe(a.body.id);
    expect(b.status).toBe(200);
  });

  it('caps pending runs per player', async () => {
    const p = await newPlayer();
    const last = await run(p.token); // started before the cap: /runs/start is refused at it
    for (let i = 0; i < 20; i++) expect((await call('POST', '/v1/runs', { token: p.token, body: await run(p.token) })).status).toBe(202);
    expect((await call('POST', '/v1/runs', { token: p.token, body: last })).body.error).toBe('too-many-pending');
  });

  it('boards show verified bests only, plus my own pending run as verifying', async () => {
    const a = await newPlayer('Alpha');
    const b = await newPlayer('Bravo');
    const c = await newPlayer('Charlie');
    await submitAndVerify(a.token, { wave: 30 });
    await submitAndVerify(b.token, { wave: 20 });
    await submitAndVerify(b.token, { wave: 15 }); // worse: keeps 20
    await submitAndVerify(c.token, { wave: 50 }, 'rejected');
    await call('POST', '/v1/runs', { token: c.token, body: await run(c.token, { wave: 25 }) }); // pending
    const anon = await call('GET', '/v1/boards/tier/1');
    expect(anon.body.entries.map((e: any) => [e.rank, e.name, e.wave, e.status])).toEqual([
      [1, 'Alpha', 30, 'verified'],
      [2, 'Bravo', 20, 'verified'],
    ]);
    expect(anon.body.me).toBeNull();
    const asC = await call('GET', '/v1/boards/tier/1', { token: c.token });
    expect(asC.body.entries.map((e: any) => [e.rank, e.name, e.status, e.me ?? false])).toEqual([
      [1, 'Alpha', 'verified', false],
      [2, 'Charlie', 'verifying', true],
      [3, 'Bravo', 'verified', false],
    ]);
    expect(asC.body.me).toEqual({ rank: 2, wave: 25, status: 'verifying' });
    const asB = await call('GET', '/v1/boards/tier/1?limit=1', { token: b.token });
    expect(asB.body.entries).toHaveLength(1);
    expect(asB.body.me).toEqual({ rank: 2, wave: 20, status: 'verified' });
    expect(asB.body.total).toBe(2);
    expect((await call('GET', '/v1/boards/tier/2')).body.entries).toEqual([]);
    expect((await call('GET', '/v1/players/me', { token: b.token })).body.verifiedBits).toBe(200);
  });

  it('weekly boards are keyed by the Monday of the submission; daily boards by the challenge day', async () => {
    const a = await newPlayer('Alpha');
    await submitAndVerify(a.token, { wave: 12 });
    now = Date.parse('2026-10-19T00:00:01Z'); // next Monday
    await submitAndVerify(a.token, { wave: 9 });
    await submitAndVerify(a.token, { kind: 'daily', day: '2026-10-19', wave: 7 });
    const wk = await call('GET', '/v1/boards/weekly/1');
    expect(wk.body).toMatchObject({ board: 'w:2026-10-19:1', week: '2026-10-19' });
    expect(wk.body.entries[0].wave).toBe(9);
    expect((await call('GET', '/v1/boards/weekly/1?week=2026-10-12')).body.entries[0].wave).toBe(12);
    expect((await call('GET', '/v1/boards/weekly/1?week=2026-10-13')).body.error).toBe('bad-week');
    expect((await call('GET', '/v1/boards/tier/1')).body.entries[0].wave).toBe(12);
    const d = await call('GET', '/v1/boards/daily');
    expect(d.body).toMatchObject({ board: 'd:2026-10-19', seed: dailySeed('2026-10-19') });
    expect(d.body.entries[0].wave).toBe(7);
    expect((await call('GET', '/v1/boards/daily/2026-10-18')).body.entries).toEqual([]);
    expect((await call('GET', '/v1/boards/daily/2026-10-20')).body.error).toBe('bad-day');
    const info = await call('GET', '/v1/daily');
    expect(info.body).toMatchObject({ day: '2026-10-19', dayIndex: dayIndex('2026-10-19'), seed: dailySeed('2026-10-19'), week: '2026-10-19' });
  });
});

describe('server-issued run starts', () => {
  const submit = (token: string, body: unknown) => call('POST', '/v1/runs', { token, body });
  const tok = (b: Record<string, unknown>) => String(b.token);
  /** The token's payload, decoded. */
  const payload = (t: string) => JSON.parse(new TextDecoder().decode(fromB64url(t.split('.')[0]!))) as Record<string, unknown>;

  it('tier starts get a fresh random seed and a valid token; daily starts the day seed', async () => {
    const p = await newPlayer();
    const a = await start(p.token);
    const b = await start(p.token);
    expect(a).toMatchObject({ kind: 'tier', day: null, startedAt: now });
    expect(a.seed).toBeGreaterThanOrEqual(1);
    expect(a.seed).toBeLessThanOrEqual(0x7ffffffe);
    expect(a.seed).not.toBe(b.seed);
    expect(a.token).toMatch(/^[A-Za-z0-9_-]{20,400}\.[A-Za-z0-9_-]{43}$/);
    expect(payload(a.token)).toMatchObject({ v: 1, p: p.id, k: 'tier', d: null, s: a.seed, a: now });
    expect(payload(b.token).i).toBe(Number(payload(a.token).i) + 1);
    const d = await start(p.token, 'daily');
    expect(d).toMatchObject({ kind: 'daily', day: '2026-10-16', seed: await daySeed(env, '2026-10-16') });
    env.DAILY_SECRET = 'daily-secret-for-tests';
    expect((await start(p.token, 'daily')).seed).toBe(await daySeed(env, '2026-10-16'));
  });

  it('start needs auth and a good kind; starts beyond LIMITS.start in an hour are refused; no RUN_SECRET → 503', async () => {
    const p = await newPlayer();
    expect((await call('POST', '/v1/runs/start', { body: { kind: 'tier' } })).status).toBe(401);
    expect((await call('POST', '/v1/runs/start', { token: p.token, body: { kind: 'weekly' } })).body).toEqual({ error: 'bad-kind' });
    for (let i = 0; i < LIMITS.start.n; i++) await start(p.token);
    expect((await call('POST', '/v1/runs/start', { token: p.token, body: { kind: 'tier' } })).status).toBe(429);
    now += 3_600_000;
    await start(p.token);
    const body = await run(p.token);
    env.RUN_SECRET = undefined;
    expect(await call('POST', '/v1/runs/start', { token: p.token, body: { kind: 'tier' } })).toMatchObject({ status: 503, body: { error: 'ranked-disabled' } });
    expect(await submit(p.token, body)).toMatchObject({ status: 503, body: { error: 'ranked-disabled' } });
  });

  it('refuses missing, forged, foreign, mismatched and expired tokens', async () => {
    const p = await newPlayer();
    const q = await newPlayer();
    const { token: _t, ...noToken } = await run(p.token);
    expect((await submit(p.token, noToken)).body.error).toBe('no-token');
    expect((await submit(p.token, { ...(await run(p.token)), token: 42 })).body.error).toBe('no-token');
    // One flipped MAC character.
    const b = await run(p.token);
    const t = tok(b);
    const flipped = t.slice(0, -2) + (t.at(-2) === 'A' ? 'B' : 'A') + t.at(-1);
    expect((await submit(p.token, { ...b, token: flipped })).body.error).toBe('bad-token');
    // An edited payload with the old MAC (an earlier start time).
    const pl = payload(t);
    const forged = `${b64url(new TextEncoder().encode(JSON.stringify({ ...pl, a: Number(pl.a) - 3_600_000 })))}.${t.split('.')[1]}`;
    expect((await submit(p.token, { ...b, token: forged })).body.error).toBe('bad-token');
    expect((await submit(p.token, { ...b, token: 'not.a.token' })).body.error).toBe('bad-token');
    // Signed with another key, or a v2 payload.
    expect((await submit(p.token, { ...b, token: await signRunToken('other', pl as never) })).body.error).toBe('bad-token');
    expect((await submit(p.token, { ...b, token: await signRunToken(RUN_SECRET, { ...pl, v: 2 } as never) })).body.error).toBe('bad-token');
    // Another player's token.
    expect((await submit(p.token, await run(q.token))).body.error).toBe('bad-token');
    // A daily token on a tier run, and a daily token for another day.
    const daily = await start(p.token, 'daily', now - 3_600_000);
    expect((await submit(p.token, { ...(await run(p.token)), token: daily.token })).body.error).toBe('token-mismatch');
    const yday = await start(p.token, 'daily', now - DAY_MS);
    expect((await submit(p.token, { ...(await run(p.token, { kind: 'daily', day: '2026-10-16' })), token: yday.token })).body.error).toBe('token-mismatch');
    // A tier token on a daily run.
    expect((await submit(p.token, { ...(await run(p.token, { kind: 'daily', day: '2026-10-16' })), token: (await start(p.token, 'tier', now - 3_600_000)).token })).body.error).toBe(
      'token-mismatch',
    );
    // Older than TOKEN_MAX_AGE_MS.
    const old = await start(p.token, 'tier', now - TOKEN_MAX_AGE_MS - 1);
    expect((await submit(p.token, { ...(await run(p.token)), token: old.token })).body.error).toBe('token-expired');
  });

  it('a run must take real time: ticks / 150 per second × 0.9 − 1 s', async () => {
    const p = await newPlayer();
    expect(minElapsedMs(150_000)).toBe(899_000);
    expect(minElapsedMs(100)).toBe(0);
    const s = await start(p.token);
    const body = { ...(await run(p.token, { ticks: 150_000 })), token: s.token };
    now = s.startedAt + 800_000;
    expect((await submit(p.token, body)).body.error).toBe('too-fast');
    now = s.startedAt + 900_000;
    expect((await submit(p.token, body)).status).toBe(202);
  });

  it('one start: a resend is idempotent, a longer same-tier second run is accepted, nothing else', async () => {
    const p = await newPlayer();
    const s = await start(p.token, 'tier', now - 3_600_000);
    const first = { ...(body({ ticks: 5000 })), token: s.token };
    const a = await submit(p.token, first);
    expect(a.status).toBe(202);
    expect(await submit(p.token, first)).toMatchObject({ status: 200, body: { id: a.body.id } });
    expect((await submit(p.token, { ...(body({ ticks: 5000 })), token: s.token })).body.error).toBe('token-used');
    expect((await submit(p.token, { ...body({ ticks: 4000 }), token: s.token })).body.error).toBe('token-used');
    expect((await submit(p.token, { ...body({ ticks: 9000, tier: 2 }), token: s.token })).body.error).toBe('token-used');
    const second = await submit(p.token, { ...body({ ticks: 9000 }), token: s.token });
    expect(second.status).toBe(202);
    expect(RUNS_PER_TOKEN).toBe(2);
    expect((await submit(p.token, { ...body({ ticks: 12000 }), token: s.token })).body.error).toBe('token-used');
    const rows = await env.DB.prepare('SELECT seed, started_at AS a FROM runs WHERE player_id = ?1').bind(p.id).all<{ seed: number; a: number }>();
    expect(rows.results).toEqual([
      { seed: s.seed, a: s.startedAt },
      { seed: s.seed, a: s.startedAt },
    ]);
  });

  it('only the newest START_KEEP starts per kind stay valid: seeds cannot be stockpiled', async () => {
    const p = await newPlayer();
    const old = await start(p.token, 'tier', now - 3_600_000);
    const daily = await start(p.token, 'daily', now - 3_600_000);
    const newer = [];
    for (let i = 0; i < START_KEEP; i++) newer.push(await start(p.token, 'tier', now - 3_600_000 + 1 + i));
    expect(START_KEEP).toBeLessThanOrEqual(5);
    expect(LIMITS.start.n).toBeLessThanOrEqual(20);
    // The oldest tier start is void for good; the newest START_KEEP and the other kind's start still work.
    expect(await submit(p.token, { ...body(), token: old.token })).toMatchObject({ status: 400, body: { error: 'token-revoked' } });
    expect((await submit(p.token, { ...body(), token: newer[0]!.token })).status).toBe(202);
    expect((await submit(p.token, { ...body({ kind: 'daily', day: '2026-10-16' }), token: daily.token })).status).toBe(202);
    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM run_starts WHERE player_id = ?1').bind(p.id).first<{ n: number }>();
    expect(n?.n).toBe(START_KEEP + 1);
    // The daily cron drops starts past TOKEN_MAX_AGE_MS; a deleted player takes its starts along.
    await runCron(env, now + TOKEN_MAX_AGE_MS);
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM run_starts').first<{ n: number }>())?.n).toBe(0);
    expect(await submit(p.token, { ...body(), token: newer[1]!.token })).toMatchObject({ status: 400, body: { error: 'token-revoked' } });
    await start(p.token);
    expect((await call('DELETE', '/v1/players/me', { token: p.token })).status).toBe(200);
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM run_starts').first<{ n: number }>())?.n).toBe(0);
  });

  it('concurrent submits on one start add at most RUNS_PER_TOKEN rows (the claim is atomic)', async () => {
    const p = await newPlayer();
    const s = await start(p.token, 'tier', now - 3_600_000);
    const bodies = [5000, 6000, 7000, 8000, 9000, 10000].map((ticks) => ({ ...body({ ticks }), token: s.token }));
    // A barrier: every request has passed its checks (each read uses = 0) before the first insert batch runs.
    const batch = env.DB.batch.bind(env.DB);
    let waiting: (() => void)[] = [];
    env.DB.batch = async (stmts) => {
      await new Promise<void>((go) => {
        waiting.push(go);
        if (waiting.length === bodies.length) for (const g of waiting) g();
      });
      return batch(stmts);
    };
    const res = await Promise.all(bodies.map((b) => submit(p.token, b)));
    env.DB.batch = batch;
    waiting = [];
    const rows = await env.DB.prepare('SELECT COUNT(*) AS n FROM runs WHERE player_id = ?1').bind(p.id).first<{ n: number }>();
    expect(rows?.n).toBeLessThanOrEqual(RUNS_PER_TOKEN);
    expect(res.filter((r) => r.status === 202)).toHaveLength(rows!.n);
    for (const r of res.filter((x) => x.status !== 202)) expect(r).toMatchObject({ status: 409, body: { error: 'token-used' } });
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM replays').first<{ n: number }>())?.n).toBe(rows!.n);
  });

  it('pending runs carry the issued seed and start time (tier runs too)', async () => {
    const p = await newPlayer();
    const s = await start(p.token, 'tier', now - 3_600_000);
    await submit(p.token, { ...(await run(p.token)), token: s.token });
    // A legacy row (before 0003): no seed, no start.
    await env.DB.prepare("INSERT INTO runs (player_id, kind, tier, day, week, wave, ticks, hash, commit_sha, created_at) VALUES (?1, 'tier', 1, NULL, '2026-10-12', 3, 99, '0badc0de', ?2, ?3)")
      .bind(p.id, SHA, now)
      .run();
    const runs = (await admin('GET', '/v1/admin/pending')).body.runs;
    expect(runs[0]).toMatchObject({ seed: s.seed, startedAt: s.startedAt, kind: 'tier' });
    expect(runs[1].startedAt).toBeNull();
    expect('seed' in runs[1]).toBe(false);
  });

  it('a start a run was submitted on does not count against START_KEEP (queued and revived runs keep theirs)', async () => {
    const p = await newPlayer();
    const s = await start(p.token, 'tier', now - 3_600_000);
    const first = await submit(p.token, { ...body({ ticks: 5000 }), token: s.token });
    expect(first.status).toBe(202);
    for (let i = 0; i < START_KEEP + 2; i++) await start(p.token, 'tier', now - 3_600_000 + 1 + i);
    // The revive's resubmit (a longer same-tier run) on the claimed start still works.
    expect((await submit(p.token, { ...body({ ticks: 9000 }), token: s.token })).status).toBe(202);
    const unused = await env.DB.prepare('SELECT COUNT(*) AS n FROM run_starts WHERE player_id = ?1 AND uses = 0').bind(p.id).first<{ n: number }>();
    expect(unused?.n).toBe(START_KEEP);
  });

  it('no new start while the pending cap holds the uploads back (it would void the queued runs\' starts)', async () => {
    const p = await newPlayer();
    const queued = await run(p.token);
    for (let i = 0; i < 20; i++) expect((await submit(p.token, await run(p.token))).status).toBe(202);
    expect((await submit(p.token, queued)).body.error).toBe('too-many-pending');
    expect(await call('POST', '/v1/runs/start', { token: p.token, body: { kind: 'tier' } })).toMatchObject({ status: 429, body: { error: 'too-many-pending' } });
    // The verifier catches up: the queued run's start is still valid.
    await env.DB.prepare("UPDATE runs SET status = 'verified' WHERE player_id = ?1").bind(p.id).run();
    expect((await submit(p.token, queued)).status).toBe(202);
  });

  it('a concurrent resend of the same run returns the stored run, not token-used', async () => {
    const p = await newPlayer();
    const b = await run(p.token);
    const batch = env.DB.batch.bind(env.DB);
    const waiting: (() => void)[] = [];
    env.DB.batch = async (stmts) => {
      await new Promise<void>((go) => {
        waiting.push(go);
        if (waiting.length === 2) for (const g of waiting) g();
      });
      return batch(stmts);
    };
    const [x, y] = await Promise.all([submit(p.token, b), submit(p.token, b)]);
    env.DB.batch = batch;
    expect([x.status, y.status].sort()).toEqual([200, 202]);
    expect(x.body.id).toBe(y.body.id);
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM runs WHERE player_id = ?1').bind(p.id).first<{ n: number }>())?.n).toBe(1);
  });

  it('a start voided between the check and the insert batch stores nothing (token-revoked)', async () => {
    const p = await newPlayer();
    const b = await run(p.token);
    const batch = env.DB.batch.bind(env.DB);
    env.DB.batch = async (stmts) => {
      await env.DB.prepare('DELETE FROM run_starts WHERE player_id = ?1').bind(p.id).run();
      return batch(stmts);
    };
    expect(await submit(p.token, b)).toMatchObject({ status: 400, body: { error: 'token-revoked' } });
    env.DB.batch = batch;
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM runs').first<{ n: number }>())?.n).toBe(0);
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM replays').first<{ n: number }>())?.n).toBe(0);
  });

  it('PACE, TOKEN_MAX_AGE_MS and START_KEEP mirror src/data/leaderboard.json', () => {
    const lb = JSON.parse(readFileSync(join(import.meta.dirname, '..', '..', 'src', 'data', 'leaderboard.json'), 'utf8')) as {
      pace: unknown;
      startTokenMaxAgeDays: number;
      startPoolMaxAgeDays: number;
      startKeep: number;
    };
    expect(PACE).toEqual(lb.pace);
    expect(TOKEN_MAX_AGE_MS).toBe(lb.startTokenMaxAgeDays * DAY_MS);
    expect(START_KEEP).toBe(lb.startKeep);
    // ~10 D1 rows written per accepted start: one address stays well inside the free plan's 100k rows a day.
    expect(LIMITS.startIp.n * 24 * 10).toBeLessThanOrEqual(25_000);
    // A pooled start is used within half the token's age: the run keeps the other half to finish and upload.
    expect(lb.startPoolMaxAgeDays * 2).toBeLessThanOrEqual(lb.startTokenMaxAgeDays);
  });
});

describe('friends', () => {
  it('follows by code; the friends scope shows me + followed', async () => {
    const a = await newPlayer('Alpha');
    const b = await newPlayer('Bravo');
    const c = await newPlayer('Charlie');
    await submitAndVerify(a.token, { wave: 30 });
    await submitAndVerify(b.token, { wave: 20 });
    await submitAndVerify(c.token, { wave: 10 });
    expect((await call('POST', '/v1/friends', { token: c.token, body: { code: `${b.code.slice(0, 3)}-${b.code.slice(3).toLowerCase()}` } })).body.friend.name).toBe('Bravo');
    expect((await call('POST', '/v1/friends', { token: c.token, body: { code: c.code } })).body.error).toBe('self');
    expect((await call('POST', '/v1/friends', { token: c.token, body: { code: 'ZZZZZZ' } })).status).toBe(404);
    const f = await call('GET', '/v1/boards/tier/1?scope=friends', { token: c.token });
    expect(f.body.entries.map((e: any) => [e.rank, e.name])).toEqual([
      [1, 'Bravo'],
      [2, 'Charlie'],
    ]);
    expect(f.body.me).toEqual({ rank: 2, wave: 10, status: 'verified' });
    expect(f.body.total).toBe(2);
    expect((await call('GET', '/v1/friends', { token: c.token })).body).toMatchObject({ code: c.code, following: [{ name: 'Bravo', friendCode: b.code }] });
    expect((await call('DELETE', `/v1/friends/${b.code}`, { token: c.token })).body).toEqual({ removed: true });
    expect((await call('GET', '/v1/boards/tier/1?scope=friends', { token: c.token })).body.entries).toHaveLength(1);
    expect((await call('GET', '/v1/boards/tier/1?scope=friends')).status).toBe(401);
  });
});

describe('admin API', () => {
  it('needs the bearer token', async () => {
    expect((await call('GET', '/v1/admin/pending')).status).toBe(401);
    expect((await call('GET', '/v1/admin/pending', { token: 'wrong' })).status).toBe(401);
    env.ADMIN_TOKEN = undefined;
    expect((await admin('GET', '/v1/admin/pending')).status).toBe(503);
  });

  it('lists pending runs, serves replays, records verdicts once', async () => {
    const p = await newPlayer();
    const s = await call('POST', '/v1/runs', { token: p.token, body: await run(p.token, { wave: 22, replay: 'gz:AAAA' }) });
    const pend = await admin('GET', '/v1/admin/pending');
    expect(pend.body.runs).toEqual([expect.objectContaining({ id: s.body.id, playerId: p.id, wave: 22, commit: SHA, verifiedBits: 0, kind: 'tier', week: '2026-10-12' })]);
    const rp = await admin('GET', `/v1/admin/replay/${s.body.id}`);
    expect(rp.body).toBe('gz:AAAA');
    expect((await admin('POST', '/v1/admin/verdict', { id: s.body.id, status: 'flagged', reason: 'loadout', earnedBits: 50 })).status).toBe(200);
    expect((await admin('GET', '/v1/admin/pending')).body.runs).toEqual([]);
    expect((await admin('GET', '/v1/admin/runs?status=flagged')).body.runs[0]).toMatchObject({ id: s.body.id, reason: 'loadout' });
    expect((await call('GET', '/v1/boards/tier/1')).body.entries).toEqual([]);
    // A flagged run's Bits do not raise the loadout allowance until the flag is overturned.
    expect((await call('GET', '/v1/players/me', { token: p.token })).body.verifiedBits).toBe(0);
    // The owner overturns the flag: the run joins the board; Bits are not credited twice.
    expect((await admin('POST', '/v1/admin/verdict', { id: s.body.id, status: 'verified', earnedBits: 50 })).body.boards).toEqual(['t:1', 'w:2026-10-12:1']);
    expect((await admin('POST', '/v1/admin/verdict', { id: s.body.id, status: 'rejected' })).status).toBe(409);
    expect((await call('GET', '/v1/players/me', { token: p.token })).body.verifiedBits).toBe(50);
    expect((await call('GET', '/v1/boards/tier/1')).body.entries[0].wave).toBe(22);
    expect((await call('GET', '/v1/runs/mine', { token: p.token })).body.runs[0]).toMatchObject({ id: s.body.id, status: 'verified' });
  });

  it('pages pending runs with a cursor; daily runs carry the day seed (HMAC with DAILY_SECRET)', async () => {
    const p = await newPlayer();
    const a = await call('POST', '/v1/runs', { token: p.token, body: await run(p.token) });
    const b = await call('POST', '/v1/runs', { token: p.token, body: await run(p.token, { kind: 'daily', day: '2026-10-16' }) });
    expect((await admin('GET', '/v1/admin/pending?limit=1')).body.runs.map((r: any) => r.id)).toEqual([a.body.id]);
    const page = (await admin('GET', `/v1/admin/pending?after=${a.body.id}`)).body.runs;
    expect(page).toEqual([expect.objectContaining({ id: b.body.id, seed: dailySeed('2026-10-16') })]);
    env.DAILY_SECRET = 'daily-secret-for-tests';
    const secretSeed = await daySeed(env, '2026-10-16');
    expect(secretSeed).not.toBe(dailySeed('2026-10-16'));
    expect(await daySeed({ ...env, DAILY_SECRET: 'other' }, '2026-10-16')).not.toBe(secretSeed);
    expect((await call('GET', '/v1/daily')).body.seed).toBe(secretSeed);
    expect((await call('GET', '/v1/boards/daily')).body.seed).toBe(secretSeed);
    // The row keeps the seed its start token carried (issued before the secret was set).
    expect((await admin('GET', `/v1/admin/pending?after=${a.body.id}`)).body.runs[0].seed).toBe(dailySeed('2026-10-16'));
    const c = await call('POST', '/v1/runs', { token: p.token, body: await run(p.token, { kind: 'daily', day: '2026-10-16' }) });
    expect((await admin('GET', `/v1/admin/pending?after=${b.body.id}`)).body.runs).toEqual([expect.objectContaining({ id: c.body.id, seed: secretSeed })]);
  });

  it('deletes the replay of a rejected run', async () => {
    const p = await newPlayer();
    const id = await submitAndVerify(p.token, {}, 'rejected');
    expect((await admin('GET', `/v1/admin/replay/${id}`)).status).toBe(404);
  });

  it('drops the replay of a verified run that holds no board place', async () => {
    const p = await newPlayer();
    await submitAndVerify(p.token, { wave: 30 });
    const id = await submitAndVerify(p.token, { wave: 5 });
    expect((await admin('GET', `/v1/admin/replay/${id}`)).status).toBe(404);
  });

  it('closes a week: top 10 per tier get a badge, once', async () => {
    const ps = [];
    for (let i = 0; i < 12; i++) ps.push(await newPlayer(`Player${i}`, `10.0.0.${i}`));
    for (const [i, p] of ps.entries()) await submitAndVerify(p.token, { wave: 100 - i });
    await submitAndVerify(ps[0]!.token, { tier: 2, wave: 5 });
    expect((await admin('POST', '/v1/admin/close-week', { week: '2026-10-12' })).body.error).toBe('week-not-over');
    now = Date.parse('2026-10-19T01:00:00Z');
    await call('POST', '/v1/runs', { token: ps[1]!.token, body: await run(ps[1]!.token) }); // pending, but next week's
    const r = await admin('POST', '/v1/admin/close-week', { week: '2026-10-12' });
    expect(r.body).toMatchObject({ closed: true, awarded: 11 });
    expect((await admin('POST', '/v1/admin/close-week', { week: '2026-10-12' })).body.already).toBe(true);
    const me0 = await call('GET', '/v1/players/me', { token: ps[0]!.token });
    expect(me0.body.badges).toBe(2);
    expect(me0.body.badgeHistory).toEqual([
      { week: '2026-10-12', tier: 2, rank: 1, wave: 5 },
      { week: '2026-10-12', tier: 1, rank: 1, wave: 100 },
    ]);
    expect((await call('GET', '/v1/players/me', { token: ps[11]!.token })).body.badges).toBe(0);
  });

  it('refuses to close a week with pending runs', async () => {
    const p = await newPlayer();
    await call('POST', '/v1/runs', { token: p.token, body: await run(p.token) });
    now = Date.parse('2026-10-20T00:00:00Z');
    expect((await admin('POST', '/v1/admin/close-week', { week: '2026-10-12' })).body.error).toBe('week-pending');
  });
});

describe('HTTP', () => {
  it('CORS for allowed origins only; preflight', async () => {
    const ok = await call('GET', '/v1/health', { headers: { origin: 'https://foo.game-files.crazygames.com' } });
    expect(ok.headers.get('access-control-allow-origin')).toBe('https://foo.game-files.crazygames.com');
    const local = await call('GET', '/v1/health', { headers: { origin: 'http://localhost:5173' } });
    expect(local.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
    const bad = await call('GET', '/v1/health', { headers: { origin: 'https://evil.example' } });
    expect(bad.headers.get('access-control-allow-origin')).toBeNull();
    const evil2 = await call('GET', '/v1/health', { headers: { origin: 'https://crazygames.com.evil.example' } });
    expect(evil2.headers.get('access-control-allow-origin')).toBeNull();
    const pre = await handle(new Request('https://lb.test/v1/runs', { method: 'OPTIONS', headers: { origin: 'http://localhost:5180' } }), env, now);
    expect(pre.status).toBe(204);
    expect(pre.headers.get('access-control-allow-headers')).toContain('authorization');
  });

  it('caps small bodies and rejects bad JSON', async () => {
    const p = await newPlayer();
    expect((await call('PATCH', '/v1/players/me', { token: p.token, body: { name: 'x'.repeat(5000) } })).status).toBe(413);
    const r = await handle(new Request('https://lb.test/v1/players', { method: 'POST', body: '{nope' }), env, now);
    expect(r.status).toBe(400);
    expect((await call('GET', '/v1/nope')).status).toBe(404);
  });
});

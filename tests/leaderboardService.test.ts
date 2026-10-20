import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { dailyClaim, dailyRunOptions, dailySeed } from '../src/meta/leaderboardRules';
import { MetaStore, RUN_KEY } from '../src/meta/MetaStore';
import { DEFAULT_META_DATA as MD } from '../src/meta/metaData';
import { settleDaily } from '../src/meta/runEnd';
import { defaultMeta } from '../src/meta/state';
import { LB_KEY, LB_MAX_AGE_MS, LB_QUEUED_START_CAP, LB_START_MAX_AGE_MS, LB_TOKEN_MAX_AGE_MS, startExpired, startTokenPlayer, LB_MAX_TRIES, LB_QUEUE_MAX, LB_ROTATE_AFTER, Leaderboard, nameError, normalizeFriendCode, rankedBuild, type RunSubmission } from '../src/portal/leaderboard';
import { memoryKV } from '../src/portal/storage';
import { RunSession } from '../src/render/RunSession';
import { DEFAULT_DATA, type GameData, STAT_IDS } from '../src/sim/data';
import { hashWorld } from '../src/sim/hash';
import { replayToEnd } from '../src/sim/replay';
import { testData } from './helpers';

interface Call {
  method: string;
  path: string;
  auth: string | null;
  body: Record<string, unknown> | null;
}

/** A scripted API: `handler` answers by method + path (a thrown error = network failure). */
function api(handler: (c: Call, n: number) => { status: number; body?: unknown } | 'offline' | 'hang') {
  const calls: Call[] = [];
  const fetchFn = (async (url: string, init: RequestInit = {}) => {
    const h = (init.headers ?? {}) as Record<string, string>;
    const c: Call = { method: init.method ?? 'GET', path: url.replace(/^https:\/\/lb\.test\/v1/, ''), auth: h.authorization ?? null, body: init.body ? JSON.parse(String(init.body)) : null };
    calls.push(c);
    const r = handler(c, calls.length);
    if (r === 'offline') throw new TypeError('Failed to fetch');
    if (r === 'hang') return new Promise<Response>(() => {});
    return new Response(r.body === undefined ? null : JSON.stringify(r.body), { status: r.status, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
  return { calls, fetchFn };
}

const PLAYER = { id: 'p_1', secret: 's1', name: 'NeonVirus-1', friendCode: 'K7M2QX', portal: 'local', linked: false, badges: 0 };
const SUB: RunSubmission = { kind: 'tier', tier: 1, day: null, wave: 12, ticks: 3456, hash: 'deadbeef', commit: 'a'.repeat(40), replay: JSON.stringify({ v: 1, seed: 1, tier: 1, claim: {}, log: [] }) };

/** A start token as the server shapes it: b64url(JSON payload) + '.' + a 43-character MAC. */
function startToken(p: string, s: number): string {
  return `${Buffer.from(JSON.stringify({ v: 1, p, k: 'tier', d: null, s, a: 1 })).toString('base64url')}.${'M'.repeat(43)}`;
}

/** An API that registers PLAYER (id per `ids`) and issues starts with increasing seeds; `starts` lists the kinds asked for. */
function startApi(opts: { ids?: () => string; down?: () => 'offline' | number | null; day?: string } = {}) {
  let seed = 100;
  const starts: string[] = [];
  const a = api((c) => {
    const d = opts.down?.() ?? null;
    if (d === 'offline') return 'offline';
    if (c.path === '/players') return { status: 201, body: { ...PLAYER, id: opts.ids?.() ?? PLAYER.id } };
    if (c.path === '/runs/start') {
      if (typeof d === 'number') return { status: d, body: { error: 'ranked-disabled' } };
      const kind = String(c.body?.kind);
      starts.push(kind);
      const pid = String(c.auth).slice(7).split('.')[0]!;
      seed += 1;
      return { status: 200, body: { kind, day: kind === 'daily' ? (opts.day ?? '1970-01-01') : null, seed, startedAt: 5000, token: startToken(pid, seed) } };
    }
    if (c.path === '/runs') return { status: 202, body: { id: 9, status: 'pending' } };
    if (c.path === '/players/me' && c.method === 'DELETE') return { status: 200, body: { deleted: true } };
    return { status: 404, body: { error: 'nope' } };
  });
  return { ...a, starts };
}

function lbWith(kv: ReturnType<typeof memoryKV>, fetchFn: typeof fetch, extra: Partial<ConstructorParameters<typeof Leaderboard>[0]> = {}) {
  return new Leaderboard({ base: 'https://lb.test/', kv, portal: 'local', fetch: fetchFn, now: () => 1000, timeoutMs: 50, ...extra });
}

describe('Leaderboard service', () => {
  it('registers once, keeps the identity in its save slot and signs calls with id.secret', async () => {
    const kv = memoryKV();
    const { calls, fetchFn } = api((c) => (c.path === '/players' ? { status: 201, body: PLAYER } : { status: 200, body: { board: 't:1', scope: 'global', total: 0, entries: [], me: null } }));
    const lb = lbWith(kv, fetchFn);
    const [a, b] = await Promise.all([lb.ensurePlayer(), lb.ensurePlayer()]);
    expect(a?.id).toBe('p_1');
    expect(b).toBe(a);
    expect(calls.filter((c) => c.path === '/players')).toHaveLength(1);
    expect(calls[0]!.body).toEqual({ portal: 'local' });
    const r = await lb.board('tier', 2, 'friends', 500);
    expect(r.ok).toBe(true);
    expect(calls.at(-1)).toMatchObject({ method: 'GET', path: '/boards/tier/2?scope=friends&limit=100', auth: 'Bearer p_1.s1' });
    // A new session reuses the saved identity.
    const lb2 = lbWith(kv, fetchFn);
    expect((await lb2.ensurePlayer())?.secret).toBe('s1');
    expect(calls.filter((c) => c.path === '/players')).toHaveLength(1);
    expect(kv.getItem(LB_KEY)).toContain('p_1');
  });

  it('is fail-soft: offline, 5xx and a hung request resolve to errors, never throw', async () => {
    const off = lbWith(memoryKV(), api(() => 'offline').fetchFn);
    expect(await off.daily()).toEqual({ ok: false, status: 0, error: 'offline' });
    expect(off.health).toBe('offline');
    const down = lbWith(memoryKV(), api(() => ({ status: 503, body: { error: 'x' } })).fetchFn);
    // The server's error code is kept (e.g. 'cg-disabled' decides the CrazyGames fallback).
    expect(await down.daily()).toMatchObject({ ok: false, status: 503, error: 'x' });
    const hung = lbWith(memoryKV(), api(() => 'hang').fetchFn);
    const t0 = Date.now();
    expect(await hung.daily()).toMatchObject({ ok: false, status: 0, error: 'timeout' });
    expect(Date.now() - t0).toBeLessThan(1000);
    // No server URL → disabled, nothing is fetched.
    const { calls, fetchFn } = api(() => ({ status: 200, body: {} }));
    const none = new Leaderboard({ base: '', kv: memoryKV(), portal: 'local', fetch: fetchFn });
    expect(none.enabled).toBe(false);
    expect((await none.submit(SUB)).state).toBe('dropped');
    expect(calls).toHaveLength(0);
  });

  it('queues runs offline, keeps the queue across reloads and uploads it later (gzip replay)', async () => {
    const kv = memoryKV();
    let online = false;
    const { calls, fetchFn } = api((c) => {
      if (!online) return 'offline';
      if (c.path === '/players') return { status: 201, body: PLAYER };
      if (c.path === '/runs') return { status: 202, body: { id: 7, status: 'pending' } };
      return { status: 404, body: { error: 'nope' } };
    });
    const lb = lbWith(kv, fetchFn);
    const o = await lb.submit(SUB);
    expect(o.state).toBe('queued');
    expect(lb.queued).toHaveLength(1);
    // Reload: the queue is still there; once online, flush registers and uploads.
    online = true;
    const lb2 = lbWith(kv, fetchFn);
    lb2.load();
    expect(lb2.queued).toHaveLength(1);
    await lb2.flush();
    expect(lb2.queued).toHaveLength(0);
    expect(lb2.outcome('deadbeef:3456')).toMatchObject({ state: 'pending', id: 7 });
    expect(lb2.unverified()).toHaveLength(1);
    const sent = calls.find((c) => c.path === '/runs')!;
    expect(sent.auth).toBe('Bearer p_1.s1');
    expect(sent.body).toMatchObject({ kind: 'tier', tier: 1, wave: 12, ticks: 3456, hash: 'deadbeef', commit: 'a'.repeat(40) });
    const replay = String(sent.body!.replay);
    expect(replay.startsWith('gz:')).toBe(true);
    expect(JSON.parse(gunzipSync(Buffer.from(replay.slice(3), 'base64')).toString('utf8'))).toEqual(JSON.parse(SUB.replay));
  });

  it('drops permanent refusals, keeps transient ones, and does not queue the same run twice', async () => {
    const kv = memoryKV();
    let runStatus = 429;
    const { calls, fetchFn } = api((c) => (c.path === '/players' ? { status: 201, body: PLAYER } : { status: runStatus, body: { error: runStatus === 429 ? 'rate-limited' : 'bad-day' } }));
    const lb = lbWith(kv, fetchFn);
    expect((await lb.submit(SUB)).state).toBe('queued');
    await lb.submit(SUB);
    expect(lb.queued).toHaveLength(1);
    runStatus = 400;
    await lb.flush();
    expect(lb.queued).toHaveLength(0);
    expect(lb.outcome('deadbeef:3456')).toMatchObject({ state: 'dropped', error: 'bad-day' });
    expect(calls.filter((c) => c.path === '/runs')).toHaveLength(3);
  });

  it('a rejected credential re-registers once and retries', async () => {
    const kv = memoryKV();
    let n = 0;
    const { calls, fetchFn } = api((c) => {
      if (c.path === '/players') return { status: 201, body: { ...PLAYER, id: `p_${++n}` } };
      return c.auth === 'Bearer p_1.s1' ? { status: 401, body: { error: 'auth' } } : { status: 200, body: { code: 'K7M2QX', following: [] } };
    });
    const lb = lbWith(kv, fetchFn);
    const r = await lb.friends();
    expect(r.ok).toBe(true);
    expect(lb.identity?.id).toBe('p_2');
    expect(calls.map((c) => c.path)).toEqual(['/players', '/friends', '/players', '/friends']);
  });

  it('a failed re-register keeps the saved identity (it is retried later, never wiped)', async () => {
    const kv = memoryKV();
    let reg = 0;
    const { fetchFn } = api((c) => {
      if (c.path === '/players') return ++reg === 1 ? { status: 201, body: PLAYER } : { status: 503, body: { error: 'down' } };
      return { status: 401, body: { error: 'auth' } };
    });
    const lb = lbWith(kv, fetchFn);
    expect((await lb.friends()).ok).toBe(false);
    expect(lb.identity?.id).toBe('p_1');
    const lb2 = lbWith(kv, fetchFn);
    lb2.load();
    expect(lb2.identity?.id).toBe('p_1');
  });

  it('compresses a replay before it is first saved and trims the queue to its cap', async () => {
    const kv = memoryKV();
    const lb = lbWith(kv, api(() => 'offline').fetchFn);
    await lb.submit(SUB);
    expect(lb.queued[0]!.replay.startsWith('gz:')).toBe(true);
    expect(kv.getItem(LB_KEY)).not.toContain('"log":[]');
    for (let i = 1; i <= LB_QUEUE_MAX; i++) await lb.submit({ ...SUB, hash: `h${i}` });
    expect(lb.queued).toHaveLength(LB_QUEUE_MAX);
    expect(lb.queued.some((q) => q.hash === 'deadbeef')).toBe(false);
    expect(lb.outcome('deadbeef:3456')).toMatchObject({ state: 'dropped', error: 'queue-full' });
  });

  it('offline does not count as a try; failures do, rotate a stuck run to the back and finally give up', async () => {
    const kv = memoryKV();
    let online = false;
    let t = 1000;
    const { calls, fetchFn } = api((c) => {
      if (!online) return 'offline';
      if (c.path === '/players') return { status: 201, body: PLAYER };
      return c.body!.hash === 'deadbeef' ? { status: 503, body: { error: 'down' } } : { status: 202, body: { id: 9, status: 'pending' } };
    });
    const lb = lbWith(kv, fetchFn, { now: () => t });
    const tries = () => (lb as unknown as { state: { queue: { tries: number }[] } }).state.queue.map((q) => q.tries);
    await lb.submit(SUB);
    await lb.submit({ ...SUB, hash: 'second' });
    for (let i = 0; i < 5; i++) await lb.flush();
    expect(tries()).toEqual([0, 0]);
    online = true;
    for (let i = 0; i < LB_ROTATE_AFTER; i++) await lb.flush();
    // The stuck run went to the back after LB_ROTATE_AFTER tries; the next flush uploads the other one.
    expect(lb.queued.map((q) => q.hash)).toEqual(['second', 'deadbeef']);
    await lb.flush();
    expect(lb.outcome('second:3456')).toMatchObject({ state: 'pending', id: 9 });
    expect(lb.queued.map((q) => q.hash)).toEqual(['deadbeef']);
    while (lb.queued.length > 0 && calls.length < 200) await lb.flush();
    expect(tries()).toEqual([]);
    expect(lb.outcome('deadbeef:3456')).toMatchObject({ state: 'dropped', error: 'gave up: down' });
    expect(calls.filter((c) => c.path === '/runs' && c.body!.hash === 'deadbeef')).toHaveLength(LB_MAX_TRIES);
    // A run older than LB_MAX_AGE_MS is given up on at its next failure.
    await lb.submit({ ...SUB, hash: 'deadbeef', ticks: 1 });
    expect(lb.queued).toHaveLength(1);
    t += LB_MAX_AGE_MS + 1;
    await lb.flush();
    expect(lb.queued).toHaveLength(0);
    expect(lb.outcome('deadbeef:1')).toMatchObject({ state: 'dropped', error: 'gave up: down' });
  });

  it('links a signed-in CrazyGames account with its token', async () => {
    const { calls, fetchFn } = api(() => ({ status: 200, body: { ...PLAYER, name: 'CgUser', portal: 'crazygames', linked: true } }));
    const lb = lbWith(memoryKV(), fetchFn, { portal: 'crazygames', portalUser: async () => ({ username: 'CgUser', token: 'jwt' }) });
    const id = await lb.ensurePlayer();
    expect(calls[0]!.body).toEqual({ portal: 'crazygames', cgToken: 'jwt' });
    expect(id).toMatchObject({ name: 'CgUser', linked: true });
    // Linked names come from the portal: no rename round-trip needed to know it.
    expect(id?.linked).toBe(true);
  });

  it('rename / friend codes are checked before any request; delete forgets the identity', async () => {
    const { calls, fetchFn } = api((c) => (c.path === '/players' ? { status: 201, body: PLAYER } : c.method === 'PATCH' ? { status: 200, body: { name: c.body!.name } } : { status: 200, body: { deleted: true } }));
    const lb = lbWith(memoryKV(), fetchFn);
    expect(await lb.rename('x')).toMatchObject({ ok: false, status: 400 });
    expect(calls).toHaveLength(0);
    expect(await lb.addFriend('abc')).toMatchObject({ ok: false, error: 'bad-code' });
    expect((await lb.rename('  Neo   Byte ')).ok).toBe(true);
    expect(calls.at(-1)!.body).toEqual({ name: 'Neo Byte' });
    expect(lb.identity?.name).toBe('Neo Byte');
    expect(await lb.addFriend('k7m-2qx')).toMatchObject({ ok: false, error: 'self' });
    expect((await lb.deleteMe()).ok).toBe(true);
    expect(calls.at(-1)).toMatchObject({ method: 'DELETE', path: '/players/me' });
    expect(lb.identity).toBeNull();
  });

  it('client-side rules mirror the server', () => {
    expect(nameError('NeonVirus-4821')).toBeNull();
    expect(nameError('ab')).not.toBeNull();
    expect(nameError('_abc')).not.toBeNull();
    expect(nameError('a'.repeat(21))).not.toBeNull();
    expect(normalizeFriendCode(' k7m-2qx ')).toBe('K7M2QX');
    expect(normalizeFriendCode('K7M2Q0')).toBeNull(); // 0 is not in the alphabet
    expect(rankedBuild('0123456789abcdef0123456789abcdef01234567')).toBe(true);
    expect(rankedBuild('0123456789abcdef0123456789abcdef01234567-dirty')).toBe(false);
    expect(rankedBuild('unknown')).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------- daily + resume

describe('server-issued run starts (client pool)', () => {
  it('prefetch stores one start per kind (single flight) and it survives a reload', async () => {
    const kv = memoryKV();
    const { calls, fetchFn, starts } = startApi();
    const lb = lbWith(kv, fetchFn);
    await Promise.all([lb.prefetchStart('tier'), lb.prefetchStart('tier')]);
    await lb.prefetchStart('tier');
    expect(starts).toEqual(['tier']);
    expect(calls.find((c) => c.path === '/runs/start')).toMatchObject({ method: 'POST', auth: 'Bearer p_1.s1', body: { kind: 'tier' } });
    const lb2 = lbWith(kv, fetchFn);
    const st = lb2.takeStart('tier', null);
    expect(st).toMatchObject({ kind: 'tier', day: null, seed: 101, startedAt: 5000, gotAt: 1000 });
    expect(startTokenPlayer(st!.token)).toBe('p_1');
    expect(startTokenPlayer('garbage')).toBeNull();
  });

  it('takeStart consumes a start once and refills the pool in the background', async () => {
    const { fetchFn, starts } = startApi();
    const lb = lbWith(memoryKV(), fetchFn);
    await lb.prefetchStart('tier');
    const a = lb.takeStart('tier', null);
    expect(a?.seed).toBe(101);
    // Nothing pooled until the refill lands: the next run would be unranked, never blocked.
    expect(lb.takeStart('daily', '1970-01-01')).toBeNull();
    await lb.prefetchStart('tier');
    await lb.prefetchStart('daily');
    expect(starts).toEqual(['tier', 'tier', 'daily']);
    const b = lb.takeStart('tier', null);
    expect(b?.seed).toBe(102);
    expect(b?.token).not.toBe(a?.token);
  });

  it('stale starts are discarded; a daily of another day is not taken but stays pooled for its own day', async () => {
    let t = 1000;
    const { fetchFn } = startApi({ day: '1970-01-01' });
    const lb = lbWith(memoryKV(), fetchFn, { now: () => t });
    await lb.prefetchStart('tier');
    await lb.prefetchStart('daily');
    // A RETRY of yesterday's challenge must not throw today's start away.
    expect(lb.takeStart('daily', '1969-12-31')).toBeNull();
    expect(lb.takeStart('daily', '1970-01-01')?.day).toBe('1970-01-01');
    t += LB_START_MAX_AGE_MS;
    expect(lb.takeStart('tier', null)).toBeNull();
  });

  it('a pooled start is used for days (Home left open), well inside the token age', async () => {
    let t = 1000;
    const { fetchFn } = startApi();
    const lb = lbWith(memoryKV(), fetchFn, { now: () => t });
    await lb.prefetchStart('tier');
    t += 3 * 86_400_000;
    expect(lb.takeStart('tier', null)?.seed).toBe(101);
    expect(LB_START_MAX_AGE_MS).toBeGreaterThanOrEqual(7 * 86_400_000);
    expect(LB_START_MAX_AGE_MS * 2).toBeLessThanOrEqual(LB_TOKEN_MAX_AGE_MS);
  });

  it('a run is unranked once its start is a day short of the token age', () => {
    expect(startExpired(0, LB_TOKEN_MAX_AGE_MS - 86_400_001)).toBe(false);
    expect(startExpired(0, LB_TOKEN_MAX_AGE_MS - 86_400_000)).toBe(true);
  });

  it('after a CrazyGames link changes the id, queued runs upload with the old credential; a refused one is dropped clearly', async () => {
    const kv = memoryKV();
    let online = false;
    let refuseOld = false;
    const { calls, fetchFn } = api((c) => {
      if (!online) return 'offline';
      if (c.path === '/players') return { status: 201, body: c.body?.cgToken ? { ...PLAYER, id: 'p_cg', secret: 'scg', linked: true } : PLAYER };
      if (c.path === '/runs') return refuseOld && c.auth === 'Bearer p_1.s1' ? { status: 401, body: { error: 'auth' } } : { status: 202, body: { id: 9, status: 'pending' } };
      return { status: 404, body: { error: 'nope' } };
    });
    // An anonymous player (no portal account yet) queues a run on its own start while offline.
    online = true;
    const anon = lbWith(kv, fetchFn);
    await anon.ensurePlayer();
    online = false;
    expect((await anon.submit({ ...SUB, token: startToken('p_1', 7) })).state).toBe('queued');
    expect((await anon.submit({ ...SUB, hash: 'cafef00d', token: startToken('p_1', 8) })).state).toBe('queued');
    // Next session: signed in to CrazyGames → linked as a new player; the queue still goes up as p_1.
    online = true;
    const lb = lbWith(kv, fetchFn, { portal: 'crazygames', portalUser: async () => ({ username: 'CgUser', token: 'jwt' }) });
    lb.load();
    const before = calls.length;
    await lb.flush();
    expect(lb.identity?.id).toBe('p_cg');
    expect(calls.slice(before).filter((c) => c.path === '/runs').map((c) => c.auth)).toEqual(['Bearer p_1.s1', 'Bearer p_1.s1']);
    expect(lb.outcome('deadbeef:3456')?.state).toBe('pending');
    // The old credential refused (or a token of a third player): dropped as 'identity-changed', not 'bad-token'.
    refuseOld = true;
    expect(await lb.submit({ ...SUB, hash: '0badf00d', token: startToken('p_1', 9) })).toMatchObject({ state: 'dropped', error: 'identity-changed' });
    expect(await lb.submit({ ...SUB, hash: '0badf00e', token: startToken('p_zz', 9) })).toMatchObject({ state: 'dropped', error: 'identity-changed' });
    expect(calls.filter((c) => c.path === '/runs' && c.auth === 'Bearer p_cg.scg')).toHaveLength(0);
  });

  it('the pre-link identity is kept while a saved run holds its start, then forgotten; delete removes it server-side too', async () => {
    const kv = memoryKV();
    const { calls, fetchFn } = api((c) => {
      if (c.path === '/players') return { status: 201, body: c.body?.cgToken ? { ...PLAYER, id: 'p_cg', secret: 'scg', linked: true } : PLAYER };
      if (c.path === '/runs') return { status: 202, body: { id: 9, status: 'pending' } };
      if (c.path === '/players/me' && c.method === 'DELETE') return { status: 200, body: { deleted: true } };
      return { status: 404, body: { error: 'nope' } };
    });
    await lbWith(kv, fetchFn).ensurePlayer();
    let saved: string | null = startToken('p_1', 3);
    const lb = lbWith(kv, fetchFn, { portal: 'crazygames', portalUser: async () => ({ username: 'CgUser', token: 'jwt' }), savedStartToken: () => saved });
    await lb.submit({ ...SUB, token: startToken('p_1', 7) });
    expect(lb.identity?.id).toBe('p_cg');
    // The resumed run still needs the old credential.
    expect(JSON.parse(kv.getItem(LB_KEY)!).data.prev?.id).toBe('p_1');
    // Delete my data: both players go, the old one with its own credential.
    expect((await lb.deleteMe()).ok).toBe(true);
    expect(calls.filter((c) => c.method === 'DELETE').map((c) => c.auth)).toEqual(['Bearer p_1.s1', 'Bearer p_cg.scg']);
    // Nothing left to upload as the old player: it is forgotten after the next flush.
    const kv2 = memoryKV();
    await lbWith(kv2, fetchFn).ensurePlayer();
    const lb2 = lbWith(kv2, fetchFn, { portal: 'crazygames', portalUser: async () => ({ username: 'CgUser', token: 'jwt' }), savedStartToken: () => saved });
    await lb2.submit({ ...SUB, token: startToken('p_1', 7) });
    expect(JSON.parse(kv2.getItem(LB_KEY)!).data.prev?.id).toBe('p_1');
    saved = null;
    await lb2.flush();
    expect(JSON.parse(kv2.getItem(LB_KEY)!).data.prev).toBeNull();
  });

  it('no start is fetched for a kind while its queued runs could lose theirs to newer starts', async () => {
    let online = false;
    const { fetchFn, starts } = startApi({ down: () => (online ? null : 'offline') });
    const lb = lbWith(memoryKV(), fetchFn);
    for (let i = 0; i < LB_QUEUED_START_CAP; i++) await lb.submit({ ...SUB, hash: `0000000${i}`, token: startToken('p_1', i) });
    online = true;
    // Uploads still failing (a 429 too-many-pending), starts still issued: none is taken for this kind.
    await lb.prefetchStart('tier');
    expect(starts).toEqual([]);
    await lb.prefetchStart('daily');
    expect(starts).toEqual(['daily']);
    expect(LB_QUEUED_START_CAP).toBe(3);
  });

  it('disabled, offline or ranked-disabled (503) gives no start, silently', async () => {
    const none = new Leaderboard({ base: '', kv: memoryKV(), portal: 'local', fetch: startApi().fetchFn });
    await none.prefetchStart('tier');
    expect(none.takeStart('tier', null)).toBeNull();
    const off = lbWith(memoryKV(), startApi({ down: () => 'offline' }).fetchFn);
    await off.prefetchStart('tier');
    expect(off.takeStart('tier', null)).toBeNull();
    const down = lbWith(memoryKV(), startApi({ down: () => 503 }).fetchFn);
    await down.prefetchStart('daily');
    expect(down.takeStart('daily', null)).toBeNull();
  });

  it('a queued run keeps its token across a reload', async () => {
    const kv = memoryKV();
    let online = false;
    const { calls, fetchFn } = startApi({ down: () => (online ? null : 'offline') });
    const lb = lbWith(kv, fetchFn);
    expect((await lb.submit({ ...SUB, token: 'tok.en' })).state).toBe('queued');
    online = true;
    const lb2 = lbWith(kv, fetchFn);
    lb2.load();
    expect(lb2.queued[0]?.token).toBe('tok.en');
    await lb2.flush();
    expect(calls.find((c) => c.path === '/runs')?.body).toMatchObject({ token: 'tok.en' });
  });

  it('a new identity (re-register after a 401) clears the pool', async () => {
    let n = 0;
    let refuse = false;
    const kv = memoryKV();
    const a = startApi({ ids: () => `p_${++n}` });
    const fetchFn = (async (url: string, init?: RequestInit) => {
      if (refuse && String(url).endsWith('/friends')) {
        refuse = false;
        return new Response(JSON.stringify({ error: 'auth' }), { status: 401 });
      }
      return a.fetchFn(url, init);
    }) as unknown as typeof fetch;
    const lb = lbWith(kv, fetchFn);
    await lb.prefetchStart('tier');
    expect(JSON.parse(kv.getItem(LB_KEY)!).data.starts).toHaveLength(1);
    refuse = true;
    await lb.friends();
    expect(lb.identity?.id).toBe('p_2');
    expect(JSON.parse(kv.getItem(LB_KEY)!).data.starts).toEqual([]);
    // A start fetched for someone else than the current player is not pooled.
    const b = lbWith(memoryKV(), api((c) => (c.path === '/players' ? { status: 201, body: PLAYER } : { status: 200, body: { kind: 'tier', day: null, seed: 5, startedAt: 1, token: startToken('p_x', 5) } })).fetchFn);
    await b.prefetchStart('tier');
    expect(b.takeStart('tier', null)).toBeNull();
  });

  it('delete forgets pooled starts', async () => {
    const kv = memoryKV();
    const { fetchFn } = startApi();
    const lb = lbWith(kv, fetchFn);
    await lb.prefetchStart('tier');
    await lb.deleteMe();
    expect(JSON.parse(kv.getItem(LB_KEY)!).data.starts).toEqual([]);
  });
});

const hard = (): GameData =>
  testData({ enemies: { basic: { damage: 240 }, fast: { damage: 160 }, tank: { damage: 640 }, ranged: { damage: 320 }, boss: { damage: 800 } } }, { health: 2000 });

/** Plays `s` with a fixed command pattern until death or `untilTick`. */
function drive(s: RunSession, untilTick: number): void {
  let i = s.log.length;
  while (!s.world.dead && s.world.tick < untilTick) {
    s.advance(9, () => {});
    if (s.picking) {
      s.queue(s.world.bootOffer.length > 0 ? { type: 'pickBoot', index: 0 } : { type: 'pickPerk', index: 0 });
      s.applyPendingNow(() => {});
    }
    s.queue({ type: 'buy', stat: STAT_IDS[i++ % STAT_IDS.length]!, count: 1 });
  }
}

describe('daily challenge', () => {
  it('the same day gives the same seed, loadout and (with the same inputs) the same run', () => {
    const day = '2026-10-16';
    const data = hard();
    const a = dailyRunOptions(day, data, MD);
    expect(a).toEqual(dailyRunOptions(day, data, MD));
    expect(a.seed).toBe(dailySeed(day));
    expect(dailyClaim(day)).toEqual(dailyClaim(day));
    expect(dailyRunOptions('2026-10-17', data, MD).seed).not.toBe(a.seed);
    const s1 = new RunSession(data, a);
    const s2 = new RunSession(data, dailyRunOptions(day, data, MD));
    drive(s1, 40000);
    drive(s2, 40000);
    expect(s1.world.dead).toBe(true);
    expect(hashWorld(s1.world)).toBe(hashWorld(s2.world));
    // The player's own meta does not leak into the daily run.
    const m = defaultMeta();
    m.workshop = { damage: 50 };
    expect(dailyRunOptions(day, data, MD)).toEqual(a);
  });

  it('a daily run pays Bits (× labs) and Keys only', () => {
    const m = defaultMeta();
    const before = structuredClone(m);
    const s = settleDaily(m, MD, { bits: 1000, keys: 2.7, doubled: false }, '2026-10-16', 1);
    expect(s).toMatchObject({ keys: 2, milestones: [], newBest: false, tierUnlocked: 0 });
    expect(s.unpaid).toBeUndefined();
    expect(m.bits).toBe(before.bits + s.bits);
    expect(m.best).toEqual(before.best);
    expect(m.milestones).toEqual(before.milestones);
  });

  it('only the first paid attempts of a day pay; a new day pays again', () => {
    const m = defaultMeta();
    const r = { bits: 1000, keys: 3, doubled: false };
    expect(settleDaily(m, MD, r, '2026-10-16', 1).bits).toBeGreaterThan(0);
    const bits = m.bits;
    const keys = m.keys;
    const again = settleDaily(m, MD, r, '2026-10-16', 1);
    expect(again).toMatchObject({ bits: 0, keys: 0, unpaid: true });
    expect([m.bits, m.keys]).toEqual([bits, keys]);
    expect(settleDaily(m, MD, r, '2026-10-17', 1).unpaid).toBeUndefined();
    expect(m.bits).toBeGreaterThan(bits);
  });
});

describe('resumed runs keep a complete replay', () => {
  it('log + claim survive the run save; the resumed run replays to the same hash', () => {
    const day = '2026-10-16';
    const data = hard();
    const opts = dailyRunOptions(day, data, MD);
    const kv = memoryKV();
    const store = new MetaStore(kv, data, MD, () => 0);
    const s = new RunSession(data, opts);
    drive(s, 600);
    expect(s.world.dead).toBe(false);
    const start = { token: 'tok.en', seed: opts.seed, startedAt: 1234 };
    store.saveRun(s.world, s.opts, undefined, { log: s.log, claim: dailyClaim(day), board: { kind: 'daily', day }, commit: 'abc1234', start });
    const saved = new MetaStore(kv, data, MD, () => 0).loadRun()!;
    expect(saved.start).toEqual(start);
    expect(saved.board).toEqual({ kind: 'daily', day });
    expect(saved.claim).toEqual(dailyClaim(day));
    expect(saved.commit).toBe('abc1234');
    const r = new RunSession(data, saved.opts);
    r.adopt(saved.world, saved.opts);
    r.log = saved.log!;
    drive(r, 40000);
    expect(r.world.dead).toBe(true);
    const re = replayToEnd(data, opts, r.log, r.world.tick);
    expect(hashWorld(re)).toBe(hashWorld(r.world));
  });

  it('a v1 run save (before leaderboards) migrates and resumes unranked', () => {
    const data = DEFAULT_DATA;
    const kv = memoryKV();
    const store = new MetaStore(kv, data, MD, () => 0);
    const s = new RunSession(data, { seed: 3, tier: 1 });
    s.advance(30, () => {});
    store.saveRun(s.world, s.opts);
    // Rewrite as the old envelope: version 1, no log / claim / board.
    const env = JSON.parse(kv.getItem(RUN_KEY)!) as { v: number; data: Record<string, unknown> };
    delete env.data.log;
    delete env.data.claim;
    delete env.data.board;
    kv.setItem(RUN_KEY, JSON.stringify({ ...env, v: 1 }));
    const run = new MetaStore(kv, data, MD, () => 0).loadRun();
    expect(run).not.toBeNull();
    expect(run!.log).toBeNull();
    expect(run!.claim).toBeNull();
    expect(run!.board).toBeNull();
    expect(run!.start).toBeNull();
    expect(run!.world.tick).toBe(s.world.tick);
  });
});

describe('run saves and server starts', () => {
  it('a v2 run save without a start (before server starts) loads with start null; a bad one is dropped', () => {
    const kv = memoryKV();
    const store = new MetaStore(kv, DEFAULT_DATA, MD, () => 0);
    const s = new RunSession(DEFAULT_DATA, { seed: 3, tier: 1 });
    s.advance(30, () => {});
    store.saveRun(s.world, s.opts, undefined, { log: s.log, claim: null, board: { kind: 'tier', day: null }, commit: 'abc', start: { token: 't.k', seed: 3, startedAt: 9 } });
    const env = JSON.parse(kv.getItem(RUN_KEY)!) as { v: number; data: Record<string, unknown> };
    expect(env.v).toBe(2);
    expect(new MetaStore(kv, DEFAULT_DATA, MD, () => 0).loadRun()!.start).toEqual({ token: 't.k', seed: 3, startedAt: 9 });
    delete env.data.start;
    kv.setItem(RUN_KEY, JSON.stringify(env));
    expect(new MetaStore(kv, DEFAULT_DATA, MD, () => 0).loadRun()!.start).toBeNull();
    kv.setItem(RUN_KEY, JSON.stringify({ ...env, data: { ...env.data, start: { token: 5, seed: 'x' } } }));
    expect(new MetaStore(kv, DEFAULT_DATA, MD, () => 0).loadRun()!.start).toBeNull();
  });
});

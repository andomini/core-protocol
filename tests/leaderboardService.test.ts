import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { dailyClaim, dailyRunOptions, dailySeed } from '../src/meta/leaderboardRules';
import { MetaStore, RUN_KEY } from '../src/meta/MetaStore';
import { DEFAULT_META_DATA as MD } from '../src/meta/metaData';
import { settleDaily } from '../src/meta/runEnd';
import { defaultMeta } from '../src/meta/state';
import { LB_KEY, Leaderboard, nameError, normalizeFriendCode, rankedBuild, type RunSubmission } from '../src/portal/leaderboard';
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
    expect(await down.daily()).toMatchObject({ ok: false, status: 503, error: 'unavailable' });
    const hung = lbWith(memoryKV(), api(() => 'hang').fetchFn);
    const t0 = Date.now();
    expect(await hung.daily()).toMatchObject({ ok: false, status: 0, error: 'offline' });
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

const hard = (): GameData =>
  testData({ enemies: { basic: { damage: 240 }, fast: { damage: 160 }, tank: { damage: 640 }, ranged: { damage: 320 }, boss: { damage: 800 } } }, { health: 2000 });

/** Plays `s` with a fixed command pattern until death or `untilTick`. */
function drive(s: RunSession, untilTick: number): void {
  let i = s.log.length;
  while (!s.world.dead && s.world.tick < untilTick) {
    s.advance(9, () => {});
    if (s.picking) {
      s.queue({ type: 'pickPerk', index: 0 });
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
    const s = settleDaily(m, MD, { bits: 1000, keys: 2.7, doubled: false });
    expect(s).toMatchObject({ keys: 2, milestones: [], newBest: false, tierUnlocked: 0 });
    expect(m.bits).toBe(before.bits + s.bits);
    expect(m.best).toEqual(before.best);
    expect(m.milestones).toEqual(before.milestones);
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
    store.saveRun(s.world, s.opts, undefined, { log: s.log, claim: dailyClaim(day), board: { kind: 'daily', day } });
    const saved = new MetaStore(kv, data, MD, () => 0).loadRun()!;
    expect(saved.board).toEqual({ kind: 'daily', day });
    expect(saved.claim).toEqual(dailyClaim(day));
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
    expect(run!.world.tick).toBe(s.world.tick);
  });
});

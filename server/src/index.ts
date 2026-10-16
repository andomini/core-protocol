// Core Protocol leaderboards: a Cloudflare Worker over D1 (spec docs/superpowers/specs/2026-10-16-leaderboards-design.md).
// The Worker never replays a run (free plan: 10 ms CPU): submissions are stored as 'pending' and the owner's
// verifier (server/verifier/verify.ts) replays them with the build's own sim, then posts a verdict here.
import type { D1PreparedStatement, Env } from './db';
import { verifyCgToken } from './crazygames';
import { CODE_ALPHABET, newSecret, randomInt, randomString, safeEqual, sha256Hex } from './crypto';
import { corsHeaders, errorResponse, HttpError, json, MAX_REPLAY, MAX_RUN_BODY, readJson } from './http';
import { autoName, checkName, nameFromPortal } from './names';
import { limit, LIMITS, peek, purgeRate } from './rate';
import { DAY_MS, dailySeed, dayIndex, dayKey, isMonday, weekKey } from './time';

export type { Env } from './db';

const PORTALS = ['local', 'crazygames', 'poki'] as const;
const MAX_TIER = 50;
const MAX_PENDING = 20;
const MAX_FOLLOWS = 100;
const BADGE_TOP = 10;
/** Device secrets kept per player in `secrets` (besides players.secret_hash). */
const MAX_SECRETS = 5;

/**
 * The seed of a day's challenge. With DAILY_SECRET set it is an HMAC of the day, so nobody can compute (and
 * pre-play) tomorrow's run; the client gets it from GET /v1/daily, the verifier from /v1/admin/pending.
 * Without the secret it is the public FNV seed the game can also compute offline.
 */
export async function daySeed(env: Env, day: string): Promise<number> {
  if (!env.DAILY_SECRET) return dailySeed(day);
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(env.DAILY_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(`core-protocol:daily:${day}`)));
  return ((mac[0]! << 24) | (mac[1]! << 16) | (mac[2]! << 8) | mac[3]!) >>> 0 || 1;
}

/** A replay string worth storing: JSON text, or "gz:" + base64. Anything else is refused before it costs D1 space. */
function replayShapeOk(s: string): boolean {
  if (s.startsWith('gz:')) return s.length > 3 && /^[A-Za-z0-9+/]+={0,2}$/.test(s.slice(3));
  return s.startsWith('{') && s.endsWith('}');
}

interface Player {
  id: string;
  name: string;
  friend_code: string;
  portal: string;
  cg_user_id: string | null;
  verified_bits: number;
  badges: number;
  banned: number;
  renamed_at: number | null;
}

interface Ctx {
  req: Request;
  env: Env;
  now: number;
  url: URL;
}

const int = (x: unknown, lo: number, hi: number): x is number => typeof x === 'number' && Number.isInteger(x) && x >= lo && x <= hi;

function nameError(e: unknown): HttpError {
  return new HttpError(400, e instanceof Error ? e.message : 'name-charset');
}

// ---------------------------------------------------------------- auth

/** `Authorization: Bearer <playerId>.<secret>` → the player (401 if present but wrong; null if absent and optional). */
async function auth(c: Ctx, required: true): Promise<Player>;
async function auth(c: Ctx, required: false): Promise<Player | null>;
async function auth(c: Ctx, required: boolean): Promise<Player | null> {
  const h = c.req.headers.get('authorization') ?? '';
  const m = /^Bearer (p_[a-z0-9]{8,32})\.([A-Za-z0-9_-]{20,64})$/.exec(h);
  if (!m) {
    if (!required && h === '') return null;
    throw new HttpError(401, 'auth');
  }
  const row = await c.env.DB.prepare('SELECT * FROM players WHERE id = ?1').bind(m[1]).first<Player & { secret_hash: string }>();
  if (!row) throw new HttpError(401, 'auth');
  const hash = await sha256Hex(m[2]!);
  if (row.secret_hash !== hash) {
    // Another device of the same CrazyGames account (each re-register adds a secret instead of replacing it).
    const other = row.cg_user_id !== null ? await c.env.DB.prepare('SELECT 1 AS ok FROM secrets WHERE player_id = ?1 AND hash = ?2').bind(row.id, hash).first() : null;
    if (!other) throw new HttpError(401, 'auth');
  }
  if (row.banned) throw new HttpError(403, 'banned');
  return row;
}

async function admin(c: Ctx): Promise<void> {
  const token = c.env.ADMIN_TOKEN;
  if (!token) throw new HttpError(503, 'admin-disabled');
  const h = c.req.headers.get('authorization') ?? '';
  if (!h.startsWith('Bearer ') || !(await safeEqual(h.slice(7), token))) throw new HttpError(401, 'auth');
}

async function ipKey(c: Ctx): Promise<string> {
  // Only a truncated hash of the address is stored, and only in the rate table.
  return `ip:${(await sha256Hex(`${c.req.headers.get('cf-connecting-ip') ?? 'unknown'}:core-protocol`)).slice(0, 20)}`;
}

function publicPlayer(p: Player) {
  return { id: p.id, name: p.name, friendCode: p.friend_code, portal: p.portal, linked: p.cg_user_id !== null, badges: p.badges };
}

// ---------------------------------------------------------------- players

async function register(c: Ctx): Promise<Response> {
  const b = await readJson(c.req);
  // Many players can share one address (school, mobile carrier NAT): only successful registrations count.
  const regKey = `reg:${await ipKey(c)}`;
  await peek(c.env, regKey, LIMITS.register, c.now);
  const portal = PORTALS.find((p) => p === b.portal) ?? 'local';
  const secret = newSecret();
  const secretHash = await sha256Hex(secret);
  let name: string;
  let cgUserId: string | null = null;
  if (b.cgToken !== undefined) {
    // Without the game id any CrazyGames game's user token would be accepted: account linking stays off.
    if (!c.env.CG_GAME_ID) throw new HttpError(503, 'cg-disabled');
    const u = await verifyCgToken(b.cgToken, c.env, c.now);
    cgUserId = u.userId;
    await limit(c.env, `cg:${u.userId}`, LIMITS.cgRegister, c.now);
    const existing = await c.env.DB.prepare('SELECT * FROM players WHERE cg_user_id = ?1').bind(u.userId).first<Player>();
    name = nameFromPortal(u.username) ?? existing?.name ?? autoName(randomInt);
    if (existing) {
      // Same CrazyGames account on another device (or a lost save): same player, one more device secret.
      // Older devices keep working; only the newest MAX_SECRETS extra secrets are kept.
      const DB = c.env.DB;
      await DB.batch([
        DB.prepare('INSERT OR IGNORE INTO secrets (player_id, hash, created_at) VALUES (?1, ?2, ?3)').bind(existing.id, secretHash, c.now),
        DB.prepare('DELETE FROM secrets WHERE player_id = ?1 AND hash NOT IN (SELECT hash FROM secrets WHERE player_id = ?1 ORDER BY created_at DESC, rowid DESC LIMIT ?2)').bind(
          existing.id,
          MAX_SECRETS,
        ),
        DB.prepare('UPDATE players SET name = ?1 WHERE id = ?2').bind(name, existing.id),
      ]);
      await limit(c.env, regKey, LIMITS.register, c.now).catch(() => undefined); // counted, never fails a done registration
      return json({ ...publicPlayer({ ...existing, name }), secret });
    }
  } else if (b.name !== undefined) {
    try {
      name = checkName(b.name);
    } catch (e) {
      throw nameError(e);
    }
  } else {
    name = autoName(randomInt);
  }
  for (let attempt = 0; attempt < 5; attempt++) {
    const p: Player = {
      id: `p_${randomString(20)}`,
      name,
      friend_code: randomString(6, CODE_ALPHABET),
      portal,
      cg_user_id: cgUserId,
      verified_bits: 0,
      badges: 0,
      banned: 0,
      renamed_at: null,
    };
    try {
      await c.env.DB.prepare('INSERT INTO players (id, secret_hash, name, friend_code, portal, cg_user_id, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)')
        .bind(p.id, secretHash, p.name, p.friend_code, p.portal, p.cg_user_id, c.now)
        .run();
      await limit(c.env, regKey, LIMITS.register, c.now).catch(() => undefined); // counted, never fails a done registration
      return json({ ...publicPlayer(p), secret }, 201);
    } catch (e) {
      if (!/UNIQUE/i.test(String(e))) throw e;
      if (cgUserId !== null && /cg_user_id/.test(String(e))) throw new HttpError(409, 'conflict');
    }
  }
  throw new HttpError(500, 'id-collision');
}

async function getMe(c: Ctx): Promise<Response> {
  const p = await auth(c, true);
  const badges = await c.env.DB.prepare('SELECT week, tier, rank, wave FROM badges WHERE player_id = ?1 ORDER BY week DESC, tier DESC LIMIT 100').bind(p.id).all();
  return json({ ...publicPlayer(p), verifiedBits: p.verified_bits, canRename: p.cg_user_id === null, badgeHistory: badges.results });
}

async function rename(c: Ctx): Promise<Response> {
  const p = await auth(c, true);
  const b = await readJson(c.req);
  // A CrazyGames account shows its portal username (refreshed on every register with a token).
  if (p.cg_user_id !== null) throw new HttpError(403, 'portal-name');
  let name: string;
  try {
    name = checkName(b.name);
  } catch (e) {
    throw nameError(e);
  }
  await limit(c.env, `rename:${p.id}`, LIMITS.rename, c.now);
  await c.env.DB.prepare('UPDATE players SET name = ?1, renamed_at = ?2 WHERE id = ?3').bind(name, c.now, p.id).run();
  return json({ name });
}

async function deleteMe(c: Ctx): Promise<Response> {
  const p = await auth(c, true);
  const DB = c.env.DB;
  await DB.batch([
    DB.prepare('DELETE FROM replays WHERE run_id IN (SELECT id FROM runs WHERE player_id = ?1)').bind(p.id),
    DB.prepare('DELETE FROM bests WHERE player_id = ?1').bind(p.id),
    DB.prepare('DELETE FROM follows WHERE player_id = ?1 OR friend_id = ?1').bind(p.id),
    DB.prepare('DELETE FROM badges WHERE player_id = ?1').bind(p.id),
    DB.prepare('DELETE FROM runs WHERE player_id = ?1').bind(p.id),
    DB.prepare('DELETE FROM players WHERE id = ?1').bind(p.id),
  ]);
  return json({ deleted: true });
}

// ---------------------------------------------------------------- runs

async function submitRun(c: Ctx): Promise<Response> {
  const p = await auth(c, true);
  const b = await readJson(c.req, MAX_RUN_BODY);
  const kind = b.kind;
  if (kind !== 'tier' && kind !== 'daily') throw new HttpError(400, 'bad-kind');
  if (!int(b.tier, 1, MAX_TIER)) throw new HttpError(400, 'bad-tier');
  if (!int(b.wave, 1, 10_000_000) || !int(b.ticks, 1, 2_000_000_000)) throw new HttpError(400, 'bad-result');
  if (typeof b.hash !== 'string' || !/^[0-9a-f]{8}$/.test(b.hash)) throw new HttpError(400, 'bad-hash');
  // Only builds the owner registered (deployed commits, `verifier/builds.ts add`) are ranked: a fork's or a dev
  // build's commit cannot be replayed by the verifier and would only fill the queue.
  if (typeof b.commit !== 'string' || !/^[0-9a-f]{40}$/.test(b.commit)) throw new HttpError(400, 'build-not-ranked');
  const build = await c.env.DB.prepare('SELECT retired_at FROM builds WHERE commit_sha = ?1').bind(b.commit).first<{ retired_at: number | null }>();
  if (!build || build.retired_at !== null) throw new HttpError(400, 'build-not-ranked');
  if (typeof b.replay !== 'string' || b.replay.length === 0) throw new HttpError(400, 'bad-replay');
  if (b.replay.length > MAX_REPLAY) throw new HttpError(413, 'too-large');
  if (!replayShapeOk(b.replay)) throw new HttpError(400, 'bad-replay');
  let day: string | null = null;
  if (kind === 'daily') {
    // Today's challenge, or yesterday's for a run that crossed midnight.
    const today = dayKey(c.now);
    const yesterday = dayKey(c.now - DAY_MS);
    if (b.day !== today && b.day !== yesterday) throw new HttpError(400, 'bad-day');
    day = b.day;
  }
  const ip = await ipKey(c);
  await limit(c.env, `submit:${p.id}`, LIMITS.submit, c.now);
  await limit(c.env, `submit:${ip}`, LIMITS.submitIp, c.now);
  const DB = c.env.DB;
  const dup = await DB.prepare('SELECT id, status FROM runs WHERE player_id = ?1 AND hash = ?2 AND ticks = ?3').bind(p.id, b.hash, b.ticks).first<{ id: number; status: string }>();
  if (dup) return json({ id: dup.id, status: dup.status });
  const pending = await DB.prepare("SELECT COUNT(*) AS n FROM runs WHERE player_id = ?1 AND status = 'pending'").bind(p.id).first<{ n: number }>();
  if ((pending?.n ?? 0) >= MAX_PENDING) throw new HttpError(429, 'too-many-pending');
  // Stored bytes per player and per address and day: free accounts cannot fill the 500 MB database.
  await limit(c.env, `bytes:${p.id}`, LIMITS.submitBytes, c.now, b.replay.length);
  await limit(c.env, `bytes:${ip}`, LIMITS.submitBytesIp, c.now, b.replay.length);
  try {
    await DB.batch([
      DB.prepare('INSERT INTO runs (player_id, kind, tier, day, week, wave, ticks, hash, commit_sha, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)').bind(
        p.id,
        kind,
        b.tier,
        day,
        weekKey(c.now),
        b.wave,
        b.ticks,
        b.hash,
        b.commit,
        c.now,
      ),
      DB.prepare('INSERT INTO replays (run_id, body) VALUES ((SELECT id FROM runs WHERE player_id = ?1 AND hash = ?2 AND ticks = ?3), ?4)').bind(p.id, b.hash, b.ticks, b.replay),
    ]);
  } catch (e) {
    if (!/UNIQUE/i.test(String(e))) throw e;
  }
  const row = await DB.prepare('SELECT id, status FROM runs WHERE player_id = ?1 AND hash = ?2 AND ticks = ?3').bind(p.id, b.hash, b.ticks).first<{ id: number; status: string }>();
  return json({ id: row?.id ?? 0, status: row?.status ?? 'pending' }, 202);
}

async function myRuns(c: Ctx): Promise<Response> {
  const p = await auth(c, true);
  const r = await c.env.DB.prepare(
    'SELECT id, kind, tier, day, week, wave, status, reason, created_at AS createdAt, verified_at AS verifiedAt FROM runs WHERE player_id = ?1 ORDER BY id DESC LIMIT 20',
  )
    .bind(p.id)
    .all();
  return json({ runs: r.results });
}

// ---------------------------------------------------------------- boards

interface BoardSpec {
  key: string;
  /** Which of the player's own pending runs count for this board. */
  runWhere: string;
  runParams: unknown[];
  extra: Record<string, unknown>;
}

interface Entry {
  rank: number;
  name: string;
  friendCode: string;
  badges: number;
  wave: number;
  at: number;
  status: 'verified' | 'verifying';
  me?: true;
}

function boardSpec(c: Ctx, kind: string, arg: string | undefined): BoardSpec {
  if (kind === 'daily') {
    const day = arg ?? dayKey(c.now);
    if (!Number.isFinite(dayIndex(day))) throw new HttpError(400, 'bad-day');
    // A future day's board (and seed) is not public yet.
    if (dayIndex(day) > dayIndex(dayKey(c.now))) throw new HttpError(400, 'bad-day');
    return { key: `d:${day}`, runWhere: "kind = 'daily' AND day = ?", runParams: [day], extra: { day, endsAt: (dayIndex(day) + 1) * DAY_MS } };
  }
  const tier = Number(arg);
  if (!int(tier, 1, MAX_TIER)) throw new HttpError(400, 'bad-tier');
  if (kind === 'tier') return { key: `t:${tier}`, runWhere: "kind = 'tier' AND tier = ?", runParams: [tier], extra: { tier } };
  if (kind === 'weekly') {
    const week = c.url.searchParams.get('week') ?? weekKey(c.now);
    if (!isMonday(week)) throw new HttpError(400, 'bad-week');
    return { key: `w:${week}:${tier}`, runWhere: "kind = 'tier' AND tier = ? AND week = ?", runParams: [tier, week], extra: { tier, week, endsAt: (dayIndex(week) + 7) * DAY_MS } };
  }
  throw new HttpError(404, 'not-found');
}

async function board(c: Ctx, kind: string, arg: string | undefined): Promise<Response> {
  const spec = boardSpec(c, kind, arg);
  if (kind === 'daily') spec.extra.seed = await daySeed(c.env, spec.extra.day as string);
  const me = await auth(c, false);
  const scope = c.url.searchParams.get('scope') === 'friends' ? 'friends' : 'global';
  if (scope === 'friends' && !me) throw new HttpError(401, 'auth');
  const lim = Math.max(1, Math.min(100, Number(c.url.searchParams.get('limit') ?? '50') || 50));
  const DB = c.env.DB;
  // Friends: me + everyone I follow. My id is always bound as ?9 (D1 numbered parameters), so the friend filter
  // can be appended to any of the queries below; their own parameters stay ?1..?4 and the gap is bound to NULL.
  const scopeSql = scope === 'friends' ? ' AND b.player_id IN (SELECT friend_id FROM follows WHERE player_id = ?9 UNION SELECT ?9)' : '';
  const bind = (s: D1PreparedStatement, ...v: unknown[]) => s.bind(...v, ...(scope === 'friends' ? Array(8 - v.length).fill(null).concat([me!.id]) : []));
  const top = await bind(
    DB.prepare(
      `SELECT b.player_id AS pid, b.wave, b.at, p.name, p.friend_code AS code, p.badges FROM bests b JOIN players p ON p.id = b.player_id
       WHERE b.board = ?1 AND p.banned = 0${scopeSql} ORDER BY b.wave DESC, b.at ASC LIMIT ?2`,
    ),
    spec.key,
    lim + 1,
  ).all<{ pid: string; wave: number; at: number; name: string; code: string; badges: number }>();
  const total = await bind(DB.prepare(`SELECT COUNT(*) AS n FROM bests b JOIN players p ON p.id = b.player_id WHERE b.board = ?1 AND p.banned = 0${scopeSql}`), spec.key).first<{ n: number }>();
  let rows = top.results.map((r) => ({ ...r, status: 'verified' as Entry['status'] }));
  let mine: { rank: number; wave: number; status: Entry['status'] } | null = null;
  if (me) {
    const rankOf = async (wave: number, at: number) =>
      1 +
      ((
        await bind(
          DB.prepare(
            `SELECT COUNT(*) AS n FROM bests b JOIN players p ON p.id = b.player_id
             WHERE b.board = ?1 AND p.banned = 0 AND b.player_id <> ?2 AND (b.wave > ?3 OR (b.wave = ?3 AND b.at < ?4))${scopeSql}`,
          ),
          spec.key,
          me.id,
          wave,
          at,
        ).first<{ n: number }>()
      )?.n ?? 0);
    const best = await DB.prepare('SELECT wave, at FROM bests WHERE board = ?1 AND player_id = ?2').bind(spec.key, me.id).first<{ wave: number; at: number }>();
    const pend = await DB.prepare(`SELECT wave, created_at AS at FROM runs WHERE player_id = ? AND status = 'pending' AND ${spec.runWhere} ORDER BY wave DESC, created_at ASC LIMIT 1`)
      .bind(me.id, ...spec.runParams)
      .first<{ wave: number; at: number }>();
    if (pend && (!best || pend.wave > best.wave)) {
      // My pending run beats my verified best: shown in its would-be place, marked 'verifying'.
      mine = { rank: await rankOf(pend.wave, pend.at), wave: pend.wave, status: 'verifying' };
      rows = rows.filter((r) => r.pid !== me.id);
      rows.push({ pid: me.id, wave: pend.wave, at: pend.at, name: me.name, code: me.friend_code, badges: me.badges, status: 'verifying' });
      rows.sort((a, b) => b.wave - a.wave || a.at - b.at);
    } else if (best) {
      mine = { rank: await rankOf(best.wave, best.at), wave: best.wave, status: 'verified' };
    }
  }
  const entries: Entry[] = rows.slice(0, lim).map((r, i) => ({
    rank: i + 1,
    name: r.name,
    friendCode: r.code,
    badges: r.badges,
    wave: r.wave,
    at: r.at,
    status: r.status,
    ...(me && r.pid === me.id ? { me: true as const } : {}),
  }));
  return json({ board: spec.key, scope, ...spec.extra, total: total?.n ?? 0, entries, me: mine });
}

/** Today's challenge by the server clock (the game uses it, not the device clock) and the server time. */
async function daily(c: Ctx): Promise<Response> {
  const day = dayKey(c.now);
  const week = weekKey(c.now);
  return json({ day, dayIndex: dayIndex(day), seed: await daySeed(c.env, day), endsAt: (dayIndex(day) + 1) * DAY_MS, week, weekEndsAt: (dayIndex(week) + 7) * DAY_MS, now: c.now });
}

// ---------------------------------------------------------------- friends

function normCode(x: unknown): string {
  return typeof x === 'string' ? x.toUpperCase().replace(/[\s-]/g, '') : '';
}

async function listFriends(c: Ctx): Promise<Response> {
  const p = await auth(c, true);
  const r = await c.env.DB.prepare(
    'SELECT p.name, p.friend_code AS friendCode, p.badges, f.created_at AS since FROM follows f JOIN players p ON p.id = f.friend_id WHERE f.player_id = ?1 ORDER BY f.created_at',
  )
    .bind(p.id)
    .all();
  return json({ code: p.friend_code, following: r.results });
}

async function addFriend(c: Ctx): Promise<Response> {
  const p = await auth(c, true);
  const b = await readJson(c.req);
  const code = normCode(b.code);
  if (!/^[A-Z2-9]{6}$/.test(code)) throw new HttpError(400, 'bad-code');
  await limit(c.env, `friends:${p.id}`, LIMITS.friends, c.now);
  const f = await c.env.DB.prepare('SELECT id, name, friend_code, badges FROM players WHERE friend_code = ?1 AND banned = 0').bind(code).first<{ id: string; name: string; friend_code: string; badges: number }>();
  if (!f) throw new HttpError(404, 'code-not-found');
  if (f.id === p.id) throw new HttpError(400, 'self');
  const n = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM follows WHERE player_id = ?1').bind(p.id).first<{ n: number }>();
  if ((n?.n ?? 0) >= MAX_FOLLOWS) throw new HttpError(409, 'too-many-friends');
  await c.env.DB.prepare('INSERT OR IGNORE INTO follows (player_id, friend_id, created_at) VALUES (?1, ?2, ?3)').bind(p.id, f.id, c.now).run();
  return json({ friend: { name: f.name, friendCode: f.friend_code, badges: f.badges } });
}

async function removeFriend(c: Ctx, raw: string): Promise<Response> {
  const p = await auth(c, true);
  const r = await c.env.DB.prepare('DELETE FROM follows WHERE player_id = ?1 AND friend_id = (SELECT id FROM players WHERE friend_code = ?2)').bind(p.id, normCode(decodeURIComponent(raw))).run();
  return json({ removed: (r.meta.changes ?? 0) > 0 });
}

// ---------------------------------------------------------------- admin (verifier)

async function adminPending(c: Ctx): Promise<Response> {
  await admin(c);
  const lim = Math.max(1, Math.min(50, Number(c.url.searchParams.get('limit') ?? '20') || 20));
  // Cursor: the verifier pages past runs it had to skip, so a few stuck runs never starve the queue.
  const after = Math.max(0, Math.floor(Number(c.url.searchParams.get('after') ?? '0')) || 0);
  const r = await c.env.DB.prepare(
    `SELECT r.id, r.player_id AS playerId, r.kind, r.tier, r.day, r.week, r.wave, r.ticks, r.hash, r.commit_sha AS "commit", r.created_at AS createdAt,
            p.verified_bits AS verifiedBits
     FROM runs r JOIN players p ON p.id = r.player_id WHERE r.status = 'pending' AND r.id > ?2 ORDER BY r.id LIMIT ?1`,
  )
    .bind(lim, after)
    .all<{ kind: string; day: string | null }>();
  const runs = [];
  for (const run of r.results) runs.push(run.kind === 'daily' && run.day ? { ...run, seed: await daySeed(c.env, run.day) } : run);
  return json({ runs });
}

/** The stored replay string as text/plain (no JSON round trip: replays can be ~1 MB). */
async function adminReplay(c: Ctx, id: string): Promise<Response> {
  await admin(c);
  const r = await c.env.DB.prepare('SELECT body FROM replays WHERE run_id = ?1').bind(Number(id)).first<{ body: string }>();
  if (!r) throw new HttpError(404, 'not-found');
  return new Response(r.body, { headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });
}

const VERDICTS = ['verified', 'rejected', 'flagged'] as const;

async function adminVerdict(c: Ctx): Promise<Response> {
  await admin(c);
  const b = await readJson(c.req);
  const status = VERDICTS.find((s) => s === b.status);
  if (!int(b.id, 1, Number.MAX_SAFE_INTEGER) || !status) throw new HttpError(400, 'bad-verdict');
  const DB = c.env.DB;
  const run = await DB.prepare('SELECT * FROM runs WHERE id = ?1').bind(b.id).first<{
    id: number;
    player_id: string;
    kind: string;
    tier: number;
    day: string | null;
    week: string;
    wave: number;
    status: string;
    earned_bits: number | null;
    created_at: number;
  }>();
  if (!run) throw new HttpError(404, 'not-found');
  // A pending run gets its verdict; the owner may also overturn a flagged one (verified / rejected).
  if (run.status !== 'pending' && !(run.status === 'flagged' && status !== 'flagged')) {
    if (run.status === status) return json({ id: run.id, status, unchanged: true });
    throw new HttpError(409, 'already-decided');
  }
  const earned = typeof b.earnedBits === 'number' && Number.isFinite(b.earnedBits) && b.earnedBits > 0 ? b.earnedBits : 0;
  const loadout = typeof b.loadoutBits === 'number' && Number.isFinite(b.loadoutBits) ? b.loadoutBits : null;
  const reason = typeof b.reason === 'string' ? b.reason.slice(0, 300) : null;
  const stmts = [
    DB.prepare('UPDATE runs SET status = ?1, reason = ?2, earned_bits = COALESCE(?3, earned_bits), loadout_bits = COALESCE(?4, loadout_bits), verified_at = ?5 WHERE id = ?6').bind(
      status,
      reason,
      run.status === 'pending' ? earned : null,
      loadout,
      c.now,
      run.id,
    ),
  ];
  // Only a verified run raises the player's loadout allowance (once). A flagged run keeps its earned_bits and is
  // credited if the owner overturns it to verified; otherwise flagged runs could build the very allowance that
  // decides whether later runs are flagged.
  const credit = status !== 'verified' ? 0 : run.status === 'pending' ? earned : run.status === 'flagged' ? (run.earned_bits ?? 0) : 0;
  if (credit > 0) {
    stmts.push(DB.prepare('UPDATE players SET verified_bits = verified_bits + ?1 WHERE id = ?2').bind(credit, run.player_id));
  }
  let boards: string[] = [];
  if (status === 'verified') {
    boards = run.kind === 'daily' ? [`d:${run.day}`] : [`t:${run.tier}`, `w:${run.week}:${run.tier}`];
    for (const key of boards) {
      stmts.push(
        DB.prepare(
          `INSERT INTO bests (board, player_id, wave, run_id, at) VALUES (?1, ?2, ?3, ?4, ?5)
           ON CONFLICT(board, player_id) DO UPDATE SET wave = excluded.wave, run_id = excluded.run_id, at = excluded.at WHERE excluded.wave > bests.wave`,
        ).bind(key, run.player_id, run.wave, run.id, run.created_at),
      );
    }
  }
  await DB.batch(stmts);
  // Keep the replay of a run that holds a board place (audit) or was flagged (owner review); drop the rest,
  // rejected ones included (the reason stays on the run), so junk submissions do not pile up in D1.
  const held = await DB.prepare('SELECT COUNT(*) AS n FROM bests WHERE run_id = ?1').bind(run.id).first<{ n: number }>();
  if (status === 'rejected' || (status === 'verified' && (held?.n ?? 0) === 0)) await DB.prepare('DELETE FROM replays WHERE run_id = ?1').bind(run.id).run();
  return json({ id: run.id, status, boards: (held?.n ?? 0) > 0 ? boards : [] });
}

/** Ends a weekly season: the top 10 of every tier get a badge (idempotent; refused while its runs are pending). */
async function adminCloseWeek(c: Ctx): Promise<Response> {
  await admin(c);
  const b = await readJson(c.req);
  const week = typeof b.week === 'string' ? b.week : '';
  if (!isMonday(week)) throw new HttpError(400, 'bad-week');
  if ((dayIndex(week) + 7) * DAY_MS > c.now) throw new HttpError(409, 'week-not-over');
  const DB = c.env.DB;
  if (await DB.prepare('SELECT week FROM closed_weeks WHERE week = ?1').bind(week).first()) return json({ week, closed: true, awarded: 0, already: true });
  const pending = await DB.prepare("SELECT COUNT(*) AS n FROM runs WHERE week = ?1 AND kind = 'tier' AND status = 'pending'").bind(week).first<{ n: number }>();
  if ((pending?.n ?? 0) > 0) throw new HttpError(409, 'week-pending');
  const boards = await DB.prepare('SELECT DISTINCT board FROM bests WHERE board LIKE ?1').bind(`w:${week}:%`).all<{ board: string }>();
  const stmts: D1PreparedStatement[] = [];
  let awarded = 0;
  for (const { board: key } of boards.results) {
    const tier = Number(key.split(':')[2]);
    const top = await DB.prepare(
      'SELECT b.player_id AS pid, b.wave FROM bests b JOIN players p ON p.id = b.player_id WHERE b.board = ?1 AND p.banned = 0 ORDER BY b.wave DESC, b.at ASC LIMIT ?2',
    )
      .bind(key, BADGE_TOP)
      .all<{ pid: string; wave: number }>();
    top.results.forEach((r, i) => {
      stmts.push(DB.prepare('INSERT OR IGNORE INTO badges (player_id, week, tier, rank, wave) VALUES (?1, ?2, ?3, ?4, ?5)').bind(r.pid, week, tier, i + 1, r.wave));
      stmts.push(DB.prepare('UPDATE players SET badges = badges + 1 WHERE id = ?1').bind(r.pid));
      awarded++;
    });
  }
  stmts.push(DB.prepare('INSERT INTO closed_weeks (week, closed_at) VALUES (?1, ?2)').bind(week, c.now));
  await DB.batch(stmts);
  return json({ week, closed: true, awarded });
}

async function adminRuns(c: Ctx): Promise<Response> {
  await admin(c);
  const status = VERDICTS.find((s) => s === c.url.searchParams.get('status')) ?? 'flagged';
  const r = await c.env.DB.prepare(
    `SELECT r.id, p.name, r.player_id AS playerId, r.kind, r.tier, r.wave, r.reason, r.loadout_bits AS loadoutBits, p.verified_bits AS verifiedBits, r.created_at AS createdAt
     FROM runs r JOIN players p ON p.id = r.player_id WHERE r.status = ?1 ORDER BY r.id DESC LIMIT 100`,
  )
    .bind(status)
    .all();
  return json({ runs: r.results });
}

async function adminBan(c: Ctx): Promise<Response> {
  await admin(c);
  const b = await readJson(c.req);
  if (typeof b.playerId !== 'string') throw new HttpError(400, 'bad-player');
  const r = await c.env.DB.prepare('UPDATE players SET banned = ?1 WHERE id = ?2').bind(b.banned === false ? 0 : 1, b.playerId).run();
  return json({ changed: (r.meta.changes ?? 0) > 0 });
}

/** GET: the ranked builds. POST {commit, note?, retired?}: add a build, or retire / reinstate one. */
async function adminBuilds(c: Ctx): Promise<Response> {
  await admin(c);
  const DB = c.env.DB;
  if (c.req.method === 'POST') {
    const b = await readJson(c.req);
    if (typeof b.commit !== 'string' || !/^[0-9a-f]{40}$/.test(b.commit)) throw new HttpError(400, 'bad-commit');
    const note = typeof b.note === 'string' ? b.note.slice(0, 200) : null;
    const retired = b.retired === true ? c.now : null;
    await DB.prepare(
      `INSERT INTO builds (commit_sha, note, added_at, retired_at) VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT(commit_sha) DO UPDATE SET note = COALESCE(excluded.note, builds.note), retired_at = excluded.retired_at`,
    )
      .bind(b.commit, note, c.now, retired)
      .run();
  }
  const r = await DB.prepare('SELECT commit_sha AS "commit", note, added_at AS addedAt, retired_at AS retiredAt FROM builds ORDER BY added_at DESC LIMIT 200').all();
  return json({ builds: r.results });
}

// ---------------------------------------------------------------- router

async function route(c: Ctx): Promise<Response> {
  const m = c.req.method;
  const parts = c.url.pathname.replace(/\/+$/, '').split('/').filter(Boolean);
  if (parts[0] !== 'v1') throw new HttpError(404, 'not-found');
  const [, a, b2, c3] = parts;
  const path = parts.slice(1).join('/');
  if (m === 'GET' && path === 'health') return json({ ok: true, time: c.now });
  if (m === 'GET' && path === 'daily') return daily(c);
  if (path === 'players' && m === 'POST') return register(c);
  if (path === 'players/me') {
    if (m === 'GET') return getMe(c);
    if (m === 'PATCH') return rename(c);
    if (m === 'DELETE') return deleteMe(c);
  }
  if (path === 'runs' && m === 'POST') return submitRun(c);
  if (path === 'runs/mine' && m === 'GET') return myRuns(c);
  if (a === 'boards' && m === 'GET' && b2 && parts.length <= 4) return board(c, b2, c3);
  if (a === 'friends') {
    if (parts.length === 2 && m === 'GET') return listFriends(c);
    if (parts.length === 2 && m === 'POST') return addFriend(c);
    if (parts.length === 3 && m === 'DELETE') return removeFriend(c, b2!);
  }
  if (a === 'admin') {
    if (b2 === 'pending' && m === 'GET') return adminPending(c);
    if (b2 === 'replay' && c3 && m === 'GET') return adminReplay(c, c3);
    if (b2 === 'verdict' && m === 'POST') return adminVerdict(c);
    if (b2 === 'close-week' && m === 'POST') return adminCloseWeek(c);
    if (b2 === 'runs' && m === 'GET') return adminRuns(c);
    if (b2 === 'ban' && m === 'POST') return adminBan(c);
    if (b2 === 'builds' && !c3 && (m === 'GET' || m === 'POST')) return adminBuilds(c);
  }
  throw new HttpError(404, 'not-found');
}

export async function handle(req: Request, env: Env, now: number = Date.now()): Promise<Response> {
  const cors = corsHeaders(req, env);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  let res: Response;
  try {
    res = await route({ req, env, now, url: new URL(req.url) });
  } catch (e) {
    res = errorResponse(e);
  }
  for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
  return res;
}

/** Daily cron (wrangler.toml [triggers]): drops expired rate-limit rows. */
export async function runCron(env: Env, now: number = Date.now()): Promise<void> {
  await purgeRate(env, now);
}

export default {
  fetch(req: Request, env: Env): Promise<Response> {
    return handle(req, env);
  },
  async scheduled(_event: unknown, env: Env): Promise<void> {
    await runCron(env);
  },
};

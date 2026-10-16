// CrazyGames user token (SDK v3 `user.getUserToken()`): an RS256 JWT verified with the public key from
// https://sdk.crazygames.com/publicKey.json (docs.crazygames.com/sdk/user-linking). Payload:
// { userId, gameId, username, profilePictureUrl, iat, exp } — lifetime 1 h.
import type { Env } from './db';
import { fromB64url } from './crypto';
import { HttpError } from './http';

export const CG_KEY_URL = 'https://sdk.crazygames.com/publicKey.json';
const KEY_TTL_MS = 3_600_000;

let cached: { pem: string; key: CryptoKey; at: number; fixed: boolean } | null = null;

async function importPem(pem: string): Promise<CryptoKey> {
  const body = pem.replace(/-----(BEGIN|END) PUBLIC KEY-----/g, '').replace(/\s+/g, '');
  const der = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey('spki', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
}

async function fetchPem(): Promise<string> {
  try {
    const r = await fetch(CG_KEY_URL);
    return ((await r.json()) as { publicKey?: string }).publicKey ?? '';
  } catch {
    return '';
  }
}

/** The CrazyGames public key, fetched at most once an hour per isolate. */
async function publicKey(env: Env, now: number): Promise<CryptoKey> {
  const fixed = env.CG_PUBLIC_KEY_PEM ?? '';
  if (cached && (fixed ? cached.fixed && cached.pem === fixed : !cached.fixed && now - cached.at < KEY_TTL_MS)) return cached.key;
  const pem = fixed || (await fetchPem());
  if (!pem) throw new HttpError(503, 'cg-unavailable');
  cached = { pem, key: await importPem(pem), at: now, fixed: fixed !== '' };
  return cached.key;
}

export interface CgUser {
  userId: string;
  username: string;
}

export async function verifyCgToken(token: unknown, env: Env, now: number): Promise<CgUser> {
  if (typeof token !== 'string' || token.length > 4096) throw new HttpError(400, 'cg-token');
  const parts = token.split('.');
  if (parts.length !== 3) throw new HttpError(401, 'cg-token');
  let header: { alg?: string };
  let payload: { userId?: unknown; username?: unknown; gameId?: unknown; exp?: unknown };
  try {
    header = JSON.parse(new TextDecoder().decode(fromB64url(parts[0]!))) as typeof header;
    payload = JSON.parse(new TextDecoder().decode(fromB64url(parts[1]!))) as typeof payload;
  } catch {
    throw new HttpError(401, 'cg-token');
  }
  if (header.alg !== 'RS256') throw new HttpError(401, 'cg-token');
  const key = await publicKey(env, now);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, fromB64url(parts[2]!), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  if (!ok) throw new HttpError(401, 'cg-token');
  if (typeof payload.exp !== 'number' || payload.exp * 1000 < now - 60_000) throw new HttpError(401, 'cg-token-expired');
  if (typeof payload.userId !== 'string' || payload.userId === '' || typeof payload.username !== 'string') throw new HttpError(401, 'cg-token');
  if (env.CG_GAME_ID && String(payload.gameId) !== env.CG_GAME_ID) throw new HttpError(401, 'cg-token-game');
  return { userId: payload.userId, username: payload.username };
}

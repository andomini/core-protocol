// JSON responses, errors, size-capped bodies and CORS.
import type { Env } from './db';

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message?: string,
  ) {
    super(message ?? code);
  }
}

/** Body caps (bytes): every endpoint, and POST /v1/runs whose `replay` string may be up to MAX_REPLAY. */
export const MAX_BODY = 4096;
export const MAX_REPLAY = 1_000_000;
export const MAX_RUN_BODY = MAX_REPLAY + 4096;

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers } });
}

export function errorResponse(e: unknown): Response {
  if (e instanceof HttpError) return json({ error: e.code, ...(e.message !== e.code ? { message: e.message } : {}) }, e.status);
  console.error(e);
  return json({ error: 'internal' }, 500);
}

/** Reads a JSON object body of at most `max` bytes (413 above, 400 if not a JSON object). */
export async function readJson(req: Request, max = MAX_BODY): Promise<Record<string, unknown>> {
  const len = Number(req.headers.get('content-length') ?? '0');
  if (len > max) throw new HttpError(413, 'too-large');
  const text = await req.text();
  if (text.length > max) throw new HttpError(413, 'too-large');
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    throw new HttpError(400, 'bad-json');
  }
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new HttpError(400, 'bad-json');
  return v as Record<string, unknown>;
}

function patternToRegex(p: string): RegExp {
  const esc = p
    .trim()
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/^(https?:\/\/)\*\\\./, '$1([a-z0-9-]+\\.)+')
    .replace(/:\*$/, '(:\\d+)?');
  return new RegExp(`^${esc}$`, 'i');
}

const cache = new Map<string, RegExp[]>();

export function originAllowed(origin: string, env: Env): boolean {
  const list = env.CORS_ORIGINS ?? '';
  let rs = cache.get(list);
  if (!rs) {
    rs = list.split(',').filter((s) => s.trim() !== '').map(patternToRegex);
    cache.set(list, rs);
  }
  return rs.some((r) => r.test(origin));
}

export function corsHeaders(req: Request, env: Env): Record<string, string> {
  const origin = req.headers.get('origin');
  if (!origin || !originAllowed(origin, env)) return {};
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'access-control-allow-headers': 'authorization, content-type',
    'access-control-max-age': '86400',
    vary: 'Origin',
  };
}

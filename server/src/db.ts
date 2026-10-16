// The subset of Cloudflare's D1 binding the Worker uses (kept local: no @cloudflare/workers-types needed,
// and the tests run the same SQL on node:sqlite through test/d1fake.ts).

export interface D1Result<T = Record<string, unknown>> {
  results: T[];
  meta: { changes?: number; last_row_id?: number };
}

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  run(): Promise<D1Result>;
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch(statements: D1PreparedStatement[]): Promise<D1Result[]>;
}

export interface Env {
  DB: D1Database;
  /** Bearer token of the admin API (verifier). Secret: `wrangler secret put ADMIN_TOKEN`. */
  ADMIN_TOKEN?: string;
  /** Comma list of allowed CORS origins ("https://*.crazygames.com", "http://localhost:*"). */
  CORS_ORIGINS?: string;
  /** CrazyGames game id; a user token for another game is refused when set. */
  CG_GAME_ID?: string;
  /** Tests only: the CrazyGames public key (PEM) instead of fetching https://sdk.crazygames.com/publicKey.json. */
  CG_PUBLIC_KEY_PEM?: string;
}

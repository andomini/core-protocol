-- Review fixes (2026-10-16): build allowlist, several secrets per CrazyGames account, expiring rate rows.

-- Builds whose runs may be ranked: the owner adds each deployed commit (server/verifier/builds.ts add <sha>).
-- A run from any other commit (forks, dev builds, retired builds) is refused at submit time.
CREATE TABLE builds (
  commit_sha TEXT PRIMARY KEY,
  note       TEXT,
  added_at   INTEGER NOT NULL,
  retired_at INTEGER                            -- set: no new submissions from this build
);

-- Extra device secrets of one player (a CrazyGames account signed in on several devices). players.secret_hash
-- stays valid too; only the newest few rows are kept.
CREATE TABLE secrets (
  player_id  TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  hash       TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (player_id, hash)
);

-- When a rate row's window is over (ms); the daily cron deletes expired rows.
ALTER TABLE rate ADD COLUMN exp INTEGER NOT NULL DEFAULT 0;
CREATE INDEX rate_exp ON rate(exp);

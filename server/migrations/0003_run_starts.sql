-- Server-issued run starts (POST /v1/runs/start). Each run row keeps the seed and start time of its token, so the
-- verifier can check the replay's seed and the real time it took.
ALTER TABLE runs ADD COLUMN seed INTEGER;
ALTER TABLE runs ADD COLUMN started_at INTEGER;
-- One row per issued start. startRun keeps only the player's newest START_KEEP rows per kind (older tokens are void,
-- so seeds cannot be stockpiled). submitRun claims a use in the same batch as the run insert: `ok` is computed by
-- the claiming UPDATE and its CHECK aborts the batch when the start is used up (RUNS_PER_TOKEN) or the second run is
-- not a longer one on the same tier, so concurrent submits cannot add rows. `tier` binds the start to the tier of
-- its first run. The daily cron drops rows older than TOKEN_MAX_AGE_MS.
CREATE TABLE run_starts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id  TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('tier', 'daily')),
  seed       INTEGER NOT NULL,
  started_at INTEGER NOT NULL,
  uses       INTEGER NOT NULL DEFAULT 0,
  tier       INTEGER,
  max_ticks  INTEGER,
  ok         INTEGER NOT NULL DEFAULT 1 CHECK (ok = 1)
);
CREATE INDEX run_starts_player ON run_starts(player_id, kind, id);
CREATE INDEX run_starts_age ON run_starts(started_at);

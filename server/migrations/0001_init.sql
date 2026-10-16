-- Core Protocol leaderboards (docs/superpowers/specs/2026-10-16-leaderboards-design.md §D1 schema).

CREATE TABLE players (
  id            TEXT PRIMARY KEY,               -- "p_" + 20 base32 chars (not secret)
  secret_hash   TEXT NOT NULL,                  -- SHA-256 hex of the player secret
  name          TEXT NOT NULL,
  friend_code   TEXT NOT NULL UNIQUE,           -- 6 chars, A-Z 2-9 without look-alikes
  portal        TEXT NOT NULL,                  -- local | crazygames | poki
  cg_user_id    TEXT UNIQUE,                    -- CrazyGames userId (verified token); NULL elsewhere
  verified_bits REAL NOT NULL DEFAULT 0,        -- Σ earnedBits of verified + flagged runs (loadout allowance)
  badges        INTEGER NOT NULL DEFAULT 0,     -- weekly top-10 finishes (details in badges)
  banned        INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL,
  renamed_at    INTEGER
);

CREATE TABLE runs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id    TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL CHECK (kind IN ('tier', 'daily')),
  tier         INTEGER NOT NULL,
  day          TEXT,                            -- daily: UTC "YYYY-MM-DD" of the challenge
  week         TEXT NOT NULL,                   -- Monday "YYYY-MM-DD" (UTC) of the submission
  wave         INTEGER NOT NULL,
  ticks        INTEGER NOT NULL,
  hash         TEXT NOT NULL,
  commit_sha   TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'verified', 'rejected', 'flagged')),
  reason       TEXT,
  earned_bits  REAL,
  loadout_bits REAL,
  created_at   INTEGER NOT NULL,
  verified_at  INTEGER
);
CREATE UNIQUE INDEX runs_dedupe ON runs(player_id, hash, ticks);
CREATE INDEX runs_pending ON runs(status, id);
CREATE INDEX runs_player ON runs(player_id, status, kind, tier, wave);

-- Replay blobs, kept apart so board queries never touch them; dropped once no longer needed.
CREATE TABLE replays (
  run_id INTEGER PRIMARY KEY REFERENCES runs(id) ON DELETE CASCADE,
  body   TEXT NOT NULL
);

-- One row per board and player: the best verified run. Boards: "t:<tier>", "w:<monday>:<tier>", "d:<day>".
CREATE TABLE bests (
  board     TEXT NOT NULL,
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  wave      INTEGER NOT NULL,
  run_id    INTEGER NOT NULL,
  at        INTEGER NOT NULL,                   -- created_at of that run (earlier wins a tie)
  PRIMARY KEY (board, player_id)
);
CREATE INDEX bests_rank ON bests(board, wave DESC, at ASC);

CREATE TABLE follows (
  player_id  TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  friend_id  TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (player_id, friend_id)
);

CREATE TABLE badges (
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  week      TEXT NOT NULL,
  tier      INTEGER NOT NULL,
  rank      INTEGER NOT NULL,
  wave      INTEGER NOT NULL,
  PRIMARY KEY (player_id, week, tier)
);

CREATE TABLE closed_weeks (
  week      TEXT PRIMARY KEY,
  closed_at INTEGER NOT NULL
);

-- Fixed-window request counters (rate limiting); rows are overwritten in place.
CREATE TABLE rate (
  key   TEXT PRIMARY KEY,
  win   INTEGER NOT NULL,
  n     INTEGER NOT NULL
);

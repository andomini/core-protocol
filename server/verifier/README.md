# Leaderboard verifier

Runs on the owner's PC. Every 5 minutes it pulls pending runs from the Worker, replays each one
with the game's real sim **at the commit the run was played on**, and posts a verdict. The Worker
(Cloudflare free plan, 10 ms CPU) never replays anything. Boards show only verified runs.

How it works: `verify.ts` → `GET /v1/admin/pending` → `GET /v1/admin/replay/:id` →
`git worktree add <CACHE>/<sha>` (node_modules symlinked from this checkout) →
`tsx <worktree>/tools/leaderboard/verifyEntry.ts` (stdin: VerifyInput JSON, stdout: VerifyOutput JSON)
→ `POST /v1/admin/verdict`, then `POST /v1/admin/close-week` for the last 4 finished weeks
(idempotent; refused while a week still has pending runs).

- A commit that is not in the repo yet triggers one `git fetch origin`. If it is still missing, the run
  stays pending and is rejected after `STALE_HOURS` (48).
- An entry crash, timeout (`TIMEOUT_MS`) or out-of-memory (`ENTRY_MEMORY_MB`, default 1024) is a strike
  (kept in `<CACHE>/strikes.json`); a run is rejected at `MAX_STRIKES` (2). Runs that are skipped are paged
  past with a cursor, so a few stuck runs never block the rest of the queue.
- A commit without `tools/leaderboard/verifyEntry.ts` predates ranked play, so its runs are rejected.
- Only the newest `KEEP_WORKTREES` (6) worktrees are kept in the cache.

## Deploy (first time)

All commands are run from the repo root unless a step says otherwise.

1. Worker and database: run `scripts/lb-deploy.sh` after `cd server && npx wrangler login`. It is idempotent
   (creates the D1 database, applies migrations, generates `ADMIN_TOKEN`, `DAILY_SECRET` and `RUN_SECRET` only when
   absent, adds the preview site's origin to `CORS_ORIGINS`, deploys, checks `/v1/health`, writes `verifier.env`);
   `scripts/lb-deploy.sh status` is read-only. Still to do by hand: `CG_GAME_ID` in `wrangler.toml`. Manual fallback:
   ```sh
   cd server
   npm install
   npx wrangler login
   npx wrangler d1 create core-protocol-lb      # paste the printed database_id into wrangler.toml
   npm run db:migrate:remote
   openssl rand -base64 32                      # → the admin token; keep it
   npx wrangler secret put ADMIN_TOKEN          # paste the token
   openssl rand -base64 32 | npx wrangler secret put DAILY_SECRET   # optional: unpredictable daily seeds
   openssl rand -base64 32 | npx wrangler secret put RUN_SECRET     # new secret of the Worker; set once
   # CG_GAME_ID in wrangler.toml [vars] (CrazyGames game id): REQUIRED for CrazyGames account linking;
   # without it the Worker answers 503 cg-disabled and the game registers anonymous players instead.
   npx wrangler deploy                          # prints https://core-protocol-lb.<sub>.workers.dev
   # The Worker's daily cron (wrangler.toml [triggers]) purges expired rate-limit rows.
   curl https://core-protocol-lb.<sub>.workers.dev/v1/health
   ```
2. Game builds: set `VITE_LEADERBOARD_URL=https://core-protocol-lb.<sub>.workers.dev` (for example in
   `.env.production.local`) before `npm run build:all`. Builds must come from a **clean, pushed commit**.
   Dirty builds get a `-dirty` `__COMMIT__`, and the Worker answers `400 build-not-ranked`. Push the commit
   before players can submit runs from it, or the verifier cannot fetch it, and **register it as ranked**
   (only registered commits are accepted; a retired one is refused again):
   ```sh
   set -a; . server/verifier/verifier.env; set +a
   npx tsx server/verifier/builds.ts add HEAD "crazygames 1.3"   # or a full sha
   npx tsx server/verifier/builds.ts list
   npx tsx server/verifier/builds.ts retire <sha>                 # an old build players should update from
   ```
   If a portal serves the game from a new origin, add it to `CORS_ORIGINS` in `wrangler.toml` and redeploy.
3. Verifier (this PC; needs `npm install` in the repo root for `tsx`):
   ```sh
   server/verifier/install.sh                   # writes ~/.config/systemd/user/core-protocol-verifier.{service,timer}
   $EDITOR server/verifier/verifier.env         # LB_URL=..., ADMIN_TOKEN=... (git-ignored, chmod 600)
   systemctl --user start core-protocol-verifier.service && journalctl --user -u core-protocol-verifier -n 30
   systemctl --user enable --now core-protocol-verifier.timer
   loginctl enable-linger "$USER"               # optional: keep the timer running while logged out
   ```
   Remove it with `server/verifier/install.sh --remove`.

Manual run: `set -a; . server/verifier/verifier.env; set +a; npx tsx server/verifier/verify.ts --dry-run`.

## Moderation (admin API, `Authorization: Bearer $ADMIN_TOKEN`)

```sh
curl -H "Authorization: Bearer $ADMIN_TOKEN" "$LB_URL/v1/admin/runs?status=flagged"
# approve a flagged run (its loadout cost more than the allowance) or reject it:
curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
     -d '{"id":123,"status":"verified"}' "$LB_URL/v1/admin/verdict"
curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
     -d '{"playerId":"...","banned":true}' "$LB_URL/v1/admin/ban"
```

Daily challenge seeds: without `DAILY_SECRET` the seed is a public hash of the day (anyone can practise
tomorrow's map). With it, the seed is an HMAC known only to the Worker; the game fetches it from
`/v1/daily` (an offline daily run is practice, unranked) and the verifier gets it with each pending run.
Changing the secret changes the seeds of days not yet verified: set it once, before launch.

## Updating the server

`cd server && npm test && npx wrangler deploy`. To add a migration, create `migrations/000N_*.sql`, then run
`npm run db:migrate:local` (for testing) and `npm run db:migrate:remote`.

**Server-issued run starts (migration 0003, `RUN_SECRET`).** Ranked runs start from `POST /v1/runs/start`
(a server seed + a signed start time); submissions carry that token.

- Apply `0003_run_starts.sql` with `npm run db:migrate:remote` **before** `npx wrangler deploy`: the new Worker
  writes `runs.seed` / `runs.started_at`, and inserts fail on the old schema.
- `RUN_SECRET` must be set (`openssl rand -base64 32 | npx wrangler secret put RUN_SECRET`); without it
  `/runs/start` and `POST /runs` answer `503 ranked-disabled`.
- Builds from before server starts send no token (`400 no-token`, dropped by the client): retire them with
  `npx tsx server/verifier/builds.ts retire <sha>` once the new build is live. Their rows still pending in the
  database are rejected by the verifier (`no server start`).
- Rotating `RUN_SECRET` voids every start token issued so far: runs in progress (and queued offline) get
  `bad-token`. Rotate only when it leaked.

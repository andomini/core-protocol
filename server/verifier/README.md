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
  stays pending and is rejected after `STALE_HOURS` (48). This also applies to entry crashes and timeouts.
- A commit without `tools/leaderboard/verifyEntry.ts` predates ranked play, so its runs are rejected.
- Only the newest `KEEP_WORKTREES` (6) worktrees are kept in the cache.

## Deploy (first time)

All commands are run from the repo root unless a step says otherwise.

1. Worker and database:
   ```sh
   cd server
   npm install
   npx wrangler login
   npx wrangler d1 create core-protocol-lb      # paste the printed database_id into wrangler.toml
   npm run db:migrate:remote
   openssl rand -base64 32                      # → the admin token; keep it
   npx wrangler secret put ADMIN_TOKEN          # paste the token
   # optional: set CG_GAME_ID in wrangler.toml [vars] (CrazyGames game id, checked against user tokens)
   npx wrangler deploy                          # prints https://core-protocol-lb.<sub>.workers.dev
   curl https://core-protocol-lb.<sub>.workers.dev/v1/health
   ```
2. Game builds: set `VITE_LEADERBOARD_URL=https://core-protocol-lb.<sub>.workers.dev` (for example in
   `.env.production.local`) before `npm run build:all`. Builds must come from a **clean, pushed commit**.
   Dirty builds get a `-dirty` `__COMMIT__`, and the Worker answers `400 build-not-ranked`. Push the commit
   before players can submit runs from it, or the verifier cannot fetch it.
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

## Updating the server

`cd server && npm test && npx wrangler deploy`. To add a migration, create `migrations/000N_*.sql`, then run
`npm run db:migrate:local` (for testing) and `npm run db:migrate:remote`.

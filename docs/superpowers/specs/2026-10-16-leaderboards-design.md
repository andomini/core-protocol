# Online leaderboards: design

Status: server, verifier and shared rules implemented (`server/`, `server/verifier/`, `src/meta/leaderboardRules.ts`,
`tools/leaderboard/verifyEntry.ts`, `src/data/leaderboard.json`). The client (`src/portal/leaderboard.ts` and UI) is a separate step;
this document is its contract.

## 1. Boards

| Board | Key (`bests.board`) | Ranked by | Reset |
|---|---|---|---|
| Tier, all time | `t:<tier>` | best wave | never |
| Weekly season | `w:<monday>:<tier>` | best wave in the week | Monday 00:00 UTC; the top 10 of every tier get a badge, kept in `badges` |
| Daily challenge | `d:<YYYY-MM-DD>` | best wave of the day | 00:00 UTC; one board per day |
| Friends | any of the above, `?scope=friends` | same | — |

- Ties go to the player who reached the wave first (`bests.at` = the run's submission time).
- Each board has one row per player, which is that player's best verified run.
- **Week key:** the UTC Monday of the moment the run was *submitted*. With `d = floor(ms / 86400000)`, the key is the date of day `d − ((d + 3) mod 7)`. The same function exists in `leaderboardRules.weekKey`, `server/src/time.ts` and `verifier/verify.ts`.
- **Daily challenge:**
  - `seed = FNV-1a("core-protocol:daily:" + day) >>> 0`, using 1 when the result is 0. Test vector: `dailySeed("2026-10-16") = 1682601640`.
  - The tier is `leaderboard.json daily.tier`.
  - The loadout is fixed: `daily.loadouts[dayIndex(day) mod n]`, where `dayIndex` counts days since 1970-01-01 (`dayIndex("2026-10-16") = 20742`). The player's own workshop, labs and cards do **not** apply.
  - Unlimited attempts; the best one counts.
  - A run may be submitted for today or yesterday, so a run that crosses midnight still counts for the day it started.
  - Client: `dailyRunOptions(day, data, md)`.
- **Friends:**
  - Every player gets a 6-character friend code from the alphabet `ABCDEFGHJKMNPQRSTUVWXYZ23456789`. Input is case-insensitive and ignores `-` and spaces.
  - Following is one-way, with at most 100 follows.
  - The friends scope of any board shows me plus the players I follow.

## 2. Identity

- **POST /v1/players** registers a player and returns `id` + `secret`. The client stores both in the save through `SaveSlot` (a `leaderboard` slot over `services.storage`), never in raw localStorage.
- **Auth:** `Authorization: Bearer <id>.<secret>`. The server stores only `sha256(secret)`.
- **Names:**
  - Outside CrazyGames the server assigns an auto nickname such as `NeonVirus-4821`.
  - A player may rename (`PATCH /v1/players/me`) up to 10 times a day.
  - Allowed names are 3–20 characters of ASCII letters, digits, space and `_ . -`, starting and ending with a letter or digit.
  - A profanity filter with leet folding (0→o, 1→i, 3→e, 4→a, 5→s, 7→t) applies. It is substring based, so false positives are possible (the "Scunthorpe" case).
- **CrazyGames:**
  - The client sends `cgToken` from `user.getUserToken()`. The Worker verifies the RS256 JWT with CrazyGames' public key (`https://sdk.crazygames.com/publicKey.json`, cached for 1 h). It checks `exp` with 60 s of skew and, when `CG_GAME_ID` is set, `gameId`.
  - The player is keyed by `userId`, so a new device gets the same player.
  - Re-registering **rotates the secret**, which logs out the old device until it registers again.
  - The name follows the CG username, and such accounts cannot rename (`403 portal-name`).
  - A guest on CrazyGames (no token) registers like any other player.
- **Poki** has no user identity and behaves like local.

## 3. Ranked submission (client contract)

A run is ranked only if:

- the build has a clean commit (`__COMMIT__` is a 40-hex sha; dev and dirty builds report `<sha>-dirty` or `unknown`, and the server answers `400 build-not-ranked`), and the owner registered that commit as ranked (`builds` table, `server/verifier/builds.ts add`; unknown or retired commits get the same 400);
- no dev or debug flags were set (BattleScene uses `battleData(DEFAULT_DATA, flags)`, and any flag changes the data);
- the full command log from tick 0 is available (see §3.1);
- `wave >= leaderboard.json minWave`.

After death the client posts **POST /v1/runs**:

```json
{
  "kind": "tier",
  "tier": 3,
  "day": null,
  "wave": 57,
  "ticks": 182340,
  "hash": "9f03a1c2",
  "commit": "d52589b…40 hex",
  "replay": "gz:H4sIAAAA…"
}
```

- `kind` is `"tier"` or `"daily"`. For daily runs, `day` is `"YYYY-MM-DD"` (today or yesterday, UTC) and `tier` = `daily.tier`.
- `wave` = `world.wave` and `ticks` = `world.tick` of the final world.
- `hash` = `hashWorld(finalWorld)` (8 hex) after **every** command in the log has been applied. This includes commands queued after death, such as a revive that was declined.
- `replay` is a JSON string, optionally gzip+base64 with the prefix `gz:` (recommended, via `CompressionStream('gzip')`). It is at most 1,000,000 characters and holds:

```json
{ "v": 1, "seed": 123, "tier": 3, "claim": { "workshop": { "damage": 40 }, "labs": ["multishot"], "cards": { "secondWind": 1 } }, "log": [{ "tick": 0, "cmd": { "type": "…" } }] }
```

- `claim` = `claimFromMeta(meta, md)` at run start.
  - Cards appear in loadout order with their copy counts.
  - The verifier rebuilds RunOptions from the claim, so `runOptionsFromClaim(claim, data, md, tier, seed)` must equal the options the run used. A test covers this for `buildRunOptions`.
  - Daily runs send `dailyClaim(day)`.
- `log` = `RunSession.log`, the `{tick, cmd}` pairs in the order they were applied.

Responses:

- `202 {id, status: "pending"}`, or `200` with the existing run on a duplicate (same player, hash and ticks).
- Errors are `{error: code}` with these codes:
  - `bad-kind`, `bad-tier`, `bad-result`, `bad-hash`, `bad-day`, `bad-replay`, `build-not-ranked`
  - `413 too-large`
  - `429 too-many-pending` (more than 20 pending) or `429 rate-limited`
  - `401 auth`, `403 banned`

The client shows its own pending run as "verifying" (the boards include it, see §4). It should keep the submission and retry on a network failure, because the call is idempotent.

### 3.1 Saved / resumed runs

- `RunSession.adopt()` starts with `log = []`, and `MetaStore`'s `RunSave` (`snapshot`, `opts`, `savedAt`, `stats`) stores no log. **A resumed run therefore cannot be replayed and is currently unranked:** the client must not submit it.
- To rank resumed runs, the client must:
  - persist `log` and `claim` in `RunSave` next to the snapshot, written on the same save;
  - restore `session.log` on resume;
  - submit the full log from tick 0. The replay is always from the start, never from a snapshot.
- If the persisted log is missing, or longer than `maxLogEntries` (200,000), the run is shown as unranked.

## 4. API (Worker, `/v1`)

All JSON. Bodies are at most 4 KB, except `POST /v1/runs`, which allows the replay cap plus 4 KB. CORS uses the `CORS_ORIGINS` patterns (`*.crazygames.com`, `*.poki-gdn.com`, `*.poki.com`, `*.trycloudflare.com`, `localhost:*`). Errors look like `{"error": "code", "message"?}`.

| Method & path | Auth | Request | Response |
|---|---|---|---|
| GET `/health` | — | | `{ok, time}` |
| GET `/daily` | — | | `{day, dayIndex, seed, endsAt, week, weekEndsAt}` (ms epochs) |
| POST `/players` | — (rate limit: 30 successful/h per IP) | `{portal: "local"\|"crazygames"\|"poki", name?, cgToken?}` | `201` (`200` when an existing CG account is re-linked) `{id, name, friendCode, portal, linked, badges, secret}` |
| GET `/players/me` | player | | `{id, name, friendCode, portal, linked, badges, verifiedBits, canRename, badgeHistory: [{week, tier, rank, wave}]}` |
| PATCH `/players/me` | player (10/day) | `{name}` | `{name}`, or `400 name-length\|name-charset\|name-profane`, or `403 portal-name` |
| DELETE `/players/me` | player | | `{deleted: true}`; runs, replays, bests, follows and badges are removed (cascade) |
| POST `/runs` | player (60/h) | §3 | `202 {id, status}` |
| GET `/runs/mine` | player | | `{runs: [{id, kind, tier, day, week, wave, status, reason, createdAt, verifiedAt}]}` (last 20) |
| GET `/boards/tier/:tier` | optional | `?scope=global\|friends&limit≤100` | board (below) + `{tier}` |
| GET `/boards/weekly/:tier` | optional | `?week=<monday>` (default: this week) | board + `{tier, week, endsAt}` |
| GET `/boards/daily[/:day]` | optional | | board + `{day, seed, endsAt}` |
| GET `/friends` | player | | `{code, following: [{name, friendCode, badges, since}]}` |
| POST `/friends` | player (60/h) | `{code}` | `{friend: {name, friendCode, badges}}`, or `404 code-not-found`, `400 self`, `409 too-many-friends` |
| DELETE `/friends/:code` | player | | `{removed}` |

Board response:

```json
{ "board": "t:3", "scope": "global", "total": 812,
  "entries": [ { "rank": 1, "name": "NeonVirus-4821", "friendCode": "K7M2QX", "badges": 3, "wave": 140, "at": 1792000000000, "status": "verified", "me": true } ],
  "me": { "rank": 1, "wave": 140, "status": "verified" } }
```

- Only verified bests are shown.
- If the requester has a pending run better than their verified best on that board, it is spliced in at its rank with `status: "verifying"`. Only the requester sees it.
- `me` is `null` for anonymous requests or players without an entry.
- Banned players are hidden.

Admin (verifier and owner; `Authorization: Bearer <ADMIN_TOKEN>`, a Worker secret; `503 admin-disabled` when it is unset):

| Method & path | Request | Response |
|---|---|---|
| GET `/admin/pending?limit≤50` | | `{runs: [{id, playerId, kind, tier, day, week, wave, ticks, hash, commit, createdAt, verifiedBits}]}`, oldest first, without replay bodies |
| GET `/admin/replay/:id` | | the replay string as `text/plain` (the Worker never parses it) |
| POST `/admin/verdict` | `{id, status: verified\|rejected\|flagged, reason?, earnedBits?, loadoutBits?}` | `{id, status, boards}`; `409 already-decided` (a flagged run may be overturned) |
| POST `/admin/close-week` | `{week}` | `{week, closed, awarded, already?}`; `409 week-not-over\|week-pending` |
| GET `/admin/runs?status=flagged` | | the last 100 runs with that status |
| POST `/admin/ban` | `{playerId, banned}` | `{changed}` |

## 5. Storage (D1, `server/migrations/0001_init.sql`)

- `players`(id, secret_hash, name, friend_code unique, portal, cg_user_id unique, verified_bits, badges, banned, created_at, renamed_at)
- `runs`(id, player_id, kind, tier, day, week, wave, ticks, hash, commit_sha, status, reason, earned_bits, loadout_bits, created_at, verified_at). Duplicate key: unique (player_id, hash, ticks).
- `replays`(run_id, body). The replay is kept while the run is pending, flagged or rejected (for review), or while it holds a board place (for audit). A verified run that beats nothing has its replay deleted.
- `bests`(board, player_id, wave, run_id, at). Upserted on a `verified` verdict when the wave is higher.
- `follows`, `badges`(player_id, week, tier, rank, wave), `closed_weeks`, `rate`(key, win, n). The rate table is a fixed-window counter keyed by player id or by a truncated salted SHA-256 of the IP.

## 6. Verification (anti-cheat)

The free-plan Worker has 10 ms of CPU per request, so it never replays runs. The owner's PC runs `server/verifier/verify.ts` every 5 min (a systemd user timer; see `server/verifier/README.md`).

1. Pull the pending runs.
2. For each run, check out the run's `commit` in a git worktree (`.verifier-cache/<sha>`, node_modules symlinked) and run **that commit's** `tools/leaderboard/verifyEntry.ts`. This way the sim, the data and the rules match the build the player ran. A commit without the entry is rejected. Unknown commits, crashes and timeouts stay pending and are rejected after 48 h.
3. `verifySubmission` rejects a run when:
   - the payload is malformed or the log has more than `maxLogEntries` entries;
   - the payload tier differs from the submission tier;
   - for daily runs, the seed, tier or claim is not the day's;
   - for tier runs, `claimError` fails: unknown or duplicate labs, a missing prerequisite, workshop levels that are non-integer, above `workshopMax` or locked, unknown cards, or more cards than `cardSlots`;
   - a revive carries an `hp` share without Second Wind, or with a value other than Second Wind's;
   - `replayToEnd` (in `src/sim/replay.ts`) throws (out-of-order log, a command the sim refuses, or the world never dies or gets stuck);
   - the final `tick`, `wave` or `hashWorld` differs from the submission.
   Because the world is rebuilt from the claim, a forged claim or result cannot reproduce the hash.
4. **Loadout legitimacy** (tier runs only; the daily loadout is fixed):
   - `loadoutBits = Σ_workshop curveSum(workshopCurve(stat), 0, level) + Σ_labs cost`. This is what the claimed loadout cost in Bits.
   - `allowance = allowance.freeBits + allowance.earnedMul × verifiedBits` (currently 250,000 + 2 × verifiedBits).
   - `verifiedBits` is the sum of `earnedBits` over the player's verified tier runs. A flagged run keeps its `earnedBits` and is credited only when the owner overturns it to verified (otherwise flagged runs would build the allowance that decides later flags). The verifier tracks additions within a pass, so a player's earlier runs in the same batch count.
   - `earnedBits = floor(world.bits × lab bitsMul × card bitsMul × ads.doubleBits)`. This is a generous ceiling on what the run paid out.
   - If `loadoutBits > allowance`, the status is `flagged`. The run is not shown and its Bits are not credited yet. The owner reviews `GET /admin/runs?status=flagged` and can overturn the verdict.
   - Players who levelled up before leaderboards existed have no verified history. They get flagged until their verified earnings catch up, or until the owner approves them.
   - Known gaps: cards are not costed, since they come from Keys and ads. A cheater can still hide a fast-forwarded save behind small honest runs, but needs 2× as many real, replay-verified Bits.
5. Daily runs credit no Bits to the allowance.

Statuses: `pending → verified | rejected | flagged`; `flagged → verified | rejected` (owner only).

**Week close:** after each pass the verifier calls `close-week` for the last 4 finished weeks. The server refuses while that week has pending tier runs and is idempotent once a week is closed. The top 10 (`BADGE_TOP`) of every `w:<week>:<tier>` board get a `badges` row and `players.badges + 1`.

## 7. Build and client wiring

- `vite.config.ts` defines `__COMMIT__`:
  - `COMMIT_SHA` from the environment if set;
  - otherwise `git rev-parse HEAD`, with `-dirty` appended when `src/` or `tools/leaderboard/` have uncommitted or untracked changes;
  - otherwise `unknown`.
  Release builds must come from a clean commit that is pushed (the verifier fetches it).
- `VITE_LEADERBOARD_URL` sets the Worker base URL. If it is empty, the whole feature is hidden.
- All network access goes through `src/portal/leaderboard.ts` (the client step), which is fail-soft:
  - every call has a timeout (≈ 8 s) and catches errors;
  - offline or a 5xx means "leaderboard unavailable" and never blocks play;
  - submissions are queued in the save and retried later.
- The Poki and CrazyGames builds already allow outgoing `fetch`. Origins are allowed by the Worker's CORS list.

## 8. Privacy

- The server stores a nickname, a friend code, the portal, the CrazyGames userId (linked accounts only), runs and replays (commands only, no device data) and badges.
- IP addresses are never stored. Rate limiting keys on a truncated salted hash, which lives only in the `rate` table.
- `DELETE /v1/players/me` erases the account and all of its rows. The client offers it in settings, together with "reset leaderboard identity".
- No third-party analytics.

## 9. Limits (defaults)

| | Limit |
|---|---|
| Register | 30 successful/h per IP; CG re-link 20/h per account (≤ 5 extra device secrets kept) |
| Rename | 10/day |
| Submit | 60/h per player, 200/h per IP; replay bytes 20 MB/day per player, 100 MB/day per IP |
| Rerolls per pick | 5 (perks.json `offer.maxRerolls`, enforced in the sim) |
| Paid daily attempts | 1/day (leaderboard.json `daily.paidAttemptsPerDay`; later attempts are practice) |
| Friends add | 60/h |
| Pending runs per player | 20 |
| Follows | 100 |
| Replay | ≤ 1,000,000 chars (gzip recommended) |
| Log entries | ≤ 200,000 |
| Board page | ≤ 100 |
| Badge | top 10 |

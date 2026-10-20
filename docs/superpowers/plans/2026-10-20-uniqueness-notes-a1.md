# Uniqueness plan, phase 1 — agent A1 notes (items 1 and 3)

Branch `worktree-agent-ae0889dbb15831f6c`. Items: 1 boot sectors, 3 early mutations.

## Decisions

- **Boot pick = phase `pick` with `World.bootOffer` non-empty** (`offer` empty). No new phase: `step()` already
  freezes in `pick`, `RunSession.picking` and the overlay work unchanged. `pickPerk` / `reroll` / `boost` are
  rejected with `'phase'` while the boot is open; `pickBoot` outside it too. New World fields (`// boot`):
  `bootOffer: string[]`, `boot: string` (`''` = none taken — `snapshot()`'s finiteness check rejects `null`).
- `RunOptions.boot` (default `true`); `protocols: false` also skips it. Offer: stream `'boot'`, `offerSize` 3 of 5.
- `pickBoot` → `grantPerk` at each module's fixed slot (sector data in `src/data/boot.json`, validated: tag,
  partner ≠ tag, perks of that tag without `requires`, slots unlocked at wave 1, connected, inside rings) →
  `refreshCrystal` → `bootPicked {id, tag, modules}`. Each sector is one 3-module cluster = its set 2 at wave 1.
- WORLD_VERSION / SNAPSHOT_VERSION 7 → 8; `restore` accepts v7 (`bootOffer []`, `boot ''`). Snapshot validation:
  `offer` and `bootOffer` never both open; phase `pick` ⇔ one of them open.
- **`boot.skipPicks [1, 2, 3]`**: a taken boot stands in for the scheduled protocol picks at waves 1–3
  (`pickDue` in `src/sim/perks.ts`; runs without a boot keep the full schedule `[1,2,3,5,8,10…]`). Without it B2
  went to median 24 (3 boot modules + 3 more picks snowball). Probes (12 seeds, forced sector, greedy median):
  current 18/43 (hotStart/coldBoot) → drop pick 1: 17/17 → 2-module sectors: 10/8 → drop 1–3 + Permafrost: 7/6,
  others 5–6 (no-boot baseline 8). Chosen: drop 1–3 + Permafrost. Module count stays 3 (the plan's "set 2").
- **Cold Boot: Shatter → Permafrost** (Shatter on top of Frost Shot + Cold Aura was the 43-wave outlier).
- Mutations: `startWave 5`, `every 8`, `firstLevelScale 0.5` (level 1 counts as half a level in
  `geneKeep`; `geneWeight = level − 1 + firstLevelScale`). `nextMutationWave` exported for the UI.
- GenomeStrip is visible from wave 1: `VIRUS ADAPTS AT WAVE N` until the first mutation, then
  `GENOME · W{next}`; `flash(tag)` on each `mutation` event.
- UI: PickOverlay boot mode — 3 large cards (tag frame, BOOT sticker, mini-crystal with core/locked/module
  hexes and a "+" partner hint, `SET 2 ON: …` + partner→fusion footer); geometry in `pickLayout.bootGeometry`.
  BattleScene: handler, `bootPicked` banner + pulses, widget/dev auto-pick send `pickBoot`. Dev hooks:
  `pickBoot`, `pickNow`, state `bootOffer`/`boot`.
- Bots: `first` → 0; `greedy-pick`/`random-pick` → seeded random; `fusion-pick` → best crystal score; `tag:<t>` →
  its sector. `smoke`, `balance`, `record-replay`, `progressionPlayer` (via runner) all take the boot.

## B2 / B6 (`npm run sim:balance`, 24 seeds)

| | before (no boot) | boot, no tuning | final (skipPicks + Permafrost) |
|---|---|---|---|
| B2 greedy median / none | 7 (FAIL) / — | 24 (FAIL) / 4 | **6 (PASS) / 3** |
| B6 medians ov/cr/ch/mi/fw | 8/6/5/5/5 = 1.60 FAIL | 34/15/6/8/7 FAIL | 7/6/6/6/5 = 1.40 FAIL (all within ±20 % of mean) |
| B5 2-set | PASS | 100 % at wave 1 | 100 % at wave 1 |

B1 PASS. Final report: `reports/balance-m3.md`.

## Open issues

- B6 still FAILs on max/min (1.40 > 1.20), although better than before; overload leads. Remaining spread is in
  set/perk effects (`sets.json`, `perks.json` effects) outside A1 ownership.
- A4 also bumps WORLD/SNAPSHOT to v8 — merge must reconcile to one version (v9 if both land) and chain migrations.
- `npm run build` postbuild fails on "mentions crazygames" (leaderboard string `NAME FROM CRAZYGAMES`) — predates
  this work.
- CLAUDE.md says `sim:balance` writes `reports/balance-m2b.md`; it writes `reports/balance-m3.md`.
- Optional `HintId 'boot'` (first-run hint on the boot cards) not done.
- With skipPicks the first protocol pick of a booted run is at wave 5 (median greedy run reaches it, `picks` 1);
  if that feels too sparse, try `skipPicks [1, 2]` (probe: B2 ~8, slightly over the 4–6 band).
- Golden replay (`tests/replays/golden-01.json`) is recorded with `boot: false`: with a boot the 3-min script reaches only 1 protocol pick (wave 5), so the boost / reroll / move paths would drop out of it. Boot replays are covered in `tests/boot.test.ts`. `record-replay.ts` now stops at death (a dead world does not tick, the old loop would hang).
- UI smoke (`UI_PORT=5181 npm run ui`): 336/343. Two checks (boot closes the pick at tick 0; BOOST from wave 1) were relaxed after the run, because the battle now starts right after the boot; that has not been re-run. Still open: `editor: a selected module shows coloured targets` fails in 3 layouts. The showcase crystal (`demoCrystal`) now sits on top of the 3 boot modules plus the placed card, and no move found a tier-raising target. Fix: have demoCrystal start from an empty crystal, or have that check pick a boot-free run.

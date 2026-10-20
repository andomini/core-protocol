# Uniqueness plan, item 11 (simplification): no Weld, no Apex, a plain editor readout. Notes (agent C3)

Branch `worktree-agent-a9b94d2d96cd73930`, based on main `bd730fc`.

## Weld dropped
- A fusion tier now follows the links **at once, up or down**: `refreshTiers` (src/sim/perks.ts) sets the tier on the
  same crystal change, so the `fusion` event and the tier's mods and timers arrive with the grant or move.
- Removed: `World.fusionPending`, `WeldPending`, `settleWeld` (and its call in `step`), `sets.weldTicks`.
- **WORLD_VERSION / SNAPSHOT_VERSION = 9.** `restore` accepts v7 and v8 snapshots:
  - v7 → as before (pulse / boot fields get their defaults);
  - v7/v8 → v9 drops `fusionPending`; when it held a waiting rise and `restore` gets `data`, `refreshCrystal` applies
    the rise at once (the run lands where it would have after the weld). Without `data` the field is still dropped
    and the rise lands at the next crystal change.
  - v6 and older still throw `unsupported version`.
- The editor strip and pair labels no longer show a "welding" state.

## Apex shelved
- `sets.json`: `apexSet` and every `apexLinks` / `apex` block are gone; the ladder is `fusionTiers [1, 3, 5]` only.
  The validator **rejects** `weldTicks`, `apexSet`, and `apex` / `apexLinks` on a fusion (stale data fails loudly).
- `src/sim/crystal.ts`: `fusionTierAt(data, links)` (no per-pair ladder, no set-count gate); `fusionSteps`,
  `fusionEffects`, `fusionTierIndex` keep their names so bot.ts, runEnd.ts and missions.ts compile unchanged.
- The Lattice index runs **I = 1, II = 2, III = 3**. The Codex shows a legacy 4 (an old save's Apex) as III.
- Copy: Codex, SetTooltip (no "Apex needs set ≥ 4" suffix), perkText (no Apex badge), the editor RULES line
  ("Links between the largest clusters: 1 / 3 / 5 → fusion I / II / III").
- `tools/sim/crystalGeometry.ts`: the 7-link / Apex sections and `--apex` are gone; `reports/crystal-geometry.md`
  was trimmed to its first section (same numbers, no re-run); the CLAUDE.md line lost "modules for a 7-link pair".
- Tests: the Bounty Marks Apex jackpot (every 8, cap 3) and the Codex "tier 7 → index 4" cases were removed.

## Lattice re-tune
Arrange bot (`runBot greedy, fusion-pick, arrange`, tier 1, 24 seeds), mean run-end Lattice bonus:

| scenario | before (main) | no Weld, coef 0.015 | after (coef **0.014**) |
|---|---|---|---|
| first run (workshop 0), mean wave 5.9 | 0.452 % | 0.503 % (+11 %) | **0.470 % (+4 %)** |
| workshop 30 on the five core stats, mean wave ~50.5 | 9.92 % | 9.94 % (+0 %) | **9.28 % (−6.5 %)** |

Immediate rises lift the early-run mean Lattice (0.302 → 0.335); `latticeCoef` 0.015 → 0.014 keeps both scenarios
inside ±10 %. `latticeMax` stays 0.22 (reached only at mean index ≥ 15.7).

## Editor readout
- The sentences live in `src/ui/crystalReadout.ts` (Phaser-free, tested in `tests/crystalReadout.test.ts`);
  CrystalEditor re-exports `diffLines` so BattleScene's field-drag readout is unchanged.
- At most three lines, tier changes first, then progress; a fourth becomes "+N more". Examples:
  "Overload set 4 → 6: Every 30s: ×2 attack speed for 8s", "Thermal Shock II → III: 10% chance to freeze 1s",
  "Breaks Minefield I", "Bastion III → II: back to 2 turrets", "Overcharge III → II: loses Every 10s: bolt …",
  "Network 2/3 links toward II", "North-east ground turns Cryo".
- A fall says "back to <lower tier>" when the lower tier is the same effect with smaller numbers, else "loses <the
  higher tier's effect>". A row too narrow for the sentence shows its head only ("Overload set 4 → 6").
- No jargon (fold, ladder, weld, apex) and no brackets: checked over every set and fusion step in the test.
- The smoke's `readoutLines` contract is unchanged (it holds the shown text).

## Owner leftovers
- **Boot hint** (`HintId 'boot'`, first run only): "PICK A STARTER CRYSTAL — tap a card", ringing the card row of the
  boot pick. A new `HintState.over` lets it show over the pick overlay (drawn above it, not held back by `blocked`);
  the line sits under the cards, or above them in portrait (no room below) on a dark plate over the overlay's subtitle.
  BattleScene: one states entry and a `bootCards()` helper, all lines tagged `// c3`.
- **`?boot=<id>`** (devHooks): each run whose boot pick opens takes that sector at once; an id the offer lacks
  replaces its first card (dev only, not replayable); an unknown id logs a warning and is ignored.
- **`__cp.pulse(force)`**: fires the Pulse as the HUD button would; `force` first moves `pulseReadyTick` to now.
  Returns whether a pulse is queued. Dev only: devHooks is installed under `import.meta.env.DEV` and postbuild's
  `__cp` pattern guards it.
- `tools/covers/record.mjs` uses both (`?seed=31&boot=hotStart`, `c.pulse(true)`); nothing else changed there.

## Gates
Run in this order, one at a time:
- `npm run typecheck`: clean.
- `npm test`: 59 files, 697 tests pass. New tests: an immediate rise and drop, the validator rejecting the
  shelved keys, the v8 → v9 migration, and `tests/crystalReadout.test.ts` (3 tests).
- `UI_PORT=5191 npm run ui`: 352/352 pass. The `reports/screens/*.jpg` were reverted (no intended look change).
  - A scratch Playwright check confirmed the boot hint in both orientations, `?boot=hotStart`, and `pulse()` vs `pulse(true)`.
- `npm run build:local`: 478.9 KB gz initial download, against a 1 MB budget.
- `npm run sim:balance`:
  - B1, B2 and B5 pass. B2: greedy median wave 6.
  - B6 fails at 8/6/6/6/6 = **1.33**, the same as main's 1.33 (not worse).
  - `--crystal arrange`: the arrange combo's median wave is 6, as before.
- The golden replay was re-recorded once, after the last sim/data change (103 commands, final wave 6).

## Files outside my ownership
- `tests/structures.test.ts` (C4): the "tier welded on the wave-start tick" test now expects the tier at once (no
  `weldTicks: 1`, no `fusionPending`).
- `tests/bountyMarks.test.ts`, `tests/labRules.test.ts`, `tests/pulse.test.ts`, `tests/boot.test.ts`,
  `tests/cardEffects.test.ts`: version 8 → 9 assertions and the Apex cases.
- `tools/sim/crystalGeometry.ts` + `reports/crystal-geometry.md` (C4 owns tools/sim/*; asked for by c3.md).
- `tools/covers/record.mjs` (B1), `tools/ui/smoke.mjs` (one comment), `CLAUDE.md` (one line),
  `src/render/scenes/BattleScene.ts` (additive, `// c3`).

## Open issues
- Stale comments (not mine): `src/meta/state.ts:57` and `src/meta/missions.ts:75` still say "4 = Apex".
- `src/render/CrystalView.ts` still calls the link lines "welds" internally (visual only, no player-facing text).
- Portrait boot pick (A1): the overlay subtitle is wider than the screen and clips at both edges; the boot hint
  covers it on the first run.

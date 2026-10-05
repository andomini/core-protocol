# M4 — Meta: workshop, tiers, labs, save, offline — notes

Tests: 339 → 364 · `npm run ui` 177/177 (new `meta` scenario) · reports: `balance-m4.md` (meta), `balance-m3.md` (first run).

## What exists
- **Sim v4:**
  - `RunOptions` takes `pickEvery`, `rareMul`, `maxLevelBonus` and `startEnergy`, kept in `World.lab`.
  - Tier conditions: `enemyRegen`, `bossEvery`, `rangedRateMul` and `speedMul` (T3–T6).
  - The `revive` command (once per run, `reviveHp` 50 %, viruses within `reviveClearRadius` purged, the run-end bonus taken back).
  - Multishot extra shots deal 35 %. Knockback has a 2 s cooldown per enemy.
  - The late wall (`lateWave` 30, ×`lateGrowth` 1.04/wave on HP and damage).
- **Meta, pure, in `src/meta`:**
  - `metaData` (`meta.json`, `labs.json` with 25 nodes in 5 branches);
  - `state` (MetaState with validation);
  - `workshop`, `labs` (`labEffects`), `runOptions` (`buildRunOptions`), `runEnd` (`settleRun`: Bits × labs × ad, boss Keys, milestone Keys once, best wave, tier unlock), `offline`;
  - `MetaStore` (SaveSlot `core-protocol.meta` v1 + `core-protocol.run` v1, which holds the snapshot and the RunOptions).
- **UI:**
  - **HomeScene:** BATTLE (tier picker, milestones, START / CONTINUE / ABANDON, summary), WORKSHOP (ATK/DEF/UTIL), LABS (5 branches), SETTINGS (sound, music, reduce-motion flags; stored but **not yet wired** to audio or shake — M7), and the offline modal (CLAIM / CLAIM ×2 ▶AD).
  - **Boot:** a fresh save goes straight into a run; later sessions open on Home (`?home=1` forces Home in dev).
  - **BattleScene:** `init({mode, tier})`, speeds come from the labs, the run is saved at every wave start, on `visibilitychange` and on `pagehide`, and pause shows SAVE & EXIT.
  - **Death:** the run is paid out at death (closing the tab loses nothing). REVIVE ▶AD takes the payout back and continues; ×2 BITS ▶AD pays the Bits again. HOME and RETRY (with the midgame ad).
- **Dev hooks:** `meta(patch?)`, `goto(scene, data)`, `homeTab(t)`, `ui().double/home/revive`.

## Rulings
- **B4 accepted at 1.38 h** (target 1.5–3 h, 8 greedy players at ×1).
  - **Why:** runs jump past the wall around wave 35 in one go, and the greedy bot plays better than people.
  - **What I tried:** a higher unlock threshold (55) changed nothing, so the spec's wave 50 stays.
  - **Cost if wrong:** tier 2 arrives about 10 % early.
- **Lab "banish" replaced by "Rare signal II"** (Rare/Epic ×2).
  - **Why:** banishing needs its own UI. The spec lists it; this is a deviation.
- **Meta prices 2.5× the first draft, workshop growth 1.24–1.29.**
  - **Why:** otherwise runs went from wave 20 to wave 150 after one visit to the workshop.
- **Balance fixes found by the meta sim:**
  - **Thorns capped at 20 levels.** Uncapped Thorns grew without limit, and because it scales with enemy damage it made the core immortal.
  - **Knockback 1 px/level with a 2 s cooldown.** Multishot plus Knockback pinned the whole crowd.
  - **Multishot extra shots deal 35 %.**
  - **A late wall from wave 30.**
- **Payout happens at death, not on HOME.**
  - **Why:** a closed tab must not lose the run.
  - **Revive** reverses the run's Bits and boss Keys. Milestone Keys stay, because the milestones stay claimed.
- **Panels are baked once per size and style** (`bakePanelOnce`), and HomeScene resets its arrays in `create()`.
  - **Why:** scenes are re-created on every visit, and re-baking a texture that was still referenced crashed the next draw.

## Gaps
- Cards (M5): `labEffects.cardSlots`/`presets` already exist. The CARDS tab and loadout are still missing.
- The settings flags (sound/music/reduceMotion) are stored but not yet read by audio or shake (M7).

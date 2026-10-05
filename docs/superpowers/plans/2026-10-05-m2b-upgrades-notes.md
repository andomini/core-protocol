# M2b — in-run stats, Energy economy, upgrade panel: notes

Branch `m2b-upgrades`, commits `605b5d1..` (plus this notes commit), on top of `93ae274`. Tests 108 → 195. `npm run typecheck`, `build`, `build:crazygames` and `build:poki` are green. `npm run ui` passes 61/61. No dev hooks or flags in `dist/` (grep for `__cp`, `unlockall` and `coreHealth` finds 0 files).

## What exists now

### Data: `src/data/stats.json`
- `tabs` (3 × 6 ids, in panel order), `stats` (one `StatDef` per stat) and `economy` (`interestCap`, `interestCapGrowth`).
- A `StatDef` has:
  - `tab`, `name`, `base`;
  - `per` with `mode` `add` (`base + per·L`) or `mul` (`base·per^L`, via powInt);
  - optional `maxLevel` and `cap` (cap on the final value);
  - `cost {base, growth}`, where `validateData` enforces growth ∈ [1.07, 1.12];
  - `format` (`num|int|pct|mult|perSec|plus`) and `lockedByDefault`.
- `core.json` now holds only `radius` and `projectileSpeed`. Health, regen, damage, attack speed and range are `stats.*.base`.
- New fields:
  - `config.hashCell` and `config.bossWaveEnemyMul`;
  - `enemies.*.knockback`, a resistance multiplier.

### Sim
- **`src/sim/stats.ts`** exports:
  - `effectiveStats(data, {workshop, run, mods}) → CoreStats`, covering the 18 stats plus `interestCap`. Level = workshop + run on one curve. Then every `add` modifier, then every `mul`, so order doesn't matter, then the cap, then clamping.
  - `Modifier = {stat: StatId|'interestCap', op: 'add'|'mul', value, source}`;
  - `costSum` (closed form with powInt; `Infinity` past 1e300, never stored), `maxAffordable` (exponential plus binary search: O(log²), no loop over levels, no log), and `quoteBuy`;
  - `zeroLevels` and `canonicalLevels`, which emit keys in STAT_IDS order. Key order is part of the hash.
- **World v2.**
  - Adds `levels`, `workshop`, `unlocked`, `mods` and `rng.upgrades`.
  - `core` is now just `{hp, fireCd}`. Get derived values from `worldStats(w, data)`. Never store them.
  - `RunOptions` gains `workshop?` and `unlocked?`.
  - Snapshot v2 rejects v1 envelopes, and v1 worlds inside a v2 envelope.
- **Commands (`src/sim/commands.ts`).**
  - `Command = {type:'buy', stat, count: n|'max'}` and `LoggedCommand {tick, cmd}`.
  - `applyCommands` validates everything, so logs can come from JSON.
  - A rejected buy emits `buyRejected` with `dead|unknown|badCount|locked|maxed|funds`.
  - An accepted buy emits `buy {stat, levels, level, cost, free}`.
  - `quoteFor(w, data, stat, count)` is the one quote both the UI and the sim use.
- **`step(w, data, commands, events)`** applies commands **first**, before the dead check and `tick++`.
- **Combat.**
  - Crit is rolled per projectile on `combat`.
  - Multishot = `1 + ⌊multishot⌋` projectiles at the k nearest distinct targets, found with `SpatialHash.kNearest`, ordered by (d², id).
  - Attack speed above `tickHz` fires several volleys per tick, with no shot banking while nothing is in range.
  - Defense % applies after its data cap.
  - Thorns hit melee attackers for `damage taken × thorns`, and can kill and pay out.
  - Lifesteal heals from damage actually dealt (overkill doesn't count).
  - Knockback pushes outward, never past the spawn ring. An enemy exactly at the centre is pushed along `directions[0]`.
- **Economy.**
  - Kill rewards are × (1 + Energy Bonus) for Energy and × (1 + Bits/Kill) for Bits.
  - At wave end: `waveReward` pays Interest = min(energy·interest, interestCap·interestCapGrowth^(wave−1)), then Energy/Wave and Bits/Wave.
- **`src/sim/replay.ts`**: `replay(data, opts, log, ticks, hashEvery)`. Log entries are matched on the world tick, so post-death commands replay; an out-of-order log throws.

### Render / UI
- **RunSession.**
  - `queue(cmd)` and `hasPending`.
  - `applyPendingNow(sink)` is used while paused or dead. It is exactly equivalent to the next step, because commands come first in `step`.
  - `log` (each entry stamped with `world.tick`), `opts`, and `stats`, which is refreshed after steps and commands.
- **`UpgradePanel` (`src/ui/UpgradePanel.ts`)** with geometry from `src/ui/panelLayout.ts`, which is pure and tested.
  - Tabs, a ×1/×10/MAX toggle and 6 reused rows: glyph · name · `LV n (+k)` · `value › next` · ⚡price.
  - Rows switch to two-line when the row is ≥ 78 px.
  - Affordable rows glow in the tab colour with a gold price box. Locked rows show a padlock glyph and `LAB`.
  - Hold-to-repeat: 380 ms delay, then 150 → 55 ms. A held row only queues when the shared quote is affordable and nothing is pending.
  - Feedback comes from sim `buy` events: a row flash, a glyph punch, a value punch, and a rising `+N` (or `FREE +N`) tick.
- **Glyphs.** `textures.ts` bakes `st_<statId>` (18 neon glyphs, tinted per tab: `TAB_COLOR` in palette) and `ic_lock`.
- **Layout.** `makeLayout(o, data, aspect)`: portrait is 720 × clamp(720·aspect, 1280, 1560).
  - At 390×844 that gives 720×1558: arena 776 px tall (+72), panel 646 px (+206), rows 87 px.
  - At 720×1280 the panel is 440 px and rows are 52 px single-line, 28 px text.

## Balance (B2): `npm run sim:balance` → `reports/balance-m2b.md`
24 seeds, tier 1, first run (no workshop, starred stats locked):

| policy | median wave | range | median sim-min |
|---|---|---|---|
| none | 7 | 6–8 | 3.0 |
| **greedy** | **18** | 10–23 | **8.8** |
| atk-first | 21 | 13–26 | 10.4 |
| def-first | 8 | 6–10 | 3.9 |
| round-robin | 8 | 6–10 | 4.0 |

Tuning applied:
- Boss: HP 240 → 120 (×20 basic, not ×40), damage 30 → 10. Boss waves spawn 50 % of the regular enemies.
- `energyGrowth` 1.03 → 1.02; `enemiesPerWaveGrowth` 1.5 → 1.6.
- Cost growth: 1.12 for the unbounded power stats and Range, 1.10 for capped and economy stats, 1.08 for Thorns and Knockback.
- Thorns: 25 %/level.

## Rulings
| Decision | Why | Cost if wrong |
|---|---|---|
| Workshop and run levels share one value curve (level = workshop + run); in-run cost depends on run level only; `maxLevel` caps the **run** level | The simplest reading of "workshop sets the starting value". The in-run price restarts each run. | M4 may want separate workshop per-level values: add a `workshop` block to `StatDef`. |
| Free Upgrade = one roll per accepted purchase; on success the **whole batch** is free | The expected refund (p × cost) equals rolling each level separately, and it stays O(1) for MAX. Uses its own `upgrades` stream (tested: combat and spawn streams are untouched). | Higher variance on big MAX buys. A per-level roll would need a loop. |
| ×10 is all-or-nothing (clipped to the levels left); MAX buys every affordable level; an unaffordable MAX shows the next level's price | Predictable price on the button. | UX taste; it's one branch in `quoteBuy`. |
| Bits/Kill is a % bonus (like Energy Bonus), Bits/Wave and Energy/Wave are flat | Read "same pattern for Bits" literally. | Retune in data, or switch Bits/Kill to flat. |
| Interest cap = `interestCap × interestCapGrowth^(wave−1)` (50, 1.03), × `interestCap` modifiers | A fixed cap would go stale. Modifiers serve the Compound perk and the 💰6 set. | Data only. |
| Boss ×20 HP (spec says ×40), damage ×3.3 basic; boss waves bring half the regulars (`bossWaveEnemyMul` 0.5) | At ×40 / full escort, every bot died at wave 10 (all 20 seeds); deaths clustered on boss waves 10/20/30. | M3 perks change DPS. Re-run `sim:balance`. |
| Range max level 10 × 2 px (300 → 320) | Keeps the max-level ring inside the 720-px portrait width at the tallest aspect (tested). | **M4:** the lab's "+10 Range levels" (→ 340) overflows the portrait arena width by ~8 px at the tallest aspect. Either shrink the arena cap or accept slight cropping. |
| Portrait arena gets 30 % of the extra height, capped at +72 px | A taller arena zooms the world in, which pushes side spawns further off-screen (the ≤ 1 s visibility rule, now tested at 1280, 1558 and 1560) and the ring toward the edges. | Purely layout constants. |
| 1280-tall portrait uses compact single-line rows (52 px) | Fits 6 rows + tabs in 440 px with 28 px text and no scrolling. | Rows are ~28 CSS px tall on a 16:9 phone; the full row width (680 px) is the tap target. |
| Range ring and orbiters redraw when the derived Range changes | Range purchases must resize the ring. | — |
| `__cp.give(n)` dev cheat mutates `world.energy` outside the log | Needed for the hold-to-repeat smoke. | Replays of that dev run diverge. Never used by tools or tests that replay. |
| Golden replay uses `unlocked: all` and workshop levels (Free Upgrade 15, Energy Bonus 40, Energy/Wave 15, Health 5) | Exercises every input path (locked stats, workshop, free rolls) in 3 minutes. | Any sim or data change breaks it on purpose. Re-record with `npm run replay:record -- --update` and note why. |

## Dev hooks and flags (DEV only)
- `?unlockall=1` unlocks Multishot, Lifesteal, Interest and Free Upgrade.
- `__cp.state()` now also returns `levels`, `unlocked`, `tab`, `amount` and `commands` (the log length).
- `__cp.ui()` returns `{tab, amount, tabs[{tab, rect}], amountRect, rows[{stat, rect, locked, affordable, level}], restart, layout}` in logical px.
- `__cp.setTab(t)`, `__cp.buy(stat, count)` (same path as a tap) and `__cp.give(energy)`.

## Smoke and tools
- `npm run ui` covers both orientations: portrait 390×844, landscape 1280×720 and 907×510.
  - The Damage row bought by a real tap, both paused and running (level +1, Energy down).
  - Tab and toggle taps, a no-op on a locked row, hold-to-repeat and release, and RESTART tapped from its rect.
  - The 1558 logical height.
  - Stress: 60 FPS on desktop and on the CPU-throttled phone.
- Screenshots in `reports/screens/`: `portrait-upgrades.jpg`, `portrait-midwave.jpg`, `landscape-1280-720-upgrades.jpg`, `landscape-907-510-upgrades.jpg`, `landscape-midwave.jpg`, `stress.jpg`, plus the death screenshots.
- `npm run sim:smoke -- <seed> <tier> [policy] [--unlockall]`, `npm run sim:balance [-- --override patch.json]` and `npm run replay:record [-- --update]`.

## Known gaps / for M3+
- **DEF is weak.** `def-first` dies at wave 8 and `atk-first` beats `greedy` by 3 waves. Thorns and Knockback matter little against ranged pressure. Ranged viruses deal most of the late damage, because the core shoots the nearest melee first. Revisit with M3 perks (B6) and maybe target priority.
- No bot ever buys Bits stats; they have no in-run value until M4's meta gives Bits a use.
- Starred stats are expensive (Multishot 200, Lifesteal 50) and untested in balance. Balance them when labs unlock them (M4).
- The panel does not scroll; 6 rows always fit. A 7th stat per tab would need a list.
- Energy shown in the HUD is floored, while prices are rounded up below 1000. A row can glow at "5 ⚡" while the HUD shows 5.
- `RunSession.log` grows for the whole run. That's fine for a run (thousands of entries); M2.5 snapshots will need to store it if replays should survive reloads.
- Snapshot/save of the run is still not wired into the UI (spec §2.5).

# M2b — 18 in-run stats, Energy economy, upgrade panel

Branch `m2b-upgrades`. Spec §2.3, §5, §6, §7 (B2). Builds on M2a (see `2026-10-05-m2a-battle-view-notes.md`).

## Tasks and interfaces

### T1 — stat data + pure stat math (TDD)
- `src/data/stats.json`: `{ tabs: {atk: StatId[6], def: [...], util: [...]}, stats: Record<StatId, StatDef>, economy: {...} }`.
  `StatDef = { tab, name, base, per, mode: 'add'|'mul', maxLevel?: number, cap?: number, cost: {base, growth ∈ [1.07,1.12]}, format: 'num'|'pct'|'mult'|'rate'|'px'|'int', lockedByDefault }`.
  `core.json` keeps only radius + projectileSpeed: health/regen/damage/attackSpeed/range move to `stats.*.base` (one source of truth).
- `src/sim/stats.ts` (pure):
  - `statValue(def, level)`: add → `base + per·L`, mul → `base·powInt(per, L)`.
  - `effectiveStats(data, {workshop, run, mods}) → CoreStats` (18 stats + `interestCap`): level = workshop + run; then Σadd, then Πmul from `mods`; then `cap`; clamped.
  - `levelCost(def, L)`, `costSum(def, L, n)` (closed-form geometric sum via powInt), `maxAffordable(def, L, energy)` (exponential + binary search, no per-level loop, no log), `buyQuote(data, w, stat, count)`.
- Tests: `tests/stats.test.ts` (values, mods order, caps, cost growth bounds, sum = loop sum, MAX at 1e250, max levels).

### T2 — World v2, commands, tick log
- World `v: 2`: `levels`, `workshop`, `unlocked: StatId[]`, `mods: Modifier[]`, `rng.upgrades`; `core` keeps only `hp`, `fireCd` (derived values are never stored).
- `RunOptions { seed, tier, workshop?, unlocked? }`.
- `src/sim/commands.ts`: `Command = {type:'buy', stat, count: number|'max'}`, `LoggedCommand {tick, cmd}`, `applyCommands(w, data, cmds, events)`; rejects (locked/maxed/funds/dead/bad) → `buyRejected` event; free upgrade = one roll on `rng.upgrades` per accepted purchase.
- `step(w, data, commands, events)`: commands first (before the dead check / tick++), so applying them between steps ≡ applying them at the start of the next step.
- Snapshot version 2; v1 rejected cleanly.

### T3 — combat + economy effects, spatial hash
- `src/sim/spatial.ts`: uniform grid; `kNearest(x, y, range, k, out)` ordered by (d², id).
- crit (combat stream), multishot (k nearest distinct), defense % (cap in data), thorns (melee), lifesteal (actual damage dealt), knockback (outward, never past the spawn ring, centre guard, per-enemy `knockback` multiplier), regen/health.
- Energy Bonus / Bits/Kill (% per kill), Energy/Wave and Bits/Wave (flat at wave end), Interest (% unspent, cap = `economy.interestCap × energyGrowth^(wave−1)` × mods).
- Tests per effect in `tests/effects.test.ts`, spatial hash vs brute force.

### T4 — bot + balance (`tools/sim/bot.ts`, `tools/sim/balance.ts`, `npm run sim:balance` → `reports/balance-m2b.md`)
- Policies: none, greedy, atk-first, def-first, round-robin. Tune `src/data` for B2.

### T5 — replay + golden
- `src/sim/replay.ts` `replay(data, opts, log, ticks, hashEvery)`; `tools/sim/record-replay.ts [--update]`; `tests/replays/golden-01.json` (3 min, purchases); `tests/replay.test.ts`.

### T6 — adaptive portrait height + panel layout (pure)
- `makeLayout(o, data, aspect?)`: portrait h = clamp(720·aspect, 1280, 1560); extra height split arena/panel with the arena capped so spawn visibility ≤ 1 s still holds.
- `src/ui/panelLayout.ts`: tabs, amount toggle, 6 rows, fonts ≥ minFont; tested.

### T7 — upgrade panel UI
- `src/ui/UpgradePanel.ts`; RunSession command queue (`queue`, `applyPendingNow` when paused, `log`), stats cache; HUD/WorldView read derived stats from the session. Hold-to-repeat, pulse + number tick, lock/LAB, affordable glow. `?unlockall=1` (DEV).

### T8 — smoke + screenshots + stress; T9 — notes.

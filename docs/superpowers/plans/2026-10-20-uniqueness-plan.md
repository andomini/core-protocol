# Uniqueness plan — 2026-10-20

Source: the 2026-10-20 game analysis (why Core Protocol reads as a The Tower clone, what is missing, what to change).
This document fixes the change list, the phases, the agent assignments and the merge protocol so that several
agents can work in parallel without touching the same files.

## 1. Diagnosis (short)

- The skeleton is The Tower 1:1 — the same 18 stat names, workshop, labs, cards, tiers, offline Bits.
- The look is generic dark neon; the own research brief (`../research/07-design-brief.md`) warns against exactly that.
- The "virus" theme has no body: enemies are squares, triangles and rhombi.
- Everything that is unique (crystal, fusions, territory, mutations, structures) is invisible in a first run:
  a fresh player dies at waves 4–6 with 3–4 modules, mutations start at wave 20, Apex at 80+, covers show no crystal.
- Combat has no active verb: the player only buys levels and picks cards.
- 5 enemy kinds + 1 boss; plateaus of 14–19 h with no intermediate goals (`reports/progression.md`); B6 fails
  (overload dominant, 1.40 vs ≤ 1.20); the Weld / Lattice / Apex / Resonance rules are invisible; zero real telemetry.

## 2. Change list

P0 (first run must show what is unique)
1. **Boot sector** — before wave 1 the player picks 1 of 3 starter crystals of 3 pre-arranged modules each.
2. **Virus bodies** — procedural enemy sprites that read as viruses (capsids, spikes, flagella, phage legs), render only.
3. **Early mutations** — genome visible from wave 1 with a countdown, first mutation at wave 5, then every 8 waves, softer level 1.
4. **Pulse** — an active ability: tap the core, effect by dominant tag, cooldown; a `Command`; `autoPulse` lab node.
5. **Covers / thumbnail** show the crystal and a virus body (`tools/covers`).
6. **Launch and measure** — owner task: deploy, read `telemetry:report`, decide phase 3 from data.

P1 (depth and goals)
7. Four new virus kinds: Leech (drains Bits), Spore (splits), Phage (latches on structures), Carrier (shields others).
8. A boss per tier with a mechanic, tier unlock as a finale.
9. Territory Beacon (a buildable that pushes infection back and marks a goal on the map).
10. **Daily missions** ×3 paying Keys, and a **next-unlock track** on Home (what the next Bits/Keys buy, with progress).

P2 (polish and balance)
11. Drop Weld, shelve Resonance + Apex, keep Lattice; editor readout ≤ 3 lines.
12. Structure upgrades inside structures.
13. Fix B6; arrange bots default in `sim:balance`.
14. Designed SFX, a second music loop, card VFX.
15. Prestige / endless unlock, crystal cosmetics.

## 3. Phases

| Phase | Items | Agents (Opus 5.5, own worktree each) |
|---|---|---|
| 1 | 1, 3, 2, 10, 4 | A1 boot sector + early mutations · A2 virus bodies · A3 missions + next-unlock track · A4 Pulse |
| 2 | 5, 7, 14 | B1 covers · B2 new virus kinds (sim + data + render hooks) · B3 audio/VFX |
| 3 | 8, 9, 11, 12, 13 | C1 bosses · C2 beacon · C3 simplification + readout · C4 structure upgrades + B6 |
| — | 6, 15 | owner |

## 4. Phase 1 — file ownership

Disjoint sets; a file not listed below is read-only for everyone. Shared seams are listed with the rule for them.

**A1 — Boot sector + early mutations**
- `src/data/boot.json` (new), `src/data/mutations.json`, `src/data/perks.json` (schedule only if needed)
- `src/sim/perks.ts`, `src/sim/mutations.ts`, `src/sim/waves.ts`
- `src/ui/PickOverlay.ts`, `src/ui/pickLayout.ts`, `src/ui/GenomeStrip.ts`
- `tests/perks.test.ts`, `tests/fusions.test.ts`, new `tests/boot.test.ts`, `tests/pickLayout.test.ts`
- `tools/sim/bot.ts` (pick policies learn the boot offer), `tools/sim/balance.ts` if gates need the boot

**A2 — Virus bodies (render only, no sim change)**
- `src/render/textures.ts`, `src/render/WorldView.ts`, `src/render/pools.ts`, `src/render/effects.ts`, `src/render/palette.ts`
- `tests/effects.test.ts`, `tests/spawnVisibility.test.ts`

**A3 — Daily missions + next-unlock track**
- `src/data/missions.json` (new), `src/meta/missions.ts` (new), `src/meta/runEnd.ts`, `src/meta/runStats.ts`, `src/meta/state.ts`, `src/meta/MetaStore.ts`
- `src/ui/home/homeLayout.ts`, `src/render/scenes/HomeScene.ts`, `src/ui/DeathOverlay.ts`
- `tests/meta.test.ts`, `tests/metaStore.test.ts`, `tests/runStats.test.ts`, new `tests/missions.test.ts`

**A4 — Pulse**
- `src/data/pulse.json` (new), `src/sim/pulse.ts` (new), `src/data/labs.json` (one `autoPulse` node)
- `src/ui/Hud.ts`, `src/render/widget.ts`, `src/render/RunSession.ts`
- new `tests/pulse.test.ts`, `tests/commands.test.ts`, `tests/labRules.test.ts`

**Shared seams (both A1 and A4 add to them; each adds its own lines, the merge reconciles)**
- `src/sim/state.ts` — new World fields; both bump `WORLD_VERSION` 7 → 8.
- `src/sim/snapshot.ts` — `SNAPSHOT_VERSION` 7 → 8; a minimal migration that adds defaults for the agent's own fields.
- `src/sim/commands.ts` — a new `Command` variant each (`pickBoot`, `pulse`).
- `src/sim/step.ts` — one call site each.
- `src/sim/events.ts` — one event each.
- `src/sim/data.ts` — one data file each.
- `src/ui/Hints.ts` — one `HintId` each.
- `src/render/scenes/BattleScene.ts` — wiring only (A1: boot offer, A2: nothing, A4: pulse tap + event).
- `tests/replays/golden-01.json` — re-recorded on the branch; re-recorded again after the merge.
- `tests/data.test.ts`, `tests/purity.test.ts` — extend, never relax.

## 5. Constraints for every agent

- Project rules in `CLAUDE.md`: pure `src/sim`, numbers in `src/data/*.json`, World is plain JSON, actions are `Command`s.
- Node modules: a worktree has none; `ln -s /home/vlad/Projects/games/core-protocol/node_modules node_modules` (do not `npm ci`).
- Never start a dev server on :5173; the Playwright smoke runs as `UI_PORT=<own port> npm run ui` (A1 5181, A2 5182, A3 5183, A4 5184).
- Never run `npm run sim:progression` (about an hour).
- Commit on the worktree branch with the attribution line; do not push; do not touch `main`.
- Keep a notes file `docs/superpowers/plans/2026-10-20-uniqueness-notes-<agent>.md`: decisions, numbers, open issues.

## 6. Acceptance gates (per branch, then again on main after the merge)

- `npm test`, `npm run typecheck`, `UI_PORT=… npm run ui` green.
- `npm run build:local` passes `tools/postbuild.mjs` (≤ 1 MB transfer).
- `npm run sim:balance`: B1 and B5 hold, B2 keeps a fresh player's death at waves 4–6, B6 not worse than 1.40.
- No new `Math.random` / `Date` in `src/sim` (purity test).

## 7. Merge protocol

1. Merge A1 first (world shape, boot offer). Re-record the golden replay. Run the gates.
2. Merge A2 (render only; no sim conflict expected).
3. Merge A3 (meta only; `runEnd.ts` may touch `RunResult`).
4. Merge A4; reconcile `state.ts` / `snapshot.ts` / `commands.ts` / `step.ts` / `Hints.ts` by keeping both additions under one
   version 8. Re-record the golden replay once more. Run the gates. Push.
5. Phase 2 agents branch from the merged main.

## 8. Phase 1 result (merged 2026-10-20, main 139e3e0)

Four Opus agents in worktrees (notes: `2026-10-20-uniqueness-notes-a1..a4.md`), merged A2 → A3 → A4 → A1; one trivial
conflict per shared seam, both v8 migrations kept under one `WORLD_VERSION = 8`; golden replay re-recorded once.

| Gate | Before (main a254a3b) | After |
|---|---|---|
| B1 first pick ≤ 30 s | PASS | PASS |
| B2 fresh player dies at waves 4–6 | FAIL (greedy median 7) | PASS (median 6; none-buy 3) |
| B5 ≥ 80 % reach a 2-set by wave 10 | PASS | PASS (100 %, wave 1 via the boot sector) |
| B6 tag medians within ±20 % | FAIL (1.60) | PASS (7/6/6/6/6 = 1.17) |
| `npm test` | 616 | 668 |
| `npm run ui` | 346/346 | 352/352 (stress 60 FPS desktop) |
| build (local) | failed the brand check | 470.8 KB gz, checks pass |

Fixes made at the merge: a portal-neutral label on the leaderboard rename button (the postbuild brand check failed on
local/poki builds since 4d08748); the `demoCrystal` dev hook starts from an empty crystal and honours its slots
(`id in w.perks` was always true); the dying body copy starts at its live pose.

Open from the agents' notes: HintId `boot` not done; Space fires the Pulse and pause moved to P; the 50 s Pulse cooldown
is long (try 30–40 s once telemetry exists); missions read the top set / best fusion at death, not the run's peak, and a
"cleanse N hexes" mission needs a sim event (it became "destroy N nests"); mission Keys are not in `lifetime.keysEarned`.

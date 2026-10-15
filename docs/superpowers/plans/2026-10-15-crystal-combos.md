# Crystal combos: implementation plan (2026-10-15)

Spec: `docs/superpowers/specs/2026-10-15-crystal-combos.md` (read it first; this file says *how*, in what order,
and what "done" means). Builds on the uncommitted working tree of 2026-10-15 (first fusion pass, territory
regrowth, core colour) — do not stash or reset it.

Ground rules (from `CLAUDE.md`, repeated because every phase touches them):
- `src/sim` stays pure and deterministic; all numbers in `src/data/*.json`; World stays plain JSON; player
  actions only as `Command`s through `RunSession.queue`.
- Re-record `tests/replays/golden-01.json` **once**, at the end of phase 1, after the data and sim changes
  are final (`npm run replay:record -- --update`), and say so in the notes.
- After each phase: `npx vitest run` and `npm run typecheck` green. UI smoke (`npm run ui`) only from
  phase 3 on. No commits unless asked.
- Widget (`?widget=1`, branch `widget`) keeps skipping the editor (`WIDGET` flag) — nothing to do there.

## Phase 1 — Sim: links, tiers, live refresh, `moveModule`

Files: `src/data/sets.json`, `src/data/crystal.json`, `src/sim/perkData.ts`, `src/sim/data.ts` (only if
`crystal.auto` is validated there), `src/sim/crystal.ts`, `src/sim/perks.ts`, `src/sim/commands.ts`,
`src/sim/state.ts`, `src/sim/snapshot.ts`, `src/sim/events.ts`, `src/sim/statIds.ts` (no change expected),
`tools/sim/balance.ts`, `tools/sim/record-replay.ts`, `src/render/devHooks.ts` (state field rename only).

1. **Data.** `sets.json`: replace `fusionMin` with `fusionTiers: [1, 3, 5]`; each of the 10 fusions becomes
   `{ name, tiers: { "1": [...], "3": [...], "5": [...] } }` with the ladder from spec §3 (existing effect
   types only — check each against `validateEffect`; if a line needs a type that does not exist, pick the
   nearest existing one and list the substitution in the notes). `crystal.json`: `cellSize` 24 (see the
   check in step 8), `auto.link: 1`. `perkData.ts`: `FusionDef { name; tiers: Record<string, Effect[]> }`,
   `SetsDef.fusionTiers: number[]` (ascending positive integers); `validateSets` checks every pair key is in
   TAGS order, all 10 pairs exist, every tier in `fusionTiers` is present and non-empty, effects validate.
2. **State.** `state.ts`: `fusions: string[]` → `fusionTiers: Record<string, number>` (missing = 0),
   `createWorld` gives `{}`. `WORLD_VERSION` stays 7. `snapshot.ts`: a missing `fusionTiers` → `{}`
   (validate: object, integer values ≥ 0), an old `fusions` field is dropped.
3. **Geometry** (`crystal.ts`). Keep `fusionLinks` (drop `live`; one entry per shared edge, `key` in TAGS
   order). Add `fusionLinkCounts(w, data): Record<string, number>`. Refactor the counting helpers to take a
   module list so previews can run on a candidate list: `clusterCountsOf(modules)`, `fusionLinkCountsOf(modules, data)`,
   `sectorTagsOf(modules, data)`; the World versions delegate. Add:
   - `crystalConnected(modules, data): boolean` — BFS over `isNeighbour` from every module on ring
     `coreRing + 1`; true when every module is reached (an empty crystal is connected).
   - `moveModule(w, data, from, to): 'from' | 'slot' | 'link' | null` — `from` must hold a module; `to` must be
     a slot the current ring limit allows (the same limit `freeSlots` uses) and `≠ from`; empty `to` → move,
     occupied → swap; after the change `crystalConnected` must hold, else revert and return `'link'`. The
     module keeps its index in `w.crystal`.
   - `CrystalDiff { sets: {tag, from, to, tierFrom, tierTo}[]; fusions: {key, from, to, tierFrom, tierTo}[]; sectors: {sector, from, to}[] }`
     with only changed entries; `crystalDiff(w, data, candidate: Module[])`; `slotGains(w, data, perk, tag, slot)`
     (candidate = crystal + the new module) and `movePreview(w, data, from, to)` (`null` when the move is
     invalid). Set counts in the diff include `w.cardTags` on both sides, like `tagCounts`.
   - `autoSlot`: score `+= differentTagNeighbours × data.crystal.auto.link`.
4. **Tiers** (`perks.ts`). `fusionTierFor(data, links)` / `nextFusionTier` mirroring `tierFor` / `nextTier`.
   Replace `applySetTiers` + `applyFusions` with `refreshCrystal(w, data, events)` (spec §3): compute the
   target tiers, for each risen tier append the stat mods of the newly reached tiers (sources
   `set:<tag>:<t>`, `fusion:<key>:<t>`) and arm their periodic timers; for each fallen tier remove
   `w.mods` with those sources and every `w.timers` key starting with `<source>:`; write `w.setTiers` /
   `w.fusionTiers`; push `setTier {tag, tier, prev}` / `fusion {key, tier, prev}` only when the tier changed;
   wrap in `withHealth`. Call it from `grantPerk`, `initProtocols` and the new command. `perkProfile` folds
   every reached fusion tier's effects (tiers 1..reached, like set tiers); if the profile is cached, the key
   must include `fusionTiers`.
5. **Command.** `commands.ts`: `{ type: 'moveModule'; from: [number, number]; to: [number, number] }`; the
   dispatcher validates with `isSlot` on both, rejects when the core is dead, applies `moveModule`, then
   `refreshCrystal`. Events: `events.ts` gains `prev` on `setTier` and `tier, prev` on `fusion` (keep `a`,
   `b` on `fusion` for the burst: use the pair's first link).
6. **Tools.** `tools/sim/balance.ts`, `tools/sim/record-replay.ts`, `devHooks.ts`: `fusions` → `fusionTiers`
   wherever they report it. Bots never move.
7. **Tests.**
   - `tests/fusions.test.ts` (rewrite): data (10 pairs, tiers 1/3/5 present); link counting (two touching
     modules of different tags = 1 link; one module touching two of the other tag = 2); tiers at 1 / 3 / 5
     links with `fusion` events carrying `tier`/`prev`; a swap that separates the pair drops the tier, its
     mods (`w.mods` has no `fusion:<key>:*`) and its timers, with a `tier < prev` event; Cold Storage I
     frozen kill ×1.5 (adjust the existing kill test); old saves migrate to `{}`.
   - `tests/crystal.test.ts`: `crystalConnected`; `moveModule` move / swap / `from` / `slot` / `link`
     rejects; `movePreview` and `slotGains` diffs (a set turning on, a set turning off, a wedge change);
     `autoSlot` prefers a link-making slot over a plain one when set/sector scores tie.
   - `tests/perks.test.ts` / `tests/protocolEffects.test.ts`: a set tier that is no longer met switches off
     (mods and timers gone, profile reflects it) and comes back on without a duplicate event or duplicate mods.
   - `tests/commands.test.ts` + `tests/replay.test.ts`: `moveModule` round-trips through `RunSession.queue`
     and a replay (record a short replay in the test, not the golden).
   - `tests/perkData.test.ts`: the new validation messages.
8. **cellSize check** before re-recording: with 24 the ring-5 crystal reaches `(5·√3 + 1) · 24 ≈ 232 px`;
   assert in a test (or a one-off script) that `arenaRadius(data, wave)` at the wave where ring 5 opens
   (`ringEvery · (maxRingCap − maxRing)`) exceeds the ring-`crystalRing(wave)` reach by ≥ one cell at every
   growth step, and that `crystalShape` reach stays below the spawn radius. If it does not fit, keep 20 and
   note it.
9. `npm run replay:record -- --update`; `npx vitest run`; `npm run typecheck`; `npm run sim:balance` (B1–B6;
   B6 compares tag medians of 5–7 waves, so a one-wave shift flips it — report the medians, do not retune
   blindly).

Done when: all tests green, golden re-recorded once, balance report regenerated and summarized in the notes.

## Phase 2 — Arena: plates, welds, badges, LOD

Files: `src/render/CrystalView.ts`, `src/render/scenes/BattleScene.ts` (event handling only),
`src/ui/tagIcon.ts` (reuse), `src/render/textures.ts` only if a badge texture is cheaper than Graphics.

1. Put the module layers (plates, welds, modules, slots, hover, badges) in one `Phaser.GameObjects.Container`
   at the core centre, drawn in core-relative coordinates; the territory layers stay where they are. This is
   what phase 3 zooms. Redraw key = crystal modules + stacks + `setTiers` + `fusionTiers` + zoom.
2. **Plates** (`drawPlates`): per same-tag cluster (`moduleCluster` members) fill each member hex in the tag
   colour and stroke only outer edges (edge drawn when the neighbour across it is not a member). Tier 0:
   fill α 0.15, stroke 1.5 px α 0.5; tier on: fill α 0.3, stroke 3 px α 1 + an ADD-blend glow pass; a round
   badge with the tier number on the member closest to the centroid. Clusters of one module get the same
   treatment (a plate of one hex), so a lone module reads as "not yet a set".
3. **Welds** (`drawWelds`, replaces `drawSeams`): per link a bar across the shared edge (0.5 R long, 0.18 R
   wide, each half in its tag colour). Pair tier 0: α 0.35; tier ≥ I: α 1 and a slow pulse on the pulse
   layer; the pair's first link carries a two-colour diamond badge with I / II / III. The tier-up burst
   (existing rings + sparks) runs along every link of the pair; a tier-down shows nothing in the arena
   (the toast in phase 4 covers it).
4. **Modules**: glyph + pips as now; when `R ≥ 14 px` draw the stack count as a number instead of pips.
   **LOD** when `R < 11 px`: no per-module glyphs/pips, one glyph per cluster at its centroid; welds and
   badges stay.
5. `BattleScene`: `case 'setTier'` / `case 'fusion'` celebrate only when `tier > prev` (banner + burst);
   `tier < prev` → nothing here (phase 4 adds the toast). Keep the core colour.

Done when: at 1280×720 and 360×640 the crystal is readable from a screenshot without text: clusters,
tiers, links and fusion tiers are distinguishable (take `reports/screens/crystal-{landscape,portrait}.jpg`
with `tools/ui/harness.mjs`), no console errors, 60 fps unchanged in the stress scene.

## Phase 3 — The crystal editor

Files: new `src/ui/CrystalEditor.ts` (replaces `src/ui/PlacePanel.ts`, delete it), `src/render/CrystalView.ts`
(`setZoom`), `src/render/scenes/BattleScene.ts` (`choosePerk`, `placeModule`, `endPlacing`, pause menu,
pointer handling), `src/ui/layout.ts` / `src/ui/panelLayout.ts` (editor rects), `src/meta/state.ts`
(`editorSeen`), `src/render/devHooks.ts` (`openEditor`, `closeEditor`, `editor()` state, `moveModule`,
`slotScreen(q, r)`), `tools/ui/smoke.mjs` (new `editor` step).

1. `CrystalView.setZoom(z: { scale: number } | null)`: scales and raises the container (depth above the HUD,
   below overlays), adds a scrim over the battle, draws the core hex in the core colour and the six sector
   wedges (faint tag tints, `sectorTags`) under the modules. Scale: `0.39 · min(arena.w, arena.h) / ((ring·√3 + 1) · cellSize)`
   with `ring` = the current ring limit. Badge text must be re-created at the zoomed size (scaled Phaser
   Text blurs), so the draw key includes the zoom.
2. **Editor** (`CrystalEditor`): header (title + up to three readout lines), bonus strip (five tags
   `count · tier`, every pair with ≥ 1 link `links · tier`), buttons. Two modes:
   - *Place*: title `PLACE <PERK>`; free slots outlined by their `slotGains` (tag colour / other tag colour /
     white / dim cyan), auto slot pulsing; tap a slot or AUTO → `pickPerk {index, slot}`, then switch to
     *Arrange*; BACK → back to the cards; AUTO ALL → sets `settings.autoPlace` and places (as today).
   - *Arrange*: tap a module → select (pulsing white rim) + the readout of hovered targets via `movePreview`;
     tap a valid slot/module → `moveModule`; invalid targets dim; desktop drag (pointerdown on a module,
     pointerup on a target) does the same with a ghost hex. UNDO issues the inverse command (a stack of
     the moves made in this session of the editor); DONE closes. The readout shows the committed diff for a
     moment after each move.
   - Readout line order: sets, fusions, wedges; green when a tier rises, red when it falls, dim otherwise;
     `No change` when empty. Use `perkText.ts` for names.
   - First open (`meta.editorSeen === false`): the three-line rule strip under the bonus strip; set the flag
     on DONE.
3. `BattleScene`: `choosePerk` opens the editor in *Place* mode exactly where `PlacePanel` opened (same
   skip conditions); the pause menu gains **CRYSTAL** (alive, not in a pick) → editor in *Arrange*, DONE
   returns to the pause menu. Commands go through `this.command(...)` (applies at once while paused / in a
   pick). Hover/tap module card keeps working outside the editor.
4. Dev hooks for the smoke: `__cp.openEditor()`, `__cp.closeEditor()`, `__cp.editor()` →
   `{ open, mode, selected, readout: string[], strip: string[] }`, `__cp.slotScreen(q, r)` → screen point,
   `__cp.moveModule(from, to)`.
5. `tools/ui/smoke.mjs` `editor` step in both orientations: reach a pick with a new-module card, the editor
   opens with a readout; place via a slot tap (`slotScreen`); a move changes the strip; UNDO restores it;
   DONE resumes; `minTextCheck`; shots `editor-place-<o>.jpg`, `editor-arrange-<o>.jpg`; no console errors.
   Update the `protocols` step where it used `placeAuto` if the flow changed.

Done when: `npm run ui` passes in both orientations, the editor fits 360×640 with `minFont`, and a module can
be placed, moved, swapped and undone with taps only.

## Phase 4 — HUD, panels, cards, banners, toasts

Files: `src/ui/SetChips.ts`, `src/ui/SetTooltip.ts`, `src/ui/ProtocolsPanel.ts`, `src/ui/perkText.ts`,
`src/ui/PickOverlay.ts` (footer), `src/ui/statsRows.ts`, `src/render/scenes/BattleScene.ts` (banners,
toasts, hover card), `tools/ui/smoke.mjs` (`protocols` step: fusion chip check).

1. `perkText.ts`: `fusionLines(data, key, tier)` (the lines of one tier), `fusionLadder(data, key)`.
2. `SetChips`: after the tag chips, one chip per pair with ≥ 1 link: half-and-half disc + `I / II / III`
   (or `·` at tier 0 with links); `SetTooltip` shows the ladder with `links n / next`.
3. `ProtocolsPanel`: fusions as ladders like sets (name, links, tier rows lit).
4. `PickOverlay` footer: new-module cards get a second line when `slotGains` at `autoSlot` adds a link that
   raises a fusion tier (`⚡+❄ → THERMAL SHOCK I`) or when the set tier rises (already there).
5. Module card: per touching tag `Touches Chain: 2 links → Superconductor I (II at 3)`.
6. Banners: `FUSION II · SUPERCONDUCTOR` + the tier's first line on `tier > prev`; dim toast on `tier < prev`
   (`Thermal Shock II offline`, `Overload 4-set offline`), reusing the ad-fail toast style.
7. `statsRows.ts`: fusions reached → highest tier per pair.

Done when: UI smoke green, `reports/screens/protocols-*.jpg` and `pick-*.jpg` refreshed and checked by eye.

## Phase 5 — Verification and notes

- `npx vitest run`, `npm run typecheck`, `npm run ui` (both orientations + portal), `npm run build:all` (size
  gate in `tools/postbuild.mjs`), `npm run sim:balance`.
- Write `docs/superpowers/plans/2026-10-15-crystal-combos-notes.md` in the format of
  `2026-10-14-crystal-territory-mutations-notes.md`: Sim / Render / UI / Balance bullets, what changed from
  the spec and why, the balance medians, the cellSize decision, substitutions in the fusion ladders.
- Update `CLAUDE.md` only if a command changed.

## Phase 6 (optional, ask first) — Nexus
`crystal.nexusMinTags` (0 = off): a module touching ≥ 3 other tags counts its stacks twice in
`moduleCluster`; white rim + ✦ in `CrystalView`; a line in the module card and the editor readout.

## Open questions already answered in the spec (do not re-ask; the owner may still overrule)
- Bonuses are **live** (tiers switch off when a move breaks them), not latched.
- Editing happens at picks and from the pause menu; never mid-wave without pausing.
- Fusion tiers come from link counts (1 / 3 / 5), the stack gate is gone.
- `cellSize` 24 unless the phase 1 check fails.
- Nexus is optional and last.

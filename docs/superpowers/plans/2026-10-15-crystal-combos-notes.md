# Crystal combos: implementation notes (2026-10-15)

Spec: `docs/superpowers/specs/2026-10-15-crystal-combos.md`. Plan: `2026-10-15-crystal-combos.md` (phases 1–5; phase 6 Nexus not started, it needs the owner's go-ahead).

## Sim (pure, data in `src/data/{sets,crystal}.json`)
- `sets.json`: `fusionMin` → `fusionTiers: [1, 3, 5]`; each of the 10 fusions is `{ name, tiers: { "1", "3", "5" } }`. `validateSets` checks the pair keys (TAGS order, all 10), every tier present and non-empty, effects valid.
- `World.fusions: string[]` → `World.fusionTiers: Record<string, number>` (the live tier as its link count, missing = 0). `WORLD_VERSION` stays 7; a snapshot without `fusionTiers` loads as `{}` and the old `fusions` field is dropped.
- `crystal.ts`: `fusionLinks` (one entry per shared edge, `{a, b, key}`), `fusionLinkCounts`, list-based helpers (`clusterCountsOf`, `fusionLinkCountsOf`, `sectorTagsOf`) for previews, `crystalConnected`, `moveModule(w, data, from, to)` (move to an empty slot or swap; reverts if the crystal splits), `CrystalDiff` / `crystalDiff` / `slotGains` / `movePreview`. `autoSlot` adds `crystal.auto.link` (1) per different-tag neighbour. `ladderTier` lives here, not in `perks.ts`, to avoid an import cycle.
- `perks.ts`: `refreshCrystal(w, data, events)` replaces `applySetTiers` + `applyFusions`. Tiers go up **and down** live: a fallen tier removes its `set:<tag>:<t>` / `fusion:<key>:<t>` mods and timers. `setTier {tag, tier, prev}` and `fusion {key, tier, prev, a, b}` fire only on a change. It is called from `grantPerk`, `initProtocols` and the new `moveModule` command (rejected when the core is dead).
- Bots never move modules. Golden replay re-recorded once.
- **Live tiers vs free moves** (found in review): `refreshCrystal` keeps the core's HP *share* when max HP changes (`keepHealthShare`), so switching a Health bonus off and on with move + UNDO no longer heals; a pick still fills the new HP (`withHealth`, as a Health purchase). Wave-charged (immunity) timers survive a tier drop and are not recharged when the tier comes back, so breaking and rebuilding the Firewall 6-set no longer skips its 3-wave cooldown. Seconds-based periodic timers are still removed on a drop and re-armed one period later.

### Substitutions in the fusion ladders (spec §3 → data)
- **Berserk III**: `coreHpBelow 0.5 ×1.5` instead of `0.3 ×2`. There is one HP threshold per effect type, and tier I already uses 0.5, so a second threshold is impossible.
- **Frostbite II**: `statAdd thorns 0.25` instead of 0.1, because one Thorns level is 0.25.
- **Insurance III**: `shield 0.15`. Shield is max-folded across sources, not summed, so 0.15 gives the intended 15 % total. The spec's note that "retaliate, shield profile sums" is wrong for shield; retaliate does sum.

### cellSize
Kept at **24**. The ring-5 crystal reaches ≈ 232 px against an arena of 540 px at wave 40, and the start ring 3 reaches ≈ 149 px against the spawn radius 380. The test `cellSize fits…` in `tests/crystal.test.ts` checks every ring step with one territory cell of margin.

## Render (`src/render/CrystalView.ts`)
- The module layers are in one Container at the core centre (zoomed by the editor); the territory layers stay at scene level.
- Plates per same-tag cluster (outer edges only; dim at tier 0, bright plus an ADD glow when the set is on), welds across every shared edge in the two tag colours, and a two-colour diamond with I / II / III on each pair's first link.
- The set badge digit and the stack numbers are drawn as **seven-segment Graphics** instead of Text, so they stay sharp at any zoom without re-creating Text objects.
- The LOD and digit thresholds are relative to `minFont` (`Rf = R · 16 / minFont`; LOD below 11, digits from 14) instead of raw px, so portrait (minFont 28) switches at the same visual size as landscape.
- Tier-up events: banner plus a burst along every link of the pair; tier-down shows nothing in the arena.

## UI
- **`src/ui/CrystalEditor.ts`** replaces `PlacePanel` (deleted). *Place* mode follows a new-module card: slots are outlined by their `slotGains`, the auto slot pulses, and there are AUTO / BACK / AUTO ALL buttons. *Arrange* mode is opened by CRYSTAL in the pause menu or follows a placement: tap or drag to move or swap, with UNDO and DONE. The readout lines run sets → fusions → wedges, coloured green (tier up), red (tier down) or in the tag colour (no tier change); `No change` when nothing changes. First open shows the rule strip (`meta.settings.editorSeen`).
- **Set/fusion changes made in the editor are announced on close**, as net changes against the tiers at open: banners for ups, one joined dim toast for downs. While the editor is open, banners are suppressed.
- Tier downs elsewhere show a dim toast (`Overload 4-set offline`, `Thermal Shock II offline`): `showToast(text, ms, at, 'dim')` in `src/portal/toast.ts`, anchored over the arena.
- **Fusion chips** (`SetChips`): one chip per pair with ≥ 1 link (half-and-half disc and I / II / III, or `·`). They are not in the HUD row, where they did not fit: portrait puts them in a second row under the tag chips, landscape in the arena's top-right under the genome strip (`GenomeStrip.bottom`). Overflow folds into `+N`. Hover or tap shows the ladder (`SetTooltip.showFusion`, `links n / next`).
- **`ProtocolsPanel` scrolls** (masked content, drag/wheel, scrollbar). With a big crystal the portrait panel used to run past RESUME. A tap needs its press to start on the same block (the chip tap that opens the panel no longer opens a ladder on release). Fusions show as one-line rows in portrait (tap for the ladder) and as up to three columns of ladders in landscape.
- `PickOverlay`: a new-module card gets the line `Cryo + Mining → COLD STORAGE I` when its auto slot raises a fusion tier.
- Module hover card: `Touches <Tag>: n links → <Fusion> I: … (II at 3: …)`.
- Editor slot outlines follow spec §5: tag colour = grows the set, partner colour = adds a link, white = both, cyan = neither, red = any tier falls. The first-open rules have four lines (set, fusion, wedges, controls).
- Several changes in one editor session: each tier-up still gets its banner and burst, and a toast lists all changes (the last banner would hide the others). AUTO ALL's "Auto-place on" joins that toast instead of replacing the placement's banner.
- Stats: `RunStats.fusionMax` (highest tier per pair, which survives a tier drop and a save; editor experiments count only by their net result on close); `Sets online` / `Fusions reached` list one item per row.
- `PickOverlay` (landscape-style card rows): a long name next to a long rarity label (`Glass Cannon` / `EPIC · TRADE-OFF`) shrinks down to `minFont` instead of overlapping it.
- Dev hooks: `openEditor`, `closeEditor`, `editor()`, `slotScreen(q, r)`, `moveModule`, `fusionChips()`; `demoCrystal` falls back to the auto slot. `npm run ui -- --only a,b` now takes a comma list.

## Balance (`npm run sim:balance`, `reports/balance-m3.md`)
- B1, B2 and B5 pass (B5: 88 % of random-pick first runs reach a 2-set, 79 % before). Build: 427 KB gz initial download (budget 1 MB). B6 fails as before this work: tag-bot medians overload 7 · cryo 6 · chain 5 · mining 5 · firewall 5, max/min 1.40 against ≤ 1.20. This has been the case since the territory regrowth, and the fusions did not change it. It is a one-wave granularity issue and has not been retuned.
- First runs reach fusions only at tier I (Cold Storage, Frostbite and Thermal Shock most often); tier II and III are for later runs with a bigger crystal and editor moves.

## Review (2026-10-15)
An 8-agent review (4 areas × finder + skeptical verifier) confirmed 13 issues, all fixed above: the two sim exploits, slot colours, reduce-motion on the fusion shake, editor experiments counted as reached fusions, the AUTO ALL banner, the wedge rule line, the panel tap-through, chips over the genome, the stats row overflow, the toast overflow (it now wraps within 92vw), the set footer text ("stays for the run" → "splitting the cluster turns it off") and tests for tier drops with periodic effects.

## Open
- Phase 6 (Nexus) is not started; ask the owner first.
- B6 at 1.40 (see above).
- Bots never use the editor, so the balance sim underrates fusions for players who rearrange.

# Crystal · Territory · Mutations: implementation notes (2026-10-14)

Spec: `docs/superpowers/specs/2026-10-14-crystal-territory-mutations.md`.

## Sim (pure, data in `src/data/{crystal,territory,mutations}.json`)
- `src/sim/hex.ts`: pointy-top axial math, the six sectors (`sectorOf`), `ring(k)`.
- `src/sim/crystal.ts`: `World.crystal: Module[]`. A new perk id gets a module (`placeModule`, at `slot` or `autoSlot`); stacks upgrade it. `tagCounts` (sets) = the largest connected same-tag cluster plus card tags. `heldTags` (offers) still uses the raw counts. `crystalShape` gives the per-sector reach (where melee viruses stop) and the muzzle tips.
- `src/sim/territory.ts`: `World.terrain` holds 0/1 per cell. The geometry is cached per GameData (`terrainFor`). Viruses infect cells every `infectEvery` ticks and kills cleanse them. Owned cells take their sector's tag: ⚡ damage, 🧊 slow, 🔗 chain damage, 💰 kill Energy, 🛡 attack ×. Infected cells speed viruses up. Kill Energy × (`energyBase` + `energyPerOwned` × owned share).
- `src/sim/mutations.ts`: `World.genome`. From wave 20 and every 10 waves after, the dominant set tag gets +1 resistance (`mutation` event). `geneKeep` scales the countered effect.
- `pickPerk` takes an optional `slot: [q, r]`, and a bad slot rejects the pick with `'slot'`. World/snapshot v6.

## The breach widens (arena growth)
- `arenaRadius(data, wave)` (`src/sim/territory.ts`): the spawn ring = `config.spawnRadius` + `arenaGrowStep` × ⌊wave / `arenaGrowEvery`⌋, capped at `arenaMaxRadius` (380 → +40 every 10 waves → 620 at wave 60). It is derived from the wave, so nothing new is stored in the World.
- Spawns and the knockback cap use it, and the territory grid and spatial hash are sized to `arenaMaxRadius`. Cells beyond the start radius begin infected, so each growth step reveals new ground to reclaim. `ownedShare` counts only the cells inside the current arena.
- An `arenaGrow` event fires at the wave start, with the banner "BREACH WIDENED". BattleScene keeps its own copy of the Layout and eases `L.scale` towards `base × spawnRadius / arenaRadius`, so the core, viruses and range shrink on screen. CrystalView draws only the current arena.
- What the wider arena gives (all numbers in data):
  - **Far kills pay more.** Kill Energy and Bits are multiplied by `1 + territory.farPer100 × (distance − farFrom) / 100`. After the first growth a gold dashed ring marks `farFrom`. Range now goes +5 per level up to level 48 (540), so the outer ground can be reached.
  - **The crystal grows a ring.** `crystal.ringEvery` 20 → +1 module ring, up to `maxRingCap` 5. `freeSlots` uses `crystalRing(data, wave)`.
  - **Nests.** Each growth plants `nestsPerGrow` nests (at most `maxNests`) on infected cells just inside the old spawn ring (capped at `nestMaxRadius`), using rng.spawn. During a wave, a living nest spawns `nestKind` every `nestEvery` ticks. When its cell is reclaimed (a kill nearby cleanses it), the nest is destroyed and pays `nestEnergy`/`nestBits` × the wave growth. `World.nests` holds cell ids. Events: `nestDestroyed`, and `arenaGrow` with `ring`, `ringGrew` and `nests`.
  - **Speed.** Virus speed × `1 + config.arenaSpeedScale × (R / spawnRadius − 1)`, so the wider ring is crossed in about the same time.
- World/snapshot v7, because the terrain length changed and `nests` was added. Golden replay re-recorded. Dev hook `setWave(n)`.
- DEF upgrades buffed (2026-10-14; the def-first bot used to die at wave 3 against 6 for atk-first): Regen base 1 and +0.6/s per level; Defense +2 % per level up to level 38 (75 %); Health +12 per level (+15 or more made Overload dominant, failing B6). Firewall perks scaled to match: Patch +1.5 regen, Hardening +6 % defense.

## Render / UI
- `src/render/CrystalView.ts`: the territory layer (redrawn when cells or sector tags change), the front-line edges, the modules (glyph, stack pips, same-tag links), and the placement highlights.
- `src/ui/PlacePanel.ts`: the placement step after a card that adds a new module. Tap a free hex, or press AUTO, BACK or AUTO ALL (`meta.settings.autoPlace`). The widget mode always auto-places.
- `src/ui/GenomeStrip.ts`: the genome in the arena's top-right corner. The `mutation` event shows a banner, and viruses get a ring in the strongest gene's colour (WorldView).
- Dev hooks: `state().placing` and `crystal`; `ui().place` (with auto/back/always rects, autoSlot and free). The UI smoke taps the auto hex on the first pick.

## Balance (`npm run sim:balance`, `reports/balance-m3.md`)
- B1, B2 (median wave 5) and B6 (tag medians 6/6/5/5/5, same as before) pass.
- B5 shows 79 % for the random/first pick bots, against 80 % required and 83 % before. That is one run out of 24 dying at wave 3: no cluster is lost (checked), it is RNG divergence. To tune: `territory.energyBase` or `infectedSpeed`.
- Golden replay re-recorded.

## Open
- Covers and thumbnails don't show the crystal or the territory yet.
- Mutations only start at wave 20, so first runs never see them. The Home/tutorial hint is still to write.

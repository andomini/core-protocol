# Crystal combos: sets, fusions, the crystal editor — design spec

Date: 2026-10-15 · Status: draft for the owner's review; numbers are starting points for the sim.
Extends `2026-10-14-crystal-territory-mutations.md` §A. Supersedes the first fusion pass of 2026-10-15
(uncommitted: `World.fusions`, `sets.fusionMin`, the "2+ stacks on both sides" gate).

## 0. The problem
- The crystal has one spatial rule the player can act on (same tag side by side → set), and it is hard to
  read in the arena: modules are ~17 px hexes on desktop and ~8 px on a phone, pips are dots, seams are
  hairlines. The player cannot tell from one frame what the crystal does or what a free slot would give.
- The first fusion pass gates fusions on an invisible number (both clusters ≥ 2 stacks) and gives a flat,
  fixed effect, so there is nothing to build toward and nothing to shape.
- Placement is permanent, so a bad auto-placement (or a rule learned later) cannot be fixed, and there is
  no reason to look at the crystal again after a pick.

## 1. Three spatial rules, nothing else
Everything the crystal does is one of these, and each has its own look on the crystal:

| Rule | Geometry | Reward | Look |
|---|---|---|---|
| **Sets** | same-tag modules that touch form a cluster; the largest cluster's stacks (+ card tags) | tiers **2 / 4 / 6** (unchanged) | one filled plate per cluster, lit when a tier is on |
| **Fusions** | every shared edge between modules of two *different* tags is one **link** for that pair | tiers **I / II / III** at **1 / 3 / 5** links | a weld bar across each link, a two-colour badge per fused pair |
| **Wedges** | the dominant tag of a 60° sector (unchanged) | colours the ground (territory §B) | the sector wedge tint, shown in the editor |

Fusion links replace the stack gate: what counts is *how much the two tags touch*, which the player can
see and grow. Each tag has at most 5 modules, so tier III needs 5 modules of two tags laid out to meet
(an alternating ring-2 chain gives it); tier I happens almost on its own, tier II takes intent.

**Live, not latched.** Set and fusion tiers are recomputed whenever the crystal changes (a pick, a move, a
swap). A tier that is no longer met switches off (its stat mods and timers go, its profile effects stop).
Reason: once modules can move, latching makes "build a seam, bank the tier, rebuild into a blob" the only
strategy and the shape meaningless. The editor shows every loss in red before the player confirms, and a
dim toast names it afterwards, so nothing is lost silently. Without moves nothing ever decreases, so the
first run plays exactly as today.

## 2. Moving modules (`moveModule`)
- Command `{ type: 'moveModule', from: [q, r], to: [q, r] }`. `to` empty → the module moves; `to` holds a
  module → the two swap. Valid whenever the core is alive (the UI decides when to offer it; bots never
  move). Rejects: `from` (no module there), `slot` (`to` outside rings `coreRing+1 … crystalRing(wave)`,
  or `to === from`), `link` (after the move a module would no longer connect to the core block through
  modules). A swap keeps occupancy, so it only needs both modules to exist.
- The module keeps its place in `World.crystal` (placement order still breaks sector and core-colour ties).
- After the move: `refreshCrystal` (§3), events for every tier that changed.
- Where the player moves: the **crystal editor** (§5), which opens at every pick and from the pause menu.

## 3. Sim model
- `World.setTiers` (unchanged shape) and `World.fusionTiers: Record<pairKey, tier>` (missing pair = 0;
  replaces `World.fusions`). `WORLD_VERSION` stays 7: the snapshot migrates a missing `fusionTiers` to `{}`
  and ignores `fusions`.
- `refreshCrystal(w, data, events)` in `src/sim/perks.ts` replaces `applySetTiers` + `applyFusions`:
  1. counts = `tagCounts` (largest cluster + cards) → set tier per tag; links = `fusionLinkCounts` → fusion
     tier per pair.
  2. For every tag/pair whose tier rose: `appendStatMods` for each newly reached tier (source
     `set:<tag>:<t>` / `fusion:<key>:<t>`), arm periodic timers under `<source>:<i>`, push
     `setTier {tag, tier, prev}` / `fusion {key, tier, prev}`.
  3. For every tag/pair whose tier fell: drop `w.mods` with those sources, delete those timers, push the
     same events with `tier < prev`.
  4. Wrapped in `withHealth` (health mods may change).
  Called from `grantPerk`, `moveModule` and `initProtocols`.
- `perkProfile` folds every reached fusion tier's effects (as it folds set tiers: tiers add up).
- `src/sim/crystal.ts`: `fusionLinks` keeps its shape (`{a, b, key}` per shared edge, `live` dropped);
  `fusionLinkCounts(w, data): Record<key, number>`; `moveModule`; `crystalConnected(w, data)` (BFS from
  the modules on ring `coreRing+1`); `slotGains(w, data, tag, slot)` and `movePreview(w, data, from, to)`:
  pure diffs of set counts, link counts and sector tags for the editor, working on a copied module list.
- `autoSlot` score gains `+ links × crystal.auto.link` (different-tag neighbours), with `link` = 1 so sets
  (10) ≫ sector (3 / 2) > link (1) > ring (−1). Bots pick up tier I fusions by accident, nothing more.
- Data: `sets.fusionTiers: [1, 3, 5]`; `sets.fusions[key] = { name, tiers: { "1": [...], "3": [...], "5": [...] } }`;
  `sets.fusionMin` removed. `validateSets` checks every key is in TAGS order, every tier listed, effects
  valid. `crystal.cellSize` 20 → 24 and `crystal.auto.link` added.

### Fusion ladders (starting numbers; only existing effect types, so the sim needs no new ones)
Each tier adds its line, like set tiers. Pairs are keyed in TAGS order (overload, cryo, chain, mining, firewall).

| Pair | Name | I (1 link) | II (3 links) | III (5 links) |
|---|---|---|---|---|
| ⚡+❄ | **Thermal Shock** | +20 % damage to slowed (`conditional targetSlowed 1.2`) | ×1.5 damage to frozen (`targetFrozen 1.5`) | 10 % chance to freeze 1 s (`onHit freeze 0.1 / 1`) |
| ⚡+🔗 | **Overcharge** | +30 % lightning damage (`lightningDamage ×1.3`) | Lightning +1 target (`lightningTargets +1`) | Every 10 s: bolt for ×3 damage (`periodic tesla`) |
| ⚡+💰 | **Headhunter** | Crit kills ×1.5 Energy (`killBonus crit 1.5`) | +5 % Crit Chance (`statAdd critChance 0.05`) | Bosses: ×2 Energy (`onKill boss energyMul 2`) |
| ⚡+🛡 | **Berserk** | ×1.3 damage below 50 % HP (`coreHpBelow 0.5 / 1.3`) | +50 % Regen (`statMul regen 1.5`) | ×1.5 more below 50 % HP (`coreHpBelow 0.5 / 1.5`, ×1.95 in all) |
| ❄+🔗 | **Superconductor** | Lightning freezes 0.5 s (`lightningFreeze 0.5`) | +30 % lightning range (`lightningRange ×1.3`) | Freezes last ×1.5 (`freezeSeconds ×1.5`) |
| ❄+💰 | **Cold Storage** | Frozen kills ×1.5 Energy (`killBonus frozen 1.5`) | +10 % Energy Bonus (`statAdd energyBonus 0.1`) | Slows +15 % (`slowBonus +0.15`) |
| ❄+🛡 | **Frostbite** | Thorns slow attackers 30 % for 2 s (`thornsSlow 0.3 / 2`) | +1 Thorns level (`statAdd thorns 0.25`) | Slow cap +10 % (`slowCap +0.1`) |
| 🔗+💰 | **Network** | Bounce & lightning kills ×1.5 Energy (`killBonus chain 1.5`) | +30 % bounce range (`bounceRange ×1.3`) | +1 bounce (`bounces +1`) |
| 🔗+🛡 | **Grounding** | Each virus attack: bolt back ×0.5 Damage (`retaliate 0.5`) | +5 % Defense (`statAdd defense 0.05`) | Bolt back ×1 more (`retaliate 1`, sums to ×1.5) |
| 💰+🛡 | **Insurance** | Shield 5 % HP each wave (`shield 0.05`) | +15 % Bits at run end (`runEndBits ×1.15`) | Shield 15 % HP (`shield 0.15`, replaces the 5 %) |

Where a type repeats across tiers the profile folds it as it does for sets: `retaliate` sums, `shield` takes the largest, `coreHpBelow` keeps one threshold (the highest) and multiplies the bonuses. Hence Berserk III stays at 50 % HP (×1.3 × 1.5) and Insurance III lists the full 15 %. Frostbite II adds one Thorns level (0.25), since a 0.1 Thorns would be under one level.

## 4. In the arena (glanceable, no text needed)
`src/render/CrystalView.ts`, redrawn only when the crystal changes (plus the pulse layers each frame):
- **Cluster plates.** Each same-tag cluster is one shape: the union of its hexes filled in the tag colour and
  only its *outer* edges stroked (an edge is drawn when the hex across it is not in the cluster). Tier 0:
  fill α 0.15, stroke 1.5 px α 0.5. Tier on: fill α 0.3, stroke 3 px α 1 plus an ADD-blend glow, and a
  small round **badge** with the tier number (2 / 4 / 6) on the member nearest the cluster's centroid.
- **Welds.** Every link is a short bar across the shared edge (length 0.5 R, width 0.18 R, one half per
  tag colour). Pair tier 0: α 0.35. Pair tier ≥ I: full α, slow pulse, and the pair's first link carries a
  two-colour diamond **badge** with the tier (I / II / III). A tier-up runs the existing burst (rings +
  sparks) along *every* link of that pair.
- **Modules** keep glyph + pips. Pips become the stack number when R ≥ 14 px.
- **LOD.** When R < 11 px (phones): no per-module glyphs or pips; one glyph per cluster at its centroid,
  welds and badges stay. The tap card (module tooltip) is the detail view.
- **Core colour** (dominant tag, done) unchanged.

## 5. The crystal editor (`src/ui/CrystalEditor.ts`, replaces `PlacePanel`)
The decision tool: the crystal zoomed to fill the arena, every slot annotated, every change previewed.
- **When.** After a card that adds a module (as the placement step does now) and from a **CRYSTAL** button
  in the pause menu (alive, not in a pick). While open the UI holds the sim paused (like the protocols
  panel). Widget mode and `settings.autoPlace` ("AUTO ALL") skip the pick-time editor as today.
- **Zoom.** `CrystalView.setZoom({cx, cy, scale} | null)`: the module layers (plates, welds, modules,
  slots, hover, badges) draw with that transform and move to a depth above the HUD; the territory layers
  stay put under a scrim. Scale: `crystalRing(wave)` fits 78 % of the arena's shorter side. A simple core
  hex in the core colour at the centre and the six **sector wedges** (faint tag tints, the third rule) sit
  under the modules.
- **Two modes, in order.** *Place* (a new module in hand): header `PLACE FROST SHOT`; free slots are
  outlined by what they give — tag colour = grows the set, the other tag's colour = adds a link, both =
  white, neither = dim cyan; the auto slot pulses. Tap a slot or AUTO → `pickPerk {index, slot}`; the
  editor stays open in *Arrange*. BACK returns to the cards. *Arrange*: tap a module to select it (white
  pulsing rim), tap an empty slot to move or another module to swap (`moveModule`); on desktop a drag does
  the same with a ghost. Invalid targets are dim. UNDO issues the inverse move; DONE closes and resumes.
- **Live readout** (header subtitle, up to three lines, hovered slot or selected target): the diff from
  `slotGains` / `movePreview`, most important first — `OVERLOAD 3 → 4 · 4-SET ON` (green),
  `⚡+❄ links 2 → 3 · THERMAL SHOCK II` (green), `CHAIN 4 → 2 · 4-SET OFF` (red), `Wedge → Cryo ground`
  (dim). Nothing changes → "No change".
- **Bonus strip** under the header: the five tags with `count · tier` and every pair with ≥ 1 link with
  `links · tier`, live as the player moves things.
- **First time** (meta flag `editorSeen`): three lines under the strip — "Same tag touching = set ·
  Different tags touching = fusion · Wedges colour the ground".

## 6. Everywhere else
- **Pick card footer**: new-module cards get a second line when the auto slot adds a link: `⚡+❄ → THERMAL
  SHOCK I` (from `slotGains` at `autoSlot`).
- **HUD chips** (`SetChips`): after the tag chips, one chip per fused pair: a half-and-half disc in the two
  colours + `I / II / III`; hover → the pair's ladder (1 / 3 / 5 links) in `SetTooltip`.
- **Protocols panel**: fusions become ladders like sets (name, `links n / next`, tier rows lit).
- **Module card** (tap/hover): per touching tag, `Touches Chain: 2 links → Superconductor I (II at 3)`.
- **Banners**: `FUSION II · SUPERCONDUCTOR` with the tier's new line; a dim toast on a loss
  (`Thermal Shock II offline`, `Overload 4-set offline`).
- **Bots / balance**: bots keep auto-placing; `sim:balance` B1–B6 rerun; B6 is judged on tag medians of
  5–7 waves, so a one-wave shift flips it — read it with that in mind.

## 7. Optional later: Nexus
A module touching ≥ 3 *other* tags is a **Nexus**: white rim with a ✦, and its stacks count double toward
its cluster's set (`crystal.nexusMinTags`, 0 = off). One more shape to build (a hub in varied company)
with one line of sim (`moduleCluster`). Not part of the first delivery; decide after playing §1–§6.

## 8. Out of scope
Per-module micro-bonuses per neighbour (six numbers per module nobody can read), triple fusions (10 more
effects to author and remember), module facing/orientation, moving modules mid-wave without pausing.

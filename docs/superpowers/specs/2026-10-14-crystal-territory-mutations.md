# Crystal · Territory · Mutations — design spec

Date: 2026-10-14 · Status: approved by the owner in conversation ("do all three, don't ask"); numbers are starting points for the sim.
Extends `2026-10-05-core-protocol-design.md` (§2.4 protocols and sets). Goal: a hook that is **visible in one frame**, so a screenshot or cover does not read as "another The Tower clone".

## 0. One loop, three layers
**The crystal grows → the crystal colours the territory → the viruses mutate against the crystal.**

| Layer | What the player sees | What it changes |
|---|---|---|
| A. Crystal | the core grows into a unique hex crystal from protocol modules | sets count connected same-tag modules, not loose stacks |
| B. Territory | the arena is a hex map, blue (ours, tinted by sector) vs red (infected), with a moving front | cells buff or debuff the viruses standing on them; owned share scales ⚡ income |
| C. Mutations | viruses grow gene markers; a 🧬 genome strip in the HUD | from wave 20 the virus learns resistance to the build's dominant tag |

## A. Crystal (`src/sim/crystal.ts`, `data/crystal.json`)
- Axial hex grid (pointy-top), cell size `crystal.cellSize` world px. The core occupies the center hex and ring 1 (the core sprite sits there); modules go into rings 2…`maxRing`.
- **A new perk id = a new module** in a free hex adjacent to the core block or to an existing module. **Another stack of a held perk upgrades its module** (no new hex; the module shows stack pips). 25 perks always fit (rings 2–3 hold 30).
- `pickPerk` takes an optional `slot: [q, r]`. Without one, or for a stack, placement is automatic. An invalid slot rejects the command (`slot`). Old command logs (no slot) stay valid.
- **Auto-placement** (deterministic): score = `sameTagNeighbours × 10 + (sector tag == tag) × 3 + (sector empty) × 2 − ring`; ties go to the first slot in canonical order (ring, then the index around the ring).
- **Set count** for a tag = the largest connected cluster of that tag (sum of its modules' stacks) + the card tags. Auto-placement clusters greedily, so a bot gets about the same counts as before; a player can do worse (split clusters) or better (sectors, see B).
- Offer weighting toward held tags is unchanged (any module of the tag counts as held).
- **Body:** a virus stops at `max(core.radius, crystal reach in its sector) + its radius`, so viruses crash into the crystal's tips. Shots leave from the outermost module of the target's sector (or the core).
- Six **sectors** (60° wedges around the six hex directions). Sector tag = the tag with the most stacks among the modules in that wedge (ties → the module placed first); none = neutral.

## B. Territory (`src/sim/territory.ts`, `data/territory.json`)
- Arena hex cells of size `territory.cellSize`, every cell whose center is inside `spawnRadius + cellSize`. `World.terrain[i]` = 1 ours, 0 infected. Geometry is derived from data (cached), not stored.
- Start: cells within `startRadius` are ours.
- **Infection:** every `infectEvery` ticks, every living, non-frozen virus infects the cell under it (a boss also infects the ring around it). **Cleansing:** a kill cleanses its cell and its neighbours.
- An owned cell takes the tag of its **sector** (crystal layer A), so placement is a second puzzle: adjacency for sets and wedges for the map.

| Cell | Effect on viruses standing on it |
|---|---|
| ⚡ Overload | take ×`overloadDamage` damage |
| 🧊 Cryo | +`cryoSlow` slow (adds to slows, capped) |
| 🔗 Chain | bounce and lightning hits ×`chainDamage` |
| 💰 Mining | kill Energy ×`miningEnergy` |
| 🛡 Firewall | their attacks ×`firewallDamage` |
| infected | move ×`infectedSpeed` |

- **Income:** kill Energy × (`energyBase` + `energyPerOwned` × owned share). Holding the map pays, and Range gains a second use.

## C. Mutations (`src/sim/mutations.ts`, `data/mutations.json`)
- `World.genome: Record<Tag, level>`. At the start of wave `startWave`, then every `every` waves, the **dominant tag** (the highest set count, ties in TAGS order, none when 0) gains a level, up to `maxLevel`. Event `mutation {tag, level}`.
- Genes (each level ×(1 − `perLevel`), per gene in data):

| Gene | Against | Effect |
|---|---|---|
| Armor | ⚡ | crit bonus (critFactor − 1) shrinks |
| Antifreeze | 🧊 | slows and freeze durations shrink |
| Insulation | 🔗 | bounce and lightning damage shrinks |
| Encryption | 💰 | kill Energy shrinks |
| Piercing | 🛡 | Defense % and Thorns shrink |

- Counterplay: diversify later picks, so the next mutation hits another tag and the old genes stop growing. The genome strip shows what the virus has learned.

## Render / UI
- Territory: a hex layer under the core, with owned cells in their sector colour (faint), infected cells crimson, and a bright **front line** on the owned/infected edges. It is redrawn only when the cells or sectors change.
- Crystal: glowing tag-coloured hex modules with stack pips and bright links between adjacent same-tag modules (the cluster = the set). Placement: after you choose a card for a new perk, the free slots appear on the crystal, the auto slot pulses, a tap places the module, and an AUTO button (or a remembered "auto-place" toggle) skips the step.
- Mutations: gene rings around viruses in the colour of the top gene; a 🧬 strip in the HUD; a banner on each mutation.

## State / compatibility
- `WORLD_VERSION` / `SNAPSHOT_VERSION` 5 → 6 (a v5 mid-run save is dropped, as with every earlier bump). Golden replay re-recorded.
- Balance: `sim:balance` must still give B2 (a fresh player dies at waves 4–6); retune `data/*.json`, never the code.

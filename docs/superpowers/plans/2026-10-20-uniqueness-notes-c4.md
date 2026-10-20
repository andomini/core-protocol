# Uniqueness plan, phase 3 — C4 notes: structure upgrades and B6

Branch `worktree-agent-afea2828d7e74e957`, based on main `bd730fc`.

## Structure upgrades

- **Command** `{ type: 'upgradeStruct', kind }`. It goes through `RunSession.queue` like every other player action, so it is logged and replayable. On success it emits `structUpgrade { kind, level, cost }`. Otherwise it emits `structUpgradeRejected` with one of these reasons:
  - `dead`: the run is over.
  - `unknown`: not a structure kind.
  - `locked`: the kind has no ladder, or nothing of that kind is built.
  - `maxed`: the kind is at its top level.
  - `funds`: not enough Energy.
- **State**: `World.structLevels?: Partial<Record<StructureKind, number>>`. A missing key means level 0, and no World version bump was needed. Saved levels are read defensively (`structLevel`): a non-integer, negative or over-max value is clamped. So an old save without the key, or with a bad value, still loads.
- **Data**: `structures.json` `upgrades.<kind>` = `{ max, cost, costGrowth, perLevel, atMax? }`.
  - Every ladder starts at the same values: max 5, cost 30, growth 1.7, so 30 / 51 / 87 / 148 / 251 Energy, 567 in total per kind.
  - `perLevel` scales a field by `×(1 + frac·L)`, and only fields the built fusion tier defines. `atMax` adds whole units at the last level, capped by the field's `STRUCTURE_FIELDS` maximum.

  | kind | per level | at max |
  |---|---|---|
  | turret | +12 % damage | +1 target |
  | wall | +15 % HP, −8 % regrow time | — |
  | mine | +8 % blast radius | +1 mine per wave |
  | station | +10 % Energy, +10 % streak cap | — |

- **Validation** (`validateStructUpgrades` in `data.ts`) rejects:
  - an unknown kind
  - a max that is not an integer in 1–50
  - a cost ≤ 0, or a growth < 1
  - an unknown field, or `perLevel` on an integer field
  - a zero frac, or a frac that drives a field to ≤ 0 by max
  - an `atMax` add that is ≤ 0, or not a whole number on an integer field
- **Fold**: `applyStructLevels` (`src/sim/structLevels.ts`) runs at the end of `perkProfile` (after the cards) and in `fusionStructure`, so the sim and the renderer see the same values.
- **Stacking with BUILD stats**: the levels multiply the fusion's `StructureValues`. The BUILD tab stats (`structHealth`, `turretDamage`, `mineDamage`, `stationIncome`, and so on) still apply on top as before, so the two stack multiplicatively.
- **No Free Upgrade roll**: the `freeUpgrade` stat only covers stat buys (`buy`). A structure upgrade always costs Energy. This keeps the ladder short and predictable. Revisit if the upgrades feel too pricey.
- **UI**:
  - `src/ui/StructurePanel.ts` puts a STRUCTURES chip in the arena's bottom-left, just above the RESET ZOOM spot. It shows while any kind is built and the run is not dead, paused, picking, or under an open panel.
  - The panel shows the kind, with ‹ › to cycle through the built kinds, plus `LV n/max`, the next level's effect, and one UPGRADE · cost E button. The button dims when Energy is short; a rejected buy shakes the button red. × closes the panel.
  - Tapping or clicking a structure on the field opens the panel on that kind. On the ring this is whatever `structureAt` picks, so a turret standing on the wall can resolve to the wall.
  - The `U` key buys the cheapest next level.
  - VFX: `Vfx.upgrade` puts a dock flash and a ring on every standing structure of the kind (up to 8), with the `upgrade` sfx.
- **Bots**: in `weighted()`, a structure upgrade competes with stat buys by `cost / tabWeight`, through the `bot.json` `structUpgrades` kind → tab map. It is bought when it is the cheapest weighted option; otherwise the bot saves up for it. The greedy, tag and arrange bots all use this path.
- **Dev hooks**: `__cp.demoStructures(energy)` builds every kind at tier I and adds Energy. `__cp.structLevels()` returns the levels.
- **UI smoke**: the `upgrades` scenario runs on phone and desktop. It checks:
  - there is no chip before anything is built
  - the chip shows once structures are built
  - the chip opens the panel
  - BUY raises the level
  - U buys the cheapest level (desktop)
  - tapping a structure opens its kind (phone)
  - there are no console errors

  Screens: `structures-panel-{portrait,landscape}.jpg`.

## B6 (no dominant tag)

- **Harness**: `sim:balance` now defaults to 48 seeds and the arrange crystal player (`--crystal arrange`: best free hex for every pick, then a hill-climb). A full run takes about 75 s.
- **Tuning**, overload only:
  - `perks.json` overclockRounds damage ×1.12 → ×1.09
  - burstFire attack speed ×1.10 → ×1.07
  - critSpike crit chance +0.05 → +0.04
  - `sets.json` overload 2-set damage ×1.10 → ×1.06
  - The fusion tiers and the other tags are untouched.

| run | overload | cryo | chain | mining | firewall | max/min |
|---|---|---|---|---|---|---|
| before: main bd730fc report (24 seeds, auto placement) | 8 | 6 | 6 | 6 | 6 | 1.33 FAIL |
| main data, new harness (48 seeds, arrange) | 7 | 6 | 6 | 6 | 6 | 1.17 |
| after (48 seeds, arrange, nerf + upgrade bots) | 6 | 6 | 6 | 6 | 6 | **1.00 PASS** |

- **Probe** (`tag:overload`, 96 seeds, mean death wave):

  | variant | mean death wave |
  |---|---|
  | main data | 7.04 |
  | applied nerf | 6.50 |
  | a harsher variant (×1.08 / ×1.06 / +0.035 / 2-set ×1.04) | 5.96 |
  | overload neutered | 5.25 |

  The applied values are the smallest step that brings overload in line. The medians are integers and the death distributions are bimodal (waves 3–5 or 7–8), so 48 seeds is the smallest count that kept the medians stable.
- **Kept**:
  - B1 PASS.
  - B2 PASS: greedy median wave 6; no-upgrade median wave 3.
  - B5 PASS: 100 % of runs reach a 2-set, median at wave 1.
- **Golden replay**: re-recorded once (`npm run replay:record -- --update`), because the overload numbers change the replayed run's damage.

## Open

- A cost of 30 per first level is cheap next to the late BUILD stats, but the upgrade bots barely move the other tags' means (slightly down: the Energy is diverted from core stats). If the upgrades should matter more, raise `perLevel` before lowering `cost`.
- On the ring, a turret tap can resolve to the wall segment under it. That is `structureAt`'s pick order, not the panel's, and it was left as is.
- The B7–B9 structure reports stay report-only. They now include the upgrade levels the bots buy.

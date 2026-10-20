# Uniqueness plan, item 9: C2 notes (Territory Beacon)

Before this, the player could not act on the map. A **beacon** gives them one map action: the player buys one with
Energy, and the sim plants it at the infection front. It guards a disc of ground. If it survives `holdWaves` wave
ends, it pays Bits and claims that disc for the rest of the run.

## Data (`src/data/territory.json` → `beacon`, checked by `validateBeacon` in `src/sim/data.ts`)

| field | value | meaning |
|---|---|---|
| cost / costGrowth | 80 / 1.5 | Energy price × costGrowth^(beacons built this run) × energyGrowth^(wave−1), the same wave scaling as stat prices |
| max | 1 | standing at once (integer 1–6) |
| radius | 3 | guarded disc in hex rings around its cell |
| cleanseEvery | 45 | ticks per ring cleansed (ring 1…radius) |
| hp | 0.5 | max HP as a share of core max HP × structHealth (like walls) |
| holdWaves / holdReward | 3 / 40 | wave ends to survive, and the reward: `scaleForWave(40, tier.bitsMul, bitsGrowth, wave)` Bits |
| aggro / bodyRadius | 56 / 16 | a virus whose path passes within `aggro` of the body turns to attack it; contact radius |
| minDist / rangeShare | 110 / 0.9 | placement band: from minDist out to min(arena, 0.9 × Range), so the core's guns cover it |

## Sim (`src/sim/beacon.ts`, hooks tagged `// c2`)
- **Command** `{ type: 'beacon' }`. Rejects: `dead`, `phase` (pick), `max`, `funds`, `front` (no infected ground in
  the arena). Rejects arrive as `commandRejected` with a `BeaconReject` reason.
- **Placement is deterministic, with no tap:**
  1. Take the sector with the most infected cells inside the arena (ties go to the lower sector).
  2. In that sector's band, skipping guarded cells, take the infected cell nearest the core (the front).
  3. If there is none, take the farthest band cell (ties go to the lower id).
- **Struct reuse:** a beacon is a `Struct` with `kind: 'beacon'`, and Struct gets no new fields:

  | Struct field | Beacon meaning |
  |---|---|
  | `slot` | index among standing beacons |
  | `x`, `y` | its cell's centre |
  | `share` | HP share |
  | `cd` | ticks to the next cleanse |
  | `streak` | wave ends held |
  | `powered` | rings cleansed |

  `syncStructures`, regen, revive and the BattleScene structure taps all skip it. `structures.ts` was **not edited**.
- **Guarding:** the infection pass (`paint(..., data)`) skips `guarded()` cells. A cell is guarded if it is within
  `radius` of a standing beacon or is in `World.claimed`.
- **Targeting:** when no station is the goal, viruses take the nearest beacon within aggro as their goal, so they
  walk to it and attack it. Phages count beacons as prey. At 0 HP the beacon is removed and `beaconLost` fires, and
  the disc can be infected again.
- **Hold:** each wave end raises `streak` and `World.beaconWaves`.
  - Below `holdWaves`, `beaconHold` fires.
  - At `holdWaves`, it pays the Bits, owns and claims the disc (`World.claimed`, a sorted list of cell ids), raises
    `beaconClaims`, retires the beacon and fires `beaconClaimed`. The player can then build the next one, at the
    grown price.
- **World:** the new fields are all optional and stay absent until a beacon is built: `beacons`, `claimed`,
  `beaconClaims`, `beaconWaves`. `WORLD_VERSION`/`SNAPSHOT_VERSION` stay at 8. `validStruct` accepts `kind: 'beacon'`.
  A world without beacons serialises byte-identically. The golden replay passes unchanged (not re-recorded).
- **Step order:** `updateBeacons` runs after the death check and before the grid build, so cleanse and hold happen
  once per tick after the territory pass.

## Client
- **`src/render/BeaconView.ts`:**
  - on the ground: a breathing hex at the disc edge, the cleansed-front hex and a ripple
  - a mast with braces and a blinking light
  - hold pips, plus an HP bar once hurt
  - a faint outline over claimed cells (redrawn only when the set or the view changes)
  - an **edge arrow** when the beacon is outside the visible arena (zoom/pan, tall portrait field)
- **`src/ui/BeaconHud.ts`:** the **CLAIM** button sits left of PULSE, with the same size. ("BEACON" did not fit at
  the 28 px portrait minimum font.)
  - With no beacon standing, it shows the Energy cost (dimmed when unaffordable, in a pick, dead, or at max).
  - With one standing, it shows `held/need` plus arcs per wave and an HP arc.
  - Key **B**.
- **BattleScene:** `beacon()` is guarded like `pulse()`. It is wired to the hit flash and to the events:
  - placed: vfx `beaconDrop` and sfx `beacon`
  - cleanse: vfx `beaconRipple`
  - hold: a ground pulse
  - claimed: a banner "BEACON HELD +N BITS · N CELLS CLAIMED", sfx `beaconHold` and a ring
  - lost: a crimson pulse, a banner and `wallHit`
- **Audio:** `beacon` is a thunk, a ping and a radio chirp. `beaconHold` is a two-chord rise. Both pass the voice
  limits in the audio test.
- **Mission:** template `beacon` ("Hold beacons for {n} waves in one run", mode best, targets 3–10). It reads
  `MissionRun.beacons` (optional; `missionRun` fills it from `World.beaconWaves`). Appending the template changes
  which three missions some days draw.

## Bot (`tools/sim/bot.ts`, `bot.json` → `beacon: { fromWave: 7, perRun: 1 }`)
- The greedy, atk-first and def-first bots use it, and so does the arrange player, which reuses the greedy buy bot.
- From wave 7 ("after wave 6"), while no beacon stands and fewer than `perRun` were built, the bot **saves**: it
  stops buying stats. It plants the beacon once it can pay and an infection front exists.
- It has to save. A greedy bot otherwise never holds 80+ Energy, and after wave 1 the arena holds infected ground
  only mid-wave, and only a few cells (≤ 20).
- `sim:smoke` now prints `beacons {placed, held, claims}`.

## Gates (on main bd730fc + C2)
- **typecheck:** clean.
- **npm test:** 59 files, 708 tests (11 in `tests/beacon.test.ts`). The golden replay is unchanged.
- **`UI_PORT=5190 npm run ui`:** 352/352.
  - The first run failed 25 text-size checks: the cost text was below `L.minFont`. Fixed.
  - The BEACON caption overflowed the button in portrait, so it was renamed CLAIM.
- **build:local:** 482.8 KB gz initial download (budget 1 MB). Post-build checks pass.
- **sim:balance:**
  - B1 PASS.
  - B2 PASS: greedy median wave 6, none median 3.
  - B5 PASS: 100 % reach a 2-set, median at wave 1.
  - B6 **PASS 1.17** (main 1.33). Medians: overload 7, cryo 6, chain 6, mining 6, firewall 6.
  - **Caveat:** B6 improves only because the overload bot's median falls 8 → 7. Its runs are the only ones that often
    reach wave 7, where the bot stops buying to save for a beacon. This is a bot-policy side effect, not a tag
    balance fix. C4's B6 tuning should be judged against a beacon-free bot (`beacon.fromWave` set high) or with this
    effect in mind.
  - Other report rows moved by about one wave or a few %. Atk-first's median stays at 8.

## Skipped / open
- I did not add moving the beacon by tap; the spec marks it optional.
- I did not add a boot hint for the button, because C3 owns `Hints.ts`.
- **Early-game value is low.** After wave 1 the arena self-cleanses, so infected ground in the arena is only a few
  cells mid-wave. The guarded disc matters mostly for the Bits goal and against nests and new ground after a breach
  widens. A later pass could make the beacon slow or weaken viruses in its disc, or allow placement on the ring just
  outside the arena.

## Files outside C2's ownership (all edits small, tagged `// c2`)
- `src/sim`: `state.ts`, `snapshot.ts` (C3: optional fields, validStruct), `perkData.ts` (`StructureKind` gets
  `'beacon'`), `events.ts`, `commands.ts`, `step.ts`, `enemies.ts` (beacon goal and attack), `data.ts` (BeaconDef
  and validation)
- `src/render`: `vfx.ts`, `audio.ts`, `scenes/BattleScene.ts`
- `src/meta/missions.ts`, `src/data/missions.json`
- `tools/sim`: `bot.ts`, `bot.json`, `smoke.ts` (C4's harness)

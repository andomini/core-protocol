# Uniqueness plan, Phase 2 item 7: four new viruses (agent B2 notes)

Branch `worktree-agent-a8769f34659b24579`, based on main 139e3e0.

## Mechanics (sim)

All numbers are in `src/data/enemies.json`; each mechanic is keyed by its data fields, not by the kind name, and is
validated in `validateMechanics` (`src/sim/data.ts`): a group must be complete or absent.

| Kind | Fields | What it does | Where |
|---|---|---|---|
| leech | `steal` 2, `returnMul` 1.5 | Every landed core hit (not one blocked by 🛡 immunity; shield-absorbed hits do steal) takes `steal × tier.bitsMul × bitsGrowth^(wave−1)` Bits, floored so Bits never go below 0, and adds them to `e.carried`. Its kill pays `carried × returnMul` on top of its own reward, outside every Bits multiplier (`kill.returned`). | `src/sim/viruses.ts` `stealBits` / `carriedReturn`, called from `enemies.ts` and `projectiles.ts hitEnemy` |
| spore | `splitCount` 3, `splitShare` 0.35, `splitRadius` 0.62, `splitGens` 1 | On death (gen < splitGens) it spawns `splitCount` copies of the same kind at `radius×0.7` from its centre, on fixed `data.directions` picked by id (no RNG draw). Each copy has 35 % of max HP, damage, Energy and Bits, 62 % of the radius, `gen` + 1, and no Mark. Copies never split again. | `viruses.ts splitSpore`, called after the kill in `hitEnemy` |
| carrier | `auraRadius` 90, `auraReduce` 0.4 | While alive, every other virus within 90 px takes 40 % less damage from every source (shots, bounces, lightning, mines, tesla, pulse). Auras do not stack, and carriers do not shield themselves or each other. The boss is shielded too. | `viruses.ts auraMul` at the top of `hitEnemy` (living carriers cached per tick) |
| phage | `structureMul` 3, `latch` 2, `standoff` 200 | While any wall segment or mining station stands, it walks to the nearest one (re-picked every tick, no aggro limit), latches on (`radius + structure radius + latch`), and hits it in melee for ×3 damage (Thorns apply). With no structure it is a slow ranged virus with a 200 standoff. | `enemies.ts phagePrey` + `attackStruct(…, mul, ranged)` |

Turrets and mines have no HP in the sim, so "structure" means the hittable ones: Ice Wall segments and mining stations.

Mutations (`spawnEnemy` → mutation scaling) and the perk profile (`rules.enemyHp`) apply to the new kinds the same way
they apply to the old ones. The boss is unchanged.

**World version:** unchanged (8). `Enemy` only gained the optional fields `carried?` and `gen?`. A missing field reads
as 0, old saves and snapshots restore unchanged, and the snapshot already serialises whatever is on the enemy, so no
migration is needed.

New SimEvents: `steal {enemyId, bits, carried}`, `split {enemyId, kind, x, y, ids}`, and an optional `kill.returned`.

## Numbers

| Kind | hp | dmg | speed | radius | interval | standoff | energy | bits | firstWave | weight | knockback |
|---|---|---|---|---|---|---|---|---|---|---|---|
| leech | 21 | 3.3 | 55 | 12 | 1 | 0 | 2 | 2 | 4 | 2 | 1 |
| spore | 22 | 6.6 | 38 | 16 | 1.2 | 0 | 3 | 2 | 8 | 2 | 0.8 |
| carrier | 50 | 8.8 | 22 | 20 | 1.5 | 0 | 6 | 4 | 12 | 1 | 0.3 |
| phage | 16 | 7.7 | 30 | 14 | 1.8 | 200 | 4 | 3 | 16 | 2 | 0.9 |

**Spawn mix.** Old kinds are unchanged (basic 10, fast 5, tank 2, ranged 3). Basic's share of the weighted pick:

| Waves | Basic share |
|---|---|
| 1 | 100 % |
| 4 | 53 % |
| 5–7 | 45 % |
| 8–11 | 42 % |
| 12–15 | 40 % |
| 16+ | 37 % |

From wave 5 on, basic is the largest single kind but not an absolute majority. Each new kind stays at ≤ 2/27 of the
pick.

New kinds are appended to `ENEMY_KINDS`, so the weighted pick draws exactly as before until wave 4, when the leech joins.

## Bodies (render)

| Kind | Body | Animation and colour |
|---|---|---|
| leech | A tick: oval abdomen with a scute, small head and proboscis toward the core | 2 frames, the proboscis pumps; 4 legs a side; tick blue `0x4a8cff` |
| spore | A lumpy pale puffball with stubby nubs, deep-pink spore specks and a burst seam | Breathes on both axes out of phase; whitish pink `0xffc4ec` (lighter than the magenta basic, so the two round bodies differ) |
| carrier | Octagonal armoured carapace: plates, spokes, rivets, small shielded core | The slowest turn of all; pale steel `0xb9c2ff` |
| phage | The bacteriophage body that used to be the ranged virus (head, sheath, six legs) | Orchid `0xd64bff` |
| ranged | **New look:** a fluted spitting cone, mouth toward the core, venom bulb at the back | 2 frames: the nozzle squeezes and spits a droplet; acid green `0x3dff52` |

**Ranged and phage.** The phage is the leggy bacteriophage, so the ranged virus needed a new body. It keeps its
mechanics and gets a funnel/cone that reads as "spits". The ranged beam colour (`fx.beam`, `ENEMY_COLOR.ranged`) is now
acid green. A phage with no structure uses the same beam.

All virus hues stay more than 15° from the tag hues (palette test).

**WorldView**
- Carrier aura: a faint disc plus a turning dashed ring at `auraRadius`, drawn in the `bars` Graphics.
- Leech glint: a pulsing Bits-cyan spark on its back while `carried > 0`, brighter with more Bits (`glintLevel`).
- Spore copies are drawn at `radius / base radius` of the texture.

**Effects**
- `split`: a pale puff cloud, a wide ring and short beams to each copy.
- `steal`: a cyan beam from the core rim to the leech, plus a ring.
- A kill with `returned` gets a cyan pulse and the `coin` sfx.
- Death bursts scale with the copy's size.
- Sfx reused: `zap` (steal), `coin` (return), `kill`. `audio.ts` and `vfx.ts` were not touched.

## Balance (`npm run sim:balance`, 24 seeds; before = 139e3e0, after = this branch)

Tuning: only the leech's hp moved, 14 → 21. With 14 the leech (half a basic's damage, from wave 4) made first runs easier
(greedy median 7, B2 FAIL). With 24 the chain bot fell to 5 (B6 FAIL). The 24-seed medians are integers right at the 6/7
edge, so every candidate was also checked with 72 seeds. The 72-seed "before" is this branch with the four new kinds'
weights set to 0 (`--override`), which draws exactly like main.

| Gate | Before, 24 seeds (main) | After, 24 seeds (`reports/balance-m3.md`) | Before, 72 seeds (kinds off) | After, 72 seeds |
|---|---|---|---|---|
| B1 | PASS | PASS | PASS | PASS |
| B2 greedy + greedy-pick median | 6 (PASS) | 6 (PASS) | 7 (FAIL) | 6 (PASS) |
| B2 none + greedy-pick median | 3 | 3 | 3 | 3 |
| B5 | PASS | PASS | PASS | PASS |
| B6 medians (overload, cryo, chain, mining, firewall) | 7 6 6 6 6 | 8 6 6 6 6 | 8 6 6 7 6 | 7 6 6 6 6 |
| B6 max/min | 1.17 (PASS) | 1.33 (FAIL) | 1.33 (FAIL) | 1.17 (PASS) |

**Reading.** B6 at 24 seeds fails on a single overload median that tipped from 7 to 8. At 72 seeds the branch passes
B2 and B6 while main does not, so the new kinds do not make B6 worse. They tighten it a little.

Other tunes tried at 24 seeds:

| Leech hp | Greedy median | B6 medians (overload, cryo, chain, mining, firewall) | B6 max/min |
|---|---|---|---|
| 14 | 7 | 8 7 6 7 7 | 1.33 |
| 18 | 7 | 8 6 6 7 7 | 1.33 |
| 24 | 6 | 7 6 5 6 6 | 1.40 |

## Open issues

- **Phage path.** The phage walks straight at the nearest structure. If that is a station behind a wall arc, it walks
  through the arc, because walls only block movement toward the core. It is rare, since stations sit at their own ring.
- **Spore copies and wave clearing.** Copies are spawned by kills, so a wave can briefly run past its spawn count. The
  wave timer is unchanged; copies left at the wave end carry over like any live virus.
- **Carrier aura with Overload ground.** The aura is applied before the ground multipliers, so the two multiply.
- **Covers and thumbnails.** `tools/covers/record.mjs` (B1) still spawns only the old kinds, so the new bodies are not
  on the covers yet.
- **Outside B2 ownership (needed for compile or colour):**
  - `src/ui/statsRows.ts`: `KIND_NAME` entries.
  - `src/render/palette.ts`: `ENEMY_COLOR`/`ENEMY_ACCENT` for the new kinds and the ranged recolour.
  - `src/sim/viruses.ts`: new file.

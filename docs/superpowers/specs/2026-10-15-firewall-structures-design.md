**Scores (1-10: fun/readability · impl risk (10 = safest) · balance · code fit)**

- **fantasy** — 9 · 5 · 6 · 6. Best names, verbs and tier-III "moments"; but a 4th BUILD tab (STAT_IDS 18→24), per-kind bespoke fields and 20–50 % HP walls are the most code and the most balance risk.
- **lean** — 6 · 8 · 7 · 9. Cleanest sim (share-based HP, state derived from the profile each tick, v7 migration, one pass), but structures only at tier II means bots, auto-placement and the widget never see them, and tier-I stays the old dull line.
- **economy** — 8 · 6 · 8 · 7. Structures at tier I so `sim:balance` sees them, old effects folded into ladders, `poweredShare` + streak close the link-flip exploit, `fortify` command avoids new StatIds; v8 bump and path-crossing decoy maths are unneeded cost.

**Base: economy. Grafted: lean's state model (share HP, derived slots, no stored on/off, v7 migration, aggro decoy, lazy creation) and fantasy's names/verbs/tooltips/III signatures.**

---

# Firewall Fusions as Structures — Final Design

## Summary
The four `firewall+X` fusions become buildings on the battlefield: **Ice Wall** (cryo), **Bastion** turrets (overload), **Minefield** (chain), **Relay Stations** (mining). Each appears at tier I, grows at II, gets a signature at III. All strength is a fraction of core stats (Health, Damage, Defense, Thorns, energyGrowth), so every existing purchase upgrades the buildings and nothing new can out-scale the core. Structures follow links live: a broken link makes them *dormant* (kept, not drawn, inert); anything damaged at that moment counts as destroyed, so unlinking never saves a building. The wall ring is fixed per wave (`w.wallR`, set in `startWave`), never mid-wave. One new effect type (`structure`), two new World fields, one new sim pass, one new render class. Structure upgrades are 6 new StatIds in a BUILD tab (run) and the workshop (see Upgrades).

## Interpretation decision
**A, with B's look for free.** Each fusion builds independently; a turret/mine/station never needs the wall. Stations sit *inside* the wall ring and turrets *on* it, so when both exist the wall protects them purely by geometry — no cross-fusion bookkeeping, no "break cryo, lose three fusions" (combos spec: tiers are live per pair). Old effects are not kept beside the structures (that would double firewall power and blow B6); each is carried into its ladder: `thornsSlow` → Ice Wall II, `coreHpBelow` → Bastion Frenzy, `retaliate` → mine arcs, `runEndBits` → station Bits, `shield` (Insurance) → Relay Stations I keeps `shield 0.05` so the effect type stays in use. Enemy rule, one line: **"Walkers and shooters hit the first thing in their way; a gap in the wall leads to the Core."**

## Per-fusion ladders (1 / 3 / 5 links; fold = field-wise max over reached tiers, like `shield` at perks.ts:525; every field is "higher is better")

| Fusion | I | II | III |
|---|---|---|---|
| **Ice Wall** cryo+firewall | 6 segments (one per 60° sector), each 10 % core max HP; viruses in that sector must break it; Thorns reflect on wall hits; at wave start only *uncontested* segments (no virus within `wallR+60` in that sector) are repaired | 18 % HP; `thornsSlow` 0.3 / 2 s kept (fires on wall and core hits); a broken segment regrows after 10 s | 28 % HP; **Shatter**: a segment breaking freezes viruses within 80 px for 1.5 s; `slowCap +0.1` kept |
| **Bastion** overload+firewall | 1 turret on the ring, 20 % Damage, 1 shot/s, range 220, indestructible, no crit | 2 turrets; **Frenzy**: ×2 fire rate while core HP < 50 % *or any wall segment is broken* | 3 turrets, 30 % Damage, each shot hits 2 targets |
| **Minefield** chain+firewall | 2 mines/wave (max 6) in a thin band just outside the wall, trigger 24 px, blast 40 px, 150 % Damage, ≤ 3 targets, counts as chain; mine kills pay no `farMul` | 3/wave (max 9); each blast arcs (`lightning()`: lightningTargets × lightningDamage) | 4/wave (max 12), 250 % Damage; `defense +0.05` kept |
| **Relay Stations** mining+firewall | 1 station, HP 10 % core, pays `12 · energyGrowth^wave` Energy at wave end × powered share; melee within 80 px divert to it; rubble rebuilds after 3 waves; `shield 0.05` kept | 2 stations; **Streak** +10 % per wave survived, up to ×2; reset on loss | 3 stations; each survivor also pays `scaleForWave(4, tier.bitsMul, bitsGrowth, wave)` Bits (replaces runEndBits ×1.15) |

Sanity (wave 50, Ice Wall I: ≤ 6 × 10 % = 0.6 core HP of extra buffer per wave, less whatever stays contested; Stations III full streak ≈ 3 × 32 × 2 ≈ 190 Energy/wave vs kill income ≈ 650+ and interest cap ≈ 214 → 20–25 % of income, the intended ceiling). Wall EHP is the phase-1 gate (B7 run length, wall-absorbed ratio), not a phase-3 afterthought.

## Structures model
**World** (plain JSON, keep `WORLD_VERSION`/`SNAPSHOT_VERSION` = 7; `restore` defaults missing fields like the `fusionTiers` migration at snapshot.ts:70-72):
```ts
structs: { id: number; kind: 'wall'|'turret'|'mine'|'station'; slot: number;
           x: number; y: number;      // render cache, rewritten by syncStructures
           share: number;             // HP as share of max in [0,1]; max derived each tick
           cd: number; streak: number; powered: number; downUntilTick: number }[];
wallR: number;                        // ring radius for this wave, set in startWave (0 = no wall yet)
```
- `id` from `w.nextId++` (state.ts:116); array in id order; ≤ 6+3+12+3 = 24 entries. Lazily created by `syncStructures` while `count(kind) > entries(kind)`; only mines are removed (on blast).
- **Active** = `slot < prof.structures[kind].count && share > 0 && tick >= downUntilTick`. Derived from the profile each tick (perkProfile is rebuilt at step.ts:76 from `w.fusionTiers`), so no hook in `shiftTier`/`refreshTiers` and no stored flag.
- **Max HP** = `hpFrac × st.health` (× `structHealth` stat). Share-based HP means Health buys, Glass Cannon and mastery scale structures without `keepHealthShare` work and never heal or kill one.
- **Geometry**: `w.wallR` is computed once per wave in `prepareStructures`: `clamp(wall.minRadius + wall.ringStep × (crystalRing(data,w.wave) − crystal.maxRing), wall.minRadius, st.range − wall.rangeMargin)` (territory.ts:148; margin 32 = tank radius + 10 so the core can always shoot what stands at the wall; ≈ 240–268 at base Range, inside spawnRadius 380, outside ranged standoff 240). If it grew, every enemy with `dist < wallR + e.radius` is pushed radially out to `wallR + e.radius` (same tick, no knockback event). `stationR = wallR − station.inset` (always inside the ring). Slot vectors are code, not data: wall/turret `i` on `SECTOR_DIRS[i]` (hex.ts:17-23, y down, so drawn arc = `sectorOf` sector); station `i` on the normalized midpoint of `SECTOR_DIRS[i]`,`SECTOR_DIRS[(i+1)%6]` via `dsqrt` — no trig.
- **Link break** → dormant: not drawn, not targetable, no fire/pay/block. On the tick a kind turns dormant, every entry with `share < 1` takes `structDown` (wall: regrow timer or next wave; station: rubble `rebuildWaves`), and every station `streak = 0`; undamaged entries keep share 1. Relink restores exactly that. Mid-wave `moveModule` is allowed (perks.ts:296 only rejects dead), hence no repair outside wave start.
- **Wave start** (`startWave`, waves.ts:38, after the shield refill at :60): `prepareStructures` sets `w.wallR`, pushes trapped viruses out, repairs uncontested wall segments and stations with `downUntilTick` passed to share 1 (contested segments keep their share — waves end on the timer, waves.ts:204, so leftovers are standing at the wall), plants mines on `createStream(w.seed, 'mines:'+w.wave)` (pattern waves.ts:62): direction index `nextInt(0,64)` into `data.directions`, radius uniform in `[wallR+mine.band[0], wallR+mine.band[1]]` (ray spacing at r ≈ 270–330 is 26–32 px < trigger 24 + radius, so every mine is reachable from its own and both neighbouring rays); top up to `perWave`, cap `max`. `rng.combat`/`rng.spawn` draw counts never change. Nest pool (waves.ts:135) excludes cells with `d2 < (wallR+60)²`, so no nest spawns inside the ring.
- **Enemy interaction** (`updateEnemies`, enemies.ts:63-64 chooses `stopAt`; attack branch :72-107). Target order per enemy per tick:
  1. **Wall segment** `sectorOf(e.x,e.y)` if active and `dist ≥ wallR + e.radius − ARRIVE_EPS` → `stopAt = wallR + e.radius` (for ranged `max(standoff, …)` = the wall). Ranged beams hit the segment while it stands: the wall is the game's first answer to ranged. A virus already inside when a segment reappears keeps going to the core.
  2. **Nearest active station within `station.aggro`** (squared distance, ≤ 3 entries, ties by id) → melee stops at `station.radius + e.radius`; ranged shoots it if within standoff. Because the wall check comes first, stations inside an intact wall are safe.
  3. **Core**, unchanged.
  Movement maths stays; only the target point becomes `(tx,ty)` instead of (0,0). Damage to a structure: `dmg = e.damage × (1 − st.defense)` (no `firewallGround`: attackers at r ≥ 250 stand outside the infected ring and the crystal sectors, the term would be dead); `share −= dmg / maxHp`. Shield, immunity and the core `coreHit` pipeline stay core-only; **Thorns reflect** (reuse the `hitEnemy(…,'thorns')` block with `thornsSlow`). Events `structHit`, then `structDown` at share ≤ 0 (wall: `downUntilTick = tick + regrowSec·tickHz` at II+, else next wave start; station: `downUntilTick = tick + rebuildWaves·(waveTicks+pauseTicks)`, streak = 0). Shatter at III pushes the segment's `(x,y)` to a module-level scratch list; `updateStructures` resolves it after the grid rebuild (`kNearest(x,y,80,8)`, skipping `hp <= 0`).
- **Knockback** only pushes outward (never inward), so it cannot conflict with the wall. `revive` (commands.ts:80-96) also sets every struct share to `max(share, reviveHp)`.
- **Scaling**: wall/station HP ∝ Health; turret/mine damage ∝ Damage (so `lateGrowth` hits structures and core together); station Energy ∝ `energyGrowth^wave × (1+energyBonus) × boost × geneEnergy` like nests (waves.ts:146); station Bits via `scaleForWave(bits, tier.bitsMul, bitsGrowth, wave)` like kills (waves.ts:115); Defense/Thorns/Piercing gene apply as for the core. Everything through `clampValue`.

## Upgrades (owner decision 2026-10-15: a new tab in the run + always in the workshop)
- A 4th upgrade tab **BUILD** (`stats.json` `tabs.build`) with 6 new StatIds: `structHealth` (×HP of wall segments and stations), `structRegen` (wall/station regen, % max HP/s), `turretDamage` (×turret damage), `turretSpeed` (×turret fire rate), `mineDamage` (×mine blast damage), `stationIncome` (×station Energy/Bits). `STAT_IDS` 18 → 24; costs in `stats.json` with the usual `base·growth^L` → `knee` → `growthAfter` curves.
- **In a run** the tab is always visible; a row whose structure kind is not active (fusion tier 0) is shown locked ("needs Ice Wall" / "needs Bastion" …) and the `buy` command rejects it with `'locked'`, so no Energy is wasted. Bought levels persist through link breaks.
- **Workshop** (Home): the 6 stats are always listed and buyable with Bits like the other 18 (starting levels for every run), regardless of crystal layout.
- `panelLayout.ts` goes from 3 to 4 tabs (both orientations); `statsRows`/StatsPanel show the new values; bots (`greedy`, `atk-first` → turret/mine, `def-first` → structHealth/structRegen, `round-robin`) consider BUILD rows only when unlocked. Golden replay re-recorded.

## Data JSON examples
`src/data/sets.json` (replace the four blocks at :127, :169, :197, :211):
```json
"cryo+firewall": {"name":"Ice Wall","tiers":{
  "1":[{"type":"structure","kind":"wall","hpFrac":0.10}],
  "3":[{"type":"structure","kind":"wall","hpFrac":0.18,"regrowSec":10},{"type":"thornsSlow","strength":0.3,"seconds":2}],
  "5":[{"type":"structure","kind":"wall","hpFrac":0.28,"shatterRadius":80,"shatterSec":1.5},{"type":"ruleChange","rule":"slowCap","op":"add","value":0.1}]}},
"overload+firewall": {"name":"Bastion","tiers":{
  "1":[{"type":"structure","kind":"turret","count":1,"dmgFrac":0.2,"rateMul":1,"range":220,"targets":1}],
  "3":[{"type":"structure","kind":"turret","count":2,"frenzyBelow":0.5,"frenzyMul":2}],
  "5":[{"type":"structure","kind":"turret","count":3,"dmgFrac":0.3,"targets":2}]}},
"chain+firewall": {"name":"Minefield","tiers":{
  "1":[{"type":"structure","kind":"mine","perWave":2,"max":6,"dmgMul":1.5,"blast":40,"targets":3,"arcs":0}],
  "3":[{"type":"structure","kind":"mine","perWave":3,"max":9,"arcs":1}],
  "5":[{"type":"structure","kind":"mine","perWave":4,"max":12,"dmgMul":2.5},{"type":"statAdd","stat":"defense","value":0.05}]}},
"mining+firewall": {"name":"Relay Stations","tiers":{
  "1":[{"type":"structure","kind":"station","count":1,"hpFrac":0.10,"energy":12,"rebuildWaves":3,"bits":0},{"type":"shield","frac":0.05}],
  "3":[{"type":"structure","kind":"station","count":2,"streakStep":0.1,"streakMax":2}],
  "5":[{"type":"structure","kind":"station","count":3,"bits":4}]}}
```
New `src/data/structures.json` (loader import beside data.ts:1-12, `validateData` section; slot vectors live in code, see Geometry):
```json
{"wall":{"minRadius":240,"ringStep":12,"rangeMargin":32,"segments":6,"contestDist":60},
 "turret":{"muzzle":10},
 "mine":{"trigger":24,"band":[30,70]},
 "station":{"inset":34,"radius":18,"aggro":80}}
```

## Sim changes (insertion points verified 2026-10-15)
1. `src/sim/perkData.ts:23` add `'structure'` to `EFFECT_TYPES`; union member at :26-68; `validateEffect` case after `'retaliate'` (:223): `kind` in closed list, each present field via `pos/frac/wholePos` (`count` 0–6, `hpFrac` frac, `perWave ≤ max ≤ 12`). `validateSets` then folds each firewall ladder tier by tier and requires the complete per-kind field set after tier 1 (so a typo'd tier-I entry cannot pass with no `count`) and non-decreasing values along the ladder — all fields are multipliers/amounts where larger is better (`rateMul`, not a period).
2. `src/sim/perks.ts:424` `blankProfile` gets `structures: {wall?, turret?, mine?, station?}`; `fold` case after `'retaliate'` (:545) does field-wise max. Delete the `retaliate` type (perkData.ts:223, perks.ts:545, enemies.ts:103-107, perkText.ts:113) — it becomes dead data otherwise and `tests/perkData.test.ts:33-41` would fail. `shield` stays used via Relay Stations I (cards.json Barrier alone would fail the same test).
3. `src/sim/state.ts:66` add `structs`, `wallR`; defaults in `createWorld` next to `fusionTiers: {}` (:237). `src/sim/snapshot.ts:70` migration block: `structs ??= []`, `wallR ??= 0`, new stat levels default to 0, then validate finite/shape.
4. New `src/sim/structures.ts`: `structureGeometry(w,data,prof)` (reads `w.wallR`), `syncStructures`, `prepareStructures` (called from `startWave`, waves.ts:60), `payStations` (called right after `payWaveRewards`, waves.ts:174, inside `advanceWave` :187), `updateStructures`. Own scratch arrays (`nearS` for queries, `blastS` copied before `lightning()` reuses projectiles' private `near`, projectiles.ts:120 is not exported).
5. `src/sim/step.ts:80`: order is `advanceWave` → `syncStructures(w,data,st,prof)` → `updateEnemies` (so a tier reached and a wave starting on the same tick see this wave's count; test it); `step.ts:93-94`: insert `updateStructures(w,data,st,prof,events)` between `updateCore` and `updateProjectiles` (grid already built at :92, so Shatter and turrets see live positions; `updateProjectiles` :216 filters the dead for free). Death check (:83) still reads core HP only.
6. `src/sim/enemies.ts:63-64`: replace `stopAt` with target selection (wall → station → core); split the attack branch at :77-107 into `attackCore` (unchanged) and `attackStruct` (defense, Thorns+thornsSlow, events, Shatter push to scratch). Per enemy cost: 1 `sectorOf` + ≤ 3 squared distances.
7. `src/sim/projectiles.ts:57` `HitSource += 'turret' | 'mine'`; mirror in the `hit` event's source union in `src/sim/events.ts`; `'mine'` counts as chain in `chainKillMul` (projectiles.ts:99-102) and in the `chain` ground multiplier (:77-79); `farMul` (territory.ts:154) is skipped (`far = 1`) for `source === 'mine'`. Lifesteal/knockback stay `shot|bounce` only.
8. Turrets in `updateStructures`: `cd -= 1` per tick (×frenzy); at ≤ 0 `kNearest(x,y,range,targets,nearS)`, `hitEnemy(…, dmgFrac×st.damage, false, 'turret')`, event `turretShot{sid,targetIds,x,y}`. No Projectile, so no origin fix and no `rng.combat` draw.
9. Mines: trigger when any enemy has `d² ≤ (trigger + e.radius)²` (grid query radius `trigger + 40`); copy `kNearest(x,y,blast,targets,nearS)` into `blastS`, `hitEnemy(…,'mine')` each, then `lightning()` (projectiles.ts:126) from the first hit if `arcs ≥ 1`; `mineBlast{x,y,r}`; splice the mine.
10. Stations: `powered += 1` each active tick; at wave end `E = energy · powInt(energyGrowth, wave) · (1+st.energyBonus) · boost · geneEnergy · streakMul · powered/waveTicks`, Bits via `scaleForWave`, `powered = 0`, streak ++ if alive, `stationPay{sid,x,y,energy,bits}`.
11. Events (`src/sim/events.ts:8-50`): `structHit{sid,kind,x,y,enemyId,damage,ranged}`, `structDown{sid,kind,x,y}`, `structUp`, `turretShot`, `mineBlast`, `stationPay`.

## Render / UI
- New `src/render/StructureView.ts` (~120 lines), stateless, drawn right after `view.draw` (scenes/BattleScene.ts:1034); reads `w.structs`, `w.wallR` + `structureGeometry()` exported from sim.
  - Wall: one `Graphics` at depth 4.5, 6 arcs at `wallR·L.scale` centred on `SECTOR_DIRS`, cyan line with orange rim, alpha by share, cracks < 50 %, broken segment = dashed ghost with a regrow sweep. Redraw only when shares, `wallR` or `L.scale` change (as `drawRange`, WorldView.ts:163-181).
  - Turret (yellow hex + barrel, depth 7.5, rotates to last target), mine (purple diamond, depth 3.5, slow pulse, fast blink when a virus is within 2× trigger), station (green hex + orbit ring, depth 7.5): white bakes in `generateTextures` (textures.ts:571) tinted by `TAG_COLOR`, pooled by id with the stamp-and-drop pattern (WorldView.ts:313). Dormant = not drawn.
  - HP bars for wall segments and stations only when `share < 1`, in the shared `bars` Graphics style (WorldView.ts:306-311).
- `BattleScene.onEvent` (:851) cases: `structHit → fx.hit (+ fx.beam if ranged)`, `structDown → fx.death-style burst + sfx`, `turretShot → fx.beam + muzzle`, `mineBlast → fx.pulse + arcs`, `stationPay → green "+E" DamageNumber`.
- Tap on a structure (`hoverModule`, :515, `pointerdown` branch only) → `SetTooltip.showFusion` ladder plus a live line (`Segment 3: 41 %`, `Station 2: streak ×1.4`).
- `statsRows.ts`: append a STRUCTURES section (wall absorbed, turret/mine kills, station Energy/Bits, stations lost) to `battle`/`economy`; never touch the CORE 3×6 slice (:146-148). `runStats.recordEvent` handles the new events.

## Tooltip text (`effectLine`, perkText.ts:53, new `case 'structure'`)
- wall: `6 wall segments, 10% Core HP each; viruses must break through; quiet segments are repaired each wave` · II adds `broken segments regrow in 10 s` · III `Shatter: a breaking segment freezes viruses within 80 px for 1.5 s`
- turret: `1 turret: 20% Damage, 1 shot/s, range 220` · `Frenzy: ×2 fire rate while Core HP < 50% or a wall segment is down` · `3 turrets, 30% Damage, each shot hits 2`
- mine: `2 mines per wave just outside the wall: 150% Damage blast, up to 3 viruses` · `blasts arc lightning` · `4 mines per wave, 250% Damage`
- station: `1 station inside the wall: +12 Energy × wave growth at wave end while standing; viruses attack it, rebuilds in 3 waves; Shield 5%` · `survival streak: +10%/wave, up to ×2` · `each surviving station also pays 4 Bits × wave growth`
Fusion header stays `1/3/5 links → I/II/III`; chips and ProtocolsPanel update for free.

## Tests / bots / balance
- New `tests/structures.test.ts` on `DEFAULT_DATA`: 1 cryo–firewall link → 6 segments created on the first tick, snapshot round trip afterwards is id-stable; melee stops at `wallR` and damages the segment, not the core; ranged hits the segment; broken segment lets the virus through; contested segment is not repaired at wave start, uncontested is; `wallR` growth pushes a parked virus out; wall arc `i` matches `sectorOf` for a virus on `SECTOR_DIRS[i]`; station aggro divert; station inside intact wall untouched; mines deterministic per seed and `rng.combat` state unchanged vs a run without mines; mine kill pays no `farMul`; turret kill pays Energy; station pays only alive×powered, streak resets; unlink with a damaged station → rubble + streak 0, undamaged relinks intact; tier reached and wave start on the same tick; snapshot round trip with all kinds populated; old save without `structs`/`wallR`/new stat levels restores to defaults; `perkData` rejects per bad/missing field after fold; `effectLine` cases; purity (automatic for the new file).
- Amend: `fusions.test.ts` (no firewall ladder values asserted, only set tiers — verified), `perkData.test.ts:40` (drop `retaliate`; `shield` stays used), `enemies.test.ts`. Re-record `golden-01.json` **once at the end**.
- Bots: no change in phases 1–2 (tier I reached by accident). Phase 4: bots score BUILD rows only when unlocked (turret/mine → atk weight, structHealth/structRegen → def, stationIncome → util).
- `balance.ts` extra columns from events/final world: turret+mine kill share (target ≤ 25 % at III), mine Energy share (report), station Energy share (≤ 20 %), wall-absorbed vs core-taken (report), uptime (report). Gates for **phase 1**: B2 greedy median stays 4–6; B7 run length and wall-absorbed ratio; B6 `tag:firewall` moves from 5 toward 7 but ≤ 1.2× the lowest (baseline `reports/balance-m3.md:23-25`: firewall 5, max/min 1.40, already failing — re-run `sim:balance` on the branch before quoting). B4 via `sim:progression --players 20 --hours 150 --endless` after phase 2 (station Bits), tier unlock times within ±10 % of `reports/progression.md`. Measure II/III with `sim:balance --override` patches moving each structure to tier 1, then revert.

## Implementation phases (smallest shippable first)
1. **Skeleton + Ice Wall**: effect type + ladder validator, `structs`/`structLv`/`wallR` fields + migration, `structures.json`, `syncStructures`, per-wave `wallR` + push-out, enemy wall targeting, contested repair, nest exclusion, `StructureView` arcs, events, tests, B7 gate, golden re-record. (~1.5 days)
2. **Bastion + Minefield**: `updateStructures` turrets/mines, `HitSource` members, `farMul` skip, mine stream in the near band, render pools. No enemy-targeting change.
3. **Relay Stations**: aggro decoy, `payStations`, streak, rubble, unlink-as-destroyed; `sim:progression` run.
4. **BUILD tab + workshop**: 6 StatIds, 4-tab panel, in-run lock, workshop rows, bots, stats rows.
5. **Other six fusions' tier-III signatures** (below), one per PR.

## Risks
- Wall blocks ranged + regrow at II could make firewall builds too safe → hpFrac ≤ 0.28, contested segments are not repaired, no shield/immunity on structures, Piercing gene cuts wall Defense/Thorns; B7 run length and wall-absorbed ratio gate phase 1.
- Stations as decoys replace Health → `hpFrac` 0.10, aggro 80 only; report absorbed share.
- Hot loop touched (`updateEnemies` target point) → cover with `enemies.test.ts`, zero allocations (own scratch arrays, never nest `kNearest`).
- Phone clutter (6 arcs + 3 turrets + 12 mines + 3 stations + 120 viruses) → mines dim, no field text, caps in data; check `npm run ui` both orientations (portrait arena ≈ 720×704 fits `wallR ≤ 268`).
- Free power at tier I from auto-placement shifts B2 → tier I deliberately weak; tune with `--override`.
- Golden hash flips on any World key → one re-record at the end only.

## Ideas for the other six fusions (tier III gets a visible field object)
- **Thermal Shock**: frozen kill shatters, hitting `kNearest(blast)` for 50 % of the killing hit (mine blast without the mine).
- **Overcharge**: visible Tesla coil pylon on `shape.tips`; the periodic tesla fires from it, faster per bounce dealt that wave.
- **Headhunter**: one virus per wave Marked on `createStream(seed,'mark:'+wave)`, gold crosshair, ×3 Energy/Bits; bosses drop Key shards.
- **Superconductor**: lightning leaves short-lived frost cells (`terrain` → cryo for N ticks, reuses `cryoSlow`); drawn as a cyan web.
- **Cold Storage**: a Vault structure (one more `kind`, no enemy aggro) banks a share of wave Energy and pays it back +X % three waves later; frozen kills drop ice-crystal Energy pickups.
- **Network**: reclaimed nests become relay nodes that hold a bounce for one extra jump and pay Energy per chain kill near a Station or Turret.

## Owner decisions (2026-10-15)
1. Structures are **independent** (no wall-as-hub); the wall protects turrets/stations by geometry.
2. Structures appear at **tier I**, weak, and grow to III.
3. **Ranged viruses stop at the wall and shoot the segment.**
4. Upgrades: **BUILD tab in the run + always in the workshop** (see Upgrades).
5. Defaults kept: stations pay at wave end × powered share × streak; only uncontested wall segments are repaired at wave start.

## Review notes
Applied: 1 (per-wave `w.wallR` + push-out), 2 (unlink = `structDown` for damaged, streak reset), 3 (contested segments not repaired, B7 gate in phase 1), 4 (`shield 0.05` kept at Stations I — `sets.json:215` is its only non-card use), 5 (slots from `SECTOR_DIRS`, no JSON vectors), 6 (`wallR ≤ st.range − 32`, `minRadius` 240), 7 (nest pool excludes the ring), 8 (`far = 1` for mines, mine Energy column), 9 (pre-filled `structLv`), 10 (Shatter in `updateStructures`), 11 (own scratch), 12 (`scaleForWave` with `tier.bitsMul`), 13 (ladder fold validation, monotone fields, `rateMul`), 14 (band `[wallR+30, wallR+70]`, trigger 24), 15 (`downUntilTick` only), 16 (`:77-79`), 17 (`firewallGround` dropped from wall hits), 18 (Frenzy also on a broken segment), 20 (id-stability test), 21 (step order stated + test), 22 (`pointerdown` only).
Rejected: **19** — `reports/balance-m3.md:23-25` does carry the B6 row (firewall 5, max/min 1.40, FAIL); the baseline quote is correct, kept with a re-run before gating. The former decision 4 (`retaliate`) was closed as "delete" by the critique's own accounting and replaced by the wall-repair question.

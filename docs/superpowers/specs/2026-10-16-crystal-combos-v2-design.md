# Six Fusions as Crystal Payoffs — Final Design

## Summary
The six non-firewall fusions stop being flat 1.2–1.5× lines and become visible objects from tier I, growing to a tier-III signature and an optional late-game **Apex**: **Shatter** (overload+cryo), **Tesla Pylons** (overload+chain), **Bounty Marks** (overload+mining), **Frost Web** (cryo+chain), **Cryo Vault** (cryo+mining), **Relay Nodes** (chain+mining). Three of them pay Bits, so the crystal shows up in progression. Four crystal-level rules make assembly a decision rather than a one-time optimum: **Weld** (tier rises apply after 5 s, settled every tick), **Apex** (7 cluster links + both tags at set ≥ 4, a per-fusion optional ladder step), **Lattice** (tick-averaged fusion tiers multiply run-end Bits), **Resonance** (set 4/6 scales one declared `power` field per fusion). Between runs: a **Blueprint** copied into the World at run start that the auto-placer fills, and a **Codex** paying one-time Keys. Everything reuses the structures framework (`structure` effect, `w.structs`, `updateStructures`, `payStations`, `StructureView`, `HitSource`). Phases 0–2 ship first; 3–7 are re-decided after telemetry.

## Design goals (why players will sit with the crystal)
1. **Legible payoff**: every pair at tier I already puts a thing on the field (burst, pylon, reticle, vault, node) — a first run (3–5 modules) sees what a combo *is*.
2. **The crystal pays Bits**, not only in-run Energy: Lattice, Marks, Vault, Dividend, Codex. Target: an assembled crystal earns +25–40 % run Bits over AUTO at wave 50 (open decision 3), plus in-run Energy. No Keys from fusions (owner decision).
3. **Real trade-offs**: cluster-scoped links make K5 bite (one-cluster-per-tag touches ≤ 9 of 10 pairs), Apex scarcity (late game: one Apex ≈ 9+ modules, wave 80+), Resonance (deepen a cluster vs widen seams), Vault (Energy now vs later).
4. **Between-run play**: Blueprint + Codex give idle and widget players a reason to open the crystal on Home.
5. **No flip exploits**: Weld, tick-averaged Lattice and genes, object state lost on dormancy, links counted only inside the tag's largest cluster.

## Per-fusion ladders (links 1 / 3 / 5 / Apex 7; fold = field-wise max; all amounts fractions of core stats; **bold** = the fusion's single `power` field that Resonance scales)
| Fusion | I | II | III (signature) | Apex (IV) | Visible object |
|---|---|---|---|---|---|
| **Shatter** ov+cryo | frozen kill bursts: 40 px, **30 % of killing hit**, ≤ 2 targets; ×1.15 dmg vs slowed | burst 50 %, ≤ 3 targets, slows 0.3 for 1.5 s; ×1.4 dmg vs frozen | burst 80 %; burst kills burst again (depth ≤ 2, ≤ 8 bursts/tick, queued to the next tick) ; 10 % freeze 1 s | depth ≤ 3, ≤ 4 targets | cracked-ice bursts (pooled sprites); counter only in the run-end block |
| **Tesla Pylons** ov+chain | 1 pylon on the ov/chain seam tip (`shape.tips`); each bounce/lightning hit = +1 charge; at 25 fires `lightning()` from the pylon, 3 targets, **100 % Damage** | 2 pylons, threshold 20, pylon bolts can crit; lightningDamage ×1.3 | 3 pylons, threshold 12, 200 %; a bolt kill refunds 3 charge (once per discharge); overdrive (overload 6) halves the threshold | threshold 8, +1 target | glowing coils growing out of the crystal; moving modules moves them |
| **Bounty Marks** ov+mining | 1 Marked virus per wave (`createStream(seed,'mark:'+wave)`), gold reticle: **×4 Energy, ×4 Bits** (reward lines, outside `how`); crit-kill Energy ×1.5 kept | 2 Marks; a crit kill on a Mark = Jackpot ×2 more; critChance +0.03 | 3 Marks, the boss is always Marked at **×2 Bits** (not ×4; stacks with `bossBitsMul`); every 12 Marks killed = Bounty jackpot `scaleForWave(markJackpot, bitsMul, bitsGrowth, w)` Bits (cap 2/run) | jackpot every 8 Marks (cap 3/run) | gold reticles, one "BOUNTY 7/12" HUD chip |
| **Frost Web** cryo+chain | lightning freezes 0.5 s (kept); lightningRange ×1.3 | each lightning *target* cell gets frost for 3 s (**+0.3 slow** under `slowCap`), drawn as a cyan web between frosted cells | Supercooled: a lightning hit on a frozen virus gives `lightningTargets +2` for that cast. **Delete `freezeSeconds ×1.5`** | frost 5 s | cyan web only while cells are frosted |
| **Cryo Vault** cryo+mining | Vault structure at the core (`kind:'vault'`, no aggro): banks **10 %** of each wave's kill Energy, repays ×1.3 three waves later; frozen-kill Energy ×1.3 | banks 20 %, repays ×1.5; frozen kills pay Bits ×2 (`killBonus.bitsMul`) | Deep Freeze: in the step.ts death branch the vault + pending deposits convert to Bits at `vaultBitsRate` (cap +12 % of run Bits), folded into `w.bitsBonus` | repay ×1.7 | frosted hex with 3 stacked bars |
| **Relay Nodes** chain+mining | a reclaimed nest leaves a node (max 3; before any nest exists one node sits on the seam tip); bounce/lightning within 70 px of a node gets +1 jump; nest payout ×2 through energyBonus/bitsPerKill; chain-kill Energy ×1.3 | max 5 nodes; beams node↔node↔core deal **15 % Damage** per 0.5 s (`beamSec` in data) to crossing viruses; a node goes dark while its cell is infected | Dividend: each lit node pays `scaleForWave(3, bitsMul, bitsGrowth, w)` Bits at wave end; ≥ 4 lit nodes held 15 waves = dividend ×2 for the rest of the run | max 6 nodes, dividend ×1.5 | purple constellation that grows with reclaimed territory |

Anti-flip: a pylon's charge, the vault's pending deposits (paid × powered share of the deposit wave, like stations) and nodes are lost or dark while the pair is dormant. Removed duplicates: Cold Storage II/III, Network II (bounces +1 moves to chain 2). Order note: `hitEnemy` runs in `updateProjectiles` after `updateStructures`, so projectile-kill bursts and pylon charge are queued and resolve on the next tick.

## Cross-fusion synergies (active when both sides ≥ II; most are emergent, none multiplies another)
- Shatter × **Ice Wall** III: wall-break freezes feed bursts (emergent).
- Tesla Pylons × **Minefield**/**Bastion**: mine arcs and turret hits add pylon charge (one line in `hitEnemy` source check).
- Bounty Marks × **Bastion**: turrets prefer the Marked target (target pick in `updateStructures`).
- Cryo Vault × **Relay Stations**: 10 % of station Energy is deposited (one line in `payStations`).
- Relay Nodes × **Relay Stations**: stations count as lit nodes (beams, dividend, +1 jump).
- Frost Web × Shatter: frost cells slow → more frozen kills → more bursts (emergent).
- Tesla Pylons × overload 6 overdrive and Shatter × cryo 6 freezeAll: the two "harvest windows" (see Sets).

## Set changes (2 / 4 / 6)
- Keep every 2 and 4 line; mining 4 `runEndBits ×1.25` stays the base Bits lever.
- **Resonance**: a tag at set 4 multiplies the bold `power` field of its four fusions ×1.15, at set 6 ×1.3 (`resonance` table in sets.json; applied in `perkProfile` to that one field only — counts, caps, Mark rules and node limits never scale). The pick becomes "deepen or widen".
- 6-set hooks: overload 6 overdrive halves pylon threshold; cryo 6 freezeAll is the Shatter harvest; firewall 6 immunity covers structures.
- B6 data fix (chain 5, mining 5 vs overload 7, `reports/balance-m3.md:23-25`): chain 2 adds `bounces +1`; mining 2 adds `bitsPerKill +0.1`. Re-gate with `sim:balance`.
- Freeze lock guard: validator + clamp so freezeAll seconds × all multipliers ≤ 0.6 × everySec (perks.ts:590); global rule: a thawed virus cannot be refrozen for 1 s.

## Crystal-level systems (exact rules)
1. **Cluster-scoped links**: `fusionLinkCounts` counts an adjacency only when both modules belong to their tag's largest cluster (the same cluster `clusterCounts` uses for set counts, perks.ts:56-60). A stray 5th module touching the missing pair adds a set stack but no link; with one cluster per tag the contracted graph is planar, so ≤ 9 of 10 pairs can be adjacent. Confirmed by the new `tools/sim/crystalGeometry.ts` (phase 0).
2. **Apex**: `fusionTiers` stays `[1,3,5]` (sets.json:83, firewall ladders untouched). Each of the six fusions declares optional `apex: Effect[]` and `apexLinks` 7. `refreshTiers` (perks.ts:223-240) applies the apex step only if present, links ≥ `apexLinks` and both tags' set counts ≥ 4; otherwise the pair reads as III. Stored as tier 7 in `w.fusionTiers`; `shiftTier` receives the per-fusion ladder `[...fusionTiers, apexLinks]` only for fusions that have `apex`. Scarcity is pick-gated: ≈ 14 picks by wave 50, one Apex needs two clusters ≥ 4 sharing 7 edges — a wave-80+ goal, never a wave-50 tuning target.
3. **Weld**: a tier *rise* is recorded in `w.fusionPending: Record<string,{tier:number; links:number; sinceTick:number}>` (plain JSON); `settleWeld(w,data,events)` runs in `step()` before `perkProfile` and promotes it via `shiftTier` under `keepHealthShare` once `w.tick − sinceTick ≥ weldTicks` (data, 5 s) with the pair's link count unchanged; any link change resets `sinceTick`; a drop is immediate. Between waves moves stay cheap; mid-wave flipping costs 5 s of the old tier.
4. **Lattice → Bits**: every tick `w.latticeSum += Σ tier index (I=1…IV=4)`, `w.latticeTicks += 1` (10 lookups). In the death branch (step.ts:86) `runEndBits ×= 1 + latticeCoef × latticeSum / latticeTicks`, `latticeCoef` 0.015 in sets.json. Expected: AUTO ≈ 5 points → +7.5 %; assembled ≈ 15–20 → +22–30 %. A tick average ⇒ rearranging before wave end or death gains nothing.
5. **Gene averaging**: `refreshCrystal` caches `w.tagCountsNow` (5 numbers); every tick `w.geneAcc[tag] += tagCountsNow[tag]`; at wave end `mutate` (waves.ts:43) reads `geneAcc / ticks` and the accumulator resets. Splitting the cluster one tick before wave end moves the mean by 1/1560.
6. **Pair-aware autoSlot** (crystal.ts:74, crystal.json `auto.link`): a foreign neighbour gets `linkNear × tierReached` only when that single link completes the pair's next tier (exactly 1 short), `linkNear` 3. Target: a diversifying AUTO player has ≥ 2 pairs at II by wave 50 (today 0.9) without clustering less.
- **Rejected**: link strength (changes thresholds, delays III for auto), Prisms (rule without decision once Apex exists), bandwidth budget (see Open decisions), arc fence and Cryo Lance (hot loop + clutter), per-move cost (weld suffices), pie/wedge bonuses (6 wedges cannot host 10 pairs).

## Planning UI (previews, hints)
- **Pair chips** in place/arrange mode: `Overcharge II · 2 → III`; tapping a chip glows every free hex/swap that adds a cluster link to that pair (extends `slotGains`, CrystalEditor.ts) and shows the Lattice delta.
- **Pick-card badges**: `+1 link → Network II`, `opens Headhunter`, `Apex ready` — computed with `slotGains` against the blueprint hex or `autoSlot`.
- **Lattice chip**: `LATTICE 14 · +21 % Bits` in the crystal readout and on the death screen; the run-end screen gains a "Crystal earned you" block (Energy / Bits per fusion from `runStats`).
- **Blueprint** (Home → Crystal, saved per profile, 3 slots via the existing `presets` lab): paint *tags* on rings 2–4; a live ceiling preview shows tiers reached if filled, with a planarity warning ("overload–mining cannot touch in this layout"). At run start the chosen blueprint is copied into `w.blueprint` (plain JSON, recorded in the replay header like `cardTags`); AUTO / AUTO ALL / widget fill the nearest empty blueprint hex of the perk's tag, else `autoSlot`; arrange mode shows ghost tags.
- **Offer bias**: the forced held-tag slot in `generateOffer` (perks.ts:109) prefers a tag whose `w.blueprint` hexes are empty, else a tag 1 link short of its next tier (35 %). Reads only World ⇒ replays stay deterministic. Needs a golden re-record.
- **Codex** (Home): 10 cells, silhouettes until discovered; first time a pair reaches III pays a one-off Bits reward (`codexBits` in data, ≈ one wave-50 run's Bits / 5); best tier and Lattice per pair.
- **Moments**: first III in a run → banner `FUSION ONLINE: TESLA PYLONS` + 0.6 s render slow-motion (sim time untouched); Apex → colour flash + distinct SFX.
- **Render budget**: one signature object kind per pair on the field at a time (pylons ≤ 3, nodes ≤ 6, vault 1, Marks ≤ 3), no field text, bursts/web as pooled sprites with LOD, beams alpha 0.35; HUD adds at most BOUNTY, LATTICE and the pair chips (editor only); "low fx" setting; `npm run ui` screenshot gate per phase.

## Data / sim sketch (anchors verified at HEAD d7bf8f2; working-tree files are shifting)
- `src/data/sets.json`: keep `:83 fusionTiers [1,3,5]`; replace the six ladders at :85-98, :99-112, :113-126, :141-154, :155-168, :183-196 and add `apex`/`apexLinks` to each; delete the `freezeSeconds` line at :151; add `latticeCoef`, `howCap`, `weldTicks`, `vaultBitsRate`, `beamSec`, `resonance` table, `power` field name per fusion.
- `src/sim/perkData.ts:23` `EFFECT_TYPES`: `structure.kind` gains `pylon|vault|node`; new types `shatter`, `mark`, `frostWeb`, `supercool`; `killBonus` gains optional `bitsMul`; validator cases after `'structure'`; validator checks `apex` only on the six fusions.
- `src/sim/perks.ts`: fold `killBonus.bitsMul` at :531; Apex per-fusion ladder + weld pending in `refreshTiers` :223-240, `settleWeld` export; `tagCountsNow` cache in `refreshCrystal` :220; resonance multiplier on the declared `power` field in `perkProfile` :467; offer bias in `generateOffer` :109-150.
- `src/sim/crystal.ts`: `fusionLinkCounts` :173-189 filters both endpoints by largest-cluster membership (reuse `clusterCounts` BFS, expose `clusterMembers`); `autoSlot` :74 pair weight; blueprint lookup before `autoSlot` in `placeModule` :105. `src/sim/mutations.ts:32` signature unchanged.
- `src/sim/projectiles.ts:98-103`: cap the `how` product at `howCap` ×4; Marks and `bitsMul` multiply the `bits`/`energy` reward lines after the cap (:103); `HitSource` += `pylon|burst|beam`; pylon charge increment queued in `hitEnemy`; `lightning()` :126 reused for pylons; Supercooled adds to `lightningTargets` for the cast (no jump/decay semantics — those are projectile `bounces` :181-189).
- `src/sim/step.ts`: delete the `tesla` periodic (:31-38); `settleWeld`, Lattice + gene accumulators per tick; death branch (:86): Lattice multiplier, Deep Freeze → `w.bitsBonus` (so revive at commands.ts:86 refunds it); `updateStructures` handles pylons, bursts (scratch queue, Shatter pattern), beams.
- `src/sim/waves.ts`: `mutate` call :43 reads the gene mean; wave end (`payWaveRewards` :171-180, then `payStations`) resets `geneAcc`, pays vault repayment, dividend, sweeps `frost`; `updateNests` :146 plants nodes on reclaim.
- `src/sim/enemies.ts:18-24` `slowFactor`: frost term from sparse `w.frost: Record<string, number>` (cellId → untilTick, written at lightning target cells only), under `slowCap`. One map read per enemy; `enemies.test.ts` coverage.
- `src/sim/state.ts`: beside `fusionTiers` (:97) add **in phase 1, all at once**: `fusionPending`, `latticeSum`, `latticeTicks`, `geneAcc`, `tagCountsNow`, `frost`, `blueprint`, `marks`; `Enemy.marked`; snapshot migration with defaults (one golden re-record).
- `src/meta/runEnd.ts:29 settleRun`: Codex Bits from `RunResult.fusionsReached` (new field); meta save gains `codex`, `blueprints` (+migration). Widget (`src/render/widget.ts`) uses the blueprint fill.
- Tools (**new work**, phase 0): `arrange` policy in *both* `tools/sim/bot.ts` and `tools/sim/progressionPlayer.ts` (hill-climb over `movePreview` after each pick, scored from `bot.json`) and `fusion-pick`; `balance.ts` gains `--crystal auto|arrange` with per-fusion columns (% runs at I–IV, DPS/Energy/Bits share by source); `tools/sim/crystalGeometry.ts` enumerates one-cluster-per-tag layouts on rings 2–4 and reports max adjacent pairs and Apex count per module budget.

## Balance targets + how to measure
- **Crystal premium**: `arrange+fusion-pick` vs `autoSlot` at wave 50: +15–25 % median wave, **+25–40 % run Bits** (Lattice ≤ +22 %, fusion payouts ≤ +15 %, joint cap +35 % before labs `bitsMul` and the ×2 ad at runEnd.ts:31); AUTO + blueprint lands about halfway.
- Per fusion at III (`--override`): ≤ 15 % of kills from its new source, ≤ +20 % Energy per wave, ≤ +10 % run Bits; no Keys from fusions; Codex one-off Bits counted separately.
- Gates: B2 greedy median 4–6 (tier I mostly economy); B6 tags ≤ 1.2× after the data fix, new **B6-pairs** ≤ 1.25× with each pair forced to III; B4 `sim:progression --players 20 --hours 150 --endless --crystal arrange`: casual within ±5 % of `reports/progression.md`, active (`balanced + ads`, today T6 at 33.5 h) ≤ 15 % faster; `latticeCoef` is fixed only after this run; B7 run length per phase.
- Geometry: `crystalGeometry.ts` confirms ≤ 9 adjacent pairs under cluster-scoped links and reports the module count for the first Apex; Apex is tuned on wave-80+ runs only.

## Implementation phases (each shippable; 0–2 committed, 3–7 re-decided after telemetry)
0. **Measure + data fixes**: `arrange`/`fusion-pick` in bot.ts and progressionPlayer.ts, `--crystal` columns, `crystalGeometry.ts`, `howCap`, delete `freezeSeconds ×1.5`, freezeAll clamp, B6 set lines.
1. **Crystal rules + chips**: cluster-scoped links, Apex ladder, Weld + `settleWeld`, Lattice, gene averaging, pair-aware auto; **all World keys with defaults** + snapshot migration (one re-record); editor chips, target glow, Lattice chip; tests (weld rises after exactly `weldTicks` and resets on link change, Lattice tick average, Apex gate incl. firewall pairs at 7 links, planarity bound, gene mean).
2. **Bounty Marks + pick badges + Codex** (first Bits fusion; meta `codex` migration). Telemetry checkpoint.
3. **Tesla Pylons + Shatter** (`shape.tips`, `lightning()`, queued burst pattern).
4. **Cryo Vault + Relay Nodes** (`payStations` pattern, `updateNests`); `sim:progression` run.
5. **Frost Web + Supercooled** (sparse `frost`, `slowFactor`).
6. **Blueprint (World copy) + offer bias + widget fill + run-end block**.
7. **Resonance, 6-set hooks, synergies, balance pass**, golden re-record.
Cost: ~3–4 weeks in total (6 object kinds, 4 rules, 2 bots, Blueprint, Codex, migrations); phases 0–2 ≈ 1 week.

## Risks
- `how` blow-up (crit × frozen × chain): `howCap` ×4 in data; Marks sit outside the cap. Burst cascades: depth ≤ 2, ≤ 8 per tick, queued.
- Freeze lock: `freezeSeconds` line removed, ≤ 0.6 × period clamp, 1 s refreeze immunity.
- Bits inflation: Lattice multiplied again by labs and the ad ⇒ coefficient gated on B4 with the `arrange` player; jackpot caps, Codex one-off.
- Phone clutter: render budget above, `npm run ui` both orientations per phase.
- Hot loops: own scratch arrays, no nested `kNearest`, frost term one map read per enemy, beams ≤ 7 segments at 2 Hz.
- Gene dodging by spread builds: tick mean closes the split trick; if the premium overshoots, a "patch" gene from wave 40 cuts the highest-tier fusion −10 % (max 3).
- Cluster-scoped links change today's link counts for players with stray modules: announce once on Home; Lattice chip explains the new count.
- Weld makes III later for auto players (intended); Apex is a late-game goal, not a wave-50 lever.
- Golden replay: one re-record in phase 1 (all keys), one in 6 (offer bias), one in 7.

## Owner decisions (2026-10-16)
1. No bandwidth budget in v1 (default kept).
2. **Fusions pay Bits only — no Keys** (Marks/Nodes/Codex rewards converted to Bits above).
3. Premium target **+25–40 % run Bits** over AUTO (Lattice 0.015); raise only if B4 with the `arrange` player allows.
4. Apex gate: **7 cluster links and both tags at set ≥ 4**.
5. Scope now: **phases 0–2** (measure + data fixes, crystal rules + chips, Bounty Marks + pick badges + Codex); phases 3–7 re-decided after the numbers.

## Review notes
Applied: 1 (per-fusion `apex`, global ladder unchanged), 2 (tick accumulators for Lattice and genes, cached `tagCountsNow`), 3 (cluster-scoped links; the "drop the claim" alternative rejected because the bound is the main geometric trade-off), 4 (`settleWeld` in `step()`), 5 (bots, `--crystal`, `crystalGeometry.ts` named as new work), 6 (default +25–40 %, joint +35 % cap, B4 with `arrange` before fixing the coefficient; the +40–60 % the owner asked for stays as a measured upgrade in open decision 3), 7 (Keys +2/run, Codex 10; "Bits only" kept as alternative, not default — Keys are the progression hook that makes the crystal worth sitting with), 8 (Deep Freeze in the step.ts death branch via `bitsBonus`; Codex via `RunResult.fusionsReached`), 9 (boss Mark ×2, Marks outside `how`), 10 (`lightningTargets +2`, sparse frost at target cells), 11 (bonus only when 1 link short, ∝ tier), 12 (one `power` field per fusion), 13 (blueprint copied into World), 14 (render budget), 15 (queue order stated), 16 (keys in phase 1, phases 0–2 first, 3–4 weeks), 17 (Apex as late-game goal). Nothing rejected outright.

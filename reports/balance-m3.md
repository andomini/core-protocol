# Balance report — M3 (protocols, tags, sets; first run)

Seeds 1–48 per policy · tier 1 · no workshop · starred stats locked · no cards · 69.0 s · `npm run sim:balance`

## B1: first protocol pick ≤ 30 s after loading — **PASS**

The wave-1 pick opens the run at sim time 0 s (tick 0, before any spawn) in every run. The wall-clock time from page load to the visible overlay is measured by `npm run ui` (`reports/ui-smoke.json`, `*.firstPickMs`).

## B2: first run (no workshop) dies at waves 4–6 — **PASS**

greedy + greedy-pick: median wave 6 at 2.8 sim-min; no upgrades (none + greedy-pick): median wave 3.

## B5: ≥ 80 % of first runs reach a 2-set; median 2-set by wave 10 — **PASS**

| policy | runs with a 2-set | median wave of the first 2-set | |
|---|---|---|---|
| greedy + greedy-pick | 100 % | 1 | ok |
| greedy + random-pick | 100 % | 1 | ok |
| greedy + first | 100 % | 1 | ok |

The wave of a 2-set is the wave whose end opened the pick that completed it (the wave-1 pick counts as wave 1).

## B6: no dominant tag — tag bots' median waves within ±20 % — **PASS**

Medians: overload 6 · cryo 6 · chain 6 · mining 6 · firewall 6. max/min = 6.0/6.0 = 1.00 (≤ 1.20 required); every tag within ±20 % of the mean 6.0: yes.

Tag bots (greedy buys + tag:<t> picks) place their modules on the best free hex and hill-climb the crystal after each pick (`--crystal arrange`, the default).

Share of tag-bot runs that reached their own 2-set: overload 65 % · cryo 65 % · chain 58 % · mining 65 % · firewall 56 %.

## B7: Ice Wall (spec 2026-10-15, phase 1) — report only

Runs whose auto-placed crystal reached cryo+firewall tier I+ (greedy + greedy-pick): 0 %. Median wave with / without the wall: — / 6 (48 runs). Wall absorbed (median share of virus damage that hit a segment, walled runs): —; the same for the tag:cryo and tag:firewall bots: — / 36 % (1/48 runs).

## B8: Bastion and Minefield (spec 2026-10-15, phase 2) — report only

Turret + mine share, greedy + greedy-pick: 3 % of kills (target ≤ 25 % at III), Minefield 2 % of kill Energy (1/48 runs). The tag:overload / tag:chain / tag:firewall bots: — / — / 6 % of kills (target ≤ 25 % at III), Minefield 6 % of kill Energy (2/48 runs).

## B9: Relay Stations (spec 2026-10-15, phase 3) — report only

Station share of Energy income (stations / kills + stations; target ≤ 20 % at III), greedy + greedy-pick: —. The tag:mining / tag:firewall bots: — / 1 % (2/48 runs).

Decoy share (damage the stations soaked / core + wall + stations), greedy + greedy-pick: 2 % (1/48 runs). The tag:mining / tag:firewall bots: 5 % (1/48 runs) / 6 % (2/48 runs).

## Crystal fusions (spec 2026-10-16 phase 0) — report only

Share of runs that reached each fusion tier at any moment (tiers = links 1 / 3 / 5); auto = autoSlot placement, arr = fusion-pick + hill-climb arrangement. Median wave 6 (auto) vs 6 (arrange); median in-run Bits at death 81.6 vs 83.0; median picks 1 vs 1.

| fusion | auto I | auto II | auto III | arr I | arr II | arr III |
|---|---|---|---|---|---|---|
| Thermal Shock (overload+cryo) | 4 % | 0 % | 0 % | 8 % | 4 % | 0 % |
| Overcharge (overload+chain) | 2 % | 0 % | 0 % | 10 % | 8 % | 0 % |
| Bounty Marks (overload+mining) | 4 % | 0 % | 0 % | 10 % | 8 % | 0 % |
| Bastion (overload+firewall) | 0 % | 0 % | 0 % | 2 % | 0 % | 0 % |
| Superconductor (cryo+chain) | 4 % | 0 % | 0 % | 17 % | 13 % | 0 % |
| Cold Storage (cryo+mining) | 2 % | 0 % | 0 % | 13 % | 10 % | 0 % |
| Ice Wall (cryo+firewall) | 0 % | 0 % | 0 % | 4 % | 2 % | 0 % |
| Network (chain+mining) | 2 % | 0 % | 0 % | 13 % | 10 % | 0 % |
| Minefield (chain+firewall) | 2 % | 0 % | 0 % | 2 % | 2 % | 0 % |
| Relay Stations (mining+firewall) | 2 % | 0 % | 0 % | 8 % | 4 % | 0 % |

- **Kill Energy / Bits by killing-hit source, greedy + greedy-pick** (median share per run): shot 97 % E / 97 % B
- **Kill Energy / Bits by killing-hit source, greedy + fusion-pick (arrange)** (median share per run): shot 98 % E / 98 % B

## All policies

| policy (buy + pick) | median wave | wave range | median min | picks | 2-set | median 2-set wave | 4-set | levels bought | alive at 60 min | wall absorbed |
|---|---|---|---|---|---|---|---|---|---|---|
| none + greedy-pick | 3 | 3–4 | 1.4 | 0 | 100 % | 1 | 0 % | 0 | 0 | — |
| greedy + greedy-pick | 6 | 3–11 | 2.8 | 1 | 100 % | 1 | 44 % | 25 | 0 | — |
| atk-first + greedy-pick | 6 | 3–10 | 2.9 | 1 | 100 % | 1 | 54 % | 23 | 0 | 30 % (1/48 runs) |
| def-first + greedy-pick | 4 | 3–5 | 1.8 | 0 | 100 % | 1 | 2 % | 12 | 0 | — |
| round-robin + greedy-pick | 4 | 3–6 | 1.8 | 0 | 100 % | 1 | 2 % | 11 | 0 | — |
| greedy + random-pick | 6 | 3–10 | 2.7 | 1 | 100 % | 1 | 31 % | 26 | 0 | 22 % (2/48 runs) |
| greedy + first | 6 | 3–11 | 2.9 | 1 | 100 % | 1 | 33 % | 27 | 0 | 30 % (2/48 runs) |
| greedy + tag:overload | 6 | 3–29 | 2.9 | 1 | 100 % | 1 | 50 % | 27 | 0 | — |
| greedy + tag:cryo | 6 | 3–11 | 2.8 | 1 | 100 % | 1 | 48 % | 25 | 0 | — |
| greedy + tag:chain | 6 | 3–27 | 2.8 | 1 | 100 % | 1 | 46 % | 25 | 0 | — |
| greedy + tag:mining | 6 | 3–10 | 2.8 | 1 | 100 % | 1 | 46 % | 30 | 0 | — |
| greedy + tag:firewall | 6 | 3–10 | 2.8 | 1 | 100 % | 1 | 33 % | 24 | 0 | 36 % (1/48 runs) |
| greedy, no protocols (M2b) | 5 | 3–8 | 2.1 | 0 | — | — | — | 17 | 0 | — |
| greedy + fusion-pick (arrange) | 6 | 3–11 | 2.8 | 1 | 100 % | 1 | 0 % | 26 | 0 | 24 % (1/48 runs) |

Bot "useful" stats (tools/sim/bot.json): damage, attackSpeed, critChance, critFactor, range, multishot, health, regen, defense, thorns, lifesteal, knockback, energyBonus, energyPerWave, interest, freeUpgrade. Tab weights: {"greedy":{"atk":1,"def":1,"util":1},"atk-first":{"atk":4,"def":1,"util":1},"def-first":{"atk":1,"def":4,"util":1}}. BUILD rows (bought once their structure stands, taking the weight of the tab they map to): {"turretDamage":"atk","turretSpeed":"atk","mineDamage":"atk","structHealth":"def","structRegen":"def","stationIncome":"util"}.
Pick policies: `greedy-pick` = highest rarity, then a held tag; `random-pick` = uniform; `first` = the first card; `tag:<t>` = the best card of tag t when offered, else greedy-pick.

## Perks held at death (share of runs)

- **greedy + greedy-pick:** permafrost 27 % · overclockRounds 23 % · burstFire 23 % · critSpike 23 % · frostShot 23 % · coldAura 23 % · bounty 21 % · conductive 19 % · energySiphon 19 % · dataMine 19 % · patch 19 % · hardening 19 % · reflect 19 % · bounce 17 % · arc 17 % · hotBarrel 15 % · glassCannon 4 % · overchargeLink 4 % · greedyProtocol 2 %
- **greedy + random-pick:** frostShot 27 % · critSpike 25 % · coldAura 25 % · overclockRounds 23 % · burstFire 23 % · permafrost 23 % · hardening 23 % · bounce 21 % · arc 21 % · bounty 21 % · reflect 21 % · energySiphon 19 % · dataMine 19 % · patch 19 % · conductive 17 % · hotBarrel 4 % · shatter 2 %
- **greedy + tag:overload:** overclockRounds 65 % · burstFire 65 % · critSpike 65 % · hotBarrel 21 % · patch 15 % · hardening 15 % · reflect 15 % · bounce 13 % · arc 13 % · conductive 13 % · bounty 10 % · energySiphon 6 % · dataMine 6 % · glassCannon 4 % · frostShot 4 % · coldAura 4 % · permafrost 4 % · greedyProtocol 4 %
- **greedy + tag:cryo:** frostShot 71 % · coldAura 65 % · permafrost 63 % · bounce 17 % · arc 17 % · conductive 17 % · energySiphon 10 % · bounty 10 % · dataMine 10 % · overclockRounds 6 % · burstFire 6 % · critSpike 6 % · shatter 6 % · glassCannon 4 % · patch 4 % · hardening 4 % · reflect 4 % · overchargeLink 2 % · greedyProtocol 2 %
- **greedy + tag:chain:** conductive 65 % · bounce 60 % · arc 60 % · bounty 15 % · overclockRounds 13 % · burstFire 13 % · critSpike 13 % · energySiphon 13 % · dataMine 13 % · patch 10 % · hardening 10 % · reflect 10 % · frostShot 6 % · coldAura 6 % · permafrost 6 % · hotBarrel 4 % · glassCannon 2 % · shatter 2 % · greedyProtocol 2 %
- **greedy + tag:mining:** bounty 71 % · energySiphon 67 % · dataMine 63 % · patch 17 % · hardening 17 % · reflect 17 % · conductive 10 % · bounce 8 % · arc 8 % · overclockRounds 6 % · burstFire 6 % · critSpike 6 % · frostShot 6 % · coldAura 6 % · permafrost 6 % · glassCannon 2 %
- **greedy + tag:firewall:** hardening 63 % · reflect 58 % · patch 56 % · bounce 17 % · arc 17 % · conductive 17 % · burstFire 15 % · overclockRounds 13 % · critSpike 13 % · bounty 10 % · frostShot 8 % · coldAura 8 % · permafrost 8 % · energySiphon 8 % · dataMine 8 % · hotBarrel 4 % · glassCannon 2 %

## Fusions held at death (auto placement; share of runs at tier I+, II+)

- **greedy + greedy-pick:** Thermal Shock 4 % · Bounty Marks 4 % · Superconductor 4 % · Overcharge 2 % · Cold Storage 2 % · Network 2 % · Minefield 2 % · Relay Stations 2 %
- **greedy + random-pick:** Overcharge 6 % · Thermal Shock 4 % · Cold Storage 4 % · Ice Wall 4 % · Relay Stations 4 % · Superconductor 2 % · Network 2 %
- **greedy + tag:overload:** Network 4 % (II+ 4 %) · Overcharge 2 % (II+ 2 %) · Bounty Marks 2 % (II+ 2 %) · Bastion 2 % (II+ 2 %) · Relay Stations 2 % (II+ 2 %)
- **greedy + tag:cryo:** Superconductor 8 % (II+ 8 %) · Thermal Shock 6 % (II+ 4 %) · Overcharge 2 % (II+ 2 %) · Bounty Marks 2 % (II+ 2 %) · Cold Storage 2 % · Network 2 % (II+ 2 %)
- **greedy + tag:chain:** Overcharge 4 % (II+ 4 %) · Bounty Marks 4 % (II+ 4 %) · Superconductor 4 % (II+ 2 %) · Network 4 % (II+ 2 %) · Thermal Shock 2 % · Cold Storage 2 %
- **greedy + tag:mining:** Cold Storage 4 % (II+ 4 %) · Bounty Marks 2 % (II+ 2 %) · Network 2 % (II+ 2 %) · Minefield 2 % (II+ 2 %) · Relay Stations 2 % (II+ 2 %)
- **greedy + tag:firewall:** Bastion 6 % (II+ 6 %) · Relay Stations 4 % (II+ 4 %) · Overcharge 2 % (II+ 2 %) · Ice Wall 2 % (II+ 2 %) · Network 2 % (II+ 2 %) · Minefield 2 % (II+ 2 %)

## Median levels at death

- **greedy + greedy-pick:** damage 7 · attackSpeed 3 · critChance 1 · critFactor 1 · range 0 · multishot 0 · health 7 · regen 5 · defense 1 · thorns 0 · lifesteal 0 · knockback 0 · energyBonus 0 · energyPerWave 0 · interest 0 · bitsPerKill 0 · bitsPerWave 0 · freeUpgrade 0 · structHealth 0 · structRegen 0 · turretDamage 0 · turretSpeed 0 · mineDamage 0 · stationIncome 0
- **greedy + tag:overload:** damage 7 · attackSpeed 3 · critChance 1 · critFactor 1 · range 0 · multishot 0 · health 7 · regen 5 · defense 1 · thorns 1 · lifesteal 0 · knockback 1 · energyBonus 0 · energyPerWave 0 · interest 0 · bitsPerKill 0 · bitsPerWave 0 · freeUpgrade 0 · structHealth 0 · structRegen 0 · turretDamage 0 · turretSpeed 0 · mineDamage 0 · stationIncome 0
- **greedy + tag:cryo:** damage 7 · attackSpeed 3 · critChance 1 · critFactor 1 · range 0 · multishot 0 · health 7 · regen 5 · defense 1 · thorns 0 · lifesteal 0 · knockback 0 · energyBonus 0 · energyPerWave 0 · interest 0 · bitsPerKill 0 · bitsPerWave 0 · freeUpgrade 0 · structHealth 0 · structRegen 0 · turretDamage 0 · turretSpeed 0 · mineDamage 0 · stationIncome 0
- **greedy + tag:chain:** damage 7 · attackSpeed 3 · critChance 1 · critFactor 1 · range 0 · multishot 0 · health 7 · regen 5 · defense 1 · thorns 0 · lifesteal 0 · knockback 0 · energyBonus 0 · energyPerWave 0 · interest 0 · bitsPerKill 0 · bitsPerWave 0 · freeUpgrade 0 · structHealth 0 · structRegen 0 · turretDamage 0 · turretSpeed 0 · mineDamage 0 · stationIncome 0
- **greedy + tag:mining:** damage 7 · attackSpeed 4 · critChance 1 · critFactor 1 · range 0 · multishot 0 · health 7 · regen 5 · defense 1 · thorns 1 · lifesteal 0 · knockback 1 · energyBonus 1 · energyPerWave 1 · interest 0 · bitsPerKill 0 · bitsPerWave 0 · freeUpgrade 0 · structHealth 0 · structRegen 0 · turretDamage 0 · turretSpeed 0 · mineDamage 0 · stationIncome 0
- **greedy + tag:firewall:** damage 7 · attackSpeed 3 · critChance 1 · critFactor 1 · range 0 · multishot 0 · health 7 · regen 5 · defense 0 · thorns 0 · lifesteal 0 · knockback 0 · energyBonus 0 · energyPerWave 0 · interest 0 · bitsPerKill 0 · bitsPerWave 0 · freeUpgrade 0 · structHealth 0 · structRegen 0 · turretDamage 0 · turretSpeed 0 · mineDamage 0 · stationIncome 0

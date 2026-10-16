# Balance report — M3 (protocols, tags, sets; first run)

Seeds 1–24 per policy · tier 1 · no workshop · starred stats locked · no cards · 37.2 s · `npm run sim:balance`

## B1: first protocol pick ≤ 30 s after loading — **PASS**

The wave-1 pick opens the run at sim time 0 s (tick 0, before any spawn) in every run. The wall-clock time from page load to the visible overlay is measured by `npm run ui` (`reports/ui-smoke.json`, `*.firstPickMs`).

## B2: first run (no workshop) dies at waves 4–6 — **FAIL**

greedy + greedy-pick: median wave 7 at 3.2 sim-min; no upgrades (none + greedy-pick): median wave 3.

## B5: ≥ 80 % of first runs reach a 2-set; median 2-set by wave 10 — **PASS**

| policy | runs with a 2-set | median wave of the first 2-set | |
|---|---|---|---|
| greedy + greedy-pick | 100 % | 2 | ok |
| greedy + random-pick | 88 % | 3 | ok |
| greedy + first | 79 % | 3 | miss |

The wave of a 2-set is the wave whose end opened the pick that completed it (the wave-1 pick counts as wave 1).

## B6: no dominant tag — tag bots' median waves within ±20 % — **FAIL**

Medians: overload 8 · cryo 6 · chain 5 · mining 5 · firewall 5. max/min = 8.0/5.0 = 1.60 (≤ 1.20 required); every tag within ±20 % of the mean 5.8: no.

Share of tag-bot runs that reached their own 2-set: overload 71 % · cryo 75 % · chain 71 % · mining 75 % · firewall 75 %.

## B7: Ice Wall (spec 2026-10-15, phase 1) — report only

Runs whose auto-placed crystal reached cryo+firewall tier I+ (greedy + greedy-pick): 8 %. Median wave with / without the wall: 5 (2 runs) / 7 (22 runs). Wall absorbed (median share of virus damage that hit a segment, walled runs): 30 % (2/24 runs); the same for the tag:cryo and tag:firewall bots: 30 % (2/24 runs) / 30 % (5/24 runs).

## B8: Bastion and Minefield (spec 2026-10-15, phase 2) — report only

Turret + mine share, greedy + greedy-pick: —. The tag:overload / tag:chain / tag:firewall bots: — / — / 1 % of kills (target ≤ 25 % at III), Minefield 0 % of kill Energy (3/24 runs).

## B9: Relay Stations (spec 2026-10-15, phase 3) — report only

Station share of Energy income (stations / kills + stations; target ≤ 20 % at III), greedy + greedy-pick: —. The tag:mining / tag:firewall bots: 5 % (1/24 runs) / 1 % (3/24 runs).

Decoy share (damage the stations soaked / core + wall + stations), greedy + greedy-pick: —. The tag:mining / tag:firewall bots: — / 5 % (5/24 runs).

## Crystal fusions (spec 2026-10-16 phase 0) — report only

Share of runs that reached each fusion tier at any moment (tiers = links 1 / 3 / 5); auto = autoSlot placement, arr = fusion-pick + hill-climb arrangement. Run with `--crystal arrange` to add the arrange + fusion-pick player.

| fusion | auto I | auto II | auto III |
|---|---|---|---|
| Thermal Shock (overload+cryo) | 17 % | 0 % | 0 % |
| Overcharge (overload+chain) | 8 % | 0 % | 0 % |
| Bounty Marks (overload+mining) | 17 % | 0 % | 0 % |
| Bastion (overload+firewall) | 0 % | 0 % | 0 % |
| Superconductor (cryo+chain) | 8 % | 0 % | 0 % |
| Cold Storage (cryo+mining) | 29 % | 0 % | 0 % |
| Ice Wall (cryo+firewall) | 8 % | 0 % | 0 % |
| Network (chain+mining) | 8 % | 0 % | 0 % |
| Minefield (chain+firewall) | 4 % | 0 % | 0 % |
| Relay Stations (mining+firewall) | 0 % | 0 % | 0 % |

- **Kill Energy / Bits by killing-hit source, greedy + greedy-pick** (median share per run): shot 96 % E / 98 % B · thorns 1 % E / 1 % B

## All policies

| policy (buy + pick) | median wave | wave range | median min | picks | 2-set | median 2-set wave | 4-set | levels bought | alive at 60 min | wall absorbed |
|---|---|---|---|---|---|---|---|---|---|---|
| none + greedy-pick | 3 | 3–5 | 1.4 | 2 | 79 % | 2 | 0 % | 0 | 0 | 21 % (2/24 runs) |
| greedy + greedy-pick | 7 | 3–25 | 3.2 | 4 | 100 % | 2 | 29 % | 33 | 0 | 30 % (2/24 runs) |
| atk-first + greedy-pick | 7 | 3–29 | 3.1 | 4 | 96 % | 2 | 42 % | 28 | 0 | 46 % (2/24 runs) |
| def-first + greedy-pick | 4 | 3–6 | 1.6 | 3 | 88 % | 2 | 0 % | 10 | 0 | 20 % (2/24 runs) |
| round-robin + greedy-pick | 4 | 3–6 | 1.6 | 3 | 83 % | 2 | 0 % | 8 | 0 | 22 % (2/24 runs) |
| greedy + random-pick | 6 | 3–18 | 2.9 | 4 | 88 % | 3 | 8 % | 33 | 0 | 37 % (3/24 runs) |
| greedy + first | 5 | 3–24 | 2.5 | 4 | 79 % | 2 | 21 % | 24 | 0 | 40 % (6/24 runs) |
| greedy + tag:overload | 8 | 3–35 | 3.8 | 4 | 96 % | 2 | 46 % | 41 | 0 | — |
| greedy + tag:cryo | 6 | 3–12 | 2.9 | 4 | 100 % | 2 | 50 % | 27 | 0 | 30 % (2/24 runs) |
| greedy + tag:chain | 5 | 3–12 | 2.5 | 4 | 96 % | 2 | 25 % | 24 | 0 | 30 % (1/24 runs) |
| greedy + tag:mining | 5 | 3–12 | 2.5 | 4 | 100 % | 2 | 17 % | 29 | 0 | — |
| greedy + tag:firewall | 5 | 3–34 | 2.4 | 3 | 96 % | 2 | 17 % | 20 | 0 | 30 % (5/24 runs) |
| greedy, no protocols (M2b) | 5 | 3–7 | 2.3 | 0 | — | — | — | 19 | 0 | — |

Bot "useful" stats (tools/sim/bot.json): damage, attackSpeed, critChance, critFactor, range, multishot, health, regen, defense, thorns, lifesteal, knockback, energyBonus, energyPerWave, interest, freeUpgrade. Tab weights: {"greedy":{"atk":1,"def":1,"util":1},"atk-first":{"atk":4,"def":1,"util":1},"def-first":{"atk":1,"def":4,"util":1}}. BUILD rows (bought once their structure stands, taking the weight of the tab they map to): {"turretDamage":"atk","turretSpeed":"atk","mineDamage":"atk","structHealth":"def","structRegen":"def","stationIncome":"util"}.
Pick policies: `greedy-pick` = highest rarity, then a held tag; `random-pick` = uniform; `first` = the first card; `tag:<t>` = the best card of tag t when offered, else greedy-pick.

## Perks held at death (share of runs)

- **greedy + greedy-pick:** shatter 42 % · permafrost 33 % · conductive 33 % · bounty 33 % · hotBarrel 29 % · frostShot 21 % · greedyProtocol 21 % · coldAura 17 % · dataMine 17 % · burstFire 13 % · glassCannon 13 % · overchargeLink 13 % · overclockRounds 8 % · critSpike 8 % · hardening 8 % · deepFreeze 4 % · bounce 4 % · arc 4 % · energySiphon 4 % · reflect 4 % · bunker 4 %
- **greedy + random-pick:** hardening 33 % · dataMine 29 % · coldAura 25 % · energySiphon 25 % · overclockRounds 21 % · critSpike 21 % · frostShot 21 % · bounce 21 % · burstFire 17 % · hotBarrel 17 % · shatter 17 % · reflect 17 % · permafrost 13 % · bounty 13 % · patch 13 % · deepFreeze 8 % · arc 8 % · greedyProtocol 8 % · glassCannon 4 % · conductive 4 % · overchargeLink 4 %
- **greedy + tag:overload:** burstFire 58 % · overclockRounds 54 % · critSpike 50 % · hotBarrel 42 % · bounty 25 % · permafrost 21 % · shatter 17 % · glassCannon 13 % · frostShot 13 % · coldAura 8 % · conductive 8 % · greedyProtocol 8 % · bounce 4 % · overchargeLink 4 % · energySiphon 4 % · dataMine 4 % · hardening 4 %
- **greedy + tag:cryo:** frostShot 67 % · coldAura 50 % · shatter 46 % · permafrost 33 % · deepFreeze 17 % · hotBarrel 13 % · conductive 13 % · bounty 13 % · energySiphon 8 % · dataMine 8 % · hardening 8 % · overclockRounds 4 % · burstFire 4 % · glassCannon 4 % · bounce 4 % · overchargeLink 4 % · greedyProtocol 4 % · reflect 4 %
- **greedy + tag:chain:** arc 58 % · bounce 42 % · conductive 42 % · overchargeLink 29 % · shatter 17 % · permafrost 17 % · greedyProtocol 17 % · hotBarrel 13 % · bounty 13 % · frostShot 8 % · coldAura 8 % · overclockRounds 4 % · burstFire 4 % · glassCannon 4 % · deepFreeze 4 % · dataMine 4 % · hardening 4 %
- **greedy + tag:mining:** dataMine 58 % · energySiphon 54 % · bounty 46 % · conductive 21 % · hotBarrel 17 % · greedyProtocol 17 % · frostShot 13 % · permafrost 13 % · coldAura 8 % · shatter 8 % · overchargeLink 8 % · burstFire 4 % · critSpike 4 % · glassCannon 4 % · hardening 4 % · reflect 4 %
- **greedy + tag:firewall:** patch 71 % · hardening 58 % · reflect 46 % · bounty 21 % · hotBarrel 13 % · shatter 13 % · permafrost 13 % · bunker 13 % · burstFire 8 % · glassCannon 8 % · frostShot 8 % · overclockRounds 4 % · coldAura 4 % · arc 4 % · conductive 4 % · dataMine 4 % · greedyProtocol 4 %

## Fusions held at death (auto placement; share of runs at tier I+, II+)

- **greedy + greedy-pick:** Cold Storage 29 % · Thermal Shock 17 % · Bounty Marks 17 % · Overcharge 8 % · Superconductor 8 % · Ice Wall 8 % · Network 8 % · Minefield 4 %
- **greedy + random-pick:** Thermal Shock 25 % (II+ 4 %) · Bounty Marks 25 % · Minefield 17 % · Relay Stations 17 % (II+ 4 %) · Overcharge 13 % · Cold Storage 13 % · Ice Wall 13 % · Bastion 8 % · Superconductor 8 % · Network 8 %
- **greedy + tag:overload:** Bounty Marks 21 % · Thermal Shock 17 % · Cold Storage 13 % · Minefield 4 %
- **greedy + tag:cryo:** Thermal Shock 13 % · Cold Storage 13 % · Ice Wall 8 % · Bounty Marks 4 % · Superconductor 4 % · Minefield 4 %
- **greedy + tag:chain:** Overcharge 17 % · Cold Storage 17 % · Network 17 % · Superconductor 13 % · Thermal Shock 4 % · Bounty Marks 4 % · Ice Wall 4 %
- **greedy + tag:mining:** Cold Storage 17 % · Bounty Marks 13 % · Network 13 % · Overcharge 8 % · Thermal Shock 4 % · Superconductor 4 % · Minefield 4 % · Relay Stations 4 %
- **greedy + tag:firewall:** Ice Wall 21 % · Relay Stations 21 % · Bastion 13 % (II+ 4 %) · Bounty Marks 8 % · Cold Storage 8 %

## Median levels at death

- **greedy + greedy-pick:** damage 7 · attackSpeed 4 · critChance 2 · critFactor 1 · range 0 · multishot 0 · health 7 · regen 6 · defense 2 · thorns 1 · lifesteal 0 · knockback 1 · energyBonus 1 · energyPerWave 1 · interest 0 · bitsPerKill 0 · bitsPerWave 0 · freeUpgrade 0 · structHealth 0 · structRegen 0 · turretDamage 0 · turretSpeed 0 · mineDamage 0 · stationIncome 0
- **greedy + tag:overload:** damage 8 · attackSpeed 5 · critChance 2 · critFactor 2 · range 1 · multishot 0 · health 7 · regen 6 · defense 2 · thorns 2 · lifesteal 0 · knockback 2 · energyBonus 2 · energyPerWave 2 · interest 0 · bitsPerKill 0 · bitsPerWave 0 · freeUpgrade 0 · structHealth 0 · structRegen 0 · turretDamage 0 · turretSpeed 0 · mineDamage 0 · stationIncome 0
- **greedy + tag:cryo:** damage 7 · attackSpeed 3 · critChance 1 · critFactor 1 · range 0 · multishot 0 · health 7 · regen 5 · defense 1 · thorns 1 · lifesteal 0 · knockback 1 · energyBonus 0 · energyPerWave 0 · interest 0 · bitsPerKill 0 · bitsPerWave 0 · freeUpgrade 0 · structHealth 0 · structRegen 0 · turretDamage 0 · turretSpeed 0 · mineDamage 0 · stationIncome 0
- **greedy + tag:chain:** damage 7 · attackSpeed 3 · critChance 1 · critFactor 1 · range 0 · multishot 0 · health 7 · regen 5 · defense 0 · thorns 0 · lifesteal 0 · knockback 0 · energyBonus 0 · energyPerWave 0 · interest 0 · bitsPerKill 0 · bitsPerWave 0 · freeUpgrade 0 · structHealth 0 · structRegen 0 · turretDamage 0 · turretSpeed 0 · mineDamage 0 · stationIncome 0
- **greedy + tag:mining:** damage 7 · attackSpeed 3 · critChance 1 · critFactor 1 · range 0 · multishot 0 · health 7 · regen 5 · defense 1 · thorns 1 · lifesteal 0 · knockback 1 · energyBonus 1 · energyPerWave 1 · interest 0 · bitsPerKill 0 · bitsPerWave 0 · freeUpgrade 0 · structHealth 0 · structRegen 0 · turretDamage 0 · turretSpeed 0 · mineDamage 0 · stationIncome 0
- **greedy + tag:firewall:** damage 7 · attackSpeed 3 · critChance 0 · critFactor 0 · range 0 · multishot 0 · health 6 · regen 4 · defense 0 · thorns 0 · lifesteal 0 · knockback 0 · energyBonus 0 · energyPerWave 0 · interest 0 · bitsPerKill 0 · bitsPerWave 0 · freeUpgrade 0 · structHealth 0 · structRegen 0 · turretDamage 0 · turretSpeed 0 · mineDamage 0 · stationIncome 0

# Balance report — M3 (protocols, tags, sets; first run)

Seeds 1–24 per policy · tier 1 · no workshop · starred stats locked · no cards · 32.3 s · `npm run sim:balance`

## B1: first protocol pick ≤ 30 s after loading — **PASS**

The wave-1 pick opens the run at sim time 0 s (tick 0, before any spawn) in every run. The wall-clock time from page load to the visible overlay is measured by `npm run ui` (`reports/ui-smoke.json`, `*.firstPickMs`).

## B2: first run (no workshop) dies at waves 4–6 — **PASS**

greedy + greedy-pick: median wave 6 at 2.9 sim-min; no upgrades (none + greedy-pick): median wave 3.

## B5: ≥ 80 % of first runs reach a 2-set; median 2-set by wave 10 — **PASS**

| policy | runs with a 2-set | median wave of the first 2-set | |
|---|---|---|---|
| greedy + greedy-pick | 100 % | 1 | ok |
| greedy + random-pick | 100 % | 1 | ok |
| greedy + first | 100 % | 1 | ok |

The wave of a 2-set is the wave whose end opened the pick that completed it (the wave-1 pick counts as wave 1).

## B6: no dominant tag — tag bots' median waves within ±20 % — **PASS**

Medians: overload 7 · cryo 6 · chain 6 · mining 6 · firewall 6. max/min = 7.0/6.0 = 1.17 (≤ 1.20 required); every tag within ±20 % of the mean 6.2: yes.

Share of tag-bot runs that reached their own 2-set: overload 67 % · cryo 71 % · chain 50 % · mining 67 % · firewall 54 %.

## B7: Ice Wall (spec 2026-10-15, phase 1) — report only

Runs whose auto-placed crystal reached cryo+firewall tier I+ (greedy + greedy-pick): 0 %. Median wave with / without the wall: — / 6 (24 runs). Wall absorbed (median share of virus damage that hit a segment, walled runs): —; the same for the tag:cryo and tag:firewall bots: — / —.

## B8: Bastion and Minefield (spec 2026-10-15, phase 2) — report only

Turret + mine share, greedy + greedy-pick: —. The tag:overload / tag:chain / tag:firewall bots: — / — / 1 % of kills (target ≤ 25 % at III), Minefield 0 % of kill Energy (1/24 runs).

## B9: Relay Stations (spec 2026-10-15, phase 3) — report only

Station share of Energy income (stations / kills + stations; target ≤ 20 % at III), greedy + greedy-pick: —. The tag:mining / tag:firewall bots: — / 1 % (1/24 runs).

Decoy share (damage the stations soaked / core + wall + stations), greedy + greedy-pick: 2 % (1/24 runs). The tag:mining / tag:firewall bots: 2 % (1/24 runs) / 2 % (1/24 runs).

## Crystal fusions (spec 2026-10-16 phase 0) — report only

Share of runs that reached each fusion tier at any moment (tiers = links 1 / 3 / 5); auto = autoSlot placement, arr = fusion-pick + hill-climb arrangement. Run with `--crystal arrange` to add the arrange + fusion-pick player.

| fusion | auto I | auto II | auto III |
|---|---|---|---|
| Thermal Shock (overload+cryo) | 8 % | 0 % | 0 % |
| Overcharge (overload+chain) | 0 % | 0 % | 0 % |
| Bounty Marks (overload+mining) | 4 % | 0 % | 0 % |
| Bastion (overload+firewall) | 0 % | 0 % | 0 % |
| Superconductor (cryo+chain) | 0 % | 0 % | 0 % |
| Cold Storage (cryo+mining) | 4 % | 0 % | 0 % |
| Ice Wall (cryo+firewall) | 0 % | 0 % | 0 % |
| Network (chain+mining) | 4 % | 0 % | 0 % |
| Minefield (chain+firewall) | 4 % | 0 % | 0 % |
| Relay Stations (mining+firewall) | 4 % | 0 % | 0 % |

- **Kill Energy / Bits by killing-hit source, greedy + greedy-pick** (median share per run): shot 96 % E / 96 % B · thorns 1 % E / 1 % B

## All policies

| policy (buy + pick) | median wave | wave range | median min | picks | 2-set | median 2-set wave | 4-set | levels bought | alive at 60 min | wall absorbed |
|---|---|---|---|---|---|---|---|---|---|---|
| none + greedy-pick | 3 | 3–4 | 1.4 | 0 | 100 % | 1 | 0 % | 0 | 0 | — |
| greedy + greedy-pick | 6 | 3–11 | 2.9 | 1 | 100 % | 1 | 46 % | 27 | 0 | — |
| atk-first + greedy-pick | 8 | 3–10 | 3.8 | 1 | 100 % | 1 | 71 % | 25 | 0 | 30 % (1/24 runs) |
| def-first + greedy-pick | 4 | 3–5 | 1.8 | 0 | 100 % | 1 | 4 % | 12 | 0 | — |
| round-robin + greedy-pick | 4 | 3–6 | 1.8 | 0 | 100 % | 1 | 13 % | 11 | 0 | — |
| greedy + random-pick | 6 | 3–10 | 2.8 | 1 | 100 % | 1 | 33 % | 27 | 0 | 22 % (2/24 runs) |
| greedy + first | 7 | 3–11 | 3.2 | 1 | 100 % | 1 | 38 % | 27 | 0 | 22 % (1/24 runs) |
| greedy + tag:overload | 7 | 3–10 | 3.5 | 1 | 100 % | 1 | 63 % | 29 | 0 | — |
| greedy + tag:cryo | 6 | 3–11 | 2.9 | 1 | 100 % | 1 | 46 % | 26 | 0 | — |
| greedy + tag:chain | 6 | 3–8 | 2.8 | 1 | 100 % | 1 | 38 % | 25 | 0 | — |
| greedy + tag:mining | 6 | 3–9 | 2.9 | 1 | 100 % | 1 | 54 % | 31 | 0 | — |
| greedy + tag:firewall | 6 | 3–9 | 2.9 | 1 | 100 % | 1 | 42 % | 27 | 0 | — |
| greedy, no protocols (M2b) | 5 | 3–7 | 2.2 | 0 | — | — | — | 17 | 0 | — |

Bot "useful" stats (tools/sim/bot.json): damage, attackSpeed, critChance, critFactor, range, multishot, health, regen, defense, thorns, lifesteal, knockback, energyBonus, energyPerWave, interest, freeUpgrade. Tab weights: {"greedy":{"atk":1,"def":1,"util":1},"atk-first":{"atk":4,"def":1,"util":1},"def-first":{"atk":1,"def":4,"util":1}}. BUILD rows (bought once their structure stands, taking the weight of the tab they map to): {"turretDamage":"atk","turretSpeed":"atk","mineDamage":"atk","structHealth":"def","structRegen":"def","stationIncome":"util"}.
Pick policies: `greedy-pick` = highest rarity, then a held tag; `random-pick` = uniform; `first` = the first card; `tag:<t>` = the best card of tag t when offered, else greedy-pick.

## Perks held at death (share of runs)

- **greedy + greedy-pick:** overclockRounds 25 % · burstFire 25 % · critSpike 25 % · permafrost 25 % · bounty 25 % · conductive 21 % · energySiphon 21 % · dataMine 21 % · patch 21 % · hardening 21 % · reflect 21 % · frostShot 17 % · coldAura 17 % · bounce 17 % · arc 17 % · hotBarrel 13 % · glassCannon 4 % · greedyProtocol 4 %
- **greedy + random-pick:** overclockRounds 25 % · burstFire 25 % · critSpike 25 % · bounce 25 % · hardening 25 % · reflect 25 % · frostShot 21 % · coldAura 21 % · arc 21 % · energySiphon 21 % · bounty 21 % · dataMine 21 % · patch 21 % · permafrost 17 % · conductive 17 % · hotBarrel 4 % · shatter 4 %
- **greedy + tag:overload:** critSpike 71 % · overclockRounds 67 % · burstFire 67 % · hotBarrel 25 % · bounce 17 % · arc 17 % · conductive 17 % · bounty 13 % · patch 13 % · hardening 13 % · reflect 13 % · energySiphon 4 % · dataMine 4 % · greedyProtocol 4 %
- **greedy + tag:cryo:** frostShot 75 % · coldAura 67 % · permafrost 63 % · bounce 17 % · arc 17 % · conductive 17 % · shatter 13 % · overclockRounds 8 % · burstFire 8 % · critSpike 8 % · energySiphon 8 % · bounty 8 % · dataMine 8 % · hotBarrel 4 % · glassCannon 4 % · greedyProtocol 4 % · patch 4 % · hardening 4 % · reflect 4 %
- **greedy + tag:chain:** conductive 58 % · bounce 54 % · arc 54 % · patch 17 % · hardening 17 % · reflect 17 % · overclockRounds 13 % · burstFire 13 % · critSpike 13 % · energySiphon 13 % · bounty 13 % · dataMine 13 % · frostShot 8 % · coldAura 8 % · permafrost 8 %
- **greedy + tag:mining:** bounty 71 % · dataMine 71 % · energySiphon 67 % · patch 17 % · hardening 17 % · reflect 17 % · conductive 13 % · bounce 8 % · arc 8 % · overclockRounds 4 % · burstFire 4 % · critSpike 4 % · frostShot 4 % · coldAura 4 % · permafrost 4 %
- **greedy + tag:firewall:** hardening 63 % · reflect 58 % · patch 54 % · overclockRounds 17 % · burstFire 17 % · critSpike 17 % · bounce 17 % · arc 17 % · conductive 17 % · bounty 13 % · energySiphon 8 % · dataMine 8 % · hotBarrel 4 % · frostShot 4 % · coldAura 4 % · permafrost 4 %

## Fusions held at death (auto placement; share of runs at tier I+, II+)

- **greedy + greedy-pick:** Thermal Shock 8 % · Bounty Marks 4 % · Cold Storage 4 % · Network 4 % · Minefield 4 % · Relay Stations 4 %
- **greedy + random-pick:** Overcharge 13 % · Ice Wall 8 % · Thermal Shock 4 % · Superconductor 4 %
- **greedy + tag:overload:** Network 8 % · Bastion 4 % · Relay Stations 4 %
- **greedy + tag:cryo:** Thermal Shock 13 % · Bounty Marks 4 % · Superconductor 4 % · Cold Storage 4 % · Network 4 %
- **greedy + tag:chain:** Overcharge 8 % · Superconductor 4 % · Network 4 %
- **greedy + tag:mining:** Bounty Marks 4 % · Minefield 4 % · Relay Stations 4 %
- **greedy + tag:firewall:** Bastion 8 % · Network 4 % · Relay Stations 4 %

## Median levels at death

- **greedy + greedy-pick:** damage 7 · attackSpeed 3 · critChance 1 · critFactor 1 · range 0 · multishot 0 · health 7 · regen 5 · defense 1 · thorns 1 · lifesteal 0 · knockback 0 · energyBonus 0 · energyPerWave 0 · interest 0 · bitsPerKill 0 · bitsPerWave 0 · freeUpgrade 0 · structHealth 0 · structRegen 0 · turretDamage 0 · turretSpeed 0 · mineDamage 0 · stationIncome 0
- **greedy + tag:overload:** damage 7 · attackSpeed 3 · critChance 1 · critFactor 1 · range 0 · multishot 0 · health 7 · regen 5 · defense 1 · thorns 1 · lifesteal 0 · knockback 1 · energyBonus 1 · energyPerWave 1 · interest 0 · bitsPerKill 0 · bitsPerWave 0 · freeUpgrade 0 · structHealth 0 · structRegen 0 · turretDamage 0 · turretSpeed 0 · mineDamage 0 · stationIncome 0
- **greedy + tag:cryo:** damage 7 · attackSpeed 3 · critChance 1 · critFactor 1 · range 0 · multishot 0 · health 7 · regen 5 · defense 1 · thorns 1 · lifesteal 0 · knockback 0 · energyBonus 0 · energyPerWave 0 · interest 0 · bitsPerKill 0 · bitsPerWave 0 · freeUpgrade 0 · structHealth 0 · structRegen 0 · turretDamage 0 · turretSpeed 0 · mineDamage 0 · stationIncome 0
- **greedy + tag:chain:** damage 7 · attackSpeed 3 · critChance 1 · critFactor 1 · range 0 · multishot 0 · health 7 · regen 5 · defense 1 · thorns 0 · lifesteal 0 · knockback 0 · energyBonus 0 · energyPerWave 0 · interest 0 · bitsPerKill 0 · bitsPerWave 0 · freeUpgrade 0 · structHealth 0 · structRegen 0 · turretDamage 0 · turretSpeed 0 · mineDamage 0 · stationIncome 0
- **greedy + tag:mining:** damage 7 · attackSpeed 4 · critChance 2 · critFactor 1 · range 0 · multishot 0 · health 7 · regen 5 · defense 1 · thorns 1 · lifesteal 0 · knockback 1 · energyBonus 1 · energyPerWave 1 · interest 0 · bitsPerKill 0 · bitsPerWave 0 · freeUpgrade 0 · structHealth 0 · structRegen 0 · turretDamage 0 · turretSpeed 0 · mineDamage 0 · stationIncome 0
- **greedy + tag:firewall:** damage 7 · attackSpeed 3 · critChance 1 · critFactor 1 · range 0 · multishot 0 · health 7 · regen 5 · defense 1 · thorns 1 · lifesteal 0 · knockback 1 · energyBonus 0 · energyPerWave 0 · interest 0 · bitsPerKill 0 · bitsPerWave 0 · freeUpgrade 0 · structHealth 0 · structRegen 0 · turretDamage 0 · turretSpeed 0 · mineDamage 0 · stationIncome 0

# Balance report — M3 (protocols, tags, sets; first run)

Seeds 1–24 per policy · tier 1 · no workshop · starred stats locked · no cards · 52.7 s · `npm run sim:balance`

## B1: first protocol pick ≤ 30 s after loading — **PASS**

The wave-1 pick opens the run at sim time 0 s (tick 0, before any spawn) in every run. The wall-clock time from page load to the visible overlay is measured by `npm run ui` (`reports/ui-smoke.json`, `*.firstPickMs`).

## B2: first run dies at waves 12–20 (≈6–10 min at ×1) — **PASS**

greedy + greedy-pick: median wave 20 at 9.9 sim-min; no upgrades (none + greedy-pick): median wave 7.

## B5: ≥ 80 % of first runs reach a 2-set; median 2-set by wave 10 — **PASS**

| policy | runs with a 2-set | median wave of the first 2-set | |
|---|---|---|---|
| greedy + greedy-pick | 100 % | 3 | ok |
| greedy + random-pick | 100 % | 5 | ok |
| greedy + first | 100 % | 5 | ok |

The wave of a 2-set is the wave whose end opened the pick that completed it (the wave-1 pick counts as wave 1).

## B6: no dominant tag — tag bots' median waves within ±20 % — **FAIL**

Medians: overload 27 · cryo 20 · chain 20 · mining 26 · firewall 32. max/min = 32.0/20.0 = 1.60 (≤ 1.20 required); every tag within ±20 % of the mean 25.0: no.

Share of tag-bot runs that reached their own 2-set: overload 88 % · cryo 96 % · chain 79 % · mining 96 % · firewall 92 %.

## All policies

| policy (buy + pick) | median wave | wave range | median min | picks | 2-set | median 2-set wave | 4-set | levels bought | alive at 60 min |
|---|---|---|---|---|---|---|---|---|---|
| none + greedy-pick | 7 | 6–8 | 3.3 | 3 | 96 % | 3 | 4 % | 0 | 0 |
| greedy + greedy-pick | 20 | 9–36 | 9.9 | 6 | 100 % | 3 | 71 % | 146 | 0 |
| atk-first + greedy-pick | 25 | 9–36 | 12.4 | 7 | 100 % | 3 | 79 % | 153 | 0 |
| def-first + greedy-pick | 8 | 7–10 | 3.9 | 3 | 100 % | 3 | 8 % | 23 | 0 |
| round-robin + greedy-pick | 8 | 6–32 | 3.9 | 4 | 96 % | 3 | 29 % | 31 | 0 |
| greedy + random-pick | 19 | 10–37 | 9.5 | 6 | 100 % | 5 | 38 % | 118 | 0 |
| greedy + first | 22 | 11–37 | 10.9 | 7 | 100 % | 5 | 38 % | 141 | 0 |
| greedy + tag:overload | 27 | 11–38 | 13.4 | 8 | 100 % | 3 | 88 % | 204 | 0 |
| greedy + tag:cryo | 20 | 9–32 | 9.9 | 6 | 100 % | 3 | 67 % | 134 | 0 |
| greedy + tag:chain | 20 | 9–44 | 9.9 | 7 | 100 % | 3 | 75 % | 141 | 0 |
| greedy + tag:mining | 26 | 11–36 | 12.6 | 8 | 100 % | 3 | 83 % | 238 | 0 |
| greedy + tag:firewall | 32 | 11–35 | 15.8 | 9 | 100 % | 3 | 67 % | 234 | 0 |
| greedy, no protocols (M2b) | 11 | 9–17 | 5.2 | 0 | — | — | — | 45 | 0 |

Bot "useful" stats (tools/sim/bot.json): damage, attackSpeed, critChance, critFactor, range, multishot, health, regen, defense, thorns, lifesteal, knockback, energyBonus, energyPerWave, interest, freeUpgrade. Tab weights: {"greedy":{"atk":1,"def":1,"util":1},"atk-first":{"atk":4,"def":1,"util":1},"def-first":{"atk":1,"def":4,"util":1}}.
Pick policies: `greedy-pick` = highest rarity, then a held tag; `random-pick` = uniform; `first` = the first card; `tag:<t>` = the best card of tag t when offered, else greedy-pick.

## Perks held at death (share of runs)

- **greedy + greedy-pick:** permafrost 58 % · shatter 50 % · bounty 46 % · hotBarrel 33 % · conductive 33 % · frostShot 29 % · greedyProtocol 29 % · coldAura 25 % · glassCannon 21 % · deepFreeze 21 % · dataMine 21 % · burstFire 17 % · overchargeLink 17 % · overclockRounds 13 % · critSpike 13 % · energySiphon 13 % · hardening 8 % · bounce 4 % · arc 4 % · patch 4 % · reflect 4 % · bunker 4 %
- **greedy + random-pick:** reflect 42 % · coldAura 38 % · dataMine 38 % · hardening 38 % · critSpike 33 % · patch 33 % · overclockRounds 29 % · frostShot 29 % · permafrost 29 % · bounce 29 % · energySiphon 29 % · burstFire 25 % · arc 21 % · hotBarrel 17 % · shatter 17 % · deepFreeze 17 % · conductive 17 % · bounty 13 % · greedyProtocol 13 % · overchargeLink 8 % · glassCannon 4 %
- **greedy + tag:overload:** critSpike 88 % · burstFire 75 % · overclockRounds 67 % · hotBarrel 67 % · glassCannon 33 % · bounty 33 % · shatter 25 % · permafrost 21 % · frostShot 13 % · conductive 13 % · coldAura 8 % · energySiphon 8 % · dataMine 8 % · greedyProtocol 8 % · deepFreeze 4 % · bounce 4 % · overchargeLink 4 % · hardening 4 %
- **greedy + tag:cryo:** frostShot 79 % · coldAura 79 % · permafrost 67 % · shatter 63 % · deepFreeze 33 % · conductive 17 % · hotBarrel 13 % · bounty 13 % · dataMine 13 % · energySiphon 8 % · hardening 8 % · overclockRounds 4 % · burstFire 4 % · glassCannon 4 % · bounce 4 % · overchargeLink 4 % · greedyProtocol 4 % · reflect 4 %
- **greedy + tag:chain:** arc 83 % · bounce 63 % · conductive 63 % · overchargeLink 42 % · shatter 21 % · permafrost 21 % · bounty 17 % · greedyProtocol 17 % · hotBarrel 13 % · frostShot 13 % · coldAura 13 % · glassCannon 8 % · deepFreeze 8 % · overclockRounds 4 % · burstFire 4 % · critSpike 4 % · energySiphon 4 % · dataMine 4 % · hardening 4 %
- **greedy + tag:mining:** energySiphon 79 % · bounty 75 % · dataMine 71 % · greedyProtocol 38 % · conductive 25 % · hotBarrel 21 % · permafrost 17 % · frostShot 13 % · overclockRounds 8 % · burstFire 8 % · glassCannon 8 % · coldAura 8 % · shatter 8 % · overchargeLink 8 % · critSpike 4 % · hardening 4 % · reflect 4 %
- **greedy + tag:firewall:** patch 88 % · hardening 79 % · reflect 79 % · bounty 25 % · bunker 21 % · hotBarrel 13 % · shatter 13 % · permafrost 13 % · conductive 13 % · burstFire 8 % · glassCannon 8 % · frostShot 8 % · overclockRounds 4 % · coldAura 4 % · deepFreeze 4 % · arc 4 % · dataMine 4 % · greedyProtocol 4 %

## Median levels at death

- **greedy + greedy-pick:** damage 16 · attackSpeed 14 · critChance 11 · critFactor 9 · range 8 · multishot 0 · health 15 · regen 14 · defense 11 · thorns 13 · lifesteal 0 · knockback 13 · energyBonus 11 · energyPerWave 11 · interest 0 · bitsPerKill 0 · bitsPerWave 0 · freeUpgrade 0
- **greedy + tag:overload:** damage 20 · attackSpeed 18 · critChance 16 · critFactor 14 · range 10 · multishot 0 · health 20 · regen 18 · defense 16 · thorns 20 · lifesteal 0 · knockback 20 · energyBonus 16 · energyPerWave 16 · interest 0 · bitsPerKill 0 · bitsPerWave 0 · freeUpgrade 0
- **greedy + tag:cryo:** damage 15 · attackSpeed 12 · critChance 10 · critFactor 9 · range 7 · multishot 0 · health 14 · regen 13 · defense 10 · thorns 12 · lifesteal 0 · knockback 12 · energyBonus 10 · energyPerWave 10 · interest 0 · bitsPerKill 0 · bitsPerWave 0 · freeUpgrade 0
- **greedy + tag:chain:** damage 15 · attackSpeed 13 · critChance 11 · critFactor 9 · range 7 · multishot 0 · health 15 · regen 13 · defense 11 · thorns 13 · lifesteal 0 · knockback 13 · energyBonus 11 · energyPerWave 10 · interest 0 · bitsPerKill 0 · bitsPerWave 0 · freeUpgrade 0
- **greedy + tag:mining:** damage 23 · attackSpeed 23 · critChance 20 · critFactor 17 · range 10 · multishot 0 · health 23 · regen 22 · defense 20 · thorns 20 · lifesteal 0 · knockback 20 · energyBonus 20 · energyPerWave 20 · interest 0 · bitsPerKill 0 · bitsPerWave 0 · freeUpgrade 0
- **greedy + tag:firewall:** damage 23 · attackSpeed 22 · critChance 20 · critFactor 17 · range 10 · multishot 0 · health 23 · regen 21 · defense 20 · thorns 20 · lifesteal 0 · knockback 20 · energyBonus 19 · energyPerWave 19 · interest 0 · bitsPerKill 0 · bitsPerWave 0 · freeUpgrade 0

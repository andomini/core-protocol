# Balance report — M3 (protocols, tags, sets; first run)

Seeds 1–24 per policy · tier 1 · no workshop · starred stats locked · no cards · 12.4 s · `npm run sim:balance`

## B1: first protocol pick ≤ 30 s after loading — **PASS**

The wave-1 pick opens the run at sim time 0 s (tick 0, before any spawn) in every run. The wall-clock time from page load to the visible overlay is measured by `npm run ui` (`reports/ui-smoke.json`, `*.firstPickMs`).

## B2: first run (no workshop) dies at waves 4–6 — **PASS**

greedy + greedy-pick: median wave 5 at 2.4 sim-min; no upgrades (none + greedy-pick): median wave 3.

## B5: ≥ 80 % of first runs reach a 2-set; median 2-set by wave 10 — **PASS**

| policy | runs with a 2-set | median wave of the first 2-set | |
|---|---|---|---|
| greedy + greedy-pick | 100 % | 2 | ok |
| greedy + random-pick | 83 % | 3 | ok |
| greedy + first | 83 % | 3 | ok |

The wave of a 2-set is the wave whose end opened the pick that completed it (the wave-1 pick counts as wave 1).

## B6: no dominant tag — tag bots' median waves within ±20 % — **PASS**

Medians: overload 6 · cryo 6 · chain 5 · mining 5 · firewall 5. max/min = 6.0/5.0 = 1.20 (≤ 1.20 required); every tag within ±20 % of the mean 5.4: yes.

Share of tag-bot runs that reached their own 2-set: overload 71 % · cryo 71 % · chain 67 % · mining 71 % · firewall 67 %.

## All policies

| policy (buy + pick) | median wave | wave range | median min | picks | 2-set | median 2-set wave | 4-set | levels bought | alive at 60 min |
|---|---|---|---|---|---|---|---|---|---|
| none + greedy-pick | 3 | 3–6 | 1.4 | 2 | 79 % | 2 | 0 % | 0 | 0 |
| greedy + greedy-pick | 5 | 3–10 | 2.4 | 4 | 100 % | 2 | 17 % | 18 | 0 |
| atk-first + greedy-pick | 6 | 3–12 | 2.8 | 4 | 100 % | 2 | 25 % | 17 | 0 |
| def-first + greedy-pick | 3 | 3–6 | 1.5 | 3 | 83 % | 2 | 0 % | 7 | 0 |
| round-robin + greedy-pick | 4 | 3–6 | 1.5 | 3 | 88 % | 2 | 0 % | 6 | 0 |
| greedy + random-pick | 5 | 3–8 | 2.3 | 3 | 83 % | 3 | 4 % | 16 | 0 |
| greedy + first | 5 | 3–12 | 2.4 | 3 | 83 % | 2 | 8 % | 15 | 0 |
| greedy + tag:overload | 6 | 3–17 | 2.9 | 4 | 96 % | 2 | 33 % | 20 | 0 |
| greedy + tag:cryo | 6 | 3–11 | 2.5 | 4 | 100 % | 2 | 46 % | 17 | 0 |
| greedy + tag:chain | 5 | 3–10 | 2.2 | 3 | 100 % | 2 | 8 % | 14 | 0 |
| greedy + tag:mining | 5 | 3–10 | 2.4 | 3 | 100 % | 2 | 8 % | 18 | 0 |
| greedy + tag:firewall | 5 | 3–10 | 2.3 | 3 | 92 % | 2 | 8 % | 14 | 0 |
| greedy, no protocols (M2b) | 4 | 3–7 | 1.9 | 0 | — | — | — | 11 | 0 |

Bot "useful" stats (tools/sim/bot.json): damage, attackSpeed, critChance, critFactor, range, multishot, health, regen, defense, thorns, lifesteal, knockback, energyBonus, energyPerWave, interest, freeUpgrade. Tab weights: {"greedy":{"atk":1,"def":1,"util":1},"atk-first":{"atk":4,"def":1,"util":1},"def-first":{"atk":1,"def":4,"util":1}}.
Pick policies: `greedy-pick` = highest rarity, then a held tag; `random-pick` = uniform; `first` = the first card; `tag:<t>` = the best card of tag t when offered, else greedy-pick.

## Perks held at death (share of runs)

- **greedy + greedy-pick:** shatter 38 % · bounty 33 % · hotBarrel 29 % · conductive 29 % · permafrost 25 % · frostShot 21 % · coldAura 17 % · dataMine 17 % · greedyProtocol 17 % · overclockRounds 13 % · burstFire 13 % · overchargeLink 13 % · glassCannon 8 % · hardening 8 % · deepFreeze 4 % · bounce 4 % · arc 4 % · energySiphon 4 % · reflect 4 % · bunker 4 %
- **greedy + random-pick:** energySiphon 25 % · dataMine 25 % · critSpike 21 % · frostShot 21 % · coldAura 21 % · bounce 21 % · hardening 21 % · burstFire 17 % · hotBarrel 17 % · reflect 17 % · overclockRounds 13 % · shatter 13 % · bounty 13 % · permafrost 8 % · deepFreeze 8 % · arc 8 % · patch 8 % · conductive 4 % · overchargeLink 4 % · greedyProtocol 4 %
- **greedy + tag:overload:** burstFire 50 % · critSpike 46 % · overclockRounds 42 % · hotBarrel 42 % · bounty 25 % · shatter 17 % · permafrost 17 % · glassCannon 13 % · frostShot 13 % · coldAura 8 % · bounce 4 % · conductive 4 % · overchargeLink 4 % · energySiphon 4 % · dataMine 4 % · greedyProtocol 4 % · hardening 4 %
- **greedy + tag:cryo:** frostShot 67 % · coldAura 50 % · shatter 46 % · permafrost 29 % · deepFreeze 17 % · hotBarrel 13 % · conductive 13 % · bounty 13 % · dataMine 8 % · hardening 8 % · overclockRounds 4 % · burstFire 4 % · glassCannon 4 % · bounce 4 % · overchargeLink 4 % · energySiphon 4 % · reflect 4 %
- **greedy + tag:chain:** arc 58 % · bounce 42 % · conductive 38 % · overchargeLink 21 % · shatter 17 % · permafrost 17 % · hotBarrel 13 % · bounty 13 % · greedyProtocol 13 % · frostShot 8 % · coldAura 8 % · overclockRounds 4 % · burstFire 4 % · glassCannon 4 % · deepFreeze 4 % · dataMine 4 % · hardening 4 %
- **greedy + tag:mining:** energySiphon 54 % · dataMine 54 % · bounty 46 % · hotBarrel 17 % · conductive 17 % · frostShot 13 % · greedyProtocol 13 % · coldAura 8 % · shatter 8 % · permafrost 8 % · overchargeLink 8 % · overclockRounds 4 % · burstFire 4 % · critSpike 4 % · glassCannon 4 % · hardening 4 % · reflect 4 %
- **greedy + tag:firewall:** patch 67 % · hardening 46 % · reflect 42 % · bounty 21 % · hotBarrel 13 % · frostShot 8 % · shatter 8 % · permafrost 8 % · bunker 8 % · overclockRounds 4 % · burstFire 4 % · glassCannon 4 % · coldAura 4 % · arc 4 % · conductive 4 % · dataMine 4 % · greedyProtocol 4 %

## Median levels at death

- **greedy + greedy-pick:** damage 6 · attackSpeed 2 · critChance 0 · critFactor 0 · range 0 · multishot 0 · health 6 · regen 4 · defense 0 · thorns 0 · lifesteal 0 · knockback 0 · energyBonus 0 · energyPerWave 0 · interest 0 · bitsPerKill 0 · bitsPerWave 0 · freeUpgrade 0
- **greedy + tag:overload:** damage 7 · attackSpeed 3 · critChance 0 · critFactor 0 · range 0 · multishot 0 · health 6 · regen 4 · defense 0 · thorns 0 · lifesteal 0 · knockback 0 · energyBonus 0 · energyPerWave 0 · interest 0 · bitsPerKill 0 · bitsPerWave 0 · freeUpgrade 0
- **greedy + tag:cryo:** damage 6 · attackSpeed 2 · critChance 0 · critFactor 0 · range 0 · multishot 0 · health 6 · regen 3 · defense 0 · thorns 0 · lifesteal 0 · knockback 0 · energyBonus 0 · energyPerWave 0 · interest 0 · bitsPerKill 0 · bitsPerWave 0 · freeUpgrade 0
- **greedy + tag:chain:** damage 5 · attackSpeed 1 · critChance 0 · critFactor 0 · range 0 · multishot 0 · health 5 · regen 3 · defense 0 · thorns 0 · lifesteal 0 · knockback 0 · energyBonus 0 · energyPerWave 0 · interest 0 · bitsPerKill 0 · bitsPerWave 0 · freeUpgrade 0
- **greedy + tag:mining:** damage 6 · attackSpeed 2 · critChance 0 · critFactor 0 · range 0 · multishot 0 · health 6 · regen 4 · defense 0 · thorns 0 · lifesteal 0 · knockback 0 · energyBonus 0 · energyPerWave 0 · interest 0 · bitsPerKill 0 · bitsPerWave 0 · freeUpgrade 0
- **greedy + tag:firewall:** damage 5 · attackSpeed 1 · critChance 0 · critFactor 0 · range 0 · multishot 0 · health 5 · regen 3 · defense 0 · thorns 0 · lifesteal 0 · knockback 0 · energyBonus 0 · energyPerWave 0 · interest 0 · bitsPerKill 0 · bitsPerWave 0 · freeUpgrade 0

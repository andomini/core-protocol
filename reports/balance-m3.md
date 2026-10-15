# Balance report — M3 (protocols, tags, sets; first run)

Seeds 1–24 per policy · tier 1 · no workshop · starred stats locked · no cards · 31.3 s · `npm run sim:balance`

## B1: first protocol pick ≤ 30 s after loading — **PASS**

The wave-1 pick opens the run at sim time 0 s (tick 0, before any spawn) in every run. The wall-clock time from page load to the visible overlay is measured by `npm run ui` (`reports/ui-smoke.json`, `*.firstPickMs`).

## B2: first run (no workshop) dies at waves 4–6 — **PASS**

greedy + greedy-pick: median wave 6 at 2.9 sim-min; no upgrades (none + greedy-pick): median wave 3.

## B5: ≥ 80 % of first runs reach a 2-set; median 2-set by wave 10 — **PASS**

| policy | runs with a 2-set | median wave of the first 2-set | |
|---|---|---|---|
| greedy + greedy-pick | 100 % | 2 | ok |
| greedy + random-pick | 88 % | 3 | ok |
| greedy + first | 83 % | 3 | ok |

The wave of a 2-set is the wave whose end opened the pick that completed it (the wave-1 pick counts as wave 1).

## B6: no dominant tag — tag bots' median waves within ±20 % — **FAIL**

Medians: overload 7 · cryo 6 · chain 5 · mining 5 · firewall 5. max/min = 7.0/5.0 = 1.40 (≤ 1.20 required); every tag within ±20 % of the mean 5.6: no.

Share of tag-bot runs that reached their own 2-set: overload 71 % · cryo 75 % · chain 71 % · mining 71 % · firewall 75 %.

## All policies

| policy (buy + pick) | median wave | wave range | median min | picks | 2-set | median 2-set wave | 4-set | levels bought | alive at 60 min |
|---|---|---|---|---|---|---|---|---|---|
| none + greedy-pick | 3 | 3–5 | 1.4 | 2 | 79 % | 2 | 0 % | 0 | 0 |
| greedy + greedy-pick | 6 | 3–12 | 2.9 | 4 | 100 % | 2 | 21 % | 27 | 0 |
| atk-first + greedy-pick | 7 | 3–24 | 3.1 | 4 | 100 % | 2 | 33 % | 28 | 0 |
| def-first + greedy-pick | 4 | 3–6 | 1.6 | 3 | 88 % | 2 | 0 % | 10 | 0 |
| round-robin + greedy-pick | 4 | 3–6 | 1.5 | 3 | 83 % | 2 | 0 % | 8 | 0 |
| greedy + random-pick | 6 | 3–35 | 2.9 | 4 | 88 % | 3 | 13 % | 33 | 0 |
| greedy + first | 6 | 3–29 | 2.8 | 4 | 83 % | 2 | 21 % | 26 | 0 |
| greedy + tag:overload | 7 | 3–31 | 3.4 | 4 | 96 % | 2 | 42 % | 33 | 0 |
| greedy + tag:cryo | 6 | 3–12 | 2.9 | 4 | 100 % | 2 | 50 % | 28 | 0 |
| greedy + tag:chain | 5 | 3–12 | 2.4 | 3 | 96 % | 2 | 21 % | 24 | 0 |
| greedy + tag:mining | 5 | 3–12 | 2.4 | 3 | 100 % | 2 | 17 % | 28 | 0 |
| greedy + tag:firewall | 5 | 3–18 | 2.4 | 3 | 96 % | 2 | 17 % | 20 | 0 |
| greedy, no protocols (M2b) | 5 | 3–7 | 2.3 | 0 | — | — | — | 19 | 0 |

Bot "useful" stats (tools/sim/bot.json): damage, attackSpeed, critChance, critFactor, range, multishot, health, regen, defense, thorns, lifesteal, knockback, energyBonus, energyPerWave, interest, freeUpgrade. Tab weights: {"greedy":{"atk":1,"def":1,"util":1},"atk-first":{"atk":4,"def":1,"util":1},"def-first":{"atk":1,"def":4,"util":1}}.
Pick policies: `greedy-pick` = highest rarity, then a held tag; `random-pick` = uniform; `first` = the first card; `tag:<t>` = the best card of tag t when offered, else greedy-pick.

## Perks held at death (share of runs)

- **greedy + greedy-pick:** shatter 38 % · conductive 33 % · bounty 33 % · hotBarrel 29 % · permafrost 29 % · frostShot 21 % · coldAura 17 % · dataMine 17 % · greedyProtocol 17 % · burstFire 13 % · overchargeLink 13 % · overclockRounds 8 % · glassCannon 8 % · hardening 8 % · critSpike 4 % · deepFreeze 4 % · bounce 4 % · arc 4 % · energySiphon 4 % · reflect 4 % · bunker 4 %
- **greedy + random-pick:** hardening 33 % · dataMine 29 % · energySiphon 25 % · critSpike 21 % · frostShot 21 % · coldAura 21 % · bounce 21 % · reflect 21 % · overclockRounds 17 % · burstFire 17 % · hotBarrel 17 % · shatter 17 % · permafrost 17 % · patch 17 % · bounty 13 % · deepFreeze 8 % · arc 8 % · greedyProtocol 8 % · glassCannon 4 % · conductive 4 % · overchargeLink 4 %
- **greedy + tag:overload:** burstFire 54 % · overclockRounds 46 % · critSpike 46 % · hotBarrel 42 % · bounty 25 % · permafrost 21 % · shatter 17 % · glassCannon 13 % · frostShot 13 % · coldAura 8 % · conductive 8 % · greedyProtocol 8 % · bounce 4 % · overchargeLink 4 % · energySiphon 4 % · dataMine 4 % · hardening 4 %
- **greedy + tag:cryo:** frostShot 67 % · coldAura 50 % · shatter 46 % · permafrost 33 % · deepFreeze 17 % · hotBarrel 13 % · conductive 13 % · bounty 13 % · energySiphon 8 % · dataMine 8 % · hardening 8 % · overclockRounds 4 % · burstFire 4 % · glassCannon 4 % · bounce 4 % · overchargeLink 4 % · reflect 4 %
- **greedy + tag:chain:** arc 58 % · bounce 42 % · conductive 42 % · overchargeLink 29 % · shatter 17 % · permafrost 17 % · greedyProtocol 17 % · hotBarrel 13 % · bounty 13 % · frostShot 8 % · coldAura 8 % · overclockRounds 4 % · burstFire 4 % · glassCannon 4 % · deepFreeze 4 % · dataMine 4 % · hardening 4 %
- **greedy + tag:mining:** dataMine 58 % · energySiphon 54 % · bounty 46 % · hotBarrel 17 % · conductive 17 % · greedyProtocol 17 % · frostShot 13 % · permafrost 13 % · coldAura 8 % · shatter 8 % · overchargeLink 8 % · burstFire 4 % · critSpike 4 % · glassCannon 4 % · hardening 4 % · reflect 4 %
- **greedy + tag:firewall:** patch 71 % · hardening 54 % · reflect 46 % · bounty 21 % · hotBarrel 13 % · shatter 13 % · bunker 13 % · burstFire 8 % · frostShot 8 % · permafrost 8 % · overclockRounds 4 % · glassCannon 4 % · coldAura 4 % · arc 4 % · conductive 4 % · dataMine 4 % · greedyProtocol 4 %

## Fusions held at death (auto placement; share of runs at tier I+, II+)

- **greedy + greedy-pick:** Cold Storage 25 % · Superconductor 17 % · Headhunter 13 % · Overcharge 8 % · Frostbite 8 % · Network 8 % · Grounding 4 %
- **greedy + random-pick:** Thermal Shock 21 % · Cold Storage 13 % · Frostbite 13 % · Insurance 13 % · Overcharge 8 % · Headhunter 8 % · Berserk 8 % · Superconductor 8 % · Network 8 % · Grounding 8 %
- **greedy + tag:overload:** Headhunter 17 % · Thermal Shock 13 % · Superconductor 8 % · Cold Storage 8 % · Grounding 4 %
- **greedy + tag:cryo:** Cold Storage 13 % · Thermal Shock 8 % · Superconductor 8 % · Frostbite 8 % · Headhunter 4 % · Grounding 4 %
- **greedy + tag:chain:** Overcharge 17 % · Cold Storage 17 % · Network 17 % · Superconductor 8 % · Frostbite 4 %
- **greedy + tag:mining:** Cold Storage 17 % · Headhunter 13 % · Network 8 % · Overcharge 4 % · Superconductor 4 % · Grounding 4 % · Insurance 4 %
- **greedy + tag:firewall:** Frostbite 21 % · Insurance 13 % · Headhunter 8 % · Berserk 8 % · Cold Storage 4 %

## Median levels at death

- **greedy + greedy-pick:** damage 7 · attackSpeed 3 · critChance 1 · critFactor 1 · range 0 · multishot 0 · health 7 · regen 5 · defense 1 · thorns 1 · lifesteal 0 · knockback 1 · energyBonus 0 · energyPerWave 0 · interest 0 · bitsPerKill 0 · bitsPerWave 0 · freeUpgrade 0
- **greedy + tag:overload:** damage 7 · attackSpeed 4 · critChance 2 · critFactor 1 · range 0 · multishot 0 · health 7 · regen 6 · defense 2 · thorns 1 · lifesteal 0 · knockback 1 · energyBonus 1 · energyPerWave 1 · interest 0 · bitsPerKill 0 · bitsPerWave 0 · freeUpgrade 0
- **greedy + tag:cryo:** damage 7 · attackSpeed 3 · critChance 1 · critFactor 1 · range 0 · multishot 0 · health 7 · regen 5 · defense 1 · thorns 1 · lifesteal 0 · knockback 1 · energyBonus 1 · energyPerWave 0 · interest 0 · bitsPerKill 0 · bitsPerWave 0 · freeUpgrade 0
- **greedy + tag:chain:** damage 7 · attackSpeed 3 · critChance 1 · critFactor 1 · range 0 · multishot 0 · health 7 · regen 5 · defense 0 · thorns 0 · lifesteal 0 · knockback 0 · energyBonus 0 · energyPerWave 0 · interest 0 · bitsPerKill 0 · bitsPerWave 0 · freeUpgrade 0
- **greedy + tag:mining:** damage 7 · attackSpeed 3 · critChance 1 · critFactor 1 · range 0 · multishot 0 · health 7 · regen 5 · defense 1 · thorns 1 · lifesteal 0 · knockback 1 · energyBonus 1 · energyPerWave 0 · interest 0 · bitsPerKill 0 · bitsPerWave 0 · freeUpgrade 0
- **greedy + tag:firewall:** damage 7 · attackSpeed 3 · critChance 0 · critFactor 0 · range 0 · multishot 0 · health 6 · regen 4 · defense 0 · thorns 0 · lifesteal 0 · knockback 0 · energyBonus 0 · energyPerWave 0 · interest 0 · bitsPerKill 0 · bitsPerWave 0 · freeUpgrade 0

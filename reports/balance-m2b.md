# Balance report — M2b (in-run upgrades, first run)

Seeds 1–24 · tier 1 · no workshop levels · starred stats locked · 5.8 s · `npm run sim:balance`

## B2: first run dies at waves 12–20 (≈6–10 min at ×1); no-upgrade run much earlier

**PASS** — greedy median wave 18 at 8.8 sim-min; no-upgrade median wave 7.

| policy | median wave | wave range | median min | min range | levels bought | alive at 60 min |
|---|---|---|---|---|---|---|
| none | 7 | 6–8 | 3.0 | 2.8–4.0 | 0 | 0 |
| greedy | 18 | 10–23 | 8.8 | 4.8–11.3 | 106 | 0 |
| atk-first | 21 | 13–26 | 10.4 | 6.4–12.9 | 88 | 0 |
| def-first | 8 | 6–10 | 3.9 | 3.0–4.8 | 23 | 0 |
| round-robin | 8 | 6–10 | 4.0 | 3.0–4.9 | 27 | 0 |

Bot "useful" stats (tools/sim/bot.json): damage, attackSpeed, critChance, critFactor, range, multishot, health, regen, defense, thorns, lifesteal, knockback, energyBonus, energyPerWave, interest, freeUpgrade. Tab weights: {"greedy":{"atk":1,"def":1,"util":1},"atk-first":{"atk":4,"def":1,"util":1},"def-first":{"atk":1,"def":4,"util":1}}.

## Median levels at death

- **greedy:** damage 13 · attackSpeed 10 · critChance 8 · critFactor 6 · range 5 · multishot 0 · health 13 · regen 11 · defense 8 · thorns 9 · lifesteal 0 · knockback 9 · energyBonus 7 · energyPerWave 7 · interest 0 · bitsPerKill 0 · bitsPerWave 0 · freeUpgrade 0
- **atk-first:** damage 19 · attackSpeed 17 · critChance 15 · critFactor 13 · range 10 · multishot 0 · health 7 · regen 5 · defense 1 · thorns 1 · lifesteal 0 · knockback 0 · energyBonus 0 · energyPerWave 0 · interest 0 · bitsPerKill 0 · bitsPerWave 0 · freeUpgrade 0
- **def-first:** damage 0 · attackSpeed 0 · critChance 0 · critFactor 0 · range 0 · multishot 0 · health 8 · regen 7 · defense 2 · thorns 3 · lifesteal 0 · knockback 3 · energyBonus 0 · energyPerWave 0 · interest 0 · bitsPerKill 0 · bitsPerWave 0 · freeUpgrade 0
- **round-robin:** damage 3 · attackSpeed 3 · critChance 3 · critFactor 2 · range 2 · multishot 0 · health 2 · regen 2 · defense 2 · thorns 2 · lifesteal 0 · knockback 2 · energyBonus 2 · energyPerWave 2 · interest 0 · bitsPerKill 0 · bitsPerWave 0 · freeUpgrade 0

## Greedy seed 1: wave start times

1:0s 2:30s 3:60s 4:90s 5:120s 6:150s 7:180s 8:210s 9:240s 10:270s 11:300s 12:330s 13:360s 14:390s 15:420s

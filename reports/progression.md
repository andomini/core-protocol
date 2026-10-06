# Progression report

60 simulated players · up to 150 h of real play or 8000 runs each · run cap 300 sim-min · 30 threads · 52.6 min wall · `npm run sim:progression`

Real time = sim time at the best unlocked speed (casual: ×2 max) + 0.5 min of menus per run. Tiers unlock at wave 72.

## When tiers unlock (median · p10–p90 of players who got there; share reached)

| strategy | T2 | T3 | T4 | T5 | T6 |
|---|---|---|---|---|---|
| casual | 2.0 h · 1.4–3.3 · 100% | 20.4 h · 12.4–28.3 · 100% | 38.4 h · 34.6–40.8 · 100% | 126.6 h · 115.7–134.7 · 75% | never |
| balanced | 2.0 h · 1.5–3.1 · 100% | 10.9 h · 5.0–15.7 · 100% | 26.1 h · 24.8–29.4 · 100% | 48.8 h · 40.1–54.0 · 100% | 93.3 h · 72.4–107.4 · 92% |
| workshop + ads | 1.2 h · 1.0–2.5 · 100% | 7.5 h · 4.5–12.9 · 100% | 16.7 h · 15.9–18.9 · 100% | 32.4 h · 25.3–40.9 · 100% | 81.3 h · 51.3–94.4 · 100% |
| balanced + ads | 1.7 h · 0.9–2.0 · 100% | 7.2 h · 5.2–10.2 · 100% | 11.4 h · 10.2–12.8 · 100% | 21.8 h · 16.9–27.0 · 100% | 57.9 h · 37.0–75.8 · 100% |
| labs + ads | 2.0 h · 1.2–3.2 · 100% | 3.4 h · 3.2–4.2 · 100% | 6.5 h · 4.8–7.5 · 100% | 11.6 h · 11.0–13.6 · 100% | 26.5 h · 22.2–47.9 · 100% |

## Best wave on the highest tier over time (median over players)

| strategy | 0.5 h | 1 h | 2 h | 4 h | 8 h | 16 h | 24 h | 40 h | 60 h | 80 h | 100 h | 120 h |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| casual | T1 W10 | T1 W24 | T1 W41 | T2 W22 | T2 W38 | T2 W44 | T3 W23 | T4 W47 | T4 W56 | T4 W61 | T4 W63 | T4 W68 |
| balanced | T1 W19 | T1 W36 | T1 W44 | T2 W34 | T2 W42 | T3 W27 | T3 W35 | T4 W64 | T5 W55 | T5 W62 | T6 W18 | T6 W39 |
| workshop + ads | T1 W25 | T1 W39 | T2 W21 | T2 W36 | T2 W42 | T3 W39 | T4 W63 | T5 W58 | T5 W63 | T5 W66 | T6 W39 | T6 W51 |
| balanced + ads | T1 W22 | T1 W37 | T2 W24 | T2 W37 | T3 W32 | T4 W62 | T5 W51 | T5 W64 | T5 W67 | T6 W48 | T6 W47 | T6 W55 |
| labs + ads | T1 W20 | T1 W36 | T1 W43 | T3 W48 | T4 W53 | T5 W44 | T5 W57 | T6 W26 | T6 W47 | T6 W56 | T6 W59 | T6 W63 |

## Where progress stalls (longest stretch without a new best wave on the tier played)

| strategy | median plateau | p90 plateau | typical spot (tier · best wave) |
|---|---|---|---|
| casual | 44.5 h (192 runs) | 51.9 h | T4 · W65 (6), T4 · W60 (3), T4 · W70 (3) |
| balanced | 5.5 h (44 runs) | 9.8 h | T4 · W60 (4), T4 · W65 (4), T4 · W70 (3) |
| workshop + ads | 7.9 h (59 runs) | 15.0 h | T4 · W65 (4), T4 · W70 (3), T2 · W40 (2) |
| balanced + ads | 4.8 h (34 runs) | 6.2 h | T4 · W65 (5), T5 · W65 (2), T4 · W60 (2) |
| labs + ads | 1.8 h (16 runs) | 2.4 h | T4 · W60 (2), T4 · W70 (2), T5 · W70 (2) |

## Runaway runs (survived the run cap)

- **casual:** 0 of 9815 runs (0.0 %)
- **balanced:** 0 of 16995 runs (0.0 %)
- **workshop + ads:** 0 of 17470 runs (0.0 %)
- **balanced + ads:** 0 of 17442 runs (0.0 %)
- **labs + ads:** 0 of 19540 runs (0.0 %)

## Run length on the highest tier (sim minutes, median of runs per hour bucket, all players)

0–1 h: 4.9 · 1–2 h: 16.4 · 2–4 h: 16.9 · 4–8 h: 16.0 · 8–16 h: 16.9 · 16–40 h: 23.3 · 40–80 h: 25.3 · 80–120 h: 26.9

## Labs owned at the end (share of players)

slot6 32% · speed5 52% · rare2 63% · maxRange 67% · slot5 80% · bits3 80% · speed3 100% · speed4 100% · multishot 100% · lifesteal 100% · interest 100% · freeUpgrade 100% · maxAtkSpeed 100% · perkChoice 100% · freeReroll 100% · rare1 100% · pickEvery 100% · slot3 100% · slot4 100% · presets 100% · bits1 100% · bits2 100% · startEnergy 100% · offline8 100% · offline12 100%

## Final state (median)

| strategy | runs | hours | tier | workshop levels | labs | cards owned |
|---|---|---|---|---|---|---|
| casual | 821 | 150.0 h | 5 | 379 | 19 | 20 |
| balanced | 1424 | 150.0 h | 6 | 401 | 21 | 20 |
| workshop + ads | 1426 | 150.0 h | 6 | 434 | 24 | 20 |
| balanced + ads | 1445 | 150.1 h | 6 | 439 | 24 | 20 |
| labs + ads | 1627 | 150.1 h | 6 | 449 | 25 | 20 |

## Player 1 timeline (first 40 runs)

| run | h | tier | wave | sim min | Bits | buys | workshop | labs | cards |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 0.02 | 1 | 4 | 1.8 | 74 | 4 | 4 | 0 | 2 |
| 2 | 0.05 | 1 | 6 | 2.7 | 147 | 8 | 12 | 0 | 2 |
| 3 | 0.10 | 1 | 10 | 4.9 | 372 | 14 | 26 | 0 | 2 |
| 4 | 0.15 | 1 | 10 | 4.8 | 356 | 9 | 35 | 0 | 2 |
| 5 | 0.21 | 1 | 12 | 5.9 | 621 | 2 | 36 | 1 | 2 |
| 6 | 0.26 | 1 | 10 | 4.9 | 440 | 8 | 44 | 1 | 2 |
| 7 | 0.36 | 1 | 22 | 10.8 | 2159 | 11 | 54 | 2 | 2 |
| 8 | 0.43 | 1 | 17 | 8.3 | 1246 | 13 | 67 | 2 | 3 |
| 9 | 0.58 | 1 | 33 | 16.4 | 7687 | 28 | 94 | 3 | 3 |
| 10 | 0.66 | 1 | 18 | 8.8 | 1697 | 6 | 100 | 3 | 3 |
| 11 | 0.77 | 1 | 25 | 12.4 | 3079 | 8 | 108 | 3 | 3 |
| 12 | 0.92 | 1 | 33 | 16.4 | 5787 | 3 | 110 | 4 | 3 |
| 13 | 1.06 | 1 | 32 | 15.8 | 8848 | 16 | 126 | 4 | 3 |
| 14 | 1.17 | 1 | 25 | 12.5 | 3110 | 4 | 130 | 4 | 3 |
| 15 | 1.36 | 1 | 43 | 21.4 | 10397 | 2 | 131 | 5 | 3 |
| 16 | 1.47 | 1 | 24 | 11.9 | 2937 | 3 | 134 | 5 | 3 |
| 17 | 1.59 | 1 | 28 | 13.9 | 4706 | 5 | 139 | 5 | 3 |
| 18 | 1.76 | 1 | 39 | 19.4 | 8424 | 7 | 146 | 5 | 3 |
| 19 | 1.94 | 1 | 42 | 20.9 | 9364 | 6 | 152 | 5 | 3 |
| 20 | 2.13 | 1 | 43 | 21.4 | 10148 | 5 | 157 | 5 | 3 |
| 21 | 2.31 | 1 | 43 | 21.2 | 11595 | 6 | 163 | 5 | 3 |
| 22 | 2.50 | 1 | 42 | 20.9 | 9581 | 3 | 166 | 5 | 3 |
| 23 | 2.64 | 1 | 33 | 16.4 | 5480 | 2 | 168 | 5 | 3 |
| 24 | 2.80 | 1 | 36 | 17.9 | 6779 | 3 | 171 | 5 | 3 |
| 25 | 2.95 | 1 | 34 | 16.9 | 5992 | 1 | 172 | 5 | 3 |
| 26 | 3.10 | 1 | 35 | 17.4 | 6232 | 2 | 174 | 5 | 3 |
| 27 | 3.26 | 1 | 36 | 17.8 | 6408 | 2 | 176 | 5 | 3 |
| 28 | 3.40 | 1 | 32 | 15.9 | 5102 | 1 | 177 | 5 | 3 |
| 29 | 3.60 | 1 | 46 | 22.9 | 11477 | 3 | 180 | 5 | 3 |
| 30 | 3.75 | 2 | 34 | 16.9 | 9969 | 2 | 182 | 5 | 3 |
| 31 | 3.88 | 2 | 31 | 15.4 | 9074 | 2 | 184 | 5 | 3 |
| 32 | 4.00 | 2 | 27 | 13.4 | 6048 | 1 | 185 | 5 | 3 |
| 33 | 4.14 | 2 | 31 | 15.4 | 8216 | 2 | 187 | 5 | 3 |
| 34 | 4.28 | 2 | 31 | 15.2 | 7745 | 1 | 188 | 5 | 3 |
| 35 | 4.43 | 1 | 36 | 17.8 | 6289 | 1 | 189 | 5 | 3 |
| 36 | 4.54 | 2 | 24 | 11.9 | 5249 | 1 | 190 | 5 | 3 |
| 37 | 4.69 | 2 | 35 | 17.4 | 11069 | 1 | 190 | 6 | 3 |
| 38 | 4.79 | 2 | 32 | 15.8 | 9049 | 1 | 191 | 6 | 3 |
| 39 | 4.89 | 2 | 32 | 15.9 | 10250 | 2 | 193 | 6 | 3 |
| 40 | 4.99 | 2 | 34 | 16.9 | 10766 | 1 | 194 | 6 | 3 |

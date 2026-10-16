# Crystal geometry — one cluster per tag on rings 2-4

Annealed layouts (seeded; 10 restarts × 40000 steps per row; a lower bound). Slots: 54 hexes on rings 2-4. Every tag is one connected cluster, the crystal touches the core block.

## Distinct touching tag pairs (of 10) per module budget

| modules | max touching pairs | tag sizes of the best layout | most links on one pair there |
|---|---|---|---|
| 5 | 7 | 1/1/1/1/1 | 1 |
| 6 | 7 | 1/2/1/1/1 | 2 |
| 7 | 8 | 2/2/1/1/1 | 2 |
| 8 | 8 | 3/2/1/1/1 | 2 |
| 9 | 8 | 1/3/1/1/3 | 3 |
| 10 | 9 | 3/2/1/1/3 | 3 |
| 11 | 9 | 1/1/4/1/4 | 4 |
| 12 | 9 | 1/3/1/4/3 | 4 |
| 13 | 9 | 1/4/1/4/3 | 5 |
| 14 | 9 | 6/3/2/1/2 | 4 |
| 15 | 9 | 5/2/1/5/2 | 6 |
| 16 | 9 | 2/4/3/1/6 | 8 |
| 17 | 9 | 5/4/1/3/4 | 5 |
| 18 | 9 | 2/4/6/5/1 | 5 |
| 19 | 8 | 4/4/4/3/4 | 7 |
| 20 | 8 | 3/7/3/4/3 | 8 |
| 21 | 9 | 2/3/7/4/5 | 6 |
| 22 | 8 | 2/4/7/4/5 | 6 |
| 23 | 8 | 5/5/4/6/3 | 7 |
| 24 | 8 | 6/2/3/10/3 | 8 |

Tag order: overload, cryo, chain, mining, firewall. Highest pair count found over all budgets: **9 of 10**.

## Modules needed for a 7-link pair (Apex gate; two tags only, each one connected cluster)

| modules | max links between the two clusters | split A/B |
|---|---|---|
| 4 | 3 | 1/3 |
| 5 | 4 | 4/1 |
| 6 | 5 | 4/2 |
| 7 | 7 | 2/5 |
| 8 | 8 | 6/2 |
| 9 | 9 | 7/2 |

First 7-link pair at **7 modules** (the two tags' modules together; the other three tags add at least 3 more for a full crystal, and set ≥ 4 needs stacks, not modules).

## The same, with at least 3 modules in each of the two clusters

| modules | max links | split A/B |
|---|---|---|
| 6 | 5 | 3/3 |
| 7 | 6 | 4/3 |
| 8 | 8 | 3/5 |
| 9 | 9 | 5/4 |

First 7-link pair with both clusters >= 3 modules: **8 modules**.

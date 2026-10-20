# Uniqueness plan, item 4: Pulse. Notes (agent A4)

Branch `worktree-agent-afe59e06155cb9402`.

## What it is
The core's one active verb. The player can fire it three ways:
- tap the PULSE button (arena bottom-right, both orientations)
- tap the core itself, where no module sits under the finger
- press **Space**. Pause moved to **P**. The HUD pause button is unchanged.

The ring has radius `radiusRangeMul` × Range around the core. Its effect follows the **dominant tag**: the highest `tagCountsNow` on the crystal that is ≥ `minCount`, with ties broken in TAGS order. With no tag, the plain pulse fires. The effect is computed and applied in `src/sim/pulse.ts`, and every number lives in `src/data/pulse.json`.

## Numbers (pulse.json, final)
| tag | effect |
|---|---|
| none | 0.5 × Damage to every virus in the ring, knockback 20 |
| overload | 0.5 × Damage. Deliberately the weakest pulse: the overload set is already the strongest tag (B6) |
| cryo | freezes the ring for 3 s, plus 0.5 × Damage |
| chain | an arc from the core to up to 16 viruses, 2.5 × Damage each (`lightning` source: chain kill bonuses apply) |
| mining | each virus in the ring pays its kill Energy and Bits × 2 right away (it does not have to die), plus 0.5 × Damage |
| firewall | shield of 0.4 × max HP (total capped at 0.6 × max HP), plus 0.5 × Damage and knockback 30 |

- **Cooldown:** 50 s. Each set tier step of the dominant tag (2/4/6-set) takes 10 % off the cooldown, with a floor of 20 % of the base. Each step also adds +25 % power to the effect.
- **Radius:** 0.4 × Range, which is 120 px at base Range.

## autoPulse
- **Lab node:** `autoPulse` sits in the speed branch, requires `speed3`, and costs 120 000 Bits.
- **Path into the sim:** `labs.ts` → `RunOptions.autoPulse` → `World.pulseAuto`.
- **Rule:** in `step`, right after the spatial hash, the pulse fires by itself once it is ready and **≥ `autoPulse.minTargets` (3)** live viruses are inside the ring.
- **Other users of the same rule:** the balance bots (greedy/atk-first/def-first; the `none` bot never pulses) and the `?widget=1` auto-pulse (`autoPulseCmd` in `widget.ts`) use `pulseWorth`, the same rule. So the widget waits for a crowd and does not fire on the first virus that comes along.

## Balance (`sim:balance`, 24 seeds)
| | B2 greedy + greedy-pick median | none | B6 medians (ov · cr · ch · mi · fw) | max/min |
|---|---|---|---|---|
| before (main a254a3b) | 7 (FAIL already) | 3 | 8 · 6 · 5 · 5 · 5 | 1.60 |
| first draft (20 s, 0.6 R, ×2–4 damage) | 10 | 3 | 10 · 8 · 8 · 8 · 8 | 1.25 |
| **final** | **7** | 3 | **8 · 7 · 6 · 6 · 6** | **1.33** |

Tuning observations:
- **The overload median does not respond to the overload pulse.** It stayed at 8 to 10 whether its pulse multiplier was 0.5, 0.75, 1.5 or 4. The gap comes from the overload set itself, not from the pulse.
- **What does move B2 is how often the pulse fires,** set by the cooldown × radius combination. 45 s or less at 0.45 R or more puts the greedy median at 8. 50 s at 0.4 R keeps it at 7.
- **The extra B6 gain** comes from making the chain, mining and firewall pulses stronger than overload.

## Open issues
- **B2 was already failing on main** (median 7, target 4–6). The pulse holds it at 7; it does not fix it.
- **B6 still fails** (1.33 > 1.20), but improves from 1.60. Closing the rest of the gap is a set or perk balance task, not a pulse task.
- **A 50 s cooldown is long for an "active verb".** If B2 gets fixed elsewhere (for example by the boot-sector or mutation work), try 30–40 s.
- **Space no longer pauses** (it is now P). If P is unwelcome, Esc could also pause. Esc is not bound anywhere today.
- **The manual pulse uses `worldStats`** (no Overdrive), while autoPulse in step uses that tick's `combatStats`. The difference is small and only matters while Overdrive is active.
- **Mutation genes have no counter to the pulse** (e.g. a freeze-immune strain). Left for the mutations owner.
- **Files touched outside the ownership list,** each needed for the feature or for typecheck:
  - `src/sim/projectiles.ts` (HitSource `pulse`)
  - `src/meta/metaData.ts`, `src/meta/labs.ts`, `src/meta/runOptions.ts` (the lab-node pattern)
  - `src/meta/runStats.ts` and `src/ui/statsRows.ts` (DamageSource `pulse`)
  - `src/ui/labText.ts`
  - `tests/cardEffects.test.ts` (the world version 7 → 8 assertion; A1 makes the same change)

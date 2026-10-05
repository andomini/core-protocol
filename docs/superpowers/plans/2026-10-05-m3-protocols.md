# M3 — Protocols (perks), tags, sets, boss gate

Branch `m3-protocols`. Spec §2.4 (binding), §5 (effects are data), §6, §7 (B1, B2, B5, B6). Builds on M2b
(`2026-10-05-m2b-upgrades-notes.md`).

## Key decisions (details and costs in the notes file)
- **Pick timing.** Picks at waves 1, 3, 5, 8, 10, then every 5 (data). The wave-1 pick opens the run
  (tick 0, before any spawn), so B1 holds at ≈ boot time; header "CHOOSE A PROTOCOL". Every later pick opens
  on `waveEnd` of wave N (after the wave reward); header "WAVE N CLEARED".
- **Offer RNG.** The `perks` stream is derived per offer: `createStream(seed, 'perks:<pickNo>:<reroll>')`
  (as in Last Tower), so purchases, combat and earlier rerolls never shift an offer.
- **Pick phase.** `World.phase` gains `'pick'`. `step` applies commands first, then returns if the
  phase is (still) `pick`: no `tick++`, nothing moves. A `pickPerk` resolves it and the same step ticks, so
  apply-now-then-step ≡ step(cmds) still holds for replays. The pick resolves into the `'pause'` phase with `phaseTick` kept.
- **Counting.** Each perk stack counts 1 toward its tag (a 6-set needs stacks: each tag has ≤ 5 perks),
  plus 1 per `RunOptions.cardTags` entry.
- **Stat effects** (`statAdd`/`statMul`) are appended to `World.mods` once, at pick / set activation
  (one modifier per effect per stack, `source` = `perk:<id>` / `set:<tag>:<tier>`). Everything else is
  derived each step from `perks` + `setTiers` by `perkProfile` (pure), never stored.
- `RunOptions.protocols?: boolean` (default true). `false` = no picks (legacy sim tests, stress mode).

## Tasks and interfaces

### T1 — data + validation (TDD)
- `src/data/perks.json`: `schedule {waves, every}`, `offer {size, sizeLab, rarityWeights, pityAfter}`,
  `freeRerolls`, `boost {energyMul, waves, cooldownWaves}`, `mechanics {…base values}`, `perks {id: PerkDef}`.
  `PerkDef = {name, tag, rarity, maxStacks, requires?: StatId, effects: Effect[]}`.
- `src/data/sets.json`: `tags {id: {name, icon}}`, `tiers [2,4,6]`, `sets {tag: {"2": SetTier, …}}`,
  `SetTier = {desc, effects}`.
- `Effect` union: `statAdd|statMul {stat, value}`, `onHit {action: slow|freeze|lightning, …}`,
  `onCrit {action: lightning}`, `onKill {kind?, energy?, energyMul?, bitsMul?, keys?}`,
  `periodic {action: overdrive|freezeAll|immunity, everySec?|everyWaves?, seconds, value?, hpBelow?}`,
  `conditional {when: targetSlowed|targetFrozen|targetHpBelow|nthShot|innerRange, …}`,
  `ruleChange {rule: RuleId, op: add|mul, value}`.
- `enemies.*.keys` (boss 1). `validateData` checks every perk/set/effect (unknown stat/rule/tag → throws).
- Tests: `tests/perkData.test.ts` (25 perks, 5 per tag, 5 trade-offs, every effect type validates, bad data throws).

### T2 — World v3, offers, pick/reroll/boost commands (TDD)
- `src/sim/perks.ts`: `isPickWave`, `heldTags`, `tagCounts`, `generateOffer`, `enterPick`, `pickPerk`,
  `reroll`, `boost`, `applySetTiers`, `perkProfile(w, data)`.
- World v3: `perks`, `cardTags`, `setTiers`, `pick {offer, rerolls} | null`, `picks`, `pity`, `freeRerolls`,
  `offerSize`, `keys`, `boost {from, until}`, `timers`, `core.shots`; enemy `slow`,
  `slowUntil`, `frozenUntil`; projectile `bounces`, `hits`. Snapshot v3 only.
- Commands: `{type:'pickPerk', index}`, `{type:'reroll', via:'free'|'ad'}`, `{type:'boost'}`; rejects →
  `commandRejected`.
- Tests (`tests/perks.test.ts`): schedule, wave-1 pick at tick 0, world frozen during pick, rarity split
  (Monte Carlo), pity, tag weighting, locked-perk exclusion, max stacks, offer determinism across two
  purchase logs, card tags count, set thresholds, no double application, snapshot round trip in pick phase.

### T3 — mechanics (TDD, `tests/protocolEffects.test.ts`)
- slow (on-hit + inner-range aura, bonus, cap), freeze (chance, duration ×, no move/attack), conditional
  damage (slowed/frozen/HP-below/every Nth shot), lightning (nearest N via spatial hash, on hit/crit/boss),
  bounce (retarget, damage falloff, no repeat target), periodic (Overdrive, freeze-all, immunity charge),
  onKill (Energy %, boss ×, Keys), enemy HP rule, thorns vs ranged, run-end Bits, boost ×2 Energy,
  interest-cap mods. Grid built once per step.

### T4 — bots + balance (`tools/sim`)
- Pick policies: `greedy-pick`, `random-pick`, `tag:<tag>`; a run = buy policy × pick policy.
- `npm run sim:balance` → `reports/balance-m3.md` (≥ 24 seeds): B1, B2, B5, B6 sections. Tune data.

### T5 — golden replay + determinism
- Golden replay re-recorded with picks, a reroll and a boost; determinism test auto-picks.

### T6 — UI: pick overlay, HUD chips, "My protocols", feedback
- `src/ui/perkText.ts` (pure, tested): effect line from data with numbers, set progress line.
- `src/ui/PickOverlay.ts`, `src/ui/ProtocolsPanel.ts`, set chips in `Hud`, banners + core pulse,
  freeze/slow tints, lightning arcs, bounce sparks, Overdrive glow.
- `src/ui/rewarded.ts`: `RewardedAds {rewardedAd(placement)}`; local stub grants in DEV. BattleScene reads
  `registry.get('rewarded')` first, so M6 only has to register its PortalGuard there.

### T7 — smoke + screenshots; T8 — notes.

# Uniqueness plan, Phase 3 — C1 notes: tier bosses and the FINALE unlock

Branch `worktree-agent-a738489b44a6123c5` (from main bd730fc).

## What a tier boss is
- Every tier names a boss in `src/data/tiers.json` (`boss`) and, for tiers 1–5, a `finale` wave equal to its
  unlock wave (50/100/150/200/250). Tier 6 (Mutagen) has no finale.
- A tier boss is still `kind: 'boss'` (WORM.EXE stats from `enemies.json`), re-scaled at spawn by
  `applyBoss` (`src/sim/bosses.ts`) with its `bosses.json` entry. The mechanic is keyed by which data fields
  are present (a field group must be complete or absent; `validateBosses` in `data.ts`), not by the id.
- State lives in optional `Enemy` fields (`boss`, `finale`, `bt`, `brood`, `drained`, `enraged`), so World and
  the snapshot stay at v8. The golden replay (to wave 6) did not change.

| tier | id | mechanic | data fields |
|---|---|---|---|
| 1 | overseer | shield every 9 s for 2.5 s, 1.5 s telegraph first; hits do nothing while shielded | shieldEvery/Sec/Warn |
| 2 | broodmother | 3 spores per 25 % of max HP lost (no brood on the killing hit; the brood does not split) | broodStep/Count/Kind |
| 3 | siphon | each landed core hit drains Energy (wave-scaled), heals 6 % max HP pro rata; the kill returns 1.5× | drainEnergy/Heal/Return |
| 4 | swarmlord | a Carrier aura (radius 180, −40 % damage taken) around it | auraRadius/Reduce |
| 5 | artillery | ranged from standoff 330, a shot every 4 s; the first shot also waits a full interval | standoff, attackInterval, shotWarn |
| 6 | mutagen | forces one genome mutation on spawn; ×1.7 speed below 50 % HP | mutations, enrageAt/Speed |

FINALE: `isBossWave` is also true on the finale wave; the boss there has HP × `finaleHpMul` (1.5).

## Events
- `waveStart` carries `bossId` and `finale` when the tier has a boss.
- `bossMech {enemyId, boss, mech, x, y, value?}` — shieldWarn/shieldUp/shieldDown/brood/drain/enrage/mutate.
- `bossDown {enemyId, boss, finale, tier, x, y}` on every tier boss kill.

## FINALE unlock (additive to runEnd)
- `unlockByFinale(meta, data, tier)` (`src/meta/runEnd.ts`): same rule as the wave unlock (only from the highest
  unlocked tier, never past the last). BattleScene calls it on `bossDown` with `finale` (not daily, not stress),
  saves the meta, shows "FINALE CLEARED · TIER n UNLOCKED" and the `finale` stinger.
- `settleRun` takes `finaleUnlocked`; it is reported as `tierUnlocked` when the wave rule did not already
  unlock (it cannot: meta.tierUnlocked has moved on), so the death note still says "TIER n UNLOCKED".
- Reaching the unlock wave still unlocks at death as before; tools/sim progression is unaffected.

## Render
- `src/render/bossShapes.ts` (pure, no Phaser): `BOSS_LOOK` colour/accent/segment count per id, head and segment
  bakes (`drawBossHead`/`drawBossSeg`, baked per boss radius in `textures.ts`), `bossPose` (the pose() idea:
  rotation and squash per id), `drawBossTelegraph` (aura ring, shield-warn contracting ring, hex shield bubble
  with countdown, artillery aim laser + core reticle, brood egg ring, drain tether, enrage rings).
- WorldView: tier boss head/segments/colour; the plain WORM.EXE look is unchanged.
- HUD (`src/ui/Hud.ts`): a boss bar in the arena's bottom-left (the top rows are taken by set chips, pair chips
  and the genome strip): name, FINALE/ENRAGED tag, HP bar in the boss colour (white pulsing while shielded),
  and the "how to beat it" half of the hint (after the colon). The entrance banner shows the full hint.
- Audio: stingers `boss` (low chromatic crawl) and `finale` (A major climb); voice `bossWarn` (shield
  telegraph). vfx: a pooled `Vfx.pulse` ring at the boss spawn, a firewall hex on shieldUp, an overload burst
  on enrage.

## Balance
- `sim:smoke -- 1 1 greedy`: dies at wave 7 (baseline 7). Bots reach no boss wave without meta, so the boss
  numbers are a first pass; they need playtesting at waves 10–50 (sim:progression is out of scope for C1).

## Open
- No audio cue for the Artillery aim (visual laser only): the sim has no "aim" event.
- After a revive, the second death reports the FINALE unlock again (the unlock itself happens once).

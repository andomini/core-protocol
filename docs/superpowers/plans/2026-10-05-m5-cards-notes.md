# M5 — Cards: notes

Tests: 364 → 383 · `npm run ui` 189/189 (new `cards` scenario).

## What exists
- **Sim v5:**
  - `RunOptions.cards` carries resolved effects; each card is treated like a perk with one stack. Stat mods are `card:<id>`, timers `card:<id>:<i>`, and the card is folded into `perkProfile`.
  - New effects: `periodic damageBoost` (Overclock), `periodic tesla` (a bolt from the core, `lightning` with `fromId` 0), `shield` (Barrier, refilled at each wave start, absorbs damage before HP), `conditional coreHpBelow` (Kernel Panic), rule `enemySpeed` (Time Dilation) and `waveSkip` (on its own stream `skip:<wave>`, rewards paid at once, never on boss waves).
  - `revive {hp?}`: Second Wind revives with its own HP share.
- **Meta:**
  - `src/data/cards.json`: 20 cards (10/7/3), values for ★1–5, packs (10 Keys, 3 cards, 70/25/5, an Epic guaranteed every 10th pack), a free pack every 4 h.
  - `src/meta/cards.ts`: `openPack`, `claimFreePack`, `grantStarter` (2 tagged Commons with different tags, equipped), `equip`/`unequip`, `loadoutForRun` (sim effects plus tags), `loadoutBonus` (start Energy, Bits×, Fast Boot, Second Wind).
  - MetaState v1 gained fields (cards, loadout, presets, packs, pity, freePackAt, starterGiven), filled with defaults by `validateMeta`.
- **Battle:**
  - Bits Plus is applied at payout via `RunOptions.metaBonus`.
  - Fast Boot runs ×4 for the first N waves until the player picks a speed.
  - Second Wind revives on the next frame, outside the event flush.
  - The starter cards are granted at the first death and revealed on Home.
- **Home:**
  - A CARDS tab after the first run: packs (Keys / free ▶AD), 6 slots (the locked ones show LAB), presets (lab), the collection with ★ and copies, and card details with EQUIP / UNEQUIP.
  - The pack reveal.
  - In portrait with 5 tabs the labels are short: RUN, SHOP, LABS, CARDS, SETUP.

## Rulings
- **Ricochet** is +bounce damage (×1.10–1.35), not +1 bounce.
  - **Why:** in M3 a bounce turned out to be a threshold mechanic, and extra bounces break balance.
- **Wave Skip** never skips a boss wave.
- **The loadout lives in the CARDS tab, not a pre-run screen.**
  - **Why:** RUN starts immediately (spec §4 lists a Loadout screen, but instant start matters more on the portals). Changing the loadout is one tap away.
- **Presets:** an empty preset button SAVES the current loadout and a filled one LOADS it. There is no clear button.
- **The free pack's RNG is `Math.random`**, since the meta layer isn't deterministic. That's fine: no leaderboard depends on it.

## Gaps
- The meta sim (`sim:meta`) doesn't model cards or Keys, so B4 doesn't include them.
- No card-specific VFX beyond reusing lightning and pulses (Overclock has no unique visual).

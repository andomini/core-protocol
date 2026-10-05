# Core Protocol — design spec

Date: 2026-10-05 · Status: awaiting owner review · Working title (may change).
Context: `../../research/08-the-tower.md` (The Tower research, gap analysis against Last Tower).

## 0. Agreed with the owner (brainstorming 2026-10-05)
| Question | Decision |
|---|---|
| What's wrong with Last Tower | Both the look (cartoon zombies) and the shallow progression |
| Run length | Like The Tower: an endless run until death, with save, pause and speed |
| Meta in v1 | Workshop + tiers, cards, labs. Ultimate weapons and modules come later |
| Main hook ("more interesting") | Perk synergies in the run: tags, sets, trade-off perks, connected to cards |
| Cards | Keys from play → packs (random with pity); duplicates level cards up |
| Labs | **No timers**: a research tree bought with currency |
| Look | Neon minimalism + theme: **core vs viruses** (cyberspace) |
| Orientation | Both, adaptive (portrait on phones, landscape in desktop iframes) |
| Leaving mid-run | Snapshot at the start of a wave + Continue; small offline Bits income with a cap |
| Rewarded ads | ×2 Bits per run, perk reroll, free card pack, revive / temporary boost |
| Technical approach | New project; proven modules copied from Last Tower; new sim/economy built for big numbers |

**Assumed (not discussed separately):** the portals are CrazyGames and Poki; no login, no IAP; the stack is Phaser 3 + TS, the same as Last Tower; 6–8 weeks of evenings.

## 1. Concept
A glowing hexagonal **core** sits in the center of a neon grid and fires automatically at **viruses** crawling in from the edges. The player spends ⚡ Energy on upgrades during the run, and every 5 waves picks 1 of 3 **protocols** (perks) whose tags build **sets**. After death, ◆ Bits go into the workshop and labs, and 🔑 Keys go into card packs. The player chases the **highest wave on the highest tier**.

How it differs from The Tower: perks from wave 1 rather than wave 200, a tag and set system, no timers or P2W, three currencies instead of 10+, and instant play in the browser.

## 2. The run
### 2.1 Waves
- A wave lasts 26 s of sim time, with 4 s of pause between waves; enemies spawn throughout the wave along the arena perimeter.
- Enemy HP and damage: `base × tierMul × g^wave`, start at `g = 1.045` (wave 10,000 ≈ 1e191 < 1e308). The exact `g` values per tier live in `data/tiers.json` and are tuned with the sim.
- A boss every 10 waves (from tier 3, every 5 under the "Swarm" condition).
- Death: core HP ≤ 0 → Death screen.

### 2.2 Enemies (v1)
| Type | Shape | Role |
|---|---|---|
| Basic | square | baseline |
| Fast | triangle | ×2 speed, ×0.5 HP; punishes low Attack Speed |
| Tank | large square | ×5 HP, slow; punishes low Damage |
| Ranged | rhombus | stops at a distance and shoots; punishes low Range |
| Boss "Worm" | chain of segments | ×40 HP, a large hit on the core, drops 🔑 |

Elites come in v1.1.

### 2.3 In-run upgrades (⚡ Energy), 3 tabs × 6
- **ATK:** Damage, Attack Speed, Crit Chance, Crit Factor, Range, Multishot*
- **DEF:** Health, Regen, Defense %, Thorns, Lifesteal*, Knockback
- **UTIL:** Energy Bonus, Energy/Wave, Interest*, Bits/Kill, Bits/Wave, Free Upgrade*

`*` = locked until the matching lab node. Cost is `base × c^level` with `c` ∈ [1.07, 1.12] per stat. Buying ×1 / ×10 / MAX. Some stats have a max level (Attack Speed, Range, Crit Chance, Defense %, Multishot), raised through the labs.

### 2.4 Protocols (perks) and sets — the main hook
- At wave 1 and then every 5 waves: an overlay with 3 cards (4 with the lab node), choose 1. Reroll: once free with the lab node, plus a rewarded ad.
- Perks stack within the run (max stacks in `data/perks.json`). Rarity Common 70 / Rare 25 / Epic 5, with pity: if no Rare+ in 3 picks, the 4th has one guaranteed.
- Perks that depend on a locked stat (Split → Multishot, Leech → Lifesteal, Compound → Interest) don't enter the pool until the matching lab node is unlocked.
- **Tags:** ⚡ Overload, 🧊 Cryo, 🔗 Chain, 💰 Mining, 🛡 Firewall. Each perk and each tagged card in the loadout counts 1 toward its tag. The HUD shows active sets.

**25 perks (v1):**
| Tag | Perks (the last one is a trade-off) |
|---|---|
| ⚡ | Overclock Rounds (+15% damage) · Burst Fire (+12% attack speed) · Hot Barrel (every 10th shot ×3) · Crit Spike (+5% crit chance) · **Glass Cannon** (+50% damage, −25% max HP) |
| 🧊 | Frost Shot (hit slows 20% for 2 s) · Cold Aura (−15% speed in the inner 40% of range) · Shatter (+30% damage to slowed enemies) · Permafrost (5% chance to freeze for 1 s) · **Deep Freeze** (freeze ×2 longer, −15% attack speed) |
| 🔗 | Bounce (+1 bounce) · Arc (10% chance of lightning on 3 targets, 50% damage) · Split (+1 Multishot target) · Conductive (lightning +1 target) · **Overcharge Link** (+2 bounces, each bounce −40% damage) |
| 💰 | Energy Siphon (+10% Energy per kill) · Compound (+Interest, cap ×1.5) · Bounty (bosses ×2 Energy and Bits) · Data Mine (+15% Bits) · **Greedy Protocol** (+40% Energy, enemies +15% HP) |
| 🛡 | Patch (+Regen) · Hardening (+5% Defense) · Reflect (+10% Thorns) · Leech (+1% Lifesteal) · **Bunker** (+40% HP, −20% Range) |

**Set bonuses (2 / 4 / 6):**
| Tag | 2 | 4 | 6 |
|---|---|---|---|
| ⚡ | +10% damage | crit factor ×1.5 | every 30 s, Overdrive: ×2 attack speed for 8 s |
| 🧊 | slow effects +10% | frozen enemies take +50% damage | every 20 s, freeze everything on screen for 2 s |
| 🔗 | +1 bounce | every crit throws lightning at 3 targets | lightning chain ×2; lightning also hits from the boss |
| 💰 | +10% Energy | +25% Bits at the end of the run | Interest cap ×2; +1 🔑 per boss |
| 🛡 | +10% max HP | Thorns also reflect ranged hits | once every 3 waves, immunity for 3 s |

All numbers are starting points in `data/`, and the sim decides the final values (§7).

### 2.5 Speed, pause, saving the run
- Speed ×1 / ×2 from the start; ×3 / ×4 / ×5 through the labs. Pause is always available.
- **Snapshot** of the world at the start of every wave → localStorage (+ portal storage where available). On return: Continue / Abandon (Abandon = the run ends with the reward for the waves reached). While the tab is closed, the run stands still.

### 2.6 Death screen
Wave, best wave on the tier, ◆ Bits earned, 🔑 earned. Buttons: **Revive** (rewarded, once per run, 50% HP), **×2 Bits** (rewarded), **Workshop**, **New run**.

## 3. Meta
### 3.1 Workshop (◆ Bits)
The same 18 stats, with permanent levels that set the **starting value** of each stat in the run. Cost is `base × w^level`, `w` ∈ [1.10, 1.20]. Locked stats open through labs.

### 3.2 Tiers (6)
- The next tier unlocks at **wave 50** on the current one.
- `tierMul` (enemy HP and damage) and `bitsMul` grow with each tier (`data/tiers.json`).
- From tier 3, each tier adds one condition: T3 viruses regenerate 1%/s; T4 "Swarm" (boss every 5 waves); T5 Ranged shoot ×2 as often; T6 all enemies +25% speed.
- **Milestones** for waves 10 / 25 / 50 / 75 / 100 on each tier → 🔑 (the main free source of cards).

### 3.3 Labs — no timers (25 one-time nodes, ◆ Bits)
| Branch | Nodes |
|---|---|
| Speed (3) | ×3, ×4, ×5 |
| Arsenal (6) | unlock Multishot, Lifesteal, Interest, Free Upgrade; +10 max level Attack Speed; +10 max level Range |
| Protocols (5) | 4 perk choices; free reroll per run; perks every 4 waves; banish (remove 1 perk from the pool); +1 extra Rare chance |
| Cards (5) | slots 3, 4, 5, 6; loadout presets |
| Economy (6) | Bits +10% ×3 nodes; offline cap 8 h; offline cap 12 h; +starting Energy |

Some nodes require previous ones (a tree, `data/labs.json`).

### 3.4 Cards (20)
- A pack = 3 cards for 🔑 (price in `data/cards.json`). Rarity Common 10 / Rare 7 / Epic 3 card types; a guaranteed Epic every 10 packs (pity). Free pack: rewarded, once every 4 h.
- Duplicate → card level ★1→★5 (the effect grows). Slots: 2 at the start, up to 6 through labs. The loadout is chosen before the run and fixed for the run.
- A tagged card counts 1 toward its tag's set.

| Tag | Cards |
|---|---|
| — | Damage · Attack Speed · Health · Regen · Energy Start · Intro Sprint (first 20 waves at ×4) · Second Wind (free revive) · Wave Skip (5% chance to skip a wave with the reward) · Bits Plus |
| ⚡ | Overclock (×3 damage for 15 s every 2 min) · Demon Core (below 10% HP: ×2 damage) · Critical Mass (+crit factor) |
| 🧊 | Cryo Field (slow near the core) · Time Dilation (enemies −10% speed) |
| 🔗 | Tesla Coil (lightning on the nearest enemy every 3 s) · Ricochet (+1 bounce) |
| 💰 | Crypto Miner (boss ×3 Bits) · Compound Card (+Interest cap) |
| 🛡 | Barrier (shield = X% HP at the start of each wave) · Spikes (+Thorns) |

### 3.5 Offline
Away from the game: ◆ Bits = `rate × min(time away, cap)`, where `rate` comes from the best wave on the highest tier. Cap 4 h → 8 h → 12 h (labs). The "Offline income" modal shows Claim and Claim ×2 (rewarded).

### 3.6 Not in v1 (v1.1+)
Ultimate weapons, modules, elites, daily missions, weekly seeded challenge + leaderboard (Rust backend), themes/cosmetics.

## 4. Screens and UI
1. **Home**, with a tab bar: ⚔ Battle (tier choice, Continue) · 🔧 Workshop · 🧪 Labs · 🃏 Cards · ⚙ Settings.
2. **Loadout** before the run: card slots, presets, a hint showing which sets the cards feed.
3. **Battle:** top HUD (wave, wave timer, ⚡, HP, active sets, speed, pause); the arena; the upgrade panel with ATK/DEF/UTIL tabs, ×1/×10/MAX, rows `Name  value→next  ⚡price`.
4. **Protocol pick:** overlay with 3–4 cards, tag on each card, set progress (`🔗 3/4`), Reroll.
5. **Death**, **Offline income**, **Settings** (sound, music, number format, "Reduce motion").

**Layout** is chosen once at load from the window proportions:
- **Portrait 720×1280:** arena takes the top ≈55%, panel at the bottom, minimum text 28 px.
- **Landscape 1280×720:** arena on the left ≈60% of the width, panel in the right column, minimum text 16 px (the 907×510 CrazyGames iframe).

**Style:** dark navy background with a faint grid; core in cyan; viruses in magenta, yellow and red; death = pixel scatter + a short glitch; monospace or techno font for numbers (OFL); number suffixes K/M/B/T/aa…. No sprite files: shapes are procedural, glow is baked into textures at boot, ADD blending.

## 5. Architecture
```
core-protocol/
  src/sim/      pure sim: 30 ticks/s, commands → state + events; snapshot/restore
  src/data/     JSON + schemas: stats, enemies, tiers, perks, sets, cards, labs, economy
  src/meta/     workshop, labs, cards/packs/pity, wallet, offline, save, migrations
  src/render/   Phaser: baked neon textures, entity pools, particles, glitch, interpolation
  src/ui/       layout (portrait/landscape), panels, overlays, number format
  src/portal/   copy from Last Tower: Portal, Local/Crazy/Poki adapters, adPolicy, storage
  src/telemetry/ copy from Last Tower
  tools/sim/    bots + balance reports; tools/size.ts; portal build check
  tests/
```
- **Copied from Last Tower** (adapted to the new code, not a shared package): `portal/*`, `rng.ts` (seeded streams), `telemetry/*`, `render/resolution.ts`, the `tools/sim` pattern, `size.ts`, `check-portal-builds.ts`.
- **Numbers:** `float64`. In `src/sim` only `+ − × ÷ Math.sqrt Math.floor/ceil/min/max/abs`; no `Math.random/pow/exp/log/sin/cos/atan2`, Phaser, DOM or Date — enforced by an ESLint rule + `tests/purity.test.ts`. Powers via our own `powInt` (exponentiation by squaring); angles for Multishot/lightning via precomputed tables or vectors.
- **Effects are data-driven:** perks, sets, cards and labs are described in JSON with a limited set of effect types (`statAdd`, `statMul`, `onHit`, `onCrit`, `onKill`, `periodic`, `conditional`, `unlock`, `ruleChange`). No balance numbers in code.
- **Speed:** the sim runs k ticks per frame (k = speed), render interpolates the latest state. Collisions use a spatial hash. Entity pools.
- **Save:** meta → after every purchase/claim, versioned with migrations; run → snapshot at the start of a wave. Storage through `portal/storage` (localStorage + CrazyGames data where available).
- **Ads:** only through the copied `adPolicy` (pause on request, mute on `adStarted`, "No ad right now" toast on failure).

## 6. Tests
- **Determinism:** same seed + command log → same state hash every 100 ticks (10 min of play); golden replay in `tests/replays/`.
- **Snapshot:** save at wave N → restore → continue = the same hash as a run without interruption.
- **Purity:** `src/sim` has no forbidden APIs (lint + test).
- **Unit:** cost/value formulas, `powInt`, number format, workshop, labs (tree dependencies), packs + pity, set counting (perks + cards), offline income with cap, save migrations.
- **Sim:** bot policies `greedy`, `atk-first`, `def-first`, one per tag (`tag:chain` …), `random` → `reports/*.md|csv`.
- **Stress:** 200 enemies at ×5 — 60 FPS on desktop, record the phone-emulation result.
- **UI smoke** (Playwright): portrait and landscape, home → loadout → run → protocol pick → death → workshop.

## 7. Balance targets (assumptions to check with the sim and playtests)
| # | Target |
|---|---|
| B1 | First protocol pick ≤ 30 s after loading |
| B2 | First run: death at waves 12–20 (≈6–10 min at ×1, 30 s per wave including the pause) |
| B3 | Every return session (≤ 5 min) → at least one noticeable purchase in Workshop/Labs |
| B4 | Tier 2 opens after ≈1.5–3 h of total play (greedy bot + meta) |
| B5 | Average run: 2-set by wave 15, 4-set by wave 40 |
| B6 | No dominant tag: median wave of tag bots within ±20% of each other |
| B7 | At the end of v1 content, a run lasts ≈30–60 min of real time at ×5 |
| B8 | Initial download ≤ 1 MB; time to first input ≤ 5 s on Slow 4G |

## 8. Milestones (6–8 weeks of evenings)
| | Content | Acceptance |
|---|---|---|
| M0 | Scaffold, copied modules, lint, `test/build/size` | sim lint fails on `Math.random`; builds work |
| M1 | Sim: core, 5 enemies, waves, combat, big numbers, snapshot | determinism + snapshot tests ✅; sim smoke in Node |
| M2 | 18 stats, battle UI in both orientations, neon render, ×1/×2 | stress 200 enemies; UI smoke for battle |
| M3 ⛔ | Protocols, tags, sets, boss | sim: B1, B2, B5, B6 ✅ |
| M4 | Workshop, 6 tiers, labs, meta save, offline | sim with meta: B3, B4 ✅ |
| M5 | Cards, packs + pity, loadout, presets | unit tests for packs/pity; tag cards count toward sets |
| M6 | Portals, ads, telemetry | portal build check; ads per the rules |
| M7 | Juice, first 5 minutes, tutorial hints | B1, B8 ✅ on a production build |
| M8 | Playtests, balance, covers, submission | B7 checked; portal checklist |

**Cut list if we fall behind:** 12 cards instead of 20 → 4 tiers instead of 6 → 15 lab nodes instead of 25. We **do not cut**: both orientations, tags/sets, saving the run.

## 9. Open questions (outside this spec)
- **Portal path / Poki exclusivity:** Core Protocol hasn't been live anywhere, so it could be the candidate for a Poki exclusive. The owner decides before M6.
- **Final name:** check name uniqueness on both portals before covers (M8).

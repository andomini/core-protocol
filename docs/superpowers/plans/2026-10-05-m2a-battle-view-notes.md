# M2a — neon battle view: notes

Branch `m2a-battle-view`, commits `9a0de0e..83fb861` (+ this notes commit). Tests 73 → 108. `npm run typecheck`, `build`, `build:crazygames` and `build:poki` are green. `npm run ui` passes 30/30.

## What exists now
- **Boot → Battle.** `src/main.ts` picks the orientation once from the window aspect. The canvas renders at device pixels: `RS = cssScale × DPR`, capped at 3, and every scene camera is zoomed by RS. Scaling is `Phaser.Scale.FIT` + `CENTER_BOTH`, so the game letterboxes and never crops.
  - `BootScene` bakes every texture with canvas `shadowBlur` at RS. It then waits for the fonts (Orbitron, Chakra Petch; OFL, self-hosted in `public/fonts`) with a 2.5 s cap.
- **Layout (pure, `src/ui/layout.ts`).** `makeLayout(o, data)` returns the HUD, arena and panel rects plus `cx`, `cy`, `scale` and `minFont`. `worldToScreen` and `circleInRect` go with it.
  - Portrait 720×1280: HUD 0–136, arena 136–840 (704 px = 55 %), panel 840–1280.
  - Landscape 1280×720: arena x 0–768 (60 %) at full height; the right column holds the HUD (208 px) and then the panel.
- **Number format (`src/ui/format.ts`).** `formatNum` gives 999 · 1.23K · 12.3M · … T · aa … zz, truncated to 3 significant digits. It handles negatives and non-finite values.
- **Loop.** `src/render/loop.ts` is Last Tower's `FixedLoop`; speed 0 means paused. `src/render/RunSession.ts` owns the World and routes events **after every step**. Outside the World it keeps:
  - `prevOf(id)`: the position at the start of the last tick, for interpolation;
  - `lastKnown(id)`: works for enemies removed in that tick, so a `kill` is drawn where the enemy died;
  - `spawn(kind, n, sink, dir?)` and `restart(opts)`.
- **Render.**
  - `WorldView`: grid with moving data pulses, vignette, scanlines and arena corner brackets. The core is a rotating hex with an inner hex, a tick ring and a light pool, inside a dashed range ring with orbiters.
  - Enemies by kind. The boss worm has 6 segments that follow a render-only trail with a lateral wiggle, a glowing spine, an HP bar and a `WORM.EXE` label. Small HP bars show only on damaged enemies.
  - Tracers, spawn fade/pop-in, white hit flash, and core flash plus shake.
  - `Effects`: pixel bursts (particle emitters), a ~110 ms RGB-split glitch per death (pooled copies), ranged beams, core-hit rings, muzzle flare and a breach explosion.
  - Pools: `ImagePool` for enemies, boss segments, tracers and glitch copies; a fixed array of transient records for beams and rings.
- **UI.**
  - `Hud`: wave number, seconds left, a wave/break timer bar (cyan for the wave, amber for the break), the HP bar with numbers and a trailing damage segment, Energy, ×1/×2, and pause (Space also pauses, S cycles speed).
  - An empty "UPGRADES — M2b" panel frame.
  - `DeathOverlay`: "CORE BREACHED" with a glitch, wave reached, kills, Energy, Bits, and RESTART (new seed).

## Rulings
| Decision | Why | Cost if wrong |
|---|---|---|
| `config.spawnRadius` 560 → 380 | The ring now sits just past the arena edge. Sim smoke for seeds 1–3: death wave 7/7/7 → 6/6/7, because enemies arrive about 4 s sooner. | M3 balance tuning starts from slightly harder waves; it's one data value. |
| The view scale is derived as `(halfLong + 24) / spawnRadius` (portrait 1.011, landscape 1.074) | Axis-aligned spawns start off-screen on every side. The worst case is 0.40 s (portrait) / 0.70 s (landscape) until the first enemy is visible, proven over all 64 directions plus the real sim on 10 seeds (`tests/spawnVisibility.test.ts`). | Changing `spawnRadius` rescales the whole view. `tests/layout.test.ts` guards that the range circle fills the arena and enemies stay ≥ 12 px. |
| Corners can show a fresh spawn | Hiding the corners too would need a ring at about 500 px, which breaks the 1 s rule. Spawns fade and pop in over 260 ms, so this reads as "materialising". | The smoke's `firstVisibleSimS` is about 0 because corner spawns are visible at once; that is expected. |
| Viruses use **NORMAL** blending; the core, tracers, particles, beams, rings and pulses use ADD | ADD (as the brief asks) blew dense piles out to white (seen in the stress screenshot). The glow is still baked in, so they still read as neon. | Reverting is one pool argument in `WorldView`. |
| `ENEMY_VIS` 1.2 and `CORE_VIS` 1.15: shapes are drawn larger than the sim radius | Readability on a 390-px-wide phone. | Contact looks like slight overlap at the core rim. Purely visual. |
| Landscape HUD lives in the right column, not as a top strip | The arena stays nearly square (768×720), so the ring margin is about equal on all sides. | M2b panel space is 512×512 under the HUD. |
| Portrait panel is 440 px tall | The arena takes 55 % and the HUD 136 px. | M2b's 6 rows at 28 px plus tabs is tight (~60 px per row). Shrink `PORTRAIT_HUD_H` or move ×1/×10/MAX into the tab row if needed. |
| Speeds in `src/data/battle.json` (`speeds [1,2]`, `maxSpeed 5`); dev knobs in `src/data/dev.json` | No numbers in code. `dev.json` is referenced only behind `import.meta.env.DEV`, so it is absent from production bundles. | — |
| Dev hooks only under `import.meta.env.DEV` (not `?debug=1`) | Fully stripped: `grep __cp dist/*/assets/*.js` = 0. | Debugging a production build needs a dev build. |
| The harness auto-picks the newest cached `~/.cache/ms-playwright/chromium-*/chrome-linux64/chrome` | playwright-core 1.63.0 expects revision r1243, but only r1228 is installed (Merge Wall has the same problem). `CHROMIUM_PATH` overrides. | None while the API stays compatible. |
| Hit flash = `setTintFill(white)`; core flash = a pink tint (not a fill) | A white fill on the core's glow halo looked like a blob. | — |

## Performance (stress)
`?stress=1` keeps 200 enemies (basic/fast/tank/ranged) topped up on the ring. Enemy HP is ×4, the core has 1e12 HP and fires 10 shots/s, and the run goes at ×5. The FPS readout sits bottom-left.
- **Desktop 1280×720: 60.0 FPS** average over 5 s.
- **Phone emulation (390×844 at DPR 3, 4× CPU throttling): 60.0 FPS.**
- Caveat: 60 is the rAF cap. The host GPU is an RTX 4090 (ANGLE/Vulkan) and the phone run only throttles the CPU, so no headroom was measured and real-phone GPU fill rate is untested. Check on a device in M7.

## Dev hooks and flags (DEV builds only)
- `window.__cp`:
  - `ready()`
  - `state()`, which returns `{scene, orientation, wave, tick, phase, enemies, visible, projectiles, dead, overlay, kills, energy, bits, coreHp, speed, paused, fps, seed}`; `visible` counts enemies whose circle touches the arena rect;
  - `setSpeed(n)` (1…`maxSpeed`), `pause(on = true)`, `spawn(kind, n, dir?)` (`dir` is a direction-table index: 0 = +x, 16 = +y), `restart()`, `game`.
- Query flags: `?stress=1`, `?weak=1` (core 5 HP, no regen, 0.3 shots/s), `?seed=N`.

## Smoke
`npm run ui [-- --only portrait|landscape|stress]` starts its own Vite server (or set `UI_BASE`). It checks:
- **Portrait phone:** boot, every Text object ≥ 28 px, an enemy visible ≤ 2 s, the speed and pause buttons via real taps, the wave advancing at ×5, death overlay on `?weak=1`, and RESTART giving a new seed. No console errors.
- **Landscape 1280×720 and 907×510:** the same boot, text (≥ 16 px), speed and wave checks, plus the death overlay at 907×510.
- **Stress:** desktop and throttled phone.

Results go to `reports/ui-smoke.json`. Screenshots go to `reports/screens/*.jpg` (committed, JPEG q82, < 200 KB), with full PNGs in `.superpowers/screens/`.

## Known gaps / for M2b
- The upgrade panel is a placeholder; Energy accumulates but is never spent.
- The sim fires 1 shot/s at the start, so early waves look calm. Upgrades will bring the action.
- Pause/resume does not persist; there is no snapshot save yet (spec §2.5).
- No audio and no "reduce motion" setting yet. Camera shake (boss kill, breach) ignores it.
- The phone GPU budget is unmeasured (see Performance).
- `RunSession.lastKnown` falls back to a linear search for enemies spawned in the same tick (rare; dev spawn only).
- Production bundle is 1.25 MB of JS, mostly Phaser. B8 (≤ 1 MB initial) is M7 work.

# Core Protocol M2a — neon battle view on the existing sim

**Goal:** a running, good-looking neon battle on top of the M1 sim, in both orientations, with HUD, speed/pause, death overlay, dev hooks, a stress mode and a Playwright smoke. No upgrades or economy (M2b).

**Spec:** §2.1–2.2 (waves, enemies), §4 (screens, layout, style), §5 (render architecture), §6 (stress, UI smoke), §8 M2.

## Tasks

| # | Task | Files | Tests |
|---|---|---|---|
| 1 | Layout math (pure): orientation, logical size, HUD / arena / panel rects, world scale, world→screen, min font size | `src/ui/layout.ts` | `tests/layout.test.ts`: rects tile the screen without overlap, arena ≈55 % height (portrait) / 60 % width (landscape), core at arena centre, fonts ≥ 28 / 16 |
| 2 | Spawn ring vs visible arena (data + pure proof) | `src/data/config.json` (`spawnRadius`) | `tests/spawnVisibility.test.ts`: analytic worst case over the 64 directions with basic speed and the first spawn tick ≤ 1 s, in both orientations; integration: step the real sim for `tickHz` ticks on several seeds, an enemy circle intersects the arena rect; the ring is outside the short edge and the range circle is fully inside |
| 3 | Number format (pure): K/M/B/T, then aa…zz, truncated to 3 significant digits | `src/ui/format.ts` | `tests/format.test.ts` |
| 4 | `FixedLoop` (copied from Last Tower) + `RunSession` (owns World, steps, routes events after every step, keeps previous positions per entity id outside World, dev spawn) | `src/render/loop.ts`, `src/render/RunSession.ts` | `tests/loop.test.ts`, `tests/runSession.test.ts` |
| 5 | Boot + scaling: orientation chosen once, HiDPI canvas (RS zoom, `resolution.ts`), FIT letterbox, baked neon textures (canvas `shadowBlur`), self-hosted OFL fonts (Orbitron, Chakra Petch) | `src/main.ts`, `src/render/resolution.ts`, `src/render/palette.ts`, `src/render/textures.ts`, `src/render/scenes/BootScene.ts`, `index.html`, `public/fonts/*` | smoke |
| 6 | WorldView: grid, core, range ring, enemies by kind, boss worm, tracers, hit flash, death pixels + glitch, ranged beam, core hit flash/shake, pools | `src/render/WorldView.ts`, `src/render/effects.ts`, `src/render/pools.ts` | smoke + screenshots |
| 7 | HUD (wave, timer bar, HP bar, Energy, ×1/×2, pause), empty upgrade panel frame, death overlay with RESTART | `src/ui/Hud.ts`, `src/ui/kit.ts`, `src/ui/DeathOverlay.ts`, `src/render/scenes/BattleScene.ts` | smoke |
| 8 | Dev hooks `window.__cp` (DEV only), `?weak=1`, `?stress=1` (200 enemies, immortal core, ×5, FPS readout) | `src/render/devHooks.ts`, `src/render/devData.ts` | smoke; grep of `dist/` for `__cp` = 0 |
| 9 | Playwright smoke (`npm run ui`): portrait phone, landscape 1280×720 and 907×510, stress FPS, screenshots → `reports/screens/` | `tools/ui/harness.mjs`, `tools/ui/smoke.mjs` | — |
| 10 | Look iteration on screenshots; notes | `docs/superpowers/plans/2026-10-05-m2a-battle-view-notes.md` | — |

## Interfaces

- `layout.ts`: `chooseOrientation(w, h)`, `makeLayout(o, data)` → `{ o, w, h, hud, arena, panel, scale, cx, cy, minFont }`; `worldToScreen(L, x, y)`; `circleInRect`.
- `RunSession`: `constructor(data, opts)`, `world`, `advance(ticks, onEvent)`, `prevOf(id)`, `spawn(kind, n, onEvent)`, `restart(seed)`.
- `FixedLoop.frame(dtMs, speed) → ticks`, `alpha()`.
- Render reads `World` only; never mutates it. All render randomness uses `Math.random` outside `src/sim`.

## Dev flags (DEV builds only)
`?weak=1` core health override, `?stress=1` stress run, `?seed=N` fixed seed, `?o=portrait|landscape` (not needed: the smoke sets the viewport).

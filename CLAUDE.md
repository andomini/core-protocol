# Core Protocol

Neon idle tower defense for CrazyGames/Poki: a core in the center versus viruses, an endless run, workshop/labs/cards, perks with tag sets.
Spec: `docs/superpowers/specs/2026-10-05-core-protocol-design.md`. Plans: `docs/superpowers/plans/`.

## Commands
- `npm run dev` — dev server (LAN-visible)
- `npm test` — vitest (determinism, snapshot, sim purity, data)
- `npm run typecheck`, `npm run build` (`build:crazygames`, `build:poki`)
- `npm run sim:smoke -- <seed> <tier> [policy] [--unlockall]` — one run until death in Node (policy: none|greedy|atk-first|def-first|round-robin)
- `npm run sim:balance` — bot policies × 24 seeds → `reports/balance-m2b.md` (B2 check)
- `npm run sim:balance -- --crystal arrange` adds the fusion-pick + hill-climb arrange player and per-fusion tier columns; `npx tsx tools/sim/crystalGeometry.ts` → `reports/crystal-geometry.md` (pairs touchable with one cluster per tag, modules for a 7-link pair)
- `npm run replay:record -- --update` — re-record `tests/replays/golden-01.json` (only for a deliberate sim/data change)
- `npm run ui` — Playwright UI smoke, both orientations + portal checks (starts its own Vite server on `UI_PORT`, default 5180; `-- --only portal`)
- `npm run build:all`, `npm run package` → `dist/core-protocol-<portal>.zip`; every build runs `tools/postbuild.mjs` (size ≤ 1 MB transfer, one SDK, no dev hooks, relative paths)
- `npm run ui:portal-build` — production CrazyGames/Poki builds with a stubbed and a blocked SDK (build first)
- `npm run telemetry:report -- <export.json>…` → `reports/telemetry-<date>.md`

## Запуск локально
- `npm run dev:up` — idempotent: starts Vite detached on :5173 (logs `.dev/vite.log`) only if not already running, prints URL; `dev:status`, `dev:stop`.

## Desktop widget
- `?widget=1` (any build; code lives on the local branch `widget`: `src/render/widget.ts` + `src/data/widget.json`): no pause when hidden (setTimeout loop), auto-pick after 5 s, auto-restart 8 s after death, Home → back to play after 2 min idle, live state in `document.title`. Auto-buy in a run only for stats marked by tapping a row's glyph (AUTO badge; A pauses all); after each run Bits go to workshop levels / lab nodes marked AUTO on Home (cheapest first). Nothing is marked by default.
- `~/.local/bin/core-protocol` [toggle|start|install|stop|status]: Chrome `--app` with its own profile in `~/.local/share/core-protocol-widget` (save on disk), on Hyprland `special:core`, Super+G.
- `scripts/widget-install.sh` (hooks post-commit/post-merge/post-rewrite on main, or `npm run widget:install`): merges main into `widget` in the worktree `~/.local/share/core-protocol-widget/build`, builds, swaps `app/`; the open widget reloads within 30 s (run saved). A merge conflict keeps the old build — see `install.log`. `npm run widget:install -- --wip` builds the *uncommitted* working tree of main instead (for trying WIP in the widget).

## Rules
- `src/sim` is pure and deterministic: only + − × ÷, Math.floor/ceil/min/max/abs/imul; roots via `dsqrt`, powers via `powInt` (`src/sim/num.ts`). No Math.random/sqrt/pow/trig, `**`, Date, DOM. Checked by `tests/purity.test.ts`.
- All balance numbers live in `src/data/*.json`, never in code.
- Cost curves (`stats.json` cost, `meta.json` workshop) are `base·growth^L` up to `knee`, then `growthAfter` per level (`curveSum` in `src/sim/stats.ts`); workshop mastery (`meta.json` workshop.mastery: ×mul per `every` levels) reaches the sim as `mul` mods with source `mastery`. Check pacing with `npm run sim:progression -- --players 20 --hours 150 --endless` (~1 h).
- All sim values pass through `clampValue` (≤ 1e300); a NaN throws.
- World state is plain JSON: no classes, Map/Set or functions inside `World`. It stores stat *levels*; values come from `effectiveStats` (`src/sim/stats.ts`).
- Ads only through `services.ads` (`src/portal/ads.ts`); saves only through `SaveSlot` over `services.storage` (`src/portal/storage.ts`). See `docs/superpowers/plans/2026-10-05-m6-portals-notes.md`.
- Player actions reach the sim only as `Command`s via `RunSession.queue` (logged with their tick → replayable).

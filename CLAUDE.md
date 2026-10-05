# Core Protocol

Neon idle tower defense for CrazyGames/Poki: a core in the center versus viruses, an endless run, workshop/labs/cards, perks with tag sets.
Spec: `docs/superpowers/specs/2026-10-05-core-protocol-design.md`. Plans: `docs/superpowers/plans/`.

## Commands
- `npm run dev` — dev server (LAN-visible)
- `npm test` — vitest (determinism, snapshot, sim purity, data)
- `npm run typecheck`, `npm run build` (`build:crazygames`, `build:poki`)
- `npm run sim:smoke -- <seed> <tier> [policy] [--unlockall]` — one run until death in Node (policy: none|greedy|atk-first|def-first|round-robin)
- `npm run sim:balance` — bot policies × 24 seeds → `reports/balance-m2b.md` (B2 check)
- `npm run replay:record -- --update` — re-record `tests/replays/golden-01.json` (only for a deliberate sim/data change)
- `npm run ui` — Playwright UI smoke, both orientations (starts its own Vite server)

## Rules
- `src/sim` is pure and deterministic: only + − × ÷, Math.floor/ceil/min/max/abs/imul; roots via `dsqrt`, powers via `powInt` (`src/sim/num.ts`). No Math.random/sqrt/pow/trig, `**`, Date, DOM. Checked by `tests/purity.test.ts`.
- All balance numbers live in `src/data/*.json`, never in code.
- All sim values pass through `clampValue` (≤ 1e300); a NaN throws.
- World state is plain JSON: no classes, Map/Set or functions inside `World`. It stores stat *levels*; values come from `effectiveStats` (`src/sim/stats.ts`).
- Player actions reach the sim only as `Command`s via `RunSession.queue` (logged with their tick → replayable).

# Core Protocol

Neon idle tower defense for CrazyGames/Poki: a core in the center versus viruses, an endless run, workshop/labs/cards, perks with tag sets.
Spec: `docs/superpowers/specs/2026-10-05-core-protocol-design.md`. Plans: `docs/superpowers/plans/`.

## Commands
- `npm run dev` — dev server (LAN-visible)
- `npm test` — vitest (determinism, snapshot, sim purity, data)
- `npm run typecheck`, `npm run build` (`build:crazygames`, `build:poki`)
- `npm run sim:smoke -- <seed> <tier>` — a run without upgrades until death in Node

## Rules
- `src/sim` is pure and deterministic: only + − × ÷, Math.floor/ceil/min/max/abs/imul; roots via `dsqrt`, powers via `powInt` (`src/sim/num.ts`). No Math.random/sqrt/pow/trig, `**`, Date, DOM. Checked by `tests/purity.test.ts`.
- All balance numbers live in `src/data/*.json`, never in code.
- All sim values pass through `clampValue` (≤ 1e300); a NaN throws.
- World state is plain JSON: no classes, Map/Set or functions inside `World`.

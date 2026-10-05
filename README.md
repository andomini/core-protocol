# Core Protocol

A neon idle tower-defense game for web portals (CrazyGames, Poki). A glowing core in the middle of cyberspace fends off viruses in an endless run. Between waves you install **protocols**: perks with tags that build 2/4/6 **set bonuses**. Between runs you grow through the **workshop**, **labs** and **cards**.

**Dev preview:** https://andomini.github.io/core-protocol/ — the local build without portal SDKs (ads are simulated).

## Stack
Phaser 3.90 · TypeScript (strict) · Vite · Vitest · Playwright (UI smoke). The simulation in `src/sim` is pure and deterministic: only + − × ÷, a custom `dsqrt` and `powInt`, seeded RNG streams, and a JSON World. It is checked by a purity test, a golden replay and determinism tests.

## Commands
| | |
|---|---|
| `npm run dev` | dev server |
| `npm test` | vitest: sim, meta, portal, layout |
| `npm run ui` | Playwright UI smoke in both orientations |
| `npm run ui:loadtime` | load time on Slow 4G with a 4× slower CPU (B8) |
| `npm run sim:balance` / `sim:meta` | bot balance reports for the first run and for meta progress |
| `npm run build:all` / `npm run package` | portal builds and zips for CrazyGames and Poki |

## Docs
- Preview deploy: `tools/deploy-pages.sh` (branch `gh-pages`).
- Spec: `docs/superpowers/specs/2026-10-05-core-protocol-design.md`
- Plans and per-milestone notes (rulings, gaps): `docs/superpowers/plans/`
- Research: `../research/08-the-tower.md` (in the parent workspace)

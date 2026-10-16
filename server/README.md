# Core Protocol leaderboard server

A Cloudflare Worker with D1 (free plan) and its own package (the game's root `package.json` does not use it).
Design and API: `docs/superpowers/specs/2026-10-16-leaderboards-design.md`.
Deploy and verifier: `verifier/README.md`.

- `npm test` runs the API tests against an in-memory SQLite fake of D1 (`test/d1fake.ts`, `node:sqlite`) plus the verifier pass logic.
- `npm run typecheck`
- `npm run db:migrate:local && npm run dev` starts wrangler dev with a local D1 on :8787.
  workerd needs its install script: run `npm install-scripts approve` (or `npm rebuild workerd`) once.
  Put `ADMIN_TOKEN=dev` in `.dev.vars`, which is git-ignored.

# M7 — Juice, audio, first minutes: notes

Tests: 383 · `npm run ui` 189/189 · `npm run ui:loadtime` (B8): **3.0 s** to `loadingFinished` on Slow 4G with CPU ×4, **404 KB** transferred → PASS.

## What exists
- **Audio:** `src/render/audio.ts`, ported from Last Tower: Web Audio, 0 KB of files.
  - Sounds: shot, crit, kill, boss, bossDie, core hit, wave, upgrade (pitch rises with level), perk, set, zap (lightning), freeze, coin (wave skip), pack, click, death.
  - Music: a synthwave loop that's muffled below 30 % HP.
  - Unlocked on the first gesture. It respects the sound/music settings, the portal mute and ads (`services.audio`).
- **Settings:**
  - Sound and music apply immediately.
  - "Reduce motion" turns off camera shake.
- **Juice:** crit damage numbers (`DamageNumbers`, a pool of 18 with throttling); banners for OVERCLOCK, SECOND WIND and WAVE SKIPPED; the Tesla bolt is drawn from the core.
- **First-run hints** (`Hints`), only in the first run, one at a time with a pulsing ring:
  - spend Energy (on an affordable upgrade);
  - speed ×1 (from wave 3);
  - low HP → DEF;
  - the set chips (when the first set comes online).
- **Button clicks:** a global kit hook (`setButtonPressHook`).

## Gaps (M8 / later)
- No recorded audio: the SFX are synthesised and simple.
- B7 (run length at the end of v1 content) wasn't measured: the meta sim doesn't model cards or late tiers.
- No covers or trailer for the portals (M8).

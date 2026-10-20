# Uniqueness plan, item 14 — B3 notes (designed SFX, a second music layer, card and verb VFX)

Everything is procedural: Web Audio for the sound and Phaser Graphics for the visuals. There are no asset files, so the
build adds 0 KB of assets (postbuild: 476 KB gz initial download).

## Voice palette (`src/render/audio.ts`, the `VOICES` table)
A voice has 1–6 layers. Each layer is an oscillator or the shared 0.5 s noise buffer, with an optional filter envelope
(LP/BP/HP from `f0` to `f1`), an attack/decay gain envelope (3 ms attack by default, so it never clicks) and an
optional `delay` for arpeggios.

| Family | Sound | Voices |
|---|---|---|
| player | clean and bright: triangle/sine with octave partials, short | shot, crit, upgrade, perk, rare, epic, set, pack, coin, wave, zap, freeze, boot, fusion, pulse×6 |
| virus | gritty and organic: saw/square through a closing LP or BP, a noise squelch, more pitch variance (±8 % vs ±3 %) | hit, kill, wallHit, boss, bossDie, mutation, death, heartbeat |
| ui | soft: a sine tick plus a breath of high noise; bell chimes | click, mission |

New verbs:
- `boot`: a sine power-on sweep, then a confirm blip and an air burst.
- `fusion`: a rising two-note chord (C5+E5, then G5+B5) with a shimmer.
- `mutation`: two detuned saws drift into a warped tritone while a sub sinks.
- `mission`: a C6–E6–G6–C7 bell chime.
- `pulse<Tag>` (`pulseSfx(tag)`), one per tag:
  - overload: a sub boom;
  - cryo: a falling bell cascade over glassy noise;
  - chain: a saw sweep up and back;
  - mining: 5 rising coin pings;
  - firewall: a detuned saw hum with the filter opening.
- `pulse`: the plain voice when no tag dominates.

The existing `Sfx` names are unchanged; the union only gained these new names.

**Voice cap (`VoiceLimiter`, pure, unit-tested).** Every voice has a priority:
- 0: spam (shot, hit, crit, kill, wallHit, zap);
- 1: normal;
- 2: verbs and events.

Every voice also has a minimum retrigger `gap` (25–60 ms for spam). The rules:
- the same voice plays at most 4× at once;
- at most 16 voices play at once;
- spam never takes the last 4 slots;
- priority 2 ignores the global cap, but the gap and the same-voice cap still apply.

The limiter only stores end times in fixed arrays: no `setTimeout` per sound (the old code had one) and no allocation.
A `DynamicsCompressor` (−14 dB, 6:1) on the master catches stacking. The widget (`?widget=1`) runs a "lite" bus: 6 voices,
2 of the same voice, no music layer 2 and no stingers.

## Music layers
- Layer 1 (unchanged pattern): an octave bass plus a square lead, 8 steps.
- Layer 2 (new) has its own gain and resonant LP filter, routed into the music bus:
  - an 8th-note square arpeggio up the chord, an octave above the pad;
  - a detuned saw pad on root and fifth, held over each 2-step chord (Am Am F G).
- `musicPlan(wave, boss)` (pure, tested) sets the layer-2 level, its cutoff and the step length:

| From wave | layer 2 | cutoff (Hz) | step (s) |
|---|---|---|---|
| 0 | 0 | 900 | 0.26 |
| 10 | 0.55 | 1400 | 0.26 |
| 20 | 0.70 | 2200 | 0.245 |
| 40 | 0.85 | 3400 | 0.23 |
| 80 | 1.00 | 5000 | 0.215 |

  - Boss waves: layer 2 is at least 0.8, cutoff ×1.6 (≤ 8 kHz), step ×0.94.
  - Changes glide (`setTargetAtTime`, τ 1.2 s).
- Stingers go through the music bus, so the music setting mutes them:
  - `boot`: a fast Am arpeggio up to a held A5. It plays at `runStart`, i.e. scene create and restart.
  - `death`: a falling minor line into a low drone. It also drops layer 2.
- Mute, settings and ads work as before: everything sits under `sfxGain`/`musicGain`, which `apply()` drives. The
  low-HP muffle filter covers both layers.
- After a stall (hidden tab), the scheduler skips ahead instead of firing a burst of late notes.

## VFX (`src/render/vfx.ts`; `effects.ts` untouched)
- `Vfx` is a pool of 40 records drawn into one ADD Graphics at `DEPTH.fx + 0.3`. When idle, `update()` returns at
  once. Its effects:
  - **Pulse per tag**: overload is a hot flash with a thick shock front; cryo is 12 ice spikes on the front around a
    turning hex; chain is a jagged ring re-rolled each frame; mining is 10 spinning gold diamonds riding the ring;
    firewall is a hex wall that expands, holds and fades. An echo ring follows 90 ms behind, and a ring comes off the
    HUD Pulse button. This replaced the `fx.pulse` call at the same `case 'pulse'` site.
  - **Docking**: on `perkPicked` with a module, a hex frame clamps from 2.4R onto the hex, then a white fill flashes
    with a ring. The boot pick's 3 modules stagger by 130 ms (`dockN` counts docks per frame).
  - **Fusion link**: a glow along the first link, two heads in the two tag colours meeting at the seam, and a seam
    burst. It is added in `fusionOnline` alongside the existing arcs and rings.
- `CardFx` is an ADD Graphics over the pick overlay that ticks itself on the scene `update` only while something is
  live. It draws:
  - a rarity flash for rare and epic cards (epic is brighter and adds a white outline);
  - a flash plus a breathing glow in the tag colour on boot-sector cards.
- `SlideIn`: cards slide 28 px up and fade in, staggered 55 ms, 240 ms each with Back.easeOut. All cards are in place by
  about 405 ms, inside the smoke's 450 ms screenshot wait.
  - The offset is applied as a delta, and `finish()` runs before every refill or hide, so a reroll mid-slide can never
    leave text displaced.
  - Zones are not moved: the hit rects stay exact.
- **Genome warp** (`GenomeStrip.flash(tag, shake)`):
  - three glitch slices in tag and crimson;
  - two alpha pulses, then a fade;
  - a decaying sideways wobble (±6 px, 600 ms). "Reduce motion" turns the wobble off.

## Wiring
`BattleScene` lines are tagged `// vfx/audio`: create and restart, update (`vfx.update`, `dockN` reset), `pulse`,
`waveStart` (`setWave`), `perkPicked` (dock), `bootPicked` (`boot`), `mutation` (`mutation` voice + warp), `death`
(sting), `fusionOnline` (`fusion` voice + link), and the death overlay (the `mission` chime when a run completed a
daily mission). `HomeScene`: the `mission` chime next to the "Daily mission done" toast (an abandoned run settled on
Home).

## Perf
- Per frame, nothing is allocated in vfx: fixed records, and Graphics paths drawn without point arrays.
- Each audio event creates its nodes (1–6 oscillators/buffers, a gain and a filter each) and drops them when they stop.
- At ×5 with 200 enemies, the limiter keeps at most 12 spam voices sounding (≈ 25–40 nodes).
- Music layer 2 adds ≈ 3 nodes per step (≈ 12/s).

## Open issues
- Headless Chromium has no audio output, so the sound itself was not listened to. Owner: a listening pass for levels
  (especially `pulseOverload` sub and `boss`) on phone speakers.
- Stingers are fixed to A minor and do not sync to the loop's beat.
- The mission chime on Home only plays for runs settled there. Missions completed elsewhere show no Home-side chime.

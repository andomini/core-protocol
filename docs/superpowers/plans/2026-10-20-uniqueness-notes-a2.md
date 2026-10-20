# Uniqueness plan — A2 notes: virus bodies (item 2)

Render only: no change in `src/sim/**`, `src/data/**`, `src/ui/**` or any scene. `BattleScene` keeps passing the legacy
texture keys (`e_basic` … `e_boss_head`) to `Effects.death`; they are frame 0 of the new bodies.

## Files
- `src/render/virusShapes.ts` (new, Phaser-free): frame keys (`texKey`), `animFrame`, idle `pose` per kind, `bossMembrane`,
  the death-burst plan (`fragments`, `FRAG_COUNT`, `fragBudget`, `easeOut`). Tested in `tests/virusBodies.test.ts` (new, 11 tests).
- `src/render/textures.ts`: `enemies()` rewritten; new helpers `body` (dark fill + rim-lit gradient + neon outline),
  `spikes` (stalk + club), `fadeStroke` (flagella), `smooth`; `fragmentTextures()`.
- `src/render/WorldView.ts`: frame swap + pose instead of the per-kind rotation switch; hit swell; boss membrane + nucleus glow.
- `src/render/effects.ts`: the RGB-split glitch is replaced by a capsid burst (pieces); ranged beam uses the orchid colour.
- `src/render/pools.ts`: `ImagePool.prewarm(n)`, `idle`.
- `src/render/palette.ts`: the "sick" family (`ENEMY_COLOR` changed for fast/tank/ranged, `ENEMY_ACCENT`, `VIRUS_BODY`).

## Bodies (all face +x where directional; +x is the heading toward the core)
| Kind | Body | Motion | Texture (logical px, ×RS ≤ 3) |
|---|---|---|---|
| basic | Round capsid r·0.7, 9 club-tipped spikes to r·1.08 (corona), a ring of 5 genome beads | pulse ±7 % (380 ms), slow turn 0.0005 rad/ms | 72 |
| fast | Comet: head r·0.62 at +x, tapering tail, 3 flagella with alpha fade | **3 frames** (85 ms) of the flagella beat; faces the core; stretch ±6 % along the heading | 87 ×3 |
| tank | Icosahedron seen vertex-on: hex hull (lw 4.4), inner triangle, 10 facets lit from upper left, inner hull line, 6 fibre knobs (adenovirus), rivets | very slow turn 0.00022, breathing ±3 % (520 ms) | 93 |
| ranged | Bacteriophage: elongated-hex head with packed genome at −x, collar, ringed sheath, baseplate, 6 legs to +x | **2 frames** (260 ms) legs flex/extend; legs aim at the core, sway ±0.2 rad | 76 ×2 |
| boss head | Spiked capsid (16 spikes) around a glowing nucleus with a coiled genome | as before (worm head steering) | 128 |
| boss membrane | Separate image: lobed lipid bilayer (two lines + translucent band) with 7 glycoprotein knobs | breathes ±7 % (340 ms), counter-turns; frozen/slow tint follows the head | 128 |
| boss glow | The shared `glow` texture tinted pale pink, ADD, over the nucleus | alpha 0.55…1 at 150 ms | — |
| boss segments | Progeny virions: hex capsid, 8 spikes, membrane ring, nucleus dot | unchanged chain logic | 120 |
| fragments | `frag_0` shell arc + spike, `frag_1` plate, `frag_2` droplet (white, tinted) | — | 40 each |

Hues (test-guarded: > 15° from every tag hue): basic magenta 312°, fast acid lime `#c4ff3a` 75°, tank rose `#ff4f6a` 351°,
ranged orchid `#d64bff` 284°, boss crimson 349°. Tags sit at 16° / 47° / 146° / 194° / 261°. Small HP bars use the body colour.

## Death
`Effects.death` (same signature): the body copy (ADD) swells ×1.5 and fades over 200 ms (boss ×1.7 over 500 ms plus a
membrane copy ×2 over 600 ms); `FRAG_COUNT` fragments (basic 4, fast 3, tank 5, ranged 4, boss 10), one per equal sector
of the circle, fly 1.1–2.2 radii out with ease-out, spin and shrink, alpha held then fading (cubic) over ~430 ms; the first
fragment is in the accent tone. Pixel particles cut to 6 / 12 (tank) / 40 (boss) since the fragments carry the burst;
the shock ring is unchanged. Fragment travel uses `DEFAULT_DATA.enemies[kind].radius` (the same data the textures are baked from).

## Readability kept
- Hit: white `setTintFill` (70 ms) as before, plus a swell of +14 % easing back over the flash.
- Frozen / slowed tints unchanged (the membrane follows them on the boss); the boss HP bar and `WORM.EXE` label unchanged.
- Mutation ring (genome gene colour) and the Bounty Mark reticle unchanged.

## Performance
- Still one `Image` per enemy per frame (boss: +2). No per-enemy Graphics drawing was added; `setTexture` is called only when
  the animation frame changes (fast ≈ 12/s, ranged ≈ 4/s per enemy).
- Death pieces are pooled (`bodyPool` prewarmed 16, `fragPool` 48), capped at `MAX_PIECES` = 160 live; past the cap a death
  keeps only particles + ring. The old glitch used 3 images per death for 110 ms; a burst now uses 1 + 3–5 images for ~430 ms,
  so at 30 kills/s ≈ 70 live pieces.
- Enemy texture GPU memory at RS 3 ≈ 3.6 MB (12 textures + 3 fragments). Bundle: no assets, code only.
- Not re-measured on a phone (same caveat as M2a): the `?stress=1` smoke on desktop and a throttled phone stays in the gate.

## Open issues
- `BattleScene` computes the death-copy rotation for basic/tank as `now·0.0012`, while the bodies now turn slower (0.0005 /
  0.00022 · spin): the 200 ms dissolving copy can start a few degrees off. Invisible on the round basic, faintly on the tank.
  A one-line fix would read the rotation from `WorldView` (needs a BattleScene edit; left out on purpose).
- The genome mutation level could add extra spikes / a second ring on bodies (optional in the brief): not done; the existing
  gene-colour ring stays.
- The phage head genome is a small curl; the basic used one too but it read as a digit at the in-game size, so the basic
  got beads. Revisit the phage at zoom 1 on a real phone.
- `npm run build:local` fails `tools/postbuild.mjs` on main too: `src/ui/LeaderboardPanel.ts` has the literal
  `NAME FROM CRAZYGAMES` in the local bundle (commit 4d08748). Not in A2's ownership; the size check passes (461 KB gz).
- Covers (`tools/covers`, phase 2 B1) should pick up the new bodies automatically if they render the battle view.

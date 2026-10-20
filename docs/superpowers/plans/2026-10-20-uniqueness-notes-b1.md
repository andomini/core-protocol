# Uniqueness plan, item 5: covers and thumbnails (agent B1)

## Composition (`tools/covers/cover.html`, design units of an 800 px square, `U` = scale × zoom)
- **Territory**: the whole canvas is the game's pointy-top hex grid (cell 60 U). Cells within hex distance 3 of the core
  are owned (faint sector tint in the tag colours, teal outlines); the rest are infected (faint rose fill). A crimson
  front line runs along the owned edge, as in `CrystalView`.
- **Crystal**: 7 modules around the core. Ring 1 plus one cell of ring 2: Overload ×3 at (1,-1), (1,0), (2,-1) as the
  lit set (bright plate, strong bloom, white-hot glyphs), then Firewall (0,1), Cryo (-1,1), Chain (-1,0), Mining (0,-1)
  as dim single plates. Every module is a dark inset hex with its tag glyph (a port of `src/ui/tagIcon.ts`). Links between
  different tags are two-colour welds on the shared edge. Overload (1,0) to Firewall (0,1) is the **fused** link: a thick
  weld, a hot lens of light, three white arcs across it and the split diamond (pair disc). The free ring-2 slots are dashed
  outlines, so the crystal has room to grow.
- **Core**: a warm-white neon hex in the centre cell, an orange inner hex, a white-hot centre and a halo.
- **Pulse**: a ring at 292 U, Overload yellow, with a trailing band, a white centre line, a faint echo at 0.7 R and
  sparks. The basic virus at 305 U, on the ring, is caught: a flash, five shell fragments (`frag_0`) and pixels.
- **Viruses**: the bodies are a port of `enemies()` in `src/render/textures.ts` (same paths, `enemies.json` radii, the
  `RS` blur scale replaced by the draw scale). Heroes, scale ×2.6–3.9: a faceted tank (upper left), a flagellate comet
  pointing at the core (upper right), a phage with its legs toward the core (lower left), the caught capsid (lower right)
  and a capsid at the top. Behind them, 6–12 dim (alpha 0.42) small viruses in the infected zone. Movers get a soft trail;
  two short warm tracers hit the tank and the phage.
- **Title** (CrazyGames only): Orbitron 900, warm gradient (#fffbe8 → #ffc23a), a yellow glow, an orange drop glow and an
  ink outline. No chromatic cyan/magenta split any more.

## Palette
- Tags and viruses come from `src/render/palette.ts` (`TAG_COLOR`, `ENEMY_COLOR`, `ENEMY_ACCENT`, `VIRUS_BODY`). Note:
  the task text guessed Overload orange and Firewall green; in the palette Overload is #ffd23f yellow, Firewall #ff7a45
  orange and Mining #4dff9a green. The cover uses the palette.
- The background is cover-only: a radial teal ink (#0f3a42 → #0a2830 → #061a20 → #030d11), teal grid #2fb8b0, a warm core
  light (#ffc54a / #ff9a3c) and a mild edge vignette. The warm yellow/orange of the crystal is the focal colour.
  Viruses keep their sick hues (magenta, lime, rose, orchid).

## What each portal gets (`render.mjs` JOBS, unchanged)
| File | Size | Text | Notes |
|---|---|---|---|
| `poki-thumbnail-800x800.png`, `-1080x1080.png` | square | none | full scene, centred; reads at 200 px (crystal, ring, 4 virus silhouettes) |
| `crazygames-cover-1920x1080.png` | wide | title | scene zoom 0.85, core at 0.7 W, title on the left half (viruses kept out of it), extra tank and phage on the right |
| `crazygames-cover-800x1200.png` | portrait | title | title in the top 27 %, core at 0.6 H, a boss and a second comet in the extra height |
| `crazygames-cover-800x800.png` | square | title | scene zoom 0.84, core at 0.6 H, title in the top quarter |
| `poki-animated-thumbnail-1080x1080.mp4` | square | none | 1.3 s of the static thumbnail, then two gameplay clips (record.mjs + videos.sh), 5 s, 50 fps, 3.3 MB |

## Animated thumbnail
- `record.mjs` now prefers the Hot Start boot sector (if offered), fires the Pulse once in each clip that `videos.sh`
  cuts (it moves `pulseReadyTick` to the current tick, dev only) and hides the PULSE button frame, which falls inside the
  crop. Regenerated: `UI_PORT=5186 node tools/covers/record.mjs 9 && tools/covers/videos.sh` (about 1 minute).
- Playwright's own ffmpeg (revision 1011 for playwright-core 1.63) was missing from the cache. Installed with
  `node node_modules/playwright-core/cli.js install ffmpeg` (`npx playwright install` installs a different revision).
  This step is in `publish/CHECKLIST.md`.

## Open issues
- The gameplay clips still look magenta-on-dark: the game's own background and grid (palette `BG`, `GRID`) are the old
  navy neon. The covers now promise teal ink with warm crystal colours. Either the game moves toward that palette (src,
  not B1's area) or the covers should move back a little, so the store art matches the game.
- The in-game Pulse fx (`effects.pulse`: radius = 0.4 × range, 0.9 s) is small and short, so it barely reads in the
  animated thumbnail. A bigger or longer ring (B3 VFX) would make the clip show the verb.
- The boot offer is 3 random sectors out of 5, so the recorded crystal is not always warm. A dev hook such as
  `?boot=hotStart` or `__cp.boot(id)` would make the recording deterministic. It would also help to get a first-class
  `__cp.pulse()` hook that skips the cooldown, instead of writing `pulseReadyTick` from the recorder.
- Ports to keep in sync: if A2 changes a virus silhouette in `textures.ts` or the tag glyphs in `tagIcon.ts`, update
  `cover.html` too. Serving the page through Vite to import the real modules would remove the duplication, but the
  textures need a Phaser scene; the port was simpler and keeps `render.mjs` server-free.
- CrazyGames 15–20 s preview videos still do not exist (landscape recording needed), unchanged.

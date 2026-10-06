// Renders the covers / thumbnails from tools/covers/cover.html → publish/out/*.png (Playwright, exact sizes).
// Usage: node tools/covers/render.mjs
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { launch } from '../ui/harness.mjs';

const OUT = 'publish/out';
const JOBS = [
  // Poki: square, no text, no frame (≥ 628×628).
  { name: 'poki-thumbnail-800x800', w: 800, h: 800, title: 0, seed: 7 },
  { name: 'poki-thumbnail-1080x1080', w: 1080, h: 1080, title: 0, seed: 7 },
  // CrazyGames covers (title only, no frames or icons).
  { name: 'crazygames-cover-1920x1080', w: 1920, h: 1080, title: 1, seed: 11 },
  { name: 'crazygames-cover-800x1200', w: 800, h: 1200, title: 1, seed: 5 },
  { name: 'crazygames-cover-800x800', w: 800, h: 800, title: 1, seed: 7 },
];
mkdirSync(OUT, { recursive: true });
const browser = await launch();
for (const j of JOBS) {
  const ctx = await browser.newContext({ viewport: { width: j.w, height: j.h }, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  await p.goto(`file://${resolve('tools/covers/cover.html')}?w=${j.w}&h=${j.h}&title=${j.title}&seed=${j.seed}`);
  await p.waitForFunction(() => document.body.dataset.ready === '1');
  await p.screenshot({ path: `${OUT}/${j.name}.png` });
  console.log(`${OUT}/${j.name}.png`);
  await ctx.close();
}
await browser.close();

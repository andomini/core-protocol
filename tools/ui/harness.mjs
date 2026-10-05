// Browser harness for UI smoke tests (adapted from Merge Wall): starts a Vite dev server unless UI_BASE
// is set, opens pages with a given viewport, and talks to the dev-only window.__cp hooks.
// Uses playwright-core; set CHROMIUM_PATH to a Chromium binary if Playwright's default is not installed.
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';

export const VIEWPORTS = {
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
  desktop: { viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 },
  crazy: { viewport: { width: 907, height: 510 }, deviceScaleFactor: 1 },
};

/** Console noise from headless GPU drivers that is not a game error. */
const BENIGN = [/GPU stall due to ReadPixels/, /Automatic fallback to software WebGL/, /WebGL.*performance warning/i];

export async function startServer() {
  if (process.env.UI_BASE) return { base: process.env.UI_BASE, close: async () => {} };
  const server = await createServer({ server: { port: 5199, strictPort: false, host: '127.0.0.1' }, logLevel: 'error' });
  await server.listen();
  const addr = server.httpServer.address();
  return { base: `http://127.0.0.1:${addr.port}/`, close: () => server.close() };
}

/** CHROMIUM_PATH, else the newest full Chromium already in the Playwright cache (any revision). */
function chromiumPath() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const dir = join(homedir(), '.cache', 'ms-playwright');
  if (!existsSync(dir)) return undefined;
  const revs = readdirSync(dir).filter((d) => /^chromium-\d+$/.test(d)).sort((a, b) => Number(b.slice(9)) - Number(a.slice(9)));
  for (const r of revs) {
    const exe = join(dir, r, 'chrome-linux64', 'chrome');
    if (existsSync(exe)) return exe;
  }
  return undefined;
}

export async function launch() {
  // Without these flags headless Chromium renders WebGL in software (SwiftShader): frame timings are meaningless.
  return chromium.launch({
    executablePath: chromiumPath(),
    headless: true,
    args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=vulkan'],
  });
}

/** Opens the game in a fresh context and waits for the Battle scene. */
export async function open(browser, base, device, query = '') {
  const ctx = await browser.newContext(VIEWPORTS[device]);
  const p = await ctx.newPage();
  const errors = [];
  p.on('console', (m) => {
    const t = m.text();
    if ((m.type() === 'error' || m.type() === 'warning') && !BENIGN.some((re) => re.test(t))) errors.push(`${m.type()}: ${t}`);
  });
  p.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await p.goto(base + query);
  await p.waitForFunction(() => window.__cp?.ready(), null, { timeout: 15000 });
  return {
    p,
    ctx,
    errors,
    state: () => p.evaluate(() => window.__cp.state()),
    call: (name, ...args) => p.evaluate(([n, a]) => window.__cp[n](...a), [name, args]),
    /** Polls the hook state until `pred` holds or the timeout passes; returns the last state. */
    waitFor: async (pred, timeoutMs, stepMs = 100) => {
      const t0 = Date.now();
      for (;;) {
        const s = await p.evaluate(() => window.__cp.state());
        if (pred(s)) return { ok: true, s, ms: Date.now() - t0 };
        if (Date.now() - t0 > timeoutMs) return { ok: false, s, ms: Date.now() - t0 };
        await p.waitForTimeout(stepMs);
      }
    },
    /** Tap / click at logical layout coordinates. */
    tapLogical: async (x, y) => {
      const box = await p.evaluate(() => {
        const r = document.querySelector('canvas').getBoundingClientRect();
        const L = window.__cp.game.registry.get('layout');
        return { x: r.x, y: r.y, s: r.width / L.w };
      });
      await p.mouse.click(box.x + x * box.s, box.y + y * box.s);
    },
    /** Committed screenshot (JPEG, small) + a full-quality PNG for review in .superpowers/. */
    shot: async (name) => {
      mkdirSync('reports/screens', { recursive: true });
      mkdirSync('.superpowers/screens', { recursive: true });
      await p.screenshot({ path: `.superpowers/screens/${name}.png` });
      await p.screenshot({ path: `reports/screens/${name}.jpg`, type: 'jpeg', quality: 82 });
    },
    close: () => ctx.close(),
  };
}

export function check(results, name, cond, detail) {
  results.push({ name, ok: !!cond, detail });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : '  ' + JSON.stringify(detail)}`);
}

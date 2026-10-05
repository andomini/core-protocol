// Boots each production portal build (dist/<portal>/, no dev hooks) on a local static server and checks
// the SDK lifecycle against a fake SDK served in place of the real one (page.route, no network needed),
// then boots again with the SDK blocked (adblock / offline) to prove the game still opens.
// Usage: npm run ui:portal-build [-- crazygames|poki]   (build first: npm run build:all)
// Port: PORTAL_CHECK_PORT (default 5181).
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { check, fakeSdk, launch, VIEWPORTS } from './harness.mjs';

const SDK_URL = { crazygames: 'https://sdk.crazygames.com/**', poki: 'https://game-cdn.poki.com/**' };
const LOADED = { crazygames: 'loadingStop', poki: 'gameLoadingFinished' };
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.woff2': 'font/woff2', '.txt': 'text/plain', '.css': 'text/css' };
const portals = process.argv.slice(2).filter((a) => a in SDK_URL);
const results = [];

function serve(dir, port) {
  const srv = createServer((req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
    let f = join(dir, path);
    if (existsSync(f) && statSync(f).isDirectory()) f = join(f, 'index.html');
    if (!existsSync(f)) return res.writeHead(404).end();
    res.writeHead(200, { 'content-type': TYPES[extname(f)] ?? 'application/octet-stream' }).end(readFileSync(f));
  });
  return new Promise((r) => srv.listen(port, '127.0.0.1', () => r(srv)));
}

const browser = await launch();
const port = Number(process.env.PORTAL_CHECK_PORT ?? 5181);
try {
  for (const portal of portals.length ? portals : ['crazygames', 'poki']) {
    const dir = `dist/${portal}`;
    if (!existsSync(join(dir, 'index.html'))) {
      check(results, `${portal}: build exists`, false, `run npm run build:${portal}`);
      continue;
    }
    const srv = await serve(dir, port);
    const base = `http://127.0.0.1:${port}/`;
    for (const mode of ['fake-sdk', 'blocked-sdk']) {
      const ctx = await browser.newContext(VIEWPORTS.phone);
      await ctx.route(SDK_URL[portal], (route) =>
        mode === 'fake-sdk' ? route.fulfill({ contentType: 'text/javascript', body: fakeSdk(portal) }) : route.abort('blockedbyclient'),
      );
      const p = await ctx.newPage();
      const errors = [];
      const hosts = new Set();
      p.on('console', (m) => {
        if (m.type() === 'error' || m.type() === 'warning') {
          // A blocked SDK script logs the network failure itself; that is the scenario, not a game error.
          if (mode === 'blocked-sdk' && /ERR_BLOCKED_BY_CLIENT|Failed to load resource/.test(m.text())) return;
          errors.push(`${m.type()}: ${m.text()}`);
        }
      });
      p.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
      p.on('request', (r) => hosts.add(new URL(r.url()).host));
      const label = `${portal} build (${mode})`;
      const t0 = Date.now();
      await p.goto(base);
      await p.waitForFunction(() => !!document.querySelector('canvas'), null, { timeout: 15000 });
      await p.waitForTimeout(3000); // boot cap + fonts + first frames
      const bootMs = Date.now() - t0;
      const sdkLog = () => p.evaluate(() => (window.__sdkLog ?? []).map((e) => e.name));
      const box = await p.evaluate(() => {
        const r = document.querySelector('canvas').getBoundingClientRect();
        return { x: r.x, y: r.y, s: r.width / 720 };
      });
      const tap = (x, y) => p.mouse.click(box.x + x * box.s, box.y + y * box.s);
      check(results, `${label}: boots to a canvas without dev hooks`, (await p.evaluate(() => window.__cp === undefined)) && bootMs < 10000, { bootMs });
      if (mode === 'fake-sdk') {
        let log = await sdkLog();
        check(results, `${label}: ${LOADED[portal]} exactly once, no gameplayStart before input`, log.filter((x) => x === LOADED[portal]).length === 1 && !log.includes('gameplayStart'), log);
        await tap(360, 600); // arena
        await p.waitForTimeout(150);
        log = await sdkLog();
        check(results, `${label}: gameplayStart after the first input`, log.filter((x) => x === 'gameplayStart').length === 1, log);
        await tap(658, 44); // pause (portrait HUD)
        await p.waitForTimeout(150);
        log = await sdkLog();
        check(results, `${label}: pause → gameplayStop`, log.at(-1) === 'gameplayStop', log);
        await tap(658, 44);
        await p.waitForTimeout(150);
        check(results, `${label}: resume → gameplayStart`, (await sdkLog()).at(-1) === 'gameplayStart', await sdkLog());
        await p.screenshot({ path: `.superpowers/screens/portal-build-${portal}.png` });
      } else {
        await tap(360, 600);
        await p.waitForTimeout(300);
        check(results, `${label}: the game runs with the SDK blocked`, (await p.evaluate(() => !!document.querySelector('canvas'))), null);
      }
      const other = portal === 'crazygames' ? /poki/ : /crazygames/;
      check(results, `${label}: no other portal's host contacted`, ![...hosts].some((h) => other.test(h)), [...hosts]);
      check(results, `${label}: no console errors`, errors.length === 0, errors);
      await ctx.close();
    }
    await new Promise((r) => srv.close(r));
  }
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);

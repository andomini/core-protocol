// B8: production build load on Slow 4G (1.6 Mbit/s, 150 ms RTT) with a 4× slower CPU, phone viewport.
// Measures the transferred bytes and the time until the portal hears `loadingFinished` (first input possible).
// Usage: npm run build && node tools/ui/loadtime.mjs
import { preview } from 'vite';
import { launch, VIEWPORTS } from './harness.mjs';

const server = await preview({ preview: { port: 5181, host: '127.0.0.1' }, build: { outDir: 'dist/local' }, logLevel: 'error' });
const base = `http://127.0.0.1:${server.httpServer.address().port}/`;
const browser = await launch();
const ctx = await browser.newContext(VIEWPORTS.phone);
const p = await ctx.newPage();
const cdp = await ctx.newCDPSession(p);
await cdp.send('Network.enable');
await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 });
await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
let bytes = 0;
cdp.on('Network.loadingFinished', (e) => (bytes += e.encodedDataLength));
const t0 = Date.now();
const ready = new Promise((resolve) => p.on('console', (m) => m.text().includes('[local] loadingFinished') && resolve(Date.now() - t0)));
await p.goto(base);
const ms = await Promise.race([ready, new Promise((r) => setTimeout(() => r(-1), 30000))]);
console.log(JSON.stringify({ loadingFinishedMs: ms, transferredKB: Math.round(bytes / 1024), pass: ms > 0 && ms <= 5000 && bytes <= 1024 * 1024 }));
await browser.close();
server.httpServer.close();

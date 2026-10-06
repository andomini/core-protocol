// Records a showcase gameplay clip for the animated thumbnail (dev server + dev hooks; portrait 1080×1920).
// Staging: no hints, god mode, levels, Chain/Cryo protocols (lightning, freeze), a boss wave with an extra crowd, no text; then records.
// Usage: node tools/covers/record.mjs [seconds=9] → publish/out/raw/port.webm and its start offset.
import { mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { launch, startServer } from '../ui/harness.mjs';

const secs = Number(process.argv[2] ?? 9);
const RAW = 'publish/out/raw';
mkdirSync(RAW, { recursive: true });
const srv = await startServer();
const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1, recordVideo: { dir: RAW, size: { width: 1080, height: 1920 } } });
const p = await ctx.newPage();
const t0 = Date.now();
await p.goto(srv.base + '?seed=31');
await p.waitForFunction(() => window.__cp?.ready());
await p.evaluate(async () => {
  const c = window.__cp;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  document.getElementById('cp-admin-btn')?.remove();
  c.meta({ firstRunDone: true, starterGiven: true });
  c.goto('Battle', { mode: 'new', tier: 1 });
  await sleep(600);
  document.getElementById('cp-admin-btn')?.remove();
  const b = c.game.scene.getScene('Battle');
  // Prefer Chain and Cryo protocols (lightning arcs, bounces, freezes are the most visual).
  const want = ['arc', 'bounce', 'conductive', 'frostShot', 'permafrost', 'coldAura', 'shatter', 'overchargeLink'];
  const pick = () => {
    const w = b.session.world;
    if (w.phase !== 'pick') return;
    const i = Math.max(0, w.offer.findIndex((id) => want.includes(id)));
    b.command({ type: 'pickPerk', index: i });
  };
  pick();
  b.devGod = true;
  b.devLevels(7);
  for (let k = 0; k < 8; k++) {
    b.devPickNow();
    pick();
    await sleep(30);
  }
  b.devJumpWave(20);
  b.devAutoPick = true;
  b.setSpeed(1);
  await sleep(300);
  // A crowd on the ring so the frame is full of action.
  for (const [kind, n] of [['basic', 26], ['fast', 10], ['tank', 6], ['ranged', 7]]) b.spawn(kind, n);
  // Thumbnails carry no text: hide every label (boss name, damage numbers, HUD) and the protocol chips (depth bars+0.4…).
  b.events.on('postupdate', () => {
    for (const o of b.children.list) if (o.type === 'Text' || (o.depth > 10.3 && o.depth < 10.7)) o.setVisible(false);
  });
  await sleep(2600);
});
const startS = (Date.now() - t0) / 1000;
await p.waitForTimeout(secs * 1000);
const video = p.video();
await ctx.close();
const src = await video.path();
renameSync(src, `${RAW}/port.webm`);
for (const f of readdirSync(RAW)) if (f.endsWith('.webm') && f !== 'port.webm' && f !== 'land.webm') rmSync(`${RAW}/${f}`);
writeFileSync(`${RAW}/port.json`, JSON.stringify({ startS }));
console.log(`${RAW}/port.webm (action from ${startS.toFixed(1)} s)`);
await browser.close();
await srv.close();

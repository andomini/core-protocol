// UI smoke for the battle view (M2a) and the upgrade panel (M2b). Starts its own Vite dev server (or uses UI_BASE) and drives the
// dev-only window.__cp hooks. Usage: npm run ui [-- --only portrait|landscape|stress]
// Screenshots: reports/screens/*.jpg (committed), full PNGs in .superpowers/screens/ (for review).
import { writeFileSync } from 'node:fs';
import { check, launch, open, startServer } from './harness.mjs';

const args = process.argv.slice(2);
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
const results = [];
const metrics = {};
const srv = await startServer();
const browser = await launch();

/** One of every virus kind (boss and ranged included) so a screenshot shows every look. */
async function showcase(h) {
  // The worm is slow: give it a head start so its whole chain is inside the arena for the shot.
  await h.p.evaluate(() => window.__cp.spawn('boss', 1, 3)); // right side, a little below the core
  await h.p.waitForTimeout(5000);
  await h.p.evaluate(() => {
    const cp = window.__cp;
    cp.spawn('ranged', 3, 40);
    cp.spawn('tank', 2, 22);
    cp.spawn('fast', 3, 52);
    cp.spawn('basic', 5, 9);
  });
}

/** Waits `minMs`, then shoots ~80 ms after the next kill so the burst and glitch are on screen. */
async function actionShot(h, name, minMs) {
  await h.p.waitForTimeout(minMs);
  const k0 = (await h.state()).kills;
  await h.waitFor((s) => s.kills > k0, 4000, 25);
  await h.p.waitForTimeout(70);
  await h.shot(name);
}

/** Average requestAnimationFrame rate over `ms`. */
function measureFps(h, ms) {
  return h.p.evaluate(
    (dur) =>
      new Promise((res) => {
        let n = 0;
        let t0 = 0;
        const f = (t) => {
          if (t0 === 0) t0 = t;
          else n++;
          if (t - t0 < dur) requestAnimationFrame(f);
          else res((n * 1000) / (t - t0));
        };
        requestAnimationFrame(f);
      }),
    ms,
  );
}

/** Every Text object in the Battle scene (HUD, banners, hidden death overlay) is at least the layout minimum. */
async function minTextCheck(h, label) {
  const r = await h.p.evaluate(() => {
    const scene = window.__cp.game.scene.getScene('Battle');
    const min = window.__cp.game.registry.get('layout').minFont;
    const sizes = scene.children.list.filter((o) => o.type === 'Text').map((t) => ({ s: parseFloat(t.style.fontSize), text: t.text }));
    return { min, count: sizes.length, bad: sizes.filter((x) => !(x.s >= min)) };
  });
  check(results, `${label}: all ${r.count} texts ≥ ${r.min} px`, r.count > 10 && r.bad.length === 0, r);
}

async function bootChecks(h, label, orientation) {
  const s0 = await h.state();
  check(results, `${label}: boots into Battle (${orientation})`, s0.scene === 'Battle' && s0.orientation === orientation, s0);
  await minTextCheck(h, label);
  const vis = await h.waitFor((s) => s.visible > 0, 2500, 50);
  // Sim seconds since the wave-1 start (tick 1) when the first enemy was on screen.
  metrics[`${label}.firstVisibleSimS`] = Math.round(((vis.s.tick - 1) / 30) * 100) / 100;
  check(results, `${label}: an enemy is visible within ~2 s`, vis.ok, vis.s);
  return vis;
}

const centre = (r) => [r.x + r.w / 2, r.y + r.h / 2];

/**
 * The upgrade panel through real taps: earn Energy at ×5, then tap the Damage row while paused
 * (applied at once) and while running (queued for the next tick); level +1 and Energy down each time.
 * Also: tab switching, the ×1/×10/MAX toggle, a locked row (no-op) and hold-to-repeat.
 */
async function upgradeChecks(h, label) {
  let ui = await h.call('ui');
  const dmg = ui.rows.find((r) => r.stat === 'damage');
  check(results, `${label}: panel shows the ATK tab with the Damage row`, ui.tab === 'atk' && dmg && ui.rows.length === 6, ui);
  await h.call('setSpeed', 5);
  const rich = await h.waitFor((s) => s.energy >= 20, 20000, 100);
  check(results, `${label}: Energy accumulates from kills`, rich.ok, rich.s);

  // Paused: the tap is applied immediately.
  await h.call('pause', true);
  const s0 = await h.state();
  await h.tapLogical(...centre(dmg.rect));
  await h.p.waitForTimeout(120);
  const s1 = await h.state();
  check(results, `${label}: tapping Damage while paused buys a level and spends Energy`, s1.levels.damage === s0.levels.damage + 1 && s1.energy < s0.energy && s1.tick === s0.tick, { s0: s0.energy, s1: s1.energy, l0: s0.levels.damage, l1: s1.levels.damage });
  await h.shot(`${label.replace(/ upgrades$/, '').replace(/[^a-z0-9]+/gi, '-')}-upgrades`);

  // Running at ×1: queued, applied at the start of the next tick. Wait until the row itself (the sim's
  // own quote) says the next level is affordable.
  await h.call('setSpeed', 5);
  await h.call('pause', false);
  const ready = await h.p.waitForFunction(() => window.__cp.ui().rows.find((r) => r.stat === 'damage').affordable, null, { timeout: 30000, polling: 50 }).then(() => true, () => false);
  await h.call('setSpeed', 1);
  const r0 = await h.state();
  await h.tapLogical(...centre(dmg.rect));
  const r1 = await h.waitFor((s) => s.levels.damage === r0.levels.damage + 1, 2000, 30);
  check(results, `${label}: tapping Damage while running buys on the next tick`, ready && r1.ok && r1.s.commands === r0.commands + 1 && (r1.s.energy < r0.energy || r1.s.kills > r0.kills), { ready, r0: r0.levels.damage, r1: r1.s.levels.damage, e0: r0.energy, e1: r1.s.energy });
  await h.call('pause', true);

  // Tabs and the amount toggle.
  await h.tapLogical(...centre(ui.tabs.find((t) => t.tab === 'def').rect));
  ui = await h.call('ui');
  check(results, `${label}: DEF tab tap switches rows`, ui.tab === 'def' && ui.rows[0].stat === 'health', ui.rows.map((r) => r.stat));
  await h.tapLogical(...centre(ui.amountRect));
  ui = await h.call('ui');
  check(results, `${label}: amount toggle ×1 → ×10`, ui.amount === 10, ui.amount);
  await h.tapLogical(...centre(ui.amountRect));
  await h.tapLogical(...centre(ui.amountRect));
  ui = await h.call('ui');
  check(results, `${label}: amount toggle cycles back to ×1`, ui.amount === 1, ui.amount);

  // A locked row (Lifesteal on DEF) is a no-op.
  const ls = ui.rows.find((r) => r.stat === 'lifesteal');
  const l0 = await h.state();
  await h.tapLogical(...centre(ls.rect));
  await h.p.waitForTimeout(100);
  const l1 = await h.state();
  check(results, `${label}: a locked row shows LAB and buying it does nothing`, ls.locked && l1.levels.lifesteal === 0 && l1.energy === l0.energy, ls);

  // Hold-to-repeat on Health (dev Energy grant so the hold has something to spend).
  await h.call('give', 5000);
  const hrow = ui.rows.find((r) => r.stat === 'health');
  const h0 = await h.state();
  const box = await h.p.evaluate(() => {
    const r = document.querySelector('canvas').getBoundingClientRect();
    return { x: r.x, y: r.y, s: r.width / window.__cp.game.registry.get('layout').w };
  });
  const [hx, hy] = centre(hrow.rect);
  await h.p.mouse.move(box.x + hx * box.s, box.y + hy * box.s);
  await h.p.mouse.down();
  await h.p.waitForTimeout(1200);
  await h.p.mouse.up();
  const h1 = await h.state();
  check(results, `${label}: holding a row keeps buying`, h1.levels.health >= h0.levels.health + 5, { before: h0.levels.health, after: h1.levels.health });
  await h.p.waitForTimeout(400);
  const h2 = await h.state();
  check(results, `${label}: releasing stops buying`, h2.levels.health === h1.levels.health, { h1: h1.levels.health, h2: h2.levels.health });
  await h.tapLogical(...centre(ui.tabs.find((t) => t.tab === 'atk').rect));
  await h.call('pause', false);
}

/** Big values in every row (dev Energy + MAX buys), then: no name/value/level/price box overlaps any other
 *  in its row, and everything stays inside the row, on all three tabs. */
async function panelFitCheck(h, label, shotName) {
  await h.call('pause', true);
  await h.call('give', 1e9);
  for (const s of ['damage', 'attackSpeed', 'critFactor', 'health', 'regen', 'defense', 'energyBonus', 'energyPerWave', 'bitsPerKill', 'bitsPerWave', 'thorns', 'knockback']) await h.call('buy', s, 'max');
  const bad = [];
  for (const tab of ['atk', 'def', 'util']) {
    await h.call('setTab', tab);
    await h.p.waitForTimeout(80);
    const rows = await h.p.evaluate(() => window.__cp.game.scene.getScene('Battle').upgrades.textBounds());
    const hit = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    for (const row of rows) {
      for (const p of row.parts) {
        const r = p.r;
        if (r.x < row.row.x - 1 || r.x + r.w > row.row.x + row.row.w + 1) bad.push({ tab, stat: row.stat, out: p.what, text: p.text });
      }
      for (let i = 0; i < row.parts.length; i++)
        for (let j = i + 1; j < row.parts.length; j++)
          if (hit(row.parts[i].r, row.parts[j].r)) bad.push({ tab, stat: row.stat, a: row.parts[i].what, b: row.parts[j].what, ta: row.parts[i].text, tb: row.parts[j].text });
    }
  }
  check(results, `${label}: panel texts never overlap or leave their row (big values, all tabs)`, bad.length === 0, bad);
  await h.call('setTab', 'atk');
  if (shotName) await h.shot(shotName);
}

const scenarios = {
  async portrait() {
    const h = await open(browser, srv.base, 'phone', '?seed=7');
    await bootChecks(h, 'portrait', 'portrait');

    // Speed and pause through the real HUD buttons (logical coordinates from the portrait layout).
    await h.tapLogical(558, 44);
    let s = await h.state();
    check(results, 'portrait: speed button toggles ×1 → ×2', s.speed === 2, s);
    await h.tapLogical(658, 44);
    const p0 = await h.state();
    await h.p.waitForTimeout(600);
    const p1 = await h.state();
    check(results, 'portrait: pause button freezes the sim', p0.paused && p1.tick === p0.tick, { p0, p1 });
    await h.tapLogical(658, 44);
    s = await h.state();
    check(results, 'portrait: pause button resumes', !s.paused, s);

    await h.call('setSpeed', 5);
    const w = await h.waitFor((x) => x.wave >= 2, 15000, 200);
    check(results, 'portrait: the wave counter advances when sped up', w.ok, w.s);
    const lay = await h.call('ui');
    check(results, 'portrait 390×844: the logical height adapts (no letterbox)', lay.layout.h === 1558, lay.layout);
    await upgradeChecks(h, 'portrait upgrades');
    await panelFitCheck(h, 'portrait 390×844');
    check(results, 'portrait: no console errors', h.errors.length === 0, h.errors);
    await h.close();

    // 16:9 phone: the 1280-tall floor with compact single-line rows.
    const c = await open(browser, srv.base, 'phone169', '?seed=7');
    const cl = await c.call('ui');
    check(results, 'portrait 360×640: 1280-tall layout', cl.layout.h === 1280, cl.layout);
    await minTextCheck(c, 'portrait 360×640');
    await upgradeChecks(c, 'portrait 360×640 upgrades');
    await panelFitCheck(c, 'portrait 360×640', 'portrait-169-upgrades');
    check(results, 'portrait 360×640: no console errors', c.errors.length === 0, c.errors);
    await c.close();

    const m = await open(browser, srv.base, 'phone', '?seed=11');
    await showcase(m);
    await actionShot(m, 'portrait-midwave', 3600);
    check(results, 'portrait showcase: no console errors', m.errors.length === 0, m.errors);
    await m.close();

    const d = await open(browser, srv.base, 'phone', '?weak=1&seed=3');
    await d.call('setSpeed', 5);
    const dead = await d.waitFor((x) => x.overlay, 20000, 200);
    check(results, 'portrait: a weak core dies and the death overlay appears', dead.ok && dead.s.dead, dead.s);
    await d.p.waitForTimeout(500);
    await d.shot('portrait-death');
    await d.tapLogical(...centre((await d.call('ui')).restart));
    await d.p.waitForTimeout(300);
    const r = await d.state();
    check(results, 'portrait: RESTART starts a new run with a new seed', !r.dead && !r.overlay && r.seed !== dead.s.seed && r.tick < 60, r);
    check(results, 'portrait death: no console errors', d.errors.length === 0, d.errors);
    await d.close();
  },

  async landscape() {
    for (const [device, label] of [['desktop', 'landscape 1280×720'], ['crazy', 'landscape 907×510']]) {
      const h = await open(browser, srv.base, device, '?seed=5');
      await bootChecks(h, label, 'landscape');
      await h.tapLogical(1143, 47);
      const s = await h.state();
      check(results, `${label}: speed button toggles ×1 → ×2`, s.speed === 2, s);
      await h.call('setSpeed', 5);
      const w = await h.waitFor((x) => x.wave >= 2, 15000, 200);
      check(results, `${label}: the wave counter advances when sped up`, w.ok, w.s);
      await upgradeChecks(h, `${label} upgrades`);
      await panelFitCheck(h, label);
      check(results, `${label}: no console errors`, h.errors.length === 0, h.errors);
      await h.close();
    }
    const m = await open(browser, srv.base, 'desktop', '?seed=11');
    await showcase(m);
    await actionShot(m, 'landscape-midwave', 3600);
    await m.close();
    const d = await open(browser, srv.base, 'crazy', '?weak=1&seed=3');
    await d.call('setSpeed', 5);
    const dead = await d.waitFor((x) => x.overlay, 20000, 200);
    check(results, 'landscape 907×510: death overlay appears', dead.ok, dead.s);
    await d.p.waitForTimeout(500);
    await d.shot('landscape-death');
    await d.close();
  },

  async stress() {
    for (const device of ['desktop', 'phone']) {
      const h = await open(browser, srv.base, device, '?stress=1');
      if (device === 'phone') {
        // Rough mid-range phone: 4× CPU slowdown (the GPU is still the host's).
        const cdp = await h.ctx.newCDPSession(h.p);
        await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
      }
      await h.p.waitForTimeout(2500);
      const fps = await measureFps(h, 5000);
      const s = await h.state();
      metrics[`stress.${device}${device === 'phone' ? '.cpu4x' : ''}.fps`] = Math.round(fps * 10) / 10;
      console.log(`      stress ${device}: ${fps.toFixed(1)} FPS avg over 5 s, ${s.enemies} enemies, ×${s.speed}`);
      check(results, `stress ${device}: 200 enemies at ×5, core alive`, s.enemies >= 195 && s.speed === 5 && !s.dead, s);
      if (device === 'desktop') {
        check(results, 'stress desktop: ≥ 55 FPS average', fps >= 55, fps);
        await h.shot('stress');
      }
      check(results, `stress ${device}: no console errors`, h.errors.length === 0, h.errors);
      await h.close();
    }
  },
};

try {
  for (const [name, fn] of Object.entries(scenarios)) {
    if (only && only !== name) continue;
    try {
      await fn();
    } catch (err) {
      check(results, `${name}: scenario threw`, false, String(err?.stack ?? err));
    }
  }
} finally {
  await browser.close();
  await srv.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`, JSON.stringify(metrics));
if (!only) writeFileSync('reports/ui-smoke.json', JSON.stringify({ date: new Date().toISOString(), metrics, results }, null, 2) + '\n');
process.exit(failed.length ? 1 : 0);

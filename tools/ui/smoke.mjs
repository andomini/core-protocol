// UI smoke for the M2a battle view. Starts its own Vite dev server (or uses UI_BASE) and drives the
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
    check(results, 'portrait: no console errors', h.errors.length === 0, h.errors);
    await h.close();

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
    // RESTART button centre in the portrait death card.
    await d.tapLogical(360, 866);
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

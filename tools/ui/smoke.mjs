// UI smoke for the battle view (M2a), the upgrade panel (M2b) and the portal layer (M6). Starts its own Vite dev server (or uses UI_BASE) and drives the
// dev-only window.__cp hooks. Usage: npm run ui [-- --only portrait|landscape|stress|portal]
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

/** A neutral first input: a tap in the arena, away from the core and every button. */
async function arenaTap(h) {
  const a = await h.p.evaluate(() => window.__cp.game.registry.get('layout').arena);
  await h.tapLogical(a.x + a.w * 0.15, a.y + a.h * 0.85);
}

const count = (xs, name) => xs.filter((x) => x === name).length;

/** Kills the (?weak=1) core at ×5 and waits for the death overlay. */
async function dieNow(h, label) {
  await h.call('setSpeed', 5);
  const dead = await h.waitFor((x) => x.overlay, 20000, 100);
  check(results, `${label}: the weak core dies, overlay shown`, dead.ok && dead.s.dead, dead.s);
  return dead.s;
}

/**
 * RESTART tapped from its rect with a midgame ad expected. Samples the state while the ad loads (paused,
 * not muted), after the portal's adStarted (muted), and after it ends (unmuted, new run, gameplay on).
 */
async function midgameRestartChecks(h, label, sdkLog, shotName) {
  const before = await h.state();
  await h.tapLogical(...centre((await h.call('ui')).restart));
  await h.p.waitForTimeout(120);
  const loading = await h.state();
  check(results, `${label}: RESTART requests a midgame ad; sim halted, gameplay stopped, audio NOT muted before adStarted`,
    loading.adRunning && loading.restarting && !loading.soundMuted && !loading.gameplay && loading.dead && loading.seed === before.seed, loading);
  const started = await h.waitFor((x) => x.soundMuted, 2000, 40);
  check(results, `${label}: audio muted once the ad really starts`, started.ok && started.s.adRunning && started.s.dead, started.s);
  if (shotName) await h.shot(shotName);
  const t0 = started.s.tick;
  await h.p.waitForTimeout(400);
  const mid = await h.state();
  check(results, `${label}: the sim does not tick during the ad`, mid.tick === t0 && mid.adRunning, mid);
  const done = await h.waitFor((x) => !x.adRunning && !x.dead, 4000, 50);
  check(results, `${label}: after the ad: unmuted, a new run with a new seed`, done.ok && !done.s.soundMuted && !done.s.overlay && done.s.seed !== before.seed, done.s);
  const g = await h.waitFor((x) => x.gameplay, 1000, 50);
  check(results, `${label}: gameplay restarts after the ad`, g.ok, g.s);
  if (sdkLog) {
    const log = await sdkLog();
    const iAd = log.lastIndexOf('adFinished');
    check(results, `${label}: SDK order stop → ad → start`, iAd > 0 && log.slice(iAd).includes('gameplayStart') && log.lastIndexOf('gameplayStop') < log.lastIndexOf('adStarted'), log);
  }
}

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
  async portal() {
    // 1. Local portal, no flags: lifecycle, telemetry, and no midgame at the first death.
    const h = await open(browser, srv.base, 'phone', '?weak=1&seed=3');
    await h.p.waitForTimeout(400);
    let s = await h.state();
    check(results, 'portal local: loadingFinished exactly once', count(h.portal, 'loadingFinished') === 1, h.portal);
    check(results, 'portal local: no gameplayStart before the first input', count(h.portal, 'gameplayStart') === 0 && !s.gameplay, { portal: h.portal, s });
    await arenaTap(h);
    await h.p.waitForTimeout(100);
    s = await h.state();
    check(results, 'portal local: gameplayStart on the first input', count(h.portal, 'gameplayStart') === 1 && s.gameplay, h.portal);
    await h.tapLogical(658, 44); // pause
    await h.p.waitForTimeout(100);
    check(results, 'portal local: pause → gameplayStop', h.portal.at(-1) === 'gameplayStop' && !(await h.state()).gameplay, h.portal);
    await h.tapLogical(658, 44); // resume
    await h.p.waitForTimeout(100);
    check(results, 'portal local: resume → gameplayStart', h.portal.at(-1) === 'gameplayStart', h.portal);
    await h.call('give', 500);
    await h.call('buy', 'damage', 1);
    const dead = await dieNow(h, 'portal local');
    check(results, 'portal local: death → gameplayStop', h.portal.at(-1) === 'gameplayStop' && !(await h.state()).gameplay, h.portal);
    await h.tapLogical(...centre((await h.call('ui')).restart));
    const r = await h.waitFor((x) => !x.dead, 1500, 50);
    check(results, 'portal local: first death → RESTART without a midgame ad', r.ok && r.s.seed !== dead.seed && !h.portal.some((x) => x.startsWith('midgameAd')), h.portal);
    check(results, 'portal local: loadingFinished still exactly once', count(h.portal, 'loadingFinished') === 1, h.portal);
    const tm = await h.call('telemetry');
    const types = tm.map((e) => e.type);
    const runs = tm.filter((e) => e.type === 'run_start');
    const death = tm.find((e) => e.type === 'death');
    check(results, 'portal local: telemetry run_start ×2 (seed, tier, deviceId, runIndex +1)',
      runs.length === 2 && runs[0].seed === 3 && runs[0].tier === 1 && !!runs[0].deviceId && runs[1].runIndex === runs[0].runIndex + 1, runs);
    check(results, 'portal local: telemetry wave_reached, purchase, death (wave, time, energy), session_start',
      types.includes('wave_reached') && types.includes('purchase') && types.includes('session_start') && death && death.wave >= 1 && death.time > 0 && typeof death.energy === 'number', types);
    check(results, 'portal local: no console errors', h.errors.length === 0, h.errors);
    await h.close();

    // 2. Local portal, midgame forced: the fake ad pauses at request and mutes at its start (portrait).
    const m = await open(browser, srv.base, 'phone', '?weak=1&seed=3&midgame=always');
    await arenaTap(m);
    await dieNow(m, 'portal local midgame');
    await midgameRestartChecks(m, 'portal local midgame', null, 'portal-midgame-portrait');
    check(results, 'portal local midgame: the portal saw request → started → finished',
      ['midgameAd requested (mode=ok)', 'midgameAd started', 'midgameAd finished'].every((x) => m.portal.includes(x)), m.portal);
    const tm2 = await m.call('telemetry');
    check(results, 'portal local midgame: telemetry ad_request + ad_result completed',
      tm2.some((e) => e.type === 'ad_request' && e.kind === 'midgame') && tm2.some((e) => e.type === 'ad_result' && e.kind === 'midgame' && e.result === 'completed'), tm2.filter((e) => e.type.startsWith('ad_')));
    check(results, 'portal local midgame: no console errors', m.errors.length === 0, m.errors);
    await m.close();

    // 3. CrazyGames adapter against the fake SDK (landscape 907×510, the CrazyGames iframe size).
    const c = await open(browser, srv.base, 'crazy', '?portal=crazygames&weak=1&seed=3&midgame=always', { sdk: 'crazygames' });
    await c.p.waitForTimeout(300);
    let log = await c.sdkLog();
    check(results, 'portal crazygames: loadingStart then loadingStop exactly once',
      count(log, 'loadingStart') === 1 && count(log, 'loadingStop') === 1 && log.indexOf('loadingStart') < log.indexOf('loadingStop'), log);
    check(results, 'portal crazygames: no gameplayStart before the first input', count(log, 'gameplayStart') === 0, log);
    check(results, 'portal crazygames: ads available', (await c.state()).adsAvailable && (await c.state()).portal === 'crazygames', await c.state());
    await arenaTap(c);
    await c.p.waitForTimeout(100);
    log = await c.sdkLog();
    check(results, 'portal crazygames: gameplayStart after the first input', count(log, 'gameplayStart') === 1, log);
    await dieNow(c, 'portal crazygames');
    await midgameRestartChecks(c, 'portal crazygames', c.sdkLog, 'portal-midgame-landscape');
    log = await c.sdkLog();
    check(results, 'portal crazygames: one requestAd:midgame, loadingStop still once', count(log, 'requestAd:midgame') === 1 && count(log, 'loadingStop') === 1, log);
    check(results, 'portal crazygames: rewarded through the SDK resolves true', (await c.call('rewarded', 'revive')) === true, await c.sdkLog());
    check(results, 'portal crazygames: no console errors', c.errors.length === 0, c.errors);
    await c.close();

    // 4. Poki adapter against the fake SDK (phone).
    const k = await open(browser, srv.base, 'phone', '?portal=poki&weak=1&seed=3&midgame=always', { sdk: 'poki' });
    await k.p.waitForTimeout(300);
    log = await k.sdkLog();
    check(results, 'portal poki: gameLoadingFinished exactly once, no gameplayStart before input',
      count(log, 'gameLoadingFinished') === 1 && count(log, 'gameplayStart') === 0, log);
    await arenaTap(k);
    await dieNow(k, 'portal poki');
    await midgameRestartChecks(k, 'portal poki', k.sdkLog, null);
    check(results, 'portal poki: one commercialBreak', count(await k.sdkLog(), 'commercialBreak') === 1, await k.sdkLog());
    check(results, 'portal poki: no console errors', k.errors.length === 0, k.errors);
    await k.close();

    // 5. ?ads=fail: a failed midgame is silent and the restart still happens; a failed rewarded shows the toast.
    const f = await open(browser, srv.base, 'phone', '?ads=fail&weak=1&seed=3&midgame=always');
    await arenaTap(f);
    const fd = await dieNow(f, 'portal ads=fail');
    await f.tapLogical(...centre((await f.call('ui')).restart));
    const fr = await f.waitFor((x) => !x.dead && !x.adRunning, 3000, 50);
    const toast0 = await f.p.evaluate(() => document.getElementById('cp-toast')?.dataset.shown ?? null);
    check(results, 'portal ads=fail: failed midgame → the run still restarts within 3 s, no toast', fr.ok && fr.s.seed !== fd.seed && toast0 === null && !fr.s.soundMuted, { s: fr.s, toast0, portal: f.portal });
    const t0 = Date.now();
    const ok = await f.call('rewarded', 'doubleBits');
    const ms = Date.now() - t0;
    await f.p.waitForTimeout(150);
    const toast = await f.p.evaluate(() => {
      const el = document.getElementById('cp-toast');
      return el ? { text: el.textContent, opacity: getComputedStyle(el).opacity, shown: el.dataset.shown } : null;
    });
    check(results, 'portal ads=fail: rewarded resolves false quickly with the "No ad right now" toast', ok === false && ms < 2000 && toast?.text === 'No ad right now' && toast.opacity === '1', { ok, ms, toast });
    await f.shot('portal-ad-fail-toast');
    const after = await f.state();
    check(results, 'portal ads=fail: nothing stuck (no ad running, not muted, gameplay on)', !after.adRunning && !after.soundMuted && after.gameplay, after);
    check(results, 'portal ads=fail: no console errors', f.errors.length === 0, f.errors);
    await f.close();

    // 6. ?ads=none: ads unavailable → rewarded refuses at once without touching the SDK.
    const n = await open(browser, srv.base, 'desktop', '?ads=none');
    const ns = await n.state();
    const nok = await n.call('rewarded', 'reroll');
    check(results, 'portal ads=none: adsAvailable false; rewarded false, no ad requested', !ns.adsAvailable && nok === false && !n.portal.some((x) => x.startsWith('rewardedAd')), { ns, portal: n.portal });
    await n.p.waitForTimeout(150);
    const nt = await n.p.evaluate(() => getComputedStyle(document.getElementById('cp-toast')).opacity);
    check(results, 'portal ads=none: the toast shows in landscape too', nt === '1', nt);
    await n.shot('portal-toast-landscape');
    // Telemetry overlay toggles with ~ in DEV.
    await n.p.keyboard.press('Backquote');
    const overlay = await n.p.evaluate(() => !!document.getElementById('cp-telemetry'));
    await n.p.keyboard.press('Backquote');
    check(results, 'portal: the telemetry overlay toggles with ~ (DEV)', overlay && !(await n.p.evaluate(() => !!document.getElementById('cp-telemetry'))), overlay);
    check(results, 'portal ads=none: no console errors', n.errors.length === 0, n.errors);
    await n.close();
  },

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

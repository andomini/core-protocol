// UI smoke for the battle view (M2a), the upgrade panel (M2b) and the portal layer (M6). Starts its own Vite dev server (or uses UI_BASE) and drives the
// dev-only window.__cp hooks. Usage: npm run ui [-- --only portrait|landscape|stress|portal|leaderboard (comma-separated)]
// Screenshots: reports/screens/*.jpg (committed), full PNGs in .superpowers/screens/ (for review).
import { writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
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
    const g = window.__cp.game.scene;
    const scene = g.isActive('Battle') ? g.getScene('Battle') : g.getScene('Home');
    const min = window.__cp.game.registry.get('layout').minFont;
    const sizes = scene.children.list.filter((o) => o.type === 'Text').map((t) => ({ s: parseFloat(t.style.fontSize), text: t.text }));
    return { min, count: sizes.length, bad: sizes.filter((x) => !(x.s >= min)) };
  });
  check(results, `${label}: all ${r.count} texts ≥ ${r.min} px`, r.count > 10 && r.bad.length === 0, r);
}

const centre = (r) => [r.x + r.w / 2, r.y + r.h / 2];

/** Index of the first offered card that adds a new module (not a stack of a held perk). */
const newCard = (s) => Math.max(0, s.offer.findIndex((id) => !(id in s.perks)));

/** If the run-start boot pick is open, a real tap on boot card `i`; returns once it closed. */
async function takeBoot(h, i = 0) {
  const s = await h.state();
  if (s.bootOffer.length === 0) return s;
  await h.p.waitForTimeout(500);
  const cards = (await h.call('ui')).pick.cards;
  await h.tapLogical(...centre(cards[i]));
  return (await h.waitFor((x) => x.bootOffer.length === 0 && (x.offer.length > 0 || !x.pickOpen), 2000, 50)).s;
}

/** The boot sector stands in for the wave 1–3 picks (boot.json skipPicks): opens a protocol pick now (dev hook). */
async function openPick(h) {
  await h.call('pickNow');
  return (await h.waitFor((x) => x.pickOpen && x.offer.length > 0, 2000, 50)).s;
}

async function bootChecks(h, label, orientation) {
  const s0 = await h.state();
  check(results, `${label}: boots into Battle (${orientation})`, s0.scene === 'Battle' && s0.orientation === orientation, s0);
  // B1: the run opens on the boot sector pick (tick 0), then the wave-1 protocol pick; real taps on the cards.
  const boot0 = await h.waitFor((s) => s.pickOpen, 3000, 50);
  metrics[`${label}.firstPickMs`] = boot0.ms;
  check(results, `${label}: the boot sector pick is open at start`, boot0.ok && boot0.s.tick === 0 && boot0.s.bootOffer.length === 3 && boot0.s.offer.length === 0, boot0.s);
  await h.p.waitForTimeout(450);
  await minTextCheck(h, `${label} boot overlay`);
  await h.shot(`boot-${label}`);
  const b1 = await takeBoot(h, 0);
  check(results, `${label}: a boot card installs its 3 modules (set 2 on) and closes the pick`, b1.tick <= 10 && b1.boot !== '' && b1.crystal.length === 3 && Object.values(b1.setTiers).some((v) => v >= 2) && !b1.pickOpen, b1);
  const open0 = { s: await openPick(h) };
  await minTextCheck(h, `${label} pick overlay`);
  await h.p.waitForTimeout(400);
  const cards = (await h.call('ui')).pick.cards;
  await h.tapLogical(...centre(cards[newCard(open0.s)]));
  // Crystal placement step (spec 2026-10-14 §A): free hexes light up; a tap on the pulsing auto hex bolts it on.
  const placing = await h.waitFor((s) => s.placing, 1500, 50);
  const pl = (await h.call('ui')).place;
  check(results, `${label}: a new protocol asks where to place its crystal module`, placing.ok && pl !== null && pl.free.length > 0 && pl.autoSlot !== null, pl);
  await h.p.waitForTimeout(250);
  if (pl?.autoSlot) await h.tapLogical(pl.autoSlot[0], pl.autoSlot[1]);
  const took = await h.waitFor((s) => !s.pickOpen, 1500, 50);
  check(results, `${label}: tapping a hex bolts the module there`, took.ok && took.s.crystal.length === 4, took.s.crystal);
  check(results, `${label}: tapping a card installs it`, took.ok && took.s.picks === 1 && Object.keys(took.s.perks).length === 4, took.s);
  // The editor stays open in Arrange mode until DONE; then the battle resumes.
  const ed = await h.call('editor');
  check(results, `${label}: the editor switches to Arrange after placing`, ed?.open && ed.mode === 'arrange', ed);
  await tapDone(h);
  await minTextCheck(h, label);
  const vis = await h.waitFor((s) => s.visible > 0, 2500, 50);
  // Sim seconds since the wave-1 start (tick 1) when the first enemy was on screen.
  metrics[`${label}.firstVisibleSimS`] = Math.round(((vis.s.tick - 1) / 30) * 100) / 100;
  check(results, `${label}: an enemy is visible within ~2 s`, vis.ok, vis.s);
  return vis;
}


/** A neutral first input: a tap in the arena, away from the core and every button. */
async function arenaTap(h) {
  const a = await h.p.evaluate(() => window.__cp.game.registry.get('layout').arena);
  await h.tapLogical(a.x + a.w * 0.15, a.y + a.h * 0.85);
}

/** The first input of a run is the boot sector pick: a real tap on card 0 (gameplay starts after it; any open protocol pick too). */
async function firstInput(h) {
  const s = await takeBoot(h);
  if (!s.pickOpen) return;
  await h.p.waitForTimeout(400);
  const cards = (await h.call('ui')).pick.cards;
  await h.tapLogical(cards[0].x + cards[0].w / 2, cards[0].y + cards[0].h / 2);
  await placeAuto(h);
  await h.p.waitForTimeout(100);
}

/** If a card opened the crystal placement step, taps its AUTO button, then DONE in the editor. */
async function placeAuto(h) {
  const st = await h.waitFor((s) => s.placing || !s.pickOpen, 1500, 50);
  if (!st.s.placing) return;
  await h.p.waitForTimeout(250);
  await h.tapLogical(...centre((await h.call('ui')).place.auto));
  await tapDone(h);
}

/** Taps the editor's DONE (after its 150 ms tap guard) and waits for it to close. */
async function tapDone(h) {
  await h.p.waitForTimeout(200);
  const r = (await h.call('ui')).editor;
  if (!r) return;
  await h.tapLogical(...centre(r.done));
  await h.p.waitForFunction(() => !window.__cp.editor().open, null, { timeout: 2000 }).catch(() => {});
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
  check(results, `${label}: amount toggle MAX → AUTO`, ui.autoMode === true, ui);
  {
    const hp = ui.rows.find((r) => r.stat === 'health');
    const a0 = await h.state();
    await h.tapLogical(...centre(hp.rect));
    const on = (await h.call('ui')).rows.find((r) => r.stat === 'health').auto;
    await h.tapLogical(...centre(hp.rect));
    const off = (await h.call('ui')).rows.find((r) => r.stat === 'health').auto;
    const a1 = await h.state();
    check(results, `${label}: in AUTO mode a row tap toggles auto-buy, buys nothing`, on && !off && a1.levels.health === a0.levels.health, { on, off });
  }
  await h.tapLogical(...centre(ui.amountRect));
  ui = await h.call('ui');
  check(results, `${label}: amount toggle cycles back to ×1`, ui.amount === 1 && !ui.autoMode, ui.amount);

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
  // BUILD twice: first with every row waiting for its structure ("needs ..."), then with all four firewall fusions linked and big values bought.
  for (const tab of ['atk', 'def', 'util', 'build', 'build-open']) {
    if (tab === 'build-open') {
      await h.p.evaluate(() => {
        const w = window.__cp.game.scene.getScene('Battle').session.world;
        for (const k of ['cryo+firewall', 'overload+firewall', 'chain+firewall', 'mining+firewall']) w.fusionTiers[k] = 1;
      });
      for (const s of ['structHealth', 'structRegen', 'turretDamage', 'turretSpeed', 'mineDamage', 'stationIncome']) await h.call('buy', s, 'max');
    }
    await h.call('setTab', tab === 'build-open' ? 'build' : tab);
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

/**
 * A mocked leaderboard API at http://lb.test/v1 (route interception): records what the game sends and
 * answers like the Worker (docs/superpowers/specs/2026-10-16-leaderboards-design.md). `offline` makes run
 * uploads fail at the network level (the offline queue keeps them).
 */
function lbMock() {
  const m = { runs: [], boards: [], players: 0, renames: [], friends: [], offline: false, auth: [], starts: [] };
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type', 'access-control-allow-methods': 'GET, POST, PATCH, DELETE, OPTIONS' };
  const json = (route, status, body) => route.fulfill({ status, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const me = { id: 'p_smoke', secret: 'sekret', name: 'NeonVirus-4821', friendCode: 'K7M2QX', portal: 'local', linked: false, badges: 0 };
  m.routes = (ctx) =>
    ctx.route('http://lb.test/**', async (route) => {
      const req = route.request();
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
      const url = new URL(req.url());
      const path = url.pathname.replace(/^\/v1/, '');
      const authz = req.headers()['authorization'] ?? '';
      if (path !== '/players' || req.method() !== 'POST') m.auth.push(authz);
      if (req.method() === 'POST' && path === '/players') {
        m.players += 1;
        return json(route, 201, { ...me, secret: me.secret });
      }
      if (req.method() === 'POST' && path === '/runs/start') {
        // Server-issued start: the daily one carries the day's (secret) seed. The token's payload names the
        // player (the client checks that); its MAC is fake — this mock checks neither MAC nor elapsed time.
        const kind = JSON.parse(req.postData() ?? '{}').kind;
        m.starts.push(kind);
        const day = kind === 'daily' ? new Date().toISOString().slice(0, 10) : null;
        const seed = kind === 'daily' ? 424242 : 777;
        const startedAt = Date.now();
        const payload = Buffer.from(JSON.stringify({ v: 1, p: me.id, k: kind, d: day, s: seed, a: startedAt })).toString('base64url');
        return json(route, 200, { kind, day, seed, startedAt, token: `${payload}.mock-tok` });
      }
      if (req.method() === 'POST' && path === '/runs') {
        if (m.offline) return route.abort('internetdisconnected');
        m.runs.push(JSON.parse(req.postData() ?? '{}'));
        return json(route, 202, { id: m.runs.length, status: 'pending' });
      }
      if (req.method() === 'PATCH' && path === '/players/me') {
        const b = JSON.parse(req.postData() ?? '{}');
        m.renames.push(b.name);
        me.name = b.name;
        return json(route, 200, { name: b.name });
      }
      if (req.method() === 'POST' && path === '/friends') {
        const b = JSON.parse(req.postData() ?? '{}');
        m.friends.push(b.code);
        return b.code === 'ABCDEF' ? json(route, 200, { friend: { name: 'Pal', friendCode: b.code, badges: 1 } }) : json(route, 404, { error: 'code-not-found' });
      }
      if (req.method() === 'GET' && path === '/friends') {
        return json(route, 200, { code: me.friendCode, following: m.friends.filter((c) => c === 'ABCDEF').map((c) => ({ name: 'Pal', friendCode: c, badges: 1 })) });
      }
      if (req.method() === 'DELETE' && path.startsWith('/friends/')) {
        const code = path.slice('/friends/'.length);
        m.friends = m.friends.filter((c) => c !== code);
        return json(route, 200, { removed: true });
      }
      if (req.method() === 'GET' && path === '/daily') {
        // A server-issued seed (DAILY_SECRET) that differs from the public day hash: the run must use it.
        const now = Date.now();
        const day = new Date(now).toISOString().slice(0, 10);
        const endsAt = (Math.floor(now / 86400e3) + 1) * 86400e3;
        return json(route, 200, { day, dayIndex: Math.floor(now / 86400e3), seed: 424242, endsAt, week: '2026-10-12', weekEndsAt: endsAt, now });
      }
      if (req.method() === 'GET' && path.startsWith('/boards/')) {
        m.boards.push(path + url.search);
        const friends = url.searchParams.get('scope') === 'friends';
        const lim = Number(url.searchParams.get('limit') ?? 50);
        const n = Math.min(lim, friends ? 2 : 40);
        const names = ['Viral-Load', 'xX_Kernel_Xx', 'NullPointer', 'ByteMe', 'Overclocked', 'Firewall.9', 'Glitch Queen', 'Packet Loss'];
        const entries = Array.from({ length: n }, (_, i) => ({ rank: i + 1, name: friends ? ['Pal', 'Chum'][i] : names[i % names.length] + (i >= names.length ? `-${i}` : ''), friendCode: 'ABCDEF', badges: i < 2 ? 3 - i : 0, wave: 400 - i * 7, at: 0, status: i === 2 ? 'verifying' : 'verified' }));
        const mine = m.runs.at(-1);
        const kind = path.split('/')[2];
        const body = { board: kind === 'daily' ? `d:${url.pathname.split('/')[4] ?? 'today'}` : kind === 'weekly' ? 'w:2026-10-12:1' : `t:${path.split('/')[3]}`, scope: friends ? 'friends' : 'global', total: 4210, entries, me: mine ? { rank: 1337, wave: mine.wave, status: 'verifying' } : null };
        if (kind === 'daily') Object.assign(body, { day: '2026-10-16', seed: 1, endsAt: Date.now() + 5 * 3600e3 });
        if (kind === 'weekly') Object.assign(body, { tier: 1, week: '2026-10-12', endsAt: Date.now() + 3 * 86400e3 });
        return json(route, 200, body);
      }
      return json(route, 404, { error: 'not-found' });
    });
  return m;
}

/** Decodes a submitted replay (JSON, or gz: + base64 of it). */
function decodeReplay(s) {
  return JSON.parse(s.startsWith('gz:') ? gunzipSync(Buffer.from(s.slice(3), 'base64')).toString('utf8') : s);
}

const homeBtn = (h, label) =>
  h.p.evaluate((l) => {
    const b = window.__cp.game.scene.getScene('Home').buttons.find((x) => x.label.text === l && x.zone.input?.enabled);
    return b ? b.r : null;
  }, label);
const lbPanel = (h) =>
  h.p.evaluate(() => {
    const p = window.__cp.game.scene.getScene('Home').lbPanel;
    return p && { visible: p.visible, view: p.view, friends: p.friends?.length ?? -1, kind: p.kind, scope: p.scope, status: p.status, rows: p.board?.entries.length ?? -1, board: p.board?.board ?? null, me: p.board?.me ?? null, rects: p.rects };
  });

const scenarios = {
  async zoom() {
    const battle = (h, fn, arg) => h.p.evaluate(([f, a]) => new Function('sc', 'a', f)(window.__cp.game.scene.getScene('Battle'), a), [fn, arg]);
    const toPage = async (h, x, y) => {
      const b = await h.p.evaluate(() => {
        const r = document.querySelector('canvas').getBoundingClientRect();
        return { x: r.x, y: r.y, s: r.width / window.__cp.game.registry.get('layout').w };
      });
      return [b.x + x * b.s, b.y + y * b.s];
    };
    // Desktop: wheel zoom about the cursor, drag-pan, hover still finds modules, RESET ZOOM.
    {
      const h = await open(browser, srv.base, 'desktop', '?seed=3');
      await firstInput(h);
      const z0 = await battle(h, 'return sc.zoomState()');
      const a = await battle(h, 'return sc.L.arena');
      const [px, py] = [z0.cx + 90, z0.cy + 40];
      // World point under the cursor before the zoom.
      const before = [(px - z0.cx) / z0.scale, (py - z0.cy) / z0.scale];
      await h.p.mouse.move(...(await toPage(h, px, py)));
      for (let i = 0; i < 4; i++) await h.p.mouse.wheel(0, -200);
      await h.p.waitForTimeout(200);
      const z1 = await battle(h, 'return sc.zoomState()');
      const after = [(px - z1.cx) / z1.scale, (py - z1.cy) / z1.scale];
      check(results, 'zoom desktop: the wheel zooms in', z1.z > 1.5 && z1.scale > z0.scale * 1.5, { z0, z1 });
      check(results, 'zoom desktop: the point under the cursor stays put', Math.hypot(after[0] - before[0], after[1] - before[1]) < 1, { before, after });
      const btn = await battle(h, 'return { v: sc.zoomBtn.bg.visible, r: sc.zoomBtn.r }');
      check(results, 'zoom desktop: RESET ZOOM shows while zoomed', btn.v, btn);
      // Drag on empty field (a corner of the arena, away from the crystal) pans.
      const [ex, ey] = [a.x + a.w * 0.15, a.y + a.h * 0.2];
      await h.p.mouse.move(...(await toPage(h, ex, ey)));
      await h.p.mouse.down();
      await h.p.mouse.move(...(await toPage(h, ex + 80, ey + 50)), { steps: 8 });
      await h.p.mouse.up();
      const z2 = await battle(h, 'return sc.zoomState()');
      check(results, 'zoom desktop: dragging the empty field pans', Math.hypot(z2.panX - z1.panX, z2.panY - z1.panY) > 40, { z1, z2 });
      await h.shot('zoom-desktop');
      // Hover a module at its zoomed screen position: its tooltip opens.
      const m = await battle(h, 'const w = sc.session.world; const m = w.crystal[0]; return m ? sc.crystal.hexScreen(m.q, m.r) : null');
      if (m) {
        await h.p.mouse.move(...(await toPage(h, m[0], m[1])), { steps: 4 });
        await h.p.waitForTimeout(100);
        const at = await battle(h, 'return sc.modTipAt');
        check(results, 'zoom desktop: hovering a zoomed module opens its tooltip', at === 0, at);
      }
      await h.tapLogical(btn.r.x + btn.r.w / 2, btn.r.y + btn.r.h / 2);
      await h.p.waitForTimeout(100);
      const z3 = await battle(h, 'return sc.zoomState()');
      check(results, 'zoom desktop: RESET ZOOM goes back to the full view', z3.z === 1 && z3.panX === 0 && z3.panY === 0 && Math.abs(z3.cx - z0.cx) < 1e-6, z3);
      check(results, 'zoom desktop: no console errors', h.errors.length === 0, h.errors);
      await h.close();
    }
    // Phone: a two-finger pinch zooms in, and pinching back out restores the full view.
    {
      const h = await open(browser, srv.base, 'phone', '?seed=3');
      await firstInput(h);
      const z0 = await battle(h, 'return sc.zoomState()');
      const cdp = await h.ctx.newCDPSession(h.p);
      const pinch = async (from, to) => {
        const pts = async (d) => [await toPage(h, z0.cx - d, z0.cy + 160), await toPage(h, z0.cx + d, z0.cy + 160)];
        const ev = async (type, d) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : (await pts(d)).map(([x, y], id) => ({ x, y, id })) });
        await ev('touchStart', from);
        for (let i = 1; i <= 8; i++) await ev('touchMove', from + ((to - from) * i) / 8);
        await ev('touchEnd', to);
        await h.p.waitForTimeout(150);
      };
      await pinch(60, 150);
      const z1 = await battle(h, 'return sc.zoomState()');
      check(results, 'zoom phone: a pinch zooms in', z1.z > 1.8, z1);
      const drag = await battle(h, 'return sc.fieldDragState()');
      check(results, 'zoom phone: a pinch never starts a module drag', drag === null, drag);
      await h.shot('zoom-phone');
      await pinch(200, 40);
      const z2 = await battle(h, 'return sc.zoomState()');
      check(results, 'zoom phone: pinching out goes back to 1×', z2.z === 1, z2);
      check(results, 'zoom phone: no console errors', h.errors.length === 0, h.errors);
      await h.close();
    }
  },
  async stations() {
    // A destroyed Relay Station: a ghost that grows back over its rubble time, and a mouse hover shows the rebuild.
    const h = await open(browser, srv.base, 'desktop', '?seed=3');
    await firstInput(h);
    await h.p.evaluate(() => {
      const w = window.__cp.game.scene.getScene('Battle').session.world;
      w.fusionTiers['mining+firewall'] = 1;
    });
    await h.p.waitForTimeout(300);
    const st = await h.p.evaluate(() => {
      const sc = window.__cp.game.scene.getScene('Battle');
      const w = sc.session.world;
      const s = w.structs.find((x) => x.kind === 'station' && x.slot === 0);
      if (!s) return null;
      const cycle = (sc.gd.config.waveSeconds + sc.gd.config.pauseSeconds) * sc.gd.config.tickHz;
      s.share = 0;
      s.streak = 0;
      s.downUntilTick = w.tick + Math.round(1.4 * cycle);
      sc.paused = true;
      return { x: sc.L.cx + s.x * sc.L.scale, y: sc.L.cy + s.y * sc.L.scale };
    });
    check(results, 'stations: a Relay Station is built', st !== null, st);
    if (st === null) return h.close();
    await h.mouseLogical('move', st.x + 60, st.y + 60);
    await h.mouseLogical('move', st.x, st.y);
    await h.p.waitForTimeout(150);
    const tip = await h.p.evaluate(() => {
      const sc = window.__cp.game.scene.getScene('Battle');
      const t = sc.modTip.modLines;
      return { visible: t.visible, text: t.text, at: sc.modTipAt };
    });
    check(results, 'stations: hovering a rebuilding station shows its progress', tip.visible && /rebuilding 1\/3 · back in 2 waves/.test(tip.text), tip);
    await h.shot('station-rebuild');
    await h.mouseLogical('move', st.x + 120, st.y + 120);
    await h.p.waitForTimeout(100);
    const gone = await h.p.evaluate(() => window.__cp.game.scene.getScene('Battle').modTip.modLines.visible);
    check(results, 'stations: moving the mouse away hides it', !gone, gone);
    check(results, 'stations: no console errors', h.errors.length === 0, h.errors);
    await h.close();
  },
  async portal() {
    // 1. Local portal, no flags: lifecycle, telemetry, and no midgame at the first death.
    const h = await open(browser, srv.base, 'phone', '?weak=1&seed=3');
    await h.p.waitForTimeout(400);
    let s = await h.state();
    check(results, 'portal local: loadingFinished exactly once', count(h.portal, 'loadingFinished') === 1, h.portal);
    check(results, 'portal local: no gameplayStart before the first input', count(h.portal, 'gameplayStart') === 0 && !s.gameplay, { portal: h.portal, s });
    await firstInput(h);
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
    await firstInput(m);
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
    await firstInput(c);
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
    await firstInput(k);
    await dieNow(k, 'portal poki');
    await midgameRestartChecks(k, 'portal poki', k.sdkLog, null);
    check(results, 'portal poki: one commercialBreak', count(await k.sdkLog(), 'commercialBreak') === 1, await k.sdkLog());
    check(results, 'portal poki: no console errors', k.errors.length === 0, k.errors);
    await k.close();

    // 5. ?ads=fail: a failed midgame is silent and the restart still happens; a failed rewarded shows the toast.
    const f = await open(browser, srv.base, 'phone', '?ads=fail&weak=1&seed=3&midgame=always');
    await firstInput(f);
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
    await f.call('pickPerk', 0); // the restarted run opens on its wave-1 pick
    await f.p.waitForTimeout(100);
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
    // The Bounty chip (Bounty Marks III) clears the wave line, its timer and the set chips even at 3-digit waves.
    await c.call('demoCrystal');
    await c.call('setWave', 137);
    await c.p.waitForTimeout(150);
    const bp = await c.call('bountyPreview', 'BOUNTY 11/12');
    await c.p.waitForTimeout(80);
    const hit = (a, b) => a.w > 0 && b.w > 0 && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    const lay169 = cl.layout;
    check(
      results,
      'portrait 360×640: the Bounty chip overlaps no HUD text or set chip and stays on screen',
      bp && ![bp.wave, bp.secs, bp.chips, ...bp.pairs].some((r) => hit(bp.bounty, r)) && bp.bounty.x >= 0 && bp.bounty.x + bp.bounty.w <= lay169.w && bp.bounty.y + bp.bounty.h <= lay169.panel.y,
      bp,
    );
    await c.shot('hud-bounty-portrait-169');
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

  async protocols() {
    for (const [device, label] of [['phone', 'portrait'], ['desktop', 'landscape']]) {
      const h = await open(browser, srv.base, device, '?seed=21');
      h.autoPick = false;
      await h.waitFor((s) => s.pickOpen, 3000, 50);
      await takeBoot(h);
      const s0 = await openPick(h);
      await h.p.waitForTimeout(450);
      await h.shot(`pick-${label}`);
      const ui = (await h.call('ui')).pick;
      // REROLL: local rewarded stub grants → a new offer for the same pick.
      await h.tapLogical(...centre(ui.reroll));
      const r = await h.waitFor((s) => s.offer.join() !== s0.offer.join(), 5000, 50);
      check(results, `${label} protocols: REROLL (rewarded) gives a new offer`, r.ok && r.s.pickOpen && r.s.picks === 0, { before: s0.offer, after: r.s.offer });
      await h.p.waitForTimeout(200);
      // BOOST: taken once, then the button is spent.
      await h.tapLogical(...centre(ui.boost));
      await h.p.waitForFunction(() => window.__cp.game.scene.getScene('Battle').session.world.boost.from > 0, null, { timeout: 5000 }).catch(() => {});
      const b = await h.p.evaluate(() => window.__cp.game.scene.getScene('Battle').session.world.boost);
      check(results, `${label} protocols: BOOST (rewarded) arms ×Energy for the next waves`, b.from >= 1 && b.from <= 2 && b.until > b.from, b);
      await h.p.waitForTimeout(400); // the refreshed overlay ignores taps for 150 ms (double-tap guard)
      await h.tapLogical(...centre(ui.cards[1]));
      await placeAuto(h);
      const t = await h.waitFor((s) => !s.pickOpen && s.picks === 1, 1500, 50);
      check(results, `${label} protocols: the second card installs`, t.ok, t.s);
      // Chips + panel: grant a full Overload set through picks until a tier is on, then open the panel.
      await h.call('give', 1e6);
      await h.call('buy', 'damage', 'max');
      await h.call('buy', 'health', 'max');
      h.autoPick = true;
      await h.call('setSpeed', 5);
      const set = await h.waitFor((s) => Object.values(s.setTiers).some((v) => v >= 2), 40000, 150);
      check(results, `${label} protocols: a 2-set comes online within the first picks`, set.ok, set.s.setTiers);
      // Fusion chips: bolt on the showcase crystal (fusions I and II), then a pair chip shows its ladder card.
      await h.call('demoCrystal');
      await h.p.waitForTimeout(250);
      const fc = await h.call('fusionChips');
      const pairKeys = Object.keys(fc?.pairs ?? {});
      check(results, `${label} protocols: fusion chips are shown`, pairKeys.length > 0, fc);
      if (pairKeys.length > 0 && label === 'landscape') {
        // Paused between picks, so no pick overlay drops the card mid-check.
        await h.waitFor((s) => !s.pickOpen, 8000, 100);
        await h.call('pause', true);
        const r = (await h.call('fusionChips')).pairs[pairKeys[0]];
        await h.hoverLogical(...centre(r));
        await h.p.waitForTimeout(200);
        const tip = await h.call('fusionChips');
        check(results, `${label} protocols: hovering a fusion chip shows its ladder`, tip?.tip === pairKeys[0], tip);
        await h.shot(`fusion-tip-${label}`);
        await h.hoverLogical(4, 4);
        await h.call('pause', false);
      }
      const chips = await h.p.evaluate(() => window.__cp.game.scene.getScene('Battle').chips.rect);
      check(results, `${label} protocols: set chips are shown`, chips.w > 0 && chips.h > 0, chips);
      await h.tapLogical(...centre(chips));
      await h.p.waitForTimeout(300);
      const p1 = await h.state();
      await h.p.waitForTimeout(500);
      const p2 = await h.state();
      check(results, `${label} protocols: the panel opens and pauses the battle`, p1.paused && p2.tick === p1.tick, { p1: p1.tick, p2: p2.tick });
      await minTextCheck(h, `${label} protocols panel`);
      await h.shot(`protocols-${label}`);
      // A big crystal scrolls between the title and RESUME.
      const sc = await h.p.evaluate(() => {
        const pp = window.__cp.game.scene.getScene('Battle').protocols;
        pp.scrollTo(-1e6);
        return pp.scroll;
      });
      if (sc.max > 0) {
        check(results, `${label} protocols: the panel content scrolls to its end`, sc.y === -sc.max, sc);
        await h.p.waitForTimeout(100);
        await h.shot(`protocols-scrolled-${label}`);
      }
      await h.call('closeProtocols');
      const p3 = await h.state();
      check(results, `${label} protocols: RESUME restores the previous pause state`, !p3.paused, p3.paused);
      // Crystal module: hover (desktop) / tap (phone) shows the module + set card and outlines its cluster.
      // Unpaused at ×1: the portrait pause menu would cover the arena.
      h.autoPick = false;
      await h.call('setSpeed', 1);
      const mod = await h.p.evaluate(() => {
        const b = window.__cp.game.scene.getScene('Battle');
        const m = b.session.world.crystal[0];
        return m ? b.crystal.hexScreen(m.q, m.r) : null;
      });
      if (mod) {
        if (label === 'portrait') await h.tapLogical(...mod);
        else await h.hoverLogical(...mod);
        await h.p.waitForTimeout(120);
        const tip = await h.p.evaluate(() => {
          const b = window.__cp.game.scene.getScene('Battle');
          return { at: b.modTipAt, tag: b.modTip.shownTag, hover: b.crystal.hover.length };
        });
        check(results, `${label} protocols: a crystal module shows its card on ${label === 'portrait' ? 'tap' : 'hover'}`, tip.at === 0 && tip.tag !== null && tip.hover > 0, tip);
        await h.shot(`module-tip-${label}`);
      } else check(results, `${label} protocols: the crystal has a module to inspect`, false, null);
      check(results, `${label} protocols: no console errors`, h.errors.length === 0, h.errors);
      await h.close();
    }
  },

  async editor() {
    for (const [device, label] of [['phone', 'portrait'], ['phone169', 'portrait-169'], ['desktop', 'landscape']]) {
      const h = await open(browser, srv.base, device, '?seed=3');
      h.autoPick = false;
      await h.waitFor((s) => s.pickOpen, 3000, 50);
      await takeBoot(h);
      const sb = await openPick(h);
      await h.p.waitForTimeout(450);
      // Place: a card that adds a module opens the editor in Place mode with a readout.
      await h.tapLogical(...centre((await h.call('ui')).pick.cards[newCard(sb)]));
      await h.waitFor((s) => s.placing, 1500, 50);
      await h.p.waitForTimeout(250);
      const e0 = await h.call('editor');
      check(results, `${label} editor: a new-module card opens the editor in Place mode with a readout`, e0?.open && e0.mode === 'place' && e0.readout.length > 0 && e0.strip.length >= 5, e0);
      await minTextCheck(h, `${label} editor (place)`);
      await h.shot(`editor-place-${label}`);
      // A tap on a free hex (not the auto one) bolts the module there.
      const pl = (await h.call('ui')).place;
      const auto = await h.p.evaluate(() => window.__cp.game.scene.getScene('Battle').crystal.placing.auto);
      const slot = pl.free.find(([q, r]) => !auto || q !== auto[0] || r !== auto[1]) ?? pl.free[0];
      const pt = await h.call('slotScreen', slot[0], slot[1]);
      await h.tapLogical(pt[0], pt[1]);
      const placed = await h.waitFor((s) => !s.pickOpen && s.crystal.length === sb.crystal.length + 1, 1500, 50);
      const e1 = await h.call('editor');
      check(results, `${label} editor: a slot tap places the module there and switches to Arrange`, placed.ok && placed.s.crystal.some(([q, r]) => q === slot[0] && r === slot[1]) && e1.mode === 'arrange', { slot, crystal: placed.s.crystal, e1 });
      await tapDone(h);
      const run = await h.state();
      check(results, `${label} editor: DONE closes it and the battle resumes`, !(await h.call('editor')).open && !run.paused, run.paused);
      // Arrange from the pause menu: a showcase crystal, then CRYSTAL.
      await h.call('demoCrystal');
      await h.call('pause', true);
      await h.p.waitForTimeout(150);
      await h.tapLogical(...centre((await h.call('ui')).crystalBtn));
      await h.p.waitForTimeout(250);
      const e2 = await h.call('editor');
      check(results, `${label} editor: the pause menu's CRYSTAL opens Arrange`, e2?.open && e2.mode === 'arrange', e2);
      check(results, `${label} editor: the strip leads with the Lattice chip`, /^LATTICE \d+ · \+[\d.]+ % Bits$/.test(e2.strip[0] ?? ''), e2.strip[0]);
      check(results, `${label} editor: the strip ends above the buttons`, e2.stripEnd > 0 && e2.stripEnd <= e2.stripBottom, { end: e2.stripEnd, bottom: e2.stripBottom });
      // A pair chip tap glows the hexes that add a link to that pair; a second tap clears it.
      // (Some pairs have no hex that adds a cluster link: try the chips in turn.)
      if (e2.chips.length > 0) {
        let g1 = null;
        let g2 = null;
        let chip = null;
        for (const c of e2.chips) {
          await h.tapLogical(...centre(c.r));
          await h.p.waitForTimeout(100);
          const a = await h.call('editor');
          if (a.glow.length > 0) {
            check(results, `${label} editor: the strip with a tapped pair ends above the buttons`, a.stripEnd <= a.stripBottom, { end: a.stripEnd, bottom: a.stripBottom });
            await h.shot(`editor-pair-${label}`);
            g1 = a;
            chip = c.key;
          }
          await h.tapLogical(...centre(c.r));
          await h.p.waitForTimeout(100);
          g2 = await h.call('editor');
          if (g1) break;
        }
        check(results, `${label} editor: a pair chip tap glows its link hexes, a second tap clears them`, g1 !== null && g2.glow.length === 0 && g2.strip.join() === e2.strip.join(), { chip, g1: g1?.glow, g2: g2?.glow, chips: e2.chips.map((c) => c.key) });
      } else check(results, `${label} editor: the showcase crystal shows pair chips`, false, e2.strip);
      const before = await h.state();
      // Tap a module, then a target that changes a tier (coloured, not cyan or white).
      const pick = await h.p.evaluate(() => {
        const b = window.__cp.game.scene.getScene('Battle');
        return b.session.world.crystal.map((m) => [m.q, m.r]);
      });
      let moved = null;
      for (const [q, r] of pick) {
        const p0 = await h.call('slotScreen', q, r);
        await h.tapLogical(p0[0], p0[1]);
        await h.p.waitForTimeout(80);
        const t = await h.p.evaluate(() => {
          const b = window.__cp.game.scene.getScene('Battle');
          const e = b.crystal.edit;
          // Not crimson (a fall): undoing a rise drops at once, undoing a fall would weld (the strip would differ).
          return e ? e.targets.find((x) => x.color !== 0x22e5ff && x.color !== 0xffffff && x.color !== 0xff2d55) ?? null : null;
        });
        if (t) {
          moved = { from: [q, r], to: [t.q, t.r] };
          break;
        }
        await h.tapLogical(p0[0], p0[1]); // deselect
        await h.p.waitForTimeout(80);
      }
      check(results, `${label} editor: a selected module shows coloured targets`, moved !== null, moved);
      if (moved) {
        const p1 = await h.call('slotScreen', moved.to[0], moved.to[1]);
        await h.tapLogical(p1[0], p1[1]);
        await h.p.waitForTimeout(150);
        const e3 = await h.call('editor');
        const after = await h.state();
        check(results, `${label} editor: a move changes the bonus strip`, e3.strip.join() !== e2.strip.join() && after.crystal.join() !== before.crystal.join(), { before: e2.strip, after: e3.strip });
        await minTextCheck(h, `${label} editor (arrange)`);
        await h.shot(`editor-arrange-${label}`);
        await h.p.waitForTimeout(100);
        await h.tapLogical(...centre((await h.call('ui')).editor.undo));
        await h.p.waitForTimeout(150);
        const e4 = await h.call('editor');
        const undone = await h.state();
        check(results, `${label} editor: UNDO restores the crystal and the strip`, e4.strip.join() === e2.strip.join() && undone.crystal.join() === before.crystal.join(), { strip: e4.strip, crystal: undone.crystal });
      }
      await tapDone(h);
      const back = await h.state();
      check(results, `${label} editor: DONE returns to the pause menu`, !(await h.call('editor')).open && back.paused, back.paused);
      // Field drag (no editor): press a module, drag it — the battle pauses and targets light up — drop on one.
      await h.call('pause', false);
      await h.p.waitForTimeout(150);
      const mods = await h.p.evaluate(() => window.__cp.game.scene.getScene('Battle').session.world.crystal.map((m) => [m.q, m.r]));
      let dragged = null;
      for (const [q, r] of mods) {
        const a = await h.p.evaluate(([q, r]) => window.__cp.game.scene.getScene('Battle').crystal.hexScreen(q, r), [q, r]);
        await h.mouseLogical('down', a[0], a[1]);
        await h.mouseLogical('move', a[0] + 40, a[1] + 40);
        await h.p.waitForTimeout(80);
        const mid = await h.p.evaluate(() => {
          const b = window.__cp.game.scene.getScene('Battle');
          const t = b.crystal.edit?.targets[0];
          return { d: b.fieldDragState(), paused: b.paused, menu: b.exitBtn.bg.visible, to: t ? [t.q, t.r] : null, at: t ? b.crystal.hexScreen(t.q, t.r) : null };
        });
        if (!mid.to) {
          await h.mouseLogical('up', a[0], a[1]);
          await h.p.waitForTimeout(80);
          continue;
        }
        check(results, `${label} field drag: dragging a module pauses the battle without the pause menu`, mid.d?.moved && mid.paused && !mid.menu, mid);
        await h.mouseLogical('move', mid.at[0], mid.at[1]);
        await h.p.waitForTimeout(80);
        const pre = await h.p.evaluate(() => window.__cp.game.scene.getScene('Battle').fieldDragState());
        check(results, `${label} field drag: hovering a lit hex previews the change before the drop`, pre?.lines.length > 0 && !pre.lines.some((l) => l.startsWith('Drop on')), pre?.lines);
        await minTextCheck(h, `${label} field drag`);
        await h.shot(`field-drag-${label}`);
        await h.mouseLogical('up', mid.at[0], mid.at[1]);
        await h.p.waitForTimeout(150);
        dragged = { from: [q, r], to: mid.to };
        break;
      }
      const fd = await h.state();
      check(results, `${label} field drag: dropping on a lit hex moves the module and resumes`, dragged !== null && fd.crystal.some((m) => m[0] === dragged.to[0] && m[1] === dragged.to[1]) && !fd.paused, { dragged, crystal: fd.crystal, paused: fd.paused });
      check(results, `${label} editor: no console errors`, h.errors.length === 0, h.errors);
      await h.close();
    }
  },

  async meta() {
    for (const [device, label] of [['phone', 'portrait'], ['desktop', 'landscape']]) {
      const h = await open(browser, srv.base, device, '?seed=4');
      const s0 = await h.state();
      check(results, `${label} meta: a fresh save starts straight in a run (instant play)`, s0.scene === 'Battle', s0);
      await h.call('setSpeed', 5);
      const dead = await h.waitFor((x) => x.overlay, 60000, 100);
      const m1 = await h.call('meta');
      check(results, `${label} meta: death pays Bits into the save and marks the first run done`, dead.ok && m1.bits > 0 && m1.firstRunDone && m1.runs === 1, m1);
      await h.p.waitForTimeout(400);
      await h.shot(`death-${label}`);
      const ui = await h.call('ui');
      // ×2 BITS (local ad grants after ~2 s) doubles the run's Bits.
      await h.tapLogical(...centre(ui.double));
      await h.p.waitForFunction((b) => window.__cp.meta().bits >= b * 2 - 1, m1.bits, { timeout: 6000 }).catch(() => {});
      const m2 = await h.call('meta');
      check(results, `${label} meta: ×2 BITS (rewarded) doubles the payout`, m2.bits >= m1.bits * 2 - 1, { before: m1.bits, after: m2.bits });
      await h.tapLogical(...centre(ui.home));
      await h.p.waitForTimeout(500);
      const sh = await h.state();
      check(results, `${label} meta: HOME opens the home screen`, sh.scene !== 'Battle', sh);
      // The first run's starter cards are revealed on Home: close the reveal.
      const okR = await h.p.evaluate(() => window.__cp.game.scene.getScene('Home').modalButtons[0]?.r ?? null);
      if (okR) {
        await h.tapLogical(...centre(okR));
        await h.p.waitForTimeout(200);
      }
      // Workshop: buy Damage with the Bits we have.
      await h.call('meta', { bits: 5000 });
      await h.call('homeTab', 'workshop');
      await h.p.waitForTimeout(300);
      const buy = await h.p.evaluate(() => {
        const scene = window.__cp.game.scene.getScene('Home');
        const b = scene.buttons.find((x) => x.label.text.startsWith('◆'));
        return b ? b.r : null;
      });
      await h.tapLogical(...centre(buy));
      await h.p.waitForTimeout(200);
      const m3 = await h.call('meta');
      check(results, `${label} meta: a workshop purchase spends Bits and raises the level`, m3.workshop.damage === 1 && m3.bits < 5000, m3.workshop);
      await h.shot(`workshop-${label}`);
      // A new run starts with the workshop level; SAVE & EXIT keeps it for CONTINUE.
      await h.call('goto', 'Battle', { mode: 'new', tier: 1 });
      await h.p.waitForFunction(() => window.__cp.ready() && window.__cp.state().scene === 'Battle', null, { timeout: 5000 });
      await h.call('pickPerk', 0);
      await h.call('setSpeed', 5);
      const w2 = await h.waitFor((x) => x.wave >= 2, 20000, 100);
      check(results, `${label} meta: the new run carries the workshop level`, w2.ok && (await h.p.evaluate(() => window.__cp.game.scene.getScene('Battle').session.world.workshop.damage)) === 1, w2.s);
      await h.call('pause', true);
      await h.p.waitForTimeout(200);
      const ex = await h.p.evaluate(() => window.__cp.game.scene.getScene('Battle').exitBtn.r);
      await h.tapLogical(...centre(ex));
      await h.p.waitForTimeout(500);
      const home = await h.state();
      const saved = await h.p.evaluate(() => localStorage.getItem('core-protocol.run') !== null);
      check(results, `${label} meta: SAVE & EXIT returns home with a saved run`, home.scene !== 'Battle' && saved, { home, saved });
      await h.shot(`home-continue-${label}`);
      await h.call('goto', 'Battle', { mode: 'continue' });
      await h.p.waitForFunction(() => window.__cp.ready() && window.__cp.state().scene === 'Battle', null, { timeout: 5000 }).catch(async (e) => {
        console.log('continue failed', h.errors, JSON.stringify(await h.state()).slice(0, 300));
        throw e;
      });
      const c = await h.state();
      check(results, `${label} meta: CONTINUE resumes the saved run`, c.wave === w2.s.wave || c.wave === w2.s.wave + 1, { saved: w2.s.wave, now: c.wave });
      check(results, `${label} meta: no console errors`, h.errors.length === 0, h.errors);
      await h.close();
    }
  },

  async cards() {
    for (const [device, label] of [['phone', 'portrait'], ['desktop', 'landscape']]) {
      const h = await open(browser, srv.base, device, '?weak=1&seed=4');
      await h.call('setSpeed', 5);
      await h.waitFor((x) => x.overlay, 25000, 100);
      const m1 = await h.call('meta');
      check(results, `${label} cards: the first death grants 2 starter cards of different tags, equipped`, m1.starterGiven && m1.loadout.length === 2 && Object.keys(m1.cards).length === 2, { cards: m1.cards, loadout: m1.loadout });
      await h.tapLogical(...centre((await h.call('ui')).home));
      await h.p.waitForTimeout(700);
      const modal = await h.p.evaluate(() => {
        const sc = window.__cp.game.scene.getScene('Home');
        return { n: sc.modal.length, ok: sc.modalButtons[0]?.r ?? null, tabs: sc.tabButtons.map((b) => b.label.text) };
      });
      check(results, `${label} cards: Home reveals the starter cards; the CARDS tab exists`, modal.n > 0 && modal.ok !== null && modal.tabs.includes('CARDS'), modal);
      await h.shot(`starter-${label}`);
      await h.tapLogical(...centre(modal.ok));
      await h.p.waitForTimeout(200);
      await h.call('meta', { keys: 30 });
      await h.call('homeTab', 'cards');
      await h.p.waitForTimeout(300);
      const packBtn = await h.p.evaluate(() => window.__cp.game.scene.getScene('Home').buttons.find((b) => /PACK · /.test(b.label.text)).r);
      await h.tapLogical(...centre(packBtn));
      await h.p.waitForTimeout(800);
      const m2 = await h.call('meta');
      const copies = Object.values(m2.cards).reduce((a, b) => a + b, 0);
      check(results, `${label} cards: OPEN PACK spends 10 Keys for 3 cards`, m2.keys === 20 && copies === 5 && m2.packs === 1, { keys: m2.keys, copies });
      await h.shot(`pack-${label}`);
      const ok2 = await h.p.evaluate(() => window.__cp.game.scene.getScene('Home').modalButtons[0].r);
      await h.tapLogical(...centre(ok2));
      await h.p.waitForTimeout(200);
      await minTextCheck(h, `${label} cards tab`);
      await h.shot(`cards-${label}`);
      await h.call('goto', 'Battle', { mode: 'new', tier: 1 });
      await h.p.waitForFunction(() => window.__cp.ready() && window.__cp.state().scene === 'Battle', null, { timeout: 5000 });
      const run = await h.p.evaluate(() => {
        const w = window.__cp.game.scene.getScene('Battle').session.world;
        return { tags: w.cardTags, cards: w.cards.map((c) => c.id), sets: w.setTiers };
      });
      check(results, `${label} cards: the equipped cards reach the run (tags count toward sets)`, run.tags.length === 2, run);
      check(results, `${label} cards: no console errors`, h.errors.length === 0, h.errors);
      await h.close();
    }
  },

  async stats() {
    for (const [device, label] of [['phone', 'portrait'], ['desktop', 'landscape']]) {
      const h = await open(browser, srv.base, device, '?seed=5');
      await h.call('setSpeed', 5);
      await h.waitFor((x) => x.wave >= 2, 30000, 100);
      await h.call('pause', true);
      await h.p.waitForTimeout(200);
      const btn = await h.p.evaluate(() => window.__cp.game.scene.getScene('Battle').statsBtn.r);
      await h.tapLogical(...centre(btn));
      await h.p.waitForTimeout(300);
      const st = await h.p.evaluate(() => {
        const b = window.__cp.game.scene.getScene('Battle');
        return { visible: b.statsPanel.visible, kills: b.runStats.kills, worldKills: b.session.world.kills, close: b.statsPanel.closeRect() };
      });
      const k = Object.values(st.kills).reduce((a, b) => a + b, 0);
      check(results, `${label} stats: STATS opens from pause; kills match the world`, st.visible && k === st.worldKills && k > 0, st);
      await minTextCheck(h, `${label} stats panel`);
      await h.shot(`stats-${label}`);
      await h.tapLogical(...centre(st.close));
      await h.p.waitForTimeout(200);
      const closed = await h.p.evaluate(() => !window.__cp.game.scene.getScene('Battle').statsPanel.visible);
      check(results, `${label} stats: CLOSE returns to the paused battle`, closed && (await h.state()).paused, closed);
      // Death → STATS from the death screen; lifetime stats grow.
      await h.call('pause', false);
      await h.waitFor((x) => x.overlay, 60000, 100);
      const ds = await h.p.evaluate(() => window.__cp.game.scene.getScene('Battle').death.statsRect());
      await h.tapLogical(...centre(ds));
      await h.p.waitForTimeout(300);
      const vis = await h.p.evaluate(() => window.__cp.game.scene.getScene('Battle').statsPanel.visible);
      const life = (await h.call('meta')).lifetime;
      check(results, `${label} stats: STATS from the death screen; lifetime counts the run`, vis && life.runs === 1 && life.waves >= 2 && life.damage > 0, { vis, life });
      await h.call('goto', 'Home');
      await h.p.waitForTimeout(600);
      const okR = await h.p.evaluate(() => window.__cp.game.scene.getScene('Home').modalButtons[0]?.r ?? null);
      if (okR) await h.tapLogical(...centre(okR));
      await h.p.waitForTimeout(200);
      await h.p.evaluate(() => window.__cp.game.scene.getScene('Home').openStats());
      await h.p.waitForTimeout(300);
      await minTextCheck(h, `${label} lifetime stats`);
      await h.shot(`lifetime-${label}`);
      check(results, `${label} stats: no console errors`, h.errors.length === 0, h.errors);
      await h.close();
    }
  },

  async leaderboard() {
    for (const [device, label] of [['phone169', 'lb portrait 360×640'], ['desktop', 'lb landscape']]) {
      const m = lbMock();
      const q = '?home=1&weak=1&lb=http://lb.test&lbforce=1';
      const h = await open(browser, srv.base, device, q, { routes: m.routes });
      await h.p.waitForTimeout(500);
      // Home prefetches a server-issued tier start (ranked runs need one): that registers the player once.
      await h.p.waitForFunction(() => window.__cp.lb().identity !== null, null, { timeout: 5000 }).catch(() => {});
      check(results, `${label}: Home registers once and prefetches a tier start`, m.players === 1 && m.starts.join() === 'tier', { players: m.players, starts: m.starts });
      // Home: RANKS opens the panel with the tier board.
      const ranks = await homeBtn(h, 'RANKS');
      const daily = await homeBtn(h, 'DAILY');
      check(results, `${label}: Home shows DAILY and RANKS`, ranks && daily, { ranks, daily });
      await h.tapLogical(...centre(ranks));
      await h.p.waitForFunction(() => window.__cp.game.scene.getScene('Home').lbPanel?.board, null, { timeout: 5000 }).catch(() => {});
      await h.p.waitForFunction(() => window.__cp.lb().identity !== null, null, { timeout: 10000 }).catch(() => {});
      const id = await h.p.evaluate(() => window.__cp.lb().identity);
      check(results, `${label}: opening RANKS registers once with the mocked API`, id?.friendCode === 'K7M2QX' && m.players === 1, { id, players: m.players });
      let p = await lbPanel(h);
      check(results, `${label}: panel loads the tier board with my row pinned`, p.visible && p.board === 't:1' && p.rows >= 8 && !p.status, p);
      await minTextCheck(h, `${label} ranks panel`);
      await h.shot(`ranks-${device}`);
      // Fits the card: every button inside the layout.
      const L = await h.p.evaluate(() => window.__cp.game.registry.get('layout'));
      const out = Object.entries(p.rects).filter(([, r]) => r.x < 0 || r.y < 0 || r.x + r.w > L.w || r.y + r.h > L.h);
      check(results, `${label}: panel buttons inside the screen`, out.length === 0, out);
      await h.tapLogical(...centre(p.rects['kind:daily']));
      await h.p.waitForTimeout(400);
      await h.tapLogical(...centre((await lbPanel(h)).rects['scope:friends']));
      await h.p.waitForTimeout(400);
      p = await lbPanel(h);
      check(results, `${label}: DAILY tab + FRIENDS toggle`, p.kind === 'daily' && p.scope === 'friends' && p.rows === 2 && m.boards.some((b) => b.startsWith('/boards/daily?scope=friends')), { p, boards: m.boards });
      await h.tapLogical(...centre(p.rects['kind:weekly']));
      await h.p.waitForTimeout(400);
      p = await lbPanel(h);
      check(results, `${label}: WEEKLY tab`, p.kind === 'weekly' && m.boards.some((b) => b.startsWith('/boards/weekly/1?')), m.boards);
      // The first board call races the registration (a public read); once registered, every call is signed.
      check(results, `${label}: board calls are authenticated`, m.auth.slice(1).length > 0 && m.auth.slice(1).every((a) => a === 'Bearer p_smoke.sekret'), m.auth);
      await h.shot(`ranks-weekly-${device}`);
      // Rename and add-friend go through the DOM prompt.
      await h.tapLogical(...centre(p.rects.rename));
      await h.p.waitForSelector('.cp-prompt input', { timeout: 3000 });
      await h.p.fill('.cp-prompt input', 'x');
      await h.p.click('.cp-prompt-ok');
      const hint = await h.p.textContent('.cp-prompt-hint');
      await h.p.fill('.cp-prompt input', 'Smoke Tester');
      await h.p.click('.cp-prompt-ok');
      await h.p.waitForTimeout(400);
      const nm = await h.p.evaluate(() => window.__cp.lb().identity.name);
      check(results, `${label}: rename validates locally, then PATCHes`, /3–20/.test(hint ?? '') && m.renames.join() === 'Smoke Tester' && nm === 'Smoke Tester', { hint, renames: m.renames, nm });
      await h.tapLogical(...centre((await lbPanel(h)).rects.add));
      await h.p.waitForSelector('.cp-prompt input', { timeout: 3000 });
      await h.p.fill('.cp-prompt input', 'abc-def');
      await h.p.click('.cp-prompt-ok');
      await h.p.waitForTimeout(400);
      check(results, `${label}: friend code is normalised before POST /friends`, m.friends.join() === 'ABCDEF', m.friends);
      // FOLLOWING: the list of followed players replaces the board; UNFOLLOW removes one.
      await h.tapLogical(...centre((await lbPanel(h)).rects.following));
      await h.p.waitForFunction(() => window.__cp.game.scene.getScene('Home').lbPanel?.friends, null, { timeout: 5000 }).catch(() => {});
      p = await lbPanel(h);
      const unf = p.rects['unfollow:ABCDEF'];
      const outF = Object.entries(p.rects).filter(([, r]) => r.x < 0 || r.y < 0 || r.x + r.w > L.w || r.y + r.h > L.h);
      check(results, `${label}: FOLLOWING lists followed players with UNFOLLOW, inside the screen`, p.view === 'friends' && p.friends === 1 && !!unf && outF.length === 0, { p, outF });
      await h.shot(`ranks-following-${device}`);
      await h.tapLogical(...centre(unf));
      await h.p.waitForTimeout(500);
      p = await lbPanel(h);
      check(results, `${label}: UNFOLLOW sends DELETE and reloads the list`, m.friends.length === 0 && p.friends === 0, { friends: m.friends, p });
      await h.tapLogical(...centre(p.rects.following));
      await h.p.waitForTimeout(400);
      check(results, `${label}: BACK returns to the board`, (await lbPanel(h)).view === 'board', null);
      await h.tapLogical(...centre((await lbPanel(h)).rects.close));
      await h.p.waitForTimeout(200);
      check(results, `${label}: CLOSE hides the panel`, !(await lbPanel(h)).visible, null);
      // DAILY: the day's seed and loadout; the death screen shows the submission and rank.
      await h.tapLogical(...centre(daily));
      await h.p.waitForFunction(() => window.__cp.game.scene.isActive('Battle') && window.__cp.ready(), null, { timeout: 10000 });
      const board = await h.p.evaluate(() => window.__cp.game.scene.getScene('Battle').board);
      check(results, `${label}: DAILY starts a daily run`, board.kind === 'daily' && /^\d{4}-\d{2}-\d{2}$/.test(board.day), board);
      await h.call('breach'); // the daily loadout outlives ?weak=1's core
      await dieNow(h, label);
      await h.p.waitForFunction(() => /rank ~/.test(window.__cp.game.scene.getScene('Battle').death.rankText), null, { timeout: 8000 }).catch(() => {});
      const rank = await h.p.evaluate(() => window.__cp.game.scene.getScene('Battle').death.rankText);
      const st = await h.state();
      const sub = m.runs[0];
      const rp = sub ? decodeReplay(sub.replay) : null;
      check(results, `${label}: death screen shows "submitted · rank ~N"`, /submitted · daily rank ~\S+/.test(rank), rank);
      check(
        results,
        `${label}: the daily run is submitted with seed, claim, full log, wave, ticks, hash, commit`,
        sub && sub.kind === 'daily' && sub.day === board.day && typeof sub.token === 'string' && sub.token.endsWith('.mock-tok') && st.seed === 424242 && sub.wave === st.wave && sub.ticks === st.tick && /^[0-9a-f]{8}$/.test(sub.hash) && typeof sub.commit === 'string' && rp.v === 1 && rp.seed === st.seed && rp.claim && Array.isArray(rp.log) && rp.log.length === st.commands,
        { sub: sub && { ...sub, replay: sub.replay.slice(0, 20) }, rp: rp && { ...rp, log: rp.log.length }, st: { wave: st.wave, tick: st.tick, seed: st.seed, commands: st.commands } },
      );
      await minTextCheck(h, `${label} death + rank`);
      await h.shot(`death-rank-${device}`);
      // Offline: the next run waits in the queue (and survives), then uploads once the API is back.
      m.offline = true;
      await h.call('restart');
      await h.p.waitForTimeout(300);
      await h.call('breach');
      await dieNow(h, `${label} offline`);
      await h.p.waitForFunction(() => /offline/.test(window.__cp.game.scene.getScene('Battle').death.rankText), null, { timeout: 8000 }).catch(() => {});
      const off = await h.p.evaluate(() => ({ line: window.__cp.game.scene.getScene('Battle').death.rankText, queued: window.__cp.lb().queued.length }));
      check(results, `${label}: offline → queued, death screen says so`, off.queued === 1 && /offline/.test(off.line) && m.runs.length === 1, off);
      m.offline = false;
      await h.p.evaluate(() => window.__cp.lb().flush());
      const after = await h.p.evaluate(() => window.__cp.lb().queued.length);
      check(results, `${label}: the queue uploads when back online, with its start token`, after === 0 && m.runs.length === 2 && typeof m.runs[1]?.token === 'string' && m.runs[1].token.endsWith('.mock-tok') && m.runs[1].token !== m.runs[0].token, {
        after,
        runs: m.runs.length,
        token: m.runs[1]?.token,
      });
      // The browser logs the aborted (offline) upload itself; anything else is a game error.
      const errs = h.errors.filter((e) => !/ERR_INTERNET_DISCONNECTED/.test(e));
      check(results, `${label}: no console errors`, errs.length === 0, errs);
      await h.close();
    }
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
    if (only && !only.split(',').includes(name)) continue;
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

// Home (spec §4): top bar with Bits / Keys, tabs ⚔ Battle · 🔧 Workshop · 🧪 Labs · ⚙ Settings
// (🃏 Cards joins in M5 after the first run). Every view is rebuilt on refresh: menus change rarely.

import Phaser from 'phaser';
import { DEFAULT_META_DATA, type MetaData } from '../../meta/metaData';
import { buyLab, labEffects, labState } from '../../meta/labs';
import { offlineReward } from '../../meta/offline';
import { settleRun } from '../../meta/runEnd';
import { buyWorkshop, workshopCost, workshopMax, workshopUnlocked } from '../../meta/workshop';
import { services } from '../../services';
import { DEFAULT_DATA, type GameData, STAT_IDS, type StatId, type TabId } from '../../sim/data';
import { statValue } from '../../sim/stats';
import { formatNum, formatStat, type StatFormatKind } from '../../ui/format';
import { homeGeometry, type HomeGeometry } from '../../ui/home/homeLayout';
import { Button, panel, text } from '../../ui/kit';
import { labEffectText } from '../../ui/labText';
import type { Layout, Rect } from '../../ui/layout';
import { BITS_CSS, CYAN, ENERGY, KEY_CSS, LOCKED, LOCKED_CSS, PANEL_FILL, TAB_COLOR, TAB_CSS, TEXT, TEXT_DIM } from '../palette';
import { ps, RS } from '../resolution';

type HomeTab = 'battle' | 'workshop' | 'labs' | 'settings';
const TABS: { id: HomeTab; label: string }[] = [
  { id: 'battle', label: 'BATTLE' },
  { id: 'workshop', label: 'WORKSHOP' },
  { id: 'labs', label: 'LABS' },
  { id: 'settings', label: 'SETTINGS' },
];

export interface HomeInit {
  tab?: HomeTab;
}

export class HomeScene extends Phaser.Scene {
  L!: Layout;
  G!: HomeGeometry;
  gd: GameData = DEFAULT_DATA;
  md: MetaData = DEFAULT_META_DATA;
  tab: HomeTab = 'battle';
  wsTab: TabId = 'atk';
  labBranch = 'speed';
  private tabButtons: Button[] = [];
  private view: Phaser.GameObjects.GameObject[] = [];
  private buttons: Button[] = [];
  private bitsText!: Phaser.GameObjects.Text;
  private keysText!: Phaser.GameObjects.Text;
  private modal: Phaser.GameObjects.GameObject[] = [];
  private modalButtons: Button[] = [];

  constructor() {
    super('Home');
  }

  init(data: HomeInit): void {
    if (data?.tab) this.tab = data.tab;
  }

  create(): void {
    // Scenes are re-used on every visit: drop references to the previous visit's (destroyed) objects.
    this.tabButtons = [];
    this.view = [];
    this.buttons = [];
    this.modal = [];
    this.modalButtons = [];
    this.L = this.registry.get('layout') as Layout;
    this.G = homeGeometry(this.L, TABS.length);
    this.cameras.main.setZoom(RS).centerOn(this.L.w / 2, this.L.h / 2);
    this.drawBackdrop();
    this.drawTopBar();
    TABS.forEach((t, i) => {
      const b = new Button(this, this.G.tabs[i]!, t.label, this.G.font, 5, () => this.setTab(t.id), { font: 'ui', cut: 12, blur: 10 });
      this.tabButtons.push(b);
    });
    this.refresh();
    services.guard.gameplayStop?.();
    this.maybeOffline();
  }

  // ---------------------------------------------------------------------------------------------------
  private drawBackdrop(): void {
    const g = this.add.graphics().setDepth(0);
    g.fillStyle(0x070b1a, 1).fillRect(0, 0, this.L.w, this.L.h);
    g.lineStyle(1, 0x1f6bff, 0.12);
    for (let x = 0; x <= this.L.w; x += 48) g.lineBetween(x, 0, x, this.L.h);
    for (let y = 0; y <= this.L.h; y += 48) g.lineBetween(0, y, this.L.w, y);
    // A dim core glyph in the background.
    const cx = this.L.o === 'portrait' ? this.L.w / 2 : this.G.content.x + this.G.content.w / 2;
    const cy = this.L.o === 'portrait' ? this.L.h * 0.42 : this.L.h * 0.55;
    g.lineStyle(3, CYAN, 0.08);
    const r = this.L.o === 'portrait' ? 260 : 220;
    const pts: { x: number; y: number }[] = [];
    for (let i = 0; i < 6; i++) pts.push({ x: cx + r * Math.cos((Math.PI / 3) * i + Math.PI / 6), y: cy + r * Math.sin((Math.PI / 3) * i + Math.PI / 6) });
    g.strokePoints(pts, true);
  }

  private drawTopBar(): void {
    const t = this.G.top;
    const g = this.add.graphics().setDepth(1);
    g.fillStyle(PANEL_FILL, 0.95).fillRect(t.x, t.y, t.w, t.h);
    g.lineStyle(2, CYAN, 0.6).lineBetween(0, t.h, this.L.w, t.h);
    const portrait = this.L.o === 'portrait';
    text(this, 24, t.h / 2, portrait ? 'CORE\nPROTOCOL' : 'CORE PROTOCOL', portrait ? 30 : 30, { font: 'title', weight: '900', glow: '#22e5ff', blur: 12 })
      .setOrigin(0, 0.5)
      .setDepth(2)
      .setLineSpacing(-6);
    const f = portrait ? 34 : 24;
    const kx = this.L.w - 24;
    this.keysText = text(this, kx, t.h / 2, '0', f, { color: KEY_CSS, glow: KEY_CSS, blur: 8 }).setOrigin(1, 0.5).setDepth(2);
    this.add.image(0, t.h / 2, 'ic_key').setScale(ps(portrait ? 1.3 : 1)).setDepth(2).setBlendMode(Phaser.BlendModes.ADD).setName('keyIcon');
    this.bitsText = text(this, 0, t.h / 2, '0', f, { color: BITS_CSS, glow: BITS_CSS, blur: 8 }).setOrigin(1, 0.5).setDepth(2);
    this.add.image(0, t.h / 2, 'ic_bits').setScale(ps(portrait ? 1.3 : 1)).setDepth(2).setBlendMode(Phaser.BlendModes.ADD).setName('bitsIcon');
  }

  private updateTopBar(): void {
    const m = services.meta.meta;
    this.keysText.setText(formatNum(m.keys));
    const keyIcon = this.children.getByName('keyIcon') as Phaser.GameObjects.Image;
    keyIcon.setX(this.keysText.x - this.keysText.width - 26);
    this.bitsText.setText(formatNum(m.bits)).setX(keyIcon.x - 40);
    (this.children.getByName('bitsIcon') as Phaser.GameObjects.Image).setX(this.bitsText.x - this.bitsText.width - 26);
  }

  setTab(t: HomeTab): void {
    this.tab = t;
    this.refresh();
  }

  /** Rebuilds the active view and the top bar. */
  refresh(): void {
    for (const o of this.view) o.destroy();
    for (const b of this.buttons) b.destroy();
    this.view = [];
    this.buttons = [];
    TABS.forEach((t, i) => {
      const on = t.id === this.tab;
      this.tabButtons[i]!.label.setColor(on ? '#22e5ff' : TEXT_DIM).setAlpha(1);
      this.tabButtons[i]!.bg.setAlpha(on ? 1 : 0.45);
    });
    this.updateTopBar();
    if (this.tab === 'battle') this.battleView();
    else if (this.tab === 'workshop') this.workshopView();
    else if (this.tab === 'labs') this.labsView();
    else this.settingsView();
  }

  private save(): void {
    services.meta.save();
  }

  // ---- helpers --------------------------------------------------------------------------------------------
  private t(x: number, y: number, s: string, size: number, color = TEXT, o: { title?: boolean; glow?: string } = {}): Phaser.GameObjects.Text {
    const obj = text(this, x, y, s, size, { color, font: o.title ? 'title' : 'ui', weight: o.title ? '900' : '700', glow: o.glow, blur: o.glow ? 10 : undefined }).setDepth(3);
    this.view.push(obj);
    return obj;
  }

  private btn(r: Rect, label: string, onClick: () => void, st: { edge?: number; fill?: number; color?: string; size?: number; enabled?: boolean } = {}): Button {
    const b = new Button(this, r, label, st.size ?? this.G.font, 4, onClick, { font: 'title', edge: st.edge ?? CYAN, fill: st.fill ?? 0x062a3a, cut: 10, blur: 10, textColor: st.color, glow: st.color });
    if (st.enabled === false) {
      b.bg.setAlpha(0.35);
      b.label.setAlpha(0.45);
      b.zone.disableInteractive();
    }
    this.buttons.push(b);
    return b;
  }

  private card(r: Rect, edge = CYAN, alpha = 0.9): void {
    this.view.push(panel(this, r, 2, { edge, fill: PANEL_FILL, fillA: alpha, cut: 14, blur: 8, lw: 2 }));
  }

  // ---- ⚔ Battle ----------------------------------------------------------------------------------------
  private battleView(): void {
    const m = services.meta.meta;
    const c = this.G.content;
    const portrait = this.L.o === 'portrait';
    const f = this.G.font;
    const tier = Math.min(m.tier, m.tierUnlocked);
    const td = this.gd.tiers[tier - 1]!;
    const cardH = portrait ? 470 : 330;
    const r: Rect = { x: c.x, y: c.y + (portrait ? 30 : 0), w: c.w, h: cardH };
    this.card(r);
    const cx = r.x + r.w / 2;
    this.t(cx, r.y + 26, `TIER ${tier}`, this.G.titleFont + (portrait ? 16 : 8), TEXT, { title: true, glow: '#22e5ff' }).setOrigin(0.5, 0);
    const aw = portrait ? 110 : 80;
    const ah = portrait ? 90 : 60;
    this.btn({ x: r.x + 20, y: r.y + 22, w: aw, h: ah }, '◀', () => this.pickTier(tier - 1), { enabled: tier > 1, size: f + 8 });
    const nextLocked = tier >= m.tierUnlocked;
    this.btn({ x: r.x + r.w - aw - 20, y: r.y + 22, w: aw, h: ah }, '▶', () => this.pickTier(tier + 1), { enabled: !nextLocked, size: f + 8 });
    let y = r.y + 30 + ah + (portrait ? 30 : 16);
    this.t(cx, y, `Enemy HP ×${formatNum(td.hpMul)} · Bits ×${formatNum(td.bitsMul)}`, f, TEXT_DIM).setOrigin(0.5, 0);
    y += f + 14;
    this.t(cx, y, td.condition ? `⚠ ${td.condition}` : 'No special conditions', f, td.condition ? '#ffb03b' : TEXT_DIM).setOrigin(0.5, 0);
    y += f + 14;
    this.t(cx, y, `Best wave: ${m.best[String(tier)] ?? 0}`, f + 4, '#e8fbff').setOrigin(0.5, 0);
    y += f + 26;
    // Milestones.
    const ms = this.md.milestones;
    const mw = (r.w - 60) / ms.waves.length;
    const g = this.add.graphics().setDepth(3);
    this.view.push(g);
    ms.waves.forEach((w, i) => {
      const done = m.milestones.includes(`${tier}:${w}`);
      const x = r.x + 30 + i * mw;
      g.fillStyle(done ? 0x2bffb0 : 0x22e5ff, done ? 0.25 : 0.06).fillRoundedRect(x + 4, y, mw - 8, portrait ? 86 : 60, 8);
      g.lineStyle(2, done ? 0x2bffb0 : LOCKED, 0.9).strokeRoundedRect(x + 4, y, mw - 8, portrait ? 86 : 60, 8);
      this.t(x + mw / 2, y + 6, `W${w}`, f, done ? '#2bffb0' : TEXT).setOrigin(0.5, 0);
      this.t(x + mw / 2, y + 8 + f, `+${ms.keys[i]! + (tier - 1) * ms.keysPerTier}`, f, KEY_CSS).setOrigin(0.5, 0);
    });
    if (nextLocked && tier < this.gd.tiers.length) {
      this.t(cx, r.y + r.h - f - 18, `Reach wave ${this.md.tiers.unlockWave} to unlock tier ${tier + 1}`, f, TEXT_DIM).setOrigin(0.5, 0);
    }
    // Run buttons.
    const saved = services.meta.loadRun();
    const bw = portrait ? 560 : 420;
    const bh = portrait ? 120 : 80;
    let by = r.y + r.h + (portrait ? 50 : 26);
    if (saved) {
      this.btn({ x: cx - bw / 2, y: by, w: bw, h: bh }, `CONTINUE · T${saved.world.tier} W${saved.world.wave}`, () => this.continueRun(), { size: this.G.big, edge: 0x2bffb0, fill: 0x063a2a, color: '#2bffb0' });
      by += bh + 20;
      this.btn({ x: cx - bw / 2, y: by, w: bw, h: portrait ? 90 : 60 }, 'ABANDON RUN', () => this.abandonRun(), { edge: 0xff3b5c, fill: 0x2a0610, color: '#ff8a9b' });
    } else {
      this.btn({ x: cx - bw / 2, y: by, w: bw, h: bh }, 'START RUN', () => this.startRun(tier), { size: this.G.big + 6, edge: 0x2bffb0, fill: 0x063a2a, color: '#2bffb0' });
    }
    // Progress summary.
    const e = labEffects(m, this.md);
    const wsLevels = Object.values(m.workshop).reduce((a, b) => a + (b ?? 0), 0);
    const summary = [
      `Runs ${m.runs} · Workshop levels ${wsLevels}`,
      `Labs ${m.labs.length}/${this.md.labs.nodes.length} · Speeds ${e.speeds.map((s) => `×${s}`).join(' ')}`,
      `Offline cache ${e.offlineCapHours}h · Bits ×${e.bitsMul.toFixed(2)}`,
    ];
    if (portrait) {
      const sr: Rect = { x: c.x, y: c.y + c.h - 3 * (f + 16) - 40, w: c.w, h: 3 * (f + 16) + 30 };
      this.card(sr, 0x1f6bff, 0.7);
      summary.forEach((s, i) => this.t(sr.x + 24, sr.y + 18 + i * (f + 16), s, f, TEXT_DIM));
    } else {
      this.t(cx, c.y + c.h - f - 4, summary.join('   ·   '), f - 2 >= this.L.minFont ? f - 2 : f, TEXT_DIM).setOrigin(0.5, 0);
    }
  }

  private pickTier(t: number): void {
    const m = services.meta.meta;
    m.tier = Math.max(1, Math.min(m.tierUnlocked, t));
    this.save();
    this.refresh();
  }

  startRun(tier: number): void {
    this.scene.start('Battle', { mode: 'new', tier });
  }

  continueRun(): void {
    this.scene.start('Battle', { mode: 'continue' });
  }

  private abandonRun(): void {
    const saved = services.meta.loadRun();
    if (saved) {
      const w = saved.world;
      settleRun(services.meta.meta, this.gd, this.md, { tier: w.tier, wave: w.wave, bits: w.bits, keys: w.keys, doubled: false });
    }
    services.meta.clearRun();
    this.save();
    this.refresh();
  }

  // ---- 🔧 Workshop ---------------------------------------------------------------------------------------
  private subTabs(ids: { id: string; label: string; color?: string }[], active: string, onPick: (id: string) => void): void {
    const s = this.G.sub;
    const w = (s.w - (ids.length - 1) * 10) / ids.length;
    ids.forEach((t, i) => {
      const on = t.id === active;
      const b = this.btn({ x: s.x + i * (w + 10), y: s.y, w, h: s.h }, t.label, () => onPick(t.id), {
        size: this.G.font,
        color: on ? (t.color ?? '#22e5ff') : TEXT_DIM,
      });
      if (!on) b.bg.setAlpha(0.45);
    });
  }

  private workshopView(): void {
    const m = services.meta.meta;
    const c = this.G.content;
    const f = this.G.font;
    this.t(c.x, c.y, 'WORKSHOP · permanent starting stats', f, TEXT_DIM);
    this.subTabs(
      (['atk', 'def', 'util'] as TabId[]).map((id) => ({ id, label: id.toUpperCase(), color: TAB_CSS[id] })),
      this.wsTab,
      (id) => {
        this.wsTab = id as TabId;
        this.refresh();
      },
    );
    const stats = STAT_IDS.filter((id) => this.gd.stats.stats[id].tab === this.wsTab);
    const R = this.G.rows;
    stats.forEach((id, i) => this.workshopRow(id, { x: R.x, y: R.y + i * (this.G.rowH + (this.L.o === 'portrait' ? 14 : 10)), w: R.w, h: this.G.rowH }, m.bits));
  }

  private workshopRow(id: StatId, r: Rect, bits: number): void {
    const m = services.meta.meta;
    const def = this.gd.stats.stats[id];
    const f = this.G.font;
    const unlocked = workshopUnlocked(m, this.gd, this.md, id);
    const lvl = m.workshop[id] ?? 0;
    const max = workshopMax(m, this.gd, this.md, id);
    const cost = workshopCost(m, this.md, id);
    const maxed = lvl >= max;
    this.card(r, unlocked ? TAB_COLOR[def.tab] : LOCKED, 0.8);
    const fmt = def.format as StatFormatKind;
    this.t(r.x + 20, r.y + 10, def.name, f + 2, unlocked ? TEXT : LOCKED_CSS);
    const sub = !unlocked ? 'Unlock in LABS' : maxed ? `LV ${lvl} · ${formatStat(fmt, statValue(def, lvl))} · MAX` : `LV ${lvl} · ${formatStat(fmt, statValue(def, lvl))} → ${formatStat(fmt, statValue(def, lvl + 1))}`;
    this.t(r.x + 20, r.y + 14 + f + 2, sub, f, unlocked ? TEXT_DIM : LOCKED_CSS);
    const bw = this.L.o === 'portrait' ? 190 : 170;
    const ok = unlocked && !maxed && bits >= cost;
    this.btn({ x: r.x + r.w - bw - 14, y: r.y + 10, w: bw, h: r.h - 20 }, !unlocked ? 'LAB' : maxed ? 'MAX' : `◆ ${formatNum(cost)}`, () => {
      if (buyWorkshop(m, this.gd, this.md, id)) {
        this.save();
        this.refresh();
      }
    }, { enabled: ok, color: BITS_CSS, edge: ok ? 0x5cf2ff : LOCKED });
  }

  // ---- 🧪 Labs ------------------------------------------------------------------------------------------
  private labsView(): void {
    const m = services.meta.meta;
    const c = this.G.content;
    const f = this.G.font;
    this.t(c.x, c.y, 'LABS · research that changes the rules', f, TEXT_DIM);
    this.subTabs(
      this.md.labs.branches.map((b) => ({ id: b.id, label: this.L.o === 'portrait' ? b.name.slice(0, 4).toUpperCase() : b.name.toUpperCase() })),
      this.labBranch,
      (id) => {
        this.labBranch = id;
        this.refresh();
      },
    );
    const nodes = this.md.labs.nodes.filter((n) => n.branch === this.labBranch);
    const R = this.G.rows;
    nodes.forEach((n, i) => {
      const r: Rect = { x: R.x, y: R.y + i * (this.G.rowH + (this.L.o === 'portrait' ? 14 : 10)), w: R.w, h: this.G.rowH };
      const st = labState(m, this.md, n.id);
      this.card(r, st === 'owned' ? 0x2bffb0 : st === 'available' ? CYAN : LOCKED, 0.8);
      this.t(r.x + 20, r.y + 10, n.name, f + 2, st === 'locked' ? LOCKED_CSS : TEXT);
      const req = n.requires.map((q) => this.md.labs.nodes.find((x) => x.id === q)?.name ?? q).join(', ');
      this.t(r.x + 20, r.y + 14 + f + 2, st === 'locked' ? `Needs ${req}` : labEffectText(this.gd, n.effect), f, st === 'locked' ? LOCKED_CSS : TEXT_DIM).setWordWrapWidth(r.w - 260);
      const bw = this.L.o === 'portrait' ? 190 : 170;
      const ok = st === 'available' && m.bits >= n.cost;
      this.btn({ x: r.x + r.w - bw - 14, y: r.y + 10, w: bw, h: r.h - 20 }, st === 'owned' ? 'OWNED' : `◆ ${formatNum(n.cost)}`, () => {
        if (buyLab(m, this.md, n.id)) {
          this.save();
          this.refresh();
        }
      }, { enabled: ok, color: st === 'owned' ? '#2bffb0' : BITS_CSS, edge: st === 'owned' ? 0x2bffb0 : ok ? 0x5cf2ff : LOCKED });
    });
  }

  // ---- ⚙ Settings ----------------------------------------------------------------------------------------
  private settingsView(): void {
    const m = services.meta.meta;
    const c = this.G.content;
    const f = this.G.font;
    const portrait = this.L.o === 'portrait';
    this.t(c.x, c.y, 'SETTINGS', this.G.titleFont, TEXT, { title: true, glow: '#22e5ff' });
    const rows: [keyof typeof m.settings, string][] = [
      ['sound', 'Sound effects'],
      ['music', 'Music'],
      ['reduceMotion', 'Reduce motion (no shake)'],
    ];
    const h = portrait ? 110 : 70;
    rows.forEach(([key, label], i) => {
      const r: Rect = { x: c.x, y: c.y + (portrait ? 90 : 60) + i * (h + 16), w: c.w, h };
      this.card(r);
      this.t(r.x + 20, r.y + h / 2, label, f + 2).setOrigin(0, 0.5);
      const on = m.settings[key];
      this.btn({ x: r.x + r.w - 200, y: r.y + 12, w: 180, h: h - 24 }, on ? 'ON' : 'OFF', () => {
        m.settings[key] = !m.settings[key];
        this.save();
        this.refresh();
      }, { color: on ? '#2bffb0' : TEXT_DIM, edge: on ? 0x2bffb0 : LOCKED });
    });
    const e = labEffects(m, this.md);
    this.t(c.x, c.y + (portrait ? 90 : 60) + 3 * (h + 16) + 20, `Progress is saved on this device.\nSpeeds unlocked: ${e.speeds.map((s) => `×${s}`).join(' ')}`, f, TEXT_DIM).setLineSpacing(8);
  }

  // ---- Offline income ---------------------------------------------------------------------------------------
  private maybeOffline(): void {
    const meta = services.meta;
    const r = offlineReward(meta.meta, this.gd, this.md, Date.now());
    meta.save(); // stamps lastSeen: the window for the next reward starts now
    if (r.bits <= 0) return;
    const L = this.L;
    const portrait = L.o === 'portrait';
    const D = 20;
    const dim = this.add.graphics().setDepth(D);
    dim.fillStyle(0x02040c, 0.82).fillRect(0, 0, L.w, L.h);
    const blocker = this.add.zone(L.w / 2, L.h / 2, L.w, L.h).setDepth(D).setInteractive();
    const cw = portrait ? 620 : 520;
    const ch = portrait ? 520 : 380;
    const card: Rect = { x: (L.w - cw) / 2, y: (L.h - ch) / 2, w: cw, h: ch };
    const fr = panel(this, card, D + 0.1, { edge: CYAN, fill: PANEL_FILL, fillA: 0.97, cut: 20, blur: 14, lw: 2.5 });
    const title = text(this, L.w / 2, card.y + 40, 'WHILE YOU WERE AWAY', portrait ? 40 : 28, { font: 'title', weight: '900', glow: '#22e5ff', blur: 12 }).setOrigin(0.5, 0).setDepth(D + 0.2);
    const sub = text(this, L.w / 2, card.y + (portrait ? 110 : 84), `${r.hours.toFixed(1)} h of background mining`, portrait ? 28 : 18, { color: TEXT_DIM }).setOrigin(0.5, 0).setDepth(D + 0.2);
    const amt = text(this, L.w / 2, card.y + (portrait ? 190 : 140), `◆ +${formatNum(r.bits)}`, portrait ? 64 : 44, { font: 'title', weight: '900', color: BITS_CSS, glow: BITS_CSS, blur: 14 }).setOrigin(0.5, 0).setDepth(D + 0.2);
    this.modal.push(dim, blocker, fr, title, sub, amt);
    const bw = portrait ? 260 : 210;
    const bh = portrait ? 96 : 64;
    const by = card.y + ch - bh - (portrait ? 44 : 30);
    const close = (mul: number) => {
      meta.meta.bits += r.bits * mul;
      meta.save();
      for (const o of this.modal) o.destroy();
      for (const b of this.modalButtons) b.destroy();
      this.modal = [];
      this.modalButtons = [];
      this.refresh();
    };
    this.modalButtons.push(new Button(this, { x: L.w / 2 - bw - 12, y: by, w: bw, h: bh }, 'CLAIM', portrait ? 32 : 22, D + 0.3, () => close(1), { font: 'title', fill: 0x062a3a }));
    this.modalButtons.push(
      new Button(this, { x: L.w / 2 + 12, y: by, w: bw, h: bh }, 'CLAIM ×2 ▶AD', portrait ? 30 : 20, D + 0.3, () => {
        void services.ads.rewarded('offlineDouble').then((ok) => close(ok ? 2 : 1));
      }, { font: 'title', edge: ENERGY, fill: 0x2a2306, textColor: '#ffd23f', glow: '#ffd23f' }),
    );
  }
}

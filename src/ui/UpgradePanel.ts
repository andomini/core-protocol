// The in-run upgrade panel (spec §2.3, §4): ATK / DEF / UTIL / BUILD tabs, a ×1 / ×10 / MAX toggle and six rows
// `glyph · name · value → next · ⚡price`. Rows you can afford glow; locked rows show a padlock and LAB (BUILD rows:
// "needs Ice Wall" until that structure is built).
// Hold a row to keep buying. Purchases go to the sim as commands (via the host); feedback (row pulse,
// a rising "+N" tick) comes from the sim's `buy` events, so what you see is what the sim accepted.

import Phaser from 'phaser';
import { type BuyCount, buildNeedText, type Command, isUnlocked, quoteFor } from '../sim/commands';
import { type GameData, type StatId, TAB_IDS, type TabId } from '../sim/data';
import type { SimEvent } from '../sim/events';
import type { World } from '../sim/state';
import { type CoreStats, effectiveStats, type Levels, zeroLevels } from '../sim/stats';
import { ENERGY, ENERGY_CSS, LOCKED_CSS, PANEL_FILL, TAB_COLOR, TAB_CSS, TEXT, TEXT_DIM, WHITE } from '../render/palette';
import { ps } from '../render/resolution';
import { bakePanelOnce } from '../render/textures';
import { DEPTH } from '../render/WorldView';
import { formatPrice, formatStat } from './format';
import { panel, text } from './kit';
import type { Layout, Rect } from './layout';
import { type PanelGeo, panelLayout, ROWS } from './panelLayout';

export interface PanelHost {
  world(): World;
  stats(): CoreStats;
  /** Queues (or, while paused, applies) a command. */
  command(cmd: Command): void;
  /** True while a queued command has not reached the sim yet. */
  pending(): boolean;
  /** The stats auto-buy may spend on; a tap on a row's glyph toggles one. */
  auto?: { has(id: StatId): boolean; toggle(id: StatId): void };
}

const AMOUNTS: readonly BuyCount[] = [1, 10, 'max'];
const HOLD_DELAY_MS = 380;
const HOLD_FIRST_MS = 150;
const HOLD_MIN_MS = 55;
const PAD = 12; // bakePanel padding

interface Row {
  stat: StatId | null;
  bg: Phaser.GameObjects.Image;
  flash: Phaser.GameObjects.Image;
  glyph: Phaser.GameObjects.Image;
  name: Phaser.GameObjects.Text;
  level: Phaser.GameObjects.Text | null;
  value: Phaser.GameObjects.Text;
  priceBg: Phaser.GameObjects.Image;
  priceIcon: Phaser.GameObjects.Image;
  price: Phaser.GameObjects.Text;
  zone: Phaser.GameObjects.Zone;
  /** Last rendered state, to skip redundant setText / setTexture (text re-rasterises on change). */
  key: string;
  valueKey: string;
  /** Widget: the AUTO badge (null outside the widget). */
  /** Auto-buy badge (a looping arrow on the glyph's corner) and its drawn state: −1 hidden, 0 off, 1 on. */
  auto: Phaser.GameObjects.Graphics | null;
  autoState: number;
  autoAt: [number, number];
}

export interface PanelRowInfo {
  stat: StatId;
  rect: Rect;
  locked: boolean;
  affordable: boolean;
  level: number;
  auto: boolean;
}

export class UpgradePanel {
  tab: TabId = 'atk';
  amount: BuyCount = 1;
  /** AUTO mode (after MAX on the amount toggle): a row tap marks or unmarks the stat for auto-buy. */
  autoMode = false;
  readonly g: PanelGeo;
  private readonly rows: Row[] = [];
  private readonly tabImgs: Phaser.GameObjects.Image[] = [];
  private readonly tabTexts: Phaser.GameObjects.Text[] = [];
  private readonly amountText: Phaser.GameObjects.Text;
  private readonly ticks: Phaser.GameObjects.Text[] = [];
  private readonly scratch: Levels = zeroLevels();
  private holdRow = -1;
  private holdNext = 0;
  private holdCount = 0;
  private now = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    L: Layout,
    private readonly data: GameData,
    private readonly host: PanelHost,
  ) {
    const g = (this.g = panelLayout(L));
    const D = DEPTH.hud;
    const f = g.fonts;
    panel(scene, g.frame, D - 0.5, { fillA: 0.6, cut: 22, blur: 10, edge: 0x1f6bff });

    // Baked frames (each size once): tabs on/off, toggle, rows off/on per tab, price boxes, flash.
    const t0 = g.tabs[0]!;
    for (const tab of TAB_IDS) bakePanelOnce(scene, `up_tab_${tab}`, t0.w, t0.h, { edge: TAB_COLOR[tab], fill: TAB_COLOR[tab], fillA: 0.16, cut: 12, blur: 10, lw: 2.5 });
    bakePanelOnce(scene, 'up_tab_off', t0.w, t0.h, { edge: 0x2a3f7a, fillA: 0.7, cut: 12, blur: 2, lw: 1.5 });
    bakePanelOnce(scene, 'up_amount', g.amount.w, g.amount.h, { edge: 0x22e5ff, fillA: 0.9, cut: 12, blur: 8 });
    const r0 = g.rows[0]!;
    bakePanelOnce(scene, 'up_row_off', r0.rect.w, r0.rect.h, { edge: 0x1d2c5c, fill: PANEL_FILL, fillA: 0.85, cut: 10, blur: 0, lw: 1.5 });
    for (const tab of TAB_IDS) bakePanelOnce(scene, `up_row_${tab}`, r0.rect.w, r0.rect.h, { edge: TAB_COLOR[tab], fill: PANEL_FILL, fillA: 0.9, cut: 10, blur: 9, lw: 1.5 });
    bakePanelOnce(scene, 'up_row_flash', r0.rect.w, r0.rect.h, { edge: WHITE, fill: WHITE, fillA: 0.35, cut: 10, blur: 12, lw: 2 });
    bakePanelOnce(scene, 'up_price_on', r0.price.w, r0.price.h, { edge: ENERGY, fill: ENERGY, fillA: 0.26, cut: 9, blur: 10, lw: 2 });
    bakePanelOnce(scene, 'up_price_off', r0.price.w, r0.price.h, { edge: 0x34406a, fill: 0x060a1c, fillA: 0.9, cut: 9, blur: 0, lw: 1.5 });

    TAB_IDS.forEach((tab, i) => {
      const r = g.tabs[i]!;
      this.tabImgs.push(this.frameImg(r, 'up_tab_off', D));
      this.tabTexts.push(text(scene, r.x + r.w / 2, r.y + r.h / 2, tab.toUpperCase(), f.tab, { font: 'title', weight: '900', color: TAB_CSS[tab] }).setOrigin(0.5).setDepth(D + 0.2));
      this.zone(r, D, () => this.setTab(tab));
    });
    const a = g.amount;
    this.frameImg(a, 'up_amount', D);
    this.amountText = text(scene, a.x + a.w / 2, a.y + a.h / 2, '×1', f.tab, { font: 'title', weight: '900', glow: '#22e5ff', blur: 8 }).setOrigin(0.5).setDepth(D + 0.2);
    this.zone(a, D, () => this.cycleAmount());

    for (let i = 0; i < ROWS; i++) {
      const rg = g.rows[i]!;
      const r = rg.rect;
      const row: Row = {
        stat: null,
        bg: this.frameImg(r, 'up_row_off', D),
        flash: this.frameImg(r, 'up_row_flash', D + 0.05).setAlpha(0).setBlendMode(Phaser.BlendModes.ADD),
        glyph: scene.add.image(rg.glyph[0], rg.glyph[1], 'st_damage').setScale(ps(g.glyphSize / 38)).setDepth(D + 0.2).setBlendMode(Phaser.BlendModes.ADD),
        name: text(scene, rg.name[0], rg.name[1], '', f.name, { color: TEXT }).setOrigin(0, 0.5).setDepth(D + 0.2),
        level: rg.level ? text(scene, rg.level[0], rg.level[1], '', f.value, { color: TEXT_DIM }).setOrigin(1, 0.5).setDepth(D + 0.2) : null,
        value: text(scene, rg.value[0], rg.value[1], '', f.value, { color: '#9fe9ff' }).setOrigin(g.twoLine ? 0 : 1, 0.5).setDepth(D + 0.2),
        priceBg: this.frameImg(rg.price, 'up_price_off', D + 0.1),
        priceIcon: scene.add.image(rg.price.x + 22, rg.price.y + rg.price.h / 2, 'ic_energy').setScale(ps(L.o === 'portrait' ? 0.95 : 0.7)).setDepth(D + 0.2).setBlendMode(Phaser.BlendModes.ADD),
        price: text(scene, rg.price.x + rg.price.w / 2 + 14, rg.price.y + rg.price.h / 2, '', f.price, { font: 'title', weight: '700', color: ENERGY_CSS }).setOrigin(0.5).setDepth(D + 0.2),
        zone: this.zone(r, D, () => undefined),
        key: '',
        valueKey: '',
        auto: null,
        autoState: -1,
        autoAt: [r.x + g.glyphSize * 0.4 + 6, r.y + g.glyphSize * 0.4 + 6],
      };
      if (host.auto) {
        // A glyph-sized zone above the row's own: a tap there toggles auto-buy instead of buying.
        const gs = g.glyphSize * 1.7;
        this.zone({ x: rg.glyph[0] - gs / 2, y: r.y, w: gs, h: r.h }, D + 0.1, () => {
          if (row.stat) host.auto!.toggle(row.stat);
        });
        row.auto = scene.add.graphics().setDepth(D + 0.3);
      }
      row.zone.on('pointerdown', () => this.press(i));
      row.zone.on('pointerout', () => this.release());
      row.zone.on('pointerup', () => this.release());
      this.rows.push(row);
    }
    scene.input.on('pointerup', () => this.release());
    for (let i = 0; i < ROWS; i++) {
      this.ticks.push(text(scene, 0, 0, '', f.tick, { font: 'title', weight: '900', color: '#ffffff', glow: ENERGY_CSS, blur: 10 }).setOrigin(0.5).setDepth(D + 0.4).setVisible(false));
    }
    this.setTab('atk');
  }

  private frameImg(r: Rect, key: string, depth: number): Phaser.GameObjects.Image {
    return this.scene.add.image(r.x - PAD, r.y - PAD, key).setOrigin(0).setScale(ps(1)).setDepth(depth);
  }

  private zone(r: Rect, depth: number, onDown: () => void): Phaser.GameObjects.Zone {
    const z = this.scene.add.zone(r.x + r.w / 2, r.y + r.h / 2, r.w, r.h).setDepth(depth + 0.3).setInteractive({ useHandCursor: true });
    z.on('pointerdown', onDown);
    return z;
  }

  setTab(tab: TabId): void {
    this.tab = tab;
    TAB_IDS.forEach((t, i) => {
      const on = t === tab;
      this.tabImgs[i]!.setTexture(on ? `up_tab_${t}` : 'up_tab_off');
      this.tabTexts[i]!.setAlpha(on ? 1 : 0.55);
    });
    const ids = this.data.stats.tabs[tab];
    this.rows.forEach((row, i) => {
      row.stat = ids[i] ?? null;
      row.key = '';
      row.valueKey = '';
      row.flash.setAlpha(0);
      row.name.setText(row.stat ? this.data.stats.stats[row.stat].name : '');
    });
    this.release();
  }

  cycleAmount(): void {
    if (this.autoMode) {
      this.autoMode = false;
      this.amount = 1;
    } else if (this.amount === AMOUNTS[AMOUNTS.length - 1] && this.host.auto) {
      this.autoMode = true;
    } else {
      this.amount = AMOUNTS[(AMOUNTS.indexOf(this.amount) + 1) % AMOUNTS.length]!;
    }
    this.amountText.setText(this.autoMode ? 'AUTO' : this.amount === 'max' ? 'MAX' : `×${this.amount}`).setColor(this.autoMode ? ENERGY_CSS : '#e8fbff');
    for (const r of this.rows) r.key = r.valueKey = '';
  }

  reset(): void {
    this.release();
    for (const r of this.rows) {
      r.key = r.valueKey = '';
      r.flash.setAlpha(0);
    }
    for (const t of this.ticks) t.setVisible(false);
  }

  private press(i: number): void {
    if (this.autoMode) {
      const id = this.rows[i]!.stat;
      if (id !== null && isUnlocked(this.host.world(), this.data, id)) this.host.auto!.toggle(id);
      return;
    }
    this.holdRow = i;
    this.holdCount = 0;
    this.holdNext = this.now + HOLD_DELAY_MS;
    this.tryBuy(i, false);
  }

  private release(): void {
    this.holdRow = -1;
  }

  /** Queues a buy for row `i` when the sim would accept it now (the same quote the sim uses). */
  private tryBuy(i: number, repeat: boolean): void {
    const row = this.rows[i]!;
    const id = row.stat;
    if (id === null) return;
    const w = this.host.world();
    if (w.dead) return;
    if (!isUnlocked(w, this.data, id) || !quoteFor(w, this.data, id, this.amount).affordable) {
      if (!repeat) this.shake(row);
      return;
    }
    // While held, wait for the previous buy to land so we never queue on stale Energy.
    if (repeat && this.host.pending()) return;
    this.host.command({ type: 'buy', stat: id, count: this.amount });
  }

  private shake(row: Row): void {
    const x = row.priceBg.x;
    this.scene.tweens.killTweensOf(row.priceBg);
    this.scene.tweens.add({ targets: row.priceBg, x: { from: x - 5, to: x }, duration: 180, ease: 'Elastic.Out', onComplete: () => row.priceBg.setX(x) });
  }

  /** Purchase feedback from sim events. */
  onEvent(e: SimEvent): void {
    if (e.type !== 'buy') return;
    const i = this.rows.findIndex((r) => r.stat === e.stat);
    if (i < 0) return;
    const row = this.rows[i]!;
    const tw = this.scene.tweens;
    tw.killTweensOf(row.flash);
    row.flash.setAlpha(e.free ? 0.9 : 0.6);
    tw.add({ targets: row.flash, alpha: 0, duration: e.free ? 520 : 280, ease: 'Quad.Out' });
    const s = ps(this.g.glyphSize / 38);
    tw.killTweensOf(row.glyph);
    tw.add({ targets: row.glyph, scale: { from: s * 1.35, to: s }, duration: 220, ease: 'Back.Out' });
    tw.killTweensOf(row.value);
    tw.add({ targets: row.value, scale: { from: 1.18, to: 1 }, duration: 200, ease: 'Quad.Out' });
    const t = this.ticks[i]!;
    const rg = this.g.rows[i]!;
    tw.killTweensOf(t);
    t.setText(e.free ? `FREE +${e.levels}` : `+${e.levels}`)
      .setColor(e.free ? '#2bffb0' : '#ffffff')
      .setPosition(rg.price.x + rg.price.w / 2, rg.price.y + rg.price.h / 2)
      .setVisible(true)
      .setAlpha(1);
    tw.add({ targets: t, y: rg.price.y - this.g.fonts.tick * 0.6, alpha: 0, duration: 700, ease: 'Cubic.Out', onComplete: () => t.setVisible(false) });
  }

  /** Value of `id` with `extra` more run levels (the "next" in value → next). */
  private valueWith(w: World, id: StatId, extra: number): number {
    const s = this.scratch;
    Object.assign(s, w.levels);
    s[id] += extra;
    return effectiveStats(this.data, { workshop: w.workshop, run: s, mods: w.mods })[id];
  }

  update(now: number): void {
    this.now = now;
    if (this.holdRow >= 0 && now >= this.holdNext) {
      this.tryBuy(this.holdRow, true);
      this.holdCount++;
      this.holdNext = now + Math.max(HOLD_MIN_MS, HOLD_FIRST_MS - this.holdCount * 12);
    }
    const w = this.host.world();
    const st = this.host.stats();
    for (const row of this.rows) {
      const id = row.stat;
      if (id === null) continue;
      const def = this.data.stats.stats[id];
      const locked = !isUnlocked(w, this.data, id);
      const need = locked ? buildNeedText(w, this.data, id) : null;
      const q = quoteFor(w, this.data, id, this.amount);
      const maxed = q.levels === 0;
      const affordable = !locked && !w.dead && q.affordable;
      const level = w.levels[id];
      // The badge marks a stat on auto-buy.
      const autoOn = this.host.auto?.has(id) ?? false;
      const autoState = locked || maxed || !autoOn ? -1 : 1;
      if (row.auto && autoState !== row.autoState) {
        row.autoState = autoState;
        drawAutoBadge(row.auto.clear(), row.autoAt[0], row.autoAt[1], this.g.glyphSize * 0.24, autoState);
      }
      const key = `${locked ? 'L' : maxed ? 'M' : affordable ? 'A' : 'N'}|${level}|${q.levels}|${formatPrice(q.cost)}|${this.autoMode ? (autoOn ? 'on' : 'off') : ''}`;
      if (key !== row.key) {
        row.key = key;
        row.bg.setTexture(affordable ? `up_row_${def.tab}` : 'up_row_off');
        row.priceBg.setTexture(affordable ? 'up_price_on' : 'up_price_off');
        // A BUILD row waiting for its structure keeps its own glyph (dimmed): the padlock would hide which upgrade it is.
        row.glyph.setTexture(locked && need === null ? 'ic_lock' : `st_${id}`).setAlpha(locked ? (need === null ? 0.8 : 0.4) : affordable || maxed ? 1 : 0.6);
        row.name.setColor(locked ? LOCKED_CSS : TEXT);
        row.priceIcon.setVisible(!locked && !maxed).setAlpha(affordable ? 1 : 0.45);
        const cx = this.priceCenter(row);
        if (locked) row.price.setText(need !== null ? 'LOCKED' : 'LAB').setColor(LOCKED_CSS).setX(cx);
        else if (maxed) row.price.setText('MAX').setColor(TEXT_DIM).setX(cx);
        else if (this.autoMode) {
          row.priceIcon.setVisible(false);
          row.priceBg.setTexture(autoOn ? 'up_price_on' : 'up_price_off');
          row.price.setText(autoOn ? 'ON' : 'OFF').setColor(autoOn ? ENERGY_CSS : TEXT_DIM).setX(cx);
        } else row.price.setText(formatPrice(q.cost)).setColor(affordable ? ENERGY_CSS : '#8a7a4a').setX(cx + 14);
        if (row.level) {
          const more = !locked && !maxed && q.levels > 1 ? ` +${q.levels}` : '';
          row.level.setText(locked ? '' : maxed ? `LV ${level} MAX` : `LV ${level}${more}`);
        }
      }
      // value → next only changes with levels, the buy count or modifiers.
      const cur = st[id];
      const vkey = `${key}|${cur}`;
      if (vkey !== row.valueKey) {
        row.valueKey = vkey;
        // The name stays on every row; a locked BUILD row's value slot says which fusion opens it.
        // Phone rows are too narrow for "needs Wall/Relay" beside the name: they show the bare names, the LOCKED box says the rest.
        const shown = need === null ? formatStat(def.format, cur) : this.g.twoLine ? need : need.replace(/^needs /, '');
        if (locked || maxed) row.value.setText(shown).setColor(locked ? LOCKED_CSS : '#9fe9ff');
        else row.value.setText(`${shown} › ${formatStat(def.format, this.valueWith(w, id, q.levels))}`).setColor('#9fe9ff');
      }
    }
  }

  private priceCenter(row: Row): number {
    const p = this.g.rows[this.rows.indexOf(row)]!.price;
    return p.x + p.w / 2;
  }

  /** Dev/smoke: on-screen bounds of each row's texts and price box, to check nothing collides. */
  textBounds(): { stat: StatId | null; row: Rect; parts: { what: string; text: string; r: Rect }[] }[] {
    const b = (o: Phaser.GameObjects.Text | Phaser.GameObjects.Image): Rect => {
      const r = o.getBounds();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    };
    return this.rows.map((row, i) => {
      const p = this.g.rows[i]!.price;
      const parts = [
        { what: 'name', text: row.name.text, r: b(row.name) },
        { what: 'value', text: row.value.text, r: b(row.value) },
        { what: 'price', text: row.price.text, r: { x: p.x, y: p.y, w: p.w, h: p.h } },
      ];
      if (row.level) parts.push({ what: 'level', text: row.level.text, r: b(row.level) });
      return { stat: row.stat, row: this.g.rows[i]!.rect, parts: parts.filter((x) => x.text !== '' || x.what === 'price') };
    });
  }

  /** Dev/smoke: what each visible row shows and where it is (logical px). */
  info(): { tab: TabId; amount: BuyCount; autoMode: boolean; tabs: { tab: TabId; rect: Rect }[]; amountRect: Rect; rows: PanelRowInfo[] } {
    const w = this.host.world();
    return {
      tab: this.tab,
      amount: this.amount,
      autoMode: this.autoMode,
      tabs: TAB_IDS.map((tab, i) => ({ tab, rect: this.g.tabs[i]! })),
      amountRect: this.g.amount,
      rows: this.rows.flatMap((r, i) =>
        r.stat === null
          ? []
          : [{
              stat: r.stat,
              rect: this.g.rows[i]!.rect,
              // Computed now (not the last drawn state) so a read right after a tab switch is correct.
              locked: !isUnlocked(w, this.data, r.stat),
              affordable: isUnlocked(w, this.data, r.stat) && !w.dead && quoteFor(w, this.data, r.stat, this.amount).affordable,
              level: w.levels[r.stat],
              auto: this.host.auto?.has(r.stat) ?? false,
            }],
      ),
    };
  }
}

/** A circular arrow: bright Energy yellow when the stat is on auto-buy, a dim outline when it is not. */
function drawAutoBadge(g: Phaser.GameObjects.Graphics, x: number, y: number, r: number, state: number): void {
  if (state < 0) return;
  const c = state > 0 ? ENERGY : 0x7f97c8;
  const a = state > 0 ? 1 : 0.7;
  if (state > 0) g.fillStyle(0x2a2306, 0.95).fillCircle(x, y, r * 1.55);
  g.lineStyle(Math.max(2, r * 0.32), c, a);
  g.beginPath();
  g.arc(x, y, r, -Math.PI * 0.35, Math.PI * 1.35);
  g.strokePath();
  const ex = x + r * Math.cos(-Math.PI * 0.35);
  const ey = y + r * Math.sin(-Math.PI * 0.35);
  g.fillStyle(c, a).fillTriangle(ex - r * 0.55, ey - r * 0.35, ex + r * 0.55, ey - r * 0.1, ex + r * 0.05, ey + r * 0.6);
}

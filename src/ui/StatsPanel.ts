// STATS (The Tower-style): tabs of sections with label/value rows. Scrolls (drag / wheel) when the content
// is taller than the panel; landscape lays the sections out in two columns.

import Phaser from 'phaser';
import { CYAN, PANEL_FILL, TEXT, TEXT_DIM } from '../render/palette';
import { DEPTH } from '../render/WorldView';
import { Button, panel, text } from './kit';
import type { Layout, Rect } from './layout';
import type { StatTab } from './statsRows';

const D = DEPTH.overlay + 2;

export class StatsPanel {
  visible = false;
  private readonly fixed: Phaser.GameObjects.GameObject[] = [];
  private readonly blocker: Phaser.GameObjects.Zone;
  private readonly close: Button;
  private readonly card: Rect;
  private readonly area: Rect;
  private readonly content: Phaser.GameObjects.Container;
  private readonly maskShape: Phaser.GameObjects.Graphics;
  private readonly scrollZone: Phaser.GameObjects.Zone;
  private tabButtons: Button[] = [];
  private tabs: StatTab[] = [];
  private active = 0;
  private scroll = 0;
  private contentH = 0;
  private drag: { y: number; scroll: number } | null = null;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly L: Layout,
    onClose: () => void,
  ) {
    const portrait = L.o === 'portrait';
    const dim = scene.add.graphics().setDepth(D);
    dim.fillStyle(0x02040c, 0.88).fillRect(0, 0, L.w, L.h);
    this.blocker = scene.add.zone(L.w / 2, L.h / 2, L.w, L.h).setDepth(D).setInteractive();
    const cw = portrait ? 690 : 1200;
    const ch = portrait ? L.h - 60 : 680;
    this.card = { x: (L.w - cw) / 2, y: (L.h - ch) / 2, w: cw, h: ch };
    const frame = panel(scene, this.card, D + 0.1, { edge: CYAN, fill: PANEL_FILL, fillA: 0.97, cut: 22, blur: 14, lw: 2.5 });
    const title = text(scene, L.w / 2, this.card.y + (portrait ? 40 : 30), 'STATS', portrait ? 40 : 30, { font: 'title', weight: '900', glow: '#22e5ff', blur: 14 })
      .setOrigin(0.5)
      .setDepth(D + 0.3);
    const bw = portrait ? 240 : 180;
    const bh = portrait ? 78 : 52;
    this.close = new Button(scene, { x: L.w / 2 - bw / 2, y: this.card.y + ch - bh - 18, w: bw, h: bh }, 'CLOSE', portrait ? 30 : 22, D + 0.5, onClose, { font: 'title', fill: 0x062a3a });
    const top = this.card.y + (portrait ? 160 : 110);
    this.area = { x: this.card.x + 24, y: top, w: cw - 48, h: this.card.y + ch - bh - 34 - top };
    this.content = scene.add.container(0, 0).setDepth(D + 0.3);
    this.maskShape = scene.make.graphics({}, false);
    this.maskShape.fillStyle(0xffffff).fillRect(this.area.x, this.area.y, this.area.w, this.area.h);
    this.content.setMask(this.maskShape.createGeometryMask());
    this.scrollZone = scene.add.zone(this.area.x + this.area.w / 2, this.area.y + this.area.h / 2, this.area.w, this.area.h).setDepth(D + 0.2).setInteractive();
    // Pointer world coordinates are in logical px (the camera is zoomed by RS).
    this.scrollZone.on('pointerdown', (p: Phaser.Input.Pointer) => (this.drag = { y: p.worldY, scroll: this.scroll }));
    this.scrollZone.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (this.drag && p.isDown) this.setScroll(this.drag.scroll - (p.worldY - this.drag.y));
    });
    scene.input.on('pointerup', () => (this.drag = null));
    this.scrollZone.on('wheel', (_p: unknown, _dx: number, dy: number) => this.setScroll(this.scroll + dy));
    this.fixed.push(dim, frame, title);
    this.hide();
  }

  closeRect(): Rect {
    return this.close.r;
  }

  show(tabs: StatTab[]): void {
    this.tabs = tabs;
    this.active = Math.min(this.active, tabs.length - 1);
    this.visible = true;
    for (const o of this.fixed) (o as unknown as Phaser.GameObjects.Components.Visible).setVisible(true);
    this.close.setVisible(true);
    this.blocker.setInteractive();
    this.scrollZone.setInteractive();
    this.content.setVisible(true);
    this.buildTabs();
    this.render();
  }

  /** Re-renders with fresh numbers (live run stats) keeping the tab and scroll. */
  update(tabs: StatTab[]): void {
    if (!this.visible) return;
    this.tabs = tabs;
    this.render();
  }

  private buildTabs(): void {
    for (const b of this.tabButtons) b.destroy();
    this.tabButtons = [];
    if (this.tabs.length < 2) return;
    const portrait = this.L.o === 'portrait';
    const y = this.card.y + (portrait ? 78 : 56);
    const h = portrait ? 66 : 42;
    const w = (this.card.w - 48 - (this.tabs.length - 1) * 10) / this.tabs.length;
    this.tabs.forEach((t, i) => {
      const b = new Button(this.scene, { x: this.card.x + 24 + i * (w + 10), y, w, h }, t.label, this.L.minFont, D + 0.4, () => {
        this.active = i;
        this.scroll = 0;
        this.styleTabs();
        this.render();
      }, { font: 'title', cut: 10, blur: 8 });
      this.tabButtons.push(b);
    });
    this.styleTabs();
  }

  private styleTabs(): void {
    this.tabButtons.forEach((b, i) => {
      b.label.setColor(i === this.active ? '#22e5ff' : TEXT_DIM);
      b.bg.setAlpha(i === this.active ? 1 : 0.45);
    });
  }

  private render(): void {
    this.content.removeAll(true);
    const tab = this.tabs[this.active];
    if (!tab) return;
    const portrait = this.L.o === 'portrait';
    const f = this.L.minFont;
    const rowH = portrait ? f + 14 : f + 9;
    const cols = portrait ? 1 : 2;
    const gap = 28;
    const colW = (this.area.w - (cols - 1) * gap) / cols;
    const colY = Array.from({ length: cols }, () => 0);
    for (const sec of tab.sections) {
      const c = colY.indexOf(Math.min(...colY));
      const x = this.area.x + c * (colW + gap);
      let y = colY[c]!;
      const g = this.scene.add.graphics();
      g.lineStyle(2, CYAN, 0.5).lineBetween(x, y + f + 8, x + colW, y + f + 8);
      this.content.add(g);
      this.content.add(text(this.scene, x, y, sec.title, f, { font: 'title', weight: '800', color: '#22e5ff' }));
      y += f + 18;
      sec.rows.forEach(([label, value, accent], i) => {
        if (i % 2 === 1) {
          const bg = this.scene.add.graphics();
          bg.fillStyle(0x22e5ff, 0.05).fillRect(x - 6, y - 4, colW + 12, rowH);
          this.content.add(bg);
        }
        this.content.add(text(this.scene, x, y, label, f, { color: TEXT_DIM }));
        this.content.add(text(this.scene, x + colW, y, value, f, { color: accent ?? TEXT }).setOrigin(1, 0));
        y += rowH;
      });
      colY[c] = y + (portrait ? 22 : 16);
    }
    this.contentH = Math.max(...colY);
    this.setScroll(this.scroll);
  }

  private setScroll(v: number): void {
    const max = Math.max(0, this.contentH - this.area.h);
    this.scroll = Math.max(0, Math.min(max, v));
    this.content.setY(this.area.y - this.scroll);
  }

  hide(): void {
    this.visible = false;
    for (const o of this.fixed) (o as unknown as Phaser.GameObjects.Components.Visible).setVisible(false);
    this.close.setVisible(false);
    for (const b of this.tabButtons) b.destroy();
    this.tabButtons = [];
    this.content.removeAll(true);
    this.content.setVisible(false);
    this.blocker.disableInteractive();
    this.scrollZone.disableInteractive();
  }
}

// "My protocols": every held perk with its stacks and total effect, the five sets and the fusions with their
// progress. Opens from the set chips; the battle pauses while it is open. The content scrolls (drag / wheel)
// between the title and RESUME when a big crystal does not fit.

import Phaser from 'phaser';
import { CYAN, PANEL_FILL, RARITY_CSS, TAG_COLOR, TAG_CSS, TEXT, TEXT_DIM } from '../render/palette';
import { DEPTH } from '../render/WorldView';
import type { GameData } from '../sim/data';
import { fusionLinkCounts } from '../sim/crystal';
import { tagCounts } from '../sim/perks';
import { fusionKeys, TAGS } from '../sim/perkData';
import type { World } from '../sim/state';
import { Button, panel, text } from './kit';
import type { Layout, Rect } from './layout';
import { fusionLadder, fusionLevel, fusionTags, setLadder, totalLines, type SetLadderRow } from './perkText';
import { SetTooltip } from './SetTooltip';
import { drawPairDisc, drawTagIcon } from './tagIcon';

const D = DEPTH.overlay - 1;

export class ProtocolsPanel {
  visible = false;
  private readonly fixed: Phaser.GameObjects.GameObject[] = [];
  private readonly dynamic: Phaser.GameObjects.GameObject[] = [];
  private readonly g: Phaser.GameObjects.Graphics;
  private readonly blocker: Phaser.GameObjects.Zone;
  private readonly close: Button;
  private readonly card: Rect;
  private readonly tip: SetTooltip;
  /** Scrolling content (masked to `view`) and its scrollbar. */
  private readonly content: Phaser.GameObjects.Container;
  private readonly bar: Phaser.GameObjects.Graphics;
  private readonly view: Rect;
  private maxScroll = 0;
  private drag: { y: number; from: number; moved: boolean } | null = null;
  /** The tap zone the current press started on (a tap needs both ends on the same zone). */
  private pressed: Phaser.GameObjects.Zone | null = null;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly L: Layout,
    private readonly data: GameData,
    onClose: () => void,
  ) {
    const portrait = L.o === 'portrait';
    const dim = scene.add.graphics().setDepth(D);
    dim.fillStyle(0x02040c, 0.85).fillRect(0, 0, L.w, L.h);
    this.blocker = scene.add.zone(L.w / 2, L.h / 2, L.w, L.h).setDepth(D).setInteractive();
    const cw = portrait ? 680 : 1180;
    const ch = portrait ? Math.min(L.h - 80, 1240) : 660;
    this.card = { x: (L.w - cw) / 2, y: (L.h - ch) / 2, w: cw, h: ch };
    const frame = panel(scene, this.card, D + 0.1, { edge: CYAN, fill: PANEL_FILL, fillA: 0.96, cut: 22, blur: 14, lw: 2.5 });
    const title = text(scene, L.w / 2, this.card.y + (portrait ? 46 : 34), 'MY PROTOCOLS', portrait ? 40 : 30, { font: 'title', weight: '900', glow: '#22e5ff', blur: 14 })
      .setOrigin(0.5)
      .setDepth(D + 0.3);
    this.g = scene.add.graphics();
    this.content = scene.add.container(0, 0, [this.g]).setDepth(D + 0.2);
    const bw = portrait ? 260 : 200;
    const bh = portrait ? 80 : 54;
    this.close = new Button(scene, { x: L.w / 2 - bw / 2, y: this.card.y + this.card.h - bh - 20, w: bw, h: bh }, 'RESUME', portrait ? 32 : 22, D + 0.4, onClose, {
      font: 'title',
      fill: 0x062a3a,
      lw: 2.5,
      blur: 12,
    });
    const top = this.card.y + (portrait ? 88 : 64);
    this.view = { x: this.card.x, y: top, w: this.card.w, h: this.close.r.y - 12 - top };
    const maskG = scene.make.graphics({}, false);
    maskG.fillStyle(0xffffff).fillRect(this.view.x, this.view.y, this.view.w, this.view.h);
    this.content.setMask(maskG.createGeometryMask());
    this.bar = scene.add.graphics().setDepth(D + 0.3);
    this.fixed.push(dim, frame, title, this.content, this.bar);
    this.tip = new SetTooltip(scene, L, data, D + 0.6);
    this.blocker.on('pointerdown', () => this.tip.hide());
    // Scene-level, so a drag that starts on a set block (its tap zone) still scrolls.
    scene.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (this.visible && this.maxScroll > 0 && this.inView(p.worldX, p.worldY)) this.drag = { y: p.worldY, from: this.content.y, moved: false };
    });
    scene.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (!this.drag || !p.isDown) return;
      const dy = p.worldY - this.drag.y;
      if (Math.abs(dy) > 10) this.drag.moved = true;
      if (this.drag.moved) this.scrollTo(this.drag.from + dy);
    });
    scene.input.on('pointerup', () => {
      // Cleared after the zones' own pointerup handlers have seen `moved`.
      if (this.drag || this.pressed)
        scene.time.delayedCall(0, () => {
          this.drag = null;
          this.pressed = null;
        });
    });
    scene.input.on('wheel', (_p: unknown, _o: unknown, _dx: number, dy: number) => {
      if (this.visible) this.scrollTo(this.content.y - dy);
    });
    this.hide();
  }

  closeRect(): Rect {
    return this.close.r;
  }

  /** Content scroll (logical px, ≤ 0) and its range, for the UI smoke. */
  get scroll(): { y: number; max: number } {
    return { y: this.content.y, max: this.maxScroll };
  }

  private inView(x: number, y: number): boolean {
    const v = this.view;
    return x >= v.x && x <= v.x + v.w && y >= v.y && y <= v.y + v.h;
  }

  scrollTo(y: number): void {
    this.content.y = Math.max(-this.maxScroll, Math.min(0, y));
    this.tip.hide();
    this.drawBar();
  }

  private drawBar(): void {
    const b = this.bar.clear();
    if (this.maxScroll <= 0) return;
    const v = this.view;
    const total = v.h + this.maxScroll;
    const h = Math.max(40, (v.h * v.h) / total);
    const y = v.y + ((v.h - h) * -this.content.y) / this.maxScroll;
    b.fillStyle(CYAN, 0.15).fillRoundedRect(v.x + v.w - 12, v.y, 5, v.h, 2.5);
    b.fillStyle(CYAN, 0.8).fillRoundedRect(v.x + v.w - 12, y, 5, h, 2.5);
  }

  show(w: World): void {
    this.visible = true;
    for (const o of this.fixed) (o as unknown as Phaser.GameObjects.Components.Visible).setVisible(true);
    this.close.setVisible(true);
    this.blocker.setInteractive();
    for (const o of this.dynamic) o.destroy();
    this.dynamic.length = 0;
    const g = this.g.clear();
    const L = this.L;
    const portrait = L.o === 'portrait';
    const f = L.minFont;
    const c = this.card;
    const pad = portrait ? 28 : 30;
    // Sets: five columns with the whole 2/4/6 ladder (landscape) or five rows with the reached tiers + the
    // next one, the full ladder on tap (portrait). Measured first, framed after.
    const counts = tagCounts(w, this.data);
    const setsTop = c.y + (portrait ? 96 : 72);
    const colW = (c.w - pad * 2 + 12) / 5 - 12;
    const is = portrait ? 40 : 30;
    const blocks = TAGS.map((t, i) => {
      const tier = w.setTiers[t];
      const ladder = setLadder(this.data, t, tier);
      const next = ladder.find((r) => !r.on);
      const rows = portrait ? ladder.filter((r) => r.on || r === next) : ladder;
      const x = portrait ? c.x + pad : c.x + pad + i * (colW + 12);
      const bw = portrait ? c.w - pad * 2 : colW;
      const name = `${this.data.sets.tags[t].name.toUpperCase()} ${counts[t]}${next ? `/${next.tier}` : ''}`;
      return { t, tier, rows, x, bw, name };
    });
    let y = setsTop;
    let landscapeH = 0;
    const placed = blocks.map((b) => {
      const tx = portrait ? b.x + is + 30 : b.x + 12;
      const top = portrait ? y : setsTop;
      let h = portrait ? 8 : 14;
      const head = this.add(text(this.scene, portrait ? tx : b.x + is + 24, top + h, b.name, portrait ? f : f + 2, { color: TAG_CSS[b.t] }).setDepth(D + 0.3));
      h += head.height + (portrait ? 4 : 12);
      for (const r of b.rows) h += this.ladderRow(g, TAG_COLOR[b.t], TAG_CSS[b.t], String(r.tier), r, tx, top + h, b.x + b.bw - 12 - tx) + 4;
      h += portrait ? 6 : 8;
      if (portrait) y += h + 8;
      else landscapeH = Math.max(landscapeH, h);
      return { ...b, top, h };
    });
    for (const b of placed) {
      const r: Rect = { x: b.x, y: b.top, w: b.bw, h: portrait ? b.h : landscapeH };
      g.fillStyle(TAG_COLOR[b.t], b.tier > 0 ? 0.16 : 0.05).fillRoundedRect(r.x, r.y, r.w, r.h, 10);
      g.lineStyle(b.tier > 0 ? 2.5 : 1.5, TAG_COLOR[b.t], b.tier > 0 ? 0.95 : 0.4).strokeRoundedRect(r.x, r.y, r.w, r.h, 10);
      drawTagIcon(g, b.t, r.x + 14 + is / 2, r.y + (portrait ? 8 + f * 0.7 : 26), is, TAG_COLOR[b.t], b.tier > 0 ? 1 : 0.6);
      if (portrait) {
        this.tapZone(r, () => {
          if (this.tip.shownTag === b.t) this.tip.hide();
          else this.tip.show(b.t, counts[b.t], b.tier, this.onScreen(r));
        });
      }
    }
    const setsBottom = portrait ? y : setsTop + landscapeH + 8;
    // Fusions: every pair with links as a ladder like the sets (reached tiers + the next one), or how to get one.
    let fy = setsBottom + 10;
    const links = fusionLinkCounts(w, this.data);
    const pairs = fusionKeys().filter((k) => (links[k] ?? 0) > 0 || (w.fusionTiers[k] ?? 0) > 0);
    if (pairs.length === 0) {
      const hint = `FUSIONS: modules of two tags that touch make links; ${this.data.sets.fusionTiers.join(' / ')} links → tier ${this.data.sets.fusionTiers.map((t) => fusionLevel(this.data, t)).join(' / ')}`;
      fy += this.add(text(this.scene, c.x + pad, fy, hint, f, { color: TEXT_DIM, weight: '600' }).setDepth(D + 0.3).setWordWrapWidth(c.w - pad * 2)).height;
    } else {
      if (portrait) fy = this.fusionRows(g, w, pairs, links, fy);
      else fy = this.fusionLadders(g, w, pairs, links, fy);
    }

    // Perks: a grid of "Name ×n" + total effect.
    const held = Object.entries(w.perks).filter(([, n]) => n > 0);
    const gridTop = fy + 12;
    const cols = portrait ? 2 : 3;
    const cellW = (c.w - pad * 2 - (cols - 1) * 14) / cols;
    const rowH = portrait ? 84 : 62;
    if (held.length === 0) {
      this.add(text(this.scene, L.w / 2, gridTop + 40, 'No protocols installed yet', f, { color: TEXT_DIM }).setOrigin(0.5, 0).setDepth(D + 0.3));
    }
    held.forEach(([id, n], i) => {
      const def = this.data.perks.perks[id]!;
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = c.x + pad + col * (cellW + 14);
      const y = gridTop + row * (rowH + 8);
      g.fillStyle(TAG_COLOR[def.tag], 0.06).fillRoundedRect(x, y, cellW, rowH, 8);
      g.fillStyle(TAG_COLOR[def.tag], 0.9).fillRect(x, y + 6, 4, rowH - 12);
      this.add(text(this.scene, x + 14, y + 6, `${def.name} ×${n}`, f, { color: RARITY_CSS[def.rarity] === RARITY_CSS.common ? TEXT : RARITY_CSS[def.rarity] }).setDepth(D + 0.3));
      this.add(text(this.scene, x + 14, y + 8 + f, totalLines(this.data, id, n).join(' · '), f, { color: TAG_CSS[def.tag] }).setDepth(D + 0.3).setWordWrapWidth(cellW - 20));
    });
    const bottom = held.length === 0 ? gridTop + 40 + f * 1.4 : gridTop + Math.ceil(held.length / cols) * (rowH + 8);
    this.maxScroll = Math.max(0, bottom + 12 - (this.view.y + this.view.h));
    this.content.y = 0;
    this.drawBar();
  }

  /**
   * Fusions as ladders like the sets (reached tiers + the next one), up to three per row (landscape).
   * Returns the bottom.
   */
  private fusionLadders(g: Phaser.GameObjects.Graphics, w: World, pairs: string[], links: Record<string, number>, fy: number): number {
    const c = this.card;
    const f = this.L.minFont;
    const pad = 30;
    const is = 30;
    const cols = Math.min(3, pairs.length);
    const fw = (c.w - pad * 2 - (cols - 1) * 12) / cols;
    let rowTop = fy;
    let rowH = 0;
    pairs.forEach((k, i) => {
      const col = i % cols;
      if (col === 0 && i > 0) {
        rowTop += rowH + 8;
        rowH = 0;
      }
      const x = c.x + pad + col * (fw + 12);
      const tier = w.fusionTiers[k] ?? 0;
      const ladder = fusionLadder(this.data, k, tier);
      const next = ladder.find((r) => !r.on);
      const [ta, tb] = fusionTags(k);
      const tx = x + is + 30;
      let h = 8;
      const head = this.add(
        text(this.scene, tx, rowTop + h, `${this.data.sets.fusions[k]!.name.toUpperCase()} · links ${links[k] ?? 0}${next ? `/${next.tier}` : ''}`, f, { color: TEXT }).setDepth(D + 0.3),
      );
      h += head.height + 4;
      for (const r of ladder.filter((r) => r.on || r === next)) {
        h += this.ladderRow(g, TAG_COLOR[ta], TAG_CSS[ta], fusionLevel(this.data, r.tier), r, tx, rowTop + h, x + fw - 12 - tx) + 4;
      }
      h += 6;
      g.fillStyle(TAG_COLOR[ta], tier > 0 ? 0.08 : 0.03).fillRoundedRect(x, rowTop, fw / 2, h, { tl: 10, bl: 10, tr: 0, br: 0 });
      g.fillStyle(TAG_COLOR[tb], tier > 0 ? 0.08 : 0.03).fillRoundedRect(x + fw / 2, rowTop, fw / 2, h, { tl: 0, bl: 0, tr: 10, br: 10 });
      g.lineStyle(tier > 0 ? 2.5 : 1.5, TAG_COLOR[tb], tier > 0 ? 0.95 : 0.4).strokeRoundedRect(x, rowTop, fw, h, 10);
      drawPairDisc(g, TAG_COLOR[ta], TAG_COLOR[tb], x + 14 + is / 2, rowTop + 8 + f * 0.7, is / 2, tier > 0 ? 1 : 0.6);
      rowH = Math.max(rowH, h);
    });
    return rowTop + rowH;
  }

  /** Fusions one line each (portrait): pair disc, name, level and links; the full ladder on tap. Returns the bottom. */
  private fusionRows(g: Phaser.GameObjects.Graphics, w: World, pairs: string[], links: Record<string, number>, fy: number): number {
    const c = this.card;
    const f = this.L.minFont;
    const pad = 28;
    const is = 40;
    let y = fy;
    for (const k of pairs) {
      const tier = w.fusionTiers[k] ?? 0;
      const next = this.data.sets.fusionTiers.find((t) => t > tier);
      const [ta, tb] = fusionTags(k);
      const x = c.x + pad;
      const bw = c.w - pad * 2;
      const name = `${this.data.sets.fusions[k]!.name.toUpperCase()}${tier > 0 ? ` ${fusionLevel(this.data, tier)}` : ''}`;
      const t = this.add(text(this.scene, x + is + 30, y + 8, `${name} · links ${links[k] ?? 0}${next ? `/${next}` : ''}`, f, { color: tier > 0 ? TEXT : TEXT_DIM }).setDepth(D + 0.3).setWordWrapWidth(bw - is - 42));
      const h = t.height + 16;
      const r: Rect = { x, y, w: bw, h };
      g.fillStyle(TAG_COLOR[ta], tier > 0 ? 0.08 : 0.03).fillRoundedRect(x, y, bw / 2, h, { tl: 10, bl: 10, tr: 0, br: 0 });
      g.fillStyle(TAG_COLOR[tb], tier > 0 ? 0.08 : 0.03).fillRoundedRect(x + bw / 2, y, bw / 2, h, { tl: 0, bl: 0, tr: 10, br: 10 });
      g.lineStyle(tier > 0 ? 2.5 : 1.5, TAG_COLOR[tb], tier > 0 ? 0.95 : 0.4).strokeRoundedRect(x, y, bw, h, 10);
      drawPairDisc(g, TAG_COLOR[ta], TAG_COLOR[tb], x + 14 + is / 2, y + h / 2, is / 2, tier > 0 ? 1 : 0.6);
      this.tapZone(r, () => {
        if (this.tip.shownKey === k) this.tip.hide();
        else this.tip.showFusion(k, links[k] ?? 0, tier, this.onScreen(r));
      });
      y += h + 8;
    }
    return y;
  }

  private add(o: Phaser.GameObjects.Text): Phaser.GameObjects.Text {
    this.content.add(o);
    this.dynamic.push(o);
    return o;
  }

  /**
   * A tap target over a content rect; a drag that scrolls the content is not a tap, and neither is a release
   * whose press began elsewhere (the chip tap that opened this panel lifts over a block).
   */
  private tapZone(r: Rect, onTap: () => void): void {
    const z = this.scene.add.zone(r.x, r.y, r.w, r.h).setOrigin(0).setInteractive({ useHandCursor: true });
    z.on('pointerdown', () => (this.pressed = z));
    z.on('pointerup', (p: Phaser.Input.Pointer) => {
      if (this.pressed === z && !this.drag?.moved && this.inView(p.worldX, p.worldY)) onTap();
    });
    this.content.add(z);
    this.dynamic.push(z);
  }

  /** A content rect in screen (logical) coordinates at the current scroll. */
  private onScreen(r: Rect): Rect {
    return { ...r, y: r.y + this.content.y };
  }

  /** One ladder step: a disc with `label` (filled when reached) and its bonus. Returns the row height. */
  private ladderRow(g: Phaser.GameObjects.Graphics, color: number, css: string, label: string, r: SetLadderRow, x: number, y: number, w: number): number {
    const f = this.L.minFont;
    const rad = f * 0.7;
    const line = this.add(
      text(this.scene, x + rad * 2 + 10, y, r.text, f, { color: r.on ? TEXT : TEXT_DIM, weight: r.on ? '700' : '600' })
        .setDepth(D + 0.3)
        .setWordWrapWidth(w - rad * 2 - 10),
    );
    const cy = y + Math.min(line.height, f * 1.3) / 2;
    if (r.on) g.fillStyle(color, 1).fillCircle(x + rad, cy, rad);
    else g.lineStyle(2, color, 0.5).strokeCircle(x + rad, cy, rad);
    this.add(text(this.scene, x + rad, cy, label, f, { color: r.on ? '#03050d' : css }).setOrigin(0.5).setDepth(D + 0.3));
    return Math.max(line.height, rad * 2);
  }

  hide(): void {
    this.visible = false;
    this.tip.hide();
    for (const o of this.fixed) (o as unknown as Phaser.GameObjects.Components.Visible).setVisible(false);
    for (const o of this.dynamic) o.destroy();
    this.dynamic.length = 0;
    this.close.setVisible(false);
    this.blocker.disableInteractive();
  }
}

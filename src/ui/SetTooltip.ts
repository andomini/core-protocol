// Hover card for one set: its 2/4/6 ladder with the reached tiers lit. Shown over the set chips in battle,
// over the set blocks in "My protocols" (tap there on touch) and over crystal modules, where a module section
// (the protocol, its total effect, whether its cluster counts for the set) goes on top. The same card shows a
// fusion's I / II / III ladder over its pair chip (`showFusion`).

import Phaser from 'phaser';
import { PANEL_FILL, TAG_COLOR, TAG_CSS, TEXT, TEXT_DIM } from '../render/palette';
import type { GameData } from '../sim/data';
import type { Tag } from '../sim/perkData';
import { text } from './kit';
import type { Layout, Rect } from './layout';
import { fusionLadder, fusionLevel, fusionTags, setLadder } from './perkText';
import { drawPairDisc, drawTagIcon } from './tagIcon';

export interface ModuleInfo {
  title: string;
  titleColor: string;
  lines: string[];
  note: string;
  noteColor: string;
}

interface Row {
  label: string;
  on: boolean;
  text: string;
}

interface Card {
  head: string;
  /** Frame + disc colour; `css` for the head and the hollow-disc labels. */
  color: number;
  css: string;
  icon: (g: Phaser.GameObjects.Graphics, cx: number, cy: number, size: number) => void;
  rows: Row[];
  foot: string;
}

export class SetTooltip {
  private readonly g: Phaser.GameObjects.Graphics;
  private readonly head: Phaser.GameObjects.Text;
  private readonly nums: Phaser.GameObjects.Text[] = [];
  private readonly lines: Phaser.GameObjects.Text[] = [];
  private readonly foot: Phaser.GameObjects.Text;
  private readonly modTitle: Phaser.GameObjects.Text;
  private readonly modLines: Phaser.GameObjects.Text;
  private readonly modNote: Phaser.GameObjects.Text;
  private readonly w: number;
  private readonly f: number;
  private readonly setFoot: string;
  private readonly fusionFoot: string;
  shownTag: Tag | null = null;
  shownKey: string | null = null;

  constructor(
    scene: Phaser.Scene,
    private readonly L: Layout,
    private readonly data: GameData,
    depth: number,
  ) {
    this.f = L.minFont;
    this.w = L.o === 'portrait' ? 600 : 380;
    this.g = scene.add.graphics().setDepth(depth);
    this.head = text(scene, 0, 0, '', this.f + 2).setDepth(depth + 0.1);
    for (let i = 0; i < Math.max(data.sets.tiers.length, data.sets.fusionTiers.length); i++) {
      this.nums.push(text(scene, 0, 0, '', this.f).setOrigin(0.5, 0.5).setDepth(depth + 0.1));
      this.lines.push(text(scene, 0, 0, '', this.f).setDepth(depth + 0.1));
    }
    this.setFoot = `Each bonus turns on at ${data.sets.tiers.join(' / ')} stacks in one connected cluster; splitting the cluster turns it off. Bonuses add up.`;
    const ft = data.sets.fusionTiers;
    this.fusionFoot = `Each edge where the two tags' modules touch is a link: ${ft.join(' / ')} links → ${ft.map((t) => fusionLevel(data, t)).join(' / ')}. Bonuses add up; breaking links turns them off.`;
    this.foot = text(scene, 0, 0, '', this.f, { color: TEXT_DIM, weight: '600' }).setWordWrapWidth(this.w - 32).setDepth(depth + 0.1);
    this.modTitle = text(scene, 0, 0, '', this.f + 2).setDepth(depth + 0.1);
    this.modLines = text(scene, 0, 0, '', this.f).setWordWrapWidth(this.w - 32).setDepth(depth + 0.1);
    this.modNote = text(scene, 0, 0, '', this.f, { weight: '600' }).setWordWrapWidth(this.w - 32).setDepth(depth + 0.1);
    this.hide();
  }

  /** Shows the set card next to `anchor`: below it when there is room, otherwise above. */
  show(tag: Tag, count: number, reached: number, anchor: Rect, mod?: ModuleInfo): void {
    const ladder = setLadder(this.data, tag, reached);
    const next = ladder.find((r) => !r.on);
    const c = TAG_COLOR[tag];
    this.render(
      {
        head: `${this.data.sets.tags[tag].name.toUpperCase()}  ${count}${next ? ` / ${next.tier}` : ''}`,
        color: c,
        css: TAG_CSS[tag],
        icon: (g, x, y, s) => drawTagIcon(g, tag, x, y, s, c),
        rows: ladder.map((r) => ({ label: String(r.tier), on: r.on, text: r.text })),
        foot: this.setFoot,
      },
      anchor,
      mod,
    );
    this.shownTag = tag;
  }

  /** Shows a fusion's card: `links n / next` and its I / II / III ladder (each row: the links it needs); `mod` adds a header (a structure's live line). */
  showFusion(key: string, links: number, reached: number, anchor: Rect, mod?: ModuleInfo): void {
    const [ta, tb] = fusionTags(key);
    const ladder = fusionLadder(this.data, key, reached);
    const next = ladder.find((r) => !r.on);
    this.render(
      {
        head: `${this.data.sets.fusions[key]!.name.toUpperCase()}  links ${links}${next ? ` / ${next.tier}` : ''}`,
        color: TAG_COLOR[ta],
        css: TEXT,
        icon: (g, x, y, s) => drawPairDisc(g, TAG_COLOR[ta], TAG_COLOR[tb], x, y, s / 2),
        rows: ladder.map((r) => ({ label: fusionLevel(this.data, r.tier), on: r.on, text: `${r.tier} link${r.tier === 1 ? '' : 's'}: ${r.text}` })),
        foot: this.fusionFoot,
      },
      anchor,
      mod,
    );
    this.shownKey = key;
  }

  private render(card: Card, anchor: Rect, mod?: ModuleInfo): void {
    this.shownTag = null;
    this.shownKey = null;
    const pad = 16;
    const icon = this.f * 1.4;
    const numW = this.f * 2;
    const rows = card.rows;
    this.head.setText(card.head).setColor(card.css);
    this.foot.setText(card.foot);
    for (const t of [...this.nums, ...this.lines]) t.setVisible(false);
    // Measure first, then place.
    let h = pad;
    let modY = 0;
    let sepY = 0;
    if (mod) {
      this.modTitle.setText(mod.title).setColor(mod.titleColor);
      this.modLines.setText(mod.lines.join('\n')).setColor(card.css);
      this.modNote.setText(mod.note).setColor(mod.noteColor);
      modY = h;
      h += this.modTitle.height + 4 + this.modLines.height + 6 + this.modNote.height + 12;
      sepY = h - 6;
    }
    const headY = h;
    h += Math.max(icon, this.head.height) + 10;
    const rowY: number[] = [];
    rows.forEach((r, i) => {
      const t = this.lines[i]!.setText(r.text).setWordWrapWidth(this.w - pad * 2 - numW - 10).setColor(r.on ? TEXT : TEXT_DIM);
      rowY.push(h);
      h += Math.max(t.height, this.f + 8) + 8;
    });
    h += 2;
    const footY = h;
    h += this.foot.height + pad;

    const x = Math.max(8, Math.min(anchor.x, this.L.w - this.w - 8));
    const below = anchor.y + anchor.h + 8 + h <= this.L.h - 8;
    const y = below ? anchor.y + anchor.h + 8 : Math.max(8, anchor.y - 8 - h);
    const c = card.color;
    const g = this.g.clear().setVisible(true);
    g.fillStyle(PANEL_FILL, 0.97).fillRoundedRect(x, y, this.w, h, 10);
    g.fillStyle(c, 0.08).fillRoundedRect(x, y, this.w, h, 10);
    g.lineStyle(2, c, 0.9).strokeRoundedRect(x, y, this.w, h, 10);
    if (mod) {
      this.modTitle.setPosition(x + pad, y + modY).setVisible(true);
      this.modLines.setPosition(x + pad, y + modY + this.modTitle.height + 4).setVisible(true);
      this.modNote.setPosition(x + pad, this.modLines.y + this.modLines.height + 6).setVisible(true);
      g.lineStyle(1.5, c, 0.4).lineBetween(x + pad, y + sepY, x + this.w - pad, y + sepY);
    }
    card.icon(g, x + pad + icon / 2, y + headY + icon / 2, icon);
    this.head.setPosition(x + pad + icon + 12, y + headY + (icon - this.head.height) / 2).setVisible(true);
    rows.forEach((r, i) => {
      const ry = y + rowY[i]!;
      const line = this.lines[i]!;
      const cy = ry + Math.min(line.height, this.f + 8) / 2;
      const nx = x + pad + numW / 2;
      // Reached: a filled disc with a dark number; ahead: a hollow ring.
      if (r.on) g.fillStyle(c, 1).fillCircle(nx, cy, this.f * 0.7);
      else g.lineStyle(2, c, 0.5).strokeCircle(nx, cy, this.f * 0.7);
      this.nums[i]!.setText(r.label).setColor(r.on ? '#03050d' : card.css).setPosition(nx, cy).setVisible(true);
      line.setPosition(x + pad + numW + 10, ry).setVisible(true);
    });
    this.foot.setPosition(x + pad, y + footY).setVisible(true);
  }

  hide(): void {
    this.shownTag = null;
    this.shownKey = null;
    this.g.clear().setVisible(false);
    this.head.setVisible(false);
    this.foot.setVisible(false);
    this.modTitle.setVisible(false);
    this.modLines.setVisible(false);
    this.modNote.setVisible(false);
    for (const t of this.nums) t.setVisible(false);
    for (const t of this.lines) t.setVisible(false);
  }
}

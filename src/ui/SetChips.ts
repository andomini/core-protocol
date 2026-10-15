// Active-set chips: one per held tag (glyph + count, lit at 2/4/6), then one per fusion pair with links
// (a half-and-half disc + I / II / III, `·` below tier I), and a "≡" affordance; the whole bar opens the
// "My protocols" panel. Portrait: the arena's top-left corner, pairs on a second row. Landscape: the HUD's
// Energy row, pairs in the arena's top-right corner. Pairs that do not fit fold into a "+N" chip. Hovering a
// chip shows that set's or fusion's ladder (SetTooltip).

import Phaser from 'phaser';
import { CYAN, PANEL_FILL, TAG_COLOR, TAG_CSS, TEXT, TEXT_DIM } from '../render/palette';
import { DEPTH } from '../render/WorldView';
import type { GameData } from '../sim/data';
import { fusionKeys, TAGS, type Tag } from '../sim/perkData';
import { text } from './kit';
import type { Layout, Rect } from './layout';
import { GenomeStrip } from './GenomeStrip';
import { SetTooltip } from './SetTooltip';
import { fusionLevel, fusionTags } from './perkText';
import { drawPairDisc, drawTagIcon } from './tagIcon';

export class SetChips {
  private readonly g: Phaser.GameObjects.Graphics;
  private readonly labels = new Map<Tag, Phaser.GameObjects.Text>();
  private readonly hint: Phaser.GameObjects.Text;
  private readonly zone: Phaser.GameObjects.Zone;
  private readonly chipZones = new Map<Tag, Phaser.GameObjects.Zone>();
  private readonly chipRects = new Map<Tag, Rect>();
  private readonly tip: SetTooltip;
  private readonly pairLabels = new Map<string, Phaser.GameObjects.Text>();
  private readonly pairZones = new Map<string, Phaser.GameObjects.Zone>();
  private readonly pairRects = new Map<string, Rect>();
  private readonly more: Phaser.GameObjects.Text;
  private counts: Record<Tag, number> | null = null;
  private tiers: Record<Tag, number> | null = null;
  private links: Record<string, number> = {};
  private fusion: Record<string, number> = {};
  private readonly x: number;
  private readonly y: number;
  private readonly h: number;
  private readonly font: number;
  private last = '';
  /** Tap area (logical px), for the UI smoke. */
  rect: Rect = { x: 0, y: 0, w: 0, h: 0 };
  /** Fusion chips shown (pair key → its rect), for the UI smoke. */
  get pairs(): Record<string, Rect> {
    return Object.fromEntries(this.pairRects);
  }

  constructor(
    scene: Phaser.Scene,
    private readonly L: Layout,
    private readonly data: GameData,
    onOpen: () => void,
  ) {
    const portrait = L.o === 'portrait';
    this.font = L.minFont;
    this.h = portrait ? 52 : 34;
    this.x = portrait ? L.arena.x + 18 : L.hud.x + 150;
    this.y = portrait ? L.arena.y + 14 : 153;
    const D = portrait ? DEPTH.bars + 0.4 : DEPTH.hud + 0.3;
    this.g = scene.add.graphics().setDepth(D);
    for (const t of TAGS) this.labels.set(t, text(scene, 0, 0, '', this.font, { color: TAG_CSS[t] }).setOrigin(0, 0.5).setDepth(D + 0.1).setVisible(false));
    for (const k of fusionKeys()) this.pairLabels.set(k, text(scene, 0, 0, '', this.font, { color: TEXT }).setOrigin(0, 0.5).setDepth(D + 0.1).setVisible(false));
    this.more = text(scene, 0, 0, '', this.font, { color: TEXT }).setOrigin(0, 0.5).setDepth(D + 0.1).setVisible(false);
    this.hint = text(scene, 0, 0, 'NO PROTOCOLS', this.font, { color: TEXT_DIM }).setOrigin(0, 0.5).setDepth(D + 0.1).setVisible(false);
    this.zone = scene.add.zone(0, 0, 10, 10).setOrigin(0).setDepth(D + 0.2);
    this.zone.on('pointerdown', onOpen);
    this.tip = new SetTooltip(scene, L, data, DEPTH.overlay - 2);
    for (const t of TAGS) {
      const z = scene.add.zone(0, 0, 10, 10).setOrigin(0).setDepth(D + 0.3);
      z.on('pointerover', () => this.showTip(t));
      z.on('pointerout', () => this.tip.hide());
      z.on('pointerdown', () => {
        this.tip.hide();
        onOpen();
      });
      this.chipZones.set(t, z);
    }
    for (const k of fusionKeys()) {
      const z = scene.add.zone(0, 0, 10, 10).setOrigin(0).setDepth(D + 0.3);
      z.on('pointerover', () => this.showPairTip(k));
      z.on('pointerout', () => this.tip.hide());
      z.on('pointerdown', () => {
        this.tip.hide();
        onOpen();
      });
      this.pairZones.set(k, z);
    }
  }

  /** `links` / `fusion`: link counts and reached fusion tiers by pair key (only pairs with links are shown). */
  update(counts: Record<Tag, number>, tiers: Record<Tag, number>, links: Record<string, number> = {}, fusion: Record<string, number> = {}): void {
    const pairs = fusionKeys().filter((k) => (links[k] ?? 0) > 0);
    const key = TAGS.map((t) => `${counts[t]}:${tiers[t]}`).join(',') + '|' + pairs.map((k) => `${k}:${links[k]}:${fusion[k] ?? 0}`).join(',');
    if (key === this.last) return;
    this.last = key;
    this.counts = counts;
    this.tiers = tiers;
    this.links = links;
    this.fusion = fusion;
    for (const z of this.chipZones.values()) z.disableInteractive();
    for (const z of this.pairZones.values()) z.disableInteractive();
    for (const t of this.pairLabels.values()) t.setVisible(false);
    this.more.setVisible(false);
    this.chipRects.clear();
    this.pairRects.clear();
    const held = TAGS.filter((t) => counts[t] > 0).sort((a, b) => counts[b] - counts[a]);
    const g = this.g.clear();
    const icon = this.h * 0.62;
    let x = this.x;
    const cy = this.y + this.h / 2;
    for (const t of TAGS) this.labels.get(t)!.setVisible(false);
    this.hint.setVisible(false);
    if (held.length === 0) {
      this.tip.hide();
      this.zone.disableInteractive();
      this.rect = { x: 0, y: 0, w: 0, h: 0 };
      return;
    }
    for (const t of held) {
      const lit = tiers[t] > 0;
      const label = this.labels.get(t)!.setText(String(counts[t])).setVisible(true);
      const w = icon + 14 + label.width + 14;
      g.fillStyle(PANEL_FILL, 0.85).fillRoundedRect(x, this.y, w, this.h, 8);
      g.fillStyle(TAG_COLOR[t], lit ? 0.22 : 0.06).fillRoundedRect(x, this.y, w, this.h, 8);
      g.lineStyle(lit ? 2.5 : 1.5, TAG_COLOR[t], lit ? 1 : 0.45).strokeRoundedRect(x, this.y, w, this.h, 8);
      drawTagIcon(g, t, x + 8 + icon / 2, cy, icon, TAG_COLOR[t], lit ? 1 : 0.6);
      label.setPosition(x + icon + 16, cy).setAlpha(lit ? 1 : 0.7);
      const z = this.chipZones.get(t)!.setPosition(x, this.y).setSize(w, this.h);
      z.setInteractive({ useHandCursor: true });
      if (z.input) z.input.hitArea.setSize(w, this.h);
      this.chipRects.set(t, { x, y: this.y, w, h: this.h });
      x += w + 8;
    }
    // A small "≡" affordance: the whole bar opens the panel.
    g.lineStyle(2, CYAN, 0.8);
    const mx = x + 6;
    for (let i = 0; i < 3; i++) g.lineBetween(mx, cy - 8 + i * 8, mx + 18, cy - 8 + i * 8);
    const w = mx + 24 - this.x;
    this.rect = { x: this.x, y: this.y, w, h: this.h };
    this.zone.setPosition(this.x, this.y).setSize(w, this.h);
    this.zone.setInteractive({ useHandCursor: true });
    if (this.zone.input) this.zone.input.hitArea.setSize(w, this.h);
    this.layPairs(g, pairs, fusion, icon);
    // Refresh an open tooltip (the set just grew) or drop it (the chip is gone).
    const open = this.tip.shownTag;
    if (open) {
      if (this.chipRects.has(open)) this.showTip(open);
      else this.tip.hide();
    }
    const openPair = this.tip.shownKey;
    if (openPair) {
      if (this.pairRects.has(openPair)) this.showPairTip(openPair);
      else this.tip.hide();
    }
  }

  /**
   * Fusion pairs on a row of their own, strongest first: under the set chips (portrait) or in the arena's
   * top-right corner under the genome strip (landscape, the HUD row is full). What does not fit folds into "+N".
   */
  private layPairs(g: Phaser.GameObjects.Graphics, pairs: string[], fusion: Record<string, number>, icon: number): void {
    if (pairs.length === 0) return;
    const L = this.L;
    const portrait = L.o === 'portrait';
    pairs.sort((a, b) => (fusion[b] ?? 0) - (fusion[a] ?? 0) || this.links[b]! - this.links[a]!);
    const left = portrait ? this.x : L.arena.x + 64;
    const right = L.arena.x + L.arena.w - 18;
    const y = portrait ? this.y + this.h + 8 : GenomeStrip.bottom(L) + 8;
    const cy = y + this.h / 2;
    const widths = pairs.map((k) => {
      const tier = fusion[k] ?? 0;
      return icon + 12 + this.pairLabels.get(k)!.setText(tier > 0 ? fusionLevel(this.data, tier) : '·').width + 12;
    });
    let n = 0;
    let total = 0;
    const moreW = this.font * 2.4;
    for (; n < pairs.length; n++) {
      const rest = n < pairs.length - 1 ? moreW + 8 : 0;
      if (total + widths[n]! + rest > right - left) break;
      total += widths[n]! + 8;
    }
    if (n < pairs.length) total += moreW;
    let x = portrait ? left : right - total + (n < pairs.length ? 0 : 8);
    const rad = icon / 2;
    for (let i = 0; i < n; i++) {
      const k = pairs[i]!;
      const w = widths[i]!;
      const lit = (fusion[k] ?? 0) > 0;
      const [ta, tb] = fusionTags(k);
      g.fillStyle(PANEL_FILL, 0.85).fillRoundedRect(x, y, w, this.h, 8);
      g.fillStyle(TAG_COLOR[ta], lit ? 0.14 : 0.04).fillRoundedRect(x, y, w / 2, this.h, { tl: 8, bl: 8, tr: 0, br: 0 });
      g.fillStyle(TAG_COLOR[tb], lit ? 0.14 : 0.04).fillRoundedRect(x + w / 2, y, w / 2, this.h, { tl: 0, bl: 0, tr: 8, br: 8 });
      g.lineStyle(lit ? 2.5 : 1.5, TAG_COLOR[ta], lit ? 1 : 0.45).strokeRoundedRect(x, y, w, this.h, 8);
      drawPairDisc(g, TAG_COLOR[ta], TAG_COLOR[tb], x + 8 + rad, cy, rad, lit ? 1 : 0.55);
      this.pairLabels.get(k)!.setPosition(x + icon + 18, cy).setAlpha(lit ? 1 : 0.7).setVisible(true);
      const z = this.pairZones.get(k)!.setPosition(x, y).setSize(w, this.h);
      z.setInteractive({ useHandCursor: true });
      if (z.input) z.input.hitArea.setSize(w, this.h);
      this.pairRects.set(k, { x, y, w, h: this.h });
      x += w + 8;
    }
    if (n < pairs.length) {
      const more = this.more.setText(`+${pairs.length - n}`).setVisible(true);
      g.fillStyle(PANEL_FILL, 0.85).fillRoundedRect(x, y, moreW, this.h, 8);
      g.lineStyle(1.5, CYAN, 0.6).strokeRoundedRect(x, y, moreW, this.h, 8);
      more.setOrigin(0.5, 0.5).setPosition(x + moreW / 2, cy);
    }
  }

  private showPairTip(k: string): void {
    const r = this.pairRects.get(k);
    if (!r) return;
    this.tip.showFusion(k, this.links[k] ?? 0, this.fusion[k] ?? 0, { x: Math.min(r.x, this.x), y: r.y, w: r.w, h: r.h });
  }

  private showTip(t: Tag): void {
    const r = this.chipRects.get(t);
    if (!r || !this.counts || !this.tiers) return;
    // Anchored at the chip, but spanning down from the bar's left edge so it never runs off-screen.
    this.tip.show(t, this.counts[t], this.tiers[t], { x: Math.min(r.x, this.x), y: r.y, w: r.w, h: r.h });
  }

  /** The fusion whose card is open (hover), for the UI smoke. */
  get tipKey(): string | null {
    return this.tip.shownKey;
  }

  hideTip(): void {
    this.tip.hide();
  }

  reset(): void {
    this.last = '';
    this.tip.hide();
  }
}

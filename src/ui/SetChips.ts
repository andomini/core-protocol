// Active-set chips: one per held tag (glyph + count, lit at 2/4/6) and a "PROTOCOLS" tap target that opens
// the "My protocols" panel. Portrait: the arena's top-left corner. Landscape: the HUD's Energy row.

import Phaser from 'phaser';
import { CYAN, PANEL_FILL, TAG_COLOR, TAG_CSS, TEXT_DIM } from '../render/palette';
import { DEPTH } from '../render/WorldView';
import { TAGS, type Tag } from '../sim/perkData';
import { text } from './kit';
import type { Layout, Rect } from './layout';
import { drawTagIcon } from './tagIcon';

export class SetChips {
  private readonly g: Phaser.GameObjects.Graphics;
  private readonly labels = new Map<Tag, Phaser.GameObjects.Text>();
  private readonly hint: Phaser.GameObjects.Text;
  private readonly zone: Phaser.GameObjects.Zone;
  private readonly x: number;
  private readonly y: number;
  private readonly h: number;
  private readonly font: number;
  private last = '';
  /** Tap area (logical px), for the UI smoke. */
  rect: Rect = { x: 0, y: 0, w: 0, h: 0 };

  constructor(
    scene: Phaser.Scene,
    L: Layout,
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
    this.hint = text(scene, 0, 0, 'NO PROTOCOLS', this.font, { color: TEXT_DIM }).setOrigin(0, 0.5).setDepth(D + 0.1).setVisible(false);
    this.zone = scene.add.zone(0, 0, 10, 10).setOrigin(0).setDepth(D + 0.2);
    this.zone.on('pointerdown', onOpen);
  }

  update(counts: Record<Tag, number>, tiers: Record<Tag, number>): void {
    const key = TAGS.map((t) => `${counts[t]}:${tiers[t]}`).join(',');
    if (key === this.last) return;
    this.last = key;
    const held = TAGS.filter((t) => counts[t] > 0).sort((a, b) => counts[b] - counts[a]);
    const g = this.g.clear();
    const icon = this.h * 0.62;
    let x = this.x;
    const cy = this.y + this.h / 2;
    for (const t of TAGS) this.labels.get(t)!.setVisible(false);
    this.hint.setVisible(false);
    if (held.length === 0) {
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
  }

  reset(): void {
    this.last = '';
  }
}

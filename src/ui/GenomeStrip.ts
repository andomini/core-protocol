// The virus genome (spec 2026-10-14 §C) in the arena's top-right corner: one glyph per learned resistance
// with its level, in the tag's colour. Hidden until the first mutation.

import type Phaser from 'phaser';
import { TAGS, type Tag } from '../sim/perkData';
import { CRIMSON, TAG_COLOR, TAG_CSS } from '../render/palette';
import { DEPTH } from '../render/WorldView';
import { text } from './kit';
import { drawTagIcon } from './tagIcon';
import type { Layout } from './layout';

const D = DEPTH.hud - 1;

export class GenomeStrip {
  private readonly g: Phaser.GameObjects.Graphics;
  private readonly label: Phaser.GameObjects.Text;
  private readonly levels = new Map<Tag, Phaser.GameObjects.Text>();
  private last = '';
  private readonly font: number;

  constructor(
    scene: Phaser.Scene,
    private readonly L: Layout,
  ) {
    this.font = Math.max(L.minFont, L.o === 'portrait' ? 22 : 16);
    this.g = scene.add.graphics().setDepth(D);
    this.label = text(scene, 0, 0, 'GENOME', this.font, { font: 'title', weight: '800', color: '#ff6b8b' }).setOrigin(1, 0.5).setDepth(D + 0.1).setVisible(false);
    for (const t of TAGS) this.levels.set(t, text(scene, 0, 0, '', this.font, { color: TAG_CSS[t] }).setOrigin(1, 0.5).setDepth(D + 0.1).setVisible(false));
  }

  /** Bottom edge of the strip's box (whether shown or not): other arena-corner rows go below it. */
  static bottom(L: Layout): number {
    return L.arena.y + 14 + Math.max(L.minFont, L.o === 'portrait' ? 22 : 16) * 1.1 + 12;
  }

  update(genome: Record<Tag, number>): void {
    const key = TAGS.map((t) => genome[t]).join(',');
    if (key === this.last) return;
    this.last = key;
    const a = this.L.arena;
    const s = this.font * 1.1;
    const cy = a.y + 14 + s / 2 + 6;
    let x = a.x + a.w - 18;
    const g = this.g.clear();
    let any = false;
    for (let i = TAGS.length - 1; i >= 0; i--) {
      const t = TAGS[i]!;
      const lv = this.levels.get(t)!;
      if (genome[t] <= 0) {
        lv.setVisible(false);
        continue;
      }
      any = true;
      lv.setText(`${genome[t]}`).setPosition(x, cy).setVisible(true);
      x -= lv.width + 4;
      drawTagIcon(g, t, x - s / 2, cy, s, TAG_COLOR[t]);
      x -= s + 12;
    }
    this.label.setPosition(x, cy).setVisible(any);
    if (any) {
      const left = x - this.label.width - 10;
      g.lineStyle(1.5, CRIMSON, 0.6).strokeRect(left, cy - s / 2 - 6, a.x + a.w - 18 - left + 10, s + 12);
    }
  }
}

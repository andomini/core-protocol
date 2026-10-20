// The virus genome (spec 2026-10-14 §C) in the arena's top-right corner: one glyph per learned resistance
// with its level, in the tag's colour. Shown from wave 1 (uniqueness plan item 3): before the first mutation a
// countdown ("VIRUS ADAPTS AT WAVE 5"), then GENOME with the next adaptation wave; flashes on a mutation.

import type Phaser from 'phaser';
import type { GameData } from '../sim/data';
import { nextMutationWave } from '../sim/mutations';
import { TAGS, type Tag } from '../sim/perkData';
import { CRIMSON, TAG_COLOR, TAG_CSS } from '../render/palette';
import { DEPTH } from '../render/WorldView';
import { text } from './kit';
import { drawTagIcon } from './tagIcon';
import type { Layout } from './layout';

const D = DEPTH.hud - 1;

export class GenomeStrip {
  private readonly g: Phaser.GameObjects.Graphics;
  private readonly flashG: Phaser.GameObjects.Graphics;
  private box = { x: 0, y: 0, w: 0, h: 0 };
  private readonly label: Phaser.GameObjects.Text;
  private readonly levels = new Map<Tag, Phaser.GameObjects.Text>();
  private last = '';
  private readonly font: number;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly L: Layout,
  ) {
    this.font = Math.max(L.minFont, L.o === 'portrait' ? 22 : 16);
    this.g = scene.add.graphics().setDepth(D);
    this.flashG = scene.add.graphics().setDepth(D + 0.2).setAlpha(0);
    this.label = text(scene, 0, 0, 'GENOME', this.font, { font: 'title', weight: '800', color: '#ff6b8b' }).setOrigin(1, 0.5).setDepth(D + 0.1).setVisible(false);
    for (const t of TAGS) this.levels.set(t, text(scene, 0, 0, '', this.font, { color: TAG_CSS[t] }).setOrigin(1, 0.5).setDepth(D + 0.1).setVisible(false));
  }

  /** Bottom edge of the strip's box (whether shown or not): other arena-corner rows go below it. */
  static bottom(L: Layout): number {
    return L.arena.y + 14 + Math.max(L.minFont, L.o === 'portrait' ? 22 : 16) * 1.1 + 12;
  }

  /** Redraws when the genome or the next adaptation wave changes. */
  update(genome: Record<Tag, number>, wave: number, data: GameData): void {
    const next = nextMutationWave(data, Math.max(1, wave));
    const key = `${TAGS.map((t) => genome[t]).join(',')}:${next}`;
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
    // Countdown before the first mutation; afterwards the wave of the next one beside GENOME.
    this.label
      .setText(any ? `GENOME · W${next}` : `VIRUS ADAPTS AT WAVE ${next}`)
      .setAlpha(any ? 1 : 0.8)
      .setPosition(x, cy)
      .setVisible(true);
    const left = x - this.label.width - 10;
    this.box = { x: left, y: cy - s / 2 - 6, w: a.x + a.w - 18 - left + 10, h: s + 12 };
    g.lineStyle(1.5, CRIMSON, any ? 0.6 : 0.35).strokeRect(this.box.x, this.box.y, this.box.w, this.box.h);
  }

  /** A mutation landed: the strip's box flashes in the tag's colour. */
  flash(tag: Tag): void {
    const b = this.box;
    this.flashG.clear().fillStyle(TAG_COLOR[tag], 0.35).fillRect(b.x, b.y, b.w, b.h).lineStyle(3, TAG_COLOR[tag], 1).strokeRect(b.x - 2, b.y - 2, b.w + 4, b.h + 4);
    this.scene.tweens.killTweensOf(this.flashG);
    this.flashG.setAlpha(1);
    this.scene.tweens.add({ targets: this.flashG, alpha: 0, duration: 900, ease: 'Quad.easeOut', repeat: 0 });
  }
}

// Floating numbers for critical hits (pooled texts; throttled so a crit storm stays readable).
import type Phaser from 'phaser';
import { DEPTH } from '../render/WorldView';
import { formatNum } from './format';
import { text } from './kit';
import type { Layout } from './layout';

const POOL = 18;
const LIFE_MS = 650;
const MIN_GAP_MS = 45;

interface Num {
  t: Phaser.GameObjects.Text;
  x: number;
  y: number;
  born: number;
  live: boolean;
}

export class DamageNumbers {
  private readonly items: Num[] = [];
  private next = 0;
  private last = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    L: Layout,
  ) {
    const size = L.o === 'portrait' ? 30 : 18;
    for (let i = 0; i < POOL; i++) {
      const t = text(scene, 0, 0, '', size, { font: 'title', weight: '900', color: '#ffe14a', stroke: true }).setOrigin(0.5).setDepth(DEPTH.bars + 0.3).setVisible(false);
      this.items.push({ t, x: 0, y: 0, born: 0, live: false });
    }
  }

  show(x: number, y: number, value: number, crit: boolean): void {
    const now = this.scene.time.now;
    if (now - this.last < MIN_GAP_MS) return;
    this.last = now;
    const n = this.items[this.next]!;
    this.next = (this.next + 1) % POOL;
    n.x = x + (Math.random() - 0.5) * 16;
    n.y = y - 14;
    n.born = now;
    n.live = true;
    n.t.setText(formatNum(value)).setColor(crit ? '#ffe14a' : '#e8fbff').setPosition(n.x, n.y).setAlpha(1).setScale(1.25).setVisible(true);
  }

  update(now: number): void {
    for (const n of this.items) {
      if (!n.live) continue;
      const k = (now - n.born) / LIFE_MS;
      if (k >= 1) {
        n.live = false;
        n.t.setVisible(false);
        continue;
      }
      n.t.setPosition(n.x, n.y - 46 * k).setAlpha(1 - k * k).setScale(1.25 - 0.25 * Math.min(1, k * 4));
    }
  }

  reset(): void {
    for (const n of this.items) {
      n.live = false;
      n.t.setVisible(false);
    }
  }
}

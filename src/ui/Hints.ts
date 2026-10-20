// First-run hints (spec M7 "first 5 minutes"): one short line + a pulsing ring around the thing to tap.
// Each hint shows once, hides when its condition resolves or after a few seconds. Only in the first run.
import Phaser from 'phaser';
import { CYAN } from '../render/palette';
import { DEPTH } from '../render/WorldView';
import { text } from './kit';
import type { Layout, Rect } from './layout';

export type HintId = 'buy' | 'speed' | 'def' | 'chips' | 'pulse' | 'boot';

export interface HintState {
  /** Rect to ring, and whether the hint's condition currently holds. */
  target: Rect | null;
  active: boolean;
  /** Shows over the pick overlay (drawn above it, not held back by `blocked`), its line just under the target. */
  over?: boolean;
}

const SHOW_MS = 7000;
const TEXT: Record<HintId, string> = {
  buy: 'Spend ⚡ Energy: tap an upgrade',
  speed: 'Tap ×1 to speed the battle up',
  def: 'Low HP? Try HEALTH and REGEN in DEF',
  chips: 'Set online! Tap the chips to see your protocols',
  pulse: 'PULSE ready: tap it, the core or Space', // pulse
  boot: 'PICK A STARTER CRYSTAL — tap a card',
};

export class Hints {
  private readonly g: Phaser.GameObjects.Graphics;
  private readonly label: Phaser.GameObjects.Text;
  private readonly done = new Set<HintId>();
  private current: HintId | null = null;
  private shownAt = 0;
  private target: Rect | null = null;
  private readonly baseY: number;
  private readonly maxY: number;

  constructor(
    scene: Phaser.Scene,
    L: Layout,
    private readonly enabled: boolean,
  ) {
    this.g = scene.add.graphics().setDepth(DEPTH.overlay - 3);
    const a = L.arena;
    this.baseY = a.y + a.h * 0.82;
    this.maxY = L.h;
    this.label = text(scene, a.x + a.w / 2, a.y + a.h * 0.82, '', L.minFont, { color: '#e8fbff', glow: '#22e5ff', blur: 10, stroke: true })
      .setOrigin(0.5)
      .setDepth(DEPTH.overlay - 3)
      .setAlign('center')
      .setWordWrapWidth(a.w - 40)
      .setVisible(false);
  }

  /** Call every frame with each hint's current state; shows at most one at a time. */
  update(now: number, states: Record<HintId, HintState>, blocked: boolean): void {
    if (!this.enabled) return;
    const held = (s: HintState): boolean => blocked && s.over !== true;
    if (this.current) {
      const s = states[this.current];
      if (!s.active || held(s) || now - this.shownAt > SHOW_MS) this.hide();
      else this.target = s.target;
    }
    if (!this.current) {
      for (const id of Object.keys(states) as HintId[]) {
        const s = states[id];
        if (this.done.has(id) || !s.active || held(s)) continue;
        this.current = id;
        this.done.add(id);
        this.shownAt = now;
        this.target = s.target;
        // An `over` hint sits above the overlays, its line under the ringed rect; the rest under them, low in the arena.
        const depth = s.over === true ? DEPTH.overlay + 1 : DEPTH.overlay - 3;
        this.g.setDepth(depth);
        this.label.setDepth(depth).setText(TEXT[id]).setVisible(true);
        this.label.setY(s.over === true && s.target ? this.besideY(s.target) : this.baseY);
        break;
      }
    }
    const g = this.g.clear();
    if (!this.current || !this.target) return;
    const r = this.target;
    const k = 0.5 + 0.5 * Math.sin(now / 160);
    g.lineStyle(3 + 3 * k, CYAN, 0.5 + 0.5 * k).strokeRoundedRect(r.x - 6 - 4 * k, r.y - 6 - 4 * k, r.w + 12 + 8 * k, r.h + 12 + 8 * k, 12);
  }

  /** Just under `r`, or just above it when the line would leave the screen. */
  private besideY(r: Rect): number {
    const h = this.label.height / 2;
    const below = r.y + r.h + 22 + h;
    return below + h <= this.maxY - 8 ? below : Math.max(h + 8, r.y - 22 - h);
  }

  private hide(): void {
    this.current = null;
    this.target = null;
    this.label.setVisible(false);
    this.g.clear();
  }

  reset(): void {
    this.hide();
  }
}

// Neon UI building blocks: glowing text styles, chamfered panels and buttons (baked at RS, crisp on HiDPI).

import Phaser from 'phaser';
import { CYAN, FONT_TITLE, FONT_UI, PANEL_FILL, TEXT, WHITE } from '../render/palette';
import { ps, RS } from '../render/resolution';
import { bakePanelOnce, type PanelStyle } from '../render/textures';
import type { Rect } from './layout';

export interface TextOpts {
  color?: string;
  font?: 'title' | 'ui';
  weight?: string;
  glow?: string;
  blur?: number;
  stroke?: boolean;
}

export function textStyle(size: number, o: TextOpts = {}): Phaser.Types.GameObjects.Text.TextStyle {
  const style: Phaser.Types.GameObjects.Text.TextStyle = {
    fontFamily: o.font === 'title' ? FONT_TITLE : FONT_UI,
    fontSize: `${Math.round(size)}px`,
    fontStyle: o.weight ?? '700',
    color: o.color ?? TEXT,
    resolution: RS,
  };
  if (o.glow) {
    // Canvas shadowBlur ignores the resolution transform, so it is scaled by RS here.
    style.shadow = { offsetX: 0, offsetY: 0, color: o.glow, blur: (o.blur ?? 10) * RS, fill: true, stroke: false };
    style.padding = { x: o.blur ?? 10, y: (o.blur ?? 10) * 0.6 };
  }
  if (o.stroke) {
    style.stroke = '#03050d';
    style.strokeThickness = Math.max(3, Math.round(size / 7));
  }
  return style;
}

export function text(scene: Phaser.Scene, x: number, y: number, s: string, size: number, o: TextOpts = {}): Phaser.GameObjects.Text {
  return scene.add.text(x, y, s, textStyle(size, o));
}

/** A baked glowing chamfered frame covering `r` (logical px). One texture per size + style (reused). */
export function panel(scene: Phaser.Scene, r: Rect, depth: number, st: PanelStyle = {}): Phaser.GameObjects.Image {
  const key = `panel_${Math.round(r.w)}x${Math.round(r.h)}_${st.edge ?? ''}_${st.fill ?? ''}_${st.fillA ?? ''}_${st.cut ?? ''}_${st.lw ?? ''}_${st.blur ?? ''}`;
  const pad = bakePanelOnce(scene, key, r.w, r.h, st);
  return scene.add.image(r.x - pad, r.y - pad, key).setOrigin(0).setScale(ps(1)).setDepth(depth);
}

let onButtonPress: (() => void) | null = null;
/** A UI click sound (set once by the app; kit stays independent of the audio module). */
export function setButtonPressHook(f: () => void): void {
  onButtonPress = f;
}

export interface ButtonStyle extends PanelStyle {
  textColor?: string;
  glow?: string;
  font?: 'title' | 'ui';
}

/** A neon button: baked frame, a label (or a custom icon drawn by the caller) and a Zone hit area. */
export class Button {
  readonly bg: Phaser.GameObjects.Image;
  readonly label: Phaser.GameObjects.Text;
  readonly zone: Phaser.GameObjects.Zone;
  readonly icon: Phaser.GameObjects.Graphics;
  private shown = true;

  constructor(
    scene: Phaser.Scene,
    readonly r: Rect,
    caption: string,
    size: number,
    depth: number,
    onClick: () => void,
    st: ButtonStyle = {},
  ) {
    this.bg = panel(scene, r, depth, { fill: st.fill ?? PANEL_FILL, fillA: st.fillA ?? 0.95, edge: st.edge ?? CYAN, cut: st.cut ?? 10, lw: st.lw ?? 2, blur: st.blur ?? 8 });
    this.label = text(scene, r.x + r.w / 2, r.y + r.h / 2, caption, size, { color: st.textColor ?? '#e8fbff', glow: st.glow ?? '#22e5ff', blur: 8, font: st.font ?? 'ui' })
      .setOrigin(0.5)
      .setDepth(depth + 0.1);
    this.icon = scene.add.graphics().setDepth(depth + 0.1);
    this.zone = scene.add.zone(r.x + r.w / 2, r.y + r.h / 2, r.w, r.h).setDepth(depth + 0.2).setInteractive({ useHandCursor: true });
    this.zone.on('pointerdown', () => {
      if (!this.shown) return;
      this.press();
      onClick();
    });
  }

  private press(): void {
    onButtonPress?.();
    const s = this.bg.scene;
    s.tweens.add({ targets: [this.bg, this.label], alpha: { from: 0.55, to: 1 }, duration: 160 });
  }

  setVisible(v: boolean): this {
    this.shown = v;
    this.bg.setVisible(v);
    this.label.setVisible(v);
    this.icon.setVisible(v);
    if (v) this.zone.setInteractive({ useHandCursor: true });
    else this.zone.disableInteractive();
    return this;
  }

  destroy(): void {
    this.bg.destroy();
    this.label.destroy();
    this.icon.destroy();
    this.zone.destroy();
  }

  setDepth(d: number): this {
    this.bg.setDepth(d);
    this.label.setDepth(d + 0.1);
    this.icon.setDepth(d + 0.1);
    this.zone.setDepth(d + 0.2);
    return this;
  }

  /** Pause (two bars) or play (triangle) glyph drawn in place of a text label. */
  drawPauseIcon(paused: boolean, color = CYAN): void {
    const { x, y, w, h } = this.r;
    const cx = x + w / 2;
    const cy = y + h / 2;
    const s = Math.min(w, h) * 0.22;
    const g = this.icon.clear();
    this.label.setText('');
    for (const [lw, a] of [[6, 0.25], [0, 1]] as const) {
      g.fillStyle(lw ? color : WHITE, a);
      const grow = lw / 2;
      if (paused) {
        g.fillTriangle(cx - s * 0.8 - grow, cy - s - grow, cx - s * 0.8 - grow, cy + s + grow, cx + s + grow, cy);
      } else {
        g.fillRect(cx - s * 0.85 - grow, cy - s - grow, s * 0.6 + lw, s * 2 + lw);
        g.fillRect(cx + s * 0.25 - grow, cy - s - grow, s * 0.6 + lw, s * 2 + lw);
      }
    }
  }
}

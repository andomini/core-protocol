// "CORE BREACHED" overlay: wave reached, kills, Energy, Bits, and RESTART (a new run with a new seed).

import Phaser from 'phaser';
import { BITS_CSS, CORE_HIT, CYAN, ENERGY_CSS, TEXT_DIM, TEXT_RED } from '../render/palette';
import { ps } from '../render/resolution';
import { DEPTH } from '../render/WorldView';
import { formatNum } from './format';
import { Button, panel, text } from './kit';
import type { Layout } from './layout';

export interface DeathStats {
  wave: number;
  kills: number;
  energy: number;
  bits: number;
}

export class DeathOverlay {
  private readonly objs: Phaser.GameObjects.GameObject[] = [];
  private readonly values: Phaser.GameObjects.Text[] = [];
  private readonly title: Phaser.GameObjects.Text;
  private readonly ghostA: Phaser.GameObjects.Text;
  private readonly ghostB: Phaser.GameObjects.Text;
  private readonly restart: Button;

  /** RESTART button rect (logical px), for the UI smoke. */
  restartRect(): { x: number; y: number; w: number; h: number } {
    return this.restart.r;
  }
  private readonly blocker: Phaser.GameObjects.Zone;
  visible = false;
  private shownAt = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    L: Layout,
    onRestart: () => void,
  ) {
    const D = DEPTH.overlay;
    const portrait = L.o === 'portrait';
    const cw = portrait ? 620 : 520;
    const ch = portrait ? 640 : 470;
    const cx = L.w / 2;
    const cy = L.h / 2;
    const x0 = cx - cw / 2;
    const y0 = cy - ch / 2;
    const dim = scene.add.graphics().setDepth(D);
    dim.fillStyle(0x02040c, 0.8).fillRect(0, 0, L.w, L.h);
    // Red scanline wash.
    dim.fillStyle(CORE_HIT, 0.035);
    for (let y = 0; y < L.h; y += 6) dim.fillRect(0, y, L.w, 2);
    this.blocker = scene.add.zone(cx, cy, L.w, L.h).setDepth(D).setInteractive();
    const card = panel(scene, { x: x0, y: y0, w: cw, h: ch }, D + 0.1, { edge: CORE_HIT, fillA: 0.92, cut: 26, blur: 16, lw: 2.5 });
    const tSize = portrait ? 54 : 40;
    const ty = y0 + (portrait ? 92 : 70);
    const titleOpts = { font: 'title' as const, weight: '900' };
    this.ghostA = text(scene, cx, ty, 'CORE BREACHED', tSize, { ...titleOpts, color: '#00f0ff' }).setOrigin(0.5).setDepth(D + 0.2).setAlpha(0.6).setBlendMode(Phaser.BlendModes.ADD);
    this.ghostB = text(scene, cx, ty, 'CORE BREACHED', tSize, { ...titleOpts, color: '#ff1050' }).setOrigin(0.5).setDepth(D + 0.2).setAlpha(0.6).setBlendMode(Phaser.BlendModes.ADD);
    this.title = text(scene, cx, ty, 'CORE BREACHED', tSize, { ...titleOpts, color: '#ffd9e0', glow: TEXT_RED, blur: 18 }).setOrigin(0.5).setDepth(D + 0.3);
    const sub = text(scene, cx, ty + tSize * 0.95, 'connection to core lost', portrait ? 28 : 18, { color: TEXT_DIM }).setOrigin(0.5).setDepth(D + 0.3);
    this.objs.push(dim, card, this.ghostA, this.ghostB, this.title, sub);

    const rows: [string, string, string][] = [
      ['ic_wave', 'WAVE REACHED', '#e8fbff'],
      ['ic_kills', 'VIRUSES PURGED', '#ff8be8'],
      ['ic_energy', 'ENERGY', ENERGY_CSS],
      ['ic_bits', 'BITS', BITS_CSS],
    ];
    const rowH = portrait ? 66 : 50;
    const fs = portrait ? 32 : 22;
    const ry0 = ty + tSize * 0.95 + (portrait ? 70 : 52);
    const lx = x0 + (portrait ? 56 : 44);
    const rx = x0 + cw - (portrait ? 56 : 44);
    rows.forEach(([icon, label, color], i) => {
      const y = ry0 + i * rowH;
      const line = scene.add.graphics().setDepth(D + 0.2);
      line.fillStyle(0x22e5ff, 0.07).fillRect(lx - 12, y - rowH / 2 + 4, rx - lx + 24, rowH - 8);
      const ic = scene.add.image(lx + 14, y, icon).setScale(ps(portrait ? 1.1 : 0.85)).setDepth(D + 0.3).setBlendMode(Phaser.BlendModes.ADD);
      const lt = text(scene, lx + 44, y, label, Math.max(L.minFont, fs * 0.85), { color: TEXT_DIM }).setOrigin(0, 0.5).setDepth(D + 0.3);
      const vt = text(scene, rx, y, '0', fs, { color, glow: color, blur: 8 }).setOrigin(1, 0.5).setDepth(D + 0.3);
      this.values.push(vt);
      this.objs.push(line, ic, lt, vt);
    });
    const bw = portrait ? 380 : 280;
    const bh = portrait ? 92 : 62;
    this.restart = new Button(scene, { x: cx - bw / 2, y: y0 + ch - bh - (portrait ? 48 : 36), w: bw, h: bh }, 'RESTART', portrait ? 40 : 28, D + 0.4, onRestart, {
      font: 'title',
      edge: CYAN,
      fill: 0x062a3a,
      lw: 3,
      blur: 14,
    });
    this.hide();
  }

  show(s: DeathStats, now: number): void {
    const v = [s.wave, s.kills, s.energy, s.bits];
    this.values.forEach((t, i) => t.setText(formatNum(v[i]!)));
    for (const o of this.objs) (o as unknown as Phaser.GameObjects.Components.Visible).setVisible(true);
    this.restart.setVisible(true);
    this.blocker.setInteractive();
    this.visible = true;
    this.shownAt = now;
    const targets = [...this.objs.filter((o) => o !== this.ghostA && o !== this.ghostB), this.restart.bg, this.restart.label];
    this.scene.tweens.add({ targets, alpha: { from: 0, to: 1 }, duration: 350 });
  }

  hide(): void {
    for (const o of this.objs) (o as unknown as Phaser.GameObjects.Components.Visible).setVisible(false);
    this.restart.setVisible(false);
    this.blocker.disableInteractive();
    this.visible = false;
  }

  /** Glitch the title: RGB-split copies jitter in short bursts. */
  update(now: number): void {
    if (!this.visible) return;
    const t = now - this.shownAt;
    const burst = t < 600 || (t % 2200) < 180;
    const j = burst ? 4 + Math.random() * 8 : 2;
    this.ghostA.setPosition(this.title.x - j, this.title.y + (burst ? (Math.random() - 0.5) * 6 : 0));
    this.ghostB.setPosition(this.title.x + j, this.title.y + (burst ? (Math.random() - 0.5) * 6 : 0));
  }
}

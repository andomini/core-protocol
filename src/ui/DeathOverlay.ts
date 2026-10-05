// "CORE BREACHED": wave reached, kills, Bits and Keys paid into the meta save (after lab multipliers and
// milestones), a note (new best / milestones / tier unlocked), and REVIVE ▶AD · ×2 BITS ▶AD · HOME · RETRY.

import Phaser from 'phaser';
import { BITS_CSS, CORE_HIT, CYAN, ENERGY, KEY_CSS, TEXT_DIM, TEXT_RED } from '../render/palette';
import { ps } from '../render/resolution';
import { DEPTH } from '../render/WorldView';
import { formatNum } from './format';
import { Button, panel, text } from './kit';
import type { Layout, Rect } from './layout';

export interface DeathStats {
  wave: number;
  kills: number;
  bits: number;
  keys: number;
  /** "NEW BEST · MILESTONE W25 · TIER 2 UNLOCKED" (empty: no line). */
  note: string;
  canRevive: boolean;
  canDouble: boolean;
}

export interface DeathHandlers {
  revive(): void;
  double(): void;
  home(): void;
  retry(): void;
}

export class DeathOverlay {
  private readonly objs: Phaser.GameObjects.GameObject[] = [];
  private readonly values: Phaser.GameObjects.Text[] = [];
  private readonly title: Phaser.GameObjects.Text;
  private readonly ghostA: Phaser.GameObjects.Text;
  private readonly ghostB: Phaser.GameObjects.Text;
  private readonly note: Phaser.GameObjects.Text;
  private readonly reviveBtn: Button;
  private readonly doubleBtn: Button;
  private readonly homeBtn: Button;
  private readonly retryBtn: Button;
  private readonly blocker: Phaser.GameObjects.Zone;
  visible = false;
  private shownAt = 0;
  private stats: DeathStats | null = null;

  /** RETRY button rect (logical px), for the UI smoke (the old RESTART). */
  restartRect(): Rect {
    return this.retryBtn.r;
  }

  homeRect(): Rect {
    return this.homeBtn.r;
  }

  reviveRect(): Rect {
    return this.reviveBtn.r;
  }

  doubleRect(): Rect {
    return this.doubleBtn.r;
  }

  constructor(
    private readonly scene: Phaser.Scene,
    L: Layout,
    h: DeathHandlers,
  ) {
    const D = DEPTH.overlay;
    const portrait = L.o === 'portrait';
    const cw = portrait ? 640 : 560;
    const ch = portrait ? 860 : 620;
    const cx = L.w / 2;
    const cy = L.h / 2;
    const x0 = cx - cw / 2;
    const y0 = cy - ch / 2;
    const dim = scene.add.graphics().setDepth(D);
    dim.fillStyle(0x02040c, 0.8).fillRect(0, 0, L.w, L.h);
    dim.fillStyle(CORE_HIT, 0.035);
    for (let y = 0; y < L.h; y += 6) dim.fillRect(0, y, L.w, 2);
    this.blocker = scene.add.zone(cx, cy, L.w, L.h).setDepth(D).setInteractive();
    const card = panel(scene, { x: x0, y: y0, w: cw, h: ch }, D + 0.1, { edge: CORE_HIT, fillA: 0.92, cut: 26, blur: 16, lw: 2.5 });
    const tSize = portrait ? 54 : 40;
    const ty = y0 + (portrait ? 80 : 56);
    const titleOpts = { font: 'title' as const, weight: '900' };
    this.ghostA = text(scene, cx, ty, 'CORE BREACHED', tSize, { ...titleOpts, color: '#00f0ff' }).setOrigin(0.5).setDepth(D + 0.2).setAlpha(0.6).setBlendMode(Phaser.BlendModes.ADD);
    this.ghostB = text(scene, cx, ty, 'CORE BREACHED', tSize, { ...titleOpts, color: '#ff1050' }).setOrigin(0.5).setDepth(D + 0.2).setAlpha(0.6).setBlendMode(Phaser.BlendModes.ADD);
    this.title = text(scene, cx, ty, 'CORE BREACHED', tSize, { ...titleOpts, color: '#ffd9e0', glow: TEXT_RED, blur: 18 }).setOrigin(0.5).setDepth(D + 0.3);
    const sub = text(scene, cx, ty + tSize * 0.9, 'connection to core lost', portrait ? 28 : 18, { color: TEXT_DIM }).setOrigin(0.5).setDepth(D + 0.3);
    this.objs.push(dim, card, this.ghostA, this.ghostB, this.title, sub);

    const rows: [string, string, string][] = [
      ['ic_wave', 'WAVE REACHED', '#e8fbff'],
      ['ic_kills', 'VIRUSES PURGED', '#ff8be8'],
      ['ic_bits', 'BITS EARNED', BITS_CSS],
      ['ic_key', 'KEYS', KEY_CSS],
    ];
    const rowH = portrait ? 66 : 50;
    const fs = portrait ? 32 : 22;
    const ry0 = ty + tSize * 0.9 + (portrait ? 64 : 48);
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
    const noteY = ry0 + rows.length * rowH + (portrait ? 10 : 6);
    this.note = text(scene, cx, noteY, '', L.minFont, { color: '#2bffb0', glow: '#2bffb0', blur: 8 }).setOrigin(0.5, 0).setDepth(D + 0.3).setAlign('center').setWordWrapWidth(cw - 60);
    this.objs.push(this.note);
    const gap = portrait ? 20 : 16;
    const bw = (cw - (portrait ? 80 : 64) - gap) / 2;
    const bh = portrait ? 92 : 62;
    const bx0 = x0 + (portrait ? 40 : 32);
    const by2 = y0 + ch - bh - (portrait ? 40 : 30);
    const by1 = by2 - bh - gap;
    const bf = portrait ? 30 : 21;
    this.reviveBtn = new Button(scene, { x: bx0, y: by1, w: bw, h: bh }, 'REVIVE ▶AD', bf, D + 0.4, () => h.revive(), { font: 'title', edge: 0x2bffb0, fill: 0x063a2a, textColor: '#2bffb0', glow: '#2bffb0', lw: 2.5, blur: 12 });
    this.doubleBtn = new Button(scene, { x: bx0 + bw + gap, y: by1, w: bw, h: bh }, '×2 BITS ▶AD', bf, D + 0.4, () => h.double(), { font: 'title', edge: ENERGY, fill: 0x2a2306, textColor: '#ffd23f', glow: '#ffd23f', lw: 2.5, blur: 12 });
    this.homeBtn = new Button(scene, { x: bx0, y: by2, w: bw, h: bh }, 'HOME', bf + 4, D + 0.4, () => h.home(), { font: 'title', edge: CYAN, fill: 0x0a1230, lw: 2.5, blur: 12 });
    this.retryBtn = new Button(scene, { x: bx0 + bw + gap, y: by2, w: bw, h: bh }, 'RETRY', bf + 4, D + 0.4, () => h.retry(), { font: 'title', edge: CYAN, fill: 0x062a3a, lw: 3, blur: 14 });
    this.hide();
  }

  private setBtn(b: Button, on: boolean): void {
    b.setVisible(true);
    b.bg.setAlpha(on ? 1 : 0.3);
    b.label.setAlpha(on ? 1 : 0.4);
    if (!on) b.zone.disableInteractive();
  }

  show(s: DeathStats, now: number): void {
    this.stats = s;
    this.fill();
    for (const o of this.objs) (o as unknown as Phaser.GameObjects.Components.Visible).setVisible(true);
    this.homeBtn.setVisible(true);
    this.retryBtn.setVisible(true);
    this.setBtn(this.reviveBtn, s.canRevive);
    this.setBtn(this.doubleBtn, s.canDouble);
    this.blocker.setInteractive();
    this.visible = true;
    this.shownAt = now;
    const targets = [...this.objs.filter((o) => o !== this.ghostA && o !== this.ghostB), this.homeBtn.bg, this.homeBtn.label, this.retryBtn.bg, this.retryBtn.label];
    this.scene.tweens.add({ targets, alpha: { from: 0, to: 1 }, duration: 350 });
  }

  /** Refreshes values and button states (after ×2, or a failed revive). */
  update2(s: Partial<DeathStats>): void {
    if (!this.stats) return;
    this.stats = { ...this.stats, ...s };
    this.fill();
    this.setBtn(this.reviveBtn, this.stats.canRevive);
    this.setBtn(this.doubleBtn, this.stats.canDouble);
  }

  private fill(): void {
    const s = this.stats!;
    const v = [s.wave, s.kills, s.bits, s.keys];
    this.values.forEach((t, i) => t.setText(i === 2 ? `+${formatNum(v[i]!)}` : formatNum(v[i]!)));
    this.note.setText(s.note);
  }

  hide(): void {
    for (const o of this.objs) (o as unknown as Phaser.GameObjects.Components.Visible).setVisible(false);
    for (const b of [this.reviveBtn, this.doubleBtn, this.homeBtn, this.retryBtn]) b.setVisible(false);
    this.blocker.disableInteractive();
    this.visible = false;
  }

  /** Glitch the title: RGB-split copies jitter in short bursts. */
  update(now: number): void {
    if (!this.visible) return;
    const t = now - this.shownAt;
    const burst = t < 600 || t % 2200 < 180;
    const j = burst ? 4 + Math.random() * 8 : 2;
    this.ghostA.setPosition(this.title.x - j, this.title.y + (burst ? (Math.random() - 0.5) * 6 : 0));
    this.ghostB.setPosition(this.title.x + j, this.title.y + (burst ? (Math.random() - 0.5) * 6 : 0));
  }
}

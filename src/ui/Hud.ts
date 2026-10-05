// Battle HUD: wave number + wave/break timer bar, core HP bar with numbers, Energy, speed toggle, pause.
// Portrait: a strip above the arena. Landscape: the top of the right column.
// Also draws the reserved (empty) upgrade panel frame for M2b.

import Phaser from 'phaser';
import { BG, BREAK, CYAN, ENERGY_CSS, HP_LOW, HP_OK, PANEL_FILL, TEXT_DIM, WHITE } from '../render/palette';
import { ps } from '../render/resolution';
import { DEPTH } from '../render/WorldView';
import type { GameData } from '../sim/data';
import type { World } from '../sim/state';
import type { CoreStats } from '../sim/stats';
import { pauseTicks, waveTicks } from '../sim/waves';
import { formatNum } from './format';
import { Button, panel, text } from './kit';
import type { Layout, Rect } from './layout';

interface Geo {
  wave: [number, number, number];
  secs: [number, number];
  /** Portrait: the timer text follows the wave number on the same row. */
  secsInline: boolean;
  energyIcon: [number, number, number];
  energy: [number, number, number];
  speed: Rect;
  pause: Rect;
  btnFont: number;
  hpIcon: [number, number, number];
  hp: Rect;
  hpFont: number;
  timer: Rect;
}

function geometry(L: Layout): Geo {
  const h = L.hud;
  if (L.o === 'portrait') {
    return {
      wave: [24, 14, 40],
      secs: [0, 28],
      secsInline: true,
      energyIcon: [530, 103, 1.2],
      energy: [556, 103, 34],
      speed: { x: 512, y: 14, w: 92, h: 60 },
      pause: { x: 616, y: 14, w: 84, h: 60 },
      btnFont: 32,
      hpIcon: [42, 103, 1.2],
      hp: { x: 70, y: 86, w: 430, h: 34 },
      hpFont: 28,
      timer: { x: 0, y: h.h - 6, w: h.w, h: 6 },
    };
  }
  const x = h.x + 28;
  return {
    wave: [x, 26, 28],
    secs: [x, 64],
    secsInline: false,
    energyIcon: [x + 14, 170, 1],
    energy: [x + 36, 170, 26],
    speed: { x: h.x + h.w - 172, y: 24, w: 70, h: 46 },
    pause: { x: h.x + h.w - 92, y: 24, w: 64, h: 46 },
    btnFont: 22,
    hpIcon: [x + 14, 124, 0.95],
    hp: { x: x + 36, y: 110, w: h.w - 92, h: 28 },
    hpFont: 18,
    timer: { x, y: 90, w: h.w - 56, h: 6 },
  };
}

export interface HudHandlers {
  onSpeed: () => void;
  onPause: () => void;
}

export class Hud {
  private readonly g: Geo;
  private readonly bars: Phaser.GameObjects.Graphics;
  private readonly waveText: Phaser.GameObjects.Text;
  private readonly secsText: Phaser.GameObjects.Text;
  private readonly energyText: Phaser.GameObjects.Text;
  private readonly hpText: Phaser.GameObjects.Text;
  private readonly speedBtn: Button;
  private readonly pauseBtn: Button;
  private readonly pausedBanner: Phaser.GameObjects.Text;
  private last = { wave: -1, secs: '', energy: '', hp: '', speed: -1, paused: null as boolean | null };
  private hpShown = 1;
  private hitUntil = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly L: Layout,
    private readonly data: GameData,
    h: HudHandlers,
  ) {
    const g = (this.g = geometry(L));
    const D = DEPTH.hud;
    const bg = scene.add.graphics().setDepth(D - 1);
    // Opaque backing for the HUD and the panel so world sprites outside the arena never show through.
    bg.fillStyle(BG, 1);
    for (const r of [L.hud, L.panel]) bg.fillRect(r.x, r.y, r.w, r.h);
    if (L.o === 'portrait') {
      bg.fillStyle(PANEL_FILL, 0.95).fillRect(L.hud.x, L.hud.y, L.hud.w, L.hud.h);
      bg.lineStyle(8, CYAN, 0.08).lineBetween(0, L.panel.y, L.w, L.panel.y);
      bg.lineStyle(2, CYAN, 0.7).lineBetween(0, L.panel.y + 1, L.w, L.panel.y + 1);
    } else {
      bg.lineStyle(8, CYAN, 0.08).lineBetween(L.arena.w, 0, L.arena.w, L.h);
      bg.lineStyle(2, CYAN, 0.7).lineBetween(L.arena.w + 1, 0, L.arena.w + 1, L.h);
      panel(scene, { x: L.hud.x + 14, y: 12, w: L.hud.w - 28, h: L.hud.h - 18 }, D - 0.5, { fillA: 0.6, cut: 16, blur: 8 });
    }
    this.drawPanel();

    this.waveText = text(scene, g.wave[0], g.wave[1], 'WAVE 1', g.wave[2], { font: 'title', weight: '900', glow: '#22e5ff', blur: 12 }).setDepth(D);
    this.secsText = text(scene, g.secs[0], g.secs[1], '', L.minFont, { color: TEXT_DIM }).setDepth(D);
    scene.add.image(g.energyIcon[0], g.energyIcon[1], 'ic_energy').setScale(ps(g.energyIcon[2])).setDepth(D).setBlendMode(Phaser.BlendModes.ADD);
    this.energyText = text(scene, g.energy[0], g.energy[1], '0', g.energy[2], { color: ENERGY_CSS, glow: ENERGY_CSS, blur: 10 }).setOrigin(0, 0.5).setDepth(D);
    scene.add.image(g.hpIcon[0], g.hpIcon[1], 'ic_hp').setScale(ps(g.hpIcon[2])).setDepth(D).setBlendMode(Phaser.BlendModes.ADD);
    this.hpText = text(scene, g.hp.x + g.hp.w / 2, g.hp.y + g.hp.h / 2, '', g.hpFont, { stroke: true }).setOrigin(0.5).setDepth(D + 0.2);
    this.bars = scene.add.graphics().setDepth(D + 0.1);
    this.speedBtn = new Button(scene, g.speed, '×1', g.btnFont, D, h.onSpeed, { font: 'title' });
    this.pauseBtn = new Button(scene, g.pause, '', g.btnFont, D, h.onPause);
    this.pauseBtn.drawPauseIcon(false);
    const a = L.arena;
    this.pausedBanner = text(scene, a.x + a.w / 2, a.y + a.h * 0.2, 'PAUSED', Math.max(L.minFont * 1.6, 34), { font: 'title', weight: '900', glow: '#22e5ff', blur: 16 })
      .setOrigin(0.5)
      .setDepth(DEPTH.overlay - 1)
      .setVisible(false);
  }

  /** The reserved upgrade panel: an empty neon frame for M2b. */
  private drawPanel(): void {
    const L = this.L;
    const p = L.panel;
    const m = L.o === 'portrait' ? 20 : 14;
    const r = { x: p.x + m, y: p.y + m, w: p.w - m * 2, h: p.h - m * 2 };
    panel(this.scene, r, DEPTH.hud - 0.5, { fillA: 0.55, cut: 22, blur: 10, edge: 0x1f6bff });
    const g = this.scene.add.graphics().setDepth(DEPTH.hud - 0.4);
    // Faint diagonal hatching: "reserved" without looking broken.
    g.lineStyle(1, 0x1f6bff, 0.08);
    for (let x = r.x - r.h; x < r.x + r.w; x += 22) {
      const x0 = Math.max(r.x, x);
      const y0 = r.y + (x0 - x);
      const x1 = Math.min(r.x + r.w, x + r.h);
      const y1 = r.y + (x1 - x);
      g.lineBetween(x0, y0, x1, y1);
    }
    text(this.scene, r.x + r.w / 2, r.y + r.h / 2, 'UPGRADES — M2b', L.o === 'portrait' ? 32 : 22, { font: 'title', weight: '700', color: '#3f6fd8', glow: '#1f6bff', blur: 10 })
      .setOrigin(0.5)
      .setDepth(DEPTH.hud);
  }

  coreHit(now: number): void {
    this.hitUntil = now + 140;
  }

  reset(): void {
    this.last = { wave: -1, secs: '', energy: '', hp: '', speed: -1, paused: null };
    this.hpShown = 1;
  }

  update(w: World, st: CoreStats, speed: number, paused: boolean, now: number, dt: number): void {
    const L = this.last;
    if (w.wave !== L.wave) {
      L.wave = w.wave;
      this.waveText.setText(`WAVE ${Math.max(1, w.wave)}`);
      if (this.g.secsInline) this.secsText.setX(this.waveText.x + this.waveText.width + 4);
    }
    const wt = waveTicks(this.data);
    const pt = pauseTicks(this.data);
    const inWave = w.phase === 'wave';
    const left = inWave ? wt - w.phaseTick : pt - w.phaseTick;
    const s = Math.max(0, Math.ceil(left / this.data.config.tickHz));
    const secs = this.g.secsInline ? (inWave ? `${s}s` : `NEXT ${s}s`) : `${inWave ? 'WAVE ENDS IN' : 'NEXT WAVE IN'} ${s}s`;
    if (secs !== L.secs) this.secsText.setText((L.secs = secs));
    const energy = formatNum(w.energy);
    if (energy !== L.energy) this.energyText.setText((L.energy = energy));
    const hp = `${formatNum(Math.ceil(w.core.hp))} / ${formatNum(st.health)}`;
    if (hp !== L.hp) this.hpText.setText((L.hp = hp));
    if (speed !== L.speed) {
      L.speed = speed;
      this.speedBtn.label.setText(`×${speed}`);
    }
    if (paused !== L.paused) {
      L.paused = paused;
      this.pauseBtn.drawPauseIcon(paused);
      this.pausedBanner.setVisible(paused);
    }
    if (paused) this.pausedBanner.setAlpha(0.6 + 0.4 * Math.sin(now / 250));

    // Bars.
    const g = this.bars.clear();
    const t = this.g.timer;
    const frac = inWave ? w.phaseTick / wt : w.phaseTick / pt;
    const tc = inWave ? CYAN : BREAK;
    g.fillStyle(0x0f1a3a, 1).fillRect(t.x, t.y, t.w, t.h);
    g.fillStyle(tc, 0.25).fillRect(t.x, t.y - 3, t.w * frac, t.h + 6);
    g.fillStyle(tc, 1).fillRect(t.x, t.y, t.w * frac, t.h);
    g.fillStyle(WHITE, 0.9).fillRect(t.x + t.w * frac - 3, t.y - 2, 3, t.h + 4);

    const target = Math.max(0, w.core.hp / st.health);
    // The trailing "damage" segment eases down to the real value.
    this.hpShown = target > this.hpShown ? target : this.hpShown + (target - this.hpShown) * Math.min(1, dt / 220);
    const r = this.g.hp;
    const low = target < 0.3;
    const color = low ? HP_LOW : HP_OK;
    g.fillStyle(0x0b1430, 1).fillRect(r.x, r.y, r.w, r.h);
    g.fillStyle(WHITE, 0.35).fillRect(r.x, r.y, r.w * this.hpShown, r.h);
    g.fillStyle(color, low && Math.sin(now / 90) > 0 ? 0.7 : 1).fillRect(r.x, r.y, r.w * target, r.h);
    g.fillStyle(WHITE, 0.3).fillRect(r.x, r.y, r.w * target, 3);
    // Segment ticks every 10 %.
    g.fillStyle(0x05070f, 0.55);
    for (let i = 1; i < 10; i++) g.fillRect(r.x + (r.w * i) / 10 - 1, r.y, 2, r.h);
    const hit = now < this.hitUntil;
    g.lineStyle(hit ? 6 : 6, hit ? HP_LOW : color, hit ? 0.45 : 0.15).strokeRect(r.x - 2, r.y - 2, r.w + 4, r.h + 4);
    g.lineStyle(2, hit ? WHITE : color, hit ? 1 : 0.8).strokeRect(r.x, r.y, r.w, r.h);
  }
}

// Battle HUD: wave number + wave/break timer bar, core HP bar with numbers, Energy, speed toggle, pause, and the
// Pulse button (cooldown ring + the dominant tag's glyph; uniqueness plan item 4) in the arena's bottom-right corner.
// Portrait: a strip above the arena. Landscape: the top of the right column.
// Also paints the opaque backing under the upgrade panel (src/ui/UpgradePanel.ts draws the panel).

import Phaser from 'phaser';
import { BG, BREAK, CYAN, TAG_COLOR, ENERGY_CSS, HP_LOW, HP_OK, MARK_CSS, PANEL_FILL, TEXT_DIM, WHITE } from '../render/palette';
import { ps } from '../render/resolution';
import { DEPTH } from '../render/WorldView';
import { bossLook } from '../render/bossShapes';
import { bossShielded } from '../sim/bosses';
import type { GameData } from '../sim/data';
import { fusionMark } from '../sim/perks';
import { pulseCharge, pulseTag } from '../sim/pulse';
import type { Enemy, World } from '../sim/state';
import type { CoreStats } from '../sim/stats';
import { pauseTicks, waveTicks } from '../sim/waves';
import { formatNum } from './format';
import { Button, panel, text } from './kit';
import type { Layout, Rect } from './layout';
import { drawTagIcon } from './tagIcon';

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
  /** Bounty chip anchor (right-aligned); portrait: the arena's bottom-right corner (the HUD rows are full). */
  bounty: [number, number, number];
  /** Pulse button (square; the cooldown ring is drawn inside it). */
  pulse: Rect;
  /** c1: the tier boss bar in the arena's bottom-left corner (left of the Pulse button): name row, bar, hint row. */
  boss: { x: number; w: number; nameY: number; barY: number; barH: number; hintY: number; nameFont: number; hintFont: number };
}

/** c1: the boss bar block sits on the arena's bottom edge, left of the Pulse button and the bounty chip. */
function bossGeo(L: Layout, right: number): Geo['boss'] {
  const a = L.arena;
  const portrait = L.o === 'portrait';
  const hintFont = L.minFont;
  const nameFont = Math.max(L.minFont, portrait ? 28 : 20);
  const barH = portrait ? 14 : 10;
  const hintY = a.y + a.h - (portrait ? 22 : 18);
  const barY = hintY - hintFont * 1.25 - 6 - barH;
  return { x: a.x + 24, w: right - 16 - (a.x + 24), nameY: barY - 6, barY, barH, hintY, nameFont, hintFont };
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
      bounty: [L.arena.x + L.arena.w - 32, L.arena.y + L.arena.h - 40, 22],
      pulse: { x: L.arena.x + L.arena.w - 140, y: L.arena.y + L.arena.h - 196, w: 116, h: 126 },
      boss: bossGeo(L, L.arena.x + L.arena.w - 200),
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
    bounty: [h.x + h.w - 30, 170, 18],
    pulse: { x: L.arena.x + L.arena.w - 124, y: L.arena.y + L.arena.h - 130, w: 100, h: 106 },
    boss: bossGeo(L, L.arena.x + L.arena.w - 124),
  };
}

export interface HudHandlers {
  onSpeed: () => void;
  onPause: () => void;
  onPulse: () => void;
}

export class Hud {
  private readonly g: Geo;
  private readonly bars: Phaser.GameObjects.Graphics;
  readonly waveText: Phaser.GameObjects.Text;
  readonly secsText: Phaser.GameObjects.Text;
  private readonly energyText: Phaser.GameObjects.Text;
  private readonly hpText: Phaser.GameObjects.Text;
  readonly speedBtn: Button;
  private readonly pauseBtn: Button;
  /** Pulse button; `.r` is the hint target. */
  readonly pulseBtn: Button;
  private pulseKey = '';
  private readonly pausedBanner: Phaser.GameObjects.Text;
  readonly bountyText: Phaser.GameObjects.Text;
  private last = { wave: -1, secs: '', energy: '', hp: '', speed: -1, paused: null as boolean | null, bounty: '' };
  private hpShown = 1;
  private hitUntil = 0;
  /** c1: the tier boss bar (name, FINALE tag, HP %, the how-to-beat-it hint); texts change only with the boss. */
  private readonly bossName: Phaser.GameObjects.Text;
  private readonly bossTag: Phaser.GameObjects.Text;
  private readonly bossHint: Phaser.GameObjects.Text;
  private bossKey = '';
  private bossHpShown = 1;

  constructor(
    scene: Phaser.Scene,
    L: Layout,
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

    this.waveText = text(scene, g.wave[0], g.wave[1], 'WAVE 1', g.wave[2], { font: 'title', weight: '900', glow: '#22e5ff', blur: 12 }).setDepth(D);
    this.secsText = text(scene, g.secs[0], g.secs[1], '', L.minFont, { color: TEXT_DIM }).setDepth(D);
    scene.add.image(g.energyIcon[0], g.energyIcon[1], 'ic_energy').setScale(ps(g.energyIcon[2])).setDepth(D).setBlendMode(Phaser.BlendModes.ADD);
    this.energyText = text(scene, g.energy[0], g.energy[1], '0', g.energy[2], { color: ENERGY_CSS, glow: ENERGY_CSS, blur: 10 }).setOrigin(0, 0.5).setDepth(D);
    scene.add.image(g.hpIcon[0], g.hpIcon[1], 'ic_hp').setScale(ps(g.hpIcon[2])).setDepth(D).setBlendMode(Phaser.BlendModes.ADD);
    this.hpText = text(scene, g.hp.x + g.hp.w / 2, g.hp.y + g.hp.h / 2, '', g.hpFont, { stroke: true }).setOrigin(0.5).setDepth(D + 0.2);
    this.bars = scene.add.graphics().setDepth(D + 0.1);
    this.bountyText = text(scene, g.bounty[0], g.bounty[1], '', Math.max(L.minFont, g.bounty[2]), { font: 'title', weight: '900', color: MARK_CSS, glow: MARK_CSS, blur: 8 })
      .setOrigin(1, 0.5)
      .setDepth(D);
    this.speedBtn = new Button(scene, g.speed, '×1', g.btnFont, D, h.onSpeed, { font: 'title' });
    this.pauseBtn = new Button(scene, g.pause, '', g.btnFont, D, h.onPause);
    this.pauseBtn.drawPauseIcon(false);
    this.pulseBtn = new Button(scene, g.pulse, 'PULSE', L.minFont, D, h.onPulse, { font: 'title', fillA: 0.75 });
    this.pulseBtn.label.setY(g.pulse.y + g.pulse.h - g.pulse.w * 0.14);
    const bg2 = g.boss;
    this.bossName = text(scene, bg2.x, bg2.nameY, '', bg2.nameFont, { font: 'title', weight: '900', stroke: true }).setOrigin(0, 1).setDepth(D).setVisible(false);
    this.bossTag = text(scene, bg2.x + bg2.w, bg2.nameY, '', L.minFont, { font: 'title', weight: '900', stroke: true }).setOrigin(1, 1).setDepth(D).setVisible(false);
    this.bossHint = text(scene, bg2.x, bg2.hintY, '', bg2.hintFont, { color: '#e8fbff', stroke: true }).setOrigin(0, 1).setDepth(D).setVisible(false);
    const a = L.arena;
    this.pausedBanner = text(scene, a.x + a.w / 2, a.y + a.h * 0.2, 'PAUSED', Math.max(L.minFont * 1.6, 34), { font: 'title', weight: '900', glow: '#22e5ff', blur: 16 })
      .setOrigin(0.5)
      .setDepth(DEPTH.overlay - 1)
      .setVisible(false);
  }

  coreHit(now: number): void {
    this.hitUntil = now + 140;
  }

  reset(): void {
    this.last = { wave: -1, secs: '', energy: '', hp: '', speed: -1, paused: null, bounty: '' };
    this.hpShown = 1;
    this.pulseKey = '';
    this.bossKey = '';
    this.bossHpShown = 1;
  }

  /** c1: the living tier boss (the first one; a FINALE boss wins), else undefined. */
  private tierBoss(w: World): Enemy | undefined {
    let best: Enemy | undefined;
    for (const e of w.enemies) if (e.boss !== undefined && e.hp > 0 && (best === undefined || (e.finale === true && best.finale !== true))) best = e;
    return best;
  }

  /** c1: name + FINALE tag, an HP bar in the boss's colour (white while shielded) and the hint's "how to beat it" half. */
  private drawBoss(g: Phaser.GameObjects.Graphics, w: World, now: number, dt: number): void {
    const e = this.tierBoss(w);
    const key = e === undefined ? '' : `${e.boss}|${e.finale === true}|${e.enraged === true}`;
    if (key !== this.bossKey) {
      this.bossKey = key;
      this.bossHpShown = 1;
      const on = e !== undefined;
      for (const t of [this.bossName, this.bossTag, this.bossHint]) t.setVisible(on);
      if (e !== undefined) {
        const def = this.data.bosses.bosses[e.boss!];
        const look = bossLook(e.boss);
        const b = this.g.boss;
        this.bossName.setText(def?.name ?? e.boss!).setColor(look.css);
        this.bossTag.setText(e.finale === true ? 'FINALE' : e.enraged === true ? 'ENRAGED' : '').setColor(e.finale === true ? '#ffd23f' : look.css);
        const hint = def?.hint ?? '';
        const i = hint.indexOf(':');
        this.bossHint.setText(i >= 0 ? hint.slice(i + 1).trim() : hint).setScale(1);
        if (this.bossHint.width > b.w) this.bossHint.setScale(b.w / this.bossHint.width);
      }
    }
    if (e === undefined) return;
    const b = this.g.boss;
    const look = bossLook(e.boss);
    const frac = Math.max(0, e.hp / e.maxHp);
    this.bossHpShown = frac > this.bossHpShown ? frac : this.bossHpShown + (frac - this.bossHpShown) * Math.min(1, dt / 260);
    const shielded = bossShielded(this.data, e);
    g.fillStyle(0x05070f, 0.8).fillRect(b.x - 3, b.barY - 3, b.w + 6, b.barH + 6);
    g.fillStyle(WHITE, 0.3).fillRect(b.x, b.barY, b.w * this.bossHpShown, b.barH);
    g.fillStyle(shielded ? WHITE : look.color, shielded ? 0.55 + 0.25 * Math.sin(now / 70) : 1).fillRect(b.x, b.barY, b.w * frac, b.barH);
    g.fillStyle(0x05070f, 0.6);
    for (let k = 1; k < 4; k++) g.fillRect(b.x + (b.w * k) / 4 - 1, b.barY, 2, b.barH);
    g.lineStyle(2, shielded ? WHITE : look.color, 0.9).strokeRect(b.x - 1, b.barY - 1, b.w + 2, b.barH + 2);
  }

  /** Cooldown ring (fills clockwise; glows when ready) around the dominant tag's glyph (a plain dot without one). */
  private drawPulse(w: World, now: number): void {
    const charge = pulseCharge(w, this.data);
    const ready = charge >= 1 && !w.dead && w.phase !== 'pick';
    const tag = pulseTag(w, this.data);
    const blink = ready ? Math.round(4 + 4 * Math.sin(now / 180)) : 0;
    const key = `${tag}|${Math.round(charge * 64)}|${ready}|${blink}`;
    if (key === this.pulseKey) return;
    this.pulseKey = key;
    const r = this.g.pulse;
    const cx = r.x + r.w / 2;
    const cy = r.y + r.w * 0.46;
    const R = r.w * 0.34;
    const color = tag ? TAG_COLOR[tag] : CYAN;
    const g = this.pulseBtn.icon.clear();
    g.lineStyle(5, color, 0.18).strokeCircle(cx, cy, R);
    if (ready) g.lineStyle(4 + blink, color, 0.12 + blink * 0.03).strokeCircle(cx, cy, R);
    g.lineStyle(5, color, ready ? 1 : 0.75).beginPath();
    g.arc(cx, cy, R, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * charge, false).strokePath();
    const a = ready ? 1 : 0.4;
    if (tag) drawTagIcon(g, tag, cx, cy, R * 1.05, color, a);
    else g.fillStyle(color, a).fillCircle(cx, cy, R * 0.32);
    this.pulseBtn.label.setAlpha(ready ? 1 : 0.5);
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
    const hp = `${formatNum(Math.ceil(w.core.hp - 1e-6))} / ${formatNum(st.health)}`;
    if (hp !== L.hp) this.hpText.setText((L.hp = hp));
    const bounty = bountyChip(w, this.data);
    if (bounty !== L.bounty) this.bountyText.setText((L.bounty = bounty));
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

    this.drawPulse(w, now);

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
    this.drawBoss(g, w, now, dt); // c1
  }
}

/** "BOUNTY n/12" while the Bounty Marks jackpot is live and under its per-run cap, else ''. */
export function bountyChip(w: World, data: GameData): string {
  const m = fusionMark(w, data);
  if (m === null || m.jackpotEvery <= 0 || w.marks.jackpots >= m.jackpotCap) return '';
  return `BOUNTY ${w.marks.killed % m.jackpotEvery}/${m.jackpotEvery}`;
}

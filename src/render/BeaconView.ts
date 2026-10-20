// c2: draws the Territory Beacon (src/sim/beacon.ts): a pulsing hex ring on the ground at its guarded radius, a mast
// with a blinking light, an HP bar once hurt and one pip per wave to hold; the cells claimed by held beacons get a
// faint outline (redrawn only when the claimed set changes). When the beacon is outside the visible arena (zoom/pan,
// a tall portrait field) an arrow on the arena edge points at it. Reads the World only; one Graphics per layer.

import Phaser from 'phaser';
import type { GameData } from '../sim/data';
import type { World } from '../sim/state';
import { terrainFor } from '../sim/territory';
import { HP_LOW, HP_OK, WHITE } from './palette';
import { DEPTH } from './WorldView';
import type { Layout } from '../ui/layout';

/** The beacon's colour (reclaimed ground). */
export const BEACON_COLOR = HP_OK;
const FLASH_MS = 110;
const SQRT3 = 1.7320508075688772;

/** A pointy-top hexagon path of radius r at (x, y) (the territory grid's orientation). */
function hex(g: Phaser.GameObjects.Graphics, x: number, y: number, r: number): void {
  g.beginPath();
  for (let i = 0; i <= 6; i++) {
    const a = (Math.PI / 3) * i + Math.PI / 6;
    const px = x + Math.cos(a) * r;
    const py = y + Math.sin(a) * r;
    if (i === 0) g.moveTo(px, py);
    else g.lineTo(px, py);
  }
  g.closePath();
}

export class BeaconView {
  private readonly ground: Phaser.GameObjects.Graphics;
  private readonly body: Phaser.GameObjects.Graphics;
  private readonly claimedG: Phaser.GameObjects.Graphics;
  private readonly arrow: Phaser.GameObjects.Graphics;
  private flashUntil = 0;
  private claimedKey = '';

  constructor(
    scene: Phaser.Scene,
    private readonly L: Layout,
    private readonly data: GameData,
  ) {
    this.claimedG = scene.add.graphics().setDepth(DEPTH.grid + 0.5);
    this.ground = scene.add.graphics().setDepth(DEPTH.pulse).setBlendMode(Phaser.BlendModes.ADD);
    this.body = scene.add.graphics().setDepth(DEPTH.turret + 0.2);
    this.arrow = scene.add.graphics().setDepth(DEPTH.bars + 0.5);
  }

  /** A virus hit beacon `sid`. */
  hit(now: number): void {
    this.flashUntil = now + FLASH_MS;
  }

  reset(): void {
    this.flashUntil = 0;
    this.claimedKey = '';
    this.ground.clear();
    this.body.clear();
    this.claimedG.clear();
    this.arrow.clear();
  }

  /** Screen radius of the guarded disc's edge (hex ring `radius` plus half a cell). */
  discRadius(): number {
    const t = this.data.territory;
    return (t.beacon.radius + 0.5) * t.cellSize * SQRT3 * this.L.scale;
  }

  draw(w: World, now: number): void {
    const { cx, cy, scale } = this.L;
    this.drawClaimed(w);
    const g = this.ground.clear();
    const b = this.body.clear();
    const a = this.arrow.clear();
    const def = this.data.territory.beacon;
    const k = Math.max(0.6, scale);
    for (const s of w.structs) {
      if (s.kind !== 'beacon' || s.share <= 0) continue;
      const sx = cx + s.x * scale;
      const sy = cy + s.y * scale;
      const flash = now < this.flashUntil;
      const color = flash ? WHITE : BEACON_COLOR;
      // Ground: the guarded disc edge, a slow breathing ring and the cleansed front.
      const R = this.discRadius();
      const breath = 0.5 + 0.5 * Math.sin(now / 420 + s.id);
      g.lineStyle(Math.max(2, 3 * scale), color, 0.25 + 0.2 * breath);
      hex(g, sx, sy, R);
      g.strokePath();
      const front = ((s.powered + 0.5) / (def.radius + 0.5)) * R;
      g.lineStyle(Math.max(1, 1.5 * scale), color, 0.35);
      hex(g, sx, sy, front);
      g.strokePath();
      const ripple = (now % 1600) / 1600;
      g.lineStyle(Math.max(1, 2 * scale), color, 0.5 * (1 - ripple)).strokeCircle(sx, sy, 6 * k + ripple * R * 0.6);
      // Mast: a base hex, a pole, the light on top.
      const base = 9 * k;
      const top = sy - 30 * k;
      b.fillStyle(0x0a1a22, 0.9);
      hex(b, sx, sy, base);
      b.fillPath();
      b.lineStyle(2, color, 0.95);
      hex(b, sx, sy, base);
      b.strokePath();
      b.lineStyle(Math.max(2, 3 * k), color, 0.95).lineBetween(sx, sy, sx, top);
      b.lineStyle(1.5, color, 0.7).lineBetween(sx - 5 * k, sy - 12 * k, sx, top).lineBetween(sx + 5 * k, sy - 12 * k, sx, top);
      const blink = (now + s.id * 137) % 1000 < 520;
      b.fillStyle(color, blink ? 0.35 : 0.15).fillCircle(sx, top, 9 * k);
      b.fillStyle(blink ? WHITE : color, 1).fillCircle(sx, top, 3.5 * k);
      // Hold pips under the base (filled = waves held).
      const n = def.holdWaves;
      const gap = 9 * k;
      const px0 = sx - ((n - 1) * gap) / 2;
      for (let i = 0; i < n; i++) {
        const held = i < s.streak;
        b.fillStyle(held ? color : 0x0a1a22, held ? 1 : 0.9).fillCircle(px0 + i * gap, sy + base + 7 * k, 3 * k);
        b.lineStyle(1, color, 0.9).strokeCircle(px0 + i * gap, sy + base + 7 * k, 3 * k);
      }
      if (s.share < 1) {
        const bw = 34 * k;
        const by = top - 12 * k;
        b.fillStyle(0x0f1a3a, 0.9).fillRect(sx - bw / 2, by, bw, 4 * k);
        b.fillStyle(s.share < 0.3 ? HP_LOW : color, 1).fillRect(sx - bw / 2, by, bw * s.share, 4 * k);
      }
      this.drawArrow(a, sx, sy, color, now);
    }
  }

  /** Off the visible arena: an arrow on its edge (inset), pointing from the arena centre toward the beacon. */
  private drawArrow(a: Phaser.GameObjects.Graphics, sx: number, sy: number, color: number, now: number): void {
    const r = this.L.arena;
    const m = 18;
    if (sx >= r.x + m && sx <= r.x + r.w - m && sy >= r.y + m && sy <= r.y + r.h - m) return;
    const mx = r.x + r.w / 2;
    const my = r.y + r.h / 2;
    const dx = sx - mx;
    const dy = sy - my;
    const inset = 34;
    const hx = r.w / 2 - inset;
    const hy = r.h / 2 - inset;
    const t = Math.min(hx / Math.max(1e-6, Math.abs(dx)), hy / Math.max(1e-6, Math.abs(dy)));
    const ax = mx + dx * t;
    const ay = my + dy * t;
    const ang = Math.atan2(dy, dx);
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    const bob = 3 * Math.sin(now / 160);
    const tipX = ax + c * (14 + bob);
    const tipY = ay + s * (14 + bob);
    a.fillStyle(color, 0.25).fillCircle(ax, ay, 18);
    a.fillStyle(color, 0.95).fillTriangle(tipX, tipY, ax - s * 10, ay + c * 10, ax + s * 10, ay - c * 10);
    a.lineStyle(2, WHITE, 0.8).strokeCircle(ax, ay, 6);
  }

  /** Claimed cells: a faint outline per cell, redrawn when the set or the view changes. */
  private drawClaimed(w: World): void {
    const ids = w.claimed;
    const { cx, cy, scale } = this.L;
    const key = ids === undefined || ids.length === 0 ? '' : `${ids.length}|${cx}|${cy}|${scale}`;
    if (key === this.claimedKey) return;
    this.claimedKey = key;
    const g = this.claimedG.clear();
    if (ids === undefined || ids.length === 0) return;
    const size = this.data.territory.cellSize;
    g.lineStyle(Math.max(1, 1.5 * scale), BEACON_COLOR, 0.28);
    const grid = terrainFor(this.data);
    for (const id of ids) {
      const x = grid.x[id];
      const y = grid.y[id];
      if (x === undefined || y === undefined) continue;
      hex(g, cx + x * scale, cy + y * scale, size * scale * 0.92);
      g.strokePath();
    }
  }
}

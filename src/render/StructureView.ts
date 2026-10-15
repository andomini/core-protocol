// Draws the firewall structures (spec 2026-10-15): phase 1 is the Ice Wall, one arc per 60° sector on the ring
// at `w.wallR`. A standing segment is icy-bright and warms toward crimson as its HP share drops; a destroyed one
// is a faint dashed ghost. Hits flash the arc; below half HP the arc cracks. Redrawn only when something it shows changed. A wall whose link is broken
// (dormant) is not drawn at all. Reads the World only; the arc of slot i is the sector `sectorOf` gives, because
// both use SECTOR_DIRS.

import Phaser from 'phaser';
import type { GameData } from '../sim/data';
import { SECTOR_DIRS } from '../sim/hex';
import { fusionStructure } from '../sim/perks';
import type { World } from '../sim/state';
import { CRIMSON, TAG_COLOR, WHITE } from './palette';
import { DEPTH, mixColor } from './WorldView';
import type { Layout } from '../ui/layout';

/** Half the sector's angle, less a gap so neighbouring segments read as separate pieces. */
const HALF_SPAN = (30 * Math.PI) / 180 - 0.05;
const FLASH_MS = 110;
/** Shares are compared in 1/64 steps: finer than the eye, so a slow drain does not redraw every tick. */
const SHARE_STEPS = 64;
const SLOTS = 6;

export class StructureView {
  private readonly g: Phaser.GameObjects.Graphics;
  /** Time until which wall slot i flashes from a hit. */
  private readonly flashUntil: number[] = [0, 0, 0, 0, 0, 0];
  /** What the Graphics currently shows: ring, layout, then per slot [state 0 none / 1 standing / 2 down, share steps, flash]. */
  private drawn: number[] = [];
  private next: number[] = [];
  /** The wall fold of the fusions, cached per tick (fusionStructure allocates; the renderer needs it once per tick at most). */
  private foldTick = -1;
  private foldWorld: World | null = null;
  private built = false;

  constructor(
    scene: Phaser.Scene,
    private readonly L: Layout,
    private readonly data: GameData,
  ) {
    this.g = scene.add.graphics().setDepth(DEPTH.wall).setBlendMode(Phaser.BlendModes.ADD);
  }

  /** A virus hit the wall segment `slot`. */
  hit(slot: number, now: number): void {
    if (slot >= 0 && slot < this.flashUntil.length) this.flashUntil[slot] = now + FLASH_MS;
  }

  reset(): void {
    this.flashUntil.fill(0);
    this.drawn = [];
    this.foldWorld = null;
    this.g.clear();
  }

  draw(w: World, now: number): void {
    if (this.foldWorld !== w || this.foldTick !== w.tick) {
      this.foldWorld = w;
      this.foldTick = w.tick;
      this.built = w.structs.length > 0 && w.wallR > 0 && fusionStructure(w, this.data, 'wall') !== undefined;
    }
    const { cx, cy, scale } = this.L;
    const sig = this.next;
    sig.length = 0;
    sig.push(this.built ? w.wallR : 0, scale, cx, cy);
    for (let i = 0; i < SLOTS; i++) sig.push(0, 0, 0);
    if (this.built) {
      for (const s of w.structs) {
        if (s.kind !== 'wall' || s.slot >= SLOTS) continue;
        const k = 4 + 3 * s.slot;
        const up = s.share > 0 && w.tick >= s.downUntilTick;
        sig[k] = up ? 1 : 2;
        sig[k + 1] = up ? Math.ceil(s.share * SHARE_STEPS) : 0;
        sig[k + 2] = now < this.flashUntil[s.slot]! ? 1 : 0;
      }
    }
    if (sig.length === this.drawn.length && sig.every((v, i) => v === this.drawn[i])) return;
    [this.drawn, this.next] = [sig, this.drawn];
    const g = this.g.clear();
    if (!this.built) return;
    const r = w.wallR * scale;
    for (const s of w.structs) {
      if (s.kind !== 'wall' || s.slot >= SLOTS) continue;
      const dir = SECTOR_DIRS[s.slot]!;
      const a = Math.atan2(dir[1], dir[0]);
      const flash = this.drawn[4 + 3 * s.slot + 2] === 1;
      if (this.drawn[4 + 3 * s.slot] === 1) {
        const share = this.drawn[4 + 3 * s.slot + 1]! / SHARE_STEPS;
        const color = flash ? WHITE : mixColor(CRIMSON, TAG_COLOR.cryo, share);
        g.lineStyle(Math.max(3, 7 * scale), color, 0.16 + 0.12 * share).beginPath().arc(cx, cy, r, a - HALF_SPAN, a + HALF_SPAN, false).strokePath();
        g.lineStyle(Math.max(1.5, 2.5 * scale), color, 0.55 + 0.4 * share).beginPath().arc(cx, cy, r, a - HALF_SPAN, a + HALF_SPAN, false).strokePath();
        if (share < 1) {
          // HP bar: a thin arc just inside the segment, as long as the HP that is left.
          g.lineStyle(Math.max(1, 1.5 * scale), color, 0.8).beginPath().arc(cx, cy, r - 6 * scale, a - HALF_SPAN, a - HALF_SPAN + 2 * HALF_SPAN * share, false).strokePath();
        }
        if (share < 0.5) this.cracks(a, r, scale, share < 0.25 ? 3 : 2, color);
      } else {
        // Down: a dashed ghost of the arc.
        const n = 7;
        g.lineStyle(1.5, TAG_COLOR.cryo, flash ? 0.5 : 0.2);
        for (let i = 0; i < n; i += 1) {
          const a0 = a - HALF_SPAN + ((i * 2) / (2 * n - 1)) * 2 * HALF_SPAN;
          g.beginPath().arc(cx, cy, r, a0, a0 + (2 * HALF_SPAN) / (2 * n - 1), false).strokePath();
        }
      }
    }
  }

  /** `n` short cracks across the arc at fixed angles (the same every redraw, so a damaged segment does not shimmer). */
  private cracks(a: number, r: number, scale: number, n: number, color: number): void {
    const len = Math.max(3, 8 * scale);
    for (let i = 0; i < n; i++) {
      const at = a + HALF_SPAN * (((i + 1) * 2) / (n + 1) - 1) * 0.8;
      const [c, s] = [Math.cos(at), Math.sin(at)];
      const skew = i % 2 === 0 ? 0.25 : -0.25;
      this.g
        .lineStyle(Math.max(1, 1.5 * scale), color, 0.9)
        .beginPath()
        .moveTo(this.L.cx + (r - len) * c - len * skew * s, this.L.cy + (r - len) * s + len * skew * c)
        .lineTo(this.L.cx + (r + len) * c, this.L.cy + (r + len) * s)
        .strokePath();
    }
  }
}

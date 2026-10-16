// Draws the firewall structures (spec 2026-10-15): the Ice Wall, one arc per 60° sector on the ring
// at `w.wallR`. A standing segment is icy-bright and warms toward crimson as its HP share drops; a destroyed one
// is a faint dashed ghost. Hits flash the arc; below half HP the arc cracks. Redrawn only when something it shows changed. A wall whose link is broken
// (dormant) is not drawn at all. Reads the World only; the arc of slot i is the sector `sectorOf` gives, because
// both use SECTOR_DIRS. Bastion turrets (yellow hexes with a barrel that turns to the last target) and Minefield
// mines (purple diamonds that pulse slowly and blink fast when a virus is near) are pooled images keyed by id, and
// so are the Relay Stations (green hexagons in a slow orbit ring, an HP bar once hurt; rubble marks while destroyed).

import Phaser from 'phaser';
import type { GameData } from '../sim/data';
import { SECTOR_DIRS } from '../sim/hex';
import { fusionStructure } from '../sim/perks';
import { pauseTicks, waveTicks } from '../sim/economy';
import type { Struct, World } from '../sim/state';
import { CRIMSON, TAG_COLOR, WHITE } from './palette';
import { ImagePool } from './pools';
import { ps } from './resolution';
import { DEPTH, mixColor } from './WorldView';
import type { Layout } from '../ui/layout';

/** Half the sector's angle, less a gap so neighbouring segments read as separate pieces. */
const HALF_SPAN = (30 * Math.PI) / 180 - 0.05;
const FLASH_MS = 110;
/** Shares are compared in 1/64 steps: finer than the eye, so a slow drain does not redraw every tick. */
const SHARE_STEPS = 64;
const SLOTS = 6;
/** A turret brightens (recoil) for this long after a shot. */
const SHOT_MS = 120;
/** A mine blinks fast when a virus is within this many triggers. */
const MINE_ALERT = 2;

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
  /** The folded Bastion turret count and whether a Minefield is built, cached with the wall fold. */
  private turretCount = 0;
  private mineBuilt = false;
  private stationCount = 0;
  private readonly turretPool: ImagePool;
  private readonly minePool: ImagePool;
  private readonly stationPool: ImagePool;
  /** Station HP bars and rubble marks, redrawn each frame while any is shown. */
  private readonly marks: Phaser.GameObjects.Graphics;
  private marksShown = false;
  private readonly stationLive = new Map<number, Phaser.GameObjects.Image>();
  /** Time until which station `id` flashes from a hit. */
  private readonly stationFlash = new Map<number, number>();
  private readonly turretLive = new Map<number, Phaser.GameObjects.Image>();
  private readonly mineLive = new Map<number, Phaser.GameObjects.Image>();
  private readonly stamp = new Map<number, number>();
  private frame = 0;
  /** Per turret id: the angle of its last shot and when it fired. */
  private readonly aim = new Map<number, { angle: number; at: number }>();

  constructor(
    scene: Phaser.Scene,
    private readonly L: Layout,
    private readonly data: GameData,
  ) {
    this.g = scene.add.graphics().setDepth(DEPTH.wall).setBlendMode(Phaser.BlendModes.ADD);
    this.turretPool = new ImagePool(scene, 'st_turret', DEPTH.turret);
    this.minePool = new ImagePool(scene, 'st_mine', DEPTH.mine);
    this.stationPool = new ImagePool(scene, 'st_station', DEPTH.turret);
    this.marks = scene.add.graphics().setDepth(DEPTH.turret + 0.1);
  }

  /** A virus hit station `sid`. */
  hitStation(sid: number, now: number): void {
    this.stationFlash.set(sid, now + FLASH_MS);
  }

  /** Turret `sid` fired toward screen point (tx, ty). */
  shot(sid: number, w: World, tx: number, ty: number, now: number): void {
    const s = w.structs.find((x) => x.id === sid);
    if (s === undefined) return;
    this.aim.set(sid, { angle: Math.atan2(ty - (this.L.cy + s.y * this.L.scale), tx - (this.L.cx + s.x * this.L.scale)), at: now });
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
    for (const img of this.turretLive.values()) this.turretPool.release(img);
    for (const img of this.mineLive.values()) this.minePool.release(img);
    for (const img of this.stationLive.values()) this.stationPool.release(img);
    this.turretLive.clear();
    this.mineLive.clear();
    this.stationLive.clear();
    this.stationFlash.clear();
    this.marks.clear();
    this.marksShown = false;
    this.stamp.clear();
    this.aim.clear();
  }

  draw(w: World, now: number): void {
    if (this.foldWorld !== w || this.foldTick !== w.tick) {
      this.foldWorld = w;
      this.foldTick = w.tick;
      const some = w.structs.length > 0 && w.wallR > 0;
      this.built = some && fusionStructure(w, this.data, 'wall') !== undefined;
      this.turretCount = some ? fusionStructure(w, this.data, 'turret')?.count ?? 0 : 0;
      this.mineBuilt = w.structs.length > 0 && fusionStructure(w, this.data, 'mine') !== undefined;
      this.stationCount = some ? fusionStructure(w, this.data, 'station')?.count ?? 0 : 0;
    }
    this.drawWall(w, now);
    this.drawPieces(w, now);
  }

  /** Turrets, mines and stations: pooled images, positioned every frame (turrets turn and flash, mines pulse, stations orbit). */
  private drawPieces(w: World, now: number): void {
    this.frame += 1;
    const { cx, cy, scale } = this.L;
    const k = ps(scale);
    if (this.marksShown) this.marks.clear();
    this.marksShown = false;
    for (const s of w.structs) {
      if (s.kind === 'station' && s.slot < this.stationCount) {
        const [sx, sy] = [cx + s.x * scale, cy + s.y * scale];
        if (s.share > 0 && w.tick >= s.downUntilTick) {
          let img = this.stationLive.get(s.id);
          if (img === undefined) {
            img = this.stationPool.get();
            this.stationLive.set(s.id, img);
          }
          this.stamp.set(s.id, this.frame);
          const flash = now < (this.stationFlash.get(s.id) ?? 0);
          img.setPosition(sx, sy).setScale(k).setAlpha(0.85).setRotation(now / 2400 + s.id);
          if (flash) img.setTintFill(WHITE);
          else img.setTint(TAG_COLOR.mining);
          if (s.share < 1) this.stationBar(sx, sy, scale, s.share);
        } else {
          // Rebuilding: the station fades back in over its rubble time, with a ring that fills one segment per wave.
          const rb = stationRebuild(w, this.data, s);
          const frac = rb?.frac ?? 0;
          this.rubble(sx, sy, scale);
          let img = this.stationLive.get(s.id);
          if (img === undefined) {
            img = this.stationPool.get();
            this.stationLive.set(s.id, img);
          }
          this.stamp.set(s.id, this.frame);
          img.setPosition(sx, sy).setScale(k * (0.55 + 0.45 * frac)).setAlpha(0.1 + 0.4 * frac).setRotation(s.id).setTint(TAG_COLOR.mining);
          this.rebuildRing(sx, sy, scale, frac, rb?.waves ?? 1);
        }
      } else if (s.kind === 'turret' && s.slot < this.turretCount) {
        let img = this.turretLive.get(s.id);
        if (img === undefined) {
          img = this.turretPool.get().setTint(TAG_COLOR.overload);
          this.turretLive.set(s.id, img);
        }
        this.stamp.set(s.id, this.frame);
        const a = this.aim.get(s.id);
        const flash = a !== undefined && now - a.at < SHOT_MS;
        img.setPosition(cx + s.x * scale, cy + s.y * scale).setScale(k).setAlpha(flash ? 1 : 0.8);
        img.setRotation(a !== undefined ? a.angle : Math.atan2(s.y, s.x));
        if (flash) img.setTintFill(WHITE);
        else img.setTint(TAG_COLOR.overload);
      } else if (s.kind === 'mine' && this.mineBuilt) {
        let img = this.mineLive.get(s.id);
        if (img === undefined) {
          img = this.minePool.get().setTint(TAG_COLOR.chain);
          this.mineLive.set(s.id, img);
        }
        this.stamp.set(s.id, this.frame);
        const alert = this.virusNear(w, s.x, s.y);
        // Dim and slow while quiet; a fast blink when a virus is about to set it off.
        const pulse = alert ? 0.5 + 0.5 * Math.sin(now / 60) : 0.55 + 0.15 * Math.sin(now / 700 + s.id);
        img.setPosition(cx + s.x * scale, cy + s.y * scale).setScale(k).setAlpha(pulse);
      }
    }
    for (const [id, img] of this.turretLive) {
      if (this.stamp.get(id) === this.frame) continue;
      this.turretPool.release(img);
      this.turretLive.delete(id);
      this.stamp.delete(id);
    }
    for (const [id, img] of this.mineLive) {
      if (this.stamp.get(id) === this.frame) continue;
      this.minePool.release(img);
      this.mineLive.delete(id);
      this.stamp.delete(id);
    }
    for (const [id, img] of this.stationLive) {
      if (this.stamp.get(id) === this.frame) continue;
      this.stationPool.release(img);
      this.stationLive.delete(id);
      this.stamp.delete(id);
    }
    if (this.stationFlash.size > 16) for (const id of this.stationFlash.keys()) if (!this.stationLive.has(id)) this.stationFlash.delete(id);
    if (this.aim.size > 16) for (const id of this.aim.keys()) if (!this.turretLive.has(id)) this.aim.delete(id);
  }

  /** A thin HP bar under a hurt station, as long as the HP that is left. */
  private stationBar(x: number, y: number, scale: number, share: number): void {
    const w = Math.max(14, 30 * scale);
    const top = y + 20 * scale;
    this.marksShown = true;
    this.marks.fillStyle(0x000000, 0.5).fillRect(x - w / 2 - 1, top - 1, w + 2, 5);
    this.marks.fillStyle(mixColor(CRIMSON, TAG_COLOR.mining, share), 0.95).fillRect(x - w / 2, top, w * share, 3);
  }

  /** A ring around a rebuilding station: dim track, the part rebuilt so far, and a notch between waves. */
  private rebuildRing(x: number, y: number, scale: number, frac: number, waves: number): void {
    const r = Math.max(9, 22 * scale);
    const top = -Math.PI / 2;
    this.marksShown = true;
    this.marks.lineStyle(2, TAG_COLOR.mining, 0.18).beginPath().arc(x, y, r, 0, Math.PI * 2, false).strokePath();
    if (frac > 0) this.marks.lineStyle(2.5, TAG_COLOR.mining, 0.75).beginPath().arc(x, y, r, top, top + frac * Math.PI * 2, false).strokePath();
    this.marks.lineStyle(2, 0x000000, 0.9);
    for (let i = 0; i < waves; i++) {
      const a = top + (i / waves) * Math.PI * 2;
      const [c, sn] = [Math.cos(a), Math.sin(a)];
      this.marks.beginPath().moveTo(x + c * (r - 3), y + sn * (r - 3)).lineTo(x + c * (r + 3), y + sn * (r + 3)).strokePath();
    }
  }

  /** What is left of a destroyed station: a few dim broken strokes where it stood. */
  private rubble(x: number, y: number, scale: number): void {
    const r = Math.max(5, 11 * scale);
    this.marksShown = true;
    this.marks.lineStyle(1.5, TAG_COLOR.mining, 0.28);
    for (let i = 0; i < 4; i++) {
      const a = 0.7 + i * 1.6;
      const [c, s] = [Math.cos(a), Math.sin(a)];
      this.marks.beginPath().moveTo(x + c * r * 0.4, y + s * r * 0.4).lineTo(x + c * r, y + s * r).strokePath();
    }
  }

  /** A living virus within MINE_ALERT triggers of (x, y). */
  private virusNear(w: World, x: number, y: number): boolean {
    const r = this.data.structures.mine.trigger * MINE_ALERT;
    for (const e of w.enemies) {
      const dx = e.x - x;
      const dy = e.y - y;
      if (e.hp > 0 && dx * dx + dy * dy <= (r + e.radius) * (r + e.radius)) return true;
    }
    return false;
  }

  private drawWall(w: World, now: number): void {
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

/**
 * A destroyed station's rebuild, for display: `frac` of its rubble time gone by, the ladder's `waves`, and `left`, the
 * wave starts until it stands again (it is repaired at a wave start once the rubble time is over). Null if it stands.
 */
export function stationRebuild(w: World, data: GameData, s: Struct): { frac: number; waves: number; left: number } | null {
  if (s.kind !== 'station' || s.share > 0) return null;
  const waves = fusionStructure(w, data, 'station')?.rebuildWaves ?? 1;
  const cycle = waveTicks(data) + pauseTicks(data);
  const remaining = Math.max(0, s.downUntilTick - w.tick);
  const frac = Math.min(1, Math.max(0, 1 - remaining / (waves * cycle)));
  const next = w.phase === 'wave' ? w.tick + Math.max(0, waveTicks(data) - w.phaseTick) + pauseTicks(data) : w.tick + Math.max(0, pauseTicks(data) - w.phaseTick);
  const left = next >= s.downUntilTick ? 1 : 1 + Math.ceil((s.downUntilTick - next) / cycle);
  return { frac, waves, left };
}

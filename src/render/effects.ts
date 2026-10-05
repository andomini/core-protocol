// Render-only juice. Never touches sim state; may use Math.random freely.
// Pixel bursts (Phaser particle emitters, pooled internally), death glitch (offset colour copies, pooled),
// beams / rings / muzzle flares (a fixed pool of transient records drawn into one ADD-blended Graphics).

import Phaser from 'phaser';
import type { EnemyKind } from '../sim/data';
import { CORE, CORE_HIT, CYAN, ENEMY_COLOR, VIOLET, WHITE } from './palette';
import { ImagePool } from './pools';
import { ps } from './resolution';
import { DEPTH } from './WorldView';

const enum T {
  Beam,
  Ring,
  Flare,
}

interface Transient {
  kind: T;
  x: number;
  y: number;
  x2: number;
  y2: number;
  r: number;
  color: number;
  start: number;
  dur: number;
}

interface Glitch {
  a: Phaser.GameObjects.Image;
  b: Phaser.GameObjects.Image;
  slice: Phaser.GameObjects.Image;
  x: number;
  y: number;
  until: number;
}

const MAX_TRANSIENTS = 96;
const MAX_GLITCH = 24;
const GLITCH_MS = 110;

export class Effects {
  private readonly g: Phaser.GameObjects.Graphics;
  private readonly emitters = new Map<number, Phaser.GameObjects.Particles.ParticleEmitter>();
  private readonly sparkEmitter: Phaser.GameObjects.Particles.ParticleEmitter;
  private readonly items: Transient[] = [];
  private live = 0;
  private readonly glitchPool: ImagePool;
  private readonly glitches: Glitch[] = [];
  private readonly flare: Phaser.GameObjects.Image;
  private flareUntil = 0;
  private lastSpark = 0;

  constructor(private readonly scene: Phaser.Scene) {
    this.g = scene.add.graphics().setDepth(DEPTH.fx).setBlendMode(Phaser.BlendModes.ADD);
    for (let i = 0; i < MAX_TRANSIENTS; i++) this.items.push({ kind: T.Ring, x: 0, y: 0, x2: 0, y2: 0, r: 0, color: 0, start: 0, dur: 1 });
    this.glitchPool = new ImagePool(scene, 'e_basic', DEPTH.fx);
    this.sparkEmitter = this.makeEmitter(WHITE, { min: 60, max: 180 }, { min: 120, max: 220 }, 0.5);
    this.flare = scene.add.image(0, 0, 'flare').setDepth(DEPTH.fx).setBlendMode(Phaser.BlendModes.ADD).setVisible(false);
  }

  private makeEmitter(tint: number, speed: { min: number; max: number }, life: { min: number; max: number }, size: number): Phaser.GameObjects.Particles.ParticleEmitter {
    return this.scene.add
      .particles(0, 0, 'px', {
        speed,
        lifespan: life,
        scale: { start: ps(size), end: ps(size * 0.3) },
        alpha: { start: 1, end: 0 },
        rotate: { min: 0, max: 90 },
        tint,
        blendMode: Phaser.BlendModes.ADD,
        emitting: false,
        maxAliveParticles: 900,
      })
      .setDepth(DEPTH.fx);
  }

  private emitter(color: number): Phaser.GameObjects.Particles.ParticleEmitter {
    let em = this.emitters.get(color);
    if (!em) {
      em = this.makeEmitter(color, { min: 50, max: 240 }, { min: 280, max: 640 }, 1.1);
      this.emitters.set(color, em);
    }
    return em;
  }

  private push(kind: T, x: number, y: number, x2: number, y2: number, r: number, color: number, dur: number): void {
    if (this.live >= MAX_TRANSIENTS) return;
    const it = this.items[this.live++]!;
    it.kind = kind;
    it.x = x;
    it.y = y;
    it.x2 = x2;
    it.y2 = y2;
    it.r = r;
    it.color = color;
    it.start = this.scene.time.now;
    it.dur = dur;
  }

  /** Death: pixel scatter + a short RGB-split glitch of the enemy's shape + a thin shock ring. */
  death(kind: EnemyKind, texture: string, x: number, y: number, rot: number, scale: number, boss: boolean): void {
    const color = ENEMY_COLOR[kind];
    this.emitter(color).explode(boss ? 70 : kind === 'tank' ? 22 : 12, x, y);
    this.sparkEmitter.explode(boss ? 20 : 4, x, y);
    this.push(T.Ring, x, y, 0, 0, boss ? 120 : 34 * scale, color, boss ? 520 : 260);
    if (this.glitches.length >= MAX_GLITCH) return;
    const now = this.scene.time.now;
    const k = ps(scale);
    const a = this.glitchPool.get(texture).setTint(0x00f0ff).setRotation(rot).setScale(k).setAlpha(0.85);
    const b = this.glitchPool.get(texture).setTint(0xff1050).setRotation(rot).setScale(k).setAlpha(0.85);
    const slice = this.glitchPool.get('px').setTint(color).setAlpha(0.9);
    this.glitches.push({ a, b, slice, x, y, until: now + (boss ? GLITCH_MS * 3 : GLITCH_MS) });
  }

  /** Small spark where a projectile lands (throttled under heavy fire). */
  hit(x: number, y: number): void {
    const now = this.scene.time.now;
    if (now - this.lastSpark < 30) return;
    this.lastSpark = now;
    this.sparkEmitter.explode(3, x, y);
  }

  /** Ranged virus beam: thin violet line from the shooter to the core rim. */
  beam(fromX: number, fromY: number, toX: number, toY: number, coreR: number): void {
    const dx = fromX - toX;
    const dy = fromY - toY;
    const d = Math.hypot(dx, dy) || 1;
    const ex = toX + (dx / d) * coreR;
    const ey = toY + (dy / d) * coreR;
    this.push(T.Beam, fromX, fromY, ex, ey, 0, VIOLET, 160);
    this.emitter(VIOLET).explode(5, ex, ey);
  }

  /** Red pulse on the core rim when it takes a hit. */
  coreHit(x: number, y: number, coreR: number, heavy: boolean): void {
    this.push(T.Ring, x, y, 0, 0, coreR * (heavy ? 2.6 : 1.7), CORE_HIT, heavy ? 360 : 220);
  }

  /** Muzzle flare on the core rim toward the target. */
  muzzle(cx: number, cy: number, tx: number, ty: number, coreR: number): void {
    const d = Math.hypot(tx - cx, ty - cy) || 1;
    this.flare.setPosition(cx + ((tx - cx) / d) * coreR * 1.1, cy + ((ty - cy) / d) * coreR * 1.1).setVisible(true).setScale(ps(0.7)).setRotation(Math.random());
    this.flareUntil = this.scene.time.now + 60;
  }

  /** Big core breach: rings, sparks and cyan pixels. */
  coreBreach(x: number, y: number, coreR: number): void {
    this.emitter(CORE).explode(90, x, y);
    this.emitter(CORE_HIT).explode(50, x, y);
    this.push(T.Ring, x, y, 0, 0, coreR * 6, CORE, 700);
    this.push(T.Ring, x, y, 0, 0, coreR * 3.5, CORE_HIT, 500);
  }

  waveRing(x: number, y: number, r: number, color = CYAN): void {
    this.push(T.Ring, x, y, 0, 0, r, color, 700);
  }

  reset(): void {
    this.live = 0;
    for (const gl of this.glitches) this.releaseGlitch(gl);
    this.glitches.length = 0;
    for (const em of this.emitters.values()) em.killAll();
    this.sparkEmitter.killAll();
    this.g.clear();
  }

  private releaseGlitch(gl: Glitch): void {
    this.glitchPool.release(gl.a);
    this.glitchPool.release(gl.b);
    this.glitchPool.release(gl.slice);
  }

  update(): void {
    const now = this.scene.time.now;
    this.flare.setVisible(now < this.flareUntil);
    // Glitch copies jitter every frame for ~100 ms.
    for (let i = this.glitches.length - 1; i >= 0; i--) {
      const gl = this.glitches[i]!;
      if (now >= gl.until) {
        this.releaseGlitch(gl);
        this.glitches[i] = this.glitches[this.glitches.length - 1]!;
        this.glitches.pop();
        continue;
      }
      const j = 3 + Math.random() * 6;
      gl.a.setPosition(gl.x - j, gl.y + (Math.random() - 0.5) * 3);
      gl.b.setPosition(gl.x + j, gl.y + (Math.random() - 0.5) * 3);
      gl.slice.setPosition(gl.x + (Math.random() - 0.5) * 10, gl.y + (Math.random() - 0.5) * 16).setScale(ps(2.4 + Math.random() * 3), ps(0.25));
    }
    const g = this.g.clear();
    let n = 0;
    for (let i = 0; i < this.live; i++) {
      const it = this.items[i]!;
      const t = (now - it.start) / it.dur;
      if (t >= 1) continue;
      const k = Math.max(0, t);
      switch (it.kind) {
        case T.Beam:
          g.lineStyle(6, it.color, 0.35 * (1 - k)).lineBetween(it.x, it.y, it.x2, it.y2);
          g.lineStyle(2, WHITE, 0.9 * (1 - k)).lineBetween(it.x, it.y, it.x2, it.y2);
          break;
        case T.Ring: {
          const e = 1 - (1 - k) * (1 - k);
          g.lineStyle(3 * (1 - k) + 0.5, it.color, 0.9 * (1 - k)).strokeCircle(it.x, it.y, it.r * (0.35 + 0.65 * e));
          break;
        }
        case T.Flare:
          break;
      }
      // Compact live records to the front.
      if (n !== i) {
        const tmp = this.items[n]!;
        this.items[n] = it;
        this.items[i] = tmp;
      }
      n++;
    }
    this.live = n;
  }
}

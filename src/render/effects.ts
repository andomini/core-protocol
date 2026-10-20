// Render-only juice. Never touches sim state; may use Math.random freely.
// Pixel bursts (Phaser particle emitters, pooled internally), virus deaths (the body swells and dissolves while 3–5 shell
// fragments fly apart, pooled images), beams / rings / muzzle flares (a fixed pool of transient records drawn into one
// ADD-blended Graphics).

import Phaser from 'phaser';
import { DEFAULT_DATA, type EnemyKind } from '../sim/data';
import { CORE, CORE_HIT, CYAN, ENEMY_ACCENT, ENEMY_COLOR, WHITE } from './palette';
import { ImagePool } from './pools';
import { ps } from './resolution';
import { easeOut, type Frag, fragBudget, fragments } from './virusShapes';
import { DEPTH } from './WorldView';

const enum T {
  Beam,
  Ring,
  Arc,
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

/** A pooled image flying out of a death: a dissolving body copy or a shell fragment. */
interface Piece {
  img: Phaser.GameObjects.Image;
  pool: ImagePool;
  x: number;
  y: number;
  dx: number;
  dy: number;
  rot: number;
  spin: number;
  s0: number;
  s1: number;
  a0: number;
  /** Fragments hold their alpha and fade late; the body copy fades linearly. */
  hold: boolean;
  start: number;
  dur: number;
}

const MAX_TRANSIENTS = 96;
/** Live death pieces at most (a burst past it keeps only its particles and ring). */
export const MAX_PIECES = 160;
const POP_MS = 200;
const FRAG_MS = 430;
/** Fragment size relative to the body, per kind (the frag textures are ~10 px shards at scale 1). */
const FRAG_SIZE: Readonly<Record<EnemyKind, number>> = { basic: 0.95, fast: 0.75, tank: 1.3, ranged: 0.9, boss: 1.9 };

export class Effects {
  private readonly g: Phaser.GameObjects.Graphics;
  private readonly emitters = new Map<number, Phaser.GameObjects.Particles.ParticleEmitter>();
  private readonly sparkEmitter: Phaser.GameObjects.Particles.ParticleEmitter;
  private readonly items: Transient[] = [];
  private live = 0;
  private readonly bodyPool: ImagePool;
  private readonly fragPool: ImagePool;
  private readonly pieces: Piece[] = [];
  private readonly plan: Frag[] = [];
  private readonly flare: Phaser.GameObjects.Image;
  private flareUntil = 0;
  private lastSpark = 0;

  constructor(private readonly scene: Phaser.Scene) {
    this.g = scene.add.graphics().setDepth(DEPTH.fx).setBlendMode(Phaser.BlendModes.ADD);
    for (let i = 0; i < MAX_TRANSIENTS; i++) this.items.push({ kind: T.Ring, x: 0, y: 0, x2: 0, y2: 0, r: 0, color: 0, start: 0, dur: 1 });
    this.bodyPool = new ImagePool(scene, 'e_basic', DEPTH.fx);
    this.fragPool = new ImagePool(scene, 'frag_0', DEPTH.fx);
    this.bodyPool.prewarm(16);
    this.fragPool.prewarm(48);
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

  /**
   * Death: the capsid bursts — the body swells and dissolves, 3–5 shell fragments (10 for the boss) fly apart and spin
   * out, a few pixels and a thin shock ring. `scale` is the body's layout scale (layout scale × ENEMY_VIS).
   */
  death(kind: EnemyKind, texture: string, x: number, y: number, rot: number, scale: number, boss: boolean): void {
    const color = ENEMY_COLOR[kind];
    this.emitter(color).explode(boss ? 40 : kind === 'tank' ? 12 : 6, x, y);
    this.sparkEmitter.explode(boss ? 16 : 3, x, y);
    this.push(T.Ring, x, y, 0, 0, boss ? 120 : 34 * scale, color, boss ? 520 : 260);
    const now = this.scene.time.now;
    const k = ps(scale);
    const r = DEFAULT_DATA.enemies[kind].radius * scale;
    if (this.pieces.length < MAX_PIECES) {
      this.piece(this.bodyPool, texture, 0xffffff, x, y, 0, 0, rot, 0, k, k * (boss ? 1.7 : 1.5), 0.9, false, now, boss ? POP_MS * 2.5 : POP_MS);
      if (boss && this.pieces.length < MAX_PIECES) this.piece(this.bodyPool, 'e_boss_membrane', color, x, y, 0, 0, rot, 0, k, k * 2, 0.8, false, now, POP_MS * 3);
    }
    const n = fragBudget(this.pieces.length, MAX_PIECES, fragments(kind, rot, Math.random, this.plan));
    const fk = k * FRAG_SIZE[kind];
    for (let i = 0; i < n; i++) {
      const f = this.plan[i]!;
      const c = Math.cos(f.angle);
      const d = Math.sin(f.angle);
      const s0 = fk * f.size;
      this.piece(this.fragPool, `frag_${f.variant}`, i === 0 ? ENEMY_ACCENT[kind] : color, x + c * r * 0.5, y + d * r * 0.5, c * r * f.dist, d * r * f.dist, f.angle, f.spin, s0, s0 * 0.55, 1, true, now, FRAG_MS * (boss ? 1.6 : 0.85 + Math.random() * 0.3));
    }
  }

  private piece(pool: ImagePool, tex: string, tint: number, x: number, y: number, dx: number, dy: number, rot: number, spin: number, s0: number, s1: number, a0: number, hold: boolean, start: number, dur: number): void {
    const img = pool.get(tex).setPosition(x, y).setRotation(rot).setScale(s0).setAlpha(a0);
    if (tint !== 0xffffff) img.setTint(tint);
    this.pieces.push({ img, pool, x, y, dx, dy, rot, spin, s0, s1, a0, hold, start, dur });
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
    this.push(T.Beam, fromX, fromY, ex, ey, 0, ENEMY_COLOR.ranged, 160);
    this.emitter(ENEMY_COLOR.ranged).explode(5, ex, ey);
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

  /** 🔗 lightning: a jagged white-violet bolt between two points (redrawn with fresh jitter each frame). */
  arc(x: number, y: number, x2: number, y2: number, color: number): void {
    this.push(T.Arc, x, y, x2, y2, 0, color, 170);
    this.sparkEmitter.explode(2, x2, y2);
  }

  /** 🔗 bounce: a short tracer streak from the hit enemy to the next target. */
  bounce(x: number, y: number, x2: number, y2: number, color: number): void {
    this.push(T.Beam, x, y, x2, y2, 0, color, 110);
  }

  /** A filled flash ring (set activation, Overdrive): `r` is the final radius. */
  pulse(x: number, y: number, r: number, color: number): void {
    this.push(T.Ring, x, y, 0, 0, r, color, 900);
    this.push(T.Ring, x, y, 0, 0, r * 0.6, WHITE, 500);
    this.emitter(color).explode(40, x, y);
  }

  waveRing(x: number, y: number, r: number, color = CYAN): void {
    this.push(T.Ring, x, y, 0, 0, r, color, 700);
  }

  reset(): void {
    this.live = 0;
    for (const p of this.pieces) p.pool.release(p.img);
    this.pieces.length = 0;
    for (const em of this.emitters.values()) em.killAll();
    this.sparkEmitter.killAll();
    this.g.clear();
  }

  update(): void {
    const now = this.scene.time.now;
    this.flare.setVisible(now < this.flareUntil);
    for (let i = this.pieces.length - 1; i >= 0; i--) {
      const p = this.pieces[i]!;
      const t = (now - p.start) / p.dur;
      if (t >= 1) {
        p.pool.release(p.img);
        this.pieces[i] = this.pieces[this.pieces.length - 1]!;
        this.pieces.pop();
        continue;
      }
      const e = easeOut(t);
      p.img
        .setPosition(p.x + p.dx * e, p.y + p.dy * e)
        .setRotation(p.rot + p.spin * t)
        .setScale(p.s0 + (p.s1 - p.s0) * e)
        .setAlpha(p.a0 * (p.hold ? 1 - t * t * t : 1 - t));
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
        case T.Arc: {
          // Jagged polyline with 6 segments; jitter perpendicular to the bolt.
          const dx = it.x2 - it.x;
          const dy = it.y2 - it.y;
          const len = Math.hypot(dx, dy) || 1;
          const nx = -dy / len;
          const ny = dx / len;
          const amp = Math.min(18, len * 0.12);
          for (const [lw, col, a] of [[7, it.color, 0.35], [2.5, WHITE, 0.95]] as const) {
            g.lineStyle(lw, col, a * (1 - k));
            g.beginPath();
            g.moveTo(it.x, it.y);
            for (let s2 = 1; s2 < 6; s2++) {
              const f = s2 / 6;
              const j = (Math.random() - 0.5) * 2 * amp;
              g.lineTo(it.x + dx * f + nx * j, it.y + dy * f + ny * j);
            }
            g.lineTo(it.x2, it.y2);
            g.strokePath();
          }
          break;
        }
        case T.Ring: {
          const e = 1 - (1 - k) * (1 - k);
          g.lineStyle(3 * (1 - k) + 0.5, it.color, 0.9 * (1 - k)).strokeCircle(it.x, it.y, it.r * (0.35 + 0.65 * e));
          break;
        }
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

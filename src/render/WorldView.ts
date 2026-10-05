// Draws the World in the neon style: faint grid with data pulses, glowing hex core with a dashed range
// ring, viruses by kind (squares, triangles, rhombi, a segmented boss worm), tracers, HP bars.
// Reads the World only. Positions are interpolated between ticks with RunSession.prevOf().

import Phaser from 'phaser';
import type { EnemyKind } from '../sim/data';
import type { Enemy } from '../sim/state';
import type { Layout } from '../ui/layout';
import { CORE, CORE_HIT, CRIMSON, ENEMY_COLOR, FROZEN_TINT, GRID_MAJOR, SLOW_TINT, TRACER } from './palette';
import { ImagePool } from './pools';
import { ps, RS } from './resolution';
import type { RunSession } from './RunSession';
import { GRID_TILE, TRACER_LEN } from './textures';

export const DEPTH = {
  grid: 1, light: 2, pulse: 3, range: 4, boss: 5, enemy: 6, projectile: 7, core: 8, fx: 9, bars: 10,
  vignette: 11, scan: 12, hud: 20, overlay: 40,
} as const;

const TEX: Record<Exclude<EnemyKind, 'boss'>, string> = { basic: 'e_basic', fast: 'e_fast', tank: 'e_tank', ranged: 'e_ranged' };
const SPAWN_FADE_MS = 260;
/** Enemies and the core are drawn a bit larger than their sim radius so they read on phones. */
export const ENEMY_VIS = 1.2;
const CORE_VIS = 1.15;
const FLASH_MS = 70;
const BOSS_SEGMENTS = 6;
/** Segment size relative to the head, tail last. */
const SEG_SCALE = [0.86, 0.78, 0.7, 0.62, 0.54, 0.46];
const TRAIL_CAP = 96;
const PULSES = 10;

interface BossBody {
  segs: Phaser.GameObjects.Image[];
  /** Ring buffer of head positions (world px), newest at `head`. */
  tx: Float64Array;
  ty: Float64Array;
  head: number;
  count: number;
  phase: number;
}

interface Sprite {
  img: Phaser.GameObjects.Image;
  kind: EnemyKind;
  bornAt: number;
  flashUntil: number;
  /** 0 none, 1 hit flash, 2 frozen, 3 slowed. */
  look: number;
  stamp: number;
  spin: number;
  boss: BossBody | null;
}

interface Pulse {
  img: Phaser.GameObjects.Image;
  horizontal: boolean;
  line: number;
  pos: number;
  speed: number;
}

export class WorldView {
  private readonly enemies = new Map<number, Sprite>();
  private readonly spritePool: Sprite[] = [];
  private readonly enemyImgs: ImagePool;
  private readonly bossImgs: ImagePool;
  private readonly tracers: ImagePool;
  private readonly tracerLive = new Map<number, Phaser.GameObjects.Image>();
  private readonly tracerStamp = new Map<number, number>();
  private readonly bars: Phaser.GameObjects.Graphics;
  /** Glowing spine linking the boss worm's segments. */
  private readonly spine: Phaser.GameObjects.Graphics;
  private readonly bossLabel: Phaser.GameObjects.Text;
  private readonly coreLight: Phaser.GameObjects.Image;
  private readonly coreOuter: Phaser.GameObjects.Image;
  private readonly coreInner: Phaser.GameObjects.Image;
  private readonly coreRing: Phaser.GameObjects.Image;
  private readonly orbiters: Phaser.GameObjects.Image[] = [];
  private readonly pulses: Pulse[] = [];
  private readonly range: Phaser.GameObjects.Graphics;
  private frame = 0;
  private coreFlashUntil = 0;
  private coreShakeUntil = 0;
  private lastNow = 0;
  /** Screen position of the core this frame (shake included). */
  coreX: number;
  coreY: number;

  constructor(
    scene: Phaser.Scene,
    private readonly L: Layout,
    private readonly session: () => RunSession,
  ) {
    const a = L.arena;
    this.coreX = L.cx;
    this.coreY = L.cy;
    // Grid aligned so a major line crosses the core; it spills under the HUD/panel, which are opaque.
    const x0 = L.cx - Math.ceil((L.cx - a.x) / GRID_TILE) * GRID_TILE;
    const y0 = L.cy - Math.ceil((L.cy - a.y) / GRID_TILE) * GRID_TILE;
    scene.add
      .tileSprite(x0, y0, a.x + a.w - x0 + GRID_TILE, a.y + a.h - y0 + GRID_TILE, 'grid')
      .setOrigin(0)
      .setTileScale(1 / RS)
      .setDepth(DEPTH.grid);
    this.coreLight = scene.add.image(L.cx, L.cy, 'core_light').setScale(ps(1.6)).setDepth(DEPTH.light).setBlendMode(Phaser.BlendModes.ADD);
    for (let i = 0; i < PULSES; i++) {
      const img = scene.add.image(0, 0, 'tracer').setDepth(DEPTH.pulse).setBlendMode(Phaser.BlendModes.ADD).setTint(GRID_MAJOR);
      const p: Pulse = { img, horizontal: true, line: 0, pos: 0, speed: 0 };
      this.resetPulse(p, true);
      this.pulses.push(p);
    }
    scene.add.image(a.x + a.w / 2, a.y + a.h / 2, 'vignette').setDisplaySize(a.w, a.h).setDepth(DEPTH.vignette);
    scene.add.tileSprite(a.x, a.y, a.w, a.h, 'scan').setOrigin(0).setTileScale(1 / RS).setDepth(DEPTH.scan).setAlpha(0.6);

    this.range = scene.add.graphics().setDepth(DEPTH.range).setBlendMode(Phaser.BlendModes.ADD);
    this.drawRange();
    for (let i = 0; i < 2; i++) {
      this.orbiters.push(scene.add.image(0, 0, 'glow').setScale(ps(0.22)).setTint(CORE).setDepth(DEPTH.range).setBlendMode(Phaser.BlendModes.ADD));
    }
    this.coreRing = scene.add.image(L.cx, L.cy, 'core_ring').setScale(ps(L.scale * CORE_VIS)).setDepth(DEPTH.core).setBlendMode(Phaser.BlendModes.ADD);
    this.coreOuter = scene.add.image(L.cx, L.cy, 'core_outer').setScale(ps(L.scale)).setDepth(DEPTH.core).setBlendMode(Phaser.BlendModes.ADD);
    this.coreInner = scene.add.image(L.cx, L.cy, 'core_inner').setScale(ps(L.scale)).setDepth(DEPTH.core).setBlendMode(Phaser.BlendModes.ADD);

    // Viruses use normal blending: their glow is baked in, and ADD would blow dense piles out to white.
    this.enemyImgs = new ImagePool(scene, 'e_basic', DEPTH.enemy, Phaser.BlendModes.NORMAL);
    this.bossImgs = new ImagePool(scene, 'e_boss_seg', DEPTH.boss, Phaser.BlendModes.NORMAL);
    this.tracers = new ImagePool(scene, 'tracer', DEPTH.projectile);
    this.bars = scene.add.graphics().setDepth(DEPTH.bars);
    this.spine = scene.add.graphics().setDepth(DEPTH.boss - 0.5).setBlendMode(Phaser.BlendModes.ADD);
    this.drawBrackets(scene);
    this.bossLabel = scene.add
      .text(0, 0, 'WORM.EXE', { fontFamily: '"Orbitron", monospace', fontSize: `${L.minFont}px`, fontStyle: '700', color: '#ff6b8b', resolution: RS })
      .setOrigin(0.5, 1)
      .setDepth(DEPTH.bars)
      .setVisible(false);
  }

  private drawRange(): void {
    const g = this.range.clear();
    this.rangeDrawn = this.session().stats.range;
    const r = this.rangeDrawn * this.L.scale;
    const { cx, cy } = this.L;
    g.fillStyle(CORE, 0.025).fillCircle(cx, cy, r);
    const dash = 10;
    const gap = 9;
    const n = Math.floor((Math.PI * 2 * r) / (dash + gap));
    g.lineStyle(2, CORE, 0.32);
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2;
      g.beginPath();
      g.arc(cx, cy, r, a0, a0 + dash / r, false);
      g.strokePath();
    }
    g.lineStyle(1, CORE, 0.1).strokeCircle(cx, cy, r * 0.5);
  }

  private resetPulse(p: Pulse, anywhere: boolean): void {
    const a = this.L.arena;
    p.horizontal = Math.random() < 0.5;
    const span = p.horizontal ? a.h : a.w;
    const origin = p.horizontal ? this.L.cy : this.L.cx;
    const k = Math.floor(span / GRID_TILE / 2) + 1;
    p.line = origin + (Math.floor(Math.random() * (2 * k + 1)) - k) * GRID_TILE;
    p.speed = (80 + Math.random() * 160) * (Math.random() < 0.5 ? -1 : 1);
    const len = p.horizontal ? a.w : a.h;
    const start = p.horizontal ? a.x : a.y;
    p.pos = anywhere ? start + Math.random() * len : p.speed > 0 ? start - 40 : start + len + 40;
    p.img.setRotation(p.horizontal ? (p.speed > 0 ? 0 : Math.PI) : p.speed > 0 ? Math.PI / 2 : -Math.PI / 2);
    p.img.setAlpha(0.25 + Math.random() * 0.35).setScale(ps(0.6 + Math.random() * 0.8), ps(0.7));
  }

  /** Drops every sprite (a new run restarts entity ids). */
  reset(): void {
    for (const id of [...this.enemies.keys()]) this.drop(id);
    for (const [id, img] of this.tracerLive) {
      this.tracers.release(img);
      this.tracerLive.delete(id);
    }
    this.tracerStamp.clear();
    this.coreFlashUntil = 0;
    this.coreShakeUntil = 0;
    this.drawRange();
  }

  flash(id: number, now: number): void {
    const s = this.enemies.get(id);
    if (s) s.flashUntil = now + FLASH_MS;
  }

  coreHit(now: number, heavy: boolean): void {
    this.coreFlashUntil = now + (heavy ? 160 : 90);
    this.coreShakeUntil = now + (heavy ? 260 : 140);
  }

  /** Interpolated world position of a live enemy (render space), or its last known position. */
  enemyScreen(e: Enemy, alpha: number, out: { x: number; y: number }): void {
    const p = this.session().prevOf(e.id);
    const x = p ? p.x + (e.x - p.x) * alpha : e.x;
    const y = p ? p.y + (e.y - p.y) * alpha : e.y;
    out.x = this.L.cx + x * this.L.scale;
    out.y = this.L.cy + y * this.L.scale;
  }

  private readonly tmp = { x: 0, y: 0 };
  private rangeDrawn = 0;

  draw(alpha: number, now: number): void {
    const dt = this.lastNow === 0 ? 16 : Math.min(100, now - this.lastNow);
    this.lastNow = now;
    this.frame++;
    const L = this.L;
    const sess = this.session();
    const w = sess.world;
    if (sess.stats.range !== this.rangeDrawn) this.drawRange();
    this.drawCore(w.core.hp / sess.stats.health, now, w.dead);
    this.spine.clear();
    this.drawPulses(dt);

    const bars = this.bars.clear();
    this.bossLabel.setVisible(false);
    const tmp = this.tmp;
    for (const e of w.enemies) {
      let s = this.enemies.get(e.id);
      if (!s) s = this.add(e, now);
      s.stamp = this.frame;
      this.enemyScreen(e, alpha, tmp);
      const sx = tmp.x;
      const sy = tmp.y;
      const toCore = Math.atan2(L.cy - sy, L.cx - sx);
      const fade = Math.min(1, (now - s.bornAt) / SPAWN_FADE_MS);
      const pop = 1 + (1 - fade) * 0.7;
      const k = ps(L.scale * ENEMY_VIS) * pop;
      const img = s.img;
      img.setPosition(sx, sy).setAlpha(fade);
      switch (s.kind) {
        case 'basic':
          img.setRotation(now * 0.0012 * s.spin).setScale(k);
          break;
        case 'fast':
          img.setRotation(toCore).setScale(k);
          break;
        case 'tank':
          img.setRotation(now * 0.0004 * s.spin).setScale(k * (1 + 0.04 * Math.sin(now / 180 + e.id)));
          break;
        case 'ranged':
          img.setRotation(toCore + Math.sin(now / 300 + e.id) * 0.25).setScale(k);
          break;
        case 'boss':
          this.drawBoss(s, e, sx, sy, toCore, dt, k, fade);
          break;
      }
      // Tint state: hit flash > frozen (icy fill) > slowed (cold tint) > none.
      const look = now < s.flashUntil ? 1 : e.frozenUntil > w.tick ? 2 : e.slowUntil > w.tick && e.slow > 0 ? 3 : 0;
      if (look !== s.look) {
        s.look = look;
        if (look === 1) img.setTintFill(0xffffff);
        else if (look === 2) img.setTintFill(FROZEN_TINT);
        else if (look === 3) img.setTint(SLOW_TINT);
        else img.clearTint();
      }
      const r = e.radius * L.scale * ENEMY_VIS;
      if (s.kind === 'boss') {
        const bw = Math.max(120, r * 3.2);
        const by = sy - r - 26;
        bars.fillStyle(0x1a0610, 0.9).fillRect(sx - bw / 2 - 2, by - 2, bw + 4, 10);
        bars.fillStyle(CRIMSON, 1).fillRect(sx - bw / 2, by, bw * Math.max(0, e.hp / e.maxHp), 6);
        bars.fillStyle(0xffffff, 0.5).fillRect(sx - bw / 2, by, bw * Math.max(0, e.hp / e.maxHp), 1.5);
        const half = this.bossLabel.width / 2 + 8;
        const lx = Math.max(L.arena.x + half, Math.min(L.arena.x + L.arena.w - half, sx));
        this.bossLabel.setPosition(lx, by - 6).setVisible(true).setAlpha(fade);
      } else if (e.hp < e.maxHp) {
        const bw = r * 2 + 4;
        const by = sy - r - 9;
        bars.fillStyle(0x05070f, 0.85).fillRect(sx - bw / 2 - 1, by - 1, bw + 2, 5);
        bars.fillStyle(ENEMY_COLOR[s.kind], 1).fillRect(sx - bw / 2, by, bw * Math.max(0, e.hp / e.maxHp), 3);
      }
    }
    for (const [id, s] of this.enemies) if (s.stamp !== this.frame) this.drop(id);

    // Tracers: rotated along the last tick's motion, head on the projectile.
    for (const p of w.projectiles) {
      let img = this.tracerLive.get(p.id);
      if (!img) {
        img = this.tracers.get();
        img.setOrigin((TRACER_LEN + 14) / (TRACER_LEN + 28), 0.5).setTint(TRACER);
        this.tracerLive.set(p.id, img);
      }
      this.tracerStamp.set(p.id, this.frame);
      const prev = sess.prevOf(p.id);
      const px = prev ? prev.x : 0;
      const py = prev ? prev.y : 0;
      const x = px + (p.x - px) * alpha;
      const y = py + (p.y - py) * alpha;
      img.setPosition(L.cx + x * L.scale, L.cy + y * L.scale).setRotation(Math.atan2(p.y - py, p.x - px)).setScale(ps(L.scale));
    }
    for (const [id, img] of this.tracerLive) {
      if (this.tracerStamp.get(id) === this.frame) continue;
      this.tracers.release(img);
      this.tracerLive.delete(id);
      this.tracerStamp.delete(id);
    }
  }

  private add(e: Enemy, now: number): Sprite {
    const s = this.spritePool.pop() ?? { img: null!, kind: e.kind, bornAt: 0, flashUntil: 0, look: 0, stamp: 0, spin: 1, boss: null };
    s.kind = e.kind;
    s.bornAt = now;
    s.flashUntil = 0;
    s.look = 0;
    s.spin = e.id % 2 === 0 ? 1 : -1;
    if (e.kind === 'boss') {
      s.img = this.bossImgs.get('e_boss_head');
      s.img.setDepth(DEPTH.boss + 0.5);
      s.boss = this.makeBoss(e);
    } else {
      s.img = this.enemyImgs.get(TEX[e.kind]);
      s.boss = null;
    }
    this.enemies.set(e.id, s);
    return s;
  }

  private drop(id: number): void {
    const s = this.enemies.get(id)!;
    if (s.boss) {
      this.bossImgs.release(s.img);
      for (const seg of s.boss.segs) this.bossImgs.release(seg);
    } else {
      this.enemyImgs.release(s.img);
    }
    this.enemies.delete(id);
    this.spritePool.push(s);
  }

  private makeBoss(e: Enemy): BossBody {
    const segs: Phaser.GameObjects.Image[] = [];
    for (let i = 0; i < BOSS_SEGMENTS; i++) segs.push(this.bossImgs.get('e_boss_seg').setDepth(DEPTH.boss - i * 0.01));
    const body: BossBody = { segs, tx: new Float64Array(TRAIL_CAP), ty: new Float64Array(TRAIL_CAP), head: 0, count: 0, phase: 0 };
    // Seed the trail outward from the head so the worm enters fully formed.
    const d = Math.hypot(e.x, e.y) || 1;
    const ux = e.x / d;
    const uy = e.y / d;
    const span = this.segSpacing(e) * (BOSS_SEGMENTS + 1);
    for (let i = 24; i >= 0; i--) this.pushTrail(body, e.x + ux * (span * i) / 24, e.y + uy * (span * i) / 24);
    return body;
  }

  private segSpacing(e: Enemy): number {
    return e.radius * 1.75;
  }

  private pushTrail(b: BossBody, x: number, y: number): void {
    b.head = (b.head + 1) % TRAIL_CAP;
    b.tx[b.head] = x;
    b.ty[b.head] = y;
    b.count = Math.min(TRAIL_CAP, b.count + 1);
  }

  private drawBoss(s: Sprite, e: Enemy, sx: number, sy: number, toCore: number, dt: number, k: number, fade: number): void {
    const b = s.boss!;
    const L = this.L;
    const stop = L.scale * (e.radius + 40);
    const moving = Math.hypot(sx - L.cx, sy - L.cy) > stop;
    if (moving) b.phase += dt / 1000;
    // Lateral wiggle (world px) perpendicular to the heading, so the chain snakes instead of sliding.
    const wig = Math.sin(b.phase * 1.8) * 12;
    const nx = -Math.sin(toCore);
    const ny = Math.cos(toCore);
    const hx = (sx - L.cx) / L.scale + nx * wig;
    const hy = (sy - L.cy) / L.scale + ny * wig;
    const lx = b.tx[b.head]!;
    const ly = b.ty[b.head]!;
    if (Math.hypot(hx - lx, hy - ly) >= 3) this.pushTrail(b, hx, hy);
    s.img.setPosition(L.cx + hx * L.scale, L.cy + hy * L.scale).setRotation(toCore + Math.cos(b.phase * 1.8) * 0.35).setScale(k);
    const sp = this.spine;
    let lastX = s.img.x;
    let lastY = s.img.y;
    // Walk back along the trail placing segments at fixed arc lengths.
    const spacing = this.segSpacing(e);
    let seg = 0;
    let acc = 0;
    let target = spacing;
    let px = hx;
    let py = hy;
    for (let i = 1; i < b.count && seg < BOSS_SEGMENTS; i++) {
      const j = (b.head - i + TRAIL_CAP) % TRAIL_CAP;
      const qx = b.tx[j]!;
      const qy = b.ty[j]!;
      const d = Math.hypot(qx - px, qy - py);
      while (d > 0 && acc + d >= target && seg < BOSS_SEGMENTS) {
        const t = (target - acc) / d;
        const x = px + (qx - px) * t;
        const y = py + (qy - py) * t;
        const img = b.segs[seg]!;
        const sc = SEG_SCALE[seg]!;
        img.setPosition(L.cx + x * L.scale, L.cy + y * L.scale).setScale(k * sc).setAlpha(fade);
        sp.lineStyle(10 * sc, CRIMSON, 0.16 * fade).lineBetween(lastX, lastY, img.x, img.y);
        sp.lineStyle(2.5, CRIMSON, 0.75 * fade).lineBetween(lastX, lastY, img.x, img.y);
        lastX = img.x;
        lastY = img.y;
        img.setRotation(this.lastNow * 0.001 * (seg % 2 ? 1 : -1));
        seg++;
        target += spacing * (0.55 + sc * 0.5);
      }
      acc += d;
      px = qx;
      py = qy;
    }
    for (; seg < BOSS_SEGMENTS; seg++) b.segs[seg]!.setPosition(L.cx + px * L.scale, L.cy + py * L.scale).setScale(k * SEG_SCALE[seg]!);
  }

  /** Cyber-frame corner brackets around the arena. */
  private drawBrackets(scene: Phaser.Scene): void {
    const a = this.L.arena;
    const g = scene.add.graphics().setDepth(DEPTH.scan + 0.5).setBlendMode(Phaser.BlendModes.ADD);
    const m = 12;
    const len = 34;
    const x0 = a.x + m;
    const y0 = a.y + m;
    const x1 = a.x + a.w - m;
    const y1 = a.y + a.h - m;
    for (const [lw, al] of [[6, 0.1], [2, 0.55]] as const) {
      g.lineStyle(lw, CORE, al);
      g.strokePoints([{ x: x0, y: y0 + len }, { x: x0, y: y0 }, { x: x0 + len, y: y0 }]);
      g.strokePoints([{ x: x1 - len, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y0 + len }]);
      g.strokePoints([{ x: x0, y: y1 - len }, { x: x0, y: y1 }, { x: x0 + len, y: y1 }]);
      g.strokePoints([{ x: x1 - len, y: y1 }, { x: x1, y: y1 }, { x: x1, y: y1 - len }]);
    }
    // Small tick rows along the top and bottom edges.
    g.fillStyle(CORE, 0.35);
    for (let i = 0; i < 5; i++) {
      g.fillRect(x0 + len + 10 + i * 9, y0 - 1, 5, 2);
      g.fillRect(x1 - len - 15 - i * 9, y1 - 1, 5, 2);
    }
  }

  private drawCore(hpFrac: number, now: number, dead: boolean): void {
    const L = this.L;
    const show = !dead || Math.random() < 0.15;
    this.coreOuter.setVisible(show);
    this.coreInner.setVisible(show);
    this.coreRing.setVisible(!dead);
    this.coreLight.setVisible(!dead);
    let x = L.cx;
    let y = L.cy;
    if (now < this.coreShakeUntil) {
      x += (Math.random() - 0.5) * 7;
      y += (Math.random() - 0.5) * 7;
    }
    this.coreX = x;
    this.coreY = y;
    const low = hpFrac < 0.3;
    const pulse = 1 + 0.04 * Math.sin(now / (low ? 90 : 420));
    this.coreOuter.setPosition(x, y).setRotation(now * 0.00025).setScale(ps(L.scale * CORE_VIS) * pulse);
    this.coreRing.setPosition(x, y).setRotation(-now * 0.00012);
    this.coreInner.setPosition(x, y).setRotation(-now * 0.0006).setScale(ps(L.scale * CORE_VIS) * (1 + 0.08 * Math.sin(now / 260)));
    this.coreLight.setPosition(x, y).setAlpha(0.75 + 0.25 * Math.sin(now / 700));
    const flash = now < this.coreFlashUntil;
    if (flash) {
      this.coreOuter.setTint(CORE_HIT);
      this.coreInner.setTint(0xffc0cc);
      this.coreLight.setTint(CORE_HIT);
    } else if (low && Math.sin(now / 90) > 0.6) {
      this.coreOuter.setTint(CORE_HIT);
      this.coreInner.clearTint();
      this.coreLight.setTint(CORE_HIT);
    } else {
      this.coreOuter.clearTint();
      this.coreInner.clearTint();
      this.coreLight.clearTint();
    }
    const r = this.rangeDrawn * L.scale;
    for (let i = 0; i < this.orbiters.length; i++) {
      const a = now * 0.0005 + i * Math.PI;
      this.orbiters[i]!.setPosition(L.cx + Math.cos(a) * r, L.cy + Math.sin(a) * r);
    }
  }

  private drawPulses(dt: number): void {
    const a = this.L.arena;
    for (const p of this.pulses) {
      p.pos += (p.speed * dt) / 1000;
      const lo = (p.horizontal ? a.x : a.y) - 60;
      const hi = (p.horizontal ? a.x + a.w : a.y + a.h) + 60;
      if (p.pos < lo || p.pos > hi) this.resetPulse(p, false);
      if (p.horizontal) p.img.setPosition(p.pos, p.line);
      else p.img.setPosition(p.line, p.pos);
    }
  }
}

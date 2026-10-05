// Procedural neon textures, baked once at boot on 2D canvases at the render scale RS (crisp on HiDPI).
// Glow comes from canvas shadowBlur at bake time — never per-object preFX at runtime (too slow on phones).
// Images using these textures are scaled by ps() and drawn with ADD blending.

import Phaser from 'phaser';
import type { EnemyKind, GameData } from '../sim/data';
import {
  BITS, CORE, CYAN, ENEMY_COLOR, ENERGY, GRID, GRID_MAJOR, HP_OK, PANEL_EDGE, PANEL_FILL, TRACER, WHITE,
} from './palette';
import { RS } from './resolution';

type Ctx = CanvasRenderingContext2D;
type Pt = [number, number];

/** Blur padding around shapes, logical px. */
const PAD = 18;
export const TRACER_LEN = 30;
export const GRID_TILE = 128;
const GRID_MINOR = 32;

function rgba(c: number, a: number): string {
  return `rgba(${(c >> 16) & 255},${(c >> 8) & 255},${c & 255},${a})`;
}

/** Draws in logical px onto a canvas texture of RS× size. */
export function bake(scene: Phaser.Scene, key: string, w: number, h: number, draw: (ctx: Ctx) => void): void {
  if (scene.textures.exists(key)) scene.textures.remove(key);
  const tex = scene.textures.createCanvas(key, Math.ceil(w * RS), Math.ceil(h * RS))!;
  const ctx = tex.getContext();
  ctx.scale(RS, RS);
  draw(ctx);
  tex.refresh();
}

function poly(ctx: Ctx, pts: readonly Pt[]): void {
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
  ctx.closePath();
}

function regular(cx: number, cy: number, r: number, n: number, rot: number): Pt[] {
  return Array.from({ length: n }, (_, i) => {
    const a = rot + (i / n) * Math.PI * 2;
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r] as Pt;
  });
}

/** A neon tube: dim fill, glowing stroke, white-hot centre line. */
function neon(ctx: Ctx, pts: readonly Pt[], color: number, lw: number, fillA = 0.2, blur = 12): void {
  ctx.lineJoin = 'round';
  // Wide soft bloom first, then the tube.
  ctx.shadowColor = rgba(color, 0.9);
  ctx.shadowBlur = blur * 1.8 * RS;
  ctx.strokeStyle = rgba(color, 0.28);
  ctx.lineWidth = lw * 3.2;
  poly(ctx, pts);
  ctx.stroke();
  ctx.shadowBlur = 0;
  poly(ctx, pts);
  ctx.fillStyle = rgba(color, fillA);
  ctx.fill();
  ctx.shadowColor = rgba(color, 1);
  ctx.shadowBlur = blur * RS;
  ctx.strokeStyle = rgba(color, 1);
  ctx.lineWidth = lw;
  poly(ctx, pts);
  ctx.stroke();
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = rgba(WHITE, 0.85);
  ctx.lineWidth = Math.max(1, lw * 0.38);
  poly(ctx, pts);
  ctx.stroke();
}

function dot(ctx: Ctx, x: number, y: number, r: number, color: number, blur = 8): void {
  ctx.shadowColor = rgba(color, 1);
  ctx.shadowBlur = blur * RS;
  ctx.fillStyle = rgba(color, 1);
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = rgba(WHITE, 0.9);
  ctx.beginPath();
  ctx.arc(x, y, r * 0.45, 0, Math.PI * 2);
  ctx.fill();
}

function shapeTexture(scene: Phaser.Scene, key: string, r: number, draw: (ctx: Ctx, c: number) => void): void {
  const size = (r + PAD) * 2;
  bake(scene, key, size, size, (ctx) => draw(ctx, size / 2));
}

/** Enemy textures are baked at their data radius: render scale = ps(layout scale). */
function enemies(scene: Phaser.Scene, data: GameData): void {
  const r = (k: EnemyKind): number => data.enemies[k].radius;
  const C = ENEMY_COLOR;
  shapeTexture(scene, 'e_basic', r('basic') * 1.25, (ctx, c) => {
    const h = r('basic') * 0.92;
    neon(ctx, [[c - h, c - h], [c + h, c - h], [c + h, c + h], [c - h, c + h]], C.basic, 3.2);
    const i = h * 0.42;
    neon(ctx, [[c - i, c - i], [c + i, c - i], [c + i, c + i], [c - i, c + i]], C.basic, 1.6, 0.35, 6);
  });
  shapeTexture(scene, 'e_fast', r('fast') * 2.2, (ctx, c) => {
    const pts = regular(c, c, r('fast') * 1.2, 3, 0);
    // Speed streaks trailing behind (the texture points +x).
    const rf = r('fast');
    ctx.lineCap = 'round';
    for (const [dy, len, a] of [[-rf * 0.5, rf * 1.1, 0.55], [rf * 0.5, rf * 1.1, 0.55], [0, rf * 0.7, 0.35]] as const) {
      const g = ctx.createLinearGradient(c - rf * 0.7 - len, 0, c - rf * 0.5, 0);
      g.addColorStop(0, rgba(C.fast, 0));
      g.addColorStop(1, rgba(C.fast, a));
      ctx.strokeStyle = g;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(c - rf * 0.7 - len, c + dy);
      ctx.lineTo(c - rf * 0.6, c + dy);
      ctx.stroke();
    }
    neon(ctx, pts, C.fast, 3);
    dot(ctx, c - r('fast') * 0.1, c, 2.2, C.fast, 6);
  });
  shapeTexture(scene, 'e_tank', r('tank') * 1.25, (ctx, c) => {
    const h = r('tank') * 0.95;
    neon(ctx, [[c - h, c - h], [c + h, c - h], [c + h, c + h], [c - h, c + h]], C.tank, 3.4, 0.14);
    const i = h * 0.62;
    neon(ctx, [[c - i, c - i], [c + i, c - i], [c + i, c + i], [c - i, c + i]], C.tank, 2, 0.12, 6);
    neon(ctx, regular(c, c, h * 0.42, 4, 0), C.tank, 1.6, 0.4, 6);
  });
  shapeTexture(scene, 'e_ranged', r('ranged') * 1.4, (ctx, c) => {
    const rr = r('ranged');
    neon(ctx, [[c + rr * 1.3, c], [c, c - rr * 0.9], [c - rr * 1.3, c], [c, c + rr * 0.9]], C.ranged, 3);
    neon(ctx, [[c + rr * 0.6, c], [c, c - rr * 0.42], [c - rr * 0.6, c], [c, c + rr * 0.42]], C.ranged, 1.4, 0.3, 6);
    dot(ctx, c, c, 3, C.ranged, 8);
  });
  const br = r('boss');
  shapeTexture(scene, 'e_boss_head', br * 1.15, (ctx, c) => {
    neon(ctx, regular(c, c, br, 6, 0), C.boss, 3.6, 0.18, 14);
    neon(ctx, regular(c, c, br * 0.62, 6, 0), C.boss, 2, 0.1, 8);
    // Eyes face +x (the head is rotated toward the core).
    dot(ctx, c + br * 0.38, c - br * 0.3, 4.5, 0xffe0ea, 10);
    dot(ctx, c + br * 0.38, c + br * 0.3, 4.5, 0xffe0ea, 10);
  });
  shapeTexture(scene, 'e_boss_seg', br * 1.05, (ctx, c) => {
    neon(ctx, regular(c, c, br * 0.92, 6, Math.PI / 6), C.boss, 3, 0.12, 12);
    neon(ctx, regular(c, c, br * 0.4, 6, Math.PI / 6), 0xff5fa2, 1.8, 0.35, 8);
  });
}

function core(scene: Phaser.Scene, data: GameData): void {
  const cr = data.core.radius;
  shapeTexture(scene, 'core_outer', cr * 1.3, (ctx, c) => {
    neon(ctx, regular(c, c, cr * 1.18, 6, Math.PI / 6), CORE, 3.2, 0.08, 16);
    // Notches on every vertex.
    for (const [x, y] of regular(c, c, cr * 1.18, 6, Math.PI / 6)) dot(ctx, x, y, 2.4, CORE, 8);
  });
  shapeTexture(scene, 'core_inner', cr * 0.8, (ctx, c) => {
    neon(ctx, regular(c, c, cr * 0.66, 6, 0), CORE, 2.4, 0.35, 12);
    neon(ctx, regular(c, c, cr * 0.32, 6, Math.PI / 6), WHITE, 1.6, 0.6, 8);
  });
  const rr = cr * 1.85;
  shapeTexture(scene, 'core_ring', rr + 4, (ctx, c) => {
    ctx.shadowColor = rgba(CORE, 1);
    ctx.shadowBlur = 8 * RS;
    ctx.strokeStyle = rgba(CORE, 0.75);
    ctx.lineWidth = 2;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(c, c, rr, a + 0.12, a + Math.PI / 3 - 0.12);
      ctx.stroke();
    }
    ctx.strokeStyle = rgba(CORE, 0.5);
    ctx.lineWidth = 1;
    for (let i = 0; i < 36; i++) {
      const a = (i / 36) * Math.PI * 2;
      const r0 = rr - (i % 3 === 0 ? 7 : 4);
      ctx.beginPath();
      ctx.moveTo(c + Math.cos(a) * r0, c + Math.sin(a) * r0);
      ctx.lineTo(c + Math.cos(a) * (rr - 1.5), c + Math.sin(a) * (rr - 1.5));
      ctx.stroke();
    }
  });
  const L = 512;
  bake(scene, 'core_light', L, L, (ctx) => {
    const g = ctx.createRadialGradient(L / 2, L / 2, 0, L / 2, L / 2, L / 2);
    g.addColorStop(0, rgba(CORE, 0.55));
    g.addColorStop(0.18, rgba(CORE, 0.16));
    g.addColorStop(0.5, rgba(0x1f6bff, 0.05));
    g.addColorStop(1, rgba(0x1f6bff, 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, L, L);
  });
}

function fx(scene: Phaser.Scene): void {
  // Tracer: head at the right end, fading tail.
  const tw = TRACER_LEN + PAD * 2;
  const th = 4 + PAD * 2;
  bake(scene, 'tracer', tw, th, (ctx) => {
    const y = th / 2;
    const g = ctx.createLinearGradient(PAD, 0, PAD + TRACER_LEN, 0);
    g.addColorStop(0, rgba(TRACER, 0));
    g.addColorStop(1, rgba(TRACER, 1));
    ctx.shadowColor = rgba(CYAN, 1);
    ctx.shadowBlur = 8 * RS;
    ctx.strokeStyle = g;
    ctx.lineCap = 'round';
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.moveTo(PAD, y);
    ctx.lineTo(PAD + TRACER_LEN, y);
    ctx.stroke();
    ctx.shadowBlur = 0;
    const w = ctx.createLinearGradient(PAD + TRACER_LEN * 0.4, 0, PAD + TRACER_LEN, 0);
    w.addColorStop(0, rgba(WHITE, 0));
    w.addColorStop(1, rgba(WHITE, 1));
    ctx.strokeStyle = w;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(PAD + TRACER_LEN * 0.4, y);
    ctx.lineTo(PAD + TRACER_LEN, y);
    ctx.stroke();
  });
  // Pixel particle: a crisp square with a faint halo.
  bake(scene, 'px', 10, 10, (ctx) => {
    ctx.fillStyle = rgba(WHITE, 0.25);
    ctx.fillRect(1, 1, 8, 8);
    ctx.fillStyle = rgba(WHITE, 1);
    ctx.fillRect(3, 3, 4, 4);
  });
  bake(scene, 'glow', 64, 64, (ctx) => {
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, rgba(WHITE, 1));
    g.addColorStop(0.25, rgba(WHITE, 0.45));
    g.addColorStop(1, rgba(WHITE, 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
  });
  // Muzzle flare: a 4-point star.
  bake(scene, 'flare', 48, 48, (ctx) => {
    const c = 24;
    ctx.shadowColor = rgba(CYAN, 1);
    ctx.shadowBlur = 10 * RS;
    ctx.fillStyle = rgba(WHITE, 1);
    poly(ctx, [[c, c - 18], [c + 3, c - 3], [c + 18, c], [c + 3, c + 3], [c, c + 18], [c - 3, c + 3], [c - 18, c], [c - 3, c - 3]]);
    ctx.fill();
  });
}

function background(scene: Phaser.Scene): void {
  const T = GRID_TILE;
  bake(scene, 'grid', T, T, (ctx) => {
    ctx.fillStyle = rgba(GRID, 0.07);
    for (let i = 0; i < T; i += GRID_MINOR) {
      ctx.fillRect(i, 0, 1, T);
      ctx.fillRect(0, i, T, 1);
    }
    ctx.fillStyle = rgba(GRID_MAJOR, 0.1);
    ctx.fillRect(0, 0, 1.5, T);
    ctx.fillRect(0, 0, T, 1.5);
    // Tiny crosses on major intersections.
    ctx.fillStyle = rgba(GRID_MAJOR, 0.35);
    ctx.fillRect(-3, 0, 7, 1.5);
    ctx.fillRect(0, -3, 1.5, 7);
    ctx.fillRect(T - 3, 0, 3, 1.5);
    ctx.fillRect(0, T - 3, 1.5, 3);
  });
  const V = 256;
  bake(scene, 'vignette', V, V, (ctx) => {
    const g = ctx.createRadialGradient(V / 2, V / 2, V * 0.25, V / 2, V / 2, V * 0.72);
    g.addColorStop(0, 'rgba(3,5,13,0)');
    g.addColorStop(1, 'rgba(3,5,13,0.85)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, V, V);
  });
  bake(scene, 'scan', 4, 4, (ctx) => {
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.fillRect(0, 0, 4, 1);
  });
}

function icons(scene: Phaser.Scene): void {
  const S = 40;
  const c = S / 2;
  bake(scene, 'ic_energy', S, S, (ctx) => {
    neon(ctx, [[c + 3, c - 13], [c - 8, c + 2], [c - 1, c + 2], [c - 3, c + 13], [c + 8, c - 2], [c + 1, c - 2]], ENERGY, 2, 0.5, 8);
  });
  bake(scene, 'ic_bits', S, S, (ctx) => {
    neon(ctx, [[c, c - 12], [c + 10, c], [c, c + 12], [c - 10, c]], BITS, 2, 0.4, 8);
  });
  bake(scene, 'ic_hp', S, S, (ctx) => {
    neon(ctx, regular(c, c, 11, 6, Math.PI / 6), HP_OK, 2, 0.4, 8);
    neon(ctx, [[c - 1, c - 6], [c + 1, c - 6], [c + 1, c - 1], [c + 6, c - 1], [c + 6, c + 1], [c + 1, c + 1], [c + 1, c + 6], [c - 1, c + 6], [c - 1, c + 1], [c - 6, c + 1], [c - 6, c - 1], [c - 1, c - 1]], WHITE, 1, 0.9, 4);
  });
  bake(scene, 'ic_kills', S, S, (ctx) => {
    ctx.shadowColor = rgba(0xff2bd6, 1);
    ctx.shadowBlur = 8 * RS;
    ctx.strokeStyle = rgba(0xff2bd6, 1);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(c, c, 9, 0, Math.PI * 2);
    ctx.moveTo(c, c - 14);
    ctx.lineTo(c, c - 5);
    ctx.moveTo(c, c + 5);
    ctx.lineTo(c, c + 14);
    ctx.moveTo(c - 14, c);
    ctx.lineTo(c - 5, c);
    ctx.moveTo(c + 5, c);
    ctx.lineTo(c + 14, c);
    ctx.stroke();
  });
  bake(scene, 'ic_wave', S, S, (ctx) => {
    neon(ctx, [[c - 12, c + 8], [c - 4, c - 8], [c + 4, c + 8], [c + 12, c - 8], [c + 12, c - 8], [c + 4, c + 8], [c - 4, c - 8], [c - 12, c + 8]], CYAN, 2, 0, 8);
  });
}

/** Chamfered rectangle outline points (cut corners: top-left and bottom-right). */
export function chamfer(x: number, y: number, w: number, h: number, cut: number): Pt[] {
  return [[x + cut, y], [x + w, y], [x + w, y + h - cut], [x + w - cut, y + h], [x, y + h], [x, y + cut]];
}

export interface PanelStyle {
  edge?: number;
  fill?: number;
  fillA?: number;
  cut?: number;
  lw?: number;
  blur?: number;
}

/** Bakes a glowing chamfered panel (UI frames, buttons). Returns the key and the padding around the box. */
export function bakePanel(scene: Phaser.Scene, key: string, w: number, h: number, st: PanelStyle = {}): number {
  const pad = 12;
  const edge = st.edge ?? PANEL_EDGE;
  bake(scene, key, w + pad * 2, h + pad * 2, (ctx) => {
    const pts = chamfer(pad, pad, w, h, st.cut ?? 14);
    poly(ctx, pts);
    ctx.fillStyle = rgba(st.fill ?? PANEL_FILL, st.fillA ?? 0.9);
    ctx.fill();
    ctx.shadowColor = rgba(edge, 1);
    ctx.shadowBlur = (st.blur ?? 10) * RS;
    ctx.strokeStyle = rgba(edge, 0.9);
    ctx.lineWidth = st.lw ?? 2;
    poly(ctx, pts);
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = rgba(WHITE, 0.35);
    ctx.lineWidth = 1;
    poly(ctx, pts);
    ctx.stroke();
  });
  return pad;
}

export function generateTextures(scene: Phaser.Scene, data: GameData): void {
  background(scene);
  enemies(scene, data);
  core(scene, data);
  fx(scene);
  icons(scene);
}


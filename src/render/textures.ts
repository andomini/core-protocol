// Procedural neon textures, baked once at boot on 2D canvases at the render scale RS (crisp on HiDPI).
// Glow comes from canvas shadowBlur at bake time — never per-object preFX at runtime (too slow on phones).
// Images using these textures are scaled by ps() and drawn with ADD blending (viruses: NORMAL, see WorldView).

import Phaser from 'phaser';
import { type EnemyKind, type GameData, STAT_IDS, type StatId } from '../sim/data';
import {
  KEY, BITS, CYAN, ENEMY_ACCENT, ENEMY_COLOR, ENERGY, GRID, GRID_MAJOR, HP_OK, LOCKED, PANEL_EDGE, PANEL_FILL, TAB_COLOR, TRACER, VIRUS_BODY, WHITE,
} from './palette';
import { RS } from './resolution';
import { FRAMES, texKey } from './virusShapes';

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

/** Closed smooth outline through `pts` (quadratic curves via edge midpoints). */
function smooth(ctx: Ctx, pts: readonly Pt[]): void {
  const n = pts.length;
  ctx.beginPath();
  ctx.moveTo((pts[n - 1]![0] + pts[0]![0]) / 2, (pts[n - 1]![1] + pts[0]![1]) / 2);
  for (let i = 0; i < n; i++) {
    const [x, y] = pts[i]!;
    const [nx, ny] = pts[(i + 1) % n]!;
    ctx.quadraticCurveTo(x, y, (x + nx) / 2, (y + ny) / 2);
  }
  ctx.closePath();
}

/**
 * A virus body: an opaque dark fill (piles stay readable under normal blending), a rim-lit gradient in the body colour,
 * then the glowing outline. `path` must build the closed outline from scratch (beginPath included).
 */
function body(ctx: Ctx, cx: number, cy: number, r: number, color: number, lw: number, path: () => void, blur = 10): void {
  ctx.lineJoin = 'round';
  path();
  ctx.fillStyle = rgba(VIRUS_BODY, 0.82);
  ctx.fill();
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  g.addColorStop(0, rgba(color, 0.1));
  g.addColorStop(0.65, rgba(color, 0.2));
  g.addColorStop(1, rgba(color, 0.5));
  ctx.fillStyle = g;
  path();
  ctx.fill();
  ctx.shadowColor = rgba(color, 0.9);
  ctx.shadowBlur = blur * 1.6 * RS;
  ctx.strokeStyle = rgba(color, 0.3);
  ctx.lineWidth = lw * 2.8;
  path();
  ctx.stroke();
  ctx.shadowBlur = blur * RS;
  ctx.strokeStyle = rgba(color, 1);
  ctx.lineWidth = lw;
  path();
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = rgba(WHITE, 0.75);
  ctx.lineWidth = Math.max(0.8, lw * 0.34);
  path();
  ctx.stroke();
}

/** A neon open stroke whose alpha fades from `a0` at the first point to `a1` at the last (flagella). */
function fadeStroke(ctx: Ctx, pts: readonly Pt[], color: number, lw: number, a0: number, a1: number): void {
  const [x0, y0] = pts[0]!;
  const [x1, y1] = pts[pts.length - 1]!;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const layers: [number, number, number, number][] = [[lw * 2.6, 0.35, 8, color], [lw, 1, 5, color], [Math.max(0.7, lw * 0.35), 0.8, 0, WHITE]];
  for (const [w, k, blur, col] of layers) {
    const g = ctx.createLinearGradient(x0, y0, x1, y1);
    g.addColorStop(0, rgba(col, a0 * k));
    g.addColorStop(1, rgba(col, a1 * k));
    ctx.shadowColor = rgba(color, 1);
    ctx.shadowBlur = blur * RS;
    ctx.strokeStyle = g;
    ctx.lineWidth = w;
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
    ctx.stroke();
  }
  ctx.shadowBlur = 0;
}

/** Spike ring (peplomers): `n` stalks from `r0` to `r1`, each with a club of radius `club` at the tip. */
function spikes(ctx: Ctx, c: number, n: number, r0: number, r1: number, club: number, color: number, rot = 0, lw = 2): void {
  glow(ctx, color, lw, () => {
    for (let i = 0; i < n; i++) {
      const a = rot + (i / n) * TAU;
      ctx.moveTo(c + Math.cos(a) * r0, c + Math.sin(a) * r0);
      ctx.lineTo(c + Math.cos(a) * r1, c + Math.sin(a) * r1);
    }
  });
  for (let i = 0; i < n; i++) {
    const a = rot + (i / n) * TAU;
    dot(ctx, c + Math.cos(a) * (r1 + club * 0.5), c + Math.sin(a) * (r1 + club * 0.5), club, color, 6);
  }
}

/**
 * Virus bodies (uniqueness plan item 2; notes in 2026-10-20-uniqueness-notes-a2.md): baked once at the data radius and
 * drawn at ps(layout scale × ENEMY_VIS). Directional bodies (fast, ranged, leech, phage, boss head) face +x, the heading to the core.
 */
function enemies(scene: Phaser.Scene, data: GameData): void {
  const r = (k: EnemyKind): number => data.enemies[k].radius;
  const C = ENEMY_COLOR;
  const A = ENEMY_ACCENT;

  // basic: a round capsid with club-tipped spikes (the corona silhouette) and a ring of genome beads inside (beads, not a
  // curl: a curl reads as a digit at this size).
  const rb = r('basic');
  shapeTexture(scene, texKey('basic'), rb * 1.3, (ctx, c) => {
    const R = rb * 0.7;
    spikes(ctx, c, 9, R * 0.92, rb * 1.08, 2.4, C.basic, 0.2);
    body(ctx, c, c, R, C.basic, 2.6, () => {
      ctx.beginPath();
      ctx.arc(c, c, R, 0, TAU);
    });
    ctx.strokeStyle = rgba(A.basic, 0.35);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(c, c, R * 0.5, 0, TAU);
    ctx.stroke();
    for (const [x, y] of regular(c, c, R * 0.5, 5, 0.5)) dot(ctx, x, y, 1.5, A.basic, 4);
  });

  // fast: a comet body (head toward +x) with three flagella beating behind it; one texture per beat frame.
  const rf = r('fast');
  for (let f = 0; f < FRAMES.fast; f++) {
    shapeTexture(scene, texKey('fast', f), rf * 2.3, (ctx, c) => {
      const hx = c + rf * 0.35;
      const hr = rf * 0.62;
      const tail = c - rf * 0.95;
      const phase = (f / FRAMES.fast) * TAU;
      const strands: [number, number, number][] = [[-0.24, 0.32, 0], [0, 0.22, 2.1], [0.24, 0.32, 4.2]];
      for (const [y0, amp, off] of strands) {
        const pts: Pt[] = [];
        for (let i = 0; i <= 14; i++) {
          const t = i / 14;
          const x = tail + rf * 0.15 - t * rf * 1.25;
          pts.push([x, c + y0 * rf * (1 + t * 1.6) + Math.sin(t * 7.5 - phase - off) * amp * rf * t]);
        }
        fadeStroke(ctx, pts, C.fast, 1.6, 1, 0.12);
      }
      const a0 = -Math.PI * 0.62;
      const outline = (): void => {
        ctx.beginPath();
        ctx.arc(hx, c, hr, a0, -a0);
        ctx.quadraticCurveTo(hx - hr * 0.9, c + hr * 0.75, tail, c);
        ctx.quadraticCurveTo(hx - hr * 0.9, c - hr * 0.75, hx + Math.cos(a0) * hr, c + Math.sin(a0) * hr);
        ctx.closePath();
      };
      body(ctx, hx, c, hr * 1.2, C.fast, 2.4, outline, 9);
      dot(ctx, hx + hr * 0.1, c, 2.3, A.fast, 6);
    });
  }

  // tank: an icosahedral shell seen vertex-on (hex outline, inner triangle, ten shaded facets) with fibre knobs on the
  // six outer vertices (adenovirus), an inner hull line and rivets: heavy and armoured.
  const rt = r('tank');
  shapeTexture(scene, texKey('tank'), rt * 1.3, (ctx, c) => {
    const R = rt * 0.86;
    const V = regular(c, c, R, 6, -Math.PI / 2);
    const T = regular(c, c, R * 0.5, 3, -Math.PI / 2);
    spikes(ctx, c, 6, R * 1.02, rt * 1.14, 3, C.tank, -Math.PI / 2, 2.4);
    body(ctx, c, c, R, C.tank, 4.4, () => poly(ctx, V), 12);
    // Facets: each outer edge to its inner vertex, the three wedges between inner edges, and the centre triangle.
    // Outer vertex i (from the top, clockwise) sees inner vertex NEAR[i]; vertex 2j+1 sits between inner j and j+1.
    const NEAR = [0, 0, 1, 1, 2, 2];
    const facets: Pt[][] = [];
    for (let i = 0; i < 6; i++) facets.push([V[i]!, V[(i + 1) % 6]!, T[i % 2 === 0 ? NEAR[i]! : NEAR[(i + 1) % 6]!]!]);
    for (let j = 0; j < 3; j++) facets.push([T[j]!, T[(j + 1) % 3]!, V[2 * j + 1]!]);
    facets.push([T[0]!, T[1]!, T[2]!]);
    for (const f of facets) {
      const mx = (f[0]![0] + f[1]![0] + f[2]![0]) / 3 - c;
      const my = (f[0]![1] + f[1]![1] + f[2]![1]) / 3 - c;
      // Light from the upper left.
      const lit = Math.max(0, (-mx - my) / (R * 0.9));
      poly(ctx, f);
      ctx.fillStyle = rgba(C.tank, 0.1 + 0.42 * lit);
      ctx.fill();
      ctx.strokeStyle = rgba(A.tank, 0.7);
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    ctx.strokeStyle = rgba(A.tank, 0.55);
    ctx.lineWidth = 1;
    poly(ctx, regular(c, c, R * 0.82, 6, -Math.PI / 2));
    ctx.stroke();
    for (const [x, y] of T) dot(ctx, x, y, 1.8, A.tank, 5);
  });

  // phage: a bacteriophage (it hunts structures; the ranged virus got the spitting cone instead) — hexagonal head away from the core, ringed tail sheath, baseplate, six legs toward +x.
  const rp = r('phage');
  for (let f = 0; f < FRAMES.phage; f++) {
    shapeTexture(scene, texKey('phage', f), rp * 1.55, (ctx, c) => {
      const X = (k: number): number => c + k * rp;
      // Legs (behind the baseplate): [base x, base y, knee x, knee y, foot x, foot y], mirpored in y.
      const legs: [number, number, number, number, number, number][] =
        f === 1
          ? [[0.62, 0.28, 0.82, 0.78, 1.32, 0.66], [0.64, 0.12, 1.0, 0.44, 1.4, 0.3]]
          : [[0.62, 0.28, 0.72, 0.88, 1.22, 0.98], [0.64, 0.12, 0.92, 0.52, 1.36, 0.5]];
      glow(ctx, C.phage, 1.7, () => {
        for (const [bx, by, kx, ky, fx, fy] of legs) {
          for (const s of [-1, 1]) {
            ctx.moveTo(X(bx), X(by * s));
            ctx.lineTo(X(kx), X(ky * s));
            ctx.lineTo(X(fx), X(fy * s));
          }
        }
      });
      body(ctx, c, c, rp * 0.4, C.phage, 1.8, () => poly(ctx, [[X(-0.12), X(-0.14)], [X(0.58), X(-0.14)], [X(0.58), X(0.14)], [X(-0.12), X(0.14)]]), 6);
      glow(ctx, A.phage, 1, () => {
        for (const k of [0.06, 0.22, 0.38]) {
          ctx.moveTo(X(k), X(-0.14));
          ctx.lineTo(X(k), X(0.14));
        }
      });
      glow(ctx, C.phage, 2.4, () => {
        ctx.moveTo(X(0.64), X(-0.34));
        ctx.lineTo(X(0.64), X(0.34));
        ctx.moveTo(X(-0.16), X(-0.24));
        ctx.lineTo(X(-0.16), X(0.24));
      });
      const head: Pt[] = regular(0, 0, 1, 6, 0).map(([x, y]) => [X(-0.78 + x * 0.6), X(y * 0.56)] as Pt);
      body(ctx, X(-0.78), c, rp * 0.62, C.phage, 2.4, () => poly(ctx, head), 9);
      glow(ctx, A.phage, 1.2, () => {
        ctx.moveTo(X(-1.05), X(-0.08));
        ctx.bezierCurveTo(X(-0.95), X(-0.38), X(-0.62), X(-0.38), X(-0.6), X(-0.06));
        ctx.bezierCurveTo(X(-0.58), X(0.3), X(-0.9), X(0.32), X(-0.88), X(0.06));
      });
    });
  }

  // ranged: a spitting cone — a fluted funnel whose wide mouth faces the core (+x), a bulb at the back, a nozzle that
  // pumps a droplet out (frame 1: the nozzle squeezed, the droplet out). Reads as "shoots" without the phage legs.
  const rr = r('ranged');
  for (let f = 0; f < FRAMES.ranged; f++) {
    shapeTexture(scene, texKey('ranged', f), rr * 1.6, (ctx, c) => {
      const X = (k: number): number => c + k * rr;
      const mouth = f === 1 ? 0.62 : 0.74;
      const cone: Pt[] = [[X(-0.95), X(-0.2)], [X(-0.2), X(-0.42)], [X(0.7), X(-mouth)], [X(0.98), X(-mouth * 0.55)], [X(0.98), X(mouth * 0.55)], [X(0.7), X(mouth)], [X(-0.2), X(0.42)], [X(-0.95), X(0.2)]];
      body(ctx, c, c, rr, C.ranged, 2.4, () => smooth(ctx, cone), 10);
      // Flutes along the cone, converging on the bulb.
      glow(ctx, A.ranged, 1, () => {
        for (const k of [-0.5, 0, 0.5]) {
          ctx.moveTo(X(-0.55), X(k * 0.32));
          ctx.lineTo(X(0.78), X(k * mouth * 1.25));
        }
      });
      // Nozzle ring at the mouth and the droplet it spits.
      glow(ctx, C.ranged, 2, () => {
        ctx.moveTo(X(0.98), X(-mouth * 0.5));
        ctx.lineTo(X(0.98), X(mouth * 0.5));
      });
      dot(ctx, X(f === 1 ? 1.38 : 1.12), c, f === 1 ? 2.6 : 1.8, A.ranged, 8);
      // The bulb (venom sac) at the back.
      dot(ctx, X(-0.62), c, rr * 0.16, A.ranged, 6);
    });
  }

  // leech: a tick — a fat oval abdomen with a scute, a small head toward the core (+x) with a proboscis that pumps
  // (frame 1: stretched), four short legs a side.
  const rl = r('leech');
  for (let f = 0; f < FRAMES.leech; f++) {
    shapeTexture(scene, texKey('leech', f), rl * 1.7, (ctx, c) => {
      const X = (k: number): number => c + k * rl;
      glow(ctx, C.leech, 1.4, () => {
        for (let i = 0; i < 4; i++) {
          const bx = X(-0.25 + i * 0.25);
          const sw = (f === 1 ? 0.08 : -0.08) * (i % 2 === 0 ? 1 : -1);
          for (const s of [-1, 1]) {
            ctx.moveTo(bx, X(0.55 * s));
            ctx.lineTo(bx + rl * (0.12 + sw), X(1.02 * s));
            ctx.lineTo(bx + rl * (0.3 + sw), X(1.18 * s));
          }
        }
      });
      const abdomen: Pt[] = regular(0, 0, 1, 12, 0).map(([x, y]) => [X(-0.15 + x * 0.82), X(y * 0.68)] as Pt);
      body(ctx, X(-0.15), c, rl * 0.85, C.leech, 2.2, () => smooth(ctx, abdomen), 9);
      // Scute (the hard shield on the back) and a glint spot where the Bits go.
      glow(ctx, A.leech, 1, () => {
        ctx.moveTo(X(-0.7), X(-0.32));
        ctx.quadraticCurveTo(X(-0.1), X(-0.62), X(0.3), X(-0.2));
        ctx.quadraticCurveTo(X(0.42), X(0), X(0.3), X(0.2));
        ctx.quadraticCurveTo(X(-0.1), X(0.62), X(-0.7), X(0.32));
      });
      body(ctx, X(0.78), c, rl * 0.3, C.leech, 1.8, () => smooth(ctx, regular(X(0.78), c, rl * 0.3, 8, 0)), 7);
      const tip = f === 1 ? 1.62 : 1.38;
      glow(ctx, A.leech, 1.6, () => {
        ctx.moveTo(X(1.02), X(-0.06));
        ctx.lineTo(X(tip), c);
        ctx.lineTo(X(1.02), X(0.06));
      });
      dot(ctx, X(tip), c, 1.4, A.leech, 6);
    });
  }

  // spore: a soft puffball — a lumpy rounded capsule with short stubby nubs and spore specks inside; on death it bursts
  // into smaller puffballs (the same texture scaled down).
  const rs = r('spore');
  shapeTexture(scene, texKey('spore'), rs * 1.35, (ctx, c) => {
    const lumps = 11;
    const pts: Pt[] = Array.from({ length: lumps * 2 }, (_, i) => {
      const a = (i / (lumps * 2)) * TAU;
      const k = i % 2 === 0 ? 1 : 0.86;
      return [c + Math.cos(a) * rs * k, c + Math.sin(a) * rs * k] as Pt;
    });
    glow(ctx, C.spore, 1.6, () => {
      for (let i = 0; i < 7; i++) {
        const a = 0.4 + (i / 7) * TAU;
        ctx.moveTo(c + Math.cos(a) * rs * 0.98, c + Math.sin(a) * rs * 0.98);
        ctx.lineTo(c + Math.cos(a) * rs * 1.2, c + Math.sin(a) * rs * 1.2);
      }
    });
    body(ctx, c, c, rs, C.spore, 2.2, () => smooth(ctx, pts), 11);
    // Spore specks: a ring and a centre cluster, all small (a puffball, not a face).
    for (const [x, y] of regular(c, c, rs * 0.56, 7, 0.2)) dot(ctx, x, y, 1.6, A.spore, 5);
    for (const [x, y] of regular(c, c, rs * 0.22, 3, 0.9)) dot(ctx, x, y, 1.3, A.spore, 4);
    // A seam where it will burst.
    ctx.strokeStyle = rgba(A.spore, 0.4);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(c, c, rs * 0.8, -0.6, 0.9);
    ctx.stroke();
  });

  // carrier: a slow armoured shell — an octagonal carapace of overlapping plates around a small core; its aura ring is
  // drawn live in WorldView (it must track auraRadius, not the body size).
  const rc = r('carrier');
  shapeTexture(scene, texKey('carrier'), rc * 1.25, (ctx, c) => {
    const R = rc;
    const outer = regular(c, c, R, 8, Math.PI / 8);
    body(ctx, c, c, R, C.carrier, 3.6, () => poly(ctx, outer), 12);
    // Plates: a middle octagon and spokes from it to every outer corner.
    const mid = regular(c, c, R * 0.6, 8, Math.PI / 8);
    glow(ctx, A.carrier, 1.2, () => {
      polyPath(ctx, mid);
      for (let i = 0; i < 8; i++) {
        ctx.moveTo(mid[i]![0], mid[i]![1]);
        ctx.lineTo(outer[i]![0], outer[i]![1]);
      }
    });
    // Rivets on the outer plates and the shielded core.
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU;
      dot(ctx, c + Math.cos(a) * R * 0.8, c + Math.sin(a) * R * 0.8, 1.4, A.carrier, 4);
    }
    body(ctx, c, c, R * 0.3, C.carrier, 2, () => poly(ctx, regular(c, c, R * 0.3, 6, 0)), 8);
    dot(ctx, c, c, R * 0.1, A.carrier, 8);
  });

  // boss: a big spiked capsid around a glowing nucleus with a coiled genome; its lipid envelope (`e_boss_membrane`) is a
  // separate image so it can breathe. The trailing segments are budding progeny virions (`e_boss_seg`).
  const br = r('boss');
  shapeTexture(scene, texKey('boss'), br * 1.15, (ctx, c) => {
    const R = br * 0.6;
    spikes(ctx, c, 16, R * 0.95, br * 0.8, 3.2, C.boss, 0.1, 2.4);
    body(ctx, c, c, R, C.boss, 3.4, () => poly(ctx, regular(c, c, R, 20, 0)), 12);
    const g = ctx.createRadialGradient(c, c, 0, c, c, R * 0.55);
    g.addColorStop(0, rgba(WHITE, 0.9));
    g.addColorStop(0.35, rgba(A.boss, 0.6));
    g.addColorStop(1, rgba(C.boss, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(c, c, R * 0.55, 0, TAU);
    ctx.fill();
    glow(ctx, A.boss, 1.6, () => {
      for (let i = 0; i <= 60; i++) {
        const t = i / 60;
        const a = t * TAU * 2.2;
        const rad = R * (0.12 + 0.6 * t);
        if (i === 0) ctx.moveTo(c + Math.cos(a) * rad, c + Math.sin(a) * rad);
        else ctx.lineTo(c + Math.cos(a) * rad, c + Math.sin(a) * rad);
      }
    });
  });
  shapeTexture(scene, 'e_boss_membrane', br * 1.15, (ctx, c) => {
    const lobe = (k: number): Pt[] =>
      Array.from({ length: 56 }, (_, i) => {
        const a = (i / 56) * TAU;
        const rad = br * (k + 0.045 * Math.sin(a * 7) + 0.025 * Math.sin(a * 3 + 1));
        return [c + Math.cos(a) * rad, c + Math.sin(a) * rad] as Pt;
      });
    const outer = lobe(0.98);
    const inner = lobe(0.88);
    // The bilayer: a translucent band between two glowing lines, glycoprotein knobs on the lobes.
    smooth(ctx, outer);
    ctx.fillStyle = rgba(C.boss, 0.16);
    ctx.fill();
    ctx.globalCompositeOperation = 'destination-out';
    smooth(ctx, inner);
    ctx.fillStyle = 'rgba(0,0,0,1)';
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    smooth(ctx, inner);
    ctx.fillStyle = rgba(C.boss, 0.05);
    ctx.fill();
    const lines: [Pt[], number, number][] = [[outer, 2.6, 1], [inner, 1.4, 0.7]];
    for (const [pts, lw, a] of lines) {
      ctx.shadowColor = rgba(C.boss, 1);
      ctx.shadowBlur = 10 * RS;
      ctx.strokeStyle = rgba(C.boss, a);
      ctx.lineWidth = lw;
      smooth(ctx, pts);
      ctx.stroke();
    }
    ctx.shadowBlur = 0;
    for (let i = 0; i < 7; i++) {
      const a = ((i + 0.25) / 7) * TAU;
      dot(ctx, c + Math.cos(a) * br * 1.02, c + Math.sin(a) * br * 1.02, 2.6, A.boss, 7);
    }
  });
  shapeTexture(scene, 'e_boss_seg', br * 1.05, (ctx, c) => {
    const R = br * 0.6;
    ctx.strokeStyle = rgba(C.boss, 0.55);
    ctx.lineWidth = 1.6;
    ctx.shadowColor = rgba(C.boss, 1);
    ctx.shadowBlur = 8 * RS;
    ctx.beginPath();
    ctx.arc(c, c, br * 0.86, 0, TAU);
    ctx.stroke();
    ctx.shadowBlur = 0;
    spikes(ctx, c, 8, R * 0.95, br * 0.76, 2.6, C.boss, 0);
    body(ctx, c, c, R, C.boss, 3, () => poly(ctx, regular(c, c, R, 6, Math.PI / 6)), 10);
    dot(ctx, c, c, R * 0.22, A.boss, 10);
  });
}

/** Death fragments (`frag_<v>`, baked white, tinted per kind): a shell arc with a spike, a plate, a droplet. */
function fragmentTextures(scene: Phaser.Scene): void {
  const S = 40;
  const c = S / 2;
  bake(scene, 'frag_0', S, S, (ctx) => {
    glow(ctx, WHITE, 2.4, () => ctx.arc(c - 6, c, 10, -0.75, 0.75));
    glow(ctx, WHITE, 1.6, () => {
      ctx.moveTo(c + 4, c);
      ctx.lineTo(c + 9, c);
    });
    dot(ctx, c + 10, c, 2, WHITE, 5);
  });
  bake(scene, 'frag_1', S, S, (ctx) => neon(ctx, [[c - 6, c - 6], [c + 7, c - 1], [c - 3, c + 7]], WHITE, 1.8, 0.35, 7));
  bake(scene, 'frag_2', S, S, (ctx) => {
    dot(ctx, c, c, 3.4, WHITE, 8);
    dot(ctx, c - 5, c + 3, 1.6, WHITE, 5);
  });
}

// Baked white: WorldView tints the core with the colours of its modules (cyan while it has none).
function core(scene: Phaser.Scene, data: GameData): void {
  const cr = data.core.radius;
  shapeTexture(scene, 'core_outer', cr * 1.3, (ctx, c) => {
    neon(ctx, regular(c, c, cr * 1.18, 6, Math.PI / 6), WHITE, 3.2, 0.08, 16);
    // Notches on every vertex.
    for (const [x, y] of regular(c, c, cr * 1.18, 6, Math.PI / 6)) dot(ctx, x, y, 2.4, WHITE, 8);
  });
  shapeTexture(scene, 'core_inner', cr * 0.8, (ctx, c) => {
    neon(ctx, regular(c, c, cr * 0.66, 6, 0), WHITE, 2.4, 0.35, 12);
    neon(ctx, regular(c, c, cr * 0.32, 6, Math.PI / 6), WHITE, 1.6, 0.6, 8);
  });
  const rr = cr * 1.85;
  shapeTexture(scene, 'core_ring', rr + 4, (ctx, c) => {
    ctx.shadowColor = rgba(WHITE, 1);
    ctx.shadowBlur = 8 * RS;
    ctx.strokeStyle = rgba(WHITE, 0.75);
    ctx.lineWidth = 2;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(c, c, rr, a + 0.12, a + Math.PI / 3 - 0.12);
      ctx.stroke();
    }
    ctx.strokeStyle = rgba(WHITE, 0.5);
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
    g.addColorStop(0, rgba(WHITE, 0.55));
    g.addColorStop(0.18, rgba(WHITE, 0.16));
    g.addColorStop(0.5, rgba(WHITE, 0.05));
    g.addColorStop(1, rgba(WHITE, 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, L, L);
  });
}

/** Firewall structures (white, tinted per kind at draw time): a Bastion turret, barrel along +x, a mine and a Relay Station. */
function structures(scene: Phaser.Scene, data: GameData): void {
  const S = 48;
  const c = S / 2;
  const muzzle = data.structures.turret.muzzle;
  bake(scene, 'st_turret', S, S, (ctx) => {
    neon(ctx, regular(c, c, 8, 6, Math.PI / 6), WHITE, 1.6, 0.3, 7);
    ctx.lineCap = 'round';
    ctx.strokeStyle = rgba(WHITE, 1);
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(c, c);
    ctx.lineTo(c + muzzle, c);
    ctx.stroke();
  });
  // Relay Station: a hexagon with a thin ring around it (the image turns slowly, so the ring's gaps drift).
  bake(scene, 'st_station', S, S, (ctx) => {
    neon(ctx, regular(c, c, 10, 6, 0), WHITE, 1.6, 0.3, 7);
    ctx.strokeStyle = rgba(WHITE, 0.7);
    ctx.lineWidth = 1.2;
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.arc(c, c, 16, (i * Math.PI * 2) / 3, (i * Math.PI * 2) / 3 + 1.4);
      ctx.stroke();
    }
    ctx.fillStyle = rgba(WHITE, 1);
    ctx.fillRect(c - 1.5, c - 1.5, 3, 3);
  });
  bake(scene, 'st_mine', S, S, (ctx) => {
    neon(ctx, [[c, c - 7], [c + 6, c], [c, c + 7], [c - 6, c]], WHITE, 1.4, 0.25, 6);
    ctx.fillStyle = rgba(WHITE, 1);
    ctx.fillRect(c - 1.2, c - 1.2, 2.4, 2.4);
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
  bake(scene, 'ic_key', S, S, (ctx) => {
    ctx.shadowColor = rgba(KEY, 1);
    ctx.shadowBlur = 8 * RS;
    ctx.strokeStyle = rgba(KEY, 1);
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(c - 5, c, 6, 0, Math.PI * 2);
    ctx.moveTo(c + 1, c);
    ctx.lineTo(c + 13, c);
    ctx.moveTo(c + 9, c);
    ctx.lineTo(c + 9, c + 5);
    ctx.moveTo(c + 13, c);
    ctx.lineTo(c + 13, c + 6);
    ctx.stroke();
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

/** Strokes an open path as a neon tube: soft bloom, coloured line, white-hot core. */
function glow(ctx: Ctx, color: number, lw: number, path: () => void, fillA = 0): void {
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.shadowColor = rgba(color, 1);
  ctx.shadowBlur = 9 * RS;
  ctx.strokeStyle = rgba(color, 0.35);
  ctx.lineWidth = lw * 2.6;
  ctx.beginPath();
  path();
  ctx.stroke();
  if (fillA > 0) {
    ctx.shadowBlur = 0;
    ctx.fillStyle = rgba(color, fillA);
    ctx.fill();
  }
  ctx.shadowBlur = 6 * RS;
  ctx.strokeStyle = rgba(color, 1);
  ctx.lineWidth = lw;
  ctx.beginPath();
  path();
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = rgba(WHITE, 0.8);
  ctx.lineWidth = Math.max(0.8, lw * 0.35);
  ctx.beginPath();
  path();
  ctx.stroke();
}

/** Icon box for stat glyphs (logical px); glyphs are drawn within ±17 px of the centre (room for glow). */
export const STAT_ICON = 56;

type Glyph = (ctx: Ctx, c: number, col: number) => void;
const TAU = Math.PI * 2;
const bolt = (c: number, s: number): Pt[] => [[c + 3 * s, c - 13 * s], [c - 8 * s, c + 2 * s], [c - 1 * s, c + 2 * s], [c - 3 * s, c + 13 * s], [c + 8 * s, c - 2 * s], [c + 1 * s, c - 2 * s]];
const diamond = (x: number, y: number, r: number): Pt[] => [[x, y - r], [x + r * 0.8, y], [x, y + r], [x - r * 0.8, y]];
function polyPath(ctx: Ctx, pts: readonly Pt[], close = true): void {
  pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
  if (close) ctx.closePath();
}
function cross(ctx: Ctx, x: number, y: number, r: number): void {
  ctx.moveTo(x - r, y);
  ctx.lineTo(x + r, y);
  ctx.moveTo(x, y - r);
  ctx.lineTo(x, y + r);
}

const GLYPHS: Record<StatId, Glyph> = {
  damage: (ctx, c, col) => glow(ctx, col, 2.2, () => polyPath(ctx, [[c - 14, c + 14], [c + 4, c - 4], [c + 1, c - 9], [c + 15, c - 15], [c + 9, c - 1], [c + 4, c - 4], [c + 9, c - 1], [c - 9, c + 17]]), 0.25),
  attackSpeed: (ctx, c, col) =>
    glow(ctx, col, 2.6, () => {
      polyPath(ctx, [[c - 14, c - 12], [c - 2, c], [c - 14, c + 12]], false);
      polyPath(ctx, [[c, c - 12], [c + 12, c], [c, c + 12]], false);
    }),
  critChance: (ctx, c, col) =>
    glow(ctx, col, 2.2, () => {
      ctx.arc(c, c, 11, 0, TAU);
      ctx.moveTo(c + 3, c);
      ctx.arc(c, c, 3, 0, TAU);
      ctx.moveTo(c, c - 17);
      ctx.lineTo(c, c - 7);
      ctx.moveTo(c, c + 7);
      ctx.lineTo(c, c + 17);
      ctx.moveTo(c - 17, c);
      ctx.lineTo(c - 7, c);
      ctx.moveTo(c + 7, c);
      ctx.lineTo(c + 17, c);
    }),
  critFactor: (ctx, c, col) => {
    const pts: Pt[] = [];
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * TAU - Math.PI / 2;
      const r = i % 2 === 0 ? (i % 4 === 0 ? 17 : 12) : 6;
      pts.push([c + Math.cos(a) * r, c + Math.sin(a) * r]);
    }
    glow(ctx, col, 2, () => polyPath(ctx, pts), 0.3);
  },
  range: (ctx, c, col) =>
    glow(ctx, col, 2.2, () => {
      const ox = c - 12;
      const oy = c + 12;
      ctx.moveTo(ox + 2, oy);
      ctx.arc(ox, oy, 2, 0, TAU);
      for (const r of [11, 19, 27]) {
        ctx.moveTo(ox + r, oy);
        ctx.arc(ox, oy, r, 0, -Math.PI / 2, true);
      }
    }),
  multishot: (ctx, c, col) =>
    glow(ctx, col, 2, () => {
      polyPath(ctx, diamond(c - 10, c + 6, 7));
      polyPath(ctx, diamond(c, c - 6, 7));
      polyPath(ctx, diamond(c + 10, c + 6, 7));
    }, 0.3),
  health: (ctx, c, col) =>
    glow(ctx, col, 2.2, () => {
      polyPath(ctx, regular(c, c, 16, 6, Math.PI / 6));
      cross(ctx, c, c, 7);
    }, 0.2),
  regen: (ctx, c, col) =>
    glow(ctx, col, 2.2, () => {
      ctx.arc(c, c, 14, -Math.PI * 0.35, Math.PI * 1.35);
      polyPath(ctx, [[c + 4, c - 18], [c + 10, c - 12], [c + 3, c - 8]], false);
      cross(ctx, c, c, 6);
    }),
  defense: (ctx, c, col) =>
    glow(ctx, col, 2.2, () => polyPath(ctx, [[c, c - 17], [c + 14, c - 11], [c + 12, c + 4], [c, c + 17], [c - 12, c + 4], [c - 14, c - 11]]), 0.25),
  thorns: (ctx, c, col) => {
    const pts: Pt[] = [];
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * TAU;
      const r = i % 2 === 0 ? 17 : 9;
      pts.push([c + Math.cos(a) * r, c + Math.sin(a) * r]);
    }
    glow(ctx, col, 1.8, () => polyPath(ctx, pts), 0.2);
  },
  lifesteal: (ctx, c, col) =>
    glow(ctx, col, 2.2, () => {
      ctx.moveTo(c, c - 17);
      ctx.bezierCurveTo(c + 6, c - 7, c + 13, c, c + 12, c + 6);
      ctx.arc(c, c + 6, 12, 0, Math.PI, false);
      ctx.bezierCurveTo(c - 13, c, c - 6, c - 7, c, c - 17);
    }, 0.3),
  knockback: (ctx, c, col) =>
    glow(ctx, col, 2.4, () => {
      ctx.moveTo(c - 15, c - 15);
      ctx.lineTo(c - 15, c + 15);
      ctx.moveTo(c - 9, c);
      ctx.lineTo(c + 15, c);
      polyPath(ctx, [[c + 6, c - 9], [c + 15, c], [c + 6, c + 9]], false);
    }),
  energyBonus: (ctx, c, col) => {
    glow(ctx, col, 2, () => polyPath(ctx, bolt(c - 3, 1)), 0.3);
    glow(ctx, WHITE, 2, () => cross(ctx, c + 12, c - 11, 5));
  },
  energyPerWave: (ctx, c, col) => {
    glow(ctx, col, 2, () => polyPath(ctx, bolt(c, 0.85).map(([x, y]) => [x, y - 4] as Pt)), 0.3);
    glow(ctx, col, 2, () => polyPath(ctx, [[c - 16, c + 15], [c - 8, c + 9], [c, c + 15], [c + 8, c + 9], [c + 16, c + 15]], false));
  },
  interest: (ctx, c, col) =>
    glow(ctx, col, 2.4, () => {
      ctx.moveTo(c - 4, c - 10);
      ctx.arc(c - 9, c - 10, 5, 0, TAU);
      ctx.moveTo(c + 14, c + 10);
      ctx.arc(c + 9, c + 10, 5, 0, TAU);
      ctx.moveTo(c + 13, c - 16);
      ctx.lineTo(c - 13, c + 16);
    }),
  bitsPerKill: (ctx, c, col) => {
    glow(ctx, col, 2.2, () => polyPath(ctx, diamond(c - 2, c + 2, 15)), 0.3);
    glow(ctx, WHITE, 2, () => cross(ctx, c + 12, c - 11, 5));
  },
  bitsPerWave: (ctx, c, col) => {
    glow(ctx, col, 2, () => {
      polyPath(ctx, diamond(c - 6, c - 3, 11));
      polyPath(ctx, diamond(c + 7, c - 3, 11));
    }, 0.25);
    glow(ctx, col, 2, () => polyPath(ctx, [[c - 16, c + 15], [c - 8, c + 9], [c, c + 15], [c + 8, c + 9], [c + 16, c + 15]], false));
  },
  freeUpgrade: (ctx, c, col) =>
    glow(ctx, col, 2.2, () => {
      polyPath(ctx, chamfer(c - 15, c - 15, 30, 30, 7));
      polyPath(ctx, [[c - 8, c + 3], [c, c - 6], [c + 8, c + 3]], false);
      ctx.moveTo(c, c - 6);
      ctx.lineTo(c, c + 9);
    }),  // BUILD tab: a wall segment (brick hex), a hex with a healing arrow, a turret (hex + barrel), the same with speed chevrons, a mine (spiked diamond), a station (hex with an orbit ring).
  structHealth: (ctx, c, col) =>
    glow(ctx, col, 2.2, () => {
      polyPath(ctx, regular(c, c, 16, 6, Math.PI / 6));
      ctx.moveTo(c - 13, c - 4);
      ctx.lineTo(c + 13, c - 4);
      ctx.moveTo(c - 13, c + 5);
      ctx.lineTo(c + 13, c + 5);
      ctx.moveTo(c, c - 4);
      ctx.lineTo(c, c - 14);
      ctx.moveTo(c - 6, c + 5);
      ctx.lineTo(c - 6, c + 14);
    }, 0.2),
  structRegen: (ctx, c, col) =>
    glow(ctx, col, 2.2, () => {
      polyPath(ctx, regular(c, c, 8, 6, Math.PI / 6));
      ctx.moveTo(c + 14 * Math.cos(-Math.PI * 0.35), c + 14 * Math.sin(-Math.PI * 0.35));
      ctx.arc(c, c, 14, -Math.PI * 0.35, Math.PI * 1.35);
      polyPath(ctx, [[c + 4, c - 18], [c + 10, c - 12], [c + 3, c - 8]], false);
    }),
  turretDamage: (ctx, c, col) =>
    glow(ctx, col, 2.2, () => {
      polyPath(ctx, regular(c - 3, c + 3, 11, 6, Math.PI / 6));
      polyPath(ctx, [[c + 2, c - 2], [c + 15, c - 15], [c + 18, c - 12], [c + 5, c + 1]], false);
      cross(ctx, c - 3, c + 3, 4);
    }, 0.2),
  turretSpeed: (ctx, c, col) =>
    glow(ctx, col, 2.4, () => {
      polyPath(ctx, regular(c - 8, c + 6, 8, 6, Math.PI / 6));
      polyPath(ctx, [[c - 1, c - 3], [c + 6, c - 10], [c - 1, c - 17]], false);
      polyPath(ctx, [[c + 8, c - 3], [c + 15, c - 10], [c + 8, c - 17]], false);
      ctx.moveTo(c - 2, c + 1);
      ctx.lineTo(c + 6, c - 7);
    }),
  mineDamage: (ctx, c, col) =>
    glow(ctx, col, 2.2, () => {
      polyPath(ctx, [[c, c - 11], [c + 11, c], [c, c + 11], [c - 11, c]]);
      for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const) {
        ctx.moveTo(c + dx * 13, c + dy * 13);
        ctx.lineTo(c + dx * 18, c + dy * 18);
      }
      cross(ctx, c, c, 3);
    }, 0.25),
  stationIncome: (ctx, c, col) => {
    glow(ctx, col, 2.2, () => {
      polyPath(ctx, regular(c, c, 10, 6, Math.PI / 6));
      ctx.moveTo(c + 17, c);
      ctx.arc(c, c, 17, 0, TAU);
    }, 0.2);
    glow(ctx, WHITE, 2, () => polyPath(ctx, bolt(c, 0.45)));
  },
};

/** Stat glyphs (`st_<id>`, tinted by tab) and the padlock for locked rows. */
function statIcons(scene: Phaser.Scene, data: GameData): void {
  const c = STAT_ICON / 2;
  for (const id of STAT_IDS) {
    const col = TAB_COLOR[data.stats.stats[id].tab];
    bake(scene, `st_${id}`, STAT_ICON, STAT_ICON, (ctx) => GLYPHS[id](ctx, c, col));
  }
  bake(scene, 'ic_lock', STAT_ICON, STAT_ICON, (ctx) =>
    glow(ctx, LOCKED, 2.2, () => {
      ctx.moveTo(c - 7, c - 2);
      ctx.lineTo(c - 7, c - 8);
      ctx.arc(c, c - 8, 7, Math.PI, 0);
      ctx.lineTo(c + 7, c - 2);
      polyPath(ctx, [[c - 11, c - 2], [c + 11, c - 2], [c + 11, c + 14], [c - 11, c + 14]]);
    }, 0.25),
  );
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

/** Padding baked around every panel (glow room), in logical px. */
export const PANEL_PAD = 12;

/**
 * Like bakePanel, but keeps an existing texture under `key` (scenes are re-created on every run; replacing a
 * texture that the renderer still holds a reference to breaks the next draw).
 */
export function bakePanelOnce(scene: Phaser.Scene, key: string, w: number, h: number, st: PanelStyle = {}): number {
  return scene.textures.exists(key) ? PANEL_PAD : bakePanel(scene, key, w, h, st);
}

/** Bakes a glowing chamfered panel (UI frames, buttons). Returns the key and the padding around the box. */
export function bakePanel(scene: Phaser.Scene, key: string, w: number, h: number, st: PanelStyle = {}): number {
  const pad = PANEL_PAD;
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
  fragmentTextures(scene);
  core(scene, data);
  fx(scene);
  structures(scene, data);
  icons(scene);
  statIcons(scene, data);
}


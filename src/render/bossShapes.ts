// Tier boss bodies without Phaser (c1, uniqueness plan item 8; notes in 2026-10-20-uniqueness-notes-c1.md): the look
// of each boss (mechanic colour, segment count), its idle pose (the pose() approach of virusShapes.ts), the canvas
// drawings textures.ts bakes (`b_<id>` head, `b_<id>_seg` trailing segment) and the telegraph drawn before or during
// its mechanic. Render only; it reads sim state and never writes it.
import { bossDef, shieldPhase, shieldProgress } from '../sim/bosses';
import type { GameData } from '../sim/data';
import type { Enemy } from '../sim/state';
import { VIRUS_BODY } from './palette';
import type { Pose } from './virusShapes';

const TAU = Math.PI * 2;

export interface BossLook {
  /** Body colour: the colour of its mechanic. */
  color: number;
  accent: number;
  css: string;
  /** Trailing segments (0 = a lone body). */
  segments: number;
}

/** Mechanic colours: shield blue, brood pink, Energy gold, aura steel, artillery acid green, mutagen crimson. */
export const BOSS_LOOK: Readonly<Record<string, BossLook>> = {
  overseer: { color: 0x3d7bff, accent: 0xcfe4ff, css: '#6f9dff', segments: 2 },
  broodmother: { color: 0xff7ad9, accent: 0xffd6f3, css: '#ff7ad9', segments: 6 },
  siphon: { color: 0xffd23f, accent: 0xfff3b0, css: '#ffd23f', segments: 4 },
  swarmlord: { color: 0x9aa6ff, accent: 0xffffff, css: '#b4bcff', segments: 3 },
  artillery: { color: 0x3dff52, accent: 0xe0ffb0, css: '#3dff52', segments: 0 },
  mutagen: { color: 0xff2d55, accent: 0x7dffea, css: '#ff4d6d', segments: 5 },
};
const FALLBACK: BossLook = { color: 0xff2d55, accent: 0xffd0dc, css: '#ff6b8b', segments: 6 };

export function bossLook(id: string | undefined): BossLook {
  return (id !== undefined ? BOSS_LOOK[id] : undefined) ?? FALLBACK;
}

export const bossTexKey = (id: string): string => `b_${id}`;
export const bossSegKey = (id: string): string => `b_${id}_seg`;
/** Blur padding baked around a boss body (logical px). */
export const BOSS_PAD = 18;
/** Side of a boss head texture of radius `r` (logical px; the head reaches 1.35 r with its spikes or barrel). */
export const bossTexSize = (r: number): number => Math.ceil((r * 1.35 + BOSS_PAD) * 2);

/**
 * Idle motion per boss: the Overseer's eye and the Artillery's barrel face the core, the Broodmother's abdomen breathes,
 * the Siphon pumps, the Swarm Lord's crown turns, the Mutagen wobbles out of step on both axes.
 */
export function bossPose(id: string, now: number, eid: number, toCore: number, enraged: boolean, out: Pose): Pose {
  switch (id) {
    case 'overseer': {
      const p = 1 + 0.03 * Math.sin(now / 420 + eid);
      out.rot = toCore + 0.12 * Math.sin(now / 900 + eid);
      out.sx = p;
      out.sy = p;
      return out;
    }
    case 'broodmother': {
      const b = Math.sin(now / 340 + eid);
      out.rot = toCore + 0.08 * Math.sin(now / 700 + eid);
      out.sx = 1 + 0.06 * b;
      out.sy = 1 - 0.04 * b;
      return out;
    }
    case 'siphon': {
      const s = Math.sin(now / 150 + eid);
      out.rot = toCore;
      out.sx = 1 + 0.09 * s * s;
      out.sy = 1 - 0.04 * s * s;
      return out;
    }
    case 'swarmlord':
      out.rot = now * 0.0007 + eid;
      out.sx = 1;
      out.sy = 1;
      return out;
    case 'artillery':
      out.rot = toCore;
      out.sx = 1;
      out.sy = 1;
      return out;
    default: {
      const f = enraged ? 2.2 : 1;
      out.rot = now * 0.0005 * f + eid;
      out.sx = 1 + 0.07 * Math.sin((now / 260) * f + eid);
      out.sy = 1 + 0.07 * Math.sin((now / 330) * f + eid + 1.3);
      return out;
    }
  }
}

// ---- Canvas drawings (baked once by textures.ts). Heads face +x, the heading to the core. ----

type Ctx = CanvasRenderingContext2D;

function rgba(c: number, a: number): string {
  return `rgba(${(c >> 16) & 255},${(c >> 8) & 255},${c & 255},${a})`;
}

/** Dark fill + glowing outline of the current path. */
function shell(ctx: Ctx, color: number, lw: number, blur: number, fillA = 0.85): void {
  ctx.lineJoin = 'round';
  ctx.fillStyle = rgba(VIRUS_BODY, fillA);
  ctx.fill();
  ctx.shadowColor = rgba(color, 1);
  ctx.shadowBlur = blur;
  ctx.strokeStyle = rgba(color, 1);
  ctx.lineWidth = lw;
  ctx.stroke();
  ctx.shadowBlur = 0;
}

function disc(ctx: Ctx, x: number, y: number, r: number, color: number, a: number, blur: number): void {
  ctx.shadowColor = rgba(color, 1);
  ctx.shadowBlur = blur;
  ctx.fillStyle = rgba(color, a);
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fill();
  ctx.shadowBlur = 0;
}

function circlePath(ctx: Ctx, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
}

function polyPath(ctx: Ctx, pts: readonly (readonly [number, number])[]): void {
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
  ctx.closePath();
}

function ring(n: number, cx: number, cy: number, r: number, rot: number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) out.push([cx + Math.cos(rot + (i / n) * TAU) * r, cy + Math.sin(rot + (i / n) * TAU) * r]);
  return out;
}

/** Draws boss `id`'s head of radius `r` centred at (c, c); `blur` is the shadow blur at the bake resolution. */
export function drawBossHead(ctx: Ctx, id: string, c: number, r: number, blur: number): void {
  const L = bossLook(id);
  const C = L.color;
  const A = L.accent;
  switch (id) {
    case 'overseer': {
      // A watcher: six armour plates (gapped hex shell) around a round body with one big eye.
      for (let i = 0; i < 6; i++) {
        const a0 = (i / 6) * TAU + 0.12;
        const a1 = ((i + 1) / 6) * TAU - 0.12;
        ctx.beginPath();
        ctx.arc(c, c, r * 1.12, a0, a1);
        ctx.arc(c, c, r * 0.86, a1, a0, true);
        ctx.closePath();
        shell(ctx, C, 2.6, blur, 0.7);
      }
      circlePath(ctx, c, c, r * 0.72);
      shell(ctx, C, 3, blur);
      ctx.beginPath();
      ctx.ellipse(c + r * 0.12, c, r * 0.46, r * 0.3, 0, 0, TAU);
      shell(ctx, A, 2, blur, 0.4);
      disc(ctx, c + r * 0.2, c, r * 0.18, C, 1, blur);
      ctx.fillStyle = rgba(0x000000, 0.9);
      ctx.beginPath();
      ctx.ellipse(c + r * 0.2, c, r * 0.05, r * 0.15, 0, 0, TAU);
      ctx.fill();
      disc(ctx, c + r * 0.27, c - r * 0.08, r * 0.05, 0xffffff, 1, blur * 0.4);
      return;
    }
    case 'broodmother': {
      // A swollen abdomen trailing egg sacs, a small head forward.
      const bx = c - r * 0.12;
      for (const [x, y] of ring(9, bx, c, r * 0.82, Math.PI * 0.62).slice(0, 7)) {
        circlePath(ctx, x, y, r * 0.2);
        shell(ctx, C, 1.8, blur * 0.7, 0.75);
        disc(ctx, x, y, r * 0.07, A, 1, blur * 0.5);
      }
      ctx.beginPath();
      ctx.ellipse(bx, c, r * 0.74, r * 0.66, 0, 0, TAU);
      shell(ctx, C, 3.2, blur);
      for (let i = 0; i < 3; i++) {
        ctx.strokeStyle = rgba(A, 0.45);
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.ellipse(bx - r * 0.1, c, r * (0.2 + i * 0.16), r * (0.18 + i * 0.14), 0, -1.1, 1.1);
        ctx.stroke();
      }
      circlePath(ctx, c + r * 0.78, c, r * 0.3);
      shell(ctx, C, 2.4, blur);
      disc(ctx, c + r * 0.86, c - r * 0.1, r * 0.06, A, 1, blur * 0.5);
      disc(ctx, c + r * 0.86, c + r * 0.1, r * 0.06, A, 1, blur * 0.5);
      return;
    }
    case 'siphon': {
      // A tick: six legs, an oval body with an Energy reservoir, a long proboscis and two fangs forward.
      ctx.strokeStyle = rgba(C, 0.9);
      ctx.lineWidth = 2.2;
      ctx.shadowColor = rgba(C, 1);
      ctx.shadowBlur = blur * 0.6;
      for (const s of [-1, 1]) {
        for (let i = 0; i < 3; i++) {
          const x0 = c - r * 0.25 + i * r * 0.28;
          ctx.beginPath();
          ctx.moveTo(x0, c + s * r * 0.4);
          ctx.lineTo(x0 - r * 0.12, c + s * r * 0.85);
          ctx.lineTo(x0 - r * 0.3, c + s * r * 1.05);
          ctx.stroke();
        }
      }
      ctx.shadowBlur = 0;
      polyPath(ctx, [[c + r * 0.5, c - r * 0.1], [c + r * 1.32, c], [c + r * 0.5, c + r * 0.1]]);
      shell(ctx, A, 1.8, blur);
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(c + r * 0.5, c + s * r * 0.2);
        ctx.quadraticCurveTo(c + r * 0.95, c + s * r * 0.42, c + r * 1.0, c + s * r * 0.12);
        ctx.strokeStyle = rgba(C, 1);
        ctx.lineWidth = 2.6;
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.ellipse(c, c, r * 0.72, r * 0.56, 0, 0, TAU);
      shell(ctx, C, 3.2, blur);
      const g = ctx.createRadialGradient(c - r * 0.1, c, 0, c - r * 0.1, c, r * 0.42);
      g.addColorStop(0, rgba(0xffffff, 0.9));
      g.addColorStop(0.4, rgba(C, 0.7));
      g.addColorStop(1, rgba(C, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(c - r * 0.1, c, r * 0.42, 0, TAU);
      ctx.fill();
      return;
    }
    case 'swarmlord': {
      // A crown: an eight-point star around a ring of minion beads.
      const pts: [number, number][] = [];
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * TAU;
        const rr = i % 2 === 0 ? r * 1.28 : r * 0.7;
        pts.push([c + Math.cos(a) * rr, c + Math.sin(a) * rr]);
      }
      polyPath(ctx, pts);
      shell(ctx, C, 3, blur);
      circlePath(ctx, c, c, r * 0.5);
      shell(ctx, A, 2, blur, 0.5);
      for (const [x, y] of ring(5, c, c, r * 0.3, 0.3)) disc(ctx, x, y, r * 0.075, C, 1, blur * 0.5);
      disc(ctx, c, c, r * 0.12, A, 1, blur);
      return;
    }
    case 'artillery': {
      // A gun: rear fins, a squat armoured body, a long barrel with a muzzle ring.
      for (const s of [-1, 1]) {
        polyPath(ctx, [[c - r * 0.3, c + s * r * 0.45], [c - r * 1.05, c + s * r * 0.95], [c - r * 0.75, c + s * r * 0.25]]);
        shell(ctx, C, 2.2, blur, 0.7);
      }
      polyPath(ctx, [[c + r * 0.25, c - r * 0.17], [c + r * 1.25, c - r * 0.13], [c + r * 1.25, c + r * 0.13], [c + r * 0.25, c + r * 0.17]]);
      shell(ctx, C, 2.6, blur);
      ctx.beginPath();
      ctx.ellipse(c + r * 1.25, c, r * 0.08, r * 0.24, 0, 0, TAU);
      shell(ctx, A, 2.4, blur, 0.6);
      polyPath(ctx, ring(8, c - r * 0.1, c, r * 0.68, Math.PI / 8));
      shell(ctx, C, 3.4, blur);
      circlePath(ctx, c - r * 0.1, c, r * 0.3);
      shell(ctx, A, 1.8, blur, 0.3);
      disc(ctx, c - r * 0.1, c, r * 0.12, A, 1, blur);
      return;
    }
    default: {
      // Mutagen: an irregular, lumpy blob with a glowing double helix inside.
      const pts: [number, number][] = [];
      for (let i = 0; i < 48; i++) {
        const a = (i / 48) * TAU;
        const rr = r * (0.92 + 0.12 * Math.sin(a * 5 + 0.7) + 0.08 * Math.sin(a * 3 + 2.1) + 0.05 * Math.sin(a * 11));
        pts.push([c + Math.cos(a) * rr, c + Math.sin(a) * rr]);
      }
      polyPath(ctx, pts);
      shell(ctx, C, 3.4, blur);
      ctx.shadowColor = rgba(A, 1);
      ctx.shadowBlur = blur * 0.6;
      for (const ph of [0, Math.PI]) {
        ctx.beginPath();
        for (let i = 0; i <= 30; i++) {
          const t = i / 30;
          const x = c - r * 0.6 + t * r * 1.2;
          const y = c + Math.sin(t * TAU * 1.5 + ph) * r * 0.26;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = rgba(A, 1);
        ctx.lineWidth = 2.4;
        ctx.stroke();
      }
      ctx.lineWidth = 1.4;
      ctx.strokeStyle = rgba(A, 0.6);
      for (let i = 1; i < 9; i++) {
        const t = i / 9;
        const x = c - r * 0.6 + t * r * 1.2;
        const y0 = Math.sin(t * TAU * 1.5) * r * 0.26;
        ctx.beginPath();
        ctx.moveTo(x, c + y0);
        ctx.lineTo(x, c - y0);
        ctx.stroke();
      }
      ctx.shadowBlur = 0;
    }
  }
}

/** A trailing segment of boss `id` (radius `r` of the head; WorldView scales it down toward the tail). */
export function drawBossSeg(ctx: Ctx, id: string, c: number, r: number, blur: number): void {
  const L = bossLook(id);
  const R = r * 0.6;
  if (id === 'broodmother') {
    circlePath(ctx, c, c, R);
    shell(ctx, L.color, 2.4, blur, 0.75);
    for (const [x, y] of ring(3, c, c, R * 0.45, 0.4)) disc(ctx, x, y, R * 0.2, L.accent, 1, blur * 0.5);
    return;
  }
  const sides = id === 'overseer' ? 6 : id === 'swarmlord' ? 8 : id === 'siphon' ? 0 : 5;
  if (sides === 0) {
    ctx.beginPath();
    ctx.ellipse(c, c, R, R * 0.78, 0, 0, TAU);
  } else polyPath(ctx, ring(sides, c, c, R, Math.PI / sides));
  shell(ctx, L.color, 2.6, blur);
  disc(ctx, c, c, R * 0.24, L.accent, 1, blur * 0.6);
}

// ---- Telegraphs (drawn every frame into a Phaser Graphics; structurally typed so this file stays Phaser-free). ----

export interface TeleGfx {
  lineStyle(width: number, color: number, alpha?: number): unknown;
  fillStyle(color: number, alpha?: number): unknown;
  strokeCircle(x: number, y: number, r: number): unknown;
  fillCircle(x: number, y: number, r: number): unknown;
  lineBetween(x1: number, y1: number, x2: number, y2: number): unknown;
  beginPath(): unknown;
  arc(x: number, y: number, r: number, a0: number, a1: number): unknown;
  strokePath(): unknown;
}

export interface TeleView {
  /** Boss centre and the core centre (screen px). */
  sx: number;
  sy: number;
  cx: number;
  cy: number;
  /** Boss body radius on screen. */
  r: number;
  /** World → screen scale. */
  scale: number;
  now: number;
  fade: number;
}

function dashedRing(g: TeleGfx, x: number, y: number, r: number, n: number, rot: number): void {
  for (let i = 0; i < n; i++) {
    const a = rot + (i / n) * TAU;
    g.beginPath();
    g.arc(x, y, r, a, a + (TAU / n) * 0.55);
    g.strokePath();
  }
}

function polyRing(g: TeleGfx, x: number, y: number, r: number, n: number, rot: number): void {
  for (let i = 0; i < n; i++) {
    const a0 = rot + (i / n) * TAU;
    const a1 = rot + ((i + 1) / n) * TAU;
    g.lineBetween(x + Math.cos(a0) * r, y + Math.sin(a0) * r, x + Math.cos(a1) * r, y + Math.sin(a1) * r);
  }
}

/** Which telegraph a boss shows now (tests and the HUD read it too): '' = none. */
export type Tele = '' | 'shieldWarn' | 'shield' | 'aim' | 'brood' | 'drain' | 'enrageWarn' | 'enraged';

/** The boss's telegraph state at this frame (sim state only: readable in tests). */
export function bossTele(data: GameData, e: Enemy): Tele {
  const b = bossDef(data, e);
  if (b === undefined) return '';
  if (b.shieldEvery !== undefined) {
    const p = shieldPhase(data, b, e.bt ?? 0);
    return p === 2 ? 'shield' : p === 1 ? 'shieldWarn' : '';
  }
  if (b.shotWarn !== undefined) return e.attackCd > 0 && e.attackCd <= b.shotWarn * data.config.tickHz ? 'aim' : '';
  if (b.broodStep !== undefined) {
    const next = 1 - ((e.brood ?? 0) + 1) * b.broodStep;
    return next > 0 && e.hp / e.maxHp - next < 0.06 ? 'brood' : '';
  }
  if (b.drainEnergy !== undefined) return (e.drained ?? 0) > 0 ? 'drain' : '';
  if (b.enrageAt !== undefined) return e.enraged === true ? 'enraged' : e.hp / e.maxHp < b.enrageAt + 0.08 ? 'enrageWarn' : '';
  return '';
}

/**
 * The boss's telegraph, thick and blinking so it reads on a phone: the Overseer's contracting ring before the shield
 * and a hex bubble with a countdown arc while it holds; the Artillery's aim laser and core reticle while it charges;
 * the Broodmother's egg ring near an HP step; the Siphon's Energy tether; the Swarm Lord's aura; the Mutagen's rage ring.
 */
export function drawBossTelegraph(g: TeleGfx, data: GameData, e: Enemy, v: TeleView): void {
  const b = bossDef(data, e);
  if (b === undefined) return;
  const L = bossLook(e.boss);
  const { sx, sy, r, now, fade } = v;
  const lw = Math.max(3, r * 0.12);
  const blink = 0.55 + 0.45 * Math.sin(now / 70);
  const t = bossTele(data, e);
  if (b.auraRadius !== undefined) {
    const ar = b.auraRadius * v.scale;
    const breathe = 0.85 + 0.15 * Math.sin(now / 500 + e.id);
    g.fillStyle(L.color, 0.06 * fade);
    g.fillCircle(sx, sy, ar);
    g.lineStyle(lw * 0.8, L.color, 0.6 * fade * breathe);
    dashedRing(g, sx, sy, ar, 16, -now * 0.0005);
  }
  if (t === 'shieldWarn') {
    const p = shieldProgress(data, b, e.bt ?? 0);
    g.lineStyle(lw, L.accent, blink * fade);
    g.strokeCircle(sx, sy, r * (2.4 - 1.1 * p));
    g.lineStyle(lw * 2.5, L.color, 0.2 * fade);
    g.strokeCircle(sx, sy, r * (2.4 - 1.1 * p));
  } else if (t === 'shield') {
    const p = shieldProgress(data, b, e.bt ?? 0);
    g.fillStyle(L.color, 0.22 * fade);
    g.fillCircle(sx, sy, r * 1.3);
    g.lineStyle(lw * 1.2, L.accent, 0.95 * fade);
    polyRing(g, sx, sy, r * 1.35, 6, now * 0.001);
    g.lineStyle(lw * 0.7, L.color, 0.9 * fade);
    g.beginPath();
    g.arc(sx, sy, r * 1.6, -Math.PI / 2, -Math.PI / 2 + TAU * (1 - p));
    g.strokePath();
  } else if (t === 'aim') {
    const warn = b.shotWarn! * data.config.tickHz;
    const p = 1 - e.attackCd / warn;
    g.lineStyle(Math.max(2, lw * 0.5), L.color, (0.25 + 0.6 * p) * blink * fade);
    g.lineBetween(sx, sy, v.cx, v.cy);
    g.lineStyle(lw, L.accent, (0.5 + 0.5 * p) * fade);
    g.strokeCircle(sx, sy, r * (2 - 0.8 * p));
    const rr = Math.max(18, 40 * v.scale) * (1.6 - 0.6 * p);
    g.lineStyle(lw, L.color, blink * fade);
    g.strokeCircle(v.cx, v.cy, rr);
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2 + now * 0.002;
      g.lineBetween(v.cx + Math.cos(a) * rr * 0.6, v.cy + Math.sin(a) * rr * 0.6, v.cx + Math.cos(a) * rr * 1.25, v.cy + Math.sin(a) * rr * 1.25);
    }
  } else if (t === 'brood') {
    g.fillStyle(L.accent, blink * fade);
    for (let i = 0; i < b.broodCount!; i++) {
      const a = now * 0.002 + (i / b.broodCount!) * TAU;
      g.fillCircle(sx + Math.cos(a) * r * 1.45, sy + Math.sin(a) * r * 1.45, Math.max(4, r * 0.18));
    }
    g.lineStyle(lw * 0.6, L.color, 0.6 * blink * fade);
    g.strokeCircle(sx, sy, r * 1.45);
  } else if (t === 'drain') {
    const d = Math.hypot(sx - v.cx, sy - v.cy);
    if (d < r * 3.5) {
      g.lineStyle(lw * 0.8, L.color, 0.75 * blink * fade);
      g.lineBetween(sx, sy, v.cx, v.cy);
    }
    g.fillStyle(L.color, 0.18 * blink * fade);
    g.fillCircle(sx, sy, r * 1.25);
  } else if (t === 'enrageWarn') {
    g.lineStyle(lw * 0.7, L.color, 0.5 * blink * fade);
    dashedRing(g, sx, sy, r * 1.5, 10, now * 0.003);
  } else if (t === 'enraged') {
    const q = (now % 600) / 600;
    g.lineStyle(lw, L.color, (1 - q) * fade);
    g.strokeCircle(sx, sy, r * (1.2 + 0.8 * q));
    g.lineStyle(lw * 0.6, L.accent, 0.8 * blink * fade);
    dashedRing(g, sx, sy, r * 1.25, 8, -now * 0.006);
  }
}

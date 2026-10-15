// Draws the territory hex map (spec 2026-10-14 §B) and the crystal (§A, spec 2026-10-15 §4). Owned cells glow
// faintly in their sector's tag colour, infected cells are crimson, and the front line between them is a
// bright edge. The crystal lives in one container at the core centre (core-relative coordinates, so the
// editor can zoom it): each same-tag cluster is a plate (its hexes filled in the tag colour, only its outer
// edges stroked; bright with a glow and a tier badge while it is the tag's live set), each module a dark hex
// with its glyph and stack count (pips when small), and each link between two tags a two-colour weld across
// the shared edge (faint until the pair fuses, then pulsing, with a I / II / III diamond on its first link).
// When the hexes get small (LOD) a cluster shows one glyph instead of one per module. Placement mode blinks
// colours the free slots by what they would add and pulses the auto slot; hovering a module outlines its
// cluster. The editor (src/ui/CrystalEditor.ts) zooms the container above a scrim, adds the sector wedges and
// the core under the modules, and shows the selected module and its move targets. This view only reads the
// World.

import Phaser from 'phaser';
import { crystalSlots, type FusionLink, fusionLinks, moduleCluster, type Module, sectorTags } from '../sim/crystal';
import type { GameData } from '../sim/data';
import { HEX_DIRS, hexDist, hexToPixel, pixelToHex, SECTOR_DIRS } from '../sim/hex';
import type { Tag } from '../sim/perkData';
import type { World } from '../sim/state';
import { arenaRadius, cellId, crystalRing, terrainFor } from '../sim/territory';
import { drawTagIcon } from '../ui/tagIcon';
import type { Layout } from '../ui/layout';
import { CRIMSON, CYAN, ENERGY, TAG_COLOR } from './palette';
import { coreColors, DEPTH } from './WorldView';

const DEG = Math.PI / 180;
/** Hex size (px at the 16 px reference font) below which a cluster shows one glyph, not one per module. */
const LOD_R = 11;
/** …and at or above which a module shows its stack count as a number instead of pips. */
const DIGIT_R = 14;
const DARK = 0x050914;

export interface Placement {
  tag: Tag;
  free: [number, number][];
  /** Outline colour per free slot (what it would add), parallel to `free`; CYAN when absent. */
  colors?: number[];
  auto: [number, number] | null;
}

/** The editor's Arrange state: the selected module, where it may go (coloured by the outcome), a drag ghost. */
export interface EditState {
  selected: number;
  targets: { q: number; r: number; color: number }[];
  /** Screen point of the dragged module, or null. */
  ghost: [number, number] | null;
}

interface Cluster {
  tag: Tag;
  members: number[];
  /** True for the tag's counted cluster while its set tier is on. */
  on: boolean;
}

// Seven-segment digits (segments a–g as bits 0–6): crisp at any zoom, no Text objects to scale or blur.
const SEG = [0x3f, 0x06, 0x5b, 0x4f, 0x66, 0x6d, 0x7d, 0x07, 0x7f, 0x6f];

/** Draws digit `n` (0–9) centred at (cx, cy), `h` tall. */
function drawDigit(g: Phaser.GameObjects.Graphics, n: number, cx: number, cy: number, h: number, color: number, alpha = 1): void {
  const m = SEG[n] ?? 0;
  const w = h * 0.55;
  const x0 = cx - w / 2;
  const x1 = cx + w / 2;
  const y0 = cy - h / 2;
  const y1 = cy;
  const y2 = cy + h / 2;
  g.lineStyle(Math.max(1.5, h * 0.17), color, alpha);
  const seg: [number, number, number, number][] = [
    [x0, y0, x1, y0], [x1, y0, x1, y1], [x1, y1, x1, y2], [x0, y2, x1, y2], [x0, y1, x0, y2], [x0, y0, x0, y1], [x0, y1, x1, y1],
  ];
  for (let i = 0; i < 7; i++) if (m & (1 << i)) g.lineBetween(...seg[i]!);
}

/** Draws a number (any width) centred at (cx, cy). */
function drawNumber(g: Phaser.GameObjects.Graphics, n: number, cx: number, cy: number, h: number, color: number, alpha = 1): void {
  const ds = String(Math.max(0, Math.floor(n)));
  const step = h * 0.8;
  for (let i = 0; i < ds.length; i++) drawDigit(g, ds.charCodeAt(i) - 48, cx + (i - (ds.length - 1) / 2) * step, cy, h, color, alpha);
}

export class CrystalView {
  private readonly land: Phaser.GameObjects.Graphics;
  private readonly front: Phaser.GameObjects.Graphics;
  private readonly nests: Phaser.GameObjects.Graphics;
  /** The crystal layers, in draw order, inside one container at the core centre. */
  private readonly root: Phaser.GameObjects.Container;
  private readonly under: Phaser.GameObjects.Graphics;
  private readonly plates: Phaser.GameObjects.Graphics;
  private readonly glow: Phaser.GameObjects.Graphics;
  private readonly mods: Phaser.GameObjects.Graphics;
  private readonly weldGlow: Phaser.GameObjects.Graphics;
  private readonly welds: Phaser.GameObjects.Graphics;
  private readonly badges: Phaser.GameObjects.Graphics;
  private readonly shade: Phaser.GameObjects.Graphics;
  private readonly slots: Phaser.GameObjects.Graphics;
  private readonly hl: Phaser.GameObjects.Graphics;
  private seams: FusionLink[] = [];
  /** Pairs that just reached a fusion tier: sparks run along every link of the pair for a moment. */
  private readonly bursts: { key: string; at: number }[] = [];
  private landKey = -1;
  private modKey = '';
  /** Screen px per world px while the editor zooms the crystal; null = the layout's scale. */
  private zoom: number | null = null;
  /** Non-null while the player is choosing a hex for a new module. */
  placing: Placement | null = null;
  /** Non-null while the editor arranges the crystal. */
  edit: EditState | null = null;
  /** Module indices outlined as the hovered cluster (empty = none). */
  hover: number[] = [];

  constructor(
    scene: Phaser.Scene,
    private readonly L: Layout,
    private readonly data: GameData,
  ) {
    this.land = scene.add.graphics().setDepth(DEPTH.grid + 0.5);
    this.front = scene.add.graphics().setDepth(DEPTH.light + 0.5).setBlendMode(Phaser.BlendModes.ADD);
    this.nests = scene.add.graphics().setDepth(DEPTH.light + 0.6).setBlendMode(Phaser.BlendModes.ADD);
    const add = Phaser.BlendModes.ADD;
    this.under = scene.make.graphics({}, false);
    this.plates = scene.make.graphics({}, false);
    this.glow = scene.make.graphics({}, false).setBlendMode(add);
    this.mods = scene.make.graphics({}, false);
    this.weldGlow = scene.make.graphics({}, false).setBlendMode(add);
    this.welds = scene.make.graphics({}, false);
    this.badges = scene.make.graphics({}, false);
    this.shade = scene.make.graphics({}, false);
    this.slots = scene.make.graphics({}, false).setBlendMode(add);
    this.hl = scene.make.graphics({}, false).setBlendMode(add);
    this.root = scene.add
      .container(L.cx, L.cy, [this.under, this.plates, this.glow, this.mods, this.weldGlow, this.welds, this.badges, this.shade, this.slots, this.hl])
      .setDepth(DEPTH.core - 0.5);
  }

  /**
   * Editor zoom: `scale` = screen px per world px (the container rises above the scrim at overlay − 5);
   * null restores the battle view.
   */
  setZoom(z: { scale: number } | null): void {
    this.zoom = z ? z.scale : null;
    this.root.setDepth(z ? DEPTH.overlay - 5 : DEPTH.core - 0.5);
  }

  get zoomed(): boolean {
    return this.zoom !== null;
  }

  /** A pair just reached a fusion tier (the `fusion` event): sparks race along all its links for a moment. */
  fused(key: string, now: number): void {
    this.bursts.push({ key, at: now });
  }

  draw(w: World, sectors: readonly (Tag | null)[], now: number): void {
    let key = sectors.length * 1009 + arenaRadius(this.data, w.wave) * 7 + Math.round(this.L.scale * 1e4);
    for (let i = 0; i < sectors.length; i++) key = Math.imul(key, 31) + (sectors[i] === null ? 0 : sectors[i]!.length * 7 + sectors[i]!.charCodeAt(0));
    for (let i = 0; i < w.terrain.length; i++) if (w.terrain[i] === 1) key = Math.imul(key ^ i, 0x9e3779b1);
    if (key !== this.landKey) {
      this.landKey = key;
      this.drawLand(w, sectors);
    }
    let mk = `${this.k};${this.zoom === null ? 0 : crystalRing(this.data, w.wave)};`;
    for (const m of w.crystal) mk += `${m.q},${m.r},${m.perk},${w.perks[m.perk] ?? 0};`;
    for (const k in w.setTiers) mk += `${k}:${w.setTiers[k as Tag]};`;
    for (const k in w.fusionTiers) mk += `${k}:${w.fusionTiers[k]};`;
    if (mk !== this.modKey) {
      this.modKey = mk;
      this.seams = fusionLinks(w, this.data);
      this.drawCrystal(w);
    }
    this.drawWelds(w, now);
    this.drawSlots(w, now);
    this.drawNests(w, now);
    this.drawHover(w, now);
  }

  /** Screen px per world px for the crystal. */
  private get k(): number {
    return this.zoom ?? this.L.scale;
  }

  /** Container-local position of crystal hex (q, r) (px from the core centre at the current zoom). */
  private local(q: number, r: number): [number, number] {
    const [x, y] = hexToPixel(q, r, this.data.crystal.cellSize);
    return [x * this.k, y * this.k];
  }

  /** Hex size on screen. */
  get R(): number {
    return this.data.crystal.cellSize * this.k;
  }

  /** Screen position of crystal hex (q, r). */
  hexScreen(q: number, r: number): [number, number] {
    const [x, y] = this.local(q, r);
    return [this.root.x + x, this.root.y + y];
  }

  /** The crystal hex under screen point (sx, sy). */
  hexAt(sx: number, sy: number): [number, number] {
    return pixelToHex((sx - this.root.x) / this.k, (sy - this.root.y) / this.k, this.data.crystal.cellSize);
  }

  /** Index in World.crystal of the module under screen point (sx, sy), or -1. */
  moduleAt(w: World, sx: number, sy: number): number {
    const [q, r] = this.hexAt(sx, sy);
    return w.crystal.findIndex((m) => m.q === q && m.r === r);
  }

  /** The free slot under screen point (sx, sy) while placing, or null. */
  slotAt(sx: number, sy: number): [number, number] | null {
    if (!this.placing) return null;
    const [q, r] = this.hexAt(sx, sy);
    return this.placing.free.find(([fq, fr]) => fq === q && fr === r) ?? null;
  }

  private hex(g: Phaser.GameObjects.Graphics, cx: number, cy: number, R: number, fill: boolean): void {
    const pts: Phaser.Types.Math.Vector2Like[] = [];
    for (let i = 0; i < 6; i++) pts.push({ x: cx + R * Math.cos((60 * i - 30) * DEG), y: cy + R * Math.sin((60 * i - 30) * DEG) });
    if (fill) g.fillPoints(pts, true);
    else g.strokePoints(pts, true);
  }

  private drawLand(w: World, sectors: readonly (Tag | null)[]): void {
    const L = this.L;
    const grid = terrainFor(this.data);
    const R = this.data.territory.cellSize * L.scale;
    const land = this.land.clear();
    const front = this.front.clear();
    // Only the current arena: the ground beyond the spawn ring appears as the breach widens.
    const lim = arenaRadius(this.data, w.wave) + this.data.territory.cellSize;
    for (let i = 0; i < grid.x.length; i++) {
      if (grid.d2[i]! > lim * lim) continue;
      const cx = L.cx + grid.x[i]! * L.scale;
      const cy = L.cy + grid.y[i]! * L.scale;
      const own = w.terrain[i] === 1;
      const tag = sectors[grid.sector[i]!] ?? null;
      const color = own ? (tag === null ? CYAN : TAG_COLOR[tag]) : CRIMSON;
      land.fillStyle(color, own ? (tag === null ? 0.025 : 0.07) : 0.1);
      this.hex(land, cx, cy, R * 0.94, true);
      land.lineStyle(1, color, own ? 0.08 : 0.16);
      this.hex(land, cx, cy, R * 0.94, false);
      if (!own) continue;
      // Front line: the edges of an owned cell that face an infected neighbour.
      for (let d = 0; d < 6; d++) {
        const j = cellId(grid, grid.q[i]! + HEX_DIRS[d]![0], grid.r[i]! + HEX_DIRS[d]![1]);
        if (j < 0 || w.terrain[j] === 1) continue;
        const a0 = (-60 * d - 30) * DEG;
        const a1 = (-60 * d + 30) * DEG;
        front.lineStyle(2.5, CRIMSON, 0.85);
        front.lineBetween(cx + R * Math.cos(a0), cy + R * Math.sin(a0), cx + R * Math.cos(a1), cy + R * Math.sin(a1));
      }
    }
    // Once the breach has widened, a faint gold ring marks where far kills start paying more.
    if (arenaRadius(this.data, w.wave) > this.data.config.spawnRadius) {
      const r = this.data.territory.farFrom * L.scale;
      const n = Math.floor((Math.PI * 2 * r) / 22);
      front.lineStyle(1.5, ENERGY, 0.35);
      for (let i = 0; i < n; i += 2) front.beginPath().arc(L.cx, L.cy, r, (i / n) * Math.PI * 2, ((i + 1) / n) * Math.PI * 2).strokePath();
    }
  }

  /** Nests: pulsing crimson hexes with a core; they fall when their cell is reclaimed. */
  private drawNests(w: World, now: number): void {
    const g = this.nests.clear();
    if (w.nests.length === 0) return;
    const grid = terrainFor(this.data);
    const R = this.data.territory.cellSize * this.L.scale;
    const k = 0.5 + 0.5 * Math.sin(now / 220);
    for (const id of w.nests) {
      const cx = this.L.cx + grid.x[id]! * this.L.scale;
      const cy = this.L.cy + grid.y[id]! * this.L.scale;
      g.fillStyle(CRIMSON, 0.25 + 0.2 * k);
      this.hex(g, cx, cy, R * 0.95, true);
      g.lineStyle(3, CRIMSON, 0.9);
      this.hex(g, cx, cy, R * (1 + 0.12 * k), false);
      g.fillStyle(CRIMSON, 1).fillCircle(cx, cy, R * 0.32 * (0.8 + 0.3 * k));
      g.fillStyle(0xffffff, 0.8).fillCircle(cx, cy, R * 0.14);
    }
  }

  /** Same-tag clusters in module order; the tag's counted cluster (most stacks, first on ties) is `on` while its set tier is. */
  private clusters(w: World): Cluster[] {
    const out: Cluster[] = [];
    const best = {} as Record<Tag, { i: number; stacks: number }>;
    const seen: boolean[] = w.crystal.map(() => false);
    for (let i = 0; i < w.crystal.length; i++) {
      if (seen[i]) continue;
      const c = moduleCluster(w, i);
      for (const j of c.members) seen[j] = true;
      const tag = w.crystal[i]!.tag;
      if (!best[tag] || c.stacks > best[tag].stacks) best[tag] = { i: out.length, stacks: c.stacks };
      out.push({ tag, members: c.members, on: false });
    }
    for (const tag in best) if ((w.setTiers[tag as Tag] ?? 0) > 0) out[best[tag as Tag]!.i]!.on = true;
    return out;
  }

  /** The two corners of the edge of hex (cx, cy) that faces its neighbour in direction d. */
  private edge(cx: number, cy: number, d: number, R: number): [number, number, number, number] {
    const [dx, dy] = hexToPixel(HEX_DIRS[d]![0], HEX_DIRS[d]![1], 1);
    const a = Math.atan2(dy, dx);
    return [cx + R * Math.cos(a - 30 * DEG), cy + R * Math.sin(a - 30 * DEG), cx + R * Math.cos(a + 30 * DEG), cy + R * Math.sin(a + 30 * DEG)];
  }

  /** Plates, modules and set badges: redrawn only when the crystal, its stacks, tiers or the zoom change. */
  private drawCrystal(w: World): void {
    const R = this.R;
    const Rf = (R * 16) / this.L.minFont;
    const plates = this.plates.clear();
    const glow = this.glow.clear();
    const g = this.mods.clear();
    const badges = this.badges.clear();
    this.drawUnder(w);
    const mods: readonly Module[] = w.crystal;
    const clusters = this.clusters(w);
    for (const cl of clusters) {
      const c = TAG_COLOR[cl.tag];
      const inCluster = new Set(cl.members.map((i) => `${mods[i]!.q},${mods[i]!.r}`));
      plates.fillStyle(c, cl.on ? 0.3 : 0.15);
      for (const i of cl.members) {
        const [cx, cy] = this.local(mods[i]!.q, mods[i]!.r);
        this.hex(plates, cx, cy, R, true);
      }
      // Only the outer edges: an edge is drawn when the hex across it is not in the cluster.
      for (const i of cl.members) {
        const m = mods[i]!;
        const [cx, cy] = this.local(m.q, m.r);
        for (let d = 0; d < 6; d++) {
          if (inCluster.has(`${m.q + HEX_DIRS[d]![0]},${m.r + HEX_DIRS[d]![1]}`)) continue;
          const e = this.edge(cx, cy, d, R);
          plates.lineStyle(cl.on ? Math.max(3, R * 0.12) : Math.max(1.5, R * 0.06), c, cl.on ? 1 : 0.5).lineBetween(...e);
          if (cl.on) glow.lineStyle(R * 0.4, c, 0.22).lineBetween(...e);
        }
      }
    }
    for (const m of mods) {
      const [cx, cy] = this.local(m.q, m.r);
      const c = TAG_COLOR[m.tag];
      g.fillStyle(DARK, 0.92);
      this.hex(g, cx, cy, R * 0.82, true);
      g.fillStyle(c, 0.22);
      this.hex(g, cx, cy, R * 0.82, true);
      g.lineStyle(Math.max(1.5, R * 0.07), c, 0.9);
      this.hex(g, cx, cy, R * 0.78, false);
      if (Rf < LOD_R) continue;
      const n = w.perks[m.perk] ?? 0;
      if (Rf >= DIGIT_R) {
        drawTagIcon(g, m.tag, cx, cy - R * 0.14, R * 0.6, c);
        drawNumber(g, n, cx, cy + R * 0.42, R * 0.3, 0xffffff, 0.95);
      } else {
        drawTagIcon(g, m.tag, cx, cy - R * 0.1, R * 0.72, c);
        const k = Math.min(6, n);
        const step = R * 0.24;
        for (let j = 0; j < k; j++) g.fillStyle(0xffffff, 0.95).fillCircle(cx + (j - (k - 1) / 2) * step, cy + R * 0.5, Math.max(1.5, R * 0.07));
      }
    }
    for (const cl of clusters) {
      // Centroid of the cluster; the badge (and the LOD glyph) goes on the member closest to it.
      let sx = 0;
      let sy = 0;
      for (const i of cl.members) {
        const [x, y] = this.local(mods[i]!.q, mods[i]!.r);
        sx += x;
        sy += y;
      }
      sx /= cl.members.length;
      sy /= cl.members.length;
      if (Rf < LOD_R) drawTagIcon(g, cl.tag, sx, sy, R * 1.1, TAG_COLOR[cl.tag]);
      if (!cl.on) continue;
      let near = cl.members[0]!;
      let nd = Infinity;
      for (const i of cl.members) {
        const [x, y] = this.local(mods[i]!.q, mods[i]!.r);
        const d = (x - sx) * (x - sx) + (y - sy) * (y - sy);
        if (d < nd - 1e-6) {
          nd = d;
          near = i;
        }
      }
      const [cx, cy] = this.local(mods[near]!.q, mods[near]!.r);
      const bx = cx + R * 0.62;
      const by = cy - R * 0.5;
      const br = Math.max(6, R * 0.36);
      badges.fillStyle(DARK, 1).fillCircle(bx, by, br);
      badges.fillStyle(TAG_COLOR[cl.tag], 0.35).fillCircle(bx, by, br);
      badges.lineStyle(Math.max(2, R * 0.08), TAG_COLOR[cl.tag], 1).strokeCircle(bx, by, br);
      drawNumber(badges, w.setTiers[cl.tag], bx, by, br * 1.05, 0xffffff);
    }
  }

  /** Welds across every link (pulsing once the pair is fused), tier diamonds, and fresh tier-up bursts. */
  private drawWelds(w: World, now: number): void {
    const g = this.welds.clear();
    const gl = this.weldGlow.clear();
    if (this.seams.length === 0) {
      this.bursts.length = 0;
      return;
    }
    const R = this.R;
    const k = 0.75 + 0.25 * Math.sin(now / 520);
    const badged = new Set<string>();
    for (const l of this.seams) {
      const a = w.crystal[l.a];
      const b = w.crystal[l.b];
      if (!a || !b) continue;
      const [ax, ay] = this.local(a.q, a.r);
      const [bx, by] = this.local(b.q, b.r);
      const mx = (ax + bx) / 2;
      const my = (ay + by) / 2;
      const len = Math.hypot(bx - ax, by - ay) || 1;
      const ux = (bx - ax) / len;
      const uy = (by - ay) / len;
      const ca = TAG_COLOR[a.tag];
      const cb = TAG_COLOR[b.tag];
      const tier = w.fusionTiers[l.key] ?? 0;
      const h = R * 0.25;
      const wd = Math.max(2, R * 0.18);
      if (tier > 0) {
        gl.lineStyle(R * 0.5, ca, 0.35 * k).lineBetween(mx - ux * h * 1.4, my - uy * h * 1.4, mx, my);
        gl.lineStyle(R * 0.5, cb, 0.35 * k).lineBetween(mx, my, mx + ux * h * 1.4, my + uy * h * 1.4);
      }
      const al = tier > 0 ? 1 : 0.4;
      g.lineStyle(wd + 2, DARK, al).lineBetween(mx - ux * (h + 1), my - uy * (h + 1), mx + ux * (h + 1), my + uy * (h + 1));
      g.lineStyle(wd, ca, al).lineBetween(mx - ux * h, my - uy * h, mx, my);
      g.lineStyle(wd, cb, al).lineBetween(mx, my, mx + ux * h, my + uy * h);
      if (tier === 0 || badged.has(l.key)) continue;
      badged.add(l.key);
      // The pair's tier: a two-colour diamond across the edge with I / II / III bars.
      const d = Math.max(9, R * 0.52);
      const e = d * 0.78;
      const vx = -uy;
      const vy = ux;
      const pa: [number, number] = [mx - ux * d, my - uy * d];
      const pb: [number, number] = [mx + ux * d, my + uy * d];
      const p1: [number, number] = [mx + vx * e, my + vy * e];
      const p2: [number, number] = [mx - vx * e, my - vy * e];
      g.fillStyle(DARK, 1).fillPoints([{ x: pa[0], y: pa[1] }, { x: p1[0], y: p1[1] }, { x: pb[0], y: pb[1] }, { x: p2[0], y: p2[1] }], true);
      g.fillStyle(ca, 0.85).fillTriangle(pa[0], pa[1], p1[0], p1[1], p2[0], p2[1]);
      g.fillStyle(cb, 0.85).fillTriangle(pb[0], pb[1], p1[0], p1[1], p2[0], p2[1]);
      g.lineStyle(Math.max(1.5, R * 0.05), 0xffffff, 0.9).strokePoints([{ x: pa[0], y: pa[1] }, { x: p1[0], y: p1[1] }, { x: pb[0], y: pb[1] }, { x: p2[0], y: p2[1] }], true);
      const level = this.data.sets.fusionTiers.indexOf(tier) + 1;
      const bh = d * 0.62;
      const gap = d * 0.26;
      for (let i = 0; i < level; i++) {
        const x = mx + (i - (level - 1) / 2) * gap;
        g.lineStyle(Math.max(3, R * 0.11), DARK, 1).lineBetween(x, my - bh / 2, x, my + bh / 2);
        g.lineStyle(Math.max(1.5, R * 0.06), 0xffffff, 1).lineBetween(x, my - bh / 2, x, my + bh / 2);
      }
    }
    // Fresh tier-ups: sparks run back and forth along every link of the pair and a ring opens at each edge.
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const f = this.bursts[i]!;
      const t = (now - f.at) / 1400;
      if (t >= 1) {
        this.bursts.splice(i, 1);
        continue;
      }
      const fade = 1 - t;
      for (const l of this.seams) {
        if (l.key !== f.key) continue;
        const a = w.crystal[l.a];
        const b = w.crystal[l.b];
        if (!a || !b) continue;
        const [ax, ay] = this.local(a.q, a.r);
        const [bx, by] = this.local(b.q, b.r);
        const mx = (ax + bx) / 2;
        const my = (ay + by) / 2;
        const ca = TAG_COLOR[a.tag];
        const cb = TAG_COLOR[b.tag];
        gl.lineStyle(R * 0.16 * fade + 1, ca, fade).strokeCircle(mx, my, R * (0.4 + 2.6 * t));
        gl.lineStyle(R * 0.1 * fade + 1, cb, fade).strokeCircle(mx, my, R * (0.3 + 1.9 * t));
        for (let s = 0; s < 4; s++) {
          const u = (t * 3 + s / 4) % 1;
          const back = s % 2 === 1;
          const x = back ? bx + (ax - bx) * u : ax + (bx - ax) * u;
          const y = back ? by + (ay - by) * u : ay + (by - ay) * u;
          gl.fillStyle(back ? cb : ca, fade).fillCircle(x, y, R * 0.15);
          gl.fillStyle(0xffffff, fade).fillCircle(x, y, R * 0.06);
        }
      }
    }
  }

  /** Zoomed only: the six sector wedges (faint tints of their tags), the free grid up to the ring limit, the core. */
  private drawUnder(w: World): void {
    const g = this.under.clear();
    if (this.zoom === null) return;
    const R = this.R;
    const ring = crystalRing(this.data, w.wave);
    const outer = (ring * Math.sqrt(3) + 1) * R;
    const sectors = sectorTags(w, this.data);
    for (let s = 0; s < 6; s++) {
      const a = Math.atan2(SECTOR_DIRS[s]![1], SECTOR_DIRS[s]![0]);
      const tag = sectors[s] ?? null;
      const c = tag === null ? CYAN : TAG_COLOR[tag];
      g.fillStyle(c, tag === null ? 0.03 : 0.1).slice(0, 0, outer, a - 30 * DEG, a + 30 * DEG, false).fillPath();
      g.lineStyle(1.5, CYAN, 0.18).lineBetween(0, 0, outer * Math.cos(a + 30 * DEG), outer * Math.sin(a + 30 * DEG));
    }
    g.lineStyle(1, CYAN, 0.16);
    for (const [q, r] of crystalSlots(this.data, ring)) {
      const [cx, cy] = this.local(q, r);
      this.hex(g, cx, cy, R * 0.94, false);
    }
    const [main, second] = coreColors(w.crystal, w.perks);
    const cr = this.data.crystal.coreRing;
    for (let q = -cr; q <= cr; q++) {
      for (let r = -cr; r <= cr; r++) {
        if (hexDist(q, r) > cr) continue;
        const [cx, cy] = this.local(q, r);
        g.fillStyle(DARK, 1);
        this.hex(g, cx, cy, R, true);
        g.fillStyle(q === 0 && r === 0 ? main : second, q === 0 && r === 0 ? 0.55 : 0.25);
        this.hex(g, cx, cy, R * 0.9, true);
        g.lineStyle(2, main, 0.9);
        this.hex(g, cx, cy, R * 0.9, false);
      }
    }
  }

  private drawHover(w: World, now: number): void {
    const g = this.hl.clear();
    const R = this.R;
    const k = 0.75 + 0.25 * Math.sin(now / 140);
    const e = this.edit;
    if (e && e.selected >= 0) {
      const m = w.crystal[e.selected];
      if (m) {
        const [cx, cy] = this.local(m.q, m.r);
        g.lineStyle(Math.max(3, R * 0.14), 0xffffff, k);
        this.hex(g, cx, cy, R * 1.04, false);
        if (e.ghost) {
          const gx = e.ghost[0] - this.root.x;
          const gy = e.ghost[1] - this.root.y;
          g.fillStyle(TAG_COLOR[m.tag], 0.35);
          this.hex(g, gx, gy, R * 0.82, true);
          g.lineStyle(2, 0xffffff, 0.9);
          this.hex(g, gx, gy, R * 0.82, false);
          drawTagIcon(g, m.tag, gx, gy, R * 0.6, 0xffffff);
        }
      }
    }
    for (const i of this.hover) {
      const m = w.crystal[i];
      if (!m) continue;
      const [cx, cy] = this.local(m.q, m.r);
      g.lineStyle(Math.max(2, R * 0.12), 0xffffff, 0.9 * k);
      this.hex(g, cx, cy, R * 1.02, false);
    }
  }

  private drawSlots(w: World, now: number): void {
    const g = this.slots.clear();
    const sh = this.shade.clear();
    const R = this.R;
    const blink = 0.55 + 0.25 * Math.sin(now / 160);
    const p = this.placing;
    if (p) {
      p.free.forEach(([q, r], i) => {
        const [cx, cy] = this.local(q, r);
        const c = p.colors?.[i] ?? CYAN;
        g.lineStyle(c === CYAN ? 2 : 3, c, c === CYAN ? blink * 0.7 : blink);
        this.hex(g, cx, cy, R * 0.86, false);
        g.fillStyle(c, c === CYAN ? 0.05 : 0.12);
        this.hex(g, cx, cy, R * 0.86, true);
      });
      if (p.auto) {
        const [cx, cy] = this.local(p.auto[0], p.auto[1]);
        const k = 1 + 0.08 * Math.sin(now / 120);
        g.fillStyle(TAG_COLOR[p.tag], 0.3 + 0.15 * Math.sin(now / 120));
        this.hex(g, cx, cy, R * 0.86 * k, true);
        g.lineStyle(3, TAG_COLOR[p.tag], 1);
        this.hex(g, cx, cy, R * 0.92 * k, false);
      }
    }
    const e = this.edit;
    if (!e || e.selected < 0) return;
    // Modules that are not a valid target (and not the selected one) dim; targets glow in their outcome colour.
    const ok = new Set(e.targets.map((t) => `${t.q},${t.r}`));
    w.crystal.forEach((m, i) => {
      if (i === e.selected || ok.has(`${m.q},${m.r}`)) return;
      const [cx, cy] = this.local(m.q, m.r);
      sh.fillStyle(DARK, 0.6);
      this.hex(sh, cx, cy, R * 0.84, true);
    });
    for (const t of e.targets) {
      const [cx, cy] = this.local(t.q, t.r);
      g.lineStyle(t.color === CYAN ? 2 : 3, t.color, t.color === CYAN ? blink * 0.7 : blink);
      this.hex(g, cx, cy, R * 0.86, false);
      g.fillStyle(t.color, 0.08);
      this.hex(g, cx, cy, R * 0.86, true);
    }
  }

}

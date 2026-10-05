// Uniform-grid spatial hash for targeting (nearest enemies, Multishot; M3 lightning/bounce).
// Rebuilt every tick from the live enemy list; lives outside the World (it is derived state).
// Results are ordered by (distance², id), a total order, so the visiting order never matters.

import type { GameData } from './data';
import type { Enemy } from './state';

export class SpatialHash {
  readonly cell: number;
  readonly n: number;
  /** World coordinate of the grid's left/top edge. */
  readonly origin: number;
  private readonly cells: Enemy[][];
  /** Scratch for the k-best search (distances parallel to `out`). */
  private readonly bestD: number[] = [];

  /** A square grid covering ±halfSize around the core; positions outside are clamped to edge cells. */
  constructor(halfSize: number, cell: number) {
    this.cell = cell;
    this.n = Math.max(1, Math.ceil((halfSize * 2) / cell));
    this.origin = -(this.n * cell) / 2;
    this.cells = [];
    for (let i = 0; i < this.n * this.n; i++) this.cells.push([]);
  }

  private col(x: number): number {
    const c = Math.floor((x - this.origin) / this.cell);
    return c < 0 ? 0 : c >= this.n ? this.n - 1 : c;
  }

  /** Clears and inserts every living enemy. */
  build(enemies: readonly Enemy[]): void {
    for (const c of this.cells) c.length = 0;
    for (const e of enemies) {
      if (e.hp <= 0) continue;
      this.cells[this.col(e.y) * this.n + this.col(e.x)]!.push(e);
    }
  }

  /**
   * Up to `k` living enemies within `range` of (x, y), nearest first (ties: lowest id), written to `out`.
   * Returns how many were found.
   */
  kNearest(x: number, y: number, range: number, k: number, out: Enemy[]): number {
    out.length = 0;
    const bd = this.bestD;
    bd.length = 0;
    if (k <= 0) return 0;
    const r2 = range * range;
    const c0 = this.col(x - range);
    const c1 = this.col(x + range);
    const r0 = this.col(y - range);
    const r1 = this.col(y + range);
    const cs = this.cell;
    for (let row = r0; row <= r1; row++) {
      for (let col = c0; col <= c1; col++) {
        const bucket = this.cells[row * this.n + col]!;
        if (bucket.length === 0) continue;
        // Skip cells that cannot hold anything nearer than the current k-th best. Edge cells also hold
        // clamped outsiders, so they are never pruned by geometry.
        const edge = row === 0 || col === 0 || row === this.n - 1 || col === this.n - 1;
        if (!edge) {
          const lx = this.origin + col * cs;
          const ly = this.origin + row * cs;
          const dx = x < lx ? lx - x : x > lx + cs ? x - lx - cs : 0;
          const dy = y < ly ? ly - y : y > ly + cs ? y - ly - cs : 0;
          const cd = dx * dx + dy * dy;
          if (cd > r2 || (out.length === k && cd > bd[k - 1]!)) continue;
        }
        for (const e of bucket) {
          const ex = e.x - x;
          const ey = e.y - y;
          const d = ex * ex + ey * ey;
          if (d > r2) continue;
          if (out.length === k) {
            const wd = bd[k - 1]!;
            if (d > wd || (d === wd && e.id > out[k - 1]!.id)) continue;
            out.pop();
            bd.pop();
          }
          // Insertion into the small sorted list.
          let i = out.length;
          while (i > 0 && (bd[i - 1]! > d || (bd[i - 1] === d && out[i - 1]!.id > e.id))) i--;
          out.splice(i, 0, e);
          bd.splice(i, 0, d);
        }
      }
    }
    return out.length;
  }
}

const grids = new WeakMap<GameData, SpatialHash>();

/** One grid per data set, sized to the spawn ring (plus a cell of slack). */
export function gridFor(data: GameData): SpatialHash {
  let g = grids.get(data);
  if (g === undefined) {
    g = new SpatialHash(data.config.spawnRadius + data.config.hashCell, data.config.hashCell);
    grids.set(data, g);
  }
  return g;
}

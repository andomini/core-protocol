// Pointy-top axial hex math shared by the crystal and the territory. Basic arithmetic only (sim purity):
// √3 is a literal, rounding is floor(x + 0.5).

export const SQRT3 = 1.7320508075688772;

/** Axial neighbour offsets, in the order of SECTOR_DIRS (east, then counter-clockwise on screen). */
export const HEX_DIRS: readonly (readonly [number, number])[] = [
  [1, 0],
  [1, -1],
  [0, -1],
  [-1, 0],
  [-1, 1],
  [0, 1],
];

/** Unit vectors (world px, y down) of the six HEX_DIRS: the centers of the six 60° sectors. */
export const SECTOR_DIRS: readonly (readonly [number, number])[] = [
  [1, 0],
  [0.5, -0.8660254037844386],
  [-0.5, -0.8660254037844386],
  [-1, 0],
  [-0.5, 0.8660254037844386],
  [0.5, 0.8660254037844386],
];

export function hexDist(q: number, r: number): number {
  return (Math.abs(q) + Math.abs(r) + Math.abs(q + r)) / 2;
}

export function hexToPixel(q: number, r: number, size: number): [number, number] {
  return [size * SQRT3 * (q + r / 2), size * 1.5 * r];
}

const round = (x: number): number => Math.floor(x + 0.5);

/** The hex containing world point (x, y) (cube rounding). */
export function pixelToHex(x: number, y: number, size: number): [number, number] {
  const qf = ((SQRT3 / 3) * x - y / 3) / size;
  const rf = ((2 / 3) * y) / size;
  const sf = -qf - rf;
  let q = round(qf);
  let r = round(rf);
  const s = round(sf);
  const dq = Math.abs(q - qf);
  const dr = Math.abs(r - rf);
  const ds = Math.abs(s - sf);
  if (dq > dr && dq > ds) q = -r - s;
  else if (dr > ds) r = -q - s;
  return [q + 0, r + 0];
}

/** Sector 0..5 of a world point: the SECTOR_DIRS with the largest dot product (ties → the lower index). */
export function sectorOf(x: number, y: number): number {
  let best = 0;
  let bestDot = -Infinity;
  for (let i = 0; i < 6; i++) {
    const d = SECTOR_DIRS[i]![0] * x + SECTOR_DIRS[i]![1] * y;
    if (d > bestDot) {
      bestDot = d;
      best = i;
    }
  }
  return best;
}

/** The hexes of ring k (k ≥ 1) in canonical order: from k × HEX_DIRS[4], walking each direction k steps. */
export function ring(k: number): [number, number][] {
  const out: [number, number][] = [];
  let q = HEX_DIRS[4]![0] * k;
  let r = HEX_DIRS[4]![1] * k;
  for (let i = 0; i < 6; i++) {
    for (let j = 0; j < k; j++) {
      out.push([q, r]);
      q += HEX_DIRS[i]![0];
      r += HEX_DIRS[i]![1];
    }
  }
  return out;
}

export function isNeighbour(q1: number, r1: number, q2: number, r2: number): boolean {
  return hexDist(q1 - q2, r1 - r2) === 1;
}

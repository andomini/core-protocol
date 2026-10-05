// Deterministic number helpers. Only + − × ÷ and comparisons: IEEE-754 guarantees
// identical results for these in every JS engine; Math.pow/sqrt/exp/… do not.

/** Largest magnitude any sim value may take; leaves headroom below 1.8e308 for one more multiply. */
export const MAX_VALUE = 1e300;

/** Clamps to ±MAX_VALUE (infinities included). Throws on NaN: a NaN in the sim is always a bug. */
export function clampValue(x: number): number {
  if (x !== x) throw new Error('NaN in sim');
  if (x > MAX_VALUE) return MAX_VALUE;
  if (x < -MAX_VALUE) return -MAX_VALUE;
  return x;
}

/** base^n for a non-negative integer n, by exponentiation by squaring; clamped. */
export function powInt(base: number, n: number): number {
  if (!Number.isInteger(n) || n < 0) throw new Error(`powInt: bad exponent ${n}`);
  let result = 1;
  let b = clampValue(base);
  let e = n;
  while (e > 0) {
    if (e % 2 === 1) result = clampValue(result * b);
    e = (e - (e % 2)) / 2;
    if (e > 0) b = clampValue(b * b);
  }
  return result;
}

/** Square root by Newton's method using only basic arithmetic, so it is bit-identical everywhere. */
export function dsqrt(x: number): number {
  if (!(x > 0)) return 0;
  // Scale into [1, 4) by powers of 4 (exact in binary floating point).
  let s = x;
  let scale = 1;
  while (s >= 4) {
    s /= 4;
    scale *= 2;
  }
  while (s < 1) {
    s *= 4;
    scale /= 2;
  }
  let r = (s + 1) / 2;
  for (let i = 0; i < 6; i++) r = (r + s / r) / 2;
  return r * scale;
}

/** Throws if any number reachable from `v` is not finite, or if a null appears (JSON's encoding of Infinity/NaN). */
export function assertFiniteDeep(v: unknown, path = '$'): void {
  if (v === null) throw new Error(`non-finite value at ${path} (null)`);
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new Error(`non-finite value at ${path}: ${v}`);
    return;
  }
  if (Array.isArray(v)) {
    v.forEach((x, i) => assertFiniteDeep(x, `${path}[${i}]`));
    return;
  }
  if (typeof v === 'object' && v !== undefined) {
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) assertFiniteDeep(x, `${path}.${k}`);
  }
}

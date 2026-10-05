// Seeded PRNG (sfc32) with named streams. State is four uint32 values stored in the World,
// so snapshots and hashes capture it. Copied from Last Tower.

export type RngState = [number, number, number, number];

const U32 = 0x100000000;

/** cyrb128-style string hash → four uint32 seeds. */
export function hashSeed(...parts: (string | number)[]): RngState {
  const str = parts.join('|');
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}

export function createStream(runSeed: number, name: string): RngState {
  const s = hashSeed(runSeed, name);
  // Warm up to decorrelate similar seeds.
  for (let i = 0; i < 12; i++) nextU32(s);
  return s;
}

/** Advances the state in place and returns a uint32. */
export function nextU32(s: RngState): number {
  const a = s[0];
  const b = s[1];
  const c = s[2];
  const d = s[3];
  const t = (((a + b) | 0) + d) | 0;
  s[3] = (d + 1) | 0;
  s[0] = b ^ (b >>> 9);
  s[1] = (c + (c << 3)) | 0;
  const r = (c << 21) | (c >>> 11);
  s[2] = (r + t) | 0;
  return t >>> 0;
}

/** Uniform integer in [0, n). n must be ≤ 2^21 so the product stays exact. */
export function nextInt(s: RngState, n: number): number {
  if (n <= 1) return 0;
  return Math.floor((nextU32(s) * n) / U32);
}

/** Uniform integer in [lo, hi] inclusive. */
export function nextRange(s: RngState, lo: number, hi: number): number {
  return lo + nextInt(s, hi - lo + 1);
}

/** True with probability chanceFxValue / 1000. */
export function chanceFx(s: RngState, chanceFxValue: number): boolean {
  if (chanceFxValue <= 0) return false;
  if (chanceFxValue >= 1000) return true;
  return nextInt(s, 1000) < chanceFxValue;
}

/** Picks a key by integer weights; keys are iterated in the given order. */
export function pickWeighted<K extends string>(s: RngState, keys: readonly K[], weights: readonly number[]): K {
  let total = 0;
  for (const w of weights) total += w;
  let roll = nextInt(s, total);
  for (let i = 0; i < keys.length; i++) {
    roll -= weights[i] as number;
    if (roll < 0) return keys[i] as K;
  }
  return keys[keys.length - 1] as K;
}

/** True with probability `p` (a float in 0..1). Draws only when 0 < p < 1; exact float compare, so deterministic. */
export function chance(s: RngState, p: number): boolean {
  if (!(p > 0)) return false;
  if (p >= 1) return true;
  return nextU32(s) < p * U32;
}

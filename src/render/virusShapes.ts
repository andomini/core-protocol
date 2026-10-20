// Virus bodies without Phaser (unit-tested in tests/virusBodies.test.ts): texture keys of the animation frames,
// the idle pose of each kind, and the death-burst fragment plan. Render only; never touches sim state.
import type { EnemyKind } from '../sim/data';

const TAU = Math.PI * 2;

/**
 * Animation frames baked per kind (fast: flagella beat, ranged: the spitting cone's nozzle pumps, phage: legs flex,
 * leech: the proboscis pumps).
 */
export const FRAMES: Readonly<Record<EnemyKind, number>> = { basic: 1, fast: 3, tank: 1, ranged: 2, boss: 1, leech: 2, spore: 1, carrier: 1, phage: 2 };
/** Milliseconds per animation frame (0 = static). */
const FRAME_MS: Readonly<Record<EnemyKind, number>> = { basic: 0, fast: 85, tank: 0, ranged: 320, boss: 0, leech: 220, spore: 0, carrier: 0, phage: 260 };

const BASE_KEY: Readonly<Record<EnemyKind, string>> = {
  basic: 'e_basic',
  fast: 'e_fast',
  tank: 'e_tank',
  ranged: 'e_ranged',
  boss: 'e_boss_head',
  leech: 'e_leech',
  spore: 'e_spore',
  carrier: 'e_carrier',
  phage: 'e_phage',
};

/** Kinds whose body has a front (+x in the texture) that turns toward the core. */
export const DIRECTIONAL: readonly EnemyKind[] = ['fast', 'ranged', 'boss', 'leech', 'phage'];

/** Texture key of frame `f` of a kind: frame 0 is the plain key (`e_fast`), later frames add `_<f>`. */
export function texKey(kind: EnemyKind, f = 0): string {
  return f === 0 ? BASE_KEY[kind] : `${BASE_KEY[kind]}_${f}`;
}

/** The animation frame at time `now` (ms); `id` desynchronises neighbours so a swarm does not beat in lockstep. */
export function animFrame(kind: EnemyKind, now: number, id: number): number {
  const n = FRAMES[kind];
  if (n <= 1) return 0;
  const f = Math.floor(now / FRAME_MS[kind] + id * 1.37);
  return ((f % n) + n) % n;
}

export interface Pose {
  rot: number;
  /** Scale multipliers along the texture's own x (heading) and y axes. */
  sx: number;
  sy: number;
}

/**
 * Idle motion: basic pulses and turns slowly, fast points at the core and stretches with its beat, tank turns very
 * slowly with a heavy breathing pulse, ranged points its legs at the core and sways. `spin` is ±1 per enemy.
 */
export function pose(kind: EnemyKind, now: number, id: number, spin: number, toCore: number, out: Pose): Pose {
  switch (kind) {
    case 'basic': {
      const p = 1 + 0.07 * Math.sin(now / 380 + id);
      out.rot = now * 0.0005 * spin;
      out.sx = p;
      out.sy = p;
      break;
    }
    case 'fast': {
      const w = Math.sin(now / 70 + id);
      out.rot = toCore + Math.sin(now / 160 + id) * 0.07;
      out.sx = 1 + 0.06 * w;
      out.sy = 1 - 0.05 * w;
      break;
    }
    case 'tank': {
      const p = 1 + 0.03 * Math.sin(now / 520 + id);
      out.rot = now * 0.00022 * spin;
      out.sx = p;
      out.sy = p;
      break;
    }
    case 'ranged': {
      // The spitting cone: aims steadily, the body squeezes along its axis as the nozzle pumps.
      const q = Math.sin(now / 160 + id);
      out.rot = toCore + Math.sin(now / 420 + id) * 0.08;
      out.sx = 1 + 0.05 * q;
      out.sy = 1 - 0.04 * q;
      break;
    }
    case 'phage':
      out.rot = toCore + Math.sin(now / 300 + id) * 0.2;
      out.sx = 1;
      out.sy = 1;
      break;
    case 'leech': {
      // A tick crawling: the head stays on the core, the body rocks a little side to side.
      out.rot = toCore + Math.sin(now / 140 + id) * 0.12;
      const p = 1 + 0.03 * Math.sin(now / 220 + id);
      out.sx = p;
      out.sy = 2 - p;
      break;
    }
    case 'spore': {
      // A soft puffball: slow wobbling breath (out of phase on the two axes), slow drift turn.
      out.rot = now * 0.0003 * spin;
      out.sx = 1 + 0.06 * Math.sin(now / 450 + id);
      out.sy = 1 + 0.06 * Math.sin(now / 450 + id + 1.3);
      break;
    }
    case 'carrier': {
      // The armoured shell: the slowest turn of all and a faint heavy breath.
      const p = 1 + 0.02 * Math.sin(now / 700 + id);
      out.rot = now * 0.00012 * spin;
      out.sx = p;
      out.sy = p;
      break;
    }
    case 'boss': {
      out.rot = toCore;
      out.sx = 1;
      out.sy = 1;
      break;
    }
  }
  return out;
}

/** Boss envelope: the membrane breathes and counter-turns; the nucleus glow beats faster (alpha 0.55…1). */
export function bossMembrane(now: number, id: number): { scale: number; rot: number; glow: number } {
  return {
    scale: 1 + 0.07 * Math.sin(now / 340 + id),
    rot: -now * 0.0003,
    glow: 0.775 + 0.225 * Math.sin(now / 150 + id),
  };
}

/** Fragment textures (`frag_<v>`, baked white): 0 capsid shell arc with a spike, 1 triangular plate, 2 droplet. */
export const FRAG_VARIANTS = 3;
/** Shell fragments per death (the brief: 3–5 for a virus; the boss bursts wider). */
export const FRAG_COUNT: Readonly<Record<EnemyKind, number>> = { basic: 4, fast: 3, tank: 5, ranged: 4, boss: 10, leech: 3, spore: 5, carrier: 5, phage: 4 };
const FRAG_KINDS: Readonly<Record<EnemyKind, readonly number[]>> = {
  basic: [0, 0, 2],
  fast: [2, 0],
  tank: [1, 1, 0],
  ranged: [2, 1],
  boss: [0, 1, 2],
  leech: [2, 0],
  spore: [2, 2, 0],
  carrier: [1, 1, 1, 0],
  phage: [1, 2],
};

/** Split burst (spore): how many spore puffs fly out of the dying parent, per copy. */
export const SPLIT_PUFFS = 4;

/** Leech glint: the carried Bits as a 0..1 fill of its glint (log-ish so a small theft still shows, never past 1). */
export function glintLevel(carried: number, ownBits: number): number {
  if (!(carried > 0)) return 0;
  const k = carried / Math.max(1e-9, ownBits);
  return Math.min(1, 0.35 + 0.65 * (k / (k + 4)));
}

export interface Frag {
  /** Direction of flight (rad). */
  angle: number;
  /** Travel distance in units of the body radius. */
  dist: number;
  /** Spin over the whole flight (rad). */
  spin: number;
  variant: number;
  /** Size relative to the body. */
  size: number;
}

/**
 * Plans a death burst: one fragment per equal sector of the circle (jittered inside it, so the burst always reads as a
 * capsid splitting all round), starting at the body's rotation `rot`. Fills `out` and returns the count.
 */
export function fragments(kind: EnemyKind, rot: number, rand: () => number, out: Frag[]): number {
  const n = FRAG_COUNT[kind];
  const kinds = FRAG_KINDS[kind];
  for (let i = 0; i < n; i++) {
    const f = out[i] ?? (out[i] = { angle: 0, dist: 0, spin: 0, variant: 0, size: 1 });
    f.angle = rot + ((i + 0.5 + (rand() - 0.5) * 0.7) * TAU) / n;
    f.dist = 1.1 + rand() * 1.1;
    f.spin = (rand() < 0.5 ? -1 : 1) * (1.5 + rand() * 3);
    f.variant = kinds[i % kinds.length]!;
    f.size = 0.75 + rand() * 0.45;
  }
  return n;
}

/** How many of `want` pieces fit under the cap (bursts degrade to particles only when the pool is full). */
export function fragBudget(live: number, cap: number, want: number): number {
  return Math.max(0, Math.min(want, cap - live));
}

/** Ease-out for fragment flight: fast start, settles at 1. */
export function easeOut(t: number): number {
  const k = Math.min(1, Math.max(0, t));
  return k * (2 - k);
}

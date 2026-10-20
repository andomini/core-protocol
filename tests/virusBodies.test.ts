// Virus bodies (uniqueness plan item 2): render-only logic of src/render/virusShapes.ts — frame keys, idle poses and the
// death-burst plan. Phaser-free, so it runs in Node.
import { describe, expect, it } from 'vitest';
import { DEFAULT_DATA, type EnemyKind } from '../src/sim/data';
import { ENEMY_COLOR, TAG_COLOR } from '../src/render/palette';
import { animFrame, easeOut, type Frag, FRAG_COUNT, FRAG_VARIANTS, fragBudget, fragments, FRAMES, pose, texKey, bossMembrane, DIRECTIONAL, glintLevel } from '../src/render/virusShapes';

const KINDS = Object.keys(DEFAULT_DATA.enemies) as EnemyKind[];
const TAU = Math.PI * 2;

/** A small deterministic generator so the tests do not depend on Math.random. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

describe('virus texture frames', () => {
  it('every enemy kind has a body, frame 0 keeps the legacy key (BattleScene passes it to death bursts)', () => {
    expect([...KINDS].sort()).toEqual(['basic', 'boss', 'carrier', 'fast', 'leech', 'phage', 'ranged', 'spore', 'tank']);
    for (const k of ['leech', 'spore', 'carrier', 'phage'] as const) expect(texKey(k)).toBe(`e_${k}`);
    expect(texKey('basic')).toBe('e_basic');
    expect(texKey('boss')).toBe('e_boss_head');
    expect(texKey('fast', 2)).toBe('e_fast_2');
  });

  it('animFrame stays in range, cycles through every frame, and neighbours are out of phase', () => {
    for (const k of KINDS) {
      const seen = new Set<number>();
      for (let t = 0; t < 4000; t += 7) {
        const f = animFrame(k, t, 3);
        expect(f).toBeGreaterThanOrEqual(0);
        expect(f).toBeLessThan(FRAMES[k]);
        seen.add(f);
      }
      expect(seen.size).toBe(FRAMES[k]);
    }
    const same = [1, 2, 3, 4, 5, 6].filter((id) => animFrame('fast', 1000, id) === animFrame('fast', 1000, 0)).length;
    expect(same).toBeLessThan(6);
  });
});

describe('idle pose', () => {
  const out = { rot: 0, sx: 1, sy: 1 };
  it('directional bodies (fast, ranged, leech, phage, boss) face the core within a small sway', () => {
    expect([...DIRECTIONAL].sort()).toEqual(['boss', 'fast', 'leech', 'phage', 'ranged']);
    for (const k of DIRECTIONAL) {
      for (let t = 0; t < 3000; t += 97) {
        const p = pose(k, t, 5, 1, 1.0, out);
        expect(Math.abs(p.rot - 1.0)).toBeLessThanOrEqual(0.21);
      }
    }
  });

  it('scale stays within ±8 % (readable size, hit boxes unchanged in feel)', () => {
    for (const k of KINDS) {
      for (let t = 0; t < 5000; t += 53) {
        const p = pose(k, t, 9, -1, 0, out);
        expect(p.sx).toBeGreaterThan(0.92);
        expect(p.sx).toBeLessThan(1.08);
        expect(p.sy).toBeGreaterThan(0.92);
        expect(p.sy).toBeLessThan(1.08);
      }
    }
  });

  it('the tank turns slower than the basic and the carrier slowest of all (they read as heavier)', () => {
    const at = (k: EnemyKind) => pose(k, 10000, 0, 1, 0, out).rot;
    expect(Math.abs(at('tank'))).toBeLessThan(Math.abs(at('basic')));
    expect(Math.abs(at('carrier'))).toBeLessThan(Math.abs(at('tank')));
  });

  it('the spore breathes on both axes out of phase (a soft puffball, not a rigid shell)', () => {
    let differ = 0;
    for (let t = 0; t < 3000; t += 101) if (Math.abs(pose('spore', t, 2, 1, 0, out).sx - out.sy) > 0.01) differ++;
    expect(differ).toBeGreaterThan(5);
  });

  it('the leech glint grows with the carried Bits, is off at 0 and never exceeds 1', () => {
    expect(glintLevel(0, 2)).toBe(0);
    const a = glintLevel(1, 2);
    const b = glintLevel(20, 2);
    expect(a).toBeGreaterThan(0.3);
    expect(b).toBeGreaterThan(a);
    expect(glintLevel(1e300, 2)).toBeLessThanOrEqual(1);
  });

  it('the boss membrane breathes and its nucleus glow stays visible', () => {
    for (let t = 0; t < 3000; t += 31) {
      const m = bossMembrane(t, 1);
      expect(m.scale).toBeGreaterThan(0.9);
      expect(m.scale).toBeLessThan(1.1);
      expect(m.glow).toBeGreaterThanOrEqual(0.55 - 1e-9);
      expect(m.glow).toBeLessThanOrEqual(1 + 1e-9);
    }
  });
});

describe('death burst', () => {
  it('3–5 fragments per virus, more for the boss, valid variants, flying outward', () => {
    const out: Frag[] = [];
    for (const k of KINDS) {
      const n = fragments(k, 0.3, lcg(7), out);
      expect(n).toBe(FRAG_COUNT[k]);
      if (k === 'boss') expect(n).toBeGreaterThan(5);
      else {
        expect(n).toBeGreaterThanOrEqual(3);
        expect(n).toBeLessThanOrEqual(5);
      }
      for (const f of out.slice(0, n)) {
        expect(f.variant).toBeGreaterThanOrEqual(0);
        expect(f.variant).toBeLessThan(FRAG_VARIANTS);
        expect(f.dist).toBeGreaterThan(1);
        expect(f.size).toBeGreaterThan(0.5);
      }
    }
  });

  it('fragments cover the whole circle: one per equal sector', () => {
    const out: Frag[] = [];
    for (let seed = 1; seed < 30; seed++) {
      const rot = seed * 0.77;
      const n = fragments('basic', rot, lcg(seed), out);
      const sectors = out.slice(0, n).map((f) => Math.floor((((f.angle - rot) % TAU) + TAU) % TAU / (TAU / n)));
      expect(new Set(sectors).size).toBe(n);
    }
  });

  it('the piece budget never exceeds the cap', () => {
    expect(fragBudget(0, 160, 4)).toBe(4);
    expect(fragBudget(158, 160, 4)).toBe(2);
    expect(fragBudget(170, 160, 4)).toBe(0);
  });

  it('easeOut is monotone from 0 to 1 and clamps', () => {
    let last = -1;
    for (let t = 0; t <= 1; t += 0.05) {
      const e = easeOut(t);
      expect(e).toBeGreaterThan(last);
      last = e;
    }
    expect(easeOut(2)).toBe(1);
    expect(easeOut(-1)).toBe(0);
  });
});

describe('sick palette', () => {
  const hue = (c: number): number => {
    const r = ((c >> 16) & 255) / 255;
    const g = ((c >> 8) & 255) / 255;
    const b = (c & 255) / 255;
    const mx = Math.max(r, g, b);
    const d = mx - Math.min(r, g, b);
    if (d === 0) return 0;
    const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return (h * 60 + 360) % 360;
  };
  const gap = (a: number, b: number): number => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));

  it('no virus colour sits within 15° of hue of a protocol tag colour', () => {
    for (const k of KINDS) for (const t of Object.values(TAG_COLOR)) expect(gap(hue(ENEMY_COLOR[k]), hue(t))).toBeGreaterThan(15);
  });
});

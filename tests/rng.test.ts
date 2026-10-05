import { describe, expect, it } from 'vitest';
import { createStream, nextInt, nextU32, pickWeighted } from '../src/sim/rng';

describe('rng', () => {
  it('is reproducible for the same seed and stream', () => {
    const a = createStream(42, 'spawn');
    const b = createStream(42, 'spawn');
    const sa = Array.from({ length: 20 }, () => nextU32(a));
    const sb = Array.from({ length: 20 }, () => nextU32(b));
    expect(sa).toEqual(sb);
  });

  it('gives different sequences for different streams and seeds', () => {
    const first = (seed: number, name: string) => nextU32(createStream(seed, name));
    expect(first(42, 'spawn')).not.toBe(first(42, 'combat'));
    expect(first(42, 'spawn')).not.toBe(first(43, 'spawn'));
  });

  it('nextInt stays in [0, n)', () => {
    const s = createStream(1, 'x');
    for (let i = 0; i < 1000; i++) {
      const v = nextInt(s, 64);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(64);
      expect(Number.isInteger(v)).toBe(true);
    }
  });

  it('pickWeighted never picks a zero-weight key', () => {
    const s = createStream(7, 'x');
    for (let i = 0; i < 500; i++) expect(pickWeighted(s, ['a', 'b', 'c'], [3, 0, 1])).not.toBe('b');
  });

  it('state survives a JSON round trip', () => {
    const s = createStream(9, 'spawn');
    nextU32(s);
    const copy = JSON.parse(JSON.stringify(s)) as typeof s;
    expect(nextU32(copy)).toBe(nextU32(s));
  });
});

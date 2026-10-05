import { describe, expect, it } from 'vitest';
import { MAX_VALUE, assertFiniteDeep, clampValue, dsqrt, powInt } from '../src/sim/num';

describe('clampValue', () => {
  it('passes ordinary values through', () => {
    expect(clampValue(5)).toBe(5);
    expect(clampValue(-2.5)).toBe(-2.5);
  });
  it('clamps infinities to ±MAX_VALUE', () => {
    expect(clampValue(Infinity)).toBe(MAX_VALUE);
    expect(clampValue(-Infinity)).toBe(-MAX_VALUE);
    expect(clampValue(1e305)).toBe(MAX_VALUE);
  });
  it('throws on NaN', () => {
    expect(() => clampValue(NaN)).toThrow(/NaN/);
  });
});

describe('powInt', () => {
  it('is exact where the result is representable', () => {
    expect(powInt(2, 10)).toBe(1024);
    expect(powInt(1.5, 3)).toBe(3.375);
    expect(powInt(0.5, 2)).toBe(0.25);
    expect(powInt(7, 0)).toBe(1);
  });
  it('matches Math.pow to 1e-11 relative error', () => {
    for (let n = 0; n <= 3000; n += 7) {
      const want = Math.pow(1.045, n);
      expect(Math.abs(powInt(1.045, n) - want) / want).toBeLessThan(1e-11);
    }
  });
  it('clamps overflow to MAX_VALUE', () => {
    expect(powInt(10, 400)).toBe(MAX_VALUE);
    expect(powInt(1.1, 1_000_000)).toBe(MAX_VALUE);
  });
  it('rejects negative or fractional exponents', () => {
    expect(() => powInt(2, -1)).toThrow(/exponent/);
    expect(() => powInt(2, 1.5)).toThrow(/exponent/);
  });
});

describe('dsqrt', () => {
  it('matches Math.sqrt to 1e-15 relative error', () => {
    for (const x of [1e-10, 0.25, 1, 2, 3.99, 4, 46.5 * 46.5, 12345.678, 1e6, 1e300]) {
      const want = Math.sqrt(x);
      expect(Math.abs(dsqrt(x) - want)).toBeLessThanOrEqual(want * 1e-15);
    }
  });
  it('returns 0 for zero and negative input', () => {
    expect(dsqrt(0)).toBe(0);
    expect(dsqrt(-4)).toBe(0);
  });
});

describe('assertFiniteDeep', () => {
  it('accepts nested finite data', () => {
    expect(() => assertFiniteDeep({ a: [1, 2, { b: 3 }], s: 'x', t: true })).not.toThrow();
  });
  it('names the path of a non-finite number', () => {
    expect(() => assertFiniteDeep({ a: [1, Infinity] })).toThrow('$.a[1]');
  });
  it('rejects null (JSON encoding of Infinity/NaN)', () => {
    expect(() => assertFiniteDeep({ a: null })).toThrow('$.a');
  });
});

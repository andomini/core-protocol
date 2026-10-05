import { describe, expect, it } from 'vitest';
import { formatNum, suffixFor } from '../src/ui/format';

describe('formatNum', () => {
  it('small numbers are whole and plain', () => {
    expect(formatNum(0)).toBe('0');
    expect(formatNum(7.9)).toBe('7');
    expect(formatNum(999)).toBe('999');
    expect(formatNum(999.99)).toBe('999');
  });

  it('K/M/B/T with 3 significant digits, truncated (never rounds up to the next suffix)', () => {
    expect(formatNum(1000)).toBe('1.00K');
    expect(formatNum(1234)).toBe('1.23K');
    expect(formatNum(12345)).toBe('12.3K');
    expect(formatNum(123456)).toBe('123K');
    expect(formatNum(999999)).toBe('999K');
    expect(formatNum(1e6)).toBe('1.00M');
    expect(formatNum(4.567e9)).toBe('4.56B');
    expect(formatNum(7.89e12)).toBe('7.89T');
  });

  it('after T come two-letter suffixes aa, ab, … az, ba …', () => {
    expect(formatNum(1e15)).toBe('1.00aa');
    expect(formatNum(2.5e18)).toBe('2.50ab');
    expect(suffixFor(5)).toBe('aa');
    expect(suffixFor(6)).toBe('ab');
    expect(suffixFor(30)).toBe('az');
    expect(suffixFor(31)).toBe('ba');
    expect(formatNum(1e93)).toBe('1.00ba');
  });

  it('reaches the 1e300 sim cap without breaking', () => {
    expect(formatNum(1e300)).toMatch(/^1\.00[a-z]{2}$/);
    expect(formatNum(9.99e299)).toMatch(/^999[a-z]{2}$/);
  });

  it('exact powers of 1000 stay exact despite float error', () => {
    for (let i = 1; i <= 20; i++) expect(formatNum(Number(`1e${3 * i}`)).startsWith('1.00')).toBe(true);
  });

  it('negatives keep the sign; non-finite values do not crash', () => {
    expect(formatNum(-12345)).toBe('-12.3K');
    expect(formatNum(Infinity)).toBe('∞');
    expect(formatNum(NaN)).toBe('—');
  });
});

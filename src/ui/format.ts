// Number display: 999 · 1.23K · 12.3M · 123B · 1.00T · 1.00aa … (3 significant digits, truncated).

const NAMED = ['', 'K', 'M', 'B', 'T'];
const A = 'a'.charCodeAt(0);
/** Relative slack so values like 999.9999999 (float error on exact powers) truncate correctly. */
const EPS = 1e-9;

/** Suffix for 1000^group: 1 = K … 4 = T, then aa, ab, … az, ba, … */
export function suffixFor(group: number): string {
  if (group < NAMED.length) return NAMED[group]!;
  const i = group - NAMED.length;
  return String.fromCharCode(A + Math.floor(i / 26), A + (i % 26));
}

export function formatNum(n: number): string {
  if (Number.isNaN(n)) return '—';
  if (!Number.isFinite(n)) return n > 0 ? '∞' : '-∞';
  const sign = n < 0 ? '-' : '';
  const v = Math.abs(n);
  if (v < 1000) return sign + String(Math.floor(v + EPS));
  let group = Math.floor(Math.log10(v) / 3 + EPS);
  let x = v / Number(`1e${group * 3}`);
  if (x < 1 - EPS) {
    group -= 1;
    x *= 1000;
  }
  const digits = x >= 100 - EPS ? 0 : x >= 10 - EPS ? 1 : 2;
  const factor = digits === 0 ? 1 : digits === 1 ? 10 : 100;
  const truncated = Math.floor(x * factor * (1 + EPS)) / factor;
  return `${sign}${truncated.toFixed(digits)}${suffixFor(group)}`;
}

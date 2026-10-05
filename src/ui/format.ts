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

/** Trims trailing zeros of a fixed-point string ("1.50" → "1.5", "2.00" → "2"). */
function trim(s: string): string {
  return s.includes('.') ? s.replace(/\.?0+$/, '') : s;
}

/** A small value with up to `dp` decimals (trailing zeros trimmed), or formatNum when large. */
function small(v: number, dp: number): string {
  if (Math.abs(v) >= 1000) return formatNum(v);
  return trim(v.toFixed(dp));
}

export type StatFormatKind = 'num' | 'int' | 'pct' | 'mult' | 'perSec' | 'plus';

/** A stat value for the upgrade panel. */
export function formatStat(kind: StatFormatKind, v: number): string {
  switch (kind) {
    case 'int':
      return formatNum(Math.round(v));
    case 'pct':
      return `${small(v * 100, Math.abs(v) < 0.1 ? 1 : 0)}%`;
    case 'mult':
      return `×${small(v, 2)}`;
    case 'perSec':
      return `${small(v, Math.abs(v) < 10 ? 2 : 1)}/s`;
    case 'plus':
      return `+${formatNum(Math.round(v))}`;
    default:
      return small(v, Math.abs(v) < 100 ? 1 : 0);
  }
}

/** A price: rounded up below 1000 so a shown price is never less than what the buy needs. */
export function formatPrice(cost: number): string {
  return cost < 1000 ? String(Math.ceil(cost - 1e-9)) : formatNum(cost);
}

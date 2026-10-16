// UTC day / week keys and the daily seed. Mirrors src/meta/leaderboardRules.ts in the game (same test vectors).
export const DAY_MS = 86_400_000;

export function dayKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Days since 1970-01-01 for "YYYY-MM-DD" (NaN if malformed). */
export function dayIndex(day: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return NaN;
  const t = Date.parse(`${day}T00:00:00Z`);
  return Number.isFinite(t) && dayKey(t) === day ? Math.floor(t / DAY_MS) : NaN;
}

/** Monday (UTC) starting the week of `ms`, as "YYYY-MM-DD". */
export function weekKey(ms: number): string {
  const d = Math.floor(ms / DAY_MS);
  return dayKey((d - ((d + 3) % 7)) * DAY_MS);
}

export function isMonday(day: string): boolean {
  const i = dayIndex(day);
  return Number.isFinite(i) && (i + 3) % 7 === 0;
}

/** FNV-1a over "core-protocol:daily:<day>" (never 0): everyone's seed for that day's challenge. */
export function dailySeed(day: string): number {
  const s = `core-protocol:daily:${day}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0 || 1;
}

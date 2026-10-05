// Pure summary of telemetry exports (adapted from Last Tower's report): the markdown that
// `npm run telemetry:report` writes. Unit-tested in tests/telemetryReport.test.ts.
import type { TelemetryEvent } from '../../src/telemetry/Telemetry';

export function median(xs: number[]): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

interface Run {
  runId: string;
  deviceId: string;
  index: number;
  seed: number;
  deathWave: number | null;
  deathTime: number | null;
  buys: { t: number; wave: number }[];
}

const fmt = (x: number, d = 0) => (Number.isFinite(x) ? x.toFixed(d) : '—');
const range = (xs: number[]) => (xs.length ? `${Math.min(...xs)}–${Math.max(...xs)}` : '—');

export function summarize(input: TelemetryEvent[], title: string): string {
  const events = [...input].sort((a, b) => a.t - b.t);
  const runs = new Map<string, Run>();
  for (const e of events) {
    if (e.type === 'run_start') {
      runs.set(e.runId, { runId: e.runId, deviceId: String(e.deviceId), index: Number(e.runIndex ?? 1), seed: Number(e.seed), deathWave: null, deathTime: null, buys: [] });
    }
    const r = runs.get(e.runId);
    if (!r) continue;
    if (e.type === 'death') {
      r.deathWave = Number(e.wave);
      r.deathTime = Number(e.time);
    }
    if (e.type === 'purchase') r.buys.push({ t: e.t, wave: Number(e.wave) });
  }
  const all = [...runs.values()];
  const devices = new Set(events.map((e) => e.deviceId));
  const sessions = new Set(events.map((e) => e.sessionId));
  const L: string[] = [`# ${title}`, '', `Events: ${events.length} · devices: ${devices.size} · sessions: ${sessions.size} · runs: ${all.length} · builds: ${[...new Set(events.map((e) => e.build))].join(', ') || '—'}`, ''];

  L.push('## Death wave by lifetime run # (compare with B2–B4)', '', '| Run # | Deaths | Median wave | Range | Median sim-min |', '|---|---|---|---|---|');
  for (const [lo, hi, label] of [[1, 1, '1'], [2, 2, '2'], [3, 3, '3'], [4, 1e9, '4+']] as const) {
    const done = all.filter((r) => r.index >= lo && r.index <= hi && r.deathWave !== null);
    const ws = done.map((r) => r.deathWave!);
    L.push(`| ${label} | ${ws.length} | ${fmt(median(ws))} | ${range(ws)} | ${fmt(median(done.map((r) => r.deathTime! / 60)), 1)} |`);
  }

  L.push('', '## Seconds between purchases', '', '| Waves | Intervals | Median s |', '|---|---|---|');
  for (const [lo, hi, label] of [[0, 5, '1–5'], [6, 20, '6–20'], [21, 1e9, '21+']] as const) {
    const xs: number[] = [];
    for (const r of all) for (let i = 1; i < r.buys.length; i++) if (r.buys[i]!.wave >= lo && r.buys[i]!.wave <= hi) xs.push((r.buys[i]!.t - r.buys[i - 1]!.t) / 1000);
    L.push(`| ${label} | ${xs.length} | ${fmt(median(xs), 1)} |`);
  }

  const byStat = new Map<string, number>();
  for (const e of events) if (e.type === 'purchase') byStat.set(String(e.stat), (byStat.get(String(e.stat)) ?? 0) + Number(e.levels ?? 1));
  L.push('', '## Levels bought by stat', '', '| Stat | Levels |', '|---|---|');
  for (const [s, n] of [...byStat].sort((a, b) => b[1] - a[1])) L.push(`| ${s} | ${n} |`);

  L.push('', '## Ads', '', '| Kind | Placement | Requests | Completed | Failed | Unavailable | Completion |', '|---|---|---|---|---|---|---|');
  const keys = new Set(events.filter((e) => e.type === 'ad_request').map((e) => `${e.kind}|${e.placement}`));
  for (const k of [...keys].sort()) {
    const [kind, placement] = k.split('|');
    const of = (type: string, result?: string) => events.filter((e) => e.type === type && e.kind === kind && e.placement === placement && (!result || e.result === result)).length;
    const req = of('ad_request');
    const ok = of('ad_result', 'completed');
    L.push(`| ${kind} | ${placement} | ${req} | ${ok} | ${of('ad_result', 'failed')} | ${of('ad_result', 'unavailable')} | ${req ? fmt((100 * ok) / req) + '%' : '—'} |`);
  }

  const ends = events.filter((e) => e.type === 'session_end').map((e) => Number(e.activeS));
  L.push('', '## Sessions', '', `Session stretches ended: ${ends.length} · median active ${fmt(median(ends))} s · runs started per session: ${fmt(all.length / Math.max(1, sessions.size), 1)}`, '');
  return L.join('\n');
}

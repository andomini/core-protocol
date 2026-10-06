// Mass progression test: many simulated players (strategies × ads) in parallel worker threads, each playing
// from a fresh save until maxHours of real play or the last tier. Reports when tiers unlock, where progress
// stalls (longest stretch without a new best wave), runaway runs (hit the run cap) and what stays unbought.
// Usage: npm run sim:progression -- [--players 128] [--hours 40] [--runs 600] [--cap 180] [--out reports/progression.md]
import { readFileSync, writeFileSync } from 'node:fs';
import type { Experiment } from './experiment';
import { cpus } from 'node:os';
import { Worker } from 'node:worker_threads';
import { DEFAULT_META_DATA as M } from '../../src/meta/metaData';
import { DEFAULT_DATA as D } from '../../src/sim/data';
import type { PlayerConfig, PlayerResult, Strategy } from './progressionPlayer';

const args = process.argv.slice(2);
const arg = (k: string, d: string) => (args.includes(`--${k}`) ? args[args.indexOf(`--${k}`) + 1]! : d);
const players = Number(arg('players', '128'));
const maxHours = Number(arg('hours', '40'));
const maxRuns = Number(arg('runs', '600'));
const runCapMin = Number(arg('cap', '180'));
const out = arg('out', 'reports/progression.md');
const expArg = arg('exp', '');
const exp: Experiment | undefined = expArg ? (JSON.parse(expArg.startsWith('{') ? expArg : readFileSync(expArg, 'utf8')) as Experiment) : undefined;
const stratArg = arg('strats', '');
const threads = Math.max(1, Math.min(cpus().length - 2, players));

const ALL_STRATS: { strategy: Strategy; ads: boolean }[] = [
  { strategy: 'balanced', ads: true },
  { strategy: 'balanced', ads: false },
  { strategy: 'workshop', ads: true },
  { strategy: 'labs', ads: true },
  { strategy: 'casual', ads: false },
];
const STRATS = stratArg ? ALL_STRATS.filter((s) => stratArg.split(',').includes(`${s.strategy}${s.ads ? '+ads' : ''}`)) : ALL_STRATS;
const queue: PlayerConfig[] = Array.from({ length: players }, (_, i) => ({ id: i + 1, ...STRATS[i % STRATS.length]!, maxHours, maxRuns, runCapMin }));
const total = queue.length;
const results: PlayerResult[] = [];
const t0 = Date.now();

await new Promise<void>((resolve) => {
  let alive = 0;
  for (let i = 0; i < threads; i++) {
    const w = new Worker(new URL('./progressionWorker.ts', import.meta.url), { execArgv: ['--import', 'tsx'], workerData: { exp } });
    alive++;
    const next = () => w.postMessage(queue.shift() ?? null);
    w.on('message', (r: PlayerResult) => {
      results.push(r);
      const t = ((Date.now() - t0) / 1000).toFixed(0);
      console.log(`[${results.length}/${total}] ${t}s player ${r.cfg.id} ${r.cfg.strategy}${r.cfg.ads ? '+ads' : ''}: tier ${r.final.tier} · ${r.rows.length} runs · ${r.rows.at(-1)?.hours.toFixed(1)} h`);
      next();
    });
    w.on('exit', () => {
      if (--alive === 0) resolve();
    });
    w.on('error', (e) => console.error('worker error', e));
    next();
  }
});

// ---- aggregation ------------------------------------------------------------------------------------------
const q = (xs: number[], p: number) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))]!;
};
const h = (x: number) => (Number.isFinite(x) ? `${x.toFixed(1)} h` : '—');
const key = (r: PlayerResult) => `${r.cfg.strategy}${r.cfg.ads ? ' + ads' : ''}`;
const groups = new Map<string, PlayerResult[]>();
for (const r of results) groups.set(key(r), [...(groups.get(key(r)) ?? []), r]);
const tiers = D.tiers.length;
const L: string[] = [];
L.push('# Progression report', '');
L.push(`${results.length} simulated players · up to ${maxHours} h of real play or ${maxRuns} runs each · run cap ${runCapMin} sim-min · ${threads} threads · ${((Date.now() - t0) / 60000).toFixed(1)} min wall · \`npm run sim:progression\``, '');
if (exp) L.push(`Experiment: \`${JSON.stringify(exp)}\``, '');
L.push('Real time = sim time at the best unlocked speed (casual: ×2 max) + 0.5 min of menus per run. Tiers unlock at wave ' + M.tiers.unlockWave + '.', '');

L.push('## When tiers unlock (median · p10–p90 of players who got there; share reached)', '');
L.push(`| strategy | ${Array.from({ length: tiers - 1 }, (_, i) => `T${i + 2}`).join(' | ')} |`, `|---|${'---|'.repeat(tiers - 1)}`);
for (const [g, rs] of groups) {
  const cells = [];
  for (let t = 2; t <= tiers; t++) {
    const xs = rs.map((r) => r.tierAt[t]!).filter((x) => x > 0);
    cells.push(xs.length ? `${h(q(xs, 0.5))} · ${q(xs, 0.1).toFixed(1)}–${q(xs, 0.9).toFixed(1)} · ${Math.round((xs.length / rs.length) * 100)}%` : `never`);
  }
  L.push(`| ${g} | ${cells.join(' | ')} |`);
}
L.push('');

L.push('## Best wave on the highest tier over time (median over players)', '');
const marks = [0.5, 1, 2, 4, 8, 16, 24, 40, 60, 80, 100, 120].filter((x) => x <= maxHours);
L.push(`| strategy | ${marks.map((m) => `${m} h`).join(' | ')} |`, `|---|${'---|'.repeat(marks.length)}`);
for (const [g, rs] of groups) {
  const cells = marks.map((mk) => {
    const vals = rs.map((r) => {
      const upTo = r.rows.filter((x) => x.hours <= mk);
      if (!upTo.length) return null;
      const t = Math.max(...upTo.map((x) => x.tier));
      return { t, w: Math.max(...upTo.filter((x) => x.tier === t).map((x) => x.wave)) };
    }).filter((v): v is { t: number; w: number } => v !== null);
    if (!vals.length) return '—';
    const t = q(vals.map((v) => v.t), 0.5);
    return `T${t} W${q(vals.filter((v) => v.t === t).map((v) => v.w), 0.5)}`;
  });
  L.push(`| ${g} | ${cells.join(' | ')} |`);
}
L.push('');

L.push('## Where progress stalls (longest stretch without a new best wave on the tier played)', '');
L.push('| strategy | median plateau | p90 plateau | typical spot (tier · best wave) |', '|---|---|---|---|');
for (const [g, rs] of groups) {
  const ps = rs.map((r) => r.plateau);
  const spots = new Map<string, number>();
  for (const p of ps) if (p.hours > 0) spots.set(`T${p.tier} · W${Math.round(p.wave / 5) * 5}`, (spots.get(`T${p.tier} · W${Math.round(p.wave / 5) * 5}`) ?? 0) + 1);
  const top = [...spots.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, n]) => `${k} (${n})`).join(', ');
  L.push(`| ${g} | ${h(q(ps.map((p) => p.hours), 0.5))} (${q(ps.map((p) => p.runs), 0.5)} runs) | ${h(q(ps.map((p) => p.hours), 0.9))} | ${top || '—'} |`);
}
L.push('');

L.push('## Runaway runs (survived the run cap)', '');
for (const [g, rs] of groups) {
  const all = rs.flatMap((r) => r.rows);
  const capped = all.filter((x) => x.capped);
  const where = new Map<number, number>();
  for (const c of capped) where.set(c.tier, (where.get(c.tier) ?? 0) + 1);
  L.push(`- **${g}:** ${capped.length} of ${all.length} runs (${((capped.length / Math.max(1, all.length)) * 100).toFixed(1)} %)${capped.length ? ` · by tier: ${[...where.entries()].map(([t, n]) => `T${t} ${n}`).join(', ')}` : ''}`);
}
L.push('');

L.push('## Run length on the highest tier (sim minutes, median of runs per hour bucket, all players)', '');
const buckets = [1, 2, 4, 8, 16, 40, 80, 120].filter((_b, i, a) => i === 0 || a[i - 1]! < maxHours);
const lens = buckets.map((b, i) => {
  const lo = i ? buckets[i - 1]! : 0;
  const xs = results.flatMap((r) => r.rows.filter((x) => x.hours > lo && x.hours <= b).map((x) => x.simMin));
  return `${lo}–${b} h: ${xs.length ? q(xs, 0.5).toFixed(1) : '—'}`;
});
L.push(lens.join(' · '), '');

L.push('## Labs owned at the end (share of players)', '');
const labShare = M.labs.nodes.map((n) => [n.id, results.filter((r) => r.labsOwned.includes(n.id)).length / results.length] as const).sort((a, b) => a[1] - b[1]);
L.push(labShare.map(([id, s]) => `${id} ${Math.round(s * 100)}%`).join(' · '), '');

L.push('## Final state (median)', '');
L.push('| strategy | runs | hours | tier | workshop levels | labs | cards owned |', '|---|---|---|---|---|---|---|');
for (const [g, rs] of groups) {
  L.push(`| ${g} | ${q(rs.map((r) => r.rows.length), 0.5)} | ${h(q(rs.map((r) => r.rows.at(-1)!.hours), 0.5))} | ${q(rs.map((r) => r.final.tier), 0.5)} | ${q(rs.map((r) => r.rows.at(-1)!.workshop), 0.5)} | ${q(rs.map((r) => r.rows.at(-1)!.labs), 0.5)} | ${q(rs.map((r) => r.final.cards), 0.5)} |`);
}
L.push('');
L.push('## Player 1 timeline (first 40 runs)', '', '| run | h | tier | wave | sim min | Bits | buys | workshop | labs | cards |', '|---|---|---|---|---|---|---|---|---|---|');
const p1 = results.find((r) => r.cfg.id === 1)!;
for (const x of p1.rows.slice(0, 40)) L.push(`| ${x.run} | ${x.hours.toFixed(2)} | ${x.tier} | ${x.wave}${x.capped ? '*' : ''} | ${x.simMin} | ${x.bits} | ${x.buys} | ${x.workshop} | ${x.labs} | ${x.cards} |`);
writeFileSync(out, L.join('\n') + '\n');
writeFileSync(out.replace(/\.md$/, '.json'), JSON.stringify(results.map((r) => ({ ...r, rows: r.rows }))));
console.log(`\n→ ${out}`);

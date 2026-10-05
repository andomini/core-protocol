// npm run sim:balance -- [--seeds 24] [--tier 1] [--out reports/balance-m2b.md] [--override patch.json]
// --override deep-merges a JSON patch into the game data (for tuning experiments; the report says so).
// Runs every bot policy on N seeds (first run: no workshop, nothing unlocked) and writes a Markdown report.
import { readFileSync, writeFileSync } from 'node:fs';
import botJson from './bot.json';
import { DEFAULT_DATA, type GameData, STAT_IDS, validateData } from '../../src/sim/data';
import { POLICIES, type PolicyName } from './bot';
import { type RunResult, runBot } from './runner';

const args = process.argv.slice(2);
const arg = (k: string, d: string) => (args.includes(`--${k}`) ? args[args.indexOf(`--${k}`) + 1]! : d);
const seeds = Number(arg('seeds', '24'));
const tier = Number(arg('tier', '1'));
const out = arg('out', 'reports/balance-m2b.md');
const override = arg('override', '');

function merge(t: Record<string, unknown>, p: Record<string, unknown>): void {
  for (const [k, v] of Object.entries(p)) {
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) merge(t[k] as Record<string, unknown>, v as Record<string, unknown>);
    else t[k] = v;
  }
}
const data: GameData = override ? structuredClone(DEFAULT_DATA) : DEFAULT_DATA;
if (override) validateData((merge(data as unknown as Record<string, unknown>, JSON.parse(readFileSync(override, 'utf8'))), data));
const t0 = Date.now();

const quantile = (xs: number[], q: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))]!;
};
const f1 = (x: number) => x.toFixed(1);

const by: Record<string, RunResult[]> = {};
for (const p of POLICIES) {
  by[p] = [];
  for (let s = 1; s <= seeds; s++) by[p]!.push(runBot(data, p, { seed: s, tier }));
}

const rows = POLICIES.map((p) => {
  const rs = by[p]!;
  const waves = rs.map((r) => r.wave);
  const mins = rs.map((r) => r.simMinutes);
  return `| ${p} | ${quantile(waves, 0.5)} | ${Math.min(...waves)}–${Math.max(...waves)} | ${f1(quantile(mins, 0.5))} | ${f1(Math.min(...mins))}–${f1(Math.max(...mins))} | ${Math.round(quantile(rs.map((r) => r.buys), 0.5))} | ${rs.filter((r) => !r.dead).length} |`;
});

/** Median level per stat at death for one policy. */
function levelTable(p: PolicyName): string {
  const rs = by[p]!;
  const cells = STAT_IDS.map((id) => `${id} ${quantile(rs.map((r) => r.world.levels[id]), 0.5)}`);
  return cells.join(' · ');
}

const greedy = by.greedy!;
const g = quantile(greedy.map((r) => r.wave), 0.5);
const n = quantile(by.none!.map((r) => r.wave), 0.5);
const gm = quantile(greedy.map((r) => r.simMinutes), 0.5);
const b2 = g >= 12 && g <= 20 && gm >= 6 && gm <= 10 && n < g * 0.6;

// Wave curve for greedy seed 1: when each wave starts.
const curve = greedy[0]!.waveStartS.map((s, wv) => (s === undefined ? null : `${wv}:${Math.round(s)}s`)).filter(Boolean).join(' ');

const md = [
  '# Balance report — M2b (in-run upgrades, first run)',
  '',
  `Seeds 1–${seeds} · tier ${tier} · no workshop levels · starred stats locked ·${override ? ` override \`${override}\` ·` : ''} ${((Date.now() - t0) / 1000).toFixed(1)} s · \`npm run sim:balance\``,
  '',
  '## B2: first run dies at waves 12–20 (≈6–10 min at ×1); no-upgrade run much earlier',
  '',
  `**${b2 ? 'PASS' : 'FAIL'}** — greedy median wave ${g} at ${f1(gm)} sim-min; no-upgrade median wave ${n}.`,
  '',
  '| policy | median wave | wave range | median min | min range | levels bought | alive at 60 min |',
  '|---|---|---|---|---|---|---|',
  ...rows,
  '',
  `Bot "useful" stats (tools/sim/bot.json): ${botJson.useful.join(', ')}. Tab weights: ${JSON.stringify(botJson.tabWeight)}.`,
  '',
  '## Median levels at death',
  '',
  ...POLICIES.filter((p) => p !== 'none').flatMap((p) => [`- **${p}:** ${levelTable(p)}`]),
  '',
  `## Greedy seed 1: wave start times`,
  '',
  curve,
  '',
].join('\n');

writeFileSync(out, md);
console.log(md);
console.log(`→ ${out}`);

// npm run sim:balance -- [--seeds 24] [--tier 1] [--out reports/balance-m3.md] [--override patch.json]
// --override deep-merges a JSON patch into the game data (for tuning experiments; the report says so).
// Runs bot policies (buy policy × protocol pick policy) on N seeds — first run: no workshop, nothing
// unlocked, no cards — and writes a Markdown report with the M3 gate: B1, B2, B5, B6 (spec §7).
import { readFileSync, writeFileSync } from 'node:fs';
import botJson from './bot.json';
import { DEFAULT_DATA, type GameData, STAT_IDS, validateData } from '../../src/sim/data';
import { TAGS } from '../../src/sim/perkData';
import { type PickPolicyName, POLICIES, type PolicyName, TAG_PICKS } from './bot';
import { type RunResult, runBot } from './runner';

const args = process.argv.slice(2);
const arg = (k: string, d: string) => (args.includes(`--${k}`) ? args[args.indexOf(`--${k}`) + 1]! : d);
const seeds = Number(arg('seeds', '24'));
const tier = Number(arg('tier', '1'));
const out = arg('out', 'reports/balance-m3.md');
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
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))]!;
};
const f1 = (x: number) => x.toFixed(1);
const pct = (n: number, d: number) => `${Math.round((100 * n) / d)} %`;

interface Combo {
  key: string;
  buy: PolicyName;
  pick: PickPolicyName;
  protocols: boolean;
}
const combos: Combo[] = [
  ...POLICIES.map((buy) => ({ key: `${buy} + greedy-pick`, buy, pick: 'greedy-pick' as PickPolicyName, protocols: true })),
  { key: 'greedy + random-pick', buy: 'greedy', pick: 'random-pick', protocols: true },
  { key: 'greedy + first', buy: 'greedy', pick: 'first', protocols: true },
  ...TAG_PICKS.map((pick) => ({ key: `greedy + ${pick}`, buy: 'greedy' as PolicyName, pick, protocols: true })),
  { key: 'greedy, no protocols (M2b)', buy: 'greedy', pick: 'first', protocols: false },
];

const by: Record<string, RunResult[]> = {};
for (const c of combos) {
  by[c.key] = [];
  for (let s = 1; s <= seeds; s++) by[c.key]!.push(runBot(data, c.buy, { seed: s, tier, protocols: c.protocols }, 60, c.pick));
}

const med = (key: string) => quantile(by[key]!.map((r) => r.wave), 0.5);
const set2 = (rs: RunResult[]) => rs.filter((r) => r.set2Wave > 0);

const rows = combos.map((c) => {
  const rs = by[c.key]!;
  const waves = rs.map((r) => r.wave);
  const mins = rs.map((r) => r.simMinutes);
  const s2 = set2(rs);
  const s4 = rs.filter((r) => r.set4Wave > 0);
  const s2w = s2.map((r) => r.set2Wave);
  return `| ${c.key} | ${quantile(waves, 0.5)} | ${Math.min(...waves)}–${Math.max(...waves)} | ${f1(quantile(mins, 0.5))} | ${quantile(rs.map((r) => r.picks), 0.5)} | ${c.protocols ? pct(s2.length, rs.length) : '—'} | ${s2w.length ? quantile(s2w, 0.5) : '—'} | ${c.protocols ? pct(s4.length, rs.length) : '—'} | ${Math.round(quantile(rs.map((r) => r.buys), 0.5))} | ${rs.filter((r) => !r.dead).length} |`;
});

// B1: the wave-1 pick opens the run at tick 0 (wall-clock time to the overlay: reports/ui-smoke.json).
const all = combos.filter((c) => c.protocols).flatMap((c) => by[c.key]!);
const firstPick = Math.max(...all.map((r) => r.firstPickS));
const b1 = all.every((r) => r.firstPickS === 0);

// B2: greedy buying + greedy picking dies at waves 12–20 in ≈6–10 min; no-upgrade runs much earlier.
const g = by['greedy + greedy-pick']!;
const gw = med('greedy + greedy-pick');
const gm = quantile(g.map((r) => r.simMinutes), 0.5);
const nw = med('none + greedy-pick');
const b2 = gw >= 12 && gw <= 20 && gm >= 6 && gm <= 10 && nw < gw * 0.6;

// B5: ≥ 80 % of first runs reach a 2-set; median 2-set by wave 10.
const b5rows = ['greedy + greedy-pick', 'greedy + random-pick', 'greedy + first'].map((k) => {
  const rs = by[k]!;
  const s2 = set2(rs);
  const share = s2.length / rs.length;
  const medWave = quantile(rs.map((r) => (r.set2Wave > 0 ? r.set2Wave : 9999)), 0.5);
  return { k, share, medWave, ok: share >= 0.8 && medWave <= 10 };
});
const b5 = b5rows[0]!.ok && b5rows[1]!.ok;

// B6: tag bots' median waves within ±20 % of each other (max ≤ 1.2 × min) and of their mean.
const tagMeds = TAGS.map((t) => ({ t, m: med(`greedy + tag:${t}`) }));
const tmin = Math.min(...tagMeds.map((x) => x.m));
const tmax = Math.max(...tagMeds.map((x) => x.m));
const tmean = tagMeds.reduce((s, x) => s + x.m, 0) / tagMeds.length;
const b6 = tmax <= tmin * 1.2;
const b6mean = tagMeds.every((x) => Math.abs(x.m - tmean) <= 0.2 * tmean);

/** How often each perk was held at death (share of runs) and the median stacks, for one combo. */
function perkTable(key: string): string {
  const rs = by[key]!;
  const ids = Object.keys(data.perks.perks);
  return ids
    .map((id) => ({ id, n: rs.filter((r) => (r.world.perks[id] ?? 0) > 0).length }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n)
    .map((x) => `${x.id} ${pct(x.n, rs.length)}`)
    .join(' · ');
}

function levelTable(key: string): string {
  const rs = by[key]!;
  return STAT_IDS.map((id) => `${id} ${quantile(rs.map((r) => r.world.levels[id]), 0.5)}`).join(' · ');
}

const tagSetShare = (key: string) => {
  const rs = by[key]!;
  const tag = key.split('tag:')[1]!;
  return pct(rs.filter((r) => r.world.setTiers[tag as (typeof TAGS)[number]] >= 2).length, rs.length);
};

const md = [
  '# Balance report — M3 (protocols, tags, sets; first run)',
  '',
  `Seeds 1–${seeds} per policy · tier ${tier} · no workshop · starred stats locked · no cards ·${override ? ` override \`${override}\` ·` : ''} ${((Date.now() - t0) / 1000).toFixed(1)} s · \`npm run sim:balance\``,
  '',
  `## B1: first protocol pick ≤ 30 s after loading — **${b1 ? 'PASS' : 'FAIL'}**`,
  '',
  `The wave-1 pick opens the run at sim time ${firstPick} s (tick 0, before any spawn) in every run. The wall-clock time from page load to the visible overlay is measured by \`npm run ui\` (\`reports/ui-smoke.json\`, \`*.firstPickMs\`).`,
  '',
  `## B2: first run dies at waves 12–20 (≈6–10 min at ×1) — **${b2 ? 'PASS' : 'FAIL'}**`,
  '',
  `greedy + greedy-pick: median wave ${gw} at ${f1(gm)} sim-min; no upgrades (none + greedy-pick): median wave ${nw}.`,
  '',
  `## B5: ≥ 80 % of first runs reach a 2-set; median 2-set by wave 10 — **${b5 ? 'PASS' : 'FAIL'}**`,
  '',
  '| policy | runs with a 2-set | median wave of the first 2-set | |',
  '|---|---|---|---|',
  ...b5rows.map((r) => `| ${r.k} | ${pct(r.share * 100, 100)} | ${r.medWave === 9999 ? '—' : r.medWave} | ${r.ok ? 'ok' : 'miss'} |`),
  '',
  'The wave of a 2-set is the wave whose end opened the pick that completed it (the wave-1 pick counts as wave 1).',
  '',
  `## B6: no dominant tag — tag bots' median waves within ±20 % — **${b6 ? 'PASS' : 'FAIL'}**`,
  '',
  `Medians: ${tagMeds.map((x) => `${x.t} ${x.m}`).join(' · ')}. max/min = ${f1(tmax)}/${f1(tmin)} = ${(tmax / tmin).toFixed(2)} (≤ 1.20 required); every tag within ±20 % of the mean ${f1(tmean)}: ${b6mean ? 'yes' : 'no'}.`,
  '',
  `Share of tag-bot runs that reached their own 2-set: ${TAGS.map((t) => `${t} ${tagSetShare(`greedy + tag:${t}`)}`).join(' · ')}.`,
  '',
  '## All policies',
  '',
  '| policy (buy + pick) | median wave | wave range | median min | picks | 2-set | median 2-set wave | 4-set | levels bought | alive at 60 min |',
  '|---|---|---|---|---|---|---|---|---|---|',
  ...rows,
  '',
  `Bot "useful" stats (tools/sim/bot.json): ${botJson.useful.join(', ')}. Tab weights: ${JSON.stringify(botJson.tabWeight)}.`,
  'Pick policies: `greedy-pick` = highest rarity, then a held tag; `random-pick` = uniform; `first` = the first card; `tag:<t>` = the best card of tag t when offered, else greedy-pick.',
  '',
  '## Perks held at death (share of runs)',
  '',
  ...['greedy + greedy-pick', 'greedy + random-pick', ...TAG_PICKS.map((p) => `greedy + ${p}`)].map((k) => `- **${k}:** ${perkTable(k)}`),
  '',
  '## Median levels at death',
  '',
  ...['greedy + greedy-pick', ...TAG_PICKS.map((p) => `greedy + ${p}`)].map((k) => `- **${k}:** ${levelTable(k)}`),
  '',
].join('\n');

writeFileSync(out, md);
console.log(md);
console.log(`→ ${out}`);

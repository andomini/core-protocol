// npm run sim:balance -- [--seeds 48] [--tier 1] [--out reports/balance-m3.md] [--override patch.json] [--crystal arrange|auto]
// --crystal arrange (the default, uniqueness plan item 13) adds the combo 'greedy + fusion-pick (arrange)' (fusion-pick cards + best
// hex + hill-climb moves, tools/sim/bot.ts) and a per-fusion table next to the auto-placed one, and the B6 tag bots arrange too:
// their tag's card, on the best free hex, then the hill-climb (a player committed to a tag arranges the crystal). The fresh-player
// combos (B2, B5) keep autoSlot placement. --crystal auto reproduces the pre-C4 report (auto placement everywhere).
// --override deep-merges a JSON patch into the game data (for tuning experiments; the report says so).
// Runs bot policies (buy policy × protocol pick policy) on N seeds — first run: no workshop, nothing
// unlocked, no cards — and writes a Markdown report with the M3 gate: B1, B2, B5, B6 (spec §7).
import { readFileSync, writeFileSync } from 'node:fs';
import botJson from './bot.json';
import { DEFAULT_DATA, type GameData, STAT_IDS, validateData } from '../../src/sim/data';
import { fusionKeys, TAGS } from '../../src/sim/perkData';
import { type CrystalMode, type PickPolicyName, POLICIES, type PolicyName, TAG_PICKS } from './bot';
import { type RunResult, runBot } from './runner';

const args = process.argv.slice(2);
const arg = (k: string, d: string) => (args.includes(`--${k}`) ? args[args.indexOf(`--${k}`) + 1]! : d);
const seeds = Number(arg('seeds', '48'));
const tier = Number(arg('tier', '1'));
const out = arg('out', 'reports/balance-m3.md');
const override = arg('override', '');
const crystalArg = arg('crystal', 'arrange');
if (crystalArg !== 'auto' && crystalArg !== 'arrange') throw new Error(`--crystal must be auto or arrange, got ${crystalArg}`);
const crystalMode: CrystalMode = crystalArg;

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
  crystal?: CrystalMode;
}
const ARRANGE = 'greedy + fusion-pick (arrange)';
const combos: Combo[] = [
  ...POLICIES.map((buy) => ({ key: `${buy} + greedy-pick`, buy, pick: 'greedy-pick' as PickPolicyName, protocols: true })),
  { key: 'greedy + random-pick', buy: 'greedy', pick: 'random-pick', protocols: true },
  { key: 'greedy + first', buy: 'greedy', pick: 'first', protocols: true },
  ...TAG_PICKS.map((pick) => ({ key: `greedy + ${pick}`, buy: 'greedy' as PolicyName, pick, protocols: true, crystal: crystalMode })),
  { key: 'greedy, no protocols (M2b)', buy: 'greedy', pick: 'first', protocols: false },
  ...(crystalMode === 'arrange' ? [{ key: ARRANGE, buy: 'greedy' as PolicyName, pick: 'fusion-pick' as PickPolicyName, protocols: true, crystal: 'arrange' as CrystalMode }] : []),
];

const by: Record<string, RunResult[]> = {};
for (const c of combos) {
  by[c.key] = [];
  for (let s = 1; s <= seeds; s++) by[c.key]!.push(runBot(data, c.buy, { seed: s, tier, protocols: c.protocols }, 60, c.pick, c.crystal ?? 'auto'));
}

const med = (key: string) => quantile(by[key]!.map((r) => r.wave), 0.5);
const set2 = (rs: RunResult[]) => rs.filter((r) => r.set2Wave > 0);

/** Median final wave of the runs that did (or did not) hold the Ice Wall at death. */
function wallWaves(rs: RunResult[], walled: boolean): string {
  const sel = rs.filter((r) => ((r.world.fusionTiers['cryo+firewall'] ?? 0) > 0) === walled);
  return sel.length === 0 ? '—' : `${quantile(sel.map((r) => r.wave), 0.5)} (${sel.length} runs)`;
}

/** Share of the virus damage that landed on wall segments rather than the core, over the runs that built a wall (— if none did). */
function wallShare(rs: RunResult[]): string {
  const walled = rs.filter((r) => r.wallTaken > 0);
  if (walled.length === 0) return '—';
  const share = walled.map((r) => r.wallTaken / (r.wallTaken + r.coreTaken));
  return `${pct(quantile(share, 0.5) * 100, 100)} (${walled.length}/${rs.length} runs)`;
}

/** Share of the kills (and of the kill Energy) that came from Bastion turrets + Minefield blasts, over the runs that landed any (— if none did); the Minefield's own Energy share after the slash. */
function structShare(rs: RunResult[]): string {
  const built = rs.filter((r) => r.turretKills + r.mineKills > 0);
  if (built.length === 0) return '—';
  const kills = built.map((r) => (r.turretKills + r.mineKills) / Math.max(1, r.kills));
  const mine = built.map((r) => r.mineEnergy / Math.max(1, r.killEnergy));
  return `${pct(quantile(kills, 0.5) * 100, 100)} of kills (target ≤ 25 % at III), Minefield ${pct(quantile(mine, 0.5) * 100, 100)} of kill Energy (${built.length}/${rs.length} runs)`;
}

/** Median share of a run's Energy from kills + stations that came from Relay Stations, over the runs that were paid by any (— if none were). */
function stationShare(rs: RunResult[]): string {
  const paid = rs.filter((r) => r.stationEnergy > 0);
  if (paid.length === 0) return '—';
  const share = paid.map((r) => r.stationEnergy / (r.killEnergy + r.stationEnergy));
  return `${pct(quantile(share, 0.5) * 100, 100)} (${paid.length}/${rs.length} runs)`;
}

/** Median share of all virus damage (core + wall + stations) that the Relay Stations soaked, over the runs where they were hit (— if none were). */
function stationSoak(rs: RunResult[]): string {
  const hit = rs.filter((r) => r.stationTaken > 0);
  if (hit.length === 0) return '—';
  const share = hit.map((r) => r.stationTaken / (r.stationTaken + r.wallTaken + r.coreTaken));
  return `${pct(quantile(share, 0.5) * 100, 100)} (${hit.length}/${rs.length} runs)`;
}

const rows = combos.map((c) => {
  const rs = by[c.key]!;
  const waves = rs.map((r) => r.wave);
  const mins = rs.map((r) => r.simMinutes);
  const s2 = set2(rs);
  const s4 = rs.filter((r) => r.set4Wave > 0);
  const s2w = s2.map((r) => r.set2Wave);
  return `| ${c.key} | ${quantile(waves, 0.5)} | ${Math.min(...waves)}–${Math.max(...waves)} | ${f1(quantile(mins, 0.5))} | ${quantile(rs.map((r) => r.picks), 0.5)} | ${c.protocols ? pct(s2.length, rs.length) : '—'} | ${s2w.length ? quantile(s2w, 0.5) : '—'} | ${c.protocols ? pct(s4.length, rs.length) : '—'} | ${Math.round(quantile(rs.map((r) => r.buys), 0.5))} | ${rs.filter((r) => !r.dead).length} | ${wallShare(rs)} |`;
});

// B1: the wave-1 pick opens the run at tick 0 (wall-clock time to the overlay: reports/ui-smoke.json).
const all = combos.filter((c) => c.protocols).flatMap((c) => by[c.key]!);
const firstPick = Math.max(...all.map((r) => r.firstPickS));
const b1 = all.every((r) => r.firstPickS === 0);

// B2 (revised 2026-10-06, owner): without the workshop a new player clears ~3 waves — greedy buying + greedy
// picking dies at waves 4–6 (≈2–3 min); a no-upgrade run dies earlier.
const g = by['greedy + greedy-pick']!;
const gw = med('greedy + greedy-pick');
const gm = quantile(g.map((r) => r.simMinutes), 0.5);
const nw = med('none + greedy-pick');
const b2 = gw >= 4 && gw <= 6 && nw < gw;

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

/** Fusions at death (auto placement, no moves): share of runs holding each pair at tier ≥ I, and at II+. */
function fusionTable(key: string): string {
  const rs = by[key]!;
  const second = data.sets.fusionTiers[1] ?? Infinity;
  return fusionKeys()
    .map((k) => ({ k, n: rs.filter((r) => (r.world.fusionTiers[k] ?? 0) > 0).length, n2: rs.filter((r) => (r.world.fusionTiers[k] ?? 0) >= second).length }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n)
    .map((x) => `${data.sets.fusions[x.k]!.name} ${pct(x.n, rs.length)}${x.n2 > 0 ? ` (II+ ${pct(x.n2, rs.length)})` : ''}`)
    .join(' · ');
}

/** Per fusion: share of runs that reached each tier at any moment (fusion events), for the given combos. */
function fusionTierTable(keys: string[]): string[] {
  const tiers = data.sets.fusionTiers;
  const head = `| fusion | ${keys.flatMap((k) => tiers.map((_, i) => `${k.startsWith('greedy + fusion') ? 'arr' : 'auto'} ${'I'.repeat(i + 1).replace('IIII', 'IV')}`)).join(' | ')} |`;
  const rowsOut = fusionKeys().map((fk) => {
    const cells = keys.flatMap((k) => tiers.map((t) => pct(by[k]!.filter((r) => (r.fusionMax[fk] ?? 0) >= t).length, by[k]!.length)));
    return `| ${data.sets.fusions[fk]!.name} (${fk}) | ${cells.join(' | ')} |`;
  });
  return [head, `|---|${keys.flatMap(() => tiers.map(() => '---')).join('|')}|`, ...rowsOut];
}

/** Median share of a run's kill Energy / kill Bits that came from each killing-hit source, over the runs of one combo. */
function sourceShares(key: string): string {
  const rs = by[key]!;
  const sources = [...new Set(rs.flatMap((r) => [...Object.keys(r.energyBySource), ...Object.keys(r.bitsBySource)]))].sort();
  return sources
    .map((src) => {
      const e = rs.map((r) => (r.energyBySource[src] ?? 0) / Math.max(1, r.killEnergy));
      const b = rs.map((r) => (r.bitsBySource[src] ?? 0) / Math.max(1, Object.values(r.bitsBySource).reduce((a, x) => a + x, 0)));
      return { src, e: quantile(e, 0.5), b: quantile(b, 0.5) };
    })
    .filter((x) => x.e > 0.005 || x.b > 0.005)
    .map((x) => `${x.src} ${pct(x.e * 100, 100)} E / ${pct(x.b * 100, 100)} B`)
    .join(' · ');
}

const crystalKeys = crystalMode === 'arrange' ? ['greedy + greedy-pick', ARRANGE] : ['greedy + greedy-pick'];
const crystalCompare =
  crystalMode === 'arrange'
    ? `Median wave ${med('greedy + greedy-pick')} (auto) vs ${med(ARRANGE)} (arrange); median in-run Bits at death ${f1(quantile(by['greedy + greedy-pick']!.map((r) => r.bits), 0.5))} vs ${f1(quantile(by[ARRANGE]!.map((r) => r.bits), 0.5))}; median picks ${quantile(by['greedy + greedy-pick']!.map((r) => r.picks), 0.5)} vs ${quantile(by[ARRANGE]!.map((r) => r.picks), 0.5)}.`
    : 'Run with `--crystal arrange` to add the arrange + fusion-pick player.';

const md = [
  '# Balance report — M3 (protocols, tags, sets; first run)',
  '',
  `Seeds 1–${seeds} per policy · tier ${tier} · no workshop · starred stats locked · no cards ·${override ? ` override \`${override}\` ·` : ''} ${((Date.now() - t0) / 1000).toFixed(1)} s · \`npm run sim:balance\``,
  '',
  `## B1: first protocol pick ≤ 30 s after loading — **${b1 ? 'PASS' : 'FAIL'}**`,
  '',
  `The wave-1 pick opens the run at sim time ${firstPick} s (tick 0, before any spawn) in every run. The wall-clock time from page load to the visible overlay is measured by \`npm run ui\` (\`reports/ui-smoke.json\`, \`*.firstPickMs\`).`,
  '',
  `## B2: first run (no workshop) dies at waves 4–6 — **${b2 ? 'PASS' : 'FAIL'}**`,
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
  `Tag bots (greedy buys + tag:<t> picks) place their modules ${crystalMode === 'arrange' ? 'on the best free hex and hill-climb the crystal after each pick (`--crystal arrange`, the default)' : 'by autoSlot (`--crystal auto`)'}.`,
  '',
  `Share of tag-bot runs that reached their own 2-set: ${TAGS.map((t) => `${t} ${tagSetShare(`greedy + tag:${t}`)}`).join(' · ')}.`,
  '',
  `## B7: Ice Wall (spec 2026-10-15, phase 1) — report only`,
  '',
  `Runs whose auto-placed crystal reached cryo+firewall tier I+ (greedy + greedy-pick): ${pct(g.filter((r) => (r.world.fusionTiers['cryo+firewall'] ?? 0) > 0).length, g.length)}. Median wave with / without the wall: ${wallWaves(g, true)} / ${wallWaves(g, false)}. Wall absorbed (median share of virus damage that hit a segment, walled runs): ${wallShare(g)}; the same for the tag:cryo and tag:firewall bots: ${wallShare(by['greedy + tag:cryo']!)} / ${wallShare(by['greedy + tag:firewall']!)}.`,
  '',
  `## B8: Bastion and Minefield (spec 2026-10-15, phase 2) — report only`,
  '',
  `Turret + mine share, greedy + greedy-pick: ${structShare(g)}. The tag:overload / tag:chain / tag:firewall bots: ${structShare(by['greedy + tag:overload']!)} / ${structShare(by['greedy + tag:chain']!)} / ${structShare(by['greedy + tag:firewall']!)}.`,
  '',
  `## B9: Relay Stations (spec 2026-10-15, phase 3) — report only`,
  '',
  `Station share of Energy income (stations / kills + stations; target ≤ 20 % at III), greedy + greedy-pick: ${stationShare(g)}. The tag:mining / tag:firewall bots: ${stationShare(by['greedy + tag:mining']!)} / ${stationShare(by['greedy + tag:firewall']!)}.`,
  '',
  `Decoy share (damage the stations soaked / core + wall + stations), greedy + greedy-pick: ${stationSoak(g)}. The tag:mining / tag:firewall bots: ${stationSoak(by['greedy + tag:mining']!)} / ${stationSoak(by['greedy + tag:firewall']!)}.`,
  '',
  `## Crystal fusions (spec 2026-10-16 phase 0) — report only`,
  '',
  `Share of runs that reached each fusion tier at any moment (tiers = links ${data.sets.fusionTiers.join(' / ')}); auto = autoSlot placement, arr = fusion-pick + hill-climb arrangement. ${crystalCompare}`,
  '',
  ...fusionTierTable(crystalKeys),
  '',
  ...crystalKeys.map((k) => `- **Kill Energy / Bits by killing-hit source, ${k}** (median share per run): ${sourceShares(k) || '—'}`),
  '',
  '## All policies',
  '',
  '| policy (buy + pick) | median wave | wave range | median min | picks | 2-set | median 2-set wave | 4-set | levels bought | alive at 60 min | wall absorbed |',
  '|---|---|---|---|---|---|---|---|---|---|---|',
  ...rows,
  '',
  `Bot "useful" stats (tools/sim/bot.json): ${botJson.useful.join(', ')}. Tab weights: ${JSON.stringify(botJson.tabWeight)}. BUILD rows (bought once their structure stands, taking the weight of the tab they map to): ${JSON.stringify(botJson.build)}.`,
  'Pick policies: `greedy-pick` = highest rarity, then a held tag; `random-pick` = uniform; `first` = the first card; `tag:<t>` = the best card of tag t when offered, else greedy-pick.',
  '',
  '## Perks held at death (share of runs)',
  '',
  ...['greedy + greedy-pick', 'greedy + random-pick', ...TAG_PICKS.map((p) => `greedy + ${p}`)].map((k) => `- **${k}:** ${perkTable(k)}`),
  '',
  '## Fusions held at death (auto placement; share of runs at tier I+, II+)',
  '',
  ...['greedy + greedy-pick', 'greedy + random-pick', ...TAG_PICKS.map((p) => `greedy + ${p}`)].map((k) => `- **${k}:** ${fusionTable(k) || '—'}`),
  '',
  '## Median levels at death',
  '',
  ...['greedy + greedy-pick', ...TAG_PICKS.map((p) => `greedy + ${p}`)].map((k) => `- **${k}:** ${levelTable(k)}`),
  '',
].join('\n');

writeFileSync(out, md);
console.log(md);
console.log(`→ ${out}`);

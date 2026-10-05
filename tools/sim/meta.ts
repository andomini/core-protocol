// Meta progression sim (spec B3, B4): a greedy player chains runs, settles each one and spends Bits in the
// workshop and labs between runs. Usage: npm run sim:meta -- [--players 8] [--runs 40] [--out reports/balance-m4.md]
import { writeFileSync } from 'node:fs';
import botJson from './bot.json';
import { DEFAULT_DATA, STAT_IDS, type StatId } from '../../src/sim/data';
import { buyLab, labState } from '../../src/meta/labs';
import { DEFAULT_META_DATA } from '../../src/meta/metaData';
import { buildRunOptions } from '../../src/meta/runOptions';
import { settleRun } from '../../src/meta/runEnd';
import { defaultMeta, type MetaState } from '../../src/meta/state';
import { buyWorkshop, workshopCost, workshopMax, workshopUnlocked } from '../../src/meta/workshop';
import { runBot } from './runner';

const args = process.argv.slice(2);
const arg = (k: string, d: string) => (args.includes(`--${k}`) ? args[args.indexOf(`--${k}`) + 1]! : d);
const players = Number(arg('players', '8'));
const maxRuns = Number(arg('runs', '40'));
const out = arg('out', 'reports/balance-m4.md');
const D = DEFAULT_DATA;
const M = DEFAULT_META_DATA;
const useful = new Set<string>((botJson as { useful: string[] }).useful);

/** Spends Bits: labs first when affordable (cheapest), else the cheapest useful workshop level. Returns purchases. */
function spend(m: MetaState): number {
  let n = 0;
  for (;;) {
    const labs = M.labs.nodes.filter((x) => labState(m, M, x.id) === 'available' && x.cost <= m.bits).sort((a, b) => a.cost - b.cost);
    if (labs.length > 0 && buyLab(m, M, labs[0]!.id)) {
      n++;
      continue;
    }
    let best: StatId | null = null;
    let bestCost = Infinity;
    for (const id of STAT_IDS) {
      if (!useful.has(id) || !workshopUnlocked(m, D, M, id) || (m.workshop[id] ?? 0) >= workshopMax(m, D, M, id)) continue;
      const c = workshopCost(m, M, id);
      if (c < bestCost) {
        best = id;
        bestCost = c;
      }
    }
    if (best === null || bestCost > m.bits || !buyWorkshop(m, D, M, best)) return n;
    n++;
  }
}

interface Row { run: number; tier: number; wave: number; minutes: number; bits: number; buys: number }
const lines: string[] = [];
const tier2: number[] = [];
const buysPerRun: number[] = [];
const allRows: Row[][] = [];
for (let p = 1; p <= players; p++) {
  const m = defaultMeta();
  let minutes = 0;
  let unlockedAt = 0;
  const rows: Row[] = [];
  for (let r = 1; r <= maxRuns; r++) {
    const tier = m.tierUnlocked;
    const res = runBot(D, 'greedy', buildRunOptions(m, D, M, tier, p * 1000 + r), 90, 'greedy-pick');
    minutes += res.simMinutes;
    const s = settleRun(m, D, M, { tier, wave: res.wave, bits: res.world.bits, keys: res.world.keys, doubled: false });
    const buys = spend(m);
    buysPerRun.push(buys);
    rows.push({ run: r, tier, wave: res.wave, minutes: Math.round(minutes), bits: s.bits, buys });
    if (s.tierUnlocked === 2 && unlockedAt === 0) unlockedAt = minutes;
    if (unlockedAt > 0 && r >= 12) break;
  }
  tier2.push(unlockedAt);
  allRows.push(rows);
  console.log(`player ${p}: tier 2 at ${unlockedAt ? (unlockedAt / 60).toFixed(2) + ' h' : 'never'} · runs ${rows.map((x) => `${x.wave}(${x.bits}b,${x.buys})`).join(' ')}`);
}
const med = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;
const t2 = tier2.filter((x) => x > 0);
const noBuy = buysPerRun.filter((b) => b === 0).length / buysPerRun.length;
lines.push('# Balance report — M4 (meta progression)', '');
lines.push(`${players} greedy players × up to ${maxRuns} runs, sim time at ×1 · \`npm run sim:meta\``, '');
lines.push(`## B4: tier 2 after ≈1.5–3 h of play — median ${t2.length ? (med(t2) / 60).toFixed(2) + ' h' : 'never'} (${t2.length}/${players} unlocked) — **${t2.length === players && med(t2) >= 90 && med(t2) <= 180 ? 'PASS' : 'FAIL'}**`, '');
lines.push(`## B3: a purchase after every run — runs with no purchase: ${(noBuy * 100).toFixed(0)} % — **${noBuy <= 0.1 ? 'PASS' : 'FAIL'}**`, '');
lines.push('## Runs (player 1)', '', '| run | tier | wave | cumulative min | Bits | purchases |', '|---|---|---|---|---|---|');
for (const x of allRows[0]!) lines.push(`| ${x.run} | ${x.tier} | ${x.wave} | ${x.minutes} | ${x.bits} | ${x.buys} |`);
writeFileSync(out, lines.join('\n') + '\n');
console.log(lines.slice(0, 6).join('\n'));

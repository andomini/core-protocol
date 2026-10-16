// Crystal geometry (spec 2026-10-16 phase 0): how many of the 10 tag pairs can touch when every tag forms ONE
// connected cluster on rings 2-4 (cluster-scoped links), and how many modules a 7-link pair (the Apex gate) needs.
// Randomised annealing over layouts (seeded, so the report is reproducible); a lower bound on the true maximum.
// Usage: npx tsx tools/sim/crystalGeometry.ts [--min 5] [--max 24] [--iters 12000] [--restarts 5] [--apex 7] [--out reports/crystal-geometry.md]
// (the owner's package.json is untouched in phase 0, so there is no npm script yet: `"sim:geometry": "tsx tools/sim/crystalGeometry.ts"` is to be added with it)
import { writeFileSync } from 'node:fs';
import { DEFAULT_DATA } from '../../src/sim/data';
import { HEX_DIRS, hexDist, ring } from '../../src/sim/hex';
import { TAGS } from '../../src/sim/perkData';
import { createStream, nextInt } from '../../src/sim/rng';

const args = process.argv.slice(2);
const arg = (k: string, d: string) => (args.includes(`--${k}`) ? args[args.indexOf(`--${k}`) + 1]! : d);
const minN = Number(arg('min', '5'));
const maxN = Number(arg('max', '24'));
const iters = Number(arg('iters', '12000'));
const restarts = Number(arg('restarts', '5'));
const apexLinks = Number(arg('apex', '7'));
const out = arg('out', '');

const inner = DEFAULT_DATA.crystal.coreRing + 1;
const SLOTS: [number, number][] = [];
for (let k = inner; k <= 4; k++) SLOTS.push(...ring(k));
const idx = new Map(SLOTS.map(([q, r], i) => [`${q},${r}`, i]));
/** Neighbour slot indices of each slot (within rings 2-4). */
const NB: number[][] = SLOTS.map(([q, r]) => HEX_DIRS.map(([dq, dr]) => idx.get(`${q! + dq!},${r! + dr!}`)).filter((x): x is number => x !== undefined));
const INNER = SLOTS.map(([q, r]) => hexDist(q, r) === inner);

/** cell[slot] = tag index or -1. */
type Layout = Int8Array;
type Rng = ReturnType<typeof createStream>;

function connected(cells: Layout, pred: (t: number) => boolean, fromCore: boolean): boolean {
  const members: number[] = [];
  for (let s = 0; s < cells.length; s++) if (cells[s]! >= 0 && pred(cells[s]!)) members.push(s);
  if (members.length === 0) return true;
  const seen = new Set<number>();
  const queue: number[] = fromCore ? members.filter((s) => INNER[s]) : [members[0]!];
  queue.forEach((s) => seen.add(s));
  for (let k = 0; k < queue.length; k++) {
    for (const n of NB[queue[k]!]!) {
      if (!seen.has(n) && cells[n]! >= 0 && pred(cells[n]!)) {
        seen.add(n);
        queue.push(n);
      }
    }
  }
  return seen.size === members.length;
}

/** Every tag is one connected cluster and the whole crystal reaches the core block. */
function valid(cells: Layout, tags: number): boolean {
  if (!connected(cells, () => true, true)) return false;
  for (let t = 0; t < tags; t++) if (!connected(cells, (x) => x === t, false)) return false;
  return true;
}

/** Cross-tag edges, indexed a * tags + b for a < b. */
function edges(cells: Layout, tags: number): number[] {
  const e = new Array<number>(tags * tags).fill(0);
  for (let s = 0; s < cells.length; s++) {
    const a = cells[s]!;
    if (a < 0) continue;
    for (const n of NB[s]!) {
      const b = cells[n]!;
      if (b > a) e[a * tags + b]! += 1;
    }
  }
  return e;
}

function randomLayout(n: number, tags: number, rng: Rng): Layout | null {
  const cells = new Int8Array(SLOTS.length).fill(-1);
  const innerSlots = SLOTS.map((_, i) => i).filter((i) => INNER[i]);
  for (let t = 0; t < tags && t < n; t++) {
    for (let g = 0; g < 200; g++) {
      const s = innerSlots[nextInt(rng, innerSlots.length)]!;
      if (cells[s] === -1) {
        cells[s] = t;
        break;
      }
    }
  }
  for (let placed = cells.filter((c) => c >= 0).length; placed < n; placed++) {
    const t = nextInt(rng, tags);
    const options: number[] = [];
    for (let s = 0; s < cells.length; s++) if (cells[s] === t) for (const nb of NB[s]!) if (cells[nb] === -1) options.push(nb);
    if (options.length === 0) return null;
    cells[options[nextInt(rng, options.length)]!] = t;
  }
  return cells.filter((c) => c >= 0).length === n && valid(cells, tags) ? cells : null;
}

/** Annealing: relocate a module or swap two tags; accept by Metropolis on `score`. */
function anneal(n: number, tags: number, score: (e: number[], cells: Layout) => number, seed: number): { cells: Layout; score: number } | null {
  const rng = createStream(seed, `geometry:${n}:${tags}`);
  let best: { cells: Layout; score: number } | null = null;
  for (let r = 0; r < restarts; r++) {
    let start: Layout | null = null;
    for (let g = 0; g < 50 && start === null; g++) start = randomLayout(n, tags, rng);
    if (start === null) continue;
    let cur: Layout = start;
    let curScore = score(edges(cur, tags), cur);
    if (best === null || curScore > best.score) best = { cells: Int8Array.from(cur), score: curScore };
    for (let i = 0; i < iters; i++) {
      const temp = 1.5 * (1 - i / iters) + 0.05;
      const next = Int8Array.from(cur);
      const filled: number[] = [];
      for (let s = 0; s < next.length; s++) if (next[s]! >= 0) filled.push(s);
      const a = filled[nextInt(rng, filled.length)]!;
      if (nextInt(rng, 3) === 0) {
        const b = filled[nextInt(rng, filled.length)]!;
        const t = next[a]!;
        next[a] = next[b]!;
        next[b] = t;
      } else {
        const to = nextInt(rng, next.length);
        if (next[to] !== -1) continue;
        next[to] = next[a]!;
        next[a] = -1;
      }
      if (!valid(next, tags)) continue;
      const sc = score(edges(next, tags), next);
      if (sc >= curScore || nextInt(rng, 1000) / 1000 < Math.exp((sc - curScore) / temp)) {
        cur = next;
        curScore = sc;
        if (curScore > best!.score) best = { cells: Int8Array.from(cur), score: curScore };
      }
    }
  }
  return best;
}

const pairsOf = (e: number[], tags: number) => {
  let n = 0;
  for (let a = 0; a < tags; a++) for (let b = a + 1; b < tags; b++) if (e[a * tags + b]! > 0) n++;
  return n;
};
const sizes = (cells: Layout, tags: number) => Array.from({ length: tags }, (_, t) => cells.filter((c) => c === t).length);

const T = TAGS.length;
const lines: string[] = [
  '# Crystal geometry — one cluster per tag on rings 2-4',
  '',
  `Annealed layouts (seeded; ${restarts} restarts × ${iters} steps per row; a lower bound). Slots: ${SLOTS.length} hexes on rings ${inner}-4. Every tag is one connected cluster, the crystal touches the core block.`,
  '',
  '## Distinct touching tag pairs (of 10) per module budget',
  '',
  '| modules | max touching pairs | tag sizes of the best layout | most links on one pair there |',
  '|---|---|---|---|',
];
let allPairs = 0;
for (let n = Math.max(minN, T); n <= maxN; n++) {
  const r = anneal(n, T, (e) => 1000 * pairsOf(e, T) + e.reduce((a, b) => a + b, 0), 1);
  if (r === null) {
    lines.push(`| ${n} | no layout found | | |`);
    continue;
  }
  const e = edges(r.cells, T);
  const p = pairsOf(e, T);
  if (p > allPairs) allPairs = p;
  lines.push(`| ${n} | ${p} | ${sizes(r.cells, T).join('/')} | ${Math.max(...e)} |`);
}
lines.push('', `Tag order: ${TAGS.join(', ')}. Highest pair count found over all budgets: **${allPairs} of 10**.`, '');

lines.push(`## Modules needed for a ${apexLinks}-link pair (Apex gate; two tags only, each one connected cluster)`, '', '| modules | max links between the two clusters | split A/B |', '|---|---|---|');
let apexAt = 0;
for (let n = 4; n <= maxN; n++) {
  const r = anneal(n, 2, (e) => e[1]!, 2);
  if (r === null) {
    lines.push(`| ${n} | no layout found | |`);
    continue;
  }
  const links = edges(r.cells, 2)[1]!;
  if (links >= apexLinks && apexAt === 0) apexAt = n;
  lines.push(`| ${n} | ${links} | ${sizes(r.cells, 2).join('/')} |`);
  if (apexAt > 0 && n >= apexAt + 2) break;
}
lines.push(
  '',
  apexAt > 0
    ? `First ${apexLinks}-link pair at **${apexAt} modules** (the two tags' modules together; the other three tags add at least 3 more for a full crystal, and set ≥ 4 needs stacks, not modules).`
    : `No ${apexLinks}-link pair found up to ${maxN} modules.`,
  '',
);

// The same with at least 3 modules in each cluster (set >= 4 from few stacks per module is the harder case).
lines.push(`## The same, with at least 3 modules in each of the two clusters`, '', '| modules | max links | split A/B |', '|---|---|---|');
let apex3 = 0;
for (let n = 6; n <= maxN; n++) {
  const r = anneal(n, 2, (e, cells) => e[1]! - (Math.min(...sizes(cells, 2)) >= 3 ? 0 : 100), 3);
  if (r === null || r.score < 0) {
    lines.push(`| ${n} | — | |`);
    continue;
  }
  if (r.score >= apexLinks && apex3 === 0) apex3 = n;
  lines.push(`| ${n} | ${r.score} | ${sizes(r.cells, 2).join('/')} |`);
  if (apex3 > 0 && n >= apex3 + 1) break;
}
lines.push('', apex3 > 0 ? `First ${apexLinks}-link pair with both clusters >= 3 modules: **${apex3} modules**.` : `No such pair up to ${maxN} modules.`, '');

const md = lines.join('\n');
console.log(md);
if (out) {
  writeFileSync(out, md);
  console.log(`→ ${out}`);
}

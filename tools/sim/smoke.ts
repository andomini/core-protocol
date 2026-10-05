// Runs one run until death (or 60 min of sim time) and prints a JSON summary.
// Usage: npm run sim:smoke -- [seed=1] [tier=1] [policy=none] [--unlockall]
//   policy: none | greedy | atk-first | def-first | round-robin (tools/sim/bot.ts)
import { DEFAULT_DATA, STAT_IDS } from '../../src/sim/data';
import { hashWorld } from '../../src/sim/hash';
import { POLICIES, type PolicyName } from './bot';
import { runBot } from './runner';

const pos = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const seed = Number(pos[0] ?? 1);
const tier = Number(pos[1] ?? 1);
const policy = (pos[2] ?? 'none') as PolicyName;
if (!POLICIES.includes(policy)) throw new Error(`unknown policy ${policy}; one of ${POLICIES.join(', ')}`);
const unlocked = process.argv.includes('--unlockall') ? [...STAT_IDS] : [];
const data = DEFAULT_DATA;
const r = runBot(data, policy, { seed, tier, unlocked });
const w = r.world;
const levels = Object.fromEntries(STAT_IDS.filter((id) => w.levels[id] > 0).map((id) => [id, w.levels[id]]));
console.log(
  JSON.stringify({
    seed,
    tier,
    policy,
    dead: w.dead,
    wave: w.wave,
    ticks: w.tick,
    simMinutes: Number(r.simMinutes.toFixed(1)),
    kills: w.kills,
    energy: w.energy,
    bits: w.bits,
    spent: r.spent,
    commands: r.log.length,
    levels,
    hash: hashWorld(w),
  }),
);

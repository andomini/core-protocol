// Runs one run with no upgrades until death (or 60 min of sim time) and prints a JSON summary.
// Usage: npm run sim:smoke -- [seed=1] [tier=1]
import { DEFAULT_DATA } from '../../src/sim/data';
import type { SimEvent } from '../../src/sim/events';
import { hashWorld } from '../../src/sim/hash';
import { createWorld } from '../../src/sim/state';
import { step } from '../../src/sim/step';

const seed = Number(process.argv[2] ?? 1);
const tier = Number(process.argv[3] ?? 1);
const data = DEFAULT_DATA;
const w = createWorld(data, { seed, tier });
const maxTicks = 60 * 60 * data.config.tickHz;
const events: SimEvent[] = [];
while (!w.dead && w.tick < maxTicks) {
  step(w, data, [], events);
  events.length = 0;
}
console.log(
  JSON.stringify({
    seed,
    tier,
    dead: w.dead,
    wave: w.wave,
    ticks: w.tick,
    simMinutes: Number((w.tick / data.config.tickHz / 60).toFixed(1)),
    kills: w.kills,
    energy: w.energy,
    bits: w.bits,
    hash: hashWorld(w),
  }),
);

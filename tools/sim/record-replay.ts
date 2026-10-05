// Records the golden replay (spec §6): npm run replay:record [-- --update]
// Overwrites tests/replays/golden-01.json only with --update. Any change to src/data or sim rules is
// expected to change the hashes: regenerate deliberately and record a ruling in the milestone notes.
import { existsSync, writeFileSync } from 'node:fs';
import { type BuyCount, type Command, type LoggedCommand, quoteFor } from '../../src/sim/commands';
import { DEFAULT_DATA, STAT_IDS } from '../../src/sim/data';
import type { SimEvent } from '../../src/sim/events';
import { hashWorld as hashOf } from '../../src/sim/hash';
import { replay } from '../../src/sim/replay';
import { createWorld, type RunOptions } from '../../src/sim/state';
import { step } from '../../src/sim/step';

const PATH = 'tests/replays/golden-01.json';
const data = DEFAULT_DATA;
// Workshop levels exercise that input too (M4 fills them for real): 15 % Free Upgrade, +200 % Energy per kill, +30 Energy per wave.
// M3: protocol picks are on, with both lab flags (4 cards, a free reroll) and a chain card tag.
const opts: RunOptions = {
  seed: 20261005,
  tier: 1,
  unlocked: [...STAT_IDS],
  workshop: { freeUpgrade: 15, energyBonus: 40, energyPerWave: 15, health: 5 },
  extraPerkChoice: true,
  freeReroll: true,
  cardTags: ['chain'],
};
const TICKS = 3 * 60 * data.config.tickHz;
const HASH_EVERY = 100;
const COUNTS: BuyCount[] = [1, 1, 10, 1, 'max'];

// A scripted player: cycles through all 18 stats with ×1/×10/MAX and buys whenever affordable,
// plus a few invalid commands (locked-free here, so: unaffordable and malformed) that must be no-ops.
const w = createWorld(data, opts);
const log: LoggedCommand[] = [];
const events: SimEvent[] = [];
const STARRED = STAT_IDS.filter((id) => data.stats.stats[id].lockedByDefault);
let next = 0;
let buys = 0;
let frees = 0;
let saving: { stat: (typeof STAT_IDS)[number]; count: BuyCount } | null = null;
let starred = 0;
let kind = 0;
let picks = 0;
while (w.tick < TICKS) {
  const cmds: Command[] = [];
  if (w.phase === 'pick') {
    // Opening pick: boost first; pick 2: an ad reroll and a bad index; pick 3: the free reroll.
    if (w.picks === 0) cmds.push({ type: 'boost' });
    if (w.picks === 1) cmds.push({ type: 'reroll', via: 'ad' }, { type: 'pickPerk', index: 9 });
    if (w.picks === 2) cmds.push({ type: 'reroll', via: 'free' });
    cmds.push({ type: 'pickPerk', index: picks++ % w.offer.length });
  }
  // Every 30 s, save up (≤ 30 s) for the next starred stat (they cost more), or for a ×10 batch.
  if (w.tick % 900 === 300) {
    saving = starred % 2 === 1 ? { stat: 'critChance', count: 10 } : { stat: STARRED[(starred >> 1) % STARRED.length]!, count: 1 };
    starred++;
  }
  if (saving !== null) {
    if (quoteFor(w, data, saving.stat, saving.count).affordable) {
      cmds.push({ type: 'buy', stat: saving.stat, count: saving.count });
      saving = null;
    } else if (w.tick % 900 === 299) saving = null; // give up after ~30 s
  } else {
    // Otherwise buy the next affordable stat in panel order, as ×10/MAX when that is affordable too.
    for (let k = 0; k < STAT_IDS.length; k++) {
      const stat = STAT_IDS[(next + k) % STAT_IDS.length]!;
      if (!quoteFor(w, data, stat, 1).affordable) continue;
      const want = COUNTS[kind++ % COUNTS.length]!;
      const count = quoteFor(w, data, stat, want).affordable ? want : 1;
      cmds.push({ type: 'buy', stat, count });
      next += k + 1;
      break;
    }
  }
  if (w.tick === 1000) cmds.push({ type: 'buy', stat: 'damage', count: 1000 }); // unaffordable
  if (w.tick === 2000) cmds.push({ type: 'buy', stat: 'nope', count: 1 } as unknown as Command); // unknown stat
  for (const cmd of cmds) log.push({ tick: w.tick, cmd });
  step(w, data, cmds, events);
  for (const e of events) {
    if (e.type === 'buy') {
      buys += e.levels;
      if (e.free) frees++;
    }
  }
  events.length = 0;
}
const r = replay(data, opts, log, TICKS, HASH_EVERY);
const golden = {
  note: 'Regenerate with `npm run replay:record -- --update` only for a deliberate sim/data change (see milestone notes).',
  opts,
  ticks: TICKS,
  hashEvery: HASH_EVERY,
  final: { wave: r.world.wave, dead: r.world.dead, energy: r.world.energy, levels: r.world.levels, perks: r.world.perks, setTiers: r.world.setTiers },
  log,
  hashes: r.hashes,
};
if (hashOf(r.world) !== hashOf(w)) throw new Error('record-replay: the replay does not reproduce the recorded run');
const summary = `${log.length} commands, ${buys} levels (${frees} free), ${r.world.picks} picks, ${r.hashes.length} hashes, final wave ${r.world.wave}, dead ${r.world.dead}`;
if (existsSync(PATH) && !process.argv.includes('--update')) {
  console.log(`${PATH} exists; pass --update to overwrite (${summary}).`);
} else {
  writeFileSync(PATH, JSON.stringify(golden) + '\n');
  console.log(`wrote ${PATH}: ${summary}`);
}

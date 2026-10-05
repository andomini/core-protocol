// Runs one bot run until death (or a time limit) and returns a summary plus its command log.
// A run is a buy policy × a pick policy (protocol offers are answered with a pickPerk command).
import type { Command, LoggedCommand } from '../../src/sim/commands';
import type { GameData } from '../../src/sim/data';
import type { SimEvent } from '../../src/sim/events';
import { createWorld, type RunOptions, type World } from '../../src/sim/state';
import { step } from '../../src/sim/step';
import { makeBot, makePicker, type PickPolicyName, type PolicyName } from './bot';
import type { Tag } from '../../src/sim/perkData';

export interface RunResult {
  policy: PolicyName;
  pick: PickPolicyName;
  seed: number;
  wave: number;
  dead: boolean;
  ticks: number;
  simMinutes: number;
  kills: number;
  bits: number;
  spent: number;
  buys: number;
  world: World;
  log: LoggedCommand[];
  /** Wave → sim seconds at its start (for the per-wave curve). */
  waveStartS: number[];
  /** Sim seconds from the run start to the first protocol offer (B1). */
  firstPickS: number;
  picks: number;
  /** Wave in which the first 2-set / 4-set / 6-set switched on (0 = never). */
  set2Wave: number;
  set4Wave: number;
  set6Wave: number;
  /** The tag of the first 2-set. */
  set2Tag: Tag | null;
  keys: number;
}

export function runBot(data: GameData, policy: PolicyName, opts: RunOptions, maxMinutes = 60, pick: PickPolicyName = 'greedy-pick'): RunResult {
  const w = createWorld(data, opts);
  const bot = makeBot(policy);
  const picker = makePicker(pick, opts.seed);
  const firstPickS = w.phase === 'pick' ? 0 : -1;
  let set2Wave = 0;
  let set4Wave = 0;
  let set6Wave = 0;
  let set2Tag: Tag | null = null;
  const log: LoggedCommand[] = [];
  const events: SimEvent[] = [];
  const maxTicks = maxMinutes * 60 * data.config.tickHz;
  const waveStartS: number[] = [];
  let spent = 0;
  let buys = 0;
  while (!w.dead && w.tick < maxTicks) {
    const cmds: Command[] = bot.decide(w, data);
    if (w.phase === 'pick') cmds.push({ type: 'pickPerk', index: picker.choose(w, data) });
    for (const cmd of cmds) log.push({ tick: w.tick, cmd });
    step(w, data, cmds, events);
    for (const e of events) {
      if (e.type === 'buy') {
        spent += e.cost;
        buys += e.levels;
      } else if (e.type === 'waveStart') waveStartS[e.wave] = w.tick / data.config.tickHz;
      else if (e.type === 'setTier') {
        // A pick between waves counts for the wave just played (the set is live from the next one).
        const wave = Math.max(1, w.wave);
        if (e.tier >= 2 && set2Wave === 0) {
          set2Wave = wave;
          set2Tag = e.tag;
        }
        if (e.tier >= 4 && set4Wave === 0) set4Wave = wave;
        if (e.tier >= 6 && set6Wave === 0) set6Wave = wave;
      }
    }
    events.length = 0;
  }
  return {
    policy,
    pick,
    firstPickS,
    picks: w.picks,
    set2Wave,
    set4Wave,
    set6Wave,
    set2Tag,
    keys: w.keys,
    seed: opts.seed,
    wave: w.wave,
    dead: w.dead,
    ticks: w.tick,
    simMinutes: w.tick / data.config.tickHz / 60,
    kills: w.kills,
    bits: w.bits,
    spent,
    buys,
    world: w,
    log,
    waveStartS,
  };
}

// Runs one bot run until death (or a time limit) and returns a summary plus its command log.
import type { Command, LoggedCommand } from '../../src/sim/commands';
import type { GameData } from '../../src/sim/data';
import type { SimEvent } from '../../src/sim/events';
import { createWorld, type RunOptions, type World } from '../../src/sim/state';
import { step } from '../../src/sim/step';
import { makeBot, type PolicyName } from './bot';

export interface RunResult {
  policy: PolicyName;
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
}

export function runBot(data: GameData, policy: PolicyName, opts: RunOptions, maxMinutes = 60): RunResult {
  const w = createWorld(data, opts);
  const bot = makeBot(policy);
  const log: LoggedCommand[] = [];
  const events: SimEvent[] = [];
  const maxTicks = maxMinutes * 60 * data.config.tickHz;
  const waveStartS: number[] = [];
  let spent = 0;
  let buys = 0;
  while (!w.dead && w.tick < maxTicks) {
    const cmds: Command[] = bot.decide(w, data);
    for (const cmd of cmds) log.push({ tick: w.tick, cmd });
    step(w, data, cmds, events);
    for (const e of events) {
      if (e.type === 'buy') {
        spent += e.cost;
        buys += e.levels;
      } else if (e.type === 'waveStart') waveStartS[e.wave] = w.tick / data.config.tickHz;
    }
    events.length = 0;
  }
  return {
    policy,
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

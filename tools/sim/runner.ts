// Runs one bot run until death (or a time limit) and returns a summary plus its command log.
// A run is a buy policy × a pick policy (protocol offers are answered with a pickPerk command).
import type { Command, LoggedCommand } from '../../src/sim/commands';
import type { GameData } from '../../src/sim/data';
import type { SimEvent } from '../../src/sim/events';
import { createWorld, type RunOptions, type World } from '../../src/sim/state';
import { step } from '../../src/sim/step';
import { type CrystalMode, fusionPick, makeArranger, makeBot, makePicker, type PickPolicyName, type PolicyName } from './bot';
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
  /** Virus damage that landed on wall segments / on the core over the run (after Defense; structHit / coreHit events, blocked hits excluded). */
  wallTaken: number;
  /** Virus damage that landed on Relay Stations (structHit events of kind station): the decoy share beside wallTaken / coreTaken. */
  stationTaken: number;
  coreTaken: number;
  /** Kills (and their Energy) whose killing hit came from a Bastion turret / a Minefield blast, against all kills and all kill Energy. */
  turretKills: number;
  mineKills: number;
  turretEnergy: number;
  mineEnergy: number;
  killEnergy: number;
  /** Energy the Relay Stations paid over the run (stationPay events), against all kill Energy above. */
  stationEnergy: number;
  /** Highest tier each fusion reached at any moment of the run (fusion events; absent = never), and the crystal mode. */
  fusionMax: Record<string, number>;
  crystal: CrystalMode;
  /** Kill Energy and kill Bits by the source of the killing hit (hit.source: bullet, bounce, lightning, tesla, mine, turret, ...). */
  energyBySource: Record<string, number>;
  bitsBySource: Record<string, number>;
}

export function runBot(data: GameData, policy: PolicyName, opts: RunOptions, maxMinutes = 60, pick: PickPolicyName = 'greedy-pick', crystal: CrystalMode = 'auto'): RunResult {
  const w = createWorld(data, opts);
  const bot = makeBot(policy);
  const picker = makePicker(pick, opts.seed);
  const arranger = crystal === 'arrange' ? makeArranger() : null;
  const fusionMax: Record<string, number> = {};
  const energyBySource: Record<string, number> = {};
  const bitsBySource: Record<string, number> = {};
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
  let wallTaken = 0;
  let stationTaken = 0;
  let coreTaken = 0;
  let turretKills = 0;
  let mineKills = 0;
  let turretEnergy = 0;
  let mineEnergy = 0;
  let killEnergy = 0;
  let stationEnergy = 0;
  // The source of each enemy's latest hit this tick: the kill event follows its killing hit.
  const lastHit = new Map<number, string>();
  while (!w.dead && w.tick < maxTicks) {
    const cmds: Command[] = bot.decide(w, data);
    if (w.phase === 'pick') {
      if (arranger) {
        const fp = fusionPick(w, data);
        cmds.push(fp.slot ? { type: 'pickPerk', index: fp.index, slot: fp.slot } : { type: 'pickPerk', index: fp.index });
      } else cmds.push({ type: 'pickPerk', index: picker.choose(w, data) });
    } else if (arranger) cmds.push(...arranger.decide(w, data));
    for (const cmd of cmds) log.push({ tick: w.tick, cmd });
    step(w, data, cmds, events);
    for (const e of events) {
      if (e.type === 'buy') {
        spent += e.cost;
        buys += e.levels;
      } else if (e.type === 'hit') lastHit.set(e.enemyId, e.source);
      else if (e.type === 'kill') {
        killEnergy += e.energy;
        const src = lastHit.get(e.enemyId);
        energyBySource[src ?? '?'] = (energyBySource[src ?? '?'] ?? 0) + e.energy;
        bitsBySource[src ?? '?'] = (bitsBySource[src ?? '?'] ?? 0) + e.bits;
        if (src === 'turret') {
          turretKills += 1;
          turretEnergy += e.energy;
        } else if (src === 'mine') {
          mineKills += 1;
          mineEnergy += e.energy;
        }
      } else if (e.type === 'fusion') fusionMax[e.key] = Math.max(fusionMax[e.key] ?? 0, e.tier);
      else if (e.type === 'structHit') {
        if (e.kind === 'wall') wallTaken += e.damage;
        else if (e.kind === 'station') stationTaken += e.damage;
      } else if (e.type === 'stationPay') stationEnergy += e.energy;
      else if (e.type === 'coreHit') coreTaken += e.blocked ? 0 : e.damage;
      else if (e.type === 'waveStart') waveStartS[e.wave] = w.tick / data.config.tickHz;
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
    lastHit.clear();
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
    wallTaken,
    stationTaken,
    coreTaken,
    turretKills,
    mineKills,
    turretEnergy,
    mineEnergy,
    killEnergy,
    stationEnergy,
    fusionMax,
    crystal,
    energyBySource,
    bitsBySource,
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

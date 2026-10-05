// Meta → sim: the RunOptions for a new run from the player's workshop, labs and (M5) cards.
import type { GameData } from '../sim/data';
import type { RunOptions } from '../sim/state';
import { loadoutBonus, loadoutForRun } from './cards';
import { labEffects } from './labs';
import type { MetaData } from './metaData';
import type { MetaState } from './state';

export function buildRunOptions(m: MetaState, _data: GameData, md: MetaData, tier: number, seed: number): RunOptions {
  const e = labEffects(m, md);
  const lo = loadoutForRun(m, md);
  const b = loadoutBonus(m, md);
  return {
    seed,
    tier,
    workshop: { ...m.workshop },
    unlocked: e.unlocked,
    extraPerkChoice: e.perkChoice,
    freeReroll: e.freeReroll,
    pickEvery: e.pickEvery || undefined,
    rareMul: e.rareMul,
    maxLevelBonus: e.maxLevelBonus,
    startEnergy: e.startEnergy + b.startEnergy,
    cardTags: lo.cardTags,
    cards: lo.cards,
    metaBonus: { bitsMul: b.bitsMul, fastBootWaves: b.fastBootWaves, secondWind: b.secondWind },
  };
}

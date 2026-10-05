// Lab research tree (no timers, spec §3.3): one-time nodes bought with Bits that change the rules.
import type { StatId } from '../sim/data';
import { labNode, type MetaData } from './metaData';
import type { MetaState } from './state';

export type LabNodeState = 'owned' | 'available' | 'locked';

export function labState(m: MetaState, md: MetaData, id: string): LabNodeState {
  if (m.labs.includes(id)) return 'owned';
  const n = labNode(md, id);
  if (!n) return 'locked';
  return n.requires.every((r) => m.labs.includes(r)) ? 'available' : 'locked';
}

export function buyLab(m: MetaState, md: MetaData, id: string): boolean {
  const n = labNode(md, id);
  if (!n || labState(m, md, id) !== 'available' || m.bits < n.cost) return false;
  m.bits -= n.cost;
  m.labs.push(id);
  return true;
}

export interface LabEffects {
  /** Player-selectable game speeds. */
  speeds: number[];
  unlocked: StatId[];
  maxLevelBonus: Partial<Record<StatId, number>>;
  perkChoice: boolean;
  freeReroll: boolean;
  rareMul: number;
  pickEvery: number;
  /** Card slots (2 base + lab nodes). */
  cardSlots: number;
  presets: boolean;
  bitsMul: number;
  startEnergy: number;
  offlineCapHours: number;
}

export function labEffects(m: MetaState, md: MetaData): LabEffects {
  const e: LabEffects = {
    speeds: [1, 2],
    unlocked: [],
    maxLevelBonus: {},
    perkChoice: false,
    freeReroll: false,
    rareMul: 1,
    pickEvery: 0,
    cardSlots: 2,
    presets: false,
    bitsMul: 1,
    startEnergy: 0,
    offlineCapHours: md.offline.capHours,
  };
  for (const n of md.labs.nodes) {
    if (!m.labs.includes(n.id)) continue;
    const f = n.effect;
    switch (f.type) {
      case 'speed':
        if (!e.speeds.includes(f.value)) e.speeds.push(f.value);
        break;
      case 'unlock':
        if (!e.unlocked.includes(f.stat)) e.unlocked.push(f.stat);
        break;
      case 'maxLevel':
        e.maxLevelBonus[f.stat] = (e.maxLevelBonus[f.stat] ?? 0) + f.value;
        break;
      case 'perkChoice':
        e.perkChoice = true;
        break;
      case 'freeReroll':
        e.freeReroll = true;
        break;
      case 'rareMul':
        e.rareMul = Math.max(e.rareMul, f.value);
        break;
      case 'pickEvery':
        e.pickEvery = e.pickEvery === 0 ? f.value : Math.min(e.pickEvery, f.value);
        break;
      case 'cardSlot':
        e.cardSlots += 1;
        break;
      case 'presets':
        e.presets = true;
        break;
      case 'bitsMul':
        e.bitsMul *= f.value;
        break;
      case 'startEnergy':
        e.startEnergy += f.value;
        break;
      case 'offlineCap':
        e.offlineCapHours = Math.max(e.offlineCapHours, f.hours);
        break;
    }
  }
  e.speeds.sort((a, b) => a - b);
  return e;
}

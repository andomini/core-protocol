// One-line descriptions of lab node effects (from data).
import type { GameData } from '../sim/data';
import type { LabEffect } from '../meta/metaData';

export function labEffectText(data: GameData, e: LabEffect): string {
  switch (e.type) {
    case 'speed':
      return `Game speed ×${e.value}`;
    case 'unlock':
      return `Unlocks ${data.stats.stats[e.stat].name}`;
    case 'maxLevel':
      return `${data.stats.stats[e.stat].name}: +${e.value} max levels`;
    case 'perkChoice':
      return '4 protocol cards per pick';
    case 'freeReroll':
      return '1 free protocol reroll per run';
    case 'rareMul':
      return `Rare & Epic protocols ×${e.value}`;
    case 'pickEvery':
      return `Protocols every ${e.value} waves`;
    case 'cardSlot':
      return '+1 card slot';
    case 'presets':
      return 'Save loadout presets';
    case 'bitsMul':
      return `+${Math.round((e.value - 1) * 100)}% Bits per run`;
    case 'startEnergy':
      return `+${e.value} Energy at run start`;
    case 'offlineCap':
      return `Offline income up to ${e.hours}h`;
  }
}

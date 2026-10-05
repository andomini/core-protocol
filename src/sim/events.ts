import type { EnemyKind, StatId } from './data';
import type { Tag } from './perkData';
import type { ProtocolReject } from './perks';

export type BuyRejectReason = 'dead' | 'unknown' | 'badCount' | 'locked' | 'maxed' | 'funds';

/** Everything the sim reports to render/UI/telemetry. Events are not part of the World. */
export type SimEvent =
  | { type: 'waveStart'; wave: number; boss: boolean }
  | { type: 'waveEnd'; wave: number }
  /** End-of-wave income: flat Energy/Wave, Interest on unspent Energy (capped), flat Bits/Wave. */
  | { type: 'waveReward'; wave: number; energy: number; interest: number; bits: number }
  | { type: 'spawn'; id: number; kind: EnemyKind; x: number; y: number }
  /** `big`: an every-Nth-shot (Hot Barrel) projectile. */
  | { type: 'shot'; projectileId: number; targetId: number; crit: boolean; big: boolean }
  | { type: 'hit'; enemyId: number; damage: number; crit: boolean; source: 'shot' | 'thorns' | 'lightning' }
  | { type: 'kill'; enemyId: number; kind: EnemyKind; energy: number; bits: number; keys: number }
  /** `blocked`: absorbed by the 🛡 immunity window. */
  | { type: 'coreHit'; enemyId: number; damage: number; ranged: boolean; blocked: boolean }
  /** A protocol offer opened (or was rerolled). */
  | { type: 'pickOffer'; pick: number; wave: number; offer: string[]; rerolls: number }
  | { type: 'perkPicked'; id: string; stacks: number }
  | { type: 'setTier'; tag: Tag; tier: number }
  | { type: 'boost'; from: number; until: number }
  | { type: 'commandRejected'; cmd: string; reason: ProtocolReject | 'unknown' }
  | { type: 'freeze'; enemyId: number }
  | { type: 'freezeAll'; count: number; untilTick: number }
  | { type: 'lightning'; fromId: number; targets: number[] }
  | { type: 'bounce'; projectileId: number; fromId: number; toId: number }
  | { type: 'overdrive'; untilTick: number }
  | { type: 'immunity'; untilTick: number }
  | { type: 'buy'; stat: StatId; levels: number; level: number; cost: number; free: boolean }
  | { type: 'buyRejected'; stat: string; reason: BuyRejectReason }
  /** `bonusBits`: the run-end Bits bonus (💰 4-set) added at death. */
  | { type: 'death'; wave: number; tick: number; bonusBits: number };

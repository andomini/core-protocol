import type { EnemyKind, StatId } from './data';

export type BuyRejectReason = 'dead' | 'unknown' | 'badCount' | 'locked' | 'maxed' | 'funds';

/** Everything the sim reports to render/UI/telemetry. Events are not part of the World. */
export type SimEvent =
  | { type: 'waveStart'; wave: number; boss: boolean }
  | { type: 'waveEnd'; wave: number }
  /** End-of-wave income: flat Energy/Wave, Interest on unspent Energy (capped), flat Bits/Wave. */
  | { type: 'waveReward'; wave: number; energy: number; interest: number; bits: number }
  | { type: 'spawn'; id: number; kind: EnemyKind; x: number; y: number }
  | { type: 'shot'; projectileId: number; targetId: number; crit: boolean }
  | { type: 'hit'; enemyId: number; damage: number; crit: boolean; source: 'shot' | 'thorns' }
  | { type: 'kill'; enemyId: number; kind: EnemyKind; energy: number; bits: number }
  | { type: 'coreHit'; enemyId: number; damage: number; ranged: boolean }
  | { type: 'buy'; stat: StatId; levels: number; level: number; cost: number; free: boolean }
  | { type: 'buyRejected'; stat: string; reason: BuyRejectReason }
  | { type: 'death'; wave: number; tick: number };

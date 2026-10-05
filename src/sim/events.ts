import type { EnemyKind } from './data';

/** Everything the sim reports to render/UI/telemetry. Events are not part of the World. */
export type SimEvent =
  | { type: 'waveStart'; wave: number; boss: boolean }
  | { type: 'waveEnd'; wave: number }
  | { type: 'spawn'; id: number; kind: EnemyKind; x: number; y: number }
  | { type: 'shot'; projectileId: number; targetId: number }
  | { type: 'hit'; enemyId: number; damage: number }
  | { type: 'kill'; enemyId: number; kind: EnemyKind; energy: number; bits: number }
  | { type: 'coreHit'; enemyId: number; damage: number; ranged: boolean }
  | { type: 'death'; wave: number; tick: number };

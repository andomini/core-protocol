import type { EnemyKind, StatId } from './data';
import type { StructureKind, Tag } from './perkData';
import type { ProtocolReject } from './perks';
import type { HitSource } from './projectiles';

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
  /** `dealt`: damage actually removed (no overkill); `healed`: Lifesteal HP from this hit. */
  | { type: 'hit'; enemyId: number; damage: number; dealt: number; crit: boolean; source: HitSource; healed: number }
  /** `returned`: the share of `bits` that was a Leech's stolen Bits paid back (absent when none). */
  | { type: 'kill'; enemyId: number; kind: EnemyKind; energy: number; bits: number; keys: number; returned?: number }
  /** A Leech's core hit stole `bits` from the run; it now carries `carried` (paid back × returnMul by its kill). */
  | { type: 'steal'; enemyId: number; bits: number; carried: number }
  /** A dead spore at (x, y) burst into the copies `ids` (their own spawn events come first). */
  | { type: 'split'; enemyId: number; kind: EnemyKind; x: number; y: number; ids: number[] }
  /** A Bounty Mark was killed (its kill event already paid `energy`/`bits`, Mark multipliers included). */
  | { type: 'markKill'; enemyId: number; x: number; y: number; energy: number; bits: number }
  /** The Bounty jackpot paid `bits` (the run's `n`th jackpot) at the Mark killed at (x, y). */
  | { type: 'bountyJackpot'; bits: number; n: number; x: number; y: number }
  /** `blocked`: absorbed by the 🛡 immunity window. */
  | { type: 'coreHit'; enemyId: number; damage: number; ranged: boolean; blocked: boolean; absorbed: number }
  /** A virus attack landed on a structure (`damage` after Defense; the structure's own HP, not the core's). */
  | { type: 'structHit'; sid: number; kind: StructureKind; x: number; y: number; enemyId: number; damage: number; ranged: boolean }
  /** A structure was destroyed (or, with a link broken, counted as destroyed); it comes back at `structUp`. */
  | { type: 'structDown'; sid: number; kind: StructureKind; x: number; y: number }
  /** A Bastion turret fired at `targetIds` from (x, y). */
  | { type: 'turretShot'; sid: number; targetIds: number[]; x: number; y: number }
  /** A mine went off at (x, y) with blast radius r; the mine is gone. */
  | { type: 'mineBlast'; x: number; y: number; r: number }
  /** A destroyed structure was rebuilt (regrow, wave-start repair, revive). */
  | { type: 'structUp'; sid: number; kind: StructureKind; x: number; y: number }
  /** A Relay Station paid out at a wave end (after the powered share, streak and bonuses). */
  | { type: 'stationPay'; sid: number; x: number; y: number; energy: number; bits: number }
  /** A protocol offer opened (or was rerolled). */
  | { type: 'pickOffer'; pick: number; wave: number; offer: string[]; rerolls: number }
  /** `module`: the crystal hex of the perk's module ([q, r]), when it has one. */
  | { type: 'perkPicked'; id: string; stacks: number; module: [number, number] | null }
  // boot
  /** The boot sector `id` was taken: its modules stand on these hexes (after their perkPicked events). */
  | { type: 'bootPicked'; id: string; tag: Tag; modules: [number, number][] }
  /** The virus genome gained a level against `tag` (spec 2026-10-14 §C). */
  | { type: 'mutation'; tag: Tag; level: number }
  /** The breach widened at a wave start: the spawn ring is now `radius` (world px). */
  | { type: 'arenaGrow'; radius: number; ring: number; ringGrew: boolean; nests: number }
  /** A nest's cell was reclaimed: the nest is gone and paid out. */
  | { type: 'nestDestroyed'; x: number; y: number; energy: number; bits: number }
  /** A set's tier changed (`tier` < `prev`: a move broke the cluster). */
  | { type: 'setTier'; tag: Tag; tier: number; prev: number }
  /** A fusion's tier changed; `a`, `b`: the module hexes of the pair's first link (null when none is left). */
  | { type: 'fusion'; key: string; tier: number; prev: number; a: [number, number] | null; b: [number, number] | null }
  | { type: 'boost'; from: number; until: number }
  | { type: 'commandRejected'; cmd: string; reason: ProtocolReject | 'unknown' }
  | { type: 'freeze'; enemyId: number }
  | { type: 'freezeAll'; count: number; untilTick: number }
  | { type: 'lightning'; fromId: number; targets: number[] }
  | { type: 'bounce'; projectileId: number; fromId: number; toId: number }
  | { type: 'overdrive'; untilTick: number }
  | { type: 'damageBoost'; untilTick: number }
  /** Wave Skip (card): the wave's regular viruses were skipped and their rewards paid. */
  | { type: 'waveSkip'; wave: number; energy: number; bits: number }
  | { type: 'revive'; hp: number }
  | { type: 'immunity'; untilTick: number }
  | { type: 'buy'; stat: StatId; levels: number; level: number; cost: number; free: boolean }
  | { type: 'buyRejected'; stat: string; reason: BuyRejectReason }
  /** pulse: the core fired its Pulse (tag null: the plain ring); `energy`/`bits` paid by a mining harvest, `shield` added by firewall. */
  | { type: 'pulse'; tag: Tag | null; x: number; y: number; radius: number; targets: number; energy: number; bits: number; shield: number }
  /** `bonusBits`: the run-end Bits bonus (💰 4-set) added at death. */
  | { type: 'death'; wave: number; tick: number; bonusBits: number };

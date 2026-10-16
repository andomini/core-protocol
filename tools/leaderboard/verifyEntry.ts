// Replay verification of one leaderboard submission (spec 2026-10-16-leaderboards-design.md §Verification).
// server/verifier/verify.ts runs THIS FILE FROM THE BUILD'S COMMIT (a git worktree), so the sim and data are
// the ones the player ran. Contract (keep it stable; bump ENTRY_VERSION on a breaking change):
//   stdin  = JSON VerifyInput      stdout = JSON VerifyOutput (one line)      exit 0 even for "rejected".
// Whatever the replay holds, this entry answers "rejected" rather than throwing: a crash would leave the run
// pending (and retried) on the verifier side.
import { gunzipSync } from 'node:zlib';
import { loadoutBonus } from '../../src/meta/cards';
import {
  allowanceBits,
  claimError,
  dailyClaim,
  dailyRunOptions,
  dailySeed,
  dayIndex,
  earnedBits,
  LEADERBOARD,
  type LoadoutClaim,
  loadoutBits,
  metaFromClaim,
  runOptionsFromClaim,
  sameClaim,
} from '../../src/meta/leaderboardRules';
import { DEFAULT_META_DATA, type MetaData } from '../../src/meta/metaData';
import type { LoggedCommand } from '../../src/sim/commands';
import { DEFAULT_DATA, type GameData } from '../../src/sim/data';
import { hashWorld } from '../../src/sim/hash';
import { replayToEnd } from '../../src/sim/replay';

export const ENTRY_VERSION = 1;

/** What the client uploads as `replay` (JSON, or "gz:" + base64(gzip(JSON))). */
export interface ReplayPayload {
  v: 1;
  seed: number;
  tier: number;
  claim: LoadoutClaim;
  log: LoggedCommand[];
}

export interface VerifyInput {
  kind: 'tier' | 'daily';
  tier: number;
  day: string | null;
  wave: number;
  ticks: number;
  hash: string;
  /** The stored replay string. */
  replay: string;
  /** Bits credited to the player from earlier verified runs (tier-board allowance). */
  verifiedBits: number;
  /**
   * The seed the server issued with the run's start token. Daily: the day's seed (may be secret; absent = the
   * public dailySeed(day)). Tier: the random seed of POST /v1/runs/start (absent = not checked).
   */
  seed?: number;
}

export interface VerifyOutput {
  entry: number;
  status: 'verified' | 'rejected' | 'flagged';
  reason?: string;
  wave?: number;
  ticks?: number;
  earnedBits: number;
  loadoutBits: number;
  allowanceBits: number;
}

/** Largest decompressed replay (a gzip bomb stops here instead of exhausting memory). */
export const MAX_REPLAY_TEXT = 16_000_000;

export function decodeReplay(s: string): unknown {
  const text = s.startsWith('gz:') ? gunzipSync(Buffer.from(s.slice(3), 'base64'), { maxOutputLength: MAX_REPLAY_TEXT }).toString('utf8') : s;
  if (text.length > MAX_REPLAY_TEXT) throw new Error('replay too large');
  return JSON.parse(text);
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

const isInt = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x) && x >= 0;

function payloadError(p: unknown, maxLog: number): string | null {
  if (typeof p !== 'object' || p === null) return 'payload: not an object';
  const o = p as Partial<ReplayPayload>;
  if (o.v !== 1) return `payload: unsupported version ${String(o.v)}`;
  if (!isInt(o.seed) || !isInt(o.tier)) return 'payload: bad seed/tier';
  const c = o.claim as unknown;
  if (!isObj(c) || !isObj(c.workshop) || !Array.isArray(c.labs) || !isObj(c.cards)) return 'payload: bad claim';
  if (!Array.isArray(o.log) || o.log.length > maxLog) return 'payload: bad log';
  for (const l of o.log) {
    if (typeof l !== 'object' || l === null || !isInt(l.tick) || typeof l.cmd !== 'object' || l.cmd === null || typeof l.cmd.type !== 'string') return 'payload: bad log entry';
  }
  return null;
}

const out = (status: VerifyOutput['status'], reason?: string, extra: Partial<VerifyOutput> = {}): VerifyOutput => ({
  entry: ENTRY_VERSION,
  status,
  ...(reason === undefined ? {} : { reason }),
  earnedBits: 0,
  loadoutBits: 0,
  allowanceBits: 0,
  ...extra,
});

/** Checks one submission; never throws (anything unexpected in the payload is a rejection). */
export function verifySubmission(input: VerifyInput, data: GameData = DEFAULT_DATA, md: MetaData = DEFAULT_META_DATA): VerifyOutput {
  try {
    return check(input, data, md);
  } catch (e) {
    return out('rejected', `payload: ${e instanceof Error ? e.message : String(e)}`.slice(0, 300));
  }
}

function check(input: VerifyInput, data: GameData, md: MetaData): VerifyOutput {
  let p: ReplayPayload;
  try {
    const raw = decodeReplay(input.replay);
    const err = payloadError(raw, LEADERBOARD.maxLogEntries);
    if (err) return out('rejected', err);
    p = raw as ReplayPayload;
  } catch (e) {
    return out('rejected', `payload: ${(e as Error).message}`);
  }
  if (p.tier !== input.tier) return out('rejected', 'payload: tier differs from the submission');
  if (input.tier < 1 || input.tier > data.tiers.length) return out('rejected', 'tier out of range');
  let opts;
  let claim: LoadoutClaim;
  if (input.kind === 'daily') {
    if (input.day === null || !Number.isFinite(dayIndex(input.day))) return out('rejected', 'daily: bad day');
    opts = dailyRunOptions(input.day, data, md, LEADERBOARD, input.seed ?? dailySeed(input.day));
    if (p.seed !== opts.seed || p.tier !== opts.tier) return out('rejected', 'daily: seed or tier is not the day’s');
    claim = dailyClaim(input.day);
    if (!sameClaim(p.claim, claim)) return out('rejected', 'daily: loadout is not the day’s');
  } else {
    // Tier: the seed the server issued with the run's start token (absent = a run from before server starts).
    if (input.seed !== undefined && p.seed !== input.seed) return out('rejected', 'seed: not the issued one');
    const err = claimError(p.claim, data, md);
    if (err) return out('rejected', err);
    claim = p.claim;
    opts = runOptionsFromClaim(claim, data, md, p.tier, p.seed);
  }
  // A revive with an explicit HP share is Second Wind: only with that card, at its value.
  const secondWind = loadoutBonus(metaFromClaim(claim), md).secondWind;
  for (const l of p.log) {
    const hp = l.cmd.type === 'revive' ? l.cmd.hp : undefined;
    if (hp !== undefined && (secondWind <= 0 || hp !== secondWind)) return out('rejected', 'revive: HP share without Second Wind');
  }
  let world;
  try {
    world = replayToEnd(data, opts, p.log, input.ticks);
  } catch (e) {
    return out('rejected', (e as Error).message);
  }
  const extra = { wave: world.wave, ticks: world.tick };
  if (world.tick !== input.ticks || world.wave !== input.wave) return out('rejected', `mismatch: replay ended at wave ${world.wave}, tick ${world.tick}`, extra);
  if (hashWorld(world) !== input.hash) return out('rejected', 'mismatch: final hash', extra);
  const cost = loadoutBits(claim, md);
  const allow = input.kind === 'daily' ? Infinity : allowanceBits(input.verifiedBits);
  const res = { ...extra, earnedBits: earnedBits(world.bits, claim, md), loadoutBits: cost, allowanceBits: Number.isFinite(allow) ? allow : 0 };
  if (cost > allow) return out('flagged', `loadout costs ${Math.round(cost)} Bits, allowance ${Math.round(allow)}`, res);
  return out('verified', undefined, res);
}

async function main(): Promise<void> {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  let res: VerifyOutput;
  try {
    const input = JSON.parse(Buffer.concat(chunks).toString('utf8')) as VerifyInput;
    if (!isObj(input) || typeof input.replay !== 'string') throw new Error('bad input');
    res = verifySubmission(input);
  } catch (e) {
    res = out('rejected', `input: ${e instanceof Error ? e.message : String(e)}`);
  }
  process.stdout.write(`${JSON.stringify(res)}\n`);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().catch((e) => {
    process.stderr.write(`${(e as Error).stack ?? String(e)}\n`);
    process.exit(1);
  });
}

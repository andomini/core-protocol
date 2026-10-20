import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import battleJson from '../src/data/battle.json';
import configJson from '../src/data/config.json';
import devJson from '../src/data/dev.json';
import labsJson from '../src/data/labs.json';
import { RunSession } from '../src/render/RunSession';
import {
  allowanceBits,
  claimError,
  claimFromMeta,
  dailyClaim,
  dailyRunOptions,
  dailySeed,
  dayIndex,
  LEADERBOARD,
  type LoadoutClaim,
  loadoutBits,
  runOptionsFromClaim,
  weekKey,
} from '../src/meta/leaderboardRules';
import { DEFAULT_META_DATA as MD } from '../src/meta/metaData';
import { buildRunOptions } from '../src/meta/runOptions';
import { defaultMeta } from '../src/meta/state';
import { DEFAULT_DATA, type GameData, STAT_IDS } from '../src/sim/data';
import { hashWorld } from '../src/sim/hash';
import type { RunOptions } from '../src/sim/state';
import { type VerifyInput, verifySubmission } from '../tools/leaderboard/verifyEntry';
import { testData } from './helpers';

const EMPTY: LoadoutClaim = { workshop: {}, labs: [], cards: {} };
// Hard-hitting viruses: a run dies within a few thousand ticks.
const hard = (k = 1): GameData =>
  testData({ enemies: { basic: { damage: 12 * k }, fast: { damage: 8 * k }, tank: { damage: 32 * k }, ranged: { damage: 16 * k }, boss: { damage: 40 * k } } }, { health: 2000 });

/** Plays a run to death with buys, picks and a post-death command; returns the submission. */
function play(data: GameData, opts: RunOptions, claim: LoadoutClaim, kind: 'tier' | 'daily' = 'tier', day: string | null = null): VerifyInput {
  const s = new RunSession(data, opts);
  let i = 0;
  while (!s.world.dead && s.world.tick < 60000) {
    s.advance(9, () => {});
    if (s.picking) {
      s.queue(s.world.bootOffer.length > 0 ? { type: 'pickBoot', index: i % 3 } : { type: 'pickPerk', index: i % 3 });
      if (i % 2 === 0) s.applyPendingNow(() => {});
    }
    s.queue({ type: 'buy', stat: STAT_IDS[i++ % STAT_IDS.length]!, count: i % 4 === 0 ? 'max' : 1 });
  }
  s.queue({ type: 'buy', stat: 'damage', count: 1 });
  s.applyPendingNow(() => {});
  expect(s.world.dead).toBe(true);
  const replay = JSON.stringify({ v: 1, seed: opts.seed, tier: opts.tier, claim, log: s.log });
  return { kind, tier: opts.tier, day, wave: s.world.wave, ticks: s.world.tick, hash: hashWorld(s.world), replay, verifiedBits: 0 };
}

describe('leaderboard rules', () => {
  it('a claim rebuilds exactly the RunOptions of the save it came from', () => {
    const m = defaultMeta();
    m.workshop = { damage: 7, health: 3, multishot: 2 };
    m.labs = ['multishot', 'freeReroll', 'rare1', 'slot3', 'bits1', 'startEnergy'];
    m.cards = { damage: 4, bitsPlus: 1, ricochet: 2, health: 0 };
    m.loadout = ['damage', 'bitsPlus', 'ricochet'];
    const c = claimFromMeta(m, MD);
    expect(claimError(c, DEFAULT_DATA, MD)).toBeNull();
    expect(runOptionsFromClaim(JSON.parse(JSON.stringify(c)) as LoadoutClaim, DEFAULT_DATA, MD, 2, 99)).toEqual(buildRunOptions(m, DEFAULT_DATA, MD, 2, 99));
  });

  it('rejects impossible claims', () => {
    expect(claimError({ ...EMPTY, labs: ['rare1'] }, DEFAULT_DATA, MD)).toMatch(/prerequisites/);
    expect(claimError({ ...EMPTY, labs: ['nope'] }, DEFAULT_DATA, MD)).toMatch(/unknown lab/);
    expect(claimError({ ...EMPTY, workshop: { multishot: 1 } }, DEFAULT_DATA, MD)).toMatch(/locked/);
    expect(claimError({ ...EMPTY, workshop: { damage: -1 } }, DEFAULT_DATA, MD)).toMatch(/bad workshop/);
    expect(claimError({ ...EMPTY, cards: { damage: 1, health: 1, regen: 1 } }, DEFAULT_DATA, MD)).toMatch(/slots/);
    expect(claimError({ ...EMPTY, cards: { nope: 1 } }, DEFAULT_DATA, MD)).toMatch(/unknown card/);
    expect(claimError(null, DEFAULT_DATA, MD)).toMatch(/shape/);
  });

  it('prices a loadout on the workshop curve plus lab costs', () => {
    expect(loadoutBits({ ...EMPTY, workshop: { damage: 1 } }, MD)).toBe(MD.workshop.default.base);
    expect(loadoutBits({ ...EMPTY, labs: ['speed3', 'freeReroll'] }, MD)).toBe(15000 + 3000);
    expect(allowanceBits(0)).toBe(LEADERBOARD.allowance.freeBits);
    expect(allowanceBits(1000)).toBe(LEADERBOARD.allowance.freeBits + 1000 * LEADERBOARD.allowance.earnedMul);
  });

  it('keys days and Monday-based weeks in UTC; the daily seed is a fixed hash of the day', () => {
    expect(weekKey(Date.parse('2026-10-16T13:00:00Z'))).toBe('2026-10-12');
    expect(weekKey(Date.parse('2026-10-12T00:00:00Z'))).toBe('2026-10-12');
    expect(weekKey(Date.parse('2026-10-11T23:59:59Z'))).toBe('2026-10-05');
    expect(dayIndex('2026-10-16')).toBe(20742);
    expect(dayIndex('2026-02-30')).toBeNaN();
    // Same vector in server/test (the Worker serves the seed, the verifier checks it).
    expect(dailySeed('2026-10-16')).toBe(1682601640);
    const o = dailyRunOptions('2026-10-16', DEFAULT_DATA, MD);
    expect(o.tier).toBe(LEADERBOARD.daily.tier);
    expect(o.seed).toBe(dailySeed('2026-10-16'));
    for (const l of LEADERBOARD.daily.loadouts) expect(claimError(l, DEFAULT_DATA, MD), l.id).toBeNull();
  });
});

describe('verifySubmission (tools/leaderboard/verifyEntry.ts)', () => {
  const data = hard();
  const claim: LoadoutClaim = { workshop: { damage: 3 }, labs: ['freeReroll'], cards: {} };
  const sub = play(data, runOptionsFromClaim(claim, data, MD, 1, 4242), claim);

  it('verifies an honest run and credits its Bits', () => {
    const r = verifySubmission(sub, data, MD);
    expect(r.reason).toBeUndefined();
    expect(r.status).toBe('verified');
    expect(r.wave).toBe(sub.wave);
    expect(r.loadoutBits).toBe(loadoutBits(claim, MD));
    expect(r.earnedBits).toBeGreaterThan(0);
  });

  it('accepts a gzip+base64 replay', () => {
    const gz = `gz:${gzipSync(Buffer.from(sub.replay)).toString('base64')}`;
    expect(verifySubmission({ ...sub, replay: gz }, data, MD).status).toBe('verified');
  });

  it('rejects a claimed wave, tick count or hash the replay does not reach', () => {
    expect(verifySubmission({ ...sub, wave: sub.wave + 1 }, data, MD).status).toBe('rejected');
    expect(verifySubmission({ ...sub, ticks: sub.ticks - 1 }, data, MD).status).toBe('rejected');
    expect(verifySubmission({ ...sub, hash: '00000000' }, data, MD).status).toBe('rejected');
  });

  it('rejects a replay played with a stronger loadout than claimed', () => {
    const p = JSON.parse(sub.replay) as { claim: LoadoutClaim };
    p.claim = { workshop: {}, labs: ['freeReroll'], cards: {} };
    expect(verifySubmission({ ...sub, replay: JSON.stringify({ ...JSON.parse(sub.replay), claim: p.claim }) }, data, MD).status).toBe('rejected');
  });

  it('rejects garbage and a Second Wind revive without the card', () => {
    expect(verifySubmission({ ...sub, replay: '{' }, data, MD).status).toBe('rejected');
    const p = JSON.parse(sub.replay) as { log: unknown[] };
    p.log.push({ tick: sub.ticks, cmd: { type: 'revive', hp: 1 } });
    expect(verifySubmission({ ...sub, replay: JSON.stringify(p) }, data, MD).reason).toMatch(/Second Wind/);
  });

  it('flags a loadout that costs more than the allowance', () => {
    const rich: LoadoutClaim = { workshop: {}, labs: ['speed3', 'speed4'], cards: {} };
    const s2 = play(data, runOptionsFromClaim(rich, data, MD, 1, 7), rich);
    expect(verifySubmission(s2, data, MD).status).toBe('flagged');
    expect(verifySubmission({ ...s2, verifiedBits: 1e6 }, data, MD).status).toBe('verified');
  });

  it('tier: only the server-issued seed verifies; a legacy input without one is unchanged', () => {
    expect(verifySubmission({ ...sub, seed: 4243 }, data, MD)).toMatchObject({ status: 'rejected', reason: 'seed: not the issued one' });
    expect(verifySubmission({ ...sub, seed: 4242 }, data, MD).status).toBe('verified');
    expect(verifySubmission(sub, data, MD).status).toBe('verified');
  });

  it('daily: only the day’s seed, tier and fixed loadout verify', () => {
    const day = '2026-10-16';
    const data = hard(20);
    const s3 = play(data, dailyRunOptions(day, data, MD), dailyClaim(day), 'daily', day);
    expect(verifySubmission(s3, data, MD).status).toBe('verified');
    expect(verifySubmission({ ...s3, day: '2026-10-17' }, data, MD).status).toBe('rejected');
    // A server-issued (secret HMAC) seed: the run verifies only with that seed passed in.
    const s4 = play(data, dailyRunOptions(day, data, MD, undefined, 777), dailyClaim(day), 'daily', day);
    expect(verifySubmission({ ...s4, seed: 777 }, data, MD).status).toBe('verified');
    expect(verifySubmission(s4, data, MD).status).toBe('rejected');
  });

  it('never throws on a malformed payload: missing claim, bad gzip, a gzip bomb', () => {
    const p = JSON.parse(sub.replay) as Record<string, unknown>;
    for (const replay of [
      JSON.stringify({ ...p, claim: undefined }),
      JSON.stringify({ ...p, claim: { workshop: 5 } }),
      JSON.stringify({ ...p, log: null }),
      'gz:!!not-base64!!',
      'gz:' + gzipSync(Buffer.from('not json')).toString('base64'),
      'gz:' + gzipSync(Buffer.alloc(17_000_000, 32)).toString('base64'),
    ]) {
      const r = verifySubmission({ ...sub, replay }, data, MD);
      expect(r.status).toBe('rejected');
      expect(r.reason).toBeTruthy();
    }
  });
});

describe('pace bound (server-issued starts, spec §3.2)', () => {
  it('no speed source exceeds battle.maxSpeed, and tickHz × maxSpeed fits the server pace', () => {
    const labSpeeds = labsJson.nodes.filter((n) => n.effect.type === 'speed').map((n) => Number(n.effect.value));
    expect(labSpeeds.length).toBeGreaterThan(0);
    const all = [...battleJson.speeds, ...labSpeeds, battleJson.fastBootSpeed, devJson.stress.speed];
    for (const v of all) expect(v).toBeLessThanOrEqual(battleJson.maxSpeed);
    expect(configJson.tickHz * battleJson.maxSpeed).toBeLessThanOrEqual(LEADERBOARD.pace.maxTicksPerSec);
    expect(LEADERBOARD.pace.slack).toBeGreaterThan(0);
    expect(LEADERBOARD.pace.slack).toBeLessThanOrEqual(1);
  });
});

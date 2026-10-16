import { describe, expect, it } from 'vitest';
import { gzipSync } from 'node:zlib';
import { minElapsedMs } from '../src/runs';
import { Fault, finishedWeeks, replaySeed, Transient, verifyPending, weekKey, type Deps, type EntryOutput, type PendingRun, type Verdict } from '../verifier/verify';

const NOW = Date.parse('2026-10-16T12:00:00Z');
const SHA = 'b'.repeat(40);

function pend(id: number, over: Partial<PendingRun> = {}): PendingRun {
  return { id, playerId: 'p1', kind: 'tier', tier: 1, day: null, week: '2026-10-12', wave: 10, ticks: 100, hash: '00000000', commit: SHA, createdAt: NOW - 1000, verifiedBits: 0, seed: 777, startedAt: NOW - 3_600_000, ...over };
}

/** The fake stored replay of run `id`: JSON carrying the run's issued seed unless `seed` says otherwise. */
const replayOf = (id: number, seed: unknown = 777) => JSON.stringify({ v: 1, seed, id });

function fakeDeps(runs: PendingRun[], check: (commit: string, input: any) => EntryOutput | null | Error) {
  const verdicts: Verdict[] = [];
  const inputs: any[] = [];
  const closed: string[] = [];
  const strikes = new Map<number, number>();
  const pages: number[] = [];
  const replays = new Map<number, string>();
  const deps: Deps = {
    now: () => NOW,
    pending: async (limit, after) => (pages.push(after), runs.filter((r) => r.id > after && !verdicts.some((v) => v.id === r.id)).slice(0, limit)),
    replay: async (id) => replays.get(id) ?? replayOf(id, runs.find((r) => r.id === id)?.seed),
    check: async (commit, input) => {
      inputs.push(input);
      const r = check(commit, input);
      if (r instanceof Error) throw r;
      return r;
    },
    verdict: async (v) => void verdicts.push(v),
    closeWeek: async (w) => (closed.push(w), ''),
    strike: (id) => {
      strikes.set(id, (strikes.get(id) ?? 0) + 1);
      return strikes.get(id)!;
    },
    log: () => {},
  };
  return { deps, verdicts, inputs, closed, strikes, pages, replays };
}

const ok = (earned: number): EntryOutput => ({ entry: 1, status: 'verified', earnedBits: earned, loadoutBits: 5 });
const opt = { batch: 2, maxRuns: 100, staleMs: 48 * 3_600_000, maxStrikes: 2 };

describe('verifier pass', () => {
  it('posts verdicts and carries Bits earned earlier in the pass into the next allowance', async () => {
    const f = fakeDeps([pend(1), pend(2), pend(3, { playerId: 'p2', verifiedBits: 7 })], () => ok(100));
    expect(await verifyPending(f.deps, opt)).toMatchObject({ verified: 3, skipped: 0 });
    expect(f.inputs.map((i) => i.verifiedBits)).toEqual([0, 100, 7]);
    expect(f.inputs[0]).toMatchObject({ replay: replayOf(1), kind: 'tier', ticks: 100, seed: 777 });
    expect(f.verdicts[0]).toEqual({ id: 1, status: 'verified', earnedBits: 100, loadoutBits: 5 });
    expect(f.closed).toEqual(['2026-09-14', '2026-09-21', '2026-09-28', '2026-10-05']);
  });

  it('rejects builds without an entry; daily runs earn no allowance', async () => {
    const f = fakeDeps([pend(1), pend(2, { kind: 'daily', day: '2026-10-16' })], (_c, i) => (i.kind === 'tier' ? null : ok(50)));
    await verifyPending(f.deps, opt);
    expect(f.verdicts[0]).toMatchObject({ id: 1, status: 'rejected' });
    expect(f.verdicts[1]).toMatchObject({ id: 2, status: 'verified', earnedBits: 0 });
  });

  it('leaves transient failures pending until they are stale', async () => {
    const f = fakeDeps([pend(1), pend(2, { createdAt: NOW - 49 * 3_600_000, startedAt: NOW - 50 * 3_600_000 })], () => new Transient('commit not in the repo'));
    expect(await verifyPending(f.deps, opt)).toMatchObject({ skipped: 1, rejected: 1 });
    expect(f.verdicts).toEqual([{ id: 2, status: 'rejected', reason: 'unverifiable: commit not in the repo' }]);
  });

  it('pages past skipped runs with a cursor, so stuck runs never starve the queue', async () => {
    const runs = [1, 2, 3, 4, 5].map((id) => pend(id));
    const f = fakeDeps(runs, (_c, i) => (i.replay === replayOf(1) || i.replay === replayOf(2) ? new Transient('not fetched') : ok(1)));
    expect(await verifyPending(f.deps, opt)).toMatchObject({ verified: 3, skipped: 2 });
    expect(f.pages).toEqual([0, 2, 4, 5]);
    expect(f.verdicts.map((v) => v.id)).toEqual([3, 4, 5]);
  });

  it('an entry crash or timeout is a strike; the run is rejected at maxStrikes', async () => {
    const f = fakeDeps([pend(1)], () => new Fault('entry timed out'));
    expect(await verifyPending(f.deps, opt)).toMatchObject({ skipped: 1, rejected: 0 });
    expect(await verifyPending(f.deps, opt)).toMatchObject({ skipped: 0, rejected: 1 });
    expect(f.verdicts).toEqual([{ id: 1, status: 'rejected', reason: 'unverifiable: entry timed out' }]);
  });

  it('a verdict that fails to post leaves the run pending, credits nothing and goes on', async () => {
    const f = fakeDeps([pend(1), pend(2)], () => ok(100));
    const post = f.deps.verdict;
    f.deps.verdict = async (v) => {
      if (v.id === 1) throw new Error('HTTP 500');
      return post(v);
    };
    expect(await verifyPending(f.deps, opt)).toMatchObject({ verified: 1, errors: 1 });
    expect(f.inputs.map((i) => i.verifiedBits)).toEqual([0, 0]);
    expect(f.verdicts.map((v) => v.id)).toEqual([2]);
  });

  it('passes the server-issued daily seed to the entry', async () => {
    const f = fakeDeps([pend(1, { kind: 'daily', day: '2026-10-16', seed: 4242 })], () => ok(1));
    await verifyPending(f.deps, opt);
    expect(f.inputs[0]).toMatchObject({ kind: 'daily', day: '2026-10-16', seed: 4242 });
  });
});

describe('week keys', () => {
  it('Monday UTC', () => {
    expect(weekKey(NOW)).toBe('2026-10-12');
    expect(weekKey(Date.parse('2026-10-12T00:00:00Z'))).toBe('2026-10-12');
    expect(weekKey(Date.parse('2026-10-11T23:59:59Z'))).toBe('2026-10-05');
    expect(finishedWeeks(NOW, 1)).toEqual(['2026-10-05']);
  });
});

describe('server start checks (made before the entry runs)', () => {
  it('rejects legacy rows without a server start', async () => {
    const f = fakeDeps([pend(1, { seed: undefined, startedAt: null }), pend(2, { startedAt: undefined })], () => ok(1));
    expect(await verifyPending(f.deps, opt)).toMatchObject({ rejected: 2, verified: 0 });
    expect(f.verdicts.map((v) => v.reason)).toEqual(['no server start', 'no server start']);
    expect(f.inputs).toEqual([]);
  });

  it('rejects a replay whose seed is not the issued one (plain, gzip or unreadable)', async () => {
    const f = fakeDeps([pend(1), pend(2), pend(3), pend(4)], () => ok(1));
    f.replays.set(1, replayOf(1, 778));
    f.replays.set(2, 'gz:' + gzipSync(Buffer.from(replayOf(2, 779))).toString('base64'));
    f.replays.set(3, '{not json');
    f.replays.set(4, 'gz:' + gzipSync(Buffer.from(replayOf(4))).toString('base64'));
    expect(await verifyPending(f.deps, opt)).toMatchObject({ rejected: 3, verified: 1 });
    expect(f.verdicts.slice(0, 3).map((v) => [v.id, v.status, v.reason])).toEqual([
      [1, 'rejected', 'seed: not the issued one'],
      [2, 'rejected', 'seed: not the issued one'],
      [3, 'rejected', 'seed: not the issued one'],
    ]);
    expect(f.inputs).toHaveLength(1);
    expect(replaySeed('gz:' + gzipSync(Buffer.from('{"seed":5}')).toString('base64'))).toBe(5);
    expect(replaySeed('{"seed":"5"}')).toBeNull();
  });

  it('rejects a run submitted sooner than its ticks allow at top speed', async () => {
    const ticks = 150_000;
    const need = minElapsedMs(ticks);
    const f = fakeDeps([pend(1, { ticks, startedAt: NOW - 1000 - need + 1 }), pend(2, { ticks, startedAt: NOW - 1000 - need })], () => ok(1));
    await verifyPending(f.deps, opt);
    expect(f.verdicts.map((v) => [v.id, v.status, v.reason])).toEqual([
      [1, 'rejected', 'too fast'],
      [2, 'verified', undefined],
    ]);
  });

  it('passes the issued seed to the entry for tier runs too', async () => {
    const f = fakeDeps([pend(1, { seed: 123456 })], () => ok(1));
    await verifyPending(f.deps, opt);
    expect(f.inputs[0]).toMatchObject({ kind: 'tier', seed: 123456 });
    expect(f.verdicts[0]).toMatchObject({ status: 'verified' });
  });
});

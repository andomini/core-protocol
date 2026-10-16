import { describe, expect, it } from 'vitest';
import { finishedWeeks, Transient, verifyPending, weekKey, type Deps, type EntryOutput, type PendingRun, type Verdict } from '../verifier/verify';

const NOW = Date.parse('2026-10-16T12:00:00Z');
const SHA = 'b'.repeat(40);

function pend(id: number, over: Partial<PendingRun> = {}): PendingRun {
  return { id, playerId: 'p1', kind: 'tier', tier: 1, day: null, week: '2026-10-12', wave: 10, ticks: 100, hash: '00000000', commit: SHA, createdAt: NOW - 1000, verifiedBits: 0, ...over };
}

function fakeDeps(runs: PendingRun[], check: (commit: string, input: any) => EntryOutput | null | Error) {
  const verdicts: Verdict[] = [];
  const inputs: any[] = [];
  const closed: string[] = [];
  const deps: Deps = {
    now: () => NOW,
    pending: async (limit) => runs.filter((r) => !verdicts.some((v) => v.id === r.id)).slice(0, limit),
    replay: async (id) => `replay-${id}`,
    check: async (commit, input) => {
      inputs.push(input);
      const r = check(commit, input);
      if (r instanceof Error) throw r;
      return r;
    },
    verdict: async (v) => void verdicts.push(v),
    closeWeek: async (w) => (closed.push(w), ''),
    log: () => {},
  };
  return { deps, verdicts, inputs, closed };
}

const ok = (earned: number): EntryOutput => ({ entry: 1, status: 'verified', earnedBits: earned, loadoutBits: 5 });
const opt = { batch: 2, maxRuns: 100, staleMs: 48 * 3_600_000 };

describe('verifier pass', () => {
  it('posts verdicts and carries Bits earned earlier in the pass into the next allowance', async () => {
    const f = fakeDeps([pend(1), pend(2), pend(3, { playerId: 'p2', verifiedBits: 7 })], () => ok(100));
    expect(await verifyPending(f.deps, opt)).toMatchObject({ verified: 3, skipped: 0 });
    expect(f.inputs.map((i) => i.verifiedBits)).toEqual([0, 100, 7]);
    expect(f.inputs[0]).toMatchObject({ replay: 'replay-1', kind: 'tier', ticks: 100 });
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
    const f = fakeDeps([pend(1), pend(2, { createdAt: NOW - 49 * 3_600_000 })], () => new Transient('commit not in the repo'));
    expect(await verifyPending(f.deps, opt)).toMatchObject({ skipped: 1, rejected: 1 });
    expect(f.verdicts).toEqual([{ id: 2, status: 'rejected', reason: 'unverifiable: commit not in the repo' }]);
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

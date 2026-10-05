import { describe, expect, it } from 'vitest';
import type { TelemetryEvent } from '../src/telemetry/Telemetry';
import { median, summarize } from '../tools/telemetry-report/summary';

let t = 0;
const ev = (type: TelemetryEvent['type'], runId: string, p: Record<string, unknown> = {}): TelemetryEvent => ({
  t: (t += 1000),
  type,
  runId,
  sessionId: 's1',
  deviceId: 'd1',
  build: 'local-test',
  ...p,
});

describe('telemetry report', () => {
  it('median', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBeNaN();
  });

  it('summarises deaths by run #, purchases, ads and sessions', () => {
    const events = [
      ev('session_start', ''),
      ev('run_start', 'a', { seed: 1, tier: 1, runIndex: 1 }),
      ev('purchase', 'a', { stat: 'damage', levels: 1, wave: 1 }),
      ev('purchase', 'a', { stat: 'damage', levels: 3, wave: 2 }),
      ev('death', 'a', { wave: 7, time: 180, energy: 3 }),
      ev('ad_request', 'a', { kind: 'midgame', placement: 'restart' }),
      ev('ad_result', 'a', { kind: 'midgame', placement: 'restart', result: 'completed' }),
      ev('run_start', 'b', { seed: 2, tier: 1, runIndex: 2 }),
      ev('ad_request', 'b', { kind: 'rewarded', placement: 'revive' }),
      ev('ad_result', 'b', { kind: 'rewarded', placement: 'revive', result: 'failed' }),
      ev('death', 'b', { wave: 9, time: 240, energy: 0 }),
      ev('session_end', 'b', { activeS: 420 }),
    ];
    const md = summarize(events, 'T');
    expect(md).toContain('runs: 2');
    expect(md).toContain('| 1 | 1 | 7 | 7–7 | 3.0 |');
    expect(md).toContain('| 2 | 1 | 9 | 9–9 | 4.0 |');
    expect(md).toContain('| 1–5 | 1 | 1.0 |');
    expect(md).toContain('| damage | 4 |');
    expect(md).toContain('| midgame | restart | 1 | 1 | 0 | 0 | 100% |');
    expect(md).toContain('| rewarded | revive | 1 | 0 | 1 | 0 | 0% |');
    expect(md).toContain('median active 420 s');
  });
});

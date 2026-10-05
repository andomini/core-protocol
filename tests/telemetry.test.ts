import { describe, expect, it } from 'vitest';
import { memoryKV } from '../src/portal/storage';
import { DEVICE_KEY, Telemetry, TELEMETRY_KEY } from '../src/telemetry/Telemetry';

describe('Telemetry', () => {
  it('stamps events with run, session, device and build; flushes on run_start/death', () => {
    const kv = memoryKV();
    const tm = new Telemetry('test', kv, () => 42);
    const { runIndex } = tm.newRun();
    expect(runIndex).toBe(1);
    tm.emit('run_start', { seed: 7, tier: 1 });
    const e = tm.all()[0]!;
    expect(e).toMatchObject({ t: 42, type: 'run_start', seed: 7, runId: tm.runId, sessionId: tm.sessionId, deviceId: tm.deviceId, build: 'test' });
    expect(JSON.parse(kv.getItem(TELEMETRY_KEY)!)).toHaveLength(1);
  });

  it('a payload cannot overwrite the envelope fields', () => {
    const tm = new Telemetry('b', memoryKV(), () => 5);
    tm.emit('purchase', { type: 'evil', t: -1, runId: 'x' });
    expect(tm.all()[0]).toMatchObject({ type: 'purchase', t: 5, runId: '' });
  });

  it('keeps the device id and lifetime run counter across sessions', () => {
    const kv = memoryKV();
    const a = new Telemetry('b', kv);
    a.newRun();
    a.newRun();
    const b = new Telemetry('b', kv);
    expect(b.deviceId).toBe(a.deviceId);
    expect(b.sessionId).not.toBe(a.sessionId);
    expect(b.newRun().runIndex).toBe(3);
    expect(JSON.parse(kv.getItem(DEVICE_KEY)!)).toEqual({ id: a.deviceId, runs: 3 });
  });

  it('reloads earlier events and survives corrupt stored data', () => {
    const kv = memoryKV();
    const a = new Telemetry('b', kv);
    a.emit('death', { wave: 9 });
    expect(new Telemetry('b', kv).all().map((e) => e.type)).toEqual(['death']);
    kv.setItem(TELEMETRY_KEY, '{oops');
    kv.setItem(DEVICE_KEY, '[]');
    const c = new Telemetry('b', kv);
    expect(c.all()).toEqual([]);
    expect(c.deviceId).toMatch(/^[a-z0-9]+$/);
  });

  it('stays under 200 KB in storage by dropping the oldest events', () => {
    const kv = memoryKV();
    const tm = new Telemetry('b', kv);
    for (let i = 0; i < 3000; i++) tm.emit('wave_reached', { wave: i, pad: 'x'.repeat(80) });
    tm.flush();
    const stored = kv.getItem(TELEMETRY_KEY)!;
    expect(stored.length).toBeLessThanOrEqual(200 * 1024);
    const waves = (JSON.parse(stored) as { wave: number }[]).map((e) => e.wave);
    expect(waves[waves.length - 1]).toBe(2999);
    expect(waves[0]).toBeGreaterThan(0);
  });

  it('never throws: broken storage, unserialisable payloads, throwing listeners', () => {
    const boom = () => {
      throw new Error('blocked');
    };
    const tm = new Telemetry('b', { getItem: boom, setItem: boom, removeItem: boom });
    const circ: Record<string, unknown> = {};
    circ.self = circ;
    tm.listeners.push(boom);
    expect(() => {
      tm.emit('death', { circ });
      tm.flush();
      tm.newRun();
    }).not.toThrow();
  });

  it('exports JSON and clears', () => {
    const tm = new Telemetry('b', memoryKV());
    tm.emit('ad_request', { placement: 'revive' });
    expect(JSON.parse(tm.exportJson())[0].placement).toBe('revive');
    tm.clear();
    expect(tm.all()).toHaveLength(0);
  });
});

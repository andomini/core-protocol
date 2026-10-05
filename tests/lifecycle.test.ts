import { describe, expect, it } from 'vitest';
import { RunLifecycle } from '../src/portal/lifecycle';

function setup(midgame: () => Promise<boolean> = async () => false) {
  const calls: string[] = [];
  const events: { type: string; [k: string]: unknown }[] = [];
  let runs = 0;
  const life = new RunLifecycle({
    guard: { gameplayStart: () => calls.push('start'), gameplayStop: () => calls.push('stop') },
    ads: { midgame: (t) => (calls.push(`midgame:${t}`), midgame()) },
    telemetry: { deviceId: 'dev1', newRun: () => ({ runId: 'r', runIndex: ++runs }), emit: (type, p = {}) => void events.push({ type, ...p }) },
    tickHz: 30,
    now: () => 0,
  });
  return { life, calls, events };
}

const w = { seed: 7, tier: 1, wave: 3, tick: 300, energy: 12.7, bits: 4.2, kills: 20 };

describe('RunLifecycle', () => {
  it('run start → gameplayStart + run_start with seed, tier, deviceId, runIndex', () => {
    const s = setup();
    s.life.runStarted(w);
    expect(s.calls).toEqual(['start']);
    expect(s.events).toEqual([{ type: 'run_start', seed: 7, tier: 1, deviceId: 'dev1', runIndex: 1 }]);
  });

  it('any hold stops gameplay; it resumes only when every hold is released', () => {
    const s = setup();
    s.life.runStarted(w);
    s.life.hold('paused', true);
    s.life.hold('perkPick', true);
    s.life.hold('paused', false);
    expect(s.calls.at(-1)).toBe('stop');
    s.life.hold('perkPick', false);
    expect(s.calls.at(-1)).toBe('start');
  });

  it('wave, purchase and death events reach telemetry; death stops gameplay', () => {
    const s = setup();
    s.life.runStarted(w);
    s.life.onEvent({ type: 'waveStart', wave: 3, boss: false }, w);
    s.life.onEvent({ type: 'buy', stat: 'damage', levels: 2, level: 5, cost: 30, free: false }, w);
    s.life.onEvent({ type: 'kill', enemyId: 1, kind: 'basic', energy: 1, bits: 0, keys: 0 }, w);
    s.life.onEvent({ type: 'death', wave: 3, tick: 450, bonusBits: 0 }, w);
    expect(s.events.slice(1)).toEqual([
      { type: 'wave_reached', wave: 3, boss: false, simS: 10 },
      { type: 'purchase', stat: 'damage', levels: 2, level: 5, cost: 30, free: false, wave: 3, energyAfter: 12 },
      { type: 'death', wave: 3, time: 15, wallS: 0, energy: 12, bits: 4, kills: 20 },
    ]);
    expect(s.calls).toEqual(['start', 'stop']);
  });

  it('restart waits for the midgame offer, ignores repeat taps, then starts a fresh run', async () => {
    let finish!: (v: boolean) => void;
    const s = setup(() => new Promise((r) => (finish = r)));
    s.life.runStarted(w);
    s.life.onEvent({ type: 'death', wave: 3, tick: 450, bonusBits: 0 }, w);
    let restarts = 0;
    const restart = () => {
      restarts++;
      s.life.runStarted(w);
    };
    const a = s.life.requestRestart(restart);
    void s.life.requestRestart(restart);
    expect(s.life.isRestarting).toBe(true);
    expect(restarts).toBe(0);
    finish(true);
    await a;
    expect(restarts).toBe(1);
    expect(s.calls).toEqual(['start', 'stop', 'midgame:restart', 'start']);
  });

  it('a throwing ad service never blocks the restart', async () => {
    const s = setup(() => Promise.reject(new Error('x')));
    let restarted = false;
    await s.life.requestRestart(() => (restarted = true));
    expect(restarted).toBe(true);
  });
});

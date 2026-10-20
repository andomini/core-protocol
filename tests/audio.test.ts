import { describe, expect, it } from 'vitest';
import { BOSS, MAX_SAME, MAX_VOICES, MUSIC_BANDS, musicPlan, pulseSfx, RESERVED, STINGS, type Sfx, voiceLength, VoiceLimiter, VOICES } from '../src/render/audio';
import { TAGS } from '../src/sim/perkData';

const NAMES = Object.keys(VOICES) as Sfx[];

describe('voice table', () => {
  it('keeps the original SFX names and adds the verb voices', () => {
    for (const n of ['shot', 'hit', 'crit', 'kill', 'coin', 'upgrade', 'wallHit', 'perk', 'rare', 'epic', 'boss', 'bossDie', 'death', 'click', 'heartbeat', 'wave', 'zap', 'freeze', 'set', 'pack'] as const) expect(VOICES[n]).toBeDefined();
    for (const n of ['boot', 'fusion', 'mutation', 'mission', 'pulse', 'pulseOverload', 'pulseCryo', 'pulseChain', 'pulseMining', 'pulseFirewall'] as const) expect(VOICES[n].prio).toBe(2);
  });

  it('every layer is sane: audible range, short, quiet, positive envelope times', () => {
    for (const n of NAMES) {
      const v = VOICES[n];
      expect(v.layers.length, n).toBeGreaterThan(0);
      expect(v.layers.length, n).toBeLessThanOrEqual(6);
      let sum = 0;
      for (const l of v.layers) {
        expect(l.dur, n).toBeGreaterThan(0);
        expect(l.vol, n).toBeGreaterThan(0);
        expect(l.vol, n).toBeLessThanOrEqual(0.25);
        expect(l.delay ?? 0, n).toBeGreaterThanOrEqual(0);
        expect(l.attack ?? 0.003, n).toBeLessThan(l.dur);
        if (l.wave !== 'noise') {
          expect(Math.min(l.f0, l.f1), n).toBeGreaterThanOrEqual(20);
          expect(Math.max(l.f0, l.f1), n).toBeLessThanOrEqual(12000);
        }
        if (l.filter) expect(Math.min(l.filter.f0, l.filter.f1), n).toBeGreaterThan(0);
        sum += l.vol;
      }
      // Layers that sound together stay well under full scale (the compressor only catches stacking).
      expect(sum, n).toBeLessThan(0.5);
      expect(voiceLength(n), n).toBeLessThanOrEqual(1.3);
    }
  });

  it('spam voices (per shot / hit / kill) are tiny and rate-limited', () => {
    for (const n of NAMES.filter((x) => VOICES[x].prio === 0)) {
      expect(voiceLength(n), n).toBeLessThanOrEqual(0.16);
      expect(VOICES[n].gap, n).toBeGreaterThanOrEqual(25);
    }
  });

  it('families: viruses are gritty (saw / square / noise), UI is soft (sine first)', () => {
    for (const n of NAMES.filter((x) => VOICES[x].family === 'virus')) expect(VOICES[n].layers.some((l) => l.wave === 'sawtooth' || l.wave === 'square' || l.wave === 'noise' || n === 'heartbeat'), n).toBe(true);
    for (const n of NAMES.filter((x) => VOICES[x].family === 'ui')) expect(VOICES[n].layers[0]!.wave, n).toBe('sine');
  });

  it('a distinct Pulse voice per tag, the plain one without', () => {
    const set = new Set(TAGS.map((t) => pulseSfx(t)));
    expect(set.size).toBe(TAGS.length);
    expect(pulseSfx(null)).toBe('pulse');
    for (const t of TAGS) expect(VOICES[pulseSfx(t)]).toBeDefined();
  });
});

describe('VoiceLimiter', () => {
  it('caps the same voice and its retrigger gap', () => {
    const v = new VoiceLimiter();
    expect(v.tryAcquire('shot', 0, 1000, 1, 30)).toBe(true);
    expect(v.tryAcquire('shot', 10, 1000, 1, 30)).toBe(false); // gap
    let ok = 1;
    for (let t = 40; t < 400; t += 40) if (v.tryAcquire('shot', t, 1000, 1, 30)) ok++;
    expect(ok).toBe(MAX_SAME);
    // Once they ended, it plays again.
    expect(v.tryAcquire('shot', 2000, 1000, 1, 30)).toBe(true);
  });

  it('a flood of spam (200 enemies at ×5) never exceeds the cap and leaves room for events', () => {
    const v = new VoiceLimiter();
    let started = 0;
    // 2 s of 600 spam triggers per second across the spam voices.
    const spam = NAMES.filter((x) => VOICES[x].prio === 0);
    for (let i = 0; i < 1200; i++) {
      const t = i * (2000 / 1200);
      const n = spam[i % spam.length]!;
      if (v.tryAcquire(n, t, voiceLength(n) * 1000, 0, VOICES[n].gap)) started++;
      expect(v.active(t)).toBeLessThanOrEqual(MAX_VOICES - RESERVED);
    }
    expect(started).toBeGreaterThan(50);
    expect(started).toBeLessThan(400);
    // A normal and a verb voice still get through at the peak.
    expect(v.tryAcquire('upgrade', 1999, 160, 1, 45)).toBe(true);
    expect(v.tryAcquire('pulseCryo', 1999, 550, 2, 200)).toBe(true);
  });

  it('verb voices ignore the global cap', () => {
    const v = new VoiceLimiter(2, 4);
    expect(v.tryAcquire('a', 0, 1000, 1, 0)).toBe(true);
    expect(v.tryAcquire('b', 0, 1000, 1, 0)).toBe(true);
    expect(v.tryAcquire('c', 0, 1000, 1, 0)).toBe(false);
    expect(v.tryAcquire('mutation', 0, 1000, 2, 0)).toBe(true);
  });
});

describe('music plan', () => {
  it('layer 2 is silent before wave 10, fades in from wave 10 and grows by band', () => {
    expect(musicPlan(0, false).layer2).toBe(0);
    expect(musicPlan(9, false).layer2).toBe(0);
    expect(musicPlan(10, false).layer2).toBeGreaterThan(0);
    let prev = musicPlan(0, false);
    for (const b of MUSIC_BANDS) {
      const p = musicPlan(b.wave, false);
      expect(p.layer2).toBeGreaterThanOrEqual(prev.layer2);
      expect(p.cutoff).toBeGreaterThanOrEqual(prev.cutoff);
      expect(p.stepS).toBeLessThanOrEqual(prev.stepS);
      prev = p;
    }
    expect(musicPlan(500, false)).toEqual(musicPlan(MUSIC_BANDS[MUSIC_BANDS.length - 1]!.wave, false));
  });

  it('boss waves bring layer 2 in early and push filter and tempo', () => {
    const b = musicPlan(5, true);
    const n = musicPlan(5, false);
    expect(b.layer2).toBe(BOSS.layer2);
    expect(b.cutoff).toBeGreaterThan(n.cutoff);
    expect(b.stepS).toBeLessThan(n.stepS);
    expect(musicPlan(200, true).cutoff).toBeLessThanOrEqual(8000);
  });

  it('stingers are short', () => {
    for (const s of Object.values(STINGS)) for (const [f, at, dur] of s) {
      expect(f).toBeGreaterThan(20);
      expect(at + dur).toBeLessThanOrEqual(2.5);
    }
  });
});

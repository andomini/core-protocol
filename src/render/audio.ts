// Procedural Web Audio (ported from Last Tower): neon SFX and one synthwave loop, no audio files (0 KB).
// Render layer only. Respects the settings (sound / music), the portal mute and ad playback.

export type Sfx = 'shot' | 'hit' | 'crit' | 'kill' | 'coin' | 'upgrade' | 'wallHit' | 'perk' | 'rare' | 'epic' | 'boss' | 'bossDie' | 'death' | 'click' | 'heartbeat' | 'wave' | 'zap' | 'freeze' | 'set' | 'pack';

const MAX_SAME = 4;
const PITCH_VARIANCE = 0.05;

interface Voice {
  type: OscillatorType;
  f0: number;
  f1: number;
  dur: number;
  vol: number;
  noise?: boolean;
}

const VOICES: Record<Sfx, Voice[]> = {
  shot: [{ type: 'square', f0: 880, f1: 440, dur: 0.05, vol: 0.05 }],
  hit: [{ type: 'triangle', f0: 300, f1: 160, dur: 0.06, vol: 0.08 }],
  crit: [{ type: 'square', f0: 1200, f1: 600, dur: 0.09, vol: 0.08 }],
  kill: [{ type: 'triangle', f0: 220, f1: 70, dur: 0.14, vol: 0.12 }, { type: 'sine', f0: 0, f1: 0, dur: 0.08, vol: 0.06, noise: true }],
  coin: [{ type: 'sine', f0: 1320, f1: 1760, dur: 0.08, vol: 0.06 }],
  upgrade: [{ type: 'square', f0: 520, f1: 1040, dur: 0.16, vol: 0.08 }],
  wallHit: [{ type: 'sine', f0: 0, f1: 0, dur: 0.12, vol: 0.12, noise: true }, { type: 'sine', f0: 90, f1: 50, dur: 0.15, vol: 0.12 }],
  perk: [{ type: 'triangle', f0: 660, f1: 990, dur: 0.18, vol: 0.09 }],
  rare: [{ type: 'triangle', f0: 660, f1: 1320, dur: 0.3, vol: 0.1 }],
  epic: [{ type: 'square', f0: 440, f1: 1760, dur: 0.5, vol: 0.09 }, { type: 'triangle', f0: 880, f1: 1760, dur: 0.5, vol: 0.08 }],
  boss: [{ type: 'sawtooth', f0: 110, f1: 55, dur: 0.8, vol: 0.12 }],
  bossDie: [{ type: 'sawtooth', f0: 220, f1: 40, dur: 0.9, vol: 0.14 }, { type: 'sine', f0: 0, f1: 0, dur: 0.6, vol: 0.12, noise: true }],
  death: [{ type: 'sawtooth', f0: 330, f1: 55, dur: 1.0, vol: 0.12 }],
  click: [{ type: 'square', f0: 900, f1: 900, dur: 0.03, vol: 0.05 }],
  heartbeat: [{ type: 'sine', f0: 70, f1: 45, dur: 0.18, vol: 0.2 }],
  wave: [{ type: 'triangle', f0: 392, f1: 784, dur: 0.25, vol: 0.08 }],
  zap: [{ type: 'sawtooth', f0: 1800, f1: 300, dur: 0.08, vol: 0.05 }, { type: 'sine', f0: 0, f1: 0, dur: 0.05, vol: 0.04, noise: true }],
  freeze: [{ type: 'sine', f0: 2400, f1: 1200, dur: 0.35, vol: 0.06 }, { type: 'triangle', f0: 1600, f1: 3200, dur: 0.25, vol: 0.04 }],
  set: [{ type: 'square', f0: 330, f1: 660, dur: 0.22, vol: 0.07 }, { type: 'triangle', f0: 660, f1: 1320, dur: 0.4, vol: 0.08 }],
  pack: [{ type: 'triangle', f0: 523, f1: 1046, dur: 0.3, vol: 0.09 }, { type: 'sine', f0: 784, f1: 1568, dur: 0.45, vol: 0.06 }],
};

/** 8-step synthwave loop: octave bass + minor arpeggio (A minor → F → C → G). */
const BASS = [55, 110, 55, 110, 43.65, 87.3, 49, 98];
const LEAD = [440, 523, 659, 523, 349, 440, 392, 494];
const STEP_S = 0.26;

export class AudioBus {
  private ctx: AudioContext | null = null;
  private sfxGain: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private musicFilter: BiquadFilterNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private playing = new Map<Sfx, number>();
  private musicTimer: number | null = null;
  private nextStep = 0;
  private step = 0;
  sfxOn = true;
  musicOn = true;
  portalMuted = false;
  adPlaying = false;
  tense = false;

  /** Must be called from a user gesture (iOS Safari resumes audio only then). */
  unlock(): void {
    try {
      if (!this.ctx) {
        const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        this.ctx = new Ctor();
        this.sfxGain = this.ctx.createGain();
        this.musicFilter = this.ctx.createBiquadFilter();
        this.musicFilter.type = 'lowpass';
        this.musicFilter.frequency.value = 8000;
        this.musicGain = this.ctx.createGain();
        this.musicGain.gain.value = 0.05;
        this.musicGain.connect(this.musicFilter).connect(this.ctx.destination);
        this.sfxGain.connect(this.ctx.destination);
        this.noiseBuf = this.ctx.createBuffer(1, this.ctx.sampleRate * 0.5, this.ctx.sampleRate);
        const d = this.noiseBuf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      this.apply();
    } catch {
      this.ctx = null;
    }
  }

  private get muted(): boolean {
    return this.portalMuted || this.adPlaying;
  }

  /** Re-applies mute state and the low-HP "muffled music" filter. */
  apply(): void {
    if (!this.ctx || !this.sfxGain || !this.musicGain || !this.musicFilter) return;
    const t = this.ctx.currentTime;
    this.sfxGain.gain.setTargetAtTime(this.muted || !this.sfxOn ? 0 : 1, t, 0.02);
    this.musicGain.gain.setTargetAtTime(this.muted || !this.musicOn ? 0 : 0.05, t, 0.1);
    this.musicFilter.frequency.setTargetAtTime(this.tense ? 700 : 8000, t, 0.3);
    if (this.musicOn && !this.musicTimer) this.startMusic();
  }

  play(name: Sfx, pitch = 1): void {
    if (!this.ctx || !this.sfxGain || this.muted || !this.sfxOn) return;
    const count = this.playing.get(name) ?? 0;
    if (count >= MAX_SAME) return;
    this.playing.set(name, count + 1);
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const p = pitch * (1 + (Math.random() * 2 - 1) * PITCH_VARIANCE);
    let longest = 0;
    for (const v of VOICES[name]) {
      const g = ctx.createGain();
      g.gain.setValueAtTime(v.vol, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + v.dur);
      g.connect(this.sfxGain);
      if (v.noise && this.noiseBuf) {
        const src = ctx.createBufferSource();
        src.buffer = this.noiseBuf;
        src.connect(g);
        src.start(t);
        src.stop(t + v.dur);
      } else {
        const o = ctx.createOscillator();
        o.type = v.type;
        o.frequency.setValueAtTime(v.f0 * p, t);
        o.frequency.exponentialRampToValueAtTime(Math.max(20, v.f1 * p), t + v.dur);
        o.connect(g);
        o.start(t);
        o.stop(t + v.dur);
      }
      longest = Math.max(longest, v.dur);
    }
    setTimeout(() => this.playing.set(name, Math.max(0, (this.playing.get(name) ?? 1) - 1)), longest * 1000);
  }

  private startMusic(): void {
    if (!this.ctx) return;
    this.nextStep = this.ctx.currentTime + 0.1;
    this.musicTimer = window.setInterval(() => this.scheduleMusic(), 100);
  }

  private scheduleMusic(): void {
    const ctx = this.ctx;
    if (!ctx || !this.musicGain) return;
    while (this.nextStep < ctx.currentTime + 0.3) {
      const i = this.step % BASS.length;
      this.note(BASS[i]!, 'triangle', STEP_S * 0.9, 1);
      if (this.step % 2 === 0) this.note(LEAD[(this.step / 2) % LEAD.length]!, 'square', STEP_S * 0.5, 0.35);
      this.nextStep += STEP_S;
      this.step++;
    }
  }

  private note(freq: number, type: OscillatorType, dur: number, vol: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(vol, this.nextStep);
    g.gain.exponentialRampToValueAtTime(0.001, this.nextStep + dur);
    o.connect(g).connect(this.musicGain!);
    o.start(this.nextStep);
    o.stop(this.nextStep + dur);
  }
}

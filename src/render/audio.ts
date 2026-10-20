// Procedural Web Audio: a designed neon SFX palette and a two-layer music loop, no audio files (0 KB).
// Render layer only. Respects the settings (sound / music), the portal mute and ad playback.
//
// Palette (uniqueness plan item 14, notes in docs/superpowers/plans/2026-10-20-uniqueness-notes-b3.md):
//   player actions — clean and bright (triangle/sine, short, octave overtones, gentle highs);
//   viruses        — gritty and organic (sawtooth/square through sweeping low-pass/band-pass, noise squelch);
//   UI             — soft clicks (a short sine tick with a breath of high noise).
// Every voice is a few layers: an oscillator or the shared noise buffer, an optional filter envelope, an attack/decay
// gain envelope and an optional delay (arpeggios). A VoiceLimiter caps concurrent and repeated voices so 200
// enemies at ×5 neither clip nor flood the audio thread; a compressor on the master catches the rest.

import type { Tag } from '../sim/perkData';
import { WIDGET } from './widget';

export type Sfx =
  | 'shot' | 'hit' | 'crit' | 'kill' | 'coin' | 'upgrade' | 'wallHit' | 'perk' | 'rare' | 'epic' | 'boss' | 'bossDie'
  | 'death' | 'click' | 'heartbeat' | 'wave' | 'zap' | 'freeze' | 'set' | 'pack'
  // verbs (uniqueness plan item 14)
  | 'boot' | 'fusion' | 'mutation' | 'mission'
  // tier bosses (c1): a telegraph beep before a shield or a shot
  | 'bossWarn'
  | 'pulse' | 'pulseOverload' | 'pulseCryo' | 'pulseChain' | 'pulseMining' | 'pulseFirewall'
  // c2: the Territory Beacon (placed; held to its goal)
  | 'beacon' | 'beaconHold';

export type Family = 'player' | 'virus' | 'ui';

export interface Layer {
  /** Oscillator shape, or 'noise' for the shared white-noise buffer. */
  wave: OscillatorType | 'noise';
  /** Start and end frequency (Hz, exponential glide); ignored for noise. */
  f0: number;
  f1: number;
  /** Decay end (s after the layer's start). */
  dur: number;
  vol: number;
  /** Start offset (s), for arpeggios and tails. */
  delay?: number;
  /** Attack (s); default 3 ms (no click). */
  attack?: number;
  /** Filter envelope: type, start/end cutoff (Hz), Q. */
  filter?: { type: BiquadFilterType; f0: number; f1: number; q?: number };
}

export interface VoiceDef {
  family: Family;
  /** 0: spam (per-shot/per-hit; dropped first), 1: normal, 2: verb/event (always gets a slot). */
  prio: 0 | 1 | 2;
  /** Minimum gap between two starts of this voice (ms). */
  gap: number;
  layers: Layer[];
}

const LP = (f0: number, f1: number, q = 0.7) => ({ type: 'lowpass' as const, f0, f1, q });
const BP = (f0: number, f1: number, q = 2) => ({ type: 'bandpass' as const, f0, f1, q });
const HP = (f0: number, f1: number, q = 0.7) => ({ type: 'highpass' as const, f0, f1, q });

/** Notes (Hz) used by the arpeggios and chimes. */
const N = { A3: 220, C4: 261.6, E4: 329.6, G4: 392, A4: 440, B4: 493.9, C5: 523.3, D5: 587.3, E5: 659.3, G5: 784, A5: 880, B5: 987.8, C6: 1046.5, D6: 1174.7, E6: 1318.5, G6: 1568, B6: 1975.5, C7: 2093, D7: 2349.3, E7: 2637, G7: 3136 };

export const VOICES: Readonly<Record<Sfx, VoiceDef>> = {
  // --- player: clean / bright ---
  shot: { family: 'player', prio: 0, gap: 28, layers: [
    { wave: 'triangle', f0: 1500, f1: 720, dur: 0.045, vol: 0.035 },
    { wave: 'sine', f0: 3000, f1: 1500, dur: 0.03, vol: 0.012 },
  ] },
  crit: { family: 'player', prio: 0, gap: 40, layers: [
    { wave: 'square', f0: 1700, f1: 820, dur: 0.07, vol: 0.04, filter: LP(6000, 1800) },
    { wave: 'sine', f0: 3400, f1: 2600, dur: 0.06, vol: 0.02 },
    { wave: 'noise', f0: 0, f1: 0, dur: 0.025, vol: 0.02, filter: HP(5000, 5000) },
  ] },
  upgrade: { family: 'player', prio: 1, gap: 45, layers: [
    { wave: 'triangle', f0: N.E5, f1: N.E6, dur: 0.12, vol: 0.06 },
    { wave: 'sine', f0: N.B5, f1: N.B6, dur: 0.12, vol: 0.03, delay: 0.035 },
  ] },
  perk: { family: 'player', prio: 2, gap: 80, layers: [
    { wave: 'triangle', f0: N.G5, f1: N.G5, dur: 0.14, vol: 0.07 },
    { wave: 'triangle', f0: N.D6, f1: N.D6, dur: 0.22, vol: 0.07, delay: 0.07 },
    { wave: 'sine', f0: N.G6, f1: N.G6, dur: 0.28, vol: 0.025, delay: 0.07 },
  ] },
  rare: { family: 'player', prio: 2, gap: 120, layers: [
    { wave: 'triangle', f0: N.E5, f1: N.E5, dur: 0.18, vol: 0.07 },
    { wave: 'triangle', f0: N.B5, f1: N.B5, dur: 0.2, vol: 0.07, delay: 0.08 },
    { wave: 'sine', f0: N.E6, f1: N.E6, dur: 0.4, vol: 0.05, delay: 0.16 },
  ] },
  epic: { family: 'player', prio: 2, gap: 150, layers: [
    { wave: 'triangle', f0: N.A4, f1: N.A4, dur: 0.2, vol: 0.07 },
    { wave: 'triangle', f0: N.E5, f1: N.E5, dur: 0.2, vol: 0.07, delay: 0.08 },
    { wave: 'triangle', f0: N.A5, f1: N.A5, dur: 0.25, vol: 0.07, delay: 0.16 },
    { wave: 'sine', f0: N.E6, f1: N.E6, dur: 0.55, vol: 0.05, delay: 0.24 },
    { wave: 'square', f0: N.A5, f1: N.A5 * 2, dur: 0.5, vol: 0.02, delay: 0.24, filter: LP(1200, 6000) },
  ] },
  set: { family: 'player', prio: 2, gap: 150, layers: [
    { wave: 'triangle', f0: N.C5, f1: N.C5, dur: 0.35, vol: 0.06 },
    { wave: 'triangle', f0: N.E5, f1: N.E5, dur: 0.35, vol: 0.05, delay: 0.05 },
    { wave: 'triangle', f0: N.G5, f1: N.G5, dur: 0.4, vol: 0.05, delay: 0.1 },
    { wave: 'sine', f0: N.C6, f1: N.C6 * 2, dur: 0.45, vol: 0.03, delay: 0.1 },
  ] },
  pack: { family: 'player', prio: 2, gap: 150, layers: [
    { wave: 'triangle', f0: N.C5, f1: N.C6, dur: 0.3, vol: 0.08 },
    { wave: 'sine', f0: N.G5, f1: N.G6, dur: 0.45, vol: 0.05, delay: 0.06 },
    { wave: 'noise', f0: 0, f1: 0, dur: 0.3, vol: 0.02, filter: BP(2000, 8000, 1.2) },
  ] },
  coin: { family: 'player', prio: 1, gap: 40, layers: [
    { wave: 'sine', f0: N.B6, f1: N.B6, dur: 0.06, vol: 0.05 },
    { wave: 'sine', f0: N.E7, f1: N.E7, dur: 0.14, vol: 0.05, delay: 0.05 },
  ] },
  wave: { family: 'player', prio: 1, gap: 200, layers: [
    { wave: 'triangle', f0: N.G4, f1: N.G5, dur: 0.22, vol: 0.06 },
    { wave: 'sine', f0: N.G5, f1: N.G5, dur: 0.3, vol: 0.03, delay: 0.1 },
    { wave: 'noise', f0: 0, f1: 0, dur: 0.25, vol: 0.015, attack: 0.08, filter: BP(800, 5000, 1.5) },
  ] },
  zap: { family: 'player', prio: 0, gap: 45, layers: [
    { wave: 'sawtooth', f0: 2400, f1: 380, dur: 0.07, vol: 0.035, filter: BP(3000, 900, 1.5) },
    { wave: 'noise', f0: 0, f1: 0, dur: 0.04, vol: 0.03, filter: HP(3000, 3000) },
  ] },
  freeze: { family: 'player', prio: 1, gap: 90, layers: [
    { wave: 'sine', f0: 2400, f1: 1200, dur: 0.3, vol: 0.045 },
    { wave: 'triangle', f0: N.E7, f1: N.E7, dur: 0.2, vol: 0.025, delay: 0.04 },
    { wave: 'noise', f0: 0, f1: 0, dur: 0.25, vol: 0.02, filter: BP(7000, 4000, 4) },
  ] },
  // --- viruses: gritty / organic ---
  hit: { family: 'virus', prio: 0, gap: 30, layers: [
    { wave: 'noise', f0: 0, f1: 0, dur: 0.04, vol: 0.05, filter: BP(1800, 600, 2.5) },
    { wave: 'triangle', f0: 260, f1: 140, dur: 0.05, vol: 0.04 },
  ] },
  kill: { family: 'virus', prio: 0, gap: 25, layers: [
    { wave: 'sawtooth', f0: 190, f1: 55, dur: 0.15, vol: 0.07, filter: LP(1800, 220, 3) },
    { wave: 'noise', f0: 0, f1: 0, dur: 0.12, vol: 0.06, filter: BP(1100, 300, 3) },
  ] },
  wallHit: { family: 'virus', prio: 0, gap: 60, layers: [
    { wave: 'square', f0: 95, f1: 45, dur: 0.14, vol: 0.08, filter: LP(700, 160) },
    { wave: 'noise', f0: 0, f1: 0, dur: 0.1, vol: 0.07, filter: LP(1200, 200) },
  ] },
  boss: { family: 'virus', prio: 2, gap: 400, layers: [
    { wave: 'sawtooth', f0: 55, f1: 52, dur: 0.95, vol: 0.12, attack: 0.05, filter: LP(180, 1400, 4) },
    { wave: 'sawtooth', f0: 56.5, f1: 51, dur: 0.95, vol: 0.1, attack: 0.05, filter: LP(180, 1400, 4) },
    { wave: 'noise', f0: 0, f1: 0, dur: 0.6, vol: 0.04, attack: 0.2, filter: BP(300, 1200, 2) },
  ] },
  bossDie: { family: 'virus', prio: 2, gap: 300, layers: [
    { wave: 'sawtooth', f0: 220, f1: 30, dur: 0.9, vol: 0.12, filter: LP(2400, 120, 2) },
    { wave: 'noise', f0: 0, f1: 0, dur: 0.7, vol: 0.1, filter: LP(2200, 120) },
    { wave: 'sine', f0: 70, f1: 30, dur: 0.8, vol: 0.14 },
  ] },
  // c1: a tier boss telegraphs (shield coming, artillery aiming): two hard square blips, readable over the battle.
  bossWarn: { family: 'virus', prio: 2, gap: 350, layers: [
    { wave: 'square', f0: 880, f1: 860, dur: 0.07, vol: 0.06, filter: LP(3000, 1800) },
    { wave: 'square', f0: 880, f1: 860, dur: 0.07, vol: 0.06, delay: 0.11, filter: LP(3000, 1800) },
    { wave: 'sine', f0: 110, f1: 90, dur: 0.2, vol: 0.08 },
  ] },
  mutation: { family: 'virus', prio: 2, gap: 600, layers: [
    // Two detuned saws drift apart (a warped tritone), the filter closes, a sub sinks under it.
    { wave: 'sawtooth', f0: 220, f1: 196, dur: 1.1, vol: 0.08, attack: 0.04, filter: LP(2400, 260, 6) },
    { wave: 'sawtooth', f0: 311, f1: 233, dur: 1.1, vol: 0.06, attack: 0.04, filter: LP(2400, 260, 6) },
    { wave: 'sine', f0: 58, f1: 41, dur: 1.2, vol: 0.13, attack: 0.08 },
    { wave: 'noise', f0: 0, f1: 0, dur: 0.5, vol: 0.04, delay: 0.05, filter: BP(600, 2400, 5) },
  ] },
  death: { family: 'virus', prio: 2, gap: 800, layers: [
    { wave: 'sawtooth', f0: 330, f1: 55, dur: 1.0, vol: 0.1, filter: LP(3000, 150, 2) },
    { wave: 'square', f0: 165, f1: 40, dur: 1.1, vol: 0.05, filter: LP(1200, 100) },
    { wave: 'noise', f0: 0, f1: 0, dur: 0.8, vol: 0.06, filter: LP(3000, 100) },
  ] },
  heartbeat: { family: 'virus', prio: 1, gap: 300, layers: [
    { wave: 'sine', f0: 72, f1: 45, dur: 0.16, vol: 0.18 },
    { wave: 'sine', f0: 62, f1: 40, dur: 0.18, vol: 0.13, delay: 0.2 },
  ] },
  // --- UI: soft clicks ---
  click: { family: 'ui', prio: 1, gap: 30, layers: [
    { wave: 'sine', f0: 1300, f1: 900, dur: 0.028, vol: 0.045 },
    { wave: 'noise', f0: 0, f1: 0, dur: 0.012, vol: 0.012, filter: HP(4000, 4000) },
  ] },
  mission: { family: 'ui', prio: 2, gap: 500, layers: [
    // A bell chime: C6 E6 G6 C7, each with a quiet octave partial.
    { wave: 'sine', f0: N.C6, f1: N.C6, dur: 0.5, vol: 0.06 },
    { wave: 'sine', f0: N.E6, f1: N.E6, dur: 0.5, vol: 0.055, delay: 0.09 },
    { wave: 'sine', f0: N.G6, f1: N.G6, dur: 0.55, vol: 0.05, delay: 0.18 },
    { wave: 'sine', f0: N.C7, f1: N.C7, dur: 0.8, vol: 0.05, delay: 0.27 },
    { wave: 'triangle', f0: N.C7 * 2, f1: N.C7 * 2, dur: 0.4, vol: 0.012, delay: 0.27 },
  ] },
  // --- verbs ---
  boot: { family: 'player', prio: 2, gap: 400, layers: [
    // Power-on: a sine sweep up, then a bright confirm blip and a soft air burst.
    { wave: 'sine', f0: 110, f1: 880, dur: 0.28, vol: 0.08, attack: 0.02 },
    { wave: 'triangle', f0: N.A5, f1: N.A5, dur: 0.3, vol: 0.06, delay: 0.24 },
    { wave: 'square', f0: N.E6, f1: N.E6, dur: 0.12, vol: 0.02, delay: 0.24, filter: LP(4000, 1500) },
    { wave: 'noise', f0: 0, f1: 0, dur: 0.3, vol: 0.025, attack: 0.15, filter: BP(500, 6000, 1.2) },
  ] },
  fusion: { family: 'player', prio: 2, gap: 300, layers: [
    // A rising two-note chord: C5+E5, then G5+B5 over it, a shimmer tail.
    { wave: 'triangle', f0: N.C5, f1: N.C5, dur: 0.35, vol: 0.06 },
    { wave: 'triangle', f0: N.E5, f1: N.E5, dur: 0.35, vol: 0.05 },
    { wave: 'triangle', f0: N.G5, f1: N.G5, dur: 0.55, vol: 0.06, delay: 0.14 },
    { wave: 'triangle', f0: N.B5, f1: N.B5, dur: 0.55, vol: 0.05, delay: 0.14 },
    { wave: 'sawtooth', f0: N.G5, f1: N.G5 * 2, dur: 0.5, vol: 0.02, delay: 0.14, filter: LP(800, 5000) },
    { wave: 'noise', f0: 0, f1: 0, dur: 0.45, vol: 0.02, delay: 0.14, filter: BP(4000, 9000, 3) },
  ] },
  pulse: { family: 'player', prio: 2, gap: 200, layers: [
    { wave: 'sine', f0: 330, f1: 880, dur: 0.25, vol: 0.08 },
    { wave: 'noise', f0: 0, f1: 0, dur: 0.25, vol: 0.04, filter: BP(600, 3000, 1.5) },
  ] },
  pulseOverload: { family: 'player', prio: 2, gap: 200, layers: [
    // Boom: a sub thump, a crushed square knock and a low-passed noise blast.
    { wave: 'sine', f0: 140, f1: 34, dur: 0.6, vol: 0.22 },
    { wave: 'square', f0: 220, f1: 55, dur: 0.22, vol: 0.05, filter: LP(1600, 200) },
    { wave: 'noise', f0: 0, f1: 0, dur: 0.45, vol: 0.12, filter: LP(2600, 160) },
  ] },
  pulseCryo: { family: 'player', prio: 2, gap: 200, layers: [
    // Crystalline: a falling bell cascade over a glassy high noise.
    { wave: 'sine', f0: N.G7, f1: N.G7, dur: 0.25, vol: 0.04 },
    { wave: 'sine', f0: N.E7, f1: N.E7, dur: 0.3, vol: 0.04, delay: 0.05 },
    { wave: 'sine', f0: N.B6, f1: N.B6, dur: 0.35, vol: 0.04, delay: 0.1 },
    { wave: 'triangle', f0: N.E6, f1: N.E6, dur: 0.5, vol: 0.04, delay: 0.15 },
    { wave: 'noise', f0: 0, f1: 0, dur: 0.5, vol: 0.03, filter: BP(9000, 5000, 6) },
  ] },
  pulseChain: { family: 'player', prio: 2, gap: 200, layers: [
    // Zap sweep: a saw sweeping up through a band-pass, then crackling back down.
    { wave: 'sawtooth', f0: 180, f1: 3200, dur: 0.18, vol: 0.05, filter: BP(400, 5000, 3) },
    { wave: 'sawtooth', f0: 3000, f1: 160, dur: 0.22, vol: 0.04, delay: 0.14, filter: BP(5000, 400, 3) },
    { wave: 'noise', f0: 0, f1: 0, dur: 0.3, vol: 0.05, filter: HP(2500, 6000) },
  ] },
  pulseMining: { family: 'player', prio: 2, gap: 200, layers: [
    // Coin cascade: five rising coin pings.
    { wave: 'sine', f0: N.G6, f1: N.G6, dur: 0.09, vol: 0.045 },
    { wave: 'sine', f0: N.B6, f1: N.B6, dur: 0.09, vol: 0.045, delay: 0.05 },
    { wave: 'sine', f0: N.D7, f1: N.D7, dur: 0.09, vol: 0.045, delay: 0.1 },
    { wave: 'sine', f0: N.E7, f1: N.E7, dur: 0.1, vol: 0.045, delay: 0.15 },
    { wave: 'sine', f0: N.G7, f1: N.G7, dur: 0.25, vol: 0.045, delay: 0.2 },
    { wave: 'triangle', f0: N.G5, f1: N.G5, dur: 0.3, vol: 0.03 },
  ] },
  pulseFirewall: { family: 'player', prio: 2, gap: 200, layers: [
    // Shield hum: two detuned saws through an opening low-pass, a sine body, a soft swell.
    { wave: 'sawtooth', f0: 110, f1: 110, dur: 0.75, vol: 0.06, attack: 0.08, filter: LP(300, 2200, 5) },
    { wave: 'sawtooth', f0: 111.6, f1: 111.6, dur: 0.75, vol: 0.05, attack: 0.08, filter: LP(300, 2200, 5) },
    { wave: 'sine', f0: 220, f1: 220, dur: 0.7, vol: 0.06, attack: 0.1 },
    { wave: 'triangle', f0: N.E5, f1: N.E5, dur: 0.4, vol: 0.02, delay: 0.25 },
  ] },
  // c2: placement: a low thunk as it lands, a rising sine ping and a short radio chirp.
  beacon: { family: 'player', prio: 2, gap: 300, layers: [
    { wave: 'sine', f0: 160, f1: 60, dur: 0.22, vol: 0.14 },
    { wave: 'sine', f0: N.E5, f1: N.B5, dur: 0.3, vol: 0.06, delay: 0.08 },
    { wave: 'square', f0: N.B6, f1: N.B6, dur: 0.06, vol: 0.015, delay: 0.34, filter: LP(5000, 2000) },
    { wave: 'square', f0: N.E7, f1: N.E7, dur: 0.06, vol: 0.012, delay: 0.42, filter: LP(5000, 2000) },
    { wave: 'noise', f0: 0, f1: 0, dur: 0.18, vol: 0.03, filter: LP(1200, 200) },
  ] },
  // c2: the hold goal reached: a two-chord rise (E5+B5, then A5+E6) over a soft air swell.
  beaconHold: { family: 'player', prio: 2, gap: 400, layers: [
    { wave: 'triangle', f0: N.E5, f1: N.E5, dur: 0.3, vol: 0.05 },
    { wave: 'triangle', f0: N.B5, f1: N.B5, dur: 0.3, vol: 0.045 },
    { wave: 'triangle', f0: N.A5, f1: N.A5, dur: 0.55, vol: 0.05, delay: 0.16 },
    { wave: 'triangle', f0: N.E6, f1: N.E6, dur: 0.55, vol: 0.045, delay: 0.16 },
    { wave: 'noise', f0: 0, f1: 0, dur: 0.5, vol: 0.02, attack: 0.2, filter: BP(2000, 7000, 1.5) },
  ] },
};

const PULSE_SFX: Readonly<Record<Tag, Sfx>> = { overload: 'pulseOverload', cryo: 'pulseCryo', chain: 'pulseChain', mining: 'pulseMining', firewall: 'pulseFirewall' };

/** The Pulse voice for the dominant tag (null: the plain ring). */
export function pulseSfx(tag: Tag | null): Sfx {
  return tag ? PULSE_SFX[tag] : 'pulse';
}

/** Length of a voice (s): the latest layer end. */
export function voiceLength(name: Sfx): number {
  let l = 0;
  for (const v of VOICES[name].layers) l = Math.max(l, (v.delay ?? 0) + v.dur);
  return l;
}

/** Concurrent voices at most (normal game; the widget gets fewer). */
export const MAX_VOICES = 16;
export const MAX_VOICES_LITE = 6;
/** Same voice at most at once. */
export const MAX_SAME = 4;
/** Slots kept free for prio ≥ 1 voices (spam never takes the last ones). */
export const RESERVED = 4;

/**
 * Pure voice budget (no Web Audio): decides whether voice `name` may start at `now` (ms). It tracks end times only,
 * in fixed arrays, so no timers and no per-call allocation. Prio 2 voices ignore the global cap (they still count, and still obey the gap and the same-voice cap).
 */
export class VoiceLimiter {
  private readonly ends: number[] = [];
  private readonly same = new Map<string, number[]>();
  private readonly last = new Map<string, number>();

  constructor(
    readonly max = MAX_VOICES,
    readonly maxSame = MAX_SAME,
  ) {}

  /** Voices still sounding at `now`. */
  active(now: number): number {
    let n = 0;
    for (const e of this.ends) if (e > now) n++;
    return n;
  }

  tryAcquire(name: string, now: number, durMs: number, prio: number, gapMs: number): boolean {
    const last = this.last.get(name);
    if (last !== undefined && now - last < gapMs) return false;
    let same = this.same.get(name);
    if (!same) {
      same = [];
      this.same.set(name, same);
    }
    let s = -1;
    let sameLive = 0;
    for (let i = 0; i < same.length; i++) {
      if (same[i]! > now) sameLive++;
      else if (s < 0) s = i;
    }
    if (sameLive >= this.maxSame) return false;
    const live = this.active(now);
    const cap = prio === 0 ? this.max - RESERVED : this.max;
    if (live >= cap && prio < 2) return false;
    // Record the end in a free slot (arrays never grow past max / maxSame + prio-2 overflow).
    let g = -1;
    for (let i = 0; i < this.ends.length; i++) if (this.ends[i]! <= now) {
      g = i;
      break;
    }
    if (g >= 0) this.ends[g] = now + durMs;
    else if (this.ends.length < this.max * 2) this.ends.push(now + durMs);
    if (s >= 0) same[s] = now + durMs;
    else same.push(now + durMs);
    this.last.set(name, now);
    return true;
  }
}

// --- music ---

/** 8-step synthwave loop: octave bass + minor arpeggio (Am → Am → F → G). */
const BASS = [55, 110, 55, 110, 43.65, 87.3, 49, 98];
const LEAD = [440, 523, 659, 523, 349, 440, 392, 494];
/** Layer 2: one chord per 2 steps, arpeggiated in 8ths of a step (up the chord) over a detuned saw pad. */
const CHORDS: readonly (readonly number[])[] = [
  [N.A3, N.C4, N.E4, N.A4],
  [N.A3, N.C4, N.E4, N.A4],
  [174.6, N.A3, N.C4, 349.2],
  [196, N.B4 / 2, 293.7, N.G4],
];
const MUSIC_VOL = 0.05;

export interface MusicPlan {
  /** Layer 2 (arp + pad) level, 0..1. */
  layer2: number;
  /** Layer 2 low-pass cutoff (Hz): opens with the wave band. */
  cutoff: number;
  /** Step length (s): the loop speeds up by wave band. */
  stepS: number;
}

/** Wave bands of the music: from `wave` on, these values hold (boss waves add `BOSS`). */
export const MUSIC_BANDS: readonly { wave: number; layer2: number; cutoff: number; stepS: number }[] = [
  { wave: 0, layer2: 0, cutoff: 900, stepS: 0.26 },
  { wave: 10, layer2: 0.55, cutoff: 1400, stepS: 0.26 },
  { wave: 20, layer2: 0.7, cutoff: 2200, stepS: 0.245 },
  { wave: 40, layer2: 0.85, cutoff: 3400, stepS: 0.23 },
  { wave: 80, layer2: 1, cutoff: 5000, stepS: 0.215 },
];
/** A boss wave: layer 2 at least this loud, the filter this much wider, the step this much shorter. */
export const BOSS = { layer2: 0.8, cutoffMul: 1.6, stepMul: 0.94 };

/** The music for wave `wave` (0: before wave 1; `boss`: a boss wave). Pure. */
export function musicPlan(wave: number, boss: boolean): MusicPlan {
  let b = MUSIC_BANDS[0]!;
  for (const x of MUSIC_BANDS) if (wave >= x.wave) b = x;
  if (!boss) return { layer2: b.layer2, cutoff: b.cutoff, stepS: b.stepS };
  return { layer2: Math.max(b.layer2, BOSS.layer2), cutoff: Math.min(8000, b.cutoff * BOSS.cutoffMul), stepS: b.stepS * BOSS.stepMul };
}

export type Sting = 'boot' | 'death' | 'boss' | 'finale';

/** Stingers: [freq, start (s), dur (s), shape] notes through the music bus. */
export const STINGS: Readonly<Record<Sting, readonly [number, number, number, OscillatorType][]>> = {
  // Run start: a fast rising Am arpeggio landing on a held A5.
  boot: [[N.A3, 0, 0.12, 'square'], [N.E4, 0.07, 0.12, 'square'], [N.A4, 0.14, 0.12, 'square'], [N.C5, 0.21, 0.12, 'square'], [N.E5, 0.28, 0.14, 'square'], [N.A5, 0.35, 0.6, 'triangle'], [110, 0, 0.5, 'triangle']],
  // Death: a falling minor line into a low drone.
  // c1 boss entrance: a menacing low chromatic crawl over a sub drone.
  boss: [[110, 0, 0.25, 'sawtooth'], [116.5, 0.25, 0.25, 'sawtooth'], [110, 0.5, 0.25, 'sawtooth'], [103.8, 0.75, 0.6, 'sawtooth'], [55, 0, 1.4, 'triangle']],
  // c1 FINALE boss down, next tier unlocked: a bright A major climb onto a held A5.
  finale: [[N.A4, 0, 0.14, 'square'], [554.4, 0.1, 0.14, 'square'], [N.E5, 0.2, 0.14, 'square'], [N.A5, 0.3, 0.9, 'triangle'], [N.A3, 0, 1.2, 'triangle']],
  death: [[N.E5, 0, 0.3, 'sawtooth'], [N.C5, 0.22, 0.3, 'sawtooth'], [N.A4, 0.44, 0.35, 'sawtooth'], [207.7, 0.7, 1.2, 'sawtooth'], [55, 0.7, 1.6, 'triangle']],
};

export class AudioBus {
  private ctx: AudioContext | null = null;
  private sfxGain: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private musicFilter: BiquadFilterNode | null = null;
  private l2Gain: GainNode | null = null;
  private l2Filter: BiquadFilterNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private readonly limiter: VoiceLimiter;
  private musicTimer: number | null = null;
  private nextStep = 0;
  private step = 0;
  private plan: MusicPlan = musicPlan(0, false);
  /** Unattended widget: fewer voices, no layer 2, no stingers. */
  readonly lite: boolean;
  sfxOn = true;
  musicOn = true;
  portalMuted = false;
  adPlaying = false;
  tense = false;

  constructor(lite = WIDGET) {
    this.lite = lite;
    this.limiter = new VoiceLimiter(lite ? MAX_VOICES_LITE : MAX_VOICES, lite ? 2 : MAX_SAME);
  }

  /** Must be called from a user gesture (iOS Safari resumes audio only then). */
  unlock(): void {
    try {
      if (!this.ctx) {
        const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        const ctx = new Ctor();
        this.ctx = ctx;
        const comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -14;
        comp.knee.value = 10;
        comp.ratio.value = 6;
        comp.attack.value = 0.003;
        comp.release.value = 0.2;
        comp.connect(ctx.destination);
        this.sfxGain = ctx.createGain();
        this.sfxGain.connect(comp);
        this.musicFilter = ctx.createBiquadFilter();
        this.musicFilter.type = 'lowpass';
        this.musicFilter.frequency.value = 8000;
        this.musicGain = ctx.createGain();
        this.musicGain.gain.value = MUSIC_VOL;
        this.musicGain.connect(this.musicFilter).connect(comp);
        this.l2Filter = ctx.createBiquadFilter();
        this.l2Filter.type = 'lowpass';
        this.l2Filter.Q.value = 3;
        this.l2Filter.frequency.value = this.plan.cutoff;
        this.l2Gain = ctx.createGain();
        this.l2Gain.gain.value = 0;
        this.l2Gain.connect(this.l2Filter).connect(this.musicGain);
        this.noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
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

  /** Re-applies mute state, the low-HP "muffled music" filter and the layer-2 plan. */
  apply(): void {
    if (!this.ctx || !this.sfxGain || !this.musicGain || !this.musicFilter) return;
    const t = this.ctx.currentTime;
    this.sfxGain.gain.setTargetAtTime(this.muted || !this.sfxOn ? 0 : 1, t, 0.02);
    this.musicGain.gain.setTargetAtTime(this.muted || !this.musicOn ? 0 : MUSIC_VOL, t, 0.1);
    this.musicFilter.frequency.setTargetAtTime(this.tense ? 700 : 8000, t, 0.3);
    this.applyPlan(1.2);
    if (this.musicOn && !this.musicTimer) this.startMusic();
  }

  private applyPlan(tau: number): void {
    if (!this.ctx || !this.l2Gain || !this.l2Filter) return;
    const t = this.ctx.currentTime;
    this.l2Gain.gain.setTargetAtTime(this.lite ? 0 : this.plan.layer2, t, tau);
    this.l2Filter.frequency.setTargetAtTime(this.plan.cutoff, t, tau);
  }

  /** A wave started: the music layer 2 fades to the wave band's level (boss waves push it). */
  setWave(wave: number, boss: boolean): void {
    this.plan = musicPlan(wave, boss);
    this.applyPlan(1.2);
  }

  /** A (new or resumed) run starts at `wave`: the boot sting plays and the music follows the wave band. */
  runStart(wave: number): void {
    this.plan = musicPlan(wave, false);
    this.applyPlan(0.3);
    this.sting('boot');
  }

  /** A musical stinger through the music bus (respects the music setting); death also drops layer 2. */
  sting(name: Sting): void {
    if (name === 'death') {
      this.plan = { ...this.plan, layer2: 0 };
      this.applyPlan(0.25);
    }
    if (!this.ctx || !this.musicGain || this.muted || !this.musicOn || this.lite) return;
    const t0 = this.ctx.currentTime + 0.02;
    for (const [f, at, dur, type] of STINGS[name]) this.tone(f, type, t0 + at, dur, name === 'death' ? 1.1 : 0.8, this.musicGain);
  }

  play(name: Sfx, pitch = 1): void {
    if (!this.ctx || !this.sfxGain || this.muted || !this.sfxOn) return;
    const def = VOICES[name];
    const ctx = this.ctx;
    const len = voiceLength(name);
    if (!this.limiter.tryAcquire(name, ctx.currentTime * 1000, len * 1000, def.prio, def.gap)) return;
    const t = ctx.currentTime;
    const p = pitch * (1 + (Math.random() * 2 - 1) * (def.family === 'virus' ? 0.08 : 0.03));
    for (const v of def.layers) {
      const t0 = t + (v.delay ?? 0);
      const att = v.attack ?? 0.003;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(v.vol, t0 + att);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + Math.max(att + 0.005, v.dur));
      let out: AudioNode = g;
      if (v.filter) {
        const f = ctx.createBiquadFilter();
        f.type = v.filter.type;
        f.Q.value = v.filter.q ?? 0.7;
        f.frequency.setValueAtTime(v.filter.f0, t0);
        if (v.filter.f1 !== v.filter.f0) f.frequency.exponentialRampToValueAtTime(v.filter.f1, t0 + v.dur);
        f.connect(g);
        out = f;
      }
      g.connect(this.sfxGain);
      let src: AudioScheduledSourceNode;
      if (v.wave === 'noise') {
        if (!this.noiseBuf) continue;
        const b = ctx.createBufferSource();
        b.buffer = this.noiseBuf;
        b.playbackRate.value = p;
        src = b;
      } else {
        const o = ctx.createOscillator();
        o.type = v.wave;
        o.frequency.setValueAtTime(v.f0 * p, t0);
        if (v.f1 !== v.f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, v.f1 * p), t0 + v.dur);
        src = o;
      }
      src.connect(out);
      src.start(t0);
      src.stop(t0 + v.dur + 0.01);
    }
  }

  private startMusic(): void {
    if (!this.ctx) return;
    this.nextStep = this.ctx.currentTime + 0.1;
    this.musicTimer = window.setInterval(() => this.scheduleMusic(), 100);
  }

  private scheduleMusic(): void {
    const ctx = this.ctx;
    if (!ctx || !this.musicGain) return;
    // After a long stall (hidden tab), skip ahead instead of firing a burst of late notes.
    if (this.nextStep < ctx.currentTime - 0.5) this.nextStep = ctx.currentTime + 0.05;
    const l2 = !this.lite && this.plan.layer2 > 0.01 && this.l2Gain !== null;
    while (this.nextStep < ctx.currentTime + 0.3) {
      const S = this.plan.stepS;
      const at = this.nextStep;
      const i = this.step % BASS.length;
      this.tone(BASS[i]!, 'triangle', at, S * 0.9, 1, this.musicGain);
      if (this.step % 2 === 0) this.tone(LEAD[(this.step / 2) % LEAD.length]!, 'square', at, S * 0.5, 0.35, this.musicGain);
      if (l2) {
        const chord = CHORDS[Math.floor(i / 2)]!;
        // Arp: two 8ths per step, up the chord an octave above the pad.
        this.tone(chord[(i % 2) * 2]! * 2, 'square', at, S * 0.4, 0.22, this.l2Gain!);
        this.tone(chord[(i % 2) * 2 + 1]! * 2, 'square', at + S / 2, S * 0.4, 0.2, this.l2Gain!);
        // Pad: the chord's root and fifth as a detuned saw pair, held over its 2 steps.
        if (i % 2 === 0) {
          this.tone(chord[0]!, 'sawtooth', at, S * 2, 0.22, this.l2Gain!, 0.06);
          this.tone(chord[2]! * 1.004, 'sawtooth', at, S * 2, 0.16, this.l2Gain!, 0.06);
        }
      }
      this.nextStep += S;
      this.step++;
    }
  }

  private tone(freq: number, type: OscillatorType, at: number, dur: number, vol: number, dest: AudioNode, attack = 0): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    if (attack > 0) {
      g.gain.setValueAtTime(0.0001, at);
      g.gain.linearRampToValueAtTime(vol, at + attack);
    } else g.gain.setValueAtTime(vol, at);
    g.gain.exponentialRampToValueAtTime(0.001, at + dur);
    o.connect(g).connect(dest);
    o.start(at);
    o.stop(at + dur + 0.01);
  }
}

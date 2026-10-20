import { describe, expect, it } from 'vitest';
import { DEFAULT_META_DATA } from '../src/meta/metaData';
import { applyMissions, ensureMissionDay, MISSIONS, missionDef, type MissionRun, missionRun, missionsFor, missionTarget, missionText, msToReset, nextGoals, validateMissions, validateMissionsState } from '../src/meta/missions';
import { dayIndex } from '../src/meta/leaderboardRules';
import { settleDaily, settleRun } from '../src/meta/runEnd';
import { emptyRunStats } from '../src/meta/runStats';
import { defaultMeta } from '../src/meta/state';
import { DEFAULT_DATA } from '../src/sim/data';
import { createWorld } from '../src/sim/state';

const D = DEFAULT_DATA;
const M = DEFAULT_META_DATA;
const DAY = 86_400_000;
const T0 = Date.UTC(2026, 9, 20, 12); // 2026-10-20 12:00 UTC

const run = (o: Partial<MissionRun> = {}): MissionRun => ({ tier: 1, wave: 1, kills: 0, nests: 0, levels: 0, fusion: 0, dominant: null, seed: 1, ...o });

describe('daily missions', () => {
  it('the data file is valid', () => {
    expect(() => validateMissions(structuredClone(MISSIONS))).not.toThrow();
    expect(() => validateMissions({ ...structuredClone(MISSIONS), perDay: 0 })).toThrow(/perDay/);
    const bad = structuredClone(MISSIONS);
    bad.templates[0]!.reward = [0];
    expect(() => validateMissions(bad)).toThrow(/reward/);
  });

  it('picks the same 3 distinct-kind missions for a day, and other ones on other days', () => {
    const m = defaultMeta();
    const a = missionsFor('2026-10-20', m);
    expect(a).toHaveLength(MISSIONS.perDay);
    expect(missionsFor('2026-10-20', m)).toEqual(a);
    expect(new Set(a.map((x) => missionDef(x.id)!.kind)).size).toBe(a.length);
    const seen = new Set<string>();
    for (let d = 0; d < 30; d++) for (const x of missionsFor(new Date((dayIndex('2026-10-01') + d) * DAY).toISOString().slice(0, 10), m)) seen.add(x.id);
    expect(seen.size).toBe(MISSIONS.templates.length);
  });

  it('targets scale with the player: floors by tier, best wave and per-run averages', () => {
    const m = defaultMeta();
    const wave = missionDef('wave')!;
    expect(missionTarget(wave, m)).toBe(10);
    m.tierUnlocked = 3;
    m.best = { '1': 60, '2': 110, '3': 40 };
    expect(missionTarget(wave, m)).toBe(30); // 0.8 × best on T3, down to a step of 5
    const kills = missionDef('kills')!;
    expect(missionTarget(kills, m)).toBe(kills.targets[2]);
    m.lifetime.runs = 10;
    m.lifetime.kills.basic = 10_000;
    expect(missionTarget(kills, m)).toBe(1100);
    const bits = missionDef('bits')!;
    m.lifetime.bitsEarned = 123_456 * 10;
    expect(missionTarget(bits, m)).toBe(130_000); // 1.1 × 123 456 → two significant digits
  });

  it('progress: best of a run vs the day sum; Keys once; a new day resets', () => {
    const m = defaultMeta();
    const s = ensureMissionDay(m, T0);
    // Force a known list: one best mission, one sum mission.
    s.list = [
      { id: 'kills', target: 100, reward: 4, tier: 1, tag: null },
      { id: 'waves', target: 30, reward: 3, tier: 1, tag: null },
    ];
    s.progress = [0, 0];
    s.claimed = [false, false];
    const keys0 = m.keys;
    let d = applyMissions(m, run({ kills: 60, wave: 16, seed: 1 }), 0, T0);
    expect(d.map((x) => x.after)).toEqual([60, 15]);
    m.runs += 1;
    d = applyMissions(m, run({ kills: 40, wave: 21, seed: 2 }), 0, T0 + 1000);
    expect(d.map((x) => x.after)).toEqual([60, 35]);
    expect(d[1]!.done).toBe(true);
    expect(m.keys).toBe(keys0 + 3);
    m.runs += 1;
    d = applyMissions(m, run({ kills: 120, wave: 30, seed: 3 }), 0, T0 + 2000);
    expect(d[0]!.done && d[0]!.keys === 4).toBe(true);
    expect(d[1]!.done).toBe(false); // already paid
    expect(m.keys).toBe(keys0 + 7);
    // Next UTC day: a fresh list, nothing claimed.
    applyMissions(m, run(), 0, T0 + DAY);
    expect(m.missions.day).toBe('2026-10-21');
    expect(m.missions.claimed.every((c) => !c)).toBe(true);
  });

  it('a revived run settling again does not count its sum twice', () => {
    const m = defaultMeta();
    const s = ensureMissionDay(m, T0);
    s.list = [{ id: 'waves', target: 1000, reward: 3, tier: 1, tag: null }];
    s.progress = [0];
    s.claimed = [false];
    applyMissions(m, run({ wave: 41, seed: 7 }), 0, T0); // death at 41 (runs not yet counted)
    expect(m.missions.progress[0]).toBe(40);
    applyMissions(m, run({ wave: 61, seed: 7 }), 0, T0); // revive undid runs → same key
    expect(m.missions.progress[0]).toBe(60);
    m.runs += 1;
    applyMissions(m, run({ wave: 11, seed: 7 }), 0, T0); // a new run, same seed (daily retry)
    expect(m.missions.progress[0]).toBe(70);
  });

  it('wave missions need the tier, tagWave needs the set to be the largest', () => {
    const m = defaultMeta();
    const s = ensureMissionDay(m, T0);
    s.list = [
      { id: 'wave', target: 20, reward: 5, tier: 2, tag: null },
      { id: 'tagWave', target: 10, reward: 5, tier: 1, tag: 'cryo' },
    ];
    s.progress = [0, 0];
    s.claimed = [false, false];
    const d = applyMissions(m, run({ tier: 1, wave: 30, dominant: 'chain' }), 0, T0);
    expect(d.map((x) => x.after)).toEqual([0, 0]);
    m.runs += 1;
    const e = applyMissions(m, run({ tier: 2, wave: 25, dominant: 'cryo' }), 0, T0);
    expect(e.every((x) => x.done)).toBe(true);
    expect(missionText(s.list[1]!, D)).toMatch(/Wave 10 with CRYO as top set/);
  });

  it('settleRun feeds the missions; settleDaily practice runs do not', () => {
    const m = defaultMeta();
    ensureMissionDay(m, T0);
    m.missions.list = [{ id: 'kills', target: 5, reward: 4, tier: 1, tag: null }];
    m.missions.progress = [0];
    m.missions.claimed = [false];
    const st = settleRun(m, D, M, { tier: 1, wave: 3, bits: 10, keys: 0, doubled: false, missions: run({ kills: 9 }), now: T0 });
    expect(st.missionKeys).toBe(4);
    expect(st.keys).toBe(0);
    expect(m.keys).toBe(4);
    const m2 = defaultMeta();
    ensureMissionDay(m2, T0);
    m2.dailyPaid = { day: 'd', n: 5 };
    const sd = settleDaily(m2, M, { bits: 10, keys: 0, doubled: false, missions: run({ kills: 999 }), now: T0 }, 'd', 2);
    expect(sd.unpaid).toBe(true);
    expect(sd.missions).toBeUndefined();
    expect(m2.missions.progress.every((p) => p === 0)).toBe(true);
  });

  it('missionRun reads kills, wave, fusion and the largest set from a world', () => {
    const w = createWorld(D, { seed: 5, tier: 2 });
    w.kills = 33;
    w.wave = 12;
    const st = emptyRunStats();
    st.nests = 2;
    st.levelsBought = 17;
    const r = missionRun(w, D, st);
    expect(r).toMatchObject({ tier: 2, wave: 12, kills: 33, nests: 2, levels: 17, seed: 5 });
  });

  it('the saved state is validated; garbage → empty', () => {
    const m = defaultMeta();
    ensureMissionDay(m, T0);
    const back = validateMissionsState(JSON.parse(JSON.stringify(m.missions)));
    expect(back).toEqual(m.missions);
    expect(validateMissionsState({ day: 'x', list: [{ id: 'nope' }] }).list).toEqual([]);
    expect(validateMissionsState(null).day).toBe('');
  });

  it('countdown to the UTC reset', () => {
    expect(msToReset(T0)).toBe(12 * 3600_000);
    expect(msToReset(Date.UTC(2026, 9, 20))).toBe(DAY);
  });

  it('next goals: tier unlock, the cheapest Bits goal, a card pack after the first run', () => {
    const m = defaultMeta();
    m.best = { '1': 20 };
    let g = nextGoals(m, D, M);
    expect(g[0]).toMatchObject({ kind: 'tier', have: 20, need: 50 });
    expect(g[1]!.kind).toBe('bits');
    expect(g.some((x) => x.kind === 'keys')).toBe(false);
    m.firstRunDone = true;
    m.keys = 4;
    g = nextGoals(m, D, M);
    expect(g[2]).toMatchObject({ kind: 'keys', have: 4 });
    m.tierUnlocked = D.tiers.length;
    m.best[String(m.tierUnlocked)] = 30;
    expect(nextGoals(m, D, M)[0]!.label).toMatch(/MILESTONE/);
  });
});

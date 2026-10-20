import { describe, expect, it } from 'vitest';
import { MetaStore } from '../src/meta/MetaStore';
import { DEFAULT_META_DATA } from '../src/meta/metaData';
import { memoryKV } from '../src/portal/storage';
import { DEFAULT_DATA } from '../src/sim/data';
import { createWorld } from '../src/sim/state';
import { stepN } from './helpers';

const D = DEFAULT_DATA;
const M = DEFAULT_META_DATA;

describe('MetaStore', () => {
  it('starts fresh, saves and reloads the meta state', () => {
    const kv = memoryKV();
    const a = new MetaStore(kv, D, M, () => 1000);
    expect(a.status).toBe('fresh');
    a.meta.bits = 321;
    a.meta.labs.push('speed3');
    a.save();
    const b = new MetaStore(kv, D, M, () => 2000);
    expect(b.status).toBe('ok');
    expect(b.meta.bits).toBe(321);
    expect(b.meta.labs).toEqual(['speed3']);
    expect(b.meta.lastSeen).toBe(1000);
  });

  it('refunds workshop levels bought at the old prices once, and not for a fresh save', () => {
    const kv = memoryKV();
    const a = new MetaStore(kv, D, M, () => 0);
    expect(a.refunded).toBe(0);
    expect(a.meta.economy).toBe(M.workshop.refund!.economy);
    a.meta.economy = 1;
    a.meta.workshop.damage = 100;
    a.meta.workshop.health = 40;
    a.meta.bits = 5;
    a.save();
    const b = new MetaStore(kv, D, M, () => 0);
    let old = 0, now = 0;
    for (let l = 0; l < 100; l++) {
      old += Math.ceil(16 * Math.pow(1.12, l));
      now += Math.ceil(16 * Math.pow(1.12, Math.min(l, 60)) * Math.pow(1.008, Math.max(0, l - 60)));
    }
    expect(b.refunded).toBe(old - now); // health 40 is below the knee: same price, nothing back
    expect(b.meta.bits).toBe(5 + old - now);
    expect(b.meta.workshop.damage).toBe(100);
    b.save();
    expect(new MetaStore(kv, D, M, () => 0).refunded).toBe(0);
  });

  it('keeps a run snapshot (with its options) until cleared; a corrupt one is dropped', () => {
    const kv = memoryKV();
    const s = new MetaStore(kv, D, M, () => 0);
    const opts = { seed: 9, tier: 1 };
    const w = createWorld(D, opts);
    w.phase = 'pause';
    w.offer = [];
    stepN(w, D, 50);
    s.saveRun(w, opts);
    const s2 = new MetaStore(kv, D, M, () => 0);
    const run = s2.loadRun();
    expect(run).not.toBeNull();
    expect(run!.world.tick).toBe(w.tick);
    expect(run!.opts.seed).toBe(9);
    s2.clearRun();
    expect(new MetaStore(kv, D, M, () => 0).loadRun()).toBeNull();
    kv.setItem('core-protocol.run', '{"v":1,"data":{"snapshot":"garbage","opts":{"seed":1,"tier":1},"savedAt":0}}');
    const s3 = new MetaStore(kv, D, M, () => 0);
    expect(s3.loadRun()).toBeNull();
    expect(kv.getItem('core-protocol.run')).toBeNull();
  });

  it('a v1 meta save migrates to v2 with empty daily missions and keeps its progress', () => {
    const kv = memoryKV();
    kv.setItem('core-protocol.meta', JSON.stringify({ v: 1, data: { bits: 77, keys: 3, tierUnlocked: 2, best: { '1': 55 } } }));
    const a = new MetaStore(kv, D, M, () => 0);
    expect(a.status).toBe('migrated');
    expect([a.meta.bits, a.meta.keys, a.meta.tierUnlocked]).toEqual([77, 3, 2]);
    expect(a.meta.missions).toEqual({ day: '', list: [], progress: [], claimed: [], last: null });
    a.meta.missions = { day: '2026-10-20', list: [{ id: 'kills', target: 300, reward: 4, tier: 1, tag: null }], progress: [120], claimed: [false], last: null };
    a.save();
    const b = new MetaStore(kv, D, M, () => 0);
    expect(b.status).toBe('ok');
    expect(b.meta.missions.progress).toEqual([120]);
    expect(JSON.parse(kv.getItem('core-protocol.meta')!).v).toBe(2);
  });

  it('a dead world is never saved as a run', () => {
    const kv = memoryKV();
    const s = new MetaStore(kv, D, M, () => 0);
    const w = createWorld(D, { seed: 1, tier: 1 });
    w.dead = true;
    s.saveRun(w, { seed: 1, tier: 1 });
    expect(s.hasRun()).toBe(false);
  });
});

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

  it('a dead world is never saved as a run', () => {
    const kv = memoryKV();
    const s = new MetaStore(kv, D, M, () => 0);
    const w = createWorld(D, { seed: 1, tier: 1 });
    w.dead = true;
    s.saveRun(w, { seed: 1, tier: 1 });
    expect(s.hasRun()).toBe(false);
  });
});

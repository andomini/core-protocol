import { afterEach, describe, expect, it, vi } from 'vitest';
import { localKV, memoryKV, SaveSlot } from '../src/portal/storage';

interface MetaV3 {
  bits: number;
  keys: number;
  muted: boolean;
}

const defaults = (): MetaV3 => ({ bits: 0, keys: 0, muted: false });
const validate = (d: unknown): MetaV3 => {
  if (typeof d !== 'object' || d === null) throw new Error('not an object');
  const r = d as Record<string, unknown>;
  const n = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) && x >= 0 ? x : 0);
  return { bits: n(r.bits), keys: n(r.keys), muted: r.muted === true };
};
const migrations = {
  1: (d: unknown) => ({ bits: (d as { gold: number }).gold }), // v1 called Bits "gold"
  2: (d: unknown) => ({ ...(d as object), keys: 0 }), // v2 had no keys
};

const slot = (kv = memoryKV()) => ({ kv, s: new SaveSlot<MetaV3>(kv, { key: 'cp.meta', version: 3, defaults, migrations, validate }) });

describe('SaveSlot', () => {
  it('fresh → defaults; save writes the {v, data} envelope; load round-trips', () => {
    const { kv, s } = slot();
    expect(s.load()).toEqual({ data: defaults(), status: 'fresh', from: null });
    expect(s.save({ bits: 12, keys: 3, muted: true })).toBe(true);
    expect(JSON.parse(kv.getItem('cp.meta')!)).toEqual({ v: 3, data: { bits: 12, keys: 3, muted: true } });
    expect(s.load()).toEqual({ data: { bits: 12, keys: 3, muted: true }, status: 'ok', from: 3 });
  });

  it('migrates v1 and v2 forward and validates the result', () => {
    const { s, kv } = slot(memoryKV({ 'cp.meta': JSON.stringify({ v: 1, data: { gold: 40 } }) }));
    expect(s.load()).toEqual({ data: { bits: 40, keys: 0, muted: false }, status: 'migrated', from: 1 });
    kv.setItem('cp.meta', JSON.stringify({ v: 2, data: { bits: 5, muted: true } }));
    expect(s.load()).toEqual({ data: { bits: 5, keys: 0, muted: true }, status: 'migrated', from: 2 });
  });

  it.each([
    ['not JSON', '{"v":3,'],
    ['an array', '[1,2]'],
    ['no version', '{"data":{}}'],
    ['a fractional version', '{"v":1.5,"data":{}}'],
    ['no data', '{"v":3}'],
    ['data that fails validation', '{"v":3,"data":null}'],
    ['a migration that throws', '{"v":1,"data":null}'],
  ])('%s → defaults, raw blob kept in .bak', (_label, raw) => {
    const { s, kv } = slot(memoryKV({ 'cp.meta': raw }));
    const r = s.load();
    expect(r.status).toBe('corrupt');
    expect(r.data).toEqual(defaults());
    expect(kv.getItem('cp.meta.bak')).toBe(raw);
    expect(s.save({ bits: 1, keys: 0, muted: false })).toBe(true); // a corrupt save may be replaced
  });

  it('never overwrites a save from a newer build', () => {
    const raw = JSON.stringify({ v: 9, data: { bits: 1e6 } });
    const { s, kv } = slot(memoryKV({ 'cp.meta': raw }));
    const r = s.load();
    expect(r.status).toBe('future');
    expect(r.from).toBe(9);
    expect(s.isReadOnly).toBe(true);
    expect(s.save(defaults())).toBe(false);
    expect(kv.getItem('cp.meta')).toBe(raw);
    expect(kv.getItem('cp.meta.bak')).toBe(raw);
  });

  it('keeps big numbers exact through a round trip', () => {
    const { s } = slot();
    s.save({ bits: 9.87654321e299, keys: 2 ** 53 - 1, muted: false });
    expect(s.load().data).toEqual({ bits: 9.87654321e299, keys: 2 ** 53 - 1, muted: false });
  });

  it('rejects a broken migration chain at construction', () => {
    expect(() => new SaveSlot(memoryKV(), { key: 'k', version: 3, defaults, migrations: { 1: (d) => d } })).toThrow(/2 → 3/);
    expect(() => new SaveSlot(memoryKV(), { key: 'k', version: 0, defaults })).toThrow();
    // No migrations: only the current version is readable; older blobs are corrupt.
    const kv = memoryKV({ k: '{"v":1,"data":{}}' });
    expect(new SaveSlot(kv, { key: 'k', version: 2, defaults }).load().status).toBe('corrupt');
  });

  it('clear() removes the slot', () => {
    const { s, kv } = slot();
    s.save(defaults());
    s.clear();
    expect(kv.getItem('cp.meta')).toBeNull();
    expect(s.load().status).toBe('fresh');
  });
});

describe('localKV', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('uses localStorage when it works', () => {
    const m = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) });
    const kv = localKV();
    kv.setItem('a', '1');
    expect(m.get('a')).toBe('1');
    expect(kv.getItem('a')).toBe('1');
    kv.removeItem('a');
    expect(m.has('a')).toBe(false);
  });

  it('falls back to memory when localStorage throws (private mode, quota)', () => {
    const boom = () => {
      throw new Error('SecurityError');
    };
    vi.stubGlobal('localStorage', { getItem: boom, setItem: boom, removeItem: boom });
    const kv = localKV();
    expect(kv.getItem('a')).toBeNull();
    kv.setItem('a', '1');
    expect(kv.getItem('a')).toBe('1');
    kv.removeItem('a');
    expect(kv.getItem('a')).toBeNull();
  });

  it('works with no localStorage global at all', () => {
    vi.stubGlobal('localStorage', undefined);
    const kv = localKV();
    kv.setItem('a', '2');
    expect(kv.getItem('a')).toBe('2');
  });
});

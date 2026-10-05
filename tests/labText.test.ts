import { describe, expect, it } from 'vitest';
import { DEFAULT_META_DATA } from '../src/meta/metaData';
import { DEFAULT_DATA } from '../src/sim/data';
import { labEffectText } from '../src/ui/labText';

describe('labEffectText', () => {
  it('describes every shipped lab node', () => {
    for (const n of DEFAULT_META_DATA.labs.nodes) expect(labEffectText(DEFAULT_DATA, n.effect)).toMatch(/\w{3}/);
    expect(labEffectText(DEFAULT_DATA, { type: 'unlock', stat: 'multishot' })).toBe('Unlocks Multishot');
    expect(labEffectText(DEFAULT_DATA, { type: 'bitsMul', value: 1.1 })).toBe('+10% Bits per run');
  });
});

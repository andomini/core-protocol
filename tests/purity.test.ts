import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : p.endsWith('.ts') ? [p] : [];
  });
}

const FORBIDDEN: [RegExp, string][] = [
  [/Math\.random/, 'Math.random'],
  // Transcendental (and sqrt) results are not guaranteed bit-identical across JS engines.
  [/Math\.(sin|cos|tan|asin|acos|atan|atan2|sqrt|cbrt|pow|exp|log|log2|log10|hypot)\b/, 'non-portable Math function'],
  [/\*\*/, 'exponent operator'],
  [/\bDate\b/, 'Date'],
  [/\bperformance\b/, 'performance'],
  [/\b(window|document|localStorage|globalThis)\b/, 'global environment access'],
];

const ALLOWED_ROOTS = [resolve('src/sim'), resolve('src/data')];

describe('src/sim purity', () => {
  const simFiles = files('src/sim');

  it('has files to check', () => {
    expect(simFiles.length).toBeGreaterThan(0);
  });

  for (const file of simFiles) {
    it(`${file} uses no non-deterministic or engine APIs`, () => {
      const src = readFileSync(file, 'utf8').replace(/\/\/.*$|\/\*[\s\S]*?\*\//gm, '');
      for (const [re, what] of FORBIDDEN) expect(re.test(src), `${what} in ${file}`).toBe(false);
    });

    it(`${file} imports only from src/sim and src/data`, () => {
      const src = readFileSync(file, 'utf8');
      const specs = [...src.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)].map((m) => m[1]!);
      for (const spec of specs) {
        expect(spec.startsWith('.'), `bare import "${spec}" in ${file}`).toBe(true);
        const target = resolve(dirname(file), spec);
        const ok = ALLOWED_ROOTS.some((root) => !relative(root, target).startsWith('..'));
        expect(ok, `"${spec}" in ${file} leaves src/sim|src/data`).toBe(true);
      }
    });
  }
});

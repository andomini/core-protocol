// Writes 64 unit vectors evenly spaced around the circle to src/data/directions.json.
// Generated once and committed: the sim reads the table instead of calling Math.cos/sin,
// whose results are not guaranteed bit-identical across JS engines.
import { writeFileSync } from 'node:fs';

const N = 64;
const round = (v: number): number => Number(v.toFixed(12)) || 0; // `|| 0` turns -0 into 0
const dirs: [number, number][] = [];
for (let i = 0; i < N; i++) {
  const a = (2 * Math.PI * i) / N;
  dirs.push([round(Math.cos(a)), round(Math.sin(a))]);
}
writeFileSync('src/data/directions.json', JSON.stringify(dirs) + '\n');
console.log(`wrote ${N} directions`);

// npm run telemetry:report -- export1.json [export2.json …] → reports/telemetry-<date>.md
// Exports come from the telemetry overlay (~ in dev, ?telemetry=1 in any build → "Export").
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { TelemetryEvent } from '../../src/telemetry/Telemetry';
import { summarize } from './summary';

const files = process.argv.slice(2).filter((a) => !a.startsWith('--'));
if (files.length === 0) {
  console.error('Usage: npm run telemetry:report -- <export.json> [...]');
  process.exit(1);
}
const events: TelemetryEvent[] = files.flatMap((f) => JSON.parse(readFileSync(f, 'utf8')) as TelemetryEvent[]);
const date = new Date().toISOString().slice(0, 10);
const md = summarize(events, `Telemetry report ${date} (${files.length} file${files.length > 1 ? 's' : ''})`);
mkdirSync('reports', { recursive: true });
const out = `reports/telemetry-${date}.md`;
writeFileSync(out, md + '\n');
console.log(md);
console.log(`→ ${out}`);

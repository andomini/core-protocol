// Post-build checks, run after every `vite build` (adapted from Merge Wall and Last Tower's
// check-portal-builds/size): exits 1 on any problem.
//  1. size: initial download ≤ 1 MB (spec B8), measured as transfer bytes — text files gzipped (level 9),
//     binaries (woff2) as-is; raw bytes are printed next to it. Lazy chunks only some sessions load
//     (the telemetry overlay) are listed but not counted.
//  2. exactly one SDK: the portal's own SDK tag once in index.html and its adapter in the JS; no other
//     portal's name, SDK URL or adapter; the local build has none.
//  3. no dev-only code (window.__cp hooks, dev flags, the fake-ad overlay in portal builds).
//  4. relative paths only (portals serve the build from arbitrary sub-paths).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { gzipSync } from 'node:zlib';

const portal = process.env.VITE_PORTAL ?? 'local';
const DIST = `dist/${portal}`;
export const BUDGET = 1024 * 1024;

const SDK = {
  crazygames: { tag: /<script src="https:\/\/sdk\.crazygames\.com\/crazygames-sdk-v3\.js"><\/script>/g, adapter: [/requestAd/, /loadingStop/, /hasAdblock/] },
  poki: { tag: /<script src="https:\/\/game-cdn\.poki\.com\/scripts\/v2\/poki-sdk\.js"><\/script>/g, adapter: [/commercialBreak/, /rewardedBreak/, /gameLoadingFinished/] },
};
const BRANDS = {
  crazygames: [/crazy\s*games/i, /sdk\.crazygames\.com/i, /hasAdblock/],
  poki: [/\bpoki/i, /PokiSDK/, /gameLoadingFinished/, /commercialBreak/],
};
const DEV_ONLY = [/__cp\b/, /installDevHooks/, /unlockall/, /coreHealth/, /enemyHpMul/, /midgame=always|"always"/, /get\("portal"\)/];
const LOCAL_ONLY = [/Close early \(no reward\)/, /fake-ad/, /\[local\]/, /get\("ads"\)/];
/** Chunks fetched only on demand (not part of the initial download). */
const DEFERRED = [/^assets\/DevOverlay-/];

const files = (dir) =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : [p];
  });

const TEXT = /\.(js|css|html|json|svg|txt|map)$/;
const rows = [];
const problems = [];
let raw = 0;
let gz = 0;
let deferredGz = 0;
let js = '';

for (const f of files(DIST)) {
  const rel = relative(DIST, f).split('\\').join('/');
  const buf = readFileSync(f);
  const isText = TEXT.test(f);
  const z = isText ? gzipSync(buf, { level: 9 }).length : buf.length;
  const deferred = DEFERRED.some((re) => re.test(rel)) || /^fonts\/OFL-/.test(rel);
  rows.push([rel, buf.length, z, deferred]);
  if (deferred) deferredGz += z;
  else {
    raw += buf.length;
    gz += z;
  }
  if (!isText) continue;
  const src = buf.toString('utf8');
  if (rel.endsWith('.js') || rel.endsWith('.html')) js += src + '\n';
  for (const re of DEV_ONLY) if (re.test(src)) problems.push(`${rel} contains dev-only code (${re})`);
  if (portal !== 'local') for (const re of LOCAL_ONLY) if (re.test(src)) problems.push(`${rel} contains the local fake-ad portal (${re})`);
  for (const [brand, patterns] of Object.entries(BRANDS)) {
    if (brand === portal) continue;
    for (const re of patterns) if (re.test(src)) problems.push(`${rel} mentions "${brand}" (${re})`);
  }
}

const html = readFileSync(join(DIST, 'index.html'), 'utf8');
for (const [name, s] of Object.entries(SDK)) {
  const tags = html.match(s.tag)?.length ?? 0;
  const want = name === portal ? 1 : 0;
  if (tags !== want) problems.push(`index.html has ${tags} ${name} SDK tag(s), expected ${want}`);
  if (name === portal) for (const re of s.adapter) if (!re.test(js)) problems.push(`the ${name} adapter is missing (${re})`);
}
const absolute = [...html.matchAll(/(?:src|href)="(\/[^"]*)"/g)].map((m) => m[1]);
if (absolute.length) problems.push(`index.html has absolute paths: ${absolute.join(', ')}`);
for (const m of js.matchAll(/["'(]\/assets\//g)) problems.push(`absolute /assets/ reference in JS: …${js.slice(m.index - 20, m.index + 30)}…`);

const kb = (n) => `${(n / 1024).toFixed(1).padStart(8)} KB`;
rows.sort((a, b) => b[1] - a[1]);
console.log(`\nBuild for portal: ${portal}`);
for (const [name, r, z, d] of rows) console.log(`${kb(r)}  ${kb(z)} gz  ${name}${d ? '  (deferred)' : ''}`);
console.log(`${kb(raw)}  ${kb(gz)} gz  INITIAL DOWNLOAD (budget ${(BUDGET / 1048576).toFixed(0)} MB transfer; deferred ${kb(deferredGz).trim()} gz)`);

if (gz > BUDGET) problems.push(`initial download is ${(gz / 1048576).toFixed(2)} MB transfer, over the 1 MB budget (B8)`);
if (problems.length) {
  console.error('\nPost-build check FAILED:\n  ' + problems.join('\n  '));
  process.exit(1);
}
console.log('Post-build checks passed.');

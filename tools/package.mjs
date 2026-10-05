// Zips each portal build (dist/<portal>/) into dist/core-protocol-<portal>.zip for upload (from Merge
// Wall). Minimal ZIP writer (deflate) using only Node built-ins; deterministic (fixed dates, sorted).
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { crc32, deflateRawSync } from 'node:zlib';

const files = (dir) =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : [p];
  });

const DOS_DATE = (0 << 9) | (1 << 5) | 1; // 1980-01-01 (0 is not a valid DOS date)

function zip(dir, out) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const f of files(dir).sort()) {
    const name = Buffer.from(relative(dir, f).split('\\').join('/'));
    const data = readFileSync(f);
    const comp = deflateRawSync(data, { level: 9 });
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(0, 10); // time 00:00
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comp.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(comp.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, comp);
    centrals.push(central, name);
    offset += local.length + name.length + comp.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(centrals.length / 2, 8);
  end.writeUInt16LE(centrals.length / 2, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  const buf = Buffer.concat([...locals, cd, end]);
  writeFileSync(out, buf);
  return { bytes: buf.length, files: centrals.length / 2 };
}

let made = 0;
for (const portal of ['crazygames', 'poki']) {
  const dir = `dist/${portal}`;
  if (!existsSync(join(dir, 'index.html'))) {
    console.error(`${dir}/index.html missing: run npm run build:${portal} first`);
    process.exitCode = 1;
    continue;
  }
  const out = `dist/core-protocol-${portal}.zip`;
  const z = zip(dir, out);
  made++;
  console.log(`${out}  ${(z.bytes / 1024).toFixed(1)} KB, ${z.files} files`);
}
if (made === 0) process.exitCode = 1;

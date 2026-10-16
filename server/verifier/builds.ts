// Ranked builds: the Worker accepts runs only from commits registered here (POST /v1/admin/builds), so a dev,
// dirty or forked build cannot fill the verifier queue. Register every commit you deploy to a portal.
//
//   set -a; . server/verifier/verifier.env; set +a
//   npx tsx server/verifier/builds.ts add [commit|HEAD] [note…]   # default HEAD; must be pushed
//   npx tsx server/verifier/builds.ts retire <commit>             # stop ranking an old build
//   npx tsx server/verifier/builds.ts list
import { spawnSync } from 'node:child_process';

function resolveCommit(ref: string): string {
  if (/^[0-9a-f]{40}$/.test(ref)) return ref;
  const r = spawnSync('git', ['rev-parse', '--verify', `${ref}^{commit}`], { encoding: 'utf8' });
  const sha = r.stdout.trim();
  if (r.status !== 0 || !/^[0-9a-f]{40}$/.test(sha)) throw new Error(`not a commit: ${ref}`);
  return sha;
}

async function main(): Promise<void> {
  const base = (process.env.LB_URL ?? '').replace(/\/+$/, '');
  const token = process.env.ADMIN_TOKEN ?? '';
  if (!base || !token) throw new Error('LB_URL and ADMIN_TOKEN must be set (server/verifier/verifier.env)');
  const [cmd = 'list', ref, ...rest] = process.argv.slice(2);
  let body: Record<string, unknown> | undefined;
  if (cmd === 'add') {
    const commit = resolveCommit(ref ?? 'HEAD');
    const dirty = spawnSync('git', ['status', '--porcelain', '--untracked-files=no'], { encoding: 'utf8' }).stdout.trim();
    if (!ref && dirty) process.stderr.write('warning: the working tree is dirty; builds from it are -dirty and never ranked\n');
    body = { commit, retired: false, ...(rest.length ? { note: rest.join(' ') } : {}) };
  } else if (cmd === 'retire') {
    if (!ref) throw new Error('usage: builds.ts retire <commit>');
    body = { commit: resolveCommit(ref), retired: true };
  } else if (cmd !== 'list') {
    throw new Error('usage: builds.ts add [commit] [note] | retire <commit> | list');
  }
  const res = await fetch(`${base}/v1/admin/builds`, {
    method: body ? 'POST' : 'GET',
    headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  const { builds } = JSON.parse(text) as { builds: { commit: string; note: string | null; addedAt: number; retiredAt: number | null }[] };
  for (const b of builds) {
    process.stdout.write(`${b.commit.slice(0, 12)}  ${new Date(b.addedAt).toISOString().slice(0, 10)}  ${b.retiredAt === null ? 'ranked ' : 'retired'}  ${b.note ?? ''}\n`);
  }
}

main().catch((e: unknown) => {
  process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});

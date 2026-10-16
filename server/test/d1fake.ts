// D1 stand-in for tests: the real migrations and SQL on node:sqlite (in memory).
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import type { D1Database, D1PreparedStatement, D1Result } from '../src/db';

const MIGRATIONS = join(import.meta.dirname, '..', 'migrations');

function val(v: unknown): SQLInputValue {
  if (v === undefined) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  return v as SQLInputValue;
}

export function fakeD1(): D1Database & { raw: DatabaseSync } {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  for (const f of readdirSync(MIGRATIONS).filter((x) => x.endsWith('.sql')).sort()) db.exec(readFileSync(join(MIGRATIONS, f), 'utf8'));
  const stmt = (sql: string, params: unknown[] = []): D1PreparedStatement & { exec(): D1Result } => {
    const exec = (): D1Result => {
      const s = db.prepare(sql);
      if (/^\s*(SELECT|WITH)|\bRETURNING\b/i.test(sql)) return { results: s.all(...params.map(val)) as Record<string, unknown>[], meta: {} };
      const r = s.run(...params.map(val));
      return { results: [], meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
    };
    return {
      bind: (...v: unknown[]) => stmt(sql, v),
      first: async <T>() => (exec().results[0] as T | undefined) ?? null,
      all: async <T>() => exec() as unknown as D1Result<T>,
      run: async () => exec(),
      exec,
    };
  };
  return {
    raw: db,
    prepare: (sql: string) => stmt(sql),
    batch: async (stmts: D1PreparedStatement[]) => {
      db.exec('BEGIN');
      try {
        const out = stmts.map((s) => (s as ReturnType<typeof stmt>).exec());
        db.exec('COMMIT');
        return out;
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
  };
}

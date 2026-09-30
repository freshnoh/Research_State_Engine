// 공용 DB 접근 (INTEGRATOR 소유). 모든 트랙은 openDb() 로 같은 방식으로 연다.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

export const SCHEMA_VERSION = '1';
const SCHEMA_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'schema.sql');

export function nowIso() {
  return new Date().toISOString();
}

export function openDb(dbPath) {
  if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON;');
  if (dbPath !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  migrate(db);
  return db;
}

export function migrate(db) {
  db.exec(fs.readFileSync(SCHEMA_FILE, 'utf8'));
  db.prepare('INSERT OR REPLACE INTO schema_meta(key, value) VALUES (?, ?)').run('schema_version', SCHEMA_VERSION);
}

// 여러 문장을 하나의 트랜잭션으로 실행
export function tx(db, fn) {
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export const parseJson = (s, d = null) => {
  if (s == null) return d;
  try { return JSON.parse(s); } catch { return d; }
};

// scaffold / schema / seed / health 검사
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../../src/db/index.js';
import { loadSeed } from '../../src/core/seed.js';
import { createApp } from '../../src/app.js';

const tmpDb = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rse-test-')), 'rse.db');

const REQUIRED_TABLES = ['research_attempt', 'evidence', 'judgment', 'judgment_attempt_link',
  'evidence_judgment_link', 'approval_action', 'action_run', 'crossref_cache', 'crossref_lookup_log'];

test('schema: 필수 테이블이 모두 생성된다', () => {
  const db = openDb(tmpDb());
  const names = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
  for (const t of REQUIRED_TABLES) assert.ok(names.includes(t), `missing table ${t}`);
});

test('db: read/write 가 실제 파일에 영속된다 (재오픈 후 유지)', () => {
  const file = tmpDb();
  let db = openDb(file);
  db.prepare(`INSERT INTO research_attempt (raw_text, result, created_at, source) VALUES (?, 'unknown', ?, 'live')`)
    .run('smoke', new Date().toISOString());
  db.close();
  db = openDb(file);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM research_attempt WHERE raw_text='smoke'").get().n, 1);
});

test('schema: enum 밖 값은 거부된다', () => {
  const db = openDb(tmpDb());
  assert.throws(() => db.prepare(`INSERT INTO evidence (input_doi, status, created_at, updated_at) VALUES ('x','absent','t','t')`).run());
  assert.throws(() => db.prepare(`INSERT INTO research_attempt (raw_text, result, created_at, source) VALUES ('x','done','t','live')`).run());
});

test('seed: RSE-01 같은 접근 2건, Aβ*56 근거=verified, 판단 연결 1, 재검토 0', () => {
  const db = openDb(tmpDb());
  loadSeed(db);
  const same = db.prepare(`SELECT COUNT(*) AS n FROM research_attempt
    WHERE target_norm='RSE-01' AND method_norm='western_blot' AND environment_norm='cell'`).get().n;
  assert.equal(same, 2);
  const ev = db.prepare("SELECT * FROM evidence WHERE input_doi='10.1038/nature04533'").get();
  assert.equal(ev.status, 'verified');
  const link = db.prepare('SELECT COUNT(*) AS n FROM evidence_judgment_link WHERE evidence_id=?').get(ev.id).n;
  assert.equal(link, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM judgment WHERE needs_review=1').get().n, 0);
  // 철회 논문의 현재 Crossref 응답은 baseline cache 에 넣지 않는다
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM crossref_cache WHERE doi='10.1038/nature04533'").get().n, 0);
});

test('seed: 비어 있지 않은 DB 에는 적재를 거부한다', () => {
  const db = openDb(tmpDb());
  loadSeed(db);
  assert.throws(() => loadSeed(db), /비어 있지 않음/);
});

test('http: /api/health 와 공용 읽기 API 가 실제 값을 반환한다', async () => {
  const { server, db } = createApp({ DB_PATH: tmpDb(), PORT: 0 });
  loadSeed(db);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const h = await (await fetch(`${base}/api/health`)).json();
    assert.equal(h.ok, true);
    assert.equal(h.counts.research_attempt, 7);
    const a = await (await fetch(`${base}/api/attempts`)).json();
    assert.equal(a.attempts.length, 7);
    const j = await (await fetch(`${base}/api/judgments`)).json();
    assert.equal(j.judgments[0].evidence[0].status, 'verified');
    assert.equal(j.judgments[0].evidence[0].input.journal, 'Nature');
    assert.equal(j.judgments[0].needs_review, false);
    const idx = await fetch(`${base}/`);
    assert.equal(idx.status, 200);
    const nf = await fetch(`${base}/api/nope`);
    assert.equal(nf.status, 404);
  } finally {
    server.close();
  }
});

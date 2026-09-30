// baseline 4값 검사기가 정상/오염 상태를 구분하는지
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../../src/db/index.js';
import { loadSeed } from '../../src/core/seed.js';
import { ORIGINAL_FIXTURE } from '../../src/approval/gate.js';
import { checkBaseline } from '../../scripts/baseline.js';

function fresh() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rse-bl-'));
  const dbPath = path.join(dir, 'rse.db');
  const db = openDb(dbPath);
  loadSeed(db);
  db.close();
  const orig = path.join(dir, 'original.csv');
  fs.copyFileSync(ORIGINAL_FIXTURE, orig);
  return { dbPath, orig };
}

test('baseline: seed 직후 4/4', () => {
  const { dbPath, orig } = fresh();
  const r = checkBaseline(dbPath, orig);
  assert.equal(r.total, 4);
  assert.equal(r.passed, 4);
  assert.equal(r.ok, true);
});

test('baseline: 시연 후 오염 상태(3건·철회·재검토·원본 변경)는 0/4', () => {
  const { dbPath, orig } = fresh();
  const db = openDb(dbPath);
  db.prepare(`INSERT INTO research_attempt (raw_text,target_norm,method_norm,environment_norm,result,created_at,source)
    VALUES ('x','RSE-01','western_blot','cell','stopped','t','live')`).run();
  db.prepare("UPDATE evidence SET status='retracted'").run();
  db.prepare('UPDATE judgment SET needs_review=1').run();
  db.close();
  fs.appendFileSync(orig, 'changed\n');
  const r = checkBaseline(dbPath, orig);
  assert.equal(r.passed, 0);
  assert.equal(r.ok, false);
});

test('baseline: 철회 논문 응답이 cache 에 있으면 시작 금지', () => {
  const { dbPath, orig } = fresh();
  const db = openDb(dbPath);
  db.prepare("INSERT INTO crossref_cache (doi, http_status, raw_json, fetched_at) VALUES ('10.1038/nature04533', 200, '{}', 't')").run();
  db.close();
  const r = checkBaseline(dbPath, orig);
  assert.equal(r.passed, 4);
  assert.equal(r.guard.pass, false);
  assert.equal(r.ok, false);
});

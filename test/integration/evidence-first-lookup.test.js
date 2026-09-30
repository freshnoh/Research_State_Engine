// 회귀: 신규 근거의 최초 판정은 "상태 변경" 으로 기록하지 않는다.
// 이미 조회 이력이 있는 근거의 실제 변화(확인 → 철회됨)는 그대로 기록한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ROOT, loadConfig } from '../../src/config.js';
import { openDb } from '../../src/db/index.js';
import { loadSeed } from '../../src/core/seed.js';
import { createEvidenceService } from '../../src/evidence/service.js';

const REC = path.join(ROOT, 'fixtures', 'evidence', 'recorded');
const recorded = { 'nature14539': 'nature14539.json', 'nature04533': 'nature04533.json' };
const fakeFetch = async (url) => {
  const key = Object.keys(recorded).find((k) => url.includes(k));
  if (!key) return new Response('Resource not found.', { status: 404 });
  return new Response(fs.readFileSync(path.join(REC, recorded[key]), 'utf8'), { status: 200 });
};

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rse-ev1-'));
  const db = openDb(path.join(dir, 'rse.db'));
  loadSeed(db);
  const config = loadConfig({ DB_PATH: path.join(dir, 'rse.db'), DATA_DIR: dir });
  return { db, svc: createEvidenceService({ db, config, fetch: fakeFetch }) };
}

test('신규 정상 근거 최초 조회 → verified, previous_status 없음', async () => {
  const { db, svc } = setup();
  const r = await svc.registerEvidence({ doi: '10.1038/nature14539', title: 'Deep learning', authors: ['LeCun', 'Bengio', 'Hinton'], year: 2015 });
  const row = db.prepare('SELECT status, previous_status, status_changed_at FROM evidence WHERE id=?').get(r.evidence.id);
  assert.equal(row.status, 'verified');
  assert.equal(row.previous_status, null);
  assert.equal(row.status_changed_at, null);
});

test('기존 확인 근거(seed Aβ*56) 재검사 → 확인 → 철회됨 변경 기록 유지', async () => {
  const { db, svc } = setup();
  const ev = db.prepare("SELECT id FROM evidence WHERE input_doi='10.1038/nature04533'").get();
  await svc.recheck({ evidence_ids: [ev.id] });
  const row = db.prepare('SELECT status, previous_status, status_changed_at FROM evidence WHERE id=?').get(ev.id);
  assert.equal(row.status, 'retracted');
  assert.equal(row.previous_status, 'verified');
  assert.ok(row.status_changed_at);
});

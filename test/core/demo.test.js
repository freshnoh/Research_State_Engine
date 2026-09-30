// 발표 초기화(시연 전용) — 보호 조건 · baseline 복원 · 사후 검사 · 정상 재시작 영속성
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../../src/db/index.js';
import { loadSeed } from '../../src/core/seed.js';
import { createApp } from '../../src/app.js';
import { sha256File, ORIGINAL_FIXTURE, REPLACEMENT_FIXTURE } from '../../src/approval/gate.js';
import { checkBaseline, baselineDbPath } from '../../src/core/baseline.js';

// 임시 DATA_DIR 에 baseline 사본(seed) + 그 사본에서 시작한 DB + 원본 파일을 만든다
function setup({ demo = '1', mutateBaseline } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rse-demo-'));
  const cfg = { DATA_DIR: dir, DB_PATH: path.join(dir, 'rse.db'), APPROVAL_DIR: path.join(dir, 'approval'), DEMO_MODE: demo };
  const base = baselineDbPath({ dataDir: dir });
  fs.mkdirSync(path.dirname(base), { recursive: true });
  const b = openDb(base);
  loadSeed(b);
  if (mutateBaseline) mutateBaseline(b);
  b.exec('PRAGMA wal_checkpoint(TRUNCATE);');
  b.close();
  fs.copyFileSync(base, cfg.DB_PATH);
  fs.mkdirSync(cfg.APPROVAL_DIR, { recursive: true });
  fs.copyFileSync(ORIGINAL_FIXTURE, path.join(cfg.APPROVAL_DIR, 'original_measurements.csv'));
  return { dir, cfg, orig: path.join(cfg.APPROVAL_DIR, 'original_measurements.csv') };
}

// 시연 후 상태로 오염: live 시도 · 철회 · 재검토 · 철회 논문 cache · 조회 로그 · 승인/분석 기록 · 원본 파일 변경
function pollute(db, orig) {
  db.prepare(`INSERT INTO research_attempt (raw_text,target_norm,method_norm,environment_norm,result,created_at,source,extractor)
    VALUES ('live','RSE-01','western_blot','cell','stopped','t','live','llm:claude-cli')`).run();
  db.prepare("UPDATE evidence SET status='retracted', previous_status='verified', status_changed_at='t' WHERE input_doi='10.1038/nature04533'").run();
  db.prepare("UPDATE judgment SET needs_review=1, review_reason='r', review_flagged_at='t'").run();
  db.prepare("INSERT INTO crossref_cache (doi,http_status,raw_json,fetched_at) VALUES ('10.1038/nature04533',200,'{}','t')").run();
  db.prepare("INSERT INTO crossref_lookup_log (doi,mode,ok,http_status,at) VALUES ('10.1038/nature04533','fresh',1,200,'t')").run();
  db.prepare(`INSERT INTO approval_action (action_type,description,reason,rule_id,target_path,status,hash_before,hash_after,created_at)
    VALUES ('overwrite_original','d','r','R','p','approved','a','b','t')`).run();
  db.prepare("INSERT INTO action_run (action_type,description,rule_id,status,created_at) VALUES ('run_analysis','d','R','completed','t')").run();
  fs.copyFileSync(REPLACEMENT_FIXTURE, orig);
}

function snapshot(db, orig) {
  const n = (t) => db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n;
  return {
    attempts: n('research_attempt'), approvals: n('approval_action'), runs: n('action_run'), cache: n('crossref_cache'), log: n('crossref_lookup_log'),
    retracted: db.prepare("SELECT COUNT(*) AS n FROM evidence WHERE status='retracted'").get().n,
    review: db.prepare('SELECT COUNT(*) AS n FROM judgment WHERE needs_review=1').get().n,
    hash: sha256File(orig),
  };
}

async function listen(app) {
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  return { base, close: () => new Promise((r) => app.server.close(r)) };
}
const RESET = { method: 'POST', headers: { 'content-type': 'application/json', 'x-rse-demo': 'reset' }, body: '{}' };

test('demo: DEMO_MODE 꺼짐 → 라우트 없음(404) · health demo_mode=false · DB/파일 변화 0', async () => {
  const { cfg, orig } = setup({ demo: '0' });
  const app = createApp(cfg);
  pollute(app.db, orig);
  const before = snapshot(app.db, orig);
  const s = await listen(app);
  try {
    assert.equal((await (await fetch(`${s.base}/api/health`)).json()).demo_mode, false);
    assert.equal(app.router.match('POST', '/api/demo/reset'), null);
    assert.equal((await fetch(`${s.base}/api/demo/reset`, RESET)).status, 404);
    assert.deepEqual(snapshot(app.db, orig), before);
  } finally { await s.close(); }
});

test('demo: 루프백이 아닌 peer 는 거부 (X-Forwarded-For 로 우회 불가) · DB/파일 변화 0', async () => {
  const { cfg, orig } = setup();
  const app = createApp(cfg);
  pollute(app.db, orig);
  const before = snapshot(app.db, orig);
  const hit = app.router.match('POST', '/api/demo/reset');
  assert.ok(hit, 'DEMO_MODE=1 이면 라우트 존재');
  for (const remoteAddress of ['10.0.0.5', '192.168.0.10', '172.20.0.1', '::ffff:10.0.0.5', '2001:db8::1', undefined]) {
    const req = { socket: { remoteAddress }, headers: { 'x-rse-demo': 'reset', 'x-forwarded-for': '127.0.0.1', host: '127.0.0.1' } };
    await assert.rejects(async () => hit.handler({ req, ctx: { db: app.db, config: app.config } }), (e) => e.status === 403 && e.code === 'LOCAL_ONLY', String(remoteAddress));
  }
  assert.deepEqual(snapshot(app.db, orig), before);
});

test('demo: POST 이외 method · 전용 헤더 없는 POST → 실행 0 · DB/파일 변화 0', async () => {
  const { cfg, orig } = setup();
  const app = createApp(cfg);
  pollute(app.db, orig);
  const before = snapshot(app.db, orig);
  const s = await listen(app);
  try {
    for (const method of ['GET', 'PUT', 'DELETE', 'PATCH']) {
      assert.equal((await fetch(`${s.base}/api/demo/reset`, { method })).status, 404, method);
    }
    const noHeader = await fetch(`${s.base}/api/demo/reset`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '' });
    assert.equal(noHeader.status, 403);
    assert.deepEqual(snapshot(app.db, orig), before);
  } finally { await s.close(); }
});

test('demo: 오염 상태 → 초기화 → DB·파일이 baseline 과 일치 (4/4 · live 0 · 행 수 · id 순번) · 반복 가능', async () => {
  const { cfg, orig } = setup();
  const app = createApp(cfg);
  const s = await listen(app);
  try {
    const clean = snapshot(app.db, orig);
    for (let round = 1; round <= 3; round++) {
      pollute(app.db, orig);
      assert.equal(checkBaseline(cfg.DB_PATH, orig).passed, 0, `round ${round} 오염 확인`);
      const res = await fetch(`${s.base}/api/demo/reset`, RESET);
      const body = await res.json();
      assert.equal(res.status, 200, JSON.stringify(body));
      assert.equal(body.ok, true);
      assert.equal(body.baseline.passed, 4);
      assert.equal(body.baseline.total, 4);
      const r = checkBaseline(cfg.DB_PATH, orig);
      assert.equal(r.ok, true, `round ${round} 독립 재검사`);
      assert.deepEqual(snapshot(app.db, orig), clean);
      assert.equal(sha256File(orig), sha256File(ORIGINAL_FIXTURE));
      assert.equal(app.db.prepare("SELECT COUNT(*) AS n FROM research_attempt WHERE source='live'").get().n, 0);
      assert.equal(fs.existsSync(`${orig}.reset-tmp`), false);
      // 초기화 뒤 새 시도 id 는 baseline 사본 기준 순번에서 이어진다
      const maxSeed = app.db.prepare('SELECT MAX(id) AS m FROM research_attempt').get().m;
      const id = Number(app.db.prepare("INSERT INTO research_attempt (raw_text,result,created_at,source) VALUES ('probe','unknown','t','live')").run().lastInsertRowid);
      assert.equal(id, maxSeed + 1);
      app.db.prepare('DELETE FROM research_attempt WHERE id=?').run(id);
    }
  } finally { await s.close(); }
});

test('demo: 사후 검사가 틀리면 성공으로 응답하지 않는다 (baseline 사본 자체가 오염된 경우)', async () => {
  const { cfg, orig } = setup({ mutateBaseline: (b) => b.prepare('UPDATE judgment SET needs_review=1').run() });
  const app = createApp(cfg);
  const s = await listen(app);
  try {
    const res = await fetch(`${s.base}/api/demo/reset`, RESET);
    const body = await res.json();
    assert.equal(res.status, 500);
    assert.equal(body.ok, false);
    assert.equal(body.error.code, 'RESET_POSTCHECK_FAILED');
    assert.match(body.error.message, /재검토 표시 판단 수/);
  } finally { await s.close(); }
});

test('demo: 초기화를 호출하지 않은 정상 재시작은 데이터를 유지 (DEMO_MODE=1 이어도 자동 초기화 없음)', async () => {
  const { cfg, orig } = setup();
  let app = createApp(cfg);
  pollute(app.db, orig);
  const before = snapshot(app.db, orig);
  app.db.close();
  app = createApp(cfg);
  const s = await listen(app);
  try {
    assert.equal((await (await fetch(`${s.base}/api/health`)).json()).demo_mode, true);
    assert.deepEqual(snapshot(app.db, orig), before);
    assert.equal(before.attempts > 0 && before.retracted === 1 && before.review === 1, true);
  } finally { await s.close(); }
});

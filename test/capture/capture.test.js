// 발화 분류 / 구조화 / G1 자동 축적 / G2 재사용 — 외부 LLM 없이 실제 SQLite 값으로 검사
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from '../../src/db/index.js';
import { loadSeed } from '../../src/core/seed.js';
import { createApp } from '../../src/app.js';
import { NO_PATH_MESSAGE } from '../../src/contract/enums.js';
import { classifyUtterance } from '../../src/capture/classify.js';
import { normTarget, normMethod, normEnvironment, normCondition, normStopStage } from '../../src/capture/dict.js';
import { rulesExtract, createExtractor, claudeCliExtractor, parseCliOutput } from '../../src/capture/extract.js';
import { handleChat } from '../../src/capture/service.js';
import { analyzeApproach } from '../../src/capture/approach.js';

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'fixtures', 'capture', 'cli');
const fixture = (f) => fs.readFileSync(path.join(FIX, f), 'utf8');
const tmpDb = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rse-capture-')), 'rse.db');
const seeded = () => { const db = openDb(tmpDb()); loadSeed(db); return db; };
const count = (db) => db.prepare('SELECT COUNT(*) AS n FROM research_attempt').get().n;
const sameCount = (db, t = 'RSE-01', m = 'western_blot', e = 'cell') => db.prepare(
  'SELECT COUNT(*) AS n FROM research_attempt WHERE target_norm=? AND method_norm=? AND environment_norm=?').get(t, m, e).n;

const LIVE = '오늘 후보 단백질 RSE-01을 세포 모델에서 Western blot으로 측정했고, 재현성 검증 단계에서 중단했습니다.';
const rules = async (t) => rulesExtract(t); // 외부 LLM 없는 추출기 주입
const ctxOf = (db, extractor = rules) => ({ db, extractor });

test('classify: 종류별 발화가 기대 종류로 분류된다', () => {
  const cases = [
    [LIVE, 'execution'],
    ['RSE-01을 1 µM, 24시간 처리 후 세포에서 Western blot으로 측정했다.', 'execution'],
    ['DS-17 데이터셋으로 회귀 분석을 돌렸고 성공했다.', 'execution'],
    ['RSE-01을 세포 모델에서 Western blot으로 다시 해보려 합니다.', 'plan'],
    ['내일 RSE-01 qPCR을 할 예정입니다.', 'plan'],
    ['RSE-01을 세포 모델에서 Western blot으로 다시 해도 될까요?', 'question'],
    ['RSE-01 Western blot 세포에서 몇 번 시도했나요?', 'question'],
    ['RSE-01은 세포에서 재현성 문제가 있을 것 같습니다.', 'hypothesis'],
    ['RSE-01이 세포 모델에서 억제된다는 가설을 세웠다.', 'hypothesis'],
    ['RSE-01 Western blot 세포', 'other'],
    ['RSE-01을 Western blot으로 측정하지 않았습니다.', 'other'],
    ['안녕하세요', 'other'],
    ['측정했고 다음에 다시 해보려 합니다', 'other'], // 실행+계획 혼합 → 불명확 → 저장 안 함
  ];
  let pass = 0;
  for (const [t, kind] of cases) { assert.equal(classifyUtterance(t).kind, kind, t); pass++; }
  assert.equal(pass, cases.length);
});

test('dict: CONTRACT §6.2 최소 사전 정규화', () => {
  for (const r of ['RSE-01', 'rse-01', 'RSE01']) assert.equal(normTarget(r), 'RSE-01');
  for (const r of ['Western blot', '웨스턴 블롯', 'WB']) assert.equal(normMethod(r), 'western_blot');
  for (const r of ['qPCR', '정량 PCR']) assert.equal(normMethod(r), 'qpcr');
  assert.equal(normMethod('ELISA'), 'elisa');
  for (const r of ['세포', '세포 모델', 'cell']) assert.equal(normEnvironment(r), 'cell');
  for (const r of ['시험관', 'in vitro']) assert.equal(normEnvironment(r), 'in_vitro');
  for (const r of ['동물', '마우스', '쥐']) assert.equal(normEnvironment(r), 'animal');
  assert.equal(normEnvironment('오가노이드'), null); // 사전 밖 → 추측하지 않고 NULL
  for (const r of ['재현성 검증', '재현성 확인', '재현성 검증 단계']) assert.equal(normStopStage(r), 'reproducibility_validation');
  assert.equal(normStopStage('행동검증'), 'behavioral_validation');
  assert.equal(normCondition('1 µM, 24시간'), '1 uM; 24 h');
  assert.equal(normTarget(null), null);
});

test('extract(rules): 라이브 문장 → target/method/environment/result/stop_stage, condition 미상', () => {
  const f = rulesExtract(LIVE).fields;
  assert.deepEqual(f, { target: 'RSE-01', method: 'Western blot', environment: '세포 모델', condition: null, result: 'stopped', stop_stage: '재현성 검증' });
});

test('extract(claude-cli): fixture 응답 파싱 (clean / 코드펜스 / 앞뒤 문장) 과 stop_stage "단계" 접미 제거', async () => {
  for (const f of ['clean.json', 'fenced.json', 'prose_wrapped.json']) {
    const ex = claudeCliExtractor({ run: async () => fixture(f) });
    const r = await ex(LIVE);
    assert.equal(r.extractor, 'llm:claude-cli', f);
    assert.deepEqual(r.fields, { target: 'RSE-01', method: 'Western blot', environment: '세포 모델', condition: null, result: 'stopped', stop_stage: '재현성 검증' }, f);
  }
});

test('extract(claude-cli): 원문에 없는 LLM 값(환각)은 버려 null 이 된다', async () => {
  const r = await claudeCliExtractor({ run: async () => fixture('hallucinated.json') })(LIVE);
  assert.equal(r.fields.environment, null); // 원문엔 '세포 모델' 인데 LLM 이 '동물' 이라 함
  assert.equal(r.fields.condition, null);
  assert.equal(r.fields.target, 'RSE-01');
});

test('extract(claude-cli): 오류/비JSON 응답은 예외 → createExtractor 가 rules 로 내려가되 fallback 사유를 남긴다', async () => {
  assert.throws(() => parseCliOutput(fixture('is_error.json')), /is_error/);
  assert.throws(() => parseCliOutput(fixture('not_json.txt')), /JSON/);
  for (const run of [async () => fixture('is_error.json'), async () => fixture('not_json.txt'), async () => { throw new Error('spawn ENOENT'); }]) {
    const r = await createExtractor('claude-cli', { run })(LIVE);
    assert.equal(r.extractor, 'rules');
    assert.match(r.fallback, /claude-cli 실패/);
    assert.equal(r.fields.target, 'RSE-01');
  }
  assert.equal((await createExtractor('rules')(LIVE)).extractor, 'rules');
});

test('G1: baseline 같은 접근 2 → execution 입력 → DB 3, 원문·구조화·approach_key 저장, 자동 기록 응답이 저장값에서 생성', async () => {
  const db = seeded();
  assert.equal(sameCount(db), 2);
  const before = count(db);
  const res = await handleChat(ctxOf(db), LIVE);
  assert.equal(res.kind, 'execution');
  assert.equal(res.saved, true);
  assert.equal(count(db), before + 1);
  assert.equal(sameCount(db), 3);

  const row = db.prepare('SELECT * FROM research_attempt WHERE id = ?').get(res.attempt.id);
  assert.equal(row.raw_text, LIVE);
  assert.deepEqual(
    [row.target_raw, row.target_norm, row.method_raw, row.method_norm, row.environment_raw, row.environment_norm, row.condition_raw, row.condition_norm, row.result, row.stop_stage_raw, row.stop_stage_norm, row.source, row.is_synthetic, row.extractor],
    ['RSE-01', 'RSE-01', 'Western blot', 'western_blot', '세포 모델', 'cell', null, null, 'stopped', '재현성 검증', 'reproducibility_validation', 'live', 0, 'rules']);
  assert.ok(row.created_at && row.occurred_at); // '오늘' → occurred_at
  assert.equal(res.attempt.approach_key, 'RSE-01|western_blot|cell');
  assert.equal(res.auto_record_line, '자동 기록됨 — 대상 RSE-01 / 방법 Western blot / 환경 세포 / 결과 중단');
  assert.equal(res.approach.same_count, 3);

  // 응답 문구가 하드코딩이 아님: 같은 라이브 문장의 environment 표기만 바꾸면 줄도 바뀐다
  const r2 = await handleChat(ctxOf(db), LIVE.replace('세포 모델', '시험관'));
  assert.match(r2.auto_record_line, /환경 시험관 \/ 결과 중단$/);
});

test('G1: plan / question / hypothesis / other 는 research_attempt 증가 0', async () => {
  const db = seeded();
  const before = count(db);
  const inputs = {
    plan: 'RSE-01을 세포 모델에서 Western blot으로 다시 해보려 합니다.',
    question: 'RSE-01을 세포 모델에서 Western blot으로 다시 해도 될까요?',
    hypothesis: 'RSE-01은 세포 모델에서 재현성 문제가 있을 것 같습니다.',
    other: 'RSE-01 Western blot 세포 모델',
  };
  let pass = 0;
  for (const [kind, text] of Object.entries(inputs)) {
    const res = await handleChat(ctxOf(db), text);
    assert.equal(res.kind, kind);
    assert.equal(res.saved, false);
    assert.equal(res.attempt, null);
    assert.equal(count(db), before, `${kind} 이후 attempt 수`);
    pass++;
  }
  assert.equal(pass, 4);
});

test('G1: 저장 확인/버튼 없이 한 번의 호출로 저장된다 (호출 1회 = 저장 1건)', async () => {
  const db = seeded();
  const before = count(db);
  await handleChat(ctxOf(db), LIVE);
  assert.equal(count(db), before + 1);
});

test('G1: 대상·방법·환경 중 하나라도 미상 → 저장은 되지만 approach_key null, 같은 접근 count 에 포함되지 않음', async () => {
  const db = seeded();
  const cases = [
    ['RSE-01을 Western blot으로 측정했고 재현성 검증 단계에서 중단했습니다.', 'environment'],
    ['RSE-01을 세포에서 측정했고 재현성 검증 단계에서 중단했습니다.', 'method'],
    ['세포에서 Western blot으로 측정했고 재현성 검증 단계에서 중단했습니다.', 'target'],
  ];
  let pass = 0;
  for (const [text, missing] of cases) {
    const res = await handleChat(ctxOf(db), text);
    assert.equal(res.saved, true, missing);
    assert.equal(res.attempt.approach_key, null, missing);
    assert.equal(res.attempt[missing].norm, null, missing);
    assert.equal(res.approach.match, 'undetermined', missing);
    assert.equal(res.approach.same_count, 0, missing);
    pass++;
  }
  assert.equal(pass, 3);
  assert.equal(sameCount(db), 2); // 미상 시도는 같은 접근 2건을 3건으로 만들지 않는다
});

test('approach: exact_repeat / adjacent / undetermined / same 을 실제 DB 로 판정한다', async () => {
  const db = seeded();
  // exact_repeat: 시드 #1(RSE-01/WB/cell, "1 uM; 24 h") 과 조건까지 동일
  const rep = await handleChat(ctxOf(db), 'RSE-01을 1 µM, 24시간 처리 후 세포에서 Western blot으로 측정했고 재현성 검증 단계에서 중단했다.');
  assert.equal(rep.attempt.condition.norm, '1 uM; 24 h');
  assert.equal(rep.approach.same_count, 3);
  assert.deepEqual(rep.approach.exact_repeat_ids, [1]);
  assert.equal(rep.approach.exact_repeat_text, '조건까지 동일한 시도가 있습니다');

  // 조건이 다르면 exact_repeat 아님 (같은 접근의 변주)
  const varr = await handleChat(ctxOf(db), 'RSE-01을 9 µM, 72시간 처리 후 세포에서 Western blot으로 측정했고 재현성 검증 단계에서 중단했다.');
  assert.deepEqual(varr.approach.exact_repeat_ids, []);
  assert.equal(varr.approach.same_count, 4);

  const a = analyzeApproach(db, { target: 'RSE-01', method: 'western_blot', environment: 'cell' });
  // adjacent: 대상·환경 동일, 방법 상이 (시드 qPCR)
  const qpcr = db.prepare("SELECT id FROM research_attempt WHERE method_norm='qpcr' AND target_norm='RSE-01'").get().id;
  assert.deepEqual(a.adjacent_ids, [qpcr]);
  // undetermined: 환경 미상 시드 (아는 칸은 일치)
  const unk = db.prepare("SELECT id FROM research_attempt WHERE target_norm='RSE-01' AND environment_norm IS NULL").get().id;
  assert.deepEqual(a.undetermined_ids, [unk]);
  assert.ok(!a.same_attempt_ids.includes(unk) && !a.same_attempt_ids.includes(qpcr));
  assert.equal(a.match, 'same');
  // 키에 미상이 있으면 same 확정 금지
  const u = analyzeApproach(db, { target: 'RSE-01', method: 'western_blot', environment: null });
  assert.equal(u.match, 'undetermined');
  assert.equal(u.same_count, 0);
});

test('G2: 저장된 3건을 다시 읽어 count / attempt_ids / stop_stage / common_stop_stage / 문구를 계산한다', async () => {
  const db = seeded();
  await handleChat(ctxOf(db), LIVE);
  const a = analyzeApproach(db, { target: 'RSE-01', method: 'western_blot', environment: 'cell' });
  const ids = db.prepare("SELECT id FROM research_attempt WHERE target_norm='RSE-01' AND method_norm='western_blot' AND environment_norm='cell' ORDER BY id").all().map((r) => r.id);
  assert.equal(a.same_count, 3);
  assert.deepEqual(a.same_attempt_ids, ids);
  assert.deepEqual(a.stop_stages.map((s) => [s.norm, s.attempt_ids]), [['reproducibility_validation', ids]]);
  assert.deepEqual(a.common_stop_stage, { norm: 'reproducibility_validation', raw: '재현성 검증', all_same: true });
  assert.equal(a.text, '이 접근은 3번 시도됐고 모두 재현성 검증 단계에서 멈췄습니다');
});

test('G2: 값이 코드에 고정돼 있지 않다 — DB 를 바꾸면 count/문구/all_same 이 따라 바뀐다', async () => {
  const db = seeded();
  await handleChat(ctxOf(db), LIVE);
  // 세 번째 시도의 중단 단계를 다르게 저장
  const diff = await handleChat(ctxOf(db), LIVE.replace('재현성 검증', '행동검증'));
  const a = analyzeApproach(db, { target: 'RSE-01', method: 'western_blot', environment: 'cell' });
  assert.equal(a.same_count, 4);
  assert.equal(a.common_stop_stage.all_same, false);
  assert.equal(a.common_stop_stage.norm, null);
  assert.equal(a.text, '이 접근은 4번 시도됐습니다 (재현성 검증 3건, 행동검증 1건)');
  assert.equal(diff.approach.same_count, 4);
  // 단계 기록이 없는 same 시도가 섞이면 all_same=false
  db.prepare("UPDATE research_attempt SET stop_stage_norm=NULL, stop_stage_raw=NULL WHERE id=1").run();
  assert.equal(analyzeApproach(db, { target: 'RSE-01', method: 'western_blot', environment: 'cell' }).common_stop_stage.all_same, false);
  // 같은 접근이 0건이면 0건이라고 말한다
  assert.equal(analyzeApproach(db, { target: 'ZZ-9', method: 'elisa', environment: 'cell' }).text, '저장된 같은 접근 시도가 없습니다');
});

test('question: attempt 저장 0, 저장된 시도 재사용(attempt_ids), 판단·시도 link 저장, 근거 없으면 NO_PATH_MESSAGE', async () => {
  const db = seeded();
  await handleChat(ctxOf(db), LIVE); // 3건
  const before = count(db);
  const jBefore = db.prepare('SELECT COUNT(*) AS n FROM judgment').get().n;
  const res = await handleChat(ctxOf(db), 'RSE-01을 세포 모델에서 Western blot으로 다시 해도 될까요?');
  assert.equal(res.kind, 'question');
  assert.equal(res.saved, false);
  assert.equal(count(db), before);
  assert.equal(res.answer.tried.count, 3);
  assert.equal(res.answer.tried.text, '이 접근은 3번 시도됐고 모두 재현성 검증 단계에서 멈췄습니다');
  assert.equal(res.answer.tried.match, 'same');
  assert.equal(res.answer.tried.stop_stage, '재현성 검증');
  assert.equal(res.answer.next.text, NO_PATH_MESSAGE);
  assert.equal(res.answer.next.grounded, false);
  assert.deepEqual(res.answer.evidence.items, []);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM judgment').get().n, jBefore + 1);
  const linked = db.prepare('SELECT attempt_id FROM judgment_attempt_link WHERE judgment_id = ? ORDER BY attempt_id').all(res.judgment_id).map((r) => r.attempt_id);
  assert.deepEqual(linked, res.answer.tried.attempt_ids);
  assert.equal(linked.length, 3);
  const j = db.prepare('SELECT * FROM judgment WHERE id = ?').get(res.judgment_id);
  assert.equal(j.is_synthetic, 0);
  assert.equal(j.proposal, null); // 근거 없는 판단에 제안을 지어 넣지 않는다
});

test('question: 검증된 근거만 answer.evidence.items 에, 미검증(mismatch/unverifiable/retracted)은 excluded — 다음 후보 근거로 쓰지 않는다', async () => {
  const db = seeded();
  const now = new Date().toISOString();
  const insE = db.prepare(`INSERT INTO evidence (input_doi, status, excluded_reason, created_at, updated_at) VALUES (?,?,?,?,?)`);
  const evOk = Number(insE.run('10.1/ok', 'verified', null, now, now).lastInsertRowid);
  const evBad = Number(insE.run('10.1/bad', 'mismatch', '서지 불일치: title', now, now).lastInsertRowid);
  const evUnv = Number(insE.run('10.1/unv', 'unverifiable', null, now, now).lastInsertRowid);
  const attemptIds = db.prepare("SELECT id FROM research_attempt WHERE target_norm='RSE-01' AND method_norm='western_blot' AND environment_norm='cell'").all().map((r) => r.id);

  // 미검증 근거만 연결된 과거 판단 → next 는 grounded=false
  const j1 = Number(db.prepare("INSERT INTO judgment (question, asked_at, proposal, created_at) VALUES ('q','t','미검증 근거 기반 제안', ?)").run(now).lastInsertRowid);
  db.prepare('INSERT INTO judgment_attempt_link VALUES (?,?)').run(j1, attemptIds[0]);
  for (const e of [evBad, evUnv]) db.prepare('INSERT INTO evidence_judgment_link VALUES (?,?,?)').run(j1, e, now);
  const q = 'RSE-01을 세포 모델에서 Western blot으로 다시 해도 될까요?';
  let res = await handleChat(ctxOf(db), q);
  assert.deepEqual(res.answer.evidence.items, []);
  assert.deepEqual(res.answer.evidence.excluded.map((x) => x.id).sort(), [evBad, evUnv].sort());
  assert.equal(res.answer.next.grounded, false);
  assert.equal(res.answer.next.text, NO_PATH_MESSAGE);

  // 검증된 근거가 연결된 과거 판단 → 그 근거만 items, 제안은 저장된 판단에서 인용
  const j2 = Number(db.prepare("INSERT INTO judgment (question, asked_at, proposal, created_at) VALUES ('q2','t','검증 근거 기반 제안', ?)").run(now).lastInsertRowid);
  db.prepare('INSERT INTO judgment_attempt_link VALUES (?,?)').run(j2, attemptIds[1]);
  db.prepare('INSERT INTO evidence_judgment_link VALUES (?,?,?)').run(j2, evOk, now);
  res = await handleChat(ctxOf(db), q);
  assert.deepEqual(res.answer.evidence.items.map((e) => e.id), [evOk]);
  assert.ok(res.answer.evidence.items.every((e) => e.status === 'verified'));
  assert.equal(res.answer.next.grounded, true);
  assert.equal(res.answer.next.text, `저장된 판단 #${j2}의 제안: 검증 근거 기반 제안`);
  // 새 판단에는 검증된 근거만 연결된다
  const linkedEv = db.prepare('SELECT evidence_id FROM evidence_judgment_link WHERE judgment_id = ?').all(res.judgment_id).map((r) => r.evidence_id);
  assert.deepEqual(linkedEv, [evOk]);

  // 재검토 필요로 표시된 판단은 다음 후보 근거로 쓰지 않는다
  db.prepare('UPDATE judgment SET needs_review = 1 WHERE id = ?').run(j2);
  res = await handleChat(ctxOf(db), q);
  assert.equal(res.answer.next.grounded, false);
  assert.equal(res.answer.next.text, NO_PATH_MESSAGE);
});

test('question: 대상·방법·환경이 미상이면 같은 접근으로 확정하지 않고 NO_PATH_MESSAGE', async () => {
  const db = seeded();
  const res = await handleChat(ctxOf(db), 'RSE-01은 어떻게 해야 하나요?');
  assert.equal(res.kind, 'question');
  assert.equal(res.answer.tried.match, 'undetermined');
  assert.equal(res.answer.tried.count, 0);
  assert.equal(res.answer.next.text, NO_PATH_MESSAGE);
});

test('HTTP: POST /api/chat 라이브 문장 → 200, DB 2→3, GET /api/approaches 재조회, 재시작 후 유지', async () => {
  const file = tmpDb();
  let app = createApp({ DB_PATH: file, PORT: 0, RSE_LLM: 'rules' });
  loadSeed(app.db);
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  let base = `http://127.0.0.1:${app.server.address().port}`;
  const post = (text) => fetch(`${base}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }) });
  try {
    const a0 = await (await fetch(`${base}/api/approaches?target=RSE-01&method=western_blot&environment=cell`)).json();
    assert.equal(a0.same_count, 2);

    const r = await post(LIVE);
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.equal(body.kind, 'execution');
    assert.equal(body.saved, true);
    assert.equal(body.attempt.target.norm, 'RSE-01');
    assert.equal(body.attempt.method.norm, 'western_blot');
    assert.equal(body.attempt.environment.norm, 'cell');
    assert.equal(body.attempt.result, 'stopped');
    assert.equal(body.attempt.stop_stage.norm, 'reproducibility_validation');
    assert.equal(body.extractor, 'rules');
    assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM research_attempt').get().n, 8);

    const a1 = await (await fetch(`${base}/api/approaches?target=RSE-01&method=western_blot&environment=cell`)).json();
    assert.equal(a1.same_count, 3);
    assert.equal(a1.common_stop_stage.all_same, true);
    assert.equal(a1.text, '이 접근은 3번 시도됐고 모두 재현성 검증 단계에서 멈췄습니다');
    const byId = await (await fetch(`${base}/api/approaches?attempt_id=${body.attempt.id}`)).json();
    assert.deepEqual(byId.same_attempt_ids, a1.same_attempt_ids);

    // 400 / 404
    assert.equal((await fetch(`${base}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 400);
    assert.equal((await fetch(`${base}/api/approaches`)).status, 400);
    assert.equal((await fetch(`${base}/api/approaches?attempt_id=99999`)).status, 404);
  } finally {
    await new Promise((r) => app.server.close(r));
    app.db.close();
  }

  // 서버 재시작 후에도 SQLite 값 유지
  app = createApp({ DB_PATH: file, PORT: 0, RSE_LLM: 'rules' });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${app.server.address().port}`;
  try {
    const a2 = await (await fetch(`${base}/api/approaches?target=RSE-01&method=western_blot&environment=cell`)).json();
    assert.equal(a2.same_count, 3);
    assert.equal(a2.text, '이 접근은 3번 시도됐고 모두 재현성 검증 단계에서 멈췄습니다');
  } finally {
    await new Promise((r) => app.server.close(r));
    app.db.close();
  }
});

// CAPTURE 소유: 실제 실행 중인 서버(HTTP) + 자기 SQLite(DB_PATH) 를 직접 읽는 라이브 검증 (npm test 대상 아님)
//   node test/capture/live-verify.mjs live      — 서버 실행 중. baseline 2 → 라이브 문장 → 3, plan/question/hypothesis/other 0
//   node test/capture/live-verify.mjs restart   — 서버 재시작 후. 저장값·재계산 유지 확인
import { DatabaseSync } from 'node:sqlite';
import { loadConfig } from '../../src/config.js';

const cfg = loadConfig();
const base = `http://127.0.0.1:${cfg.port}`;
const LIVE = '오늘 후보 단백질 RSE-01을 세포 모델에서 Western blot으로 측정했고, 재현성 검증 단계에서 중단했습니다.';
const results = [];
const check = (name, expected, actual) => {
  const ok = JSON.stringify(expected) === JSON.stringify(actual);
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${name} | 기대=${JSON.stringify(expected)} | 실제=${JSON.stringify(actual)}`);
};
const q = (sql, ...p) => { const db = new DatabaseSync(cfg.dbPath, { readOnly: true }); try { return db.prepare(sql).all(...p); } finally { db.close(); } };
const total = () => q('SELECT COUNT(*) n FROM research_attempt')[0].n;
const same = () => q("SELECT COUNT(*) n FROM research_attempt WHERE target_norm='RSE-01' AND method_norm='western_blot' AND environment_norm='cell'")[0].n;
const post = async (text) => { const r = await fetch(`${base}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }) }); return { status: r.status, body: await r.json() }; };
const approaches = async () => (await fetch(`${base}/api/approaches?target=RSE-01&method=western_blot&environment=cell`)).json();

const mode = process.argv[2];
console.log(`서버 ${base} · DB_PATH ${cfg.dbPath} · RSE_LLM(config) ${cfg.llmMode}`);

if (mode === 'live') {
  const t0 = total(); const s0 = same();
  check('baseline 같은 접근 (DB)', 2, s0);
  const r = await post(LIVE);
  console.log('라이브 응답 HTTP', r.status, JSON.stringify({ kind: r.body.kind, saved: r.body.saved, extractor: r.body.extractor, fallback: r.body.extractor_fallback ?? null, attempt: r.body.attempt, auto_record_line: r.body.auto_record_line, approach_text: r.body.approach?.text }, null, 1));
  check('HTTP status', 200, r.status);
  check('kind/saved', ['execution', true], [r.body.kind, r.body.saved]);
  check('attempt 증가 (DB)', t0 + 1, total());
  check('같은 접근 (DB)', 3, same());
  const row = q('SELECT * FROM research_attempt WHERE id = ?', r.body.attempt.id)[0];
  check('DB 저장 raw_text 원문', LIVE, row.raw_text);
  check('DB 구조화 raw', ['RSE-01', 'Western blot', '세포 모델', null, '재현성 검증'], [row.target_raw, row.method_raw, row.environment_raw, row.condition_raw, row.stop_stage_raw]);
  check('DB 정규화', ['RSE-01', 'western_blot', 'cell', null, 'stopped', 'reproducibility_validation'], [row.target_norm, row.method_norm, row.environment_norm, row.condition_norm, row.result, row.stop_stage_norm]);
  check('DB source/extractor', ['live', 0], [row.source, row.is_synthetic]);
  console.log('DB extractor =', row.extractor, '| created_at =', row.created_at, '| occurred_at =', row.occurred_at);
  check('approach_key (응답)', 'RSE-01|western_blot|cell', r.body.attempt.approach_key);
  check('자동 기록 줄 = DB 값에서 생성', `자동 기록됨 — 대상 ${row.target_norm} / 방법 ${row.method_raw} / 환경 세포 / 결과 중단`, r.body.auto_record_line);

  // plan / hypothesis / other / question: 증가 0
  const t1 = total();
  const others = {
    plan: 'RSE-01을 세포 모델에서 Western blot으로 다시 해보려 합니다.',
    hypothesis: 'RSE-01은 세포 모델에서 재현성 문제가 있을 것 같습니다.',
    other: 'RSE-01 Western blot 세포 모델',
    question: 'RSE-01을 세포 모델에서 Western blot으로 다시 해도 될까요?',
  };
  let qres;
  for (const [kind, text] of Object.entries(others)) {
    const o = await post(text);
    check(`${kind} 분류/saved`, [200, kind, false, null], [o.status, o.body.kind, o.body.saved, o.body.attempt]);
    check(`${kind} attempt 증가`, t1, total());
    if (kind === 'question') qres = o.body;
  }
  const ids = q("SELECT id FROM research_attempt WHERE target_norm='RSE-01' AND method_norm='western_blot' AND environment_norm='cell' ORDER BY id").map((x) => x.id);
  const a = await approaches();
  console.log('GET /api/approaches =', JSON.stringify(a));
  check('G2 same_count', 3, a.same_count);
  check('G2 same_attempt_ids (DB 와 일치)', ids, a.same_attempt_ids);
  check('G2 common_stop_stage', { norm: 'reproducibility_validation', raw: '재현성 검증', all_same: true }, a.common_stop_stage);
  check('G2 문구', '이 접근은 3번 시도됐고 모두 재현성 검증 단계에서 멈췄습니다', a.text);
  check('G2 undetermined_ids / adjacent_ids 존재(seed 기준)', [true, true], [a.undetermined_ids.length > 0, a.adjacent_ids.length > 0]);
  check('question 재사용 attempt_ids', ids, qres.answer.tried.attempt_ids);
  check('question 판단 link (DB)', ids, q('SELECT attempt_id FROM judgment_attempt_link WHERE judgment_id = ? ORDER BY attempt_id', qres.judgment_id).map((x) => x.attempt_id));
  check('question next = NO_PATH', ['저장된 이력과 검증된 근거만으로는 다음 경로를 제시할 수 없습니다', false], [qres.answer.next.text, qres.answer.next.grounded]);
  check('question evidence.items 미검증 0', 0, qres.answer.evidence.items.length);
}

if (mode === 'restart') {
  const a = await approaches();
  check('재시작 후 같은 접근 (DB)', 3, same());
  check('재시작 후 same_count', 3, a.same_count);
  check('재시작 후 문구', '이 접근은 3번 시도됐고 모두 재현성 검증 단계에서 멈췄습니다', a.text);
  check('재시작 후 live 시도 (DB)', 1, q("SELECT COUNT(*) n FROM research_attempt WHERE source='live' AND raw_text = ?", LIVE)[0].n);
}

const pass = results.filter(Boolean).length;
console.log(`\n통과 ${pass} / 전체 ${results.length}`);
process.exit(results.length > 0 && pass === results.length ? 0 : 1);

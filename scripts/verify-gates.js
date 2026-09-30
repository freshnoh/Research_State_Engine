// 통합 검증 harness (INTEGRATOR 소유). 실제 서버 프로세스 + 실제 SQLite + 실제 Crossref 로 G1~G6 를 검사한다.
//   node scripts/verify-gates.js            (기본 PORT 4109, DATA_DIR var/verify — 운영 DB 를 건드리지 않음)
// 결과: 콘솔 요약 + var/verify/report-*.json. 검사 대상 0건은 PASS 로 치지 않는다.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../src/config.js';
import { openDb } from '../src/db/index.js';
import { loadSeed } from '../src/core/seed.js';
import { sha256File, ORIGINAL_FIXTURE } from '../src/approval/gate.js';

const PORT = Number(process.env.VERIFY_PORT || 4109);
const DIR = path.resolve(ROOT, process.env.VERIFY_DIR || 'var/verify');
const DB_PATH = path.join(DIR, 'rse.db');
const APPROVAL_DIR = path.join(DIR, 'approval');
const BASELINE_DB = path.resolve(ROOT, process.env.VERIFY_BASELINE || 'var/baseline/rse.baseline.db');
const BASE = `http://127.0.0.1:${PORT}`;
const RETRACTED_DOI = '10.1038/nature04533';
const SAMPLES = JSON.parse(fs.readFileSync(path.join(ROOT, 'fixtures/evidence/samples.json'), 'utf8')).samples;
const sample = (k) => SAMPLES.find((s) => s.key === k);

const LIVE_EXEC = '오늘 후보 단백질 RSE-01을 세포 모델에서 Western blot으로 측정했고, 재현성 검증 단계에서 중단했습니다.';
const LIVE_PLAN = 'RSE-01을 세포 모델에서 Western blot으로 다시 해보려 합니다.';
const LIVE_QUESTION = 'RSE-01을 세포 모델에서 Western blot으로 다시 해도 될까요?';

const results = [];
function check(gate, name, expected, actual, pass = JSON.stringify(expected) === JSON.stringify(actual)) {
  results.push({ gate, name, expected, actual, pass: !!pass });
  console.log(`${pass ? 'PASS' : 'FAIL'} [${gate}] ${name} — 기대 ${JSON.stringify(expected)} / 실제 ${JSON.stringify(actual)}`);
  return !!pass;
}

let child = null;
async function startServer(extraEnv = {}) {
  child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'src/server.js'], {
    cwd: ROOT, env: { ...process.env, PORT: String(PORT), DATA_DIR: DIR, DB_PATH, APPROVAL_DIR, ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stderr.on('data', (d) => fs.appendFileSync(path.join(DIR, 'server.log'), d));
  child.stdout.on('data', (d) => fs.appendFileSync(path.join(DIR, 'server.log'), d));
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(`${BASE}/api/health`)).ok) return; } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('server did not start');
}
async function stopServer() {
  if (!child) return;
  const c = child; child = null;
  await new Promise((r) => { c.once('exit', r); c.kill('SIGTERM'); });
}
async function api(method, p, body) {
  const res = await fetch(BASE + p, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  let json = null;
  try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, body: json };
}
function q(sql, ...args) {
  const db = openDb(DB_PATH);
  try { return db.prepare(sql).all(...args); } finally { db.close(); }
}
const sameCount = () => q(`SELECT COUNT(*) AS n FROM research_attempt WHERE target_norm='RSE-01' AND method_norm='western_blot' AND environment_norm='cell'`)[0].n;
const totalAttempts = () => q('SELECT COUNT(*) AS n FROM research_attempt')[0].n;

function prepare() {
  fs.mkdirSync(DIR, { recursive: true });
  for (const s of ['', '-wal', '-shm']) fs.rmSync(DB_PATH + s, { force: true });
  fs.rmSync(path.join(DIR, 'server.log'), { force: true });
  if (fs.existsSync(BASELINE_DB)) fs.copyFileSync(BASELINE_DB, DB_PATH);
  else { const db = openDb(DB_PATH); loadSeed(db); db.close(); }
  fs.mkdirSync(APPROVAL_DIR, { recursive: true });
  fs.copyFileSync(ORIGINAL_FIXTURE, path.join(APPROVAL_DIR, 'original_measurements.csv'));
  return fs.existsSync(BASELINE_DB) ? 'baseline' : 'seed';
}

async function g1g2() {
  check('G1', 'baseline 같은 접근', 2, sameCount());
  const t0 = totalAttempts();
  const plan = await api('POST', '/api/chat', { text: LIVE_PLAN });
  check('G1', '계획 발화 HTTP', 200, plan.status);
  check('G1', '계획 발화 kind/saved', ['plan', false], [plan.body?.kind, plan.body?.saved]);
  check('G1', '계획 발화 attempt 증가량', 0, totalAttempts() - t0);
  const qq = await api('POST', '/api/chat', { text: LIVE_QUESTION });
  check('G1', '질문 발화 kind/saved', ['question', false], [qq.body?.kind, qq.body?.saved]);
  check('G1', '질문 발화 attempt 증가량', 0, totalAttempts() - t0);
  check('G2', '질문(입력 전) 같은 접근 수 = DB 2', 2, qq.body?.answer?.tried?.count);

  const ex = await api('POST', '/api/chat', { text: LIVE_EXEC });
  check('G1', '실행 발화 kind/saved', ['execution', true], [ex.body?.kind, ex.body?.saved]);
  check('G1', '실행 발화 attempt 증가량', 1, totalAttempts() - t0);
  check('G1', '같은 접근 DB 3건', 3, sameCount());
  const row = q('SELECT * FROM research_attempt ORDER BY id DESC LIMIT 1')[0];
  check('G1', '원문 저장', LIVE_EXEC, row?.raw_text);
  check('G1', '구조화 값', ['RSE-01', 'western_blot', 'cell', 'stopped', 'reproducibility_validation', 'live'],
    [row?.target_norm, row?.method_norm, row?.environment_norm, row?.result, row?.stop_stage_norm, row?.source]);
  check('G1', '자동 기록 한 줄', true, typeof ex.body?.auto_record_line === 'string' && ex.body.auto_record_line.startsWith('자동 기록됨'), undefined);
  const list = await api('GET', '/api/attempts');
  check('G1', '화면 C 데이터(/api/attempts) 최신 행 = 새 시도', row?.id, list.body?.attempts?.[0]?.id);

  const q2 = await api('POST', '/api/chat', { text: LIVE_QUESTION });
  check('G2', '재질문 kind', 'question', q2.body?.kind);
  check('G2', '같은 접근 수 = DB 재조회 3', 3, q2.body?.answer?.tried?.count);
  const ids = q(`SELECT id FROM research_attempt WHERE target_norm='RSE-01' AND method_norm='western_blot' AND environment_norm='cell' ORDER BY id`).map((r) => r.id);
  check('G2', '근거 시도 id = DB 같은 접근 id', ids, [...(q2.body?.answer?.tried?.attempt_ids ?? [])].sort((a, b) => a - b));
  const text = q2.body?.answer?.tried?.text ?? '';
  check('G2', '문구에 3번 + 저장된 중단 단계', true, /3번/.test(text) && text.includes('재현성 검증'), undefined);
  check('G2', '재질문 attempt 증가량 0', ids.length, sameCount());
  if (q2.body?.judgment_id) {
    const links = q('SELECT attempt_id FROM judgment_attempt_link WHERE judgment_id=? ORDER BY attempt_id', q2.body.judgment_id).map((r) => r.attempt_id);
    check('G2', '판단 저장 + 사용 시도 link', ids, links);
  } else check('G2', '판단 저장 + 사용 시도 link', 'judgment_id', null, false);
  // 하드코딩 아님: 다른 접근 키는 다른 DB 값이 나와야 한다
  const other = await api('POST', '/api/chat', { text: 'RSE-03을 마우스에서 행동검증으로 다시 해도 될까요?' });
  check('G2', '다른 접근(RSE-03 동물 행동검증) 수 = DB 1', 1, other.body?.answer?.tried?.count);
}

async function g3() {
  const got = {};
  for (const k of ['normal', 'corrupted', 'unverifiable']) {
    const s = sample(k);
    const existing = q('SELECT * FROM evidence WHERE input_doi=? ORDER BY id LIMIT 1', s.input_doi)[0];
    if (existing) got[k] = existing;
    else {
      const r = await api('POST', '/api/evidence', { doi: s.input_doi, title: s.input_title, authors: s.input_authors, year: s.input_year, is_demo_corrupted: !!s.is_demo_corrupted });
      got[k] = r.body?.evidence ? q('SELECT * FROM evidence WHERE id=?', r.body.evidence.id)[0] : null;
    }
  }
  check('G3', '정상 표본 → 확인', 'verified', got.normal?.status);
  check('G3', '손상 표본 → 서지 불일치', 'mismatch', got.corrupted?.status);
  check('G3', '손상 표본 표시 플래그', 1, got.corrupted?.is_demo_corrupted);
  check('G3', '확인 불가 표본 → 확인 불가', 'unverifiable', got.unverifiable?.status);
  check('G3', '확인 불가 사유 = 레코드 미확인', 'not_found', got.unverifiable?.unverifiable_reason);
  const live = sample('live_unseeded');
  const lr = await api('POST', '/api/evidence', { doi: live.input_doi });
  check('G3', '시드 없는 DOI 현장 입력 → 확인(fresh)', ['verified', 'fresh'], [lr.body?.evidence?.status, lr.body?.lookup?.mode]);
  const html = fs.readdirSync(path.join(ROOT, 'public')).filter((f) => /\.(html|js)$/.test(f))
    .map((f) => fs.readFileSync(path.join(ROOT, 'public', f), 'utf8')).join('\n');
  const banned = ['논문 없음', '가짜 논문', '존재하지 않음', '존재하지 않는'].filter((w) => html.includes(w));
  check('G3', '화면 코드에 금지 표현 없음', [], banned);
  return got;
}

async function failurePath(got) {
  // 조회 실패 경로: 도달 불가 Crossref 로 재시작 → 재검사 → 정상 확인 유지
  if (!got.normal?.id || got.normal.status !== 'verified') {
    check('G3', '조회 실패 경로 전제(정상 확인 근거 존재)', 'verified', got.normal?.status ?? null, false);
    return;
  }
  await stopServer();
  await startServer({ CROSSREF_BASE_URL: 'http://127.0.0.1:9', CROSSREF_TIMEOUT_MS: '2000' });
  const id = got.normal?.id;
  const r = await api('POST', '/api/recheck', { evidence_ids: [id] });
  const row = q('SELECT * FROM evidence WHERE id=?', id)[0];
  check('G3', '조회 실패 재검사 HTTP', 200, r.status);
  check('G3', '조회 실패 → 기존 확인 유지', 'verified', row?.status);
  check('G3', '조회 실패 기록(last_attempt_ok=0, last_success_at 유지)', [0, true], [row?.last_attempt_ok, !!row?.last_success_at]);
  const ev = (await api('GET', '/api/evidence')).body?.evidence?.find((e) => e.id === id);
  check('G3', 'API latest_check_failed 표시', true, ev?.latest_check_failed);
  await stopServer();
  await startServer();
}

async function g4() {
  const ev = q('SELECT * FROM evidence WHERE input_doi=?', RETRACTED_DOI)[0];
  check('G4', 'baseline 근거 상태 = 확인', 'verified', ev?.status);
  check('G4', '철회 논문 cache 없음(버튼 전)', 0, q('SELECT COUNT(*) AS n FROM crossref_cache WHERE lower(doi)=?', RETRACTED_DOI)[0].n);
  const jl = q('SELECT j.* FROM judgment j JOIN evidence_judgment_link l ON l.judgment_id=j.id WHERE l.evidence_id=?', ev?.id);
  check('G4', '합성 과거 판단 연결 1 / 재검토 0', [1, 0], [jl.length, jl[0]?.needs_review]);
  const logBefore = q("SELECT COUNT(*) AS n FROM crossref_lookup_log WHERE lower(doi)=? AND mode='fresh'", RETRACTED_DOI)[0].n;
  const r = await api('POST', '/api/recheck', {});
  check('G4', '[지금 재검사] HTTP', 200, r.status);
  const res = r.body?.results?.find((x) => x.evidence_id === ev?.id);
  check('G4', '상태 변화 확인 → 철회됨', ['verified', 'retracted'], [res?.before, res?.after]);
  check('G4', 'fresh 조회 (cache 우회)', 'fresh', res?.lookup?.mode);
  const logAfter = q("SELECT COUNT(*) AS n FROM crossref_lookup_log WHERE lower(doi)=? AND mode='fresh'", RETRACTED_DOI)[0].n;
  check('G4', 'crossref_lookup_log fresh 증가', true, logAfter > logBefore, undefined);
  const after = q('SELECT * FROM evidence WHERE id=?', ev?.id)[0];
  check('G4', 'DB 철회 relation 저장(유형/방향)', ['retraction', 'updated-by'], [after?.retraction_type, after?.retraction_direction]);
  check('G4', '철회 출처 저장', true, !!after?.retraction_source, undefined);
  const back = await api('GET', `/api/evidence/${ev?.id}/judgments`);
  check('G4', '역조회 → 연결 판단 재검토 필요', [jl[0]?.id, true], [back.body?.judgments?.[0]?.id, back.body?.judgments?.[0]?.needs_review]);
  const jrow = q('SELECT needs_review, review_reason FROM judgment WHERE id=?', jl[0]?.id)[0];
  check('G4', 'DB judgment.needs_review=1', 1, jrow?.needs_review);
  check('G4', '판단 자체 결론 변경 없음(proposal 유지)', jl[0]?.proposal, q('SELECT proposal FROM judgment WHERE id=?', jl[0]?.id)[0]?.proposal);
}

async function g5() {
  const baseline = sha256File(ORIGINAL_FIXTURE);
  const orig = path.join(APPROVAL_DIR, 'original_measurements.csv');
  const req = await api('POST', '/api/actions', { action_type: 'overwrite_original' });
  check('G5', '덮어쓰기 요청 → 승인 대기', [202, 'pending'], [req.status, req.body?.approval?.status]);
  check('G5', '승인 전 hash = 기준', baseline, req.body?.approval?.hash_before);
  check('G5', '승인 전 실제 원본 불변', baseline, sha256File(orig));
  const run = await api('POST', '/api/actions', { action_type: 'run_analysis' });
  const pendingNow = (await api('GET', '/api/approvals')).body?.approvals?.filter((a) => a.status === 'pending').length;
  check('G5', '대기 중 독립 분석 완료', ['completed', 1], [run.body?.run?.status, pendingNow]);
  check('G5', '분석 후에도 원본 불변', baseline, sha256File(orig));
  const ok = await api('POST', `/api/approvals/${req.body?.approval?.id}/approve`);
  const now = sha256File(orig);
  check('G5', '승인 후에만 변경', ['approved', true], [ok.body?.approval?.status, now !== baseline]);
  check('G5', 'hash_after = 실제 파일 hash', now, ok.body?.approval?.hash_after);
  const req2 = await api('POST', '/api/actions', { action_type: 'overwrite_original' });
  const before2 = sha256File(orig);
  await api('POST', `/api/approvals/${req2.body?.approval?.id}/reject`);
  check('G5', '거절 → 원본 불변', before2, sha256File(orig));
}

async function g6() {
  const snap = () => ({
    attempts: totalAttempts(),
    evidence: q('SELECT COUNT(*) AS n FROM evidence')[0].n,
    links: q('SELECT COUNT(*) AS n FROM evidence_judgment_link')[0].n,
    retracted: q("SELECT COUNT(*) AS n FROM evidence WHERE status='retracted'")[0].n,
    review: q('SELECT COUNT(*) AS n FROM judgment WHERE needs_review=1')[0].n,
  });
  const before = snap();
  const apiBefore = await apiSnap();
  await stopServer();
  await startServer();
  const after = snap();
  const apiAfter = await apiSnap();
  for (const k of Object.keys(before)) check('G6', `재시작 후 DB ${k} 유지`, before[k], after[k], before[k] === after[k] && before[k] > 0);
  for (const k of Object.keys(apiBefore)) check('G6', `재시작 후 API ${k} 유지`, apiBefore[k], apiAfter[k], apiBefore[k] === apiAfter[k] && apiBefore[k] > 0);
}
async function apiSnap() {
  const a = (await api('GET', '/api/attempts')).body?.attempts ?? [];
  const e = (await api('GET', '/api/evidence')).body?.evidence ?? [];
  const j = (await api('GET', '/api/judgments')).body?.judgments ?? [];
  return {
    attempts: a.length,
    evidence: e.length,
    links: j.reduce((n, x) => n + (x.evidence?.length ?? 0), 0),
    retracted: e.filter((x) => x.status === 'retracted').length,
    review: j.filter((x) => x.needs_review).length,
  };
}

async function main() {
  const source = prepare();
  if (process.argv.includes('--prepare-only')) { console.log(`prepared ${DIR} from ${source}`); return; }
  console.log(`verify: DB 출처=${source} DIR=${DIR} PORT=${PORT}`);
  await startServer();
  const stages = [['G1/G2', g1g2], ['G3', async () => failurePath(await g3())], ['G4', g4], ['G5', g5], ['G6', g6]];
  for (const [name, fn] of stages) {
    try { await fn(); } catch (e) { check(name, `단계 실행 오류`, 'no error', String(e.message || e), false); }
  }
  await stopServer();
  const byGate = {};
  for (const r of results) {
    const g = r.gate.split('/')[0];
    byGate[g] ??= { pass: 0, total: 0 };
    byGate[g].total++; if (r.pass) byGate[g].pass++;
  }
  const pass = results.filter((r) => r.pass).length;
  console.log('\n요약:', Object.entries(byGate).map(([g, v]) => `${g} ${v.pass}/${v.total}`).join(' · '), `| 전체 ${pass}/${results.length}`);
  const file = path.join(DIR, `report-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(file, JSON.stringify({ at: new Date().toISOString(), source, byGate, pass, total: results.length, results }, null, 2));
  console.log('report:', file);
  process.exitCode = pass === results.length && results.length > 0 ? 0 : 1;
}

main().catch(async (e) => { console.error(e); await stopServer(); process.exit(1); });

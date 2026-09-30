// SCREENS UI 계약 검증용 fixture 서버 (테스트 전용, 제품 코드 아님).
// CONTRACT §3/§5 의 응답 형식을 흉내 낸다. 여기서 통과한 것은 "UI 가 계약 형식의 응답을 올바르게 렌더링한다" 뿐이며
// 실제 CAPTURE/EVIDENCE/approval backend 가 그 값을 만든다는 증거가 아니다.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const RESULT = { success: '성공', partial: '부분', failure: '실패', stopped: '중단', unknown: '미확인' };
const STATUS = { verified: '확인', mismatch: '서지 불일치', unverifiable: '확인 불가', retracted: '철회됨' };
const APPROVAL = { pending: '승인 대기', approved: '승인·실행됨', rejected: '거절됨', failed: '실행 실패' };

function attempt(id, raw, over = {}) {
  return {
    id, raw_text: raw,
    target: { raw: 'RSE-01', norm: 'RSE-01' }, method: { raw: 'Western blot', norm: 'western_blot' },
    environment: { raw: '세포 모델', norm: 'cell', label: '세포' }, condition: { raw: null, norm: null },
    result: 'stopped', result_label: '중단', stop_stage: { raw: '재현성 검증', norm: 'reproducibility_validation' },
    occurred_at: `2026-0${(id % 9) + 1}-10T10:00:00+09:00`, created_at: '2026-09-30T09:00:00+09:00',
    source: 'seed', is_synthetic: true, extractor: 'seed', approach_key: 'RSE-01|western_blot|cell', ...over,
  };
}

export function baselineState(variant = 'baseline') {
  const stop = variant === 'variant' ? { raw: '행동검증', norm: 'behavioral_validation' } : { raw: '재현성 검증', norm: 'reproducibility_validation' };
  const n = variant === 'variant' ? 4 : 2;
  const attempts = [];
  for (let i = 1; i <= n; i++) attempts.push(attempt(i, `RSE-01 세포 실험 기록 ${i}번 (시연용 ${variant})`, { stop_stage: stop, condition: { raw: `${i} µM`, norm: `${i} uM` } }));
  attempts.push(attempt(n + 1, 'RSE-01 발현을 세포에서 qPCR로 확인했다.', { method: { raw: 'qPCR', norm: 'qpcr' }, result: 'success', result_label: '성공', stop_stage: { raw: null, norm: null }, approach_key: 'RSE-01|qpcr|cell' }));
  attempts.push(attempt(n + 2, 'RSE-01을 동물 모델에서 시도했으나 환경이 불분명하다.', { environment: { raw: null, norm: null, label: null }, approach_key: null }));
  const evidence = [
    { id: 1, input: { doi: '10.9999/fixture.abeta', title: '픽스처 근거 A (철회 예정 표본)', authors: ['Fixture'], year: 2006 }, crossref: { title: null, authors: [], year: null },
      status: 'verified', status_label: '확인', unverifiable_reason: null, unverifiable_reason_label: null, mismatch_fields: [], retraction: null,
      last_success_at: '2022-03-15T10:00:00+09:00', last_attempt_at: '2022-03-15T10:00:00+09:00', last_attempt_ok: true, last_error: null,
      latest_check_failed: false, usable_as_verified: true, excluded_reason: null, is_demo_corrupted: false, is_demo_past_state: true,
      demo_label: '철회 이전 시점의 시연용 과거 상태', previous_status: null, status_changed_at: null },
    { id: 2, input: { doi: '10.9999/fixture.normal', title: '픽스처 근거 B (정상)', authors: ['Normal', 'Second'], year: 2019 }, crossref: { title: '픽스처 근거 B (정상)', authors: ['Normal'], year: 2019 },
      status: 'verified', status_label: '확인', unverifiable_reason: null, unverifiable_reason_label: null, mismatch_fields: [], retraction: null,
      last_success_at: '2026-09-30T09:00:00+09:00', last_attempt_at: '2026-09-30T09:00:00+09:00', last_attempt_ok: true, last_error: null,
      latest_check_failed: false, usable_as_verified: true, excluded_reason: null, is_demo_corrupted: false, is_demo_past_state: false, demo_label: null, previous_status: null, status_changed_at: null },
    { id: 3, input: { doi: '10.9999/fixture.corrupt', title: '손상된 서지 픽스처', authors: ['Nobody'], year: 1999 }, crossref: { title: '다른 제목', authors: ['Other'], year: 2010 },
      status: 'mismatch', status_label: '서지 불일치', unverifiable_reason: null, unverifiable_reason_label: null, mismatch_fields: ['title', 'year'], retraction: null,
      last_success_at: '2026-09-30T09:00:00+09:00', last_attempt_at: '2026-09-30T09:00:00+09:00', last_attempt_ok: true, last_error: null,
      latest_check_failed: false, usable_as_verified: false, excluded_reason: '서지 불일치', is_demo_corrupted: true, is_demo_past_state: false, demo_label: '시연용으로 일부러 손상시킨 표본', previous_status: null, status_changed_at: null },
    { id: 4, input: { doi: '10.9999/fixture.unknown', title: '확인 불가 픽스처', authors: [], year: null }, crossref: { title: null, authors: [], year: null },
      status: 'unverifiable', status_label: '확인 불가', unverifiable_reason: 'not_found', unverifiable_reason_label: 'Crossref 레코드 미확인', mismatch_fields: [], retraction: null,
      last_success_at: null, last_attempt_at: '2026-09-30T09:00:00+09:00', last_attempt_ok: true, last_error: null,
      latest_check_failed: false, usable_as_verified: false, excluded_reason: '확인 불가', is_demo_corrupted: false, is_demo_past_state: false, demo_label: null, previous_status: null, status_changed_at: null },
  ];
  const judgments = [{ id: 1, question: '픽스처 경로를 후속 검증 후보로 유지할 것인가?', asked_at: '2022-03-15T10:05:00+09:00', proposal: '픽스처 경로를 후속 검증 후보로 유지',
    researcher_action: '후속 검증 후보 목록에 유지', needs_review: false, review_reason: null, review_flagged_at: null, is_synthetic: true,
    demo_label: '철회 이전 시점의 시연용 과거 상태', attempt_ids: [], evidence_ids: [1] }];
  return { attempts, evidence, judgments, approvals: [], runs: [], targetContent: 'original-v1', targetPath: '/fixture/approval/original_measurements.csv' };
}

export function createMock(variant = 'baseline') {
  const M = {
    state: baselineState(variant),
    fail: {},          // 'POST /api/chat' → {status, body} | {destroy:true}
    delay: {},         // 'POST /api/recheck' → ms
    calls: [],         // 'POST /api/chat' 등 호출 기록
    answerEvidence: [], // 질문 답에 넣을 verified 근거 (fixture 조정용)
    recheckOutcome: 'retracted', // 'retracted' | 'lookup_failed'
    retractionDate: '2031-02-03', // 프런트 상수와 구분하기 위한 fixture 값
    reset(v = 'baseline') { M.state = baselineState(v); M.fail = {}; M.delay = {}; M.calls = []; M.answerEvidence = []; M.recheckOutcome = 'retracted'; },
  };
  const targetHash = () => sha(M.state.targetContent);
  const short = (h) => (h ? h.slice(0, 8) : null);
  const approvalView = (a) => ({ ...a, status_label: APPROVAL[a.status], hash_before_short: short(a.hash_before), hash_after_short: short(a.hash_after) });
  const evView = (e) => e;
  const jView = (j) => ({ ...j, evidence: j.evidence_ids.map((id) => M.state.evidence.find((e) => e.id === id)) });
  const sameAttempts = () => M.state.attempts.filter((a) => a.approach_key === 'RSE-01|western_blot|cell');
  const answer = () => {
    const same = sameAttempts();
    const stages = new Set(same.map((a) => a.stop_stage.raw));
    const stage = stages.size === 1 ? [...stages][0] : null;
    return {
      tried: { text: `이 접근은 ${same.length}번 시도됐고 ${stage ? `모두 ${stage} 단계에서 멈췄습니다` : '중단 단계가 서로 다릅니다'}`, match: 'same', count: same.length, stop_stage: stage, attempt_ids: same.map((a) => a.id) },
      evidence: { items: M.answerEvidence, excluded: M.state.evidence.filter((e) => !e.usable_as_verified).slice(0, 1).map((e) => ({ id: e.id, reason: e.status_label })), text: M.answerEvidence.length ? `검증된 근거 ${M.answerEvidence.length}건을 사용했습니다` : '이 질문에 연결할 검증된 근거가 없습니다' },
      next: M.answerEvidence.length
        ? { text: '검증된 근거와 저장된 시도를 바탕으로 조건을 바꿔 재현성 검증을 다시 설계할 수 있습니다', grounded: true }
        : { text: '저장된 이력과 검증된 근거만으로는 다음 경로를 제시할 수 없습니다', grounded: false },
    };
  };

  const routes = {
    'GET /api/health': () => ({ ok: true, counts: {} }),
    'GET /api/attempts': () => ({ attempts: [...M.state.attempts].sort((a, b) => b.id - a.id) }),
    'GET /api/evidence': () => ({ evidence: M.state.evidence.map(evView) }),
    'GET /api/judgments': () => ({ judgments: M.state.judgments.map(jView).reverse() }),
    'GET /api/approvals': () => ({ approvals: [...M.state.approvals].reverse().map(approvalView) }),
    'GET /api/runs': () => ({ runs: [...M.state.runs].reverse() }),
    'GET /api/approval/target': () => ({ path: M.state.targetPath, exists: true, hash: targetHash(), hash_short: short(targetHash()) }),
    'POST /api/chat': (body) => {
      const text = String(body.text || '');
      const kind = /될까요|\?$/.test(text) ? 'question' : /려 합니다|할 예정/.test(text) ? 'plan' : 'execution';
      if (kind !== 'execution') return { kind, saved: false, attempt: null, answer: kind === 'question' ? answer() : undefined, judgment_id: kind === 'question' ? 2 : undefined, extractor: 'fixture' };
      const id = Math.max(0, ...M.state.attempts.map((a) => a.id)) + 1;
      const stageMatch = text.match(/(재현성 검증|행동검증)/);
      const stop = stageMatch ? { raw: stageMatch[1], norm: stageMatch[1] === '행동검증' ? 'behavioral_validation' : 'reproducibility_validation' } : { raw: null, norm: null };
      const a = attempt(id, text, { source: 'live', is_synthetic: false, extractor: 'fixture', stop_stage: stop, condition: { raw: null, norm: null }, occurred_at: '2026-09-30T18:00:00+09:00' });
      M.state.attempts.push(a);
      return { kind, saved: true, attempt: a, auto_record_line: '자동 기록됨 — 대상 RSE-01 / 방법 Western blot / 환경 세포 / 결과 중단', approach: {}, answer: answer(), judgment_id: null, extractor: 'fixture' };
    },
    'POST /api/recheck': () => {
      const e = M.state.evidence.find((x) => x.id === 1);
      const before = e.status;
      const now = '2026-09-30T18:30:00+09:00';
      if (M.recheckOutcome === 'lookup_failed') {
        Object.assign(e, { last_attempt_at: now, last_attempt_ok: false, last_error: 'timeout', latest_check_failed: true });
        return { rechecked_at: now, checked: M.state.evidence.length, results: [{ evidence_id: 1, before, after: e.status, lookup: { mode: 'fresh', ok: false, http_status: null, error: 'timeout' }, flagged_judgment_ids: [] }], flagged_judgment_ids: [] };
      }
      Object.assign(e, { status: 'retracted', status_label: STATUS.retracted, previous_status: before, status_changed_at: now, usable_as_verified: false, last_attempt_at: now,
        retraction: { type: 'retraction', direction: 'this_work_is_retracted', source: 'crossref', notice_doi: '10.9999/fixture.notice', date: M.retractionDate }, is_demo_past_state: false, demo_label: null });
      const flagged = M.state.judgments.filter((j) => j.evidence_ids.includes(1));
      flagged.forEach((j) => Object.assign(j, { needs_review: true, review_reason: '근거 상태 변경: 확인 → 철회됨', review_flagged_at: now }));
      return { rechecked_at: now, checked: M.state.evidence.length,
        results: [{ evidence_id: 1, before, after: 'retracted', lookup: { mode: 'fresh', ok: true, http_status: 200, error: null }, flagged_judgment_ids: flagged.map((j) => j.id) }],
        flagged_judgment_ids: flagged.map((j) => j.id) };
    },
    'POST /api/actions': (body) => {
      if (body.action_type === 'overwrite_original') {
        const id = M.state.approvals.length + 1;
        const a = { id, action_type: 'overwrite_original', description: '원본 측정 파일 original_measurements.csv 을 정규화 버전으로 덮어쓰기', reason: '원본 덮어쓰기는 되돌릴 수 없어 승인이 필요합니다',
          rule_id: 'R-IRREV-OVERWRITE', target_path: M.state.targetPath, status: 'pending', hash_before: targetHash(), hash_after: null, error: null, created_at: '2026-09-30T18:40:00+09:00', decided_at: null };
        M.state.approvals.push(a);
        return { status: 202, body: { requires_approval: true, approval: approvalView(a) } };
      }
      const id = M.state.runs.length + 1;
      const run = { id, action_type: 'run_analysis', description: '원본 측정값 요약 통계 분석', rule_id: 'R-REV-ANALYSIS', status: 'completed',
        result: { input: 'original_measurements.csv', n: 6, mean: 1.2345, original_unchanged: true, original_hash_short: short(targetHash()) }, created_at: '2026-09-30T18:41:00+09:00', completed_at: '2026-09-30T18:41:01+09:00' };
      M.state.runs.push(run);
      return { requires_approval: false, run };
    },
  };
  const approveRe = /^POST \/api\/approvals\/(\d+)\/(approve|reject)$/;

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const key = `${req.method} ${url.pathname}`;
    const json = (status, body) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };
    if (url.pathname.startsWith('/api/')) {
      M.calls.push(key);
      const chunks = []; for await (const c of req) chunks.push(c);
      let body = {}; try { body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {}; } catch { /* keep {} */ }
      if (M.delay[key]) await new Promise((r) => setTimeout(r, M.delay[key]));
      const f = M.fail[key];
      if (f) { if (f.destroy) { req.socket.destroy(); return; } return json(f.status, f.body); }
      const m = key.match(approveRe);
      if (m) {
        const a = M.state.approvals.find((x) => x.id === Number(m[1]));
        if (!a || a.status !== 'pending') return json(409, { error: { code: 'NOT_PENDING', message: 'not pending' } });
        if (m[2] === 'approve') { M.state.targetContent = 'replacement-v2'; Object.assign(a, { status: 'approved', hash_after: targetHash(), decided_at: '2026-09-30T18:45:00+09:00' }); }
        else Object.assign(a, { status: 'rejected', decided_at: '2026-09-30T18:46:00+09:00' });
        return json(200, { approval: approvalView(a) });
      }
      const h = routes[key];
      if (!h) return json(404, { error: { code: 'NOT_FOUND', message: key } });
      const out = h(body);
      return out && out.status && out.body ? json(out.status, out.body) : json(200, out);
    }
    const rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    const file = path.resolve(M.publicDir, rel);
    if (!file.startsWith(M.publicDir + path.sep) || !fs.existsSync(file)) { res.writeHead(404); res.end('nf'); return; }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(fs.readFileSync(file));
  });
  M.server = server;
  M.publicDir = '';
  M.listen = (publicDir) => new Promise((resolve) => { M.publicDir = path.resolve(publicDir); server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`)); });
  M.close = () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); });
  M.targetShort = () => short(targetHash());
  return M;
}

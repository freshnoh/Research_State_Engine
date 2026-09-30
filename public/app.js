// 화면 A/B/C. 모든 값은 API 응답에서만 렌더링한다 (계약: docs/CONTRACT.md §5, §7, §7.1).
// 이 파일에는 시도 수·중단 단계·근거 상태·철회일·hash·성공 여부 같은 "결과 값" 상수가 없다.
// 아래 상수는 표시 문구(라벨)뿐이다.
'use strict';

const STATUS_LABEL = { verified: '확인', mismatch: '서지 불일치', unverifiable: '확인 불가', retracted: '철회됨' };
const STATUS_ICON = { verified: '✓', mismatch: '≠', unverifiable: '?', retracted: '✕' };
const STATUS_TONE = { verified: 'ok', mismatch: 'warn', unverifiable: 'idle', retracted: 'bad' };
const KIND_LABEL = { execution: '실행 결과', plan: '계획', question: '질문', hypothesis: '가설·구상', other: '기타' };
const MATCH_LABEL = { same: '같은 접근', exact_repeat: '완전 반복', adjacent: '인접 시도', undetermined: '미확정' };
const APPROVAL_TONE = { pending: 'warn', approved: 'ok', rejected: 'idle', failed: 'bad' };
const RUN_LABEL = { completed: '완료', failed: '실패' };
const RUN_KEY_LABEL = {
  input: '입력', column: '열', n: 'n', mean: '평균', sd: '표준편차', cv: 'CV', min: '최소', max: '최대',
  original_unchanged: '원본 변경 없음', original_hash_short: '원본 hash',
};
const NOT_SAVED_NOTE = { plan: '계획 발화라 기록하지 않았습니다', question: '질문 발화라 기록하지 않았습니다', hypothesis: '가설 발화라 기록하지 않았습니다', other: '실행 결과가 아니라 기록하지 않았습니다' };

/* ---------- DOM helpers ---------- */
const $ = (sel, root = document) => root.querySelector(sel);
const tid = (id, root = document) => root.querySelector(`[data-testid="${id}"]`);

function append(el, kids) {
  for (const k of kids) {
    if (k == null || k === false) continue;
    if (Array.isArray(k)) append(el, k);
    else el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
}
function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  append(el, kids);
  return el;
}
function fill(el, ...kids) { el.replaceChildren(); append(el, kids); }
const badge = (tone, text, extra) => h('span', { class: `badge b-${tone}`, ...extra }, text);
const fmtTime = (iso) => (iso ? String(iso).slice(0, 16).replace('T', ' ') : '미상');
const fmtDate = (iso) => (iso ? String(iso).slice(0, 10) : '미상');
const orUnknown = (v) => (v == null || v === '' ? '미상' : v);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/* ---------- API ---------- */
class ApiError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
async function api(path, { method = 'GET', body, timeout = 20000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  let res;
  try {
    res = await fetch(path, {
      method, signal: ctrl.signal,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (e) {
    throw new ApiError(0, e.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK',
      e.name === 'AbortError' ? '응답 시간이 초과되었습니다' : '서버에 연결하지 못했습니다');
  } finally { clearTimeout(timer); }
  let data = null;
  try { data = await res.json(); } catch { /* 본문이 JSON 이 아님 */ }
  if (!res.ok) {
    const e = data && data.error;
    throw new ApiError(res.status, (e && e.code) || `HTTP_${res.status}`, (e && e.message) || `HTTP ${res.status}`);
  }
  if (!isObj(data)) throw new ApiError(res.status, 'INVALID_RESPONSE', '응답 형식이 올바르지 않습니다');
  return data;
}
const errText = (e) => (e instanceof ApiError
  ? `${e.code}${e.status ? ` (HTTP ${e.status})` : ''} — ${e.message}` : String(e && e.message ? e.message : e));
function need(cond, what) { if (!cond) throw new ApiError(200, 'INVALID_RESPONSE', `응답 형식 오류: ${what}`); }

/* ---------- 상태 표시줄 (idle / loading / success / error) ---------- */
function setStatus(area, state, text) {
  const el = tid(`${area}-status`);
  el.dataset.state = state;
  $('.status-text', el).textContent = text;
  el.setAttribute('role', state === 'error' ? 'alert' : 'status');
}

/* ---------- 상태 ---------- */
const S = {
  a: { log: [], record: null, answer: null, answerFrom: null, busy: false },
  b: { approvals: [], runs: [], target: null, loaded: false, busy: false },
  c: { attempts: [], evidence: [], judgments: [], loaded: false, busy: false, recheck: null },
};

/* =====================================================================
 * 화면 A — 연구 대화
 * ===================================================================== */
function structRows(a) {
  const f = (label, raw, norm) => h('tr', null,
    h('th', null, label), h('td', { class: 'raw' }, orUnknown(raw)), h('td', { class: 'norm' }, norm == null ? '미상' : norm));
  return [
    f('대상', a.target && a.target.raw, a.target && a.target.norm),
    f('방법', a.method && a.method.raw, a.method && a.method.norm),
    f('환경', a.environment && a.environment.raw, a.environment && (a.environment.label || a.environment.norm)),
    f('조건', a.condition && a.condition.raw, a.condition && a.condition.norm),
    f('결과', a.result_label, a.result),
    f('중단 단계', a.stop_stage && a.stop_stage.raw, a.stop_stage && a.stop_stage.norm),
  ];
}
function fallbackRecordLine(a) {
  return `자동 기록됨 — 대상 ${orUnknown(a.target && a.target.raw)} / 방법 ${orUnknown(a.method && a.method.raw)} / 환경 ${orUnknown(a.environment && (a.environment.label || a.environment.raw))} / 결과 ${orUnknown(a.result_label)}`;
}

function renderRecord() {
  const line = tid('auto-record-line');
  const struct = tid('record-struct');
  const rec = S.a.record;
  if (!rec) { fill(struct, ); return; }
  line.textContent = rec.line;
  line.dataset.empty = '0';
  line.dataset.attemptId = rec.attempt.id;
  fill(struct, 
    h('div', { class: 'st-src' }, h('small', null, `원문 → 구조화 (기록 #${rec.attempt.id} · 서버 추출기 ${orUnknown(rec.attempt.extractor)})`), rec.attempt.raw_text),
    h('table', { class: 'st-table', 'aria-label': '원문과 구조화 값' },
      h('thead', null, h('tr', null, h('th', null, '항목'), h('th', null, '원문 표기'), h('th', null, '정규화 값'))),
      h('tbody', null, structRows(rec.attempt))),
  );
}

function renderTried(ans) {
  const box = tid('answer-tried');
  if (!ans || !isObj(ans.tried)) {
    fill(box, h('p', { class: 'muted' }, ans ? '이 응답에는 “이미 해본 것”이 포함되지 않았습니다.' : '질문을 보내면 저장된 시도 이력에서 계산한 결과가 여기에 나옵니다.'));
    return;
  }
  const t = ans.tried;
  const chips = [];
  if (t.match) chips.push(h('span', { class: 'chip' }, '판정', h('b', null, MATCH_LABEL[t.match] || t.match)));
  if (t.count != null) chips.push(h('span', { class: 'chip', 'data-testid': 'tried-count' }, '같은 접근', h('b', null, `${t.count}건`)));
  if (t.stop_stage) chips.push(h('span', { class: 'chip' }, '중단 단계', h('b', null, t.stop_stage)));
  fill(box, 
    h('p', { class: 'big' }, orUnknown(t.text)),
    chips.length ? h('div', { class: 'chips' }, chips) : null,
    Array.isArray(t.attempt_ids) && t.attempt_ids.length
      ? h('p', { class: 'muted' }, `근거 시도: ${t.attempt_ids.map((i) => `#${i}`).join(' ')}`) : null,
  );
}
function renderEvidenceAnswer(ans) {
  const box = tid('answer-evidence');
  if (!ans || !isObj(ans.evidence)) {
    fill(box, h('p', { class: 'muted' }, ans ? '이 응답에는 “근거 상태”가 포함되지 않았습니다.' : '검증된 근거만 근거로 셉니다. 확인되지 않은 근거는 이력에 남고 근거 집합에서 빠집니다.'));
    return;
  }
  const ev = ans.evidence;
  const items = Array.isArray(ev.items) ? ev.items : [];
  const excluded = Array.isArray(ev.excluded) ? ev.excluded : [];
  fill(box, 
    items.length
      ? badge('ok', `✓ 검증된 근거 ${items.length}건`)
      : badge('warn', '△ 근거 부족 — 검증된 근거 0건'),
    ev.text ? h('p', { style: 'margin-top:10px' }, ev.text) : null,
    ...items.map((e) => h('div', { class: 'ev-item' },
      h('div', { class: 't' }, orUnknown(e.input && e.input.title)),
      h('div', { class: 'd' }, `${orUnknown(e.input && e.input.doi)} · ${e.status_label || STATUS_LABEL[e.status] || e.status}`))),
    excluded.length
      ? h('div', { class: 'chips' }, excluded.map((x) => h('span', { class: 'chip' }, `근거 #${x.id} 제외`, h('b', null, orUnknown(x.reason))))) : null,
  );
}
function renderNext(ans) {
  const box = tid('answer-next');
  if (!ans || !isObj(ans.next)) {
    fill(box, h('p', { class: 'muted' }, ans ? '이 응답에는 “다음 후보”가 포함되지 않았습니다.' : '저장된 이력과 검증된 근거가 충분할 때만 후보를 제시합니다.'));
    return;
  }
  fill(box, 
    ans.next.grounded === true ? badge('ok', '✓ 저장 근거 기반') : badge('warn', '△ 근거 부족 — 후보 제시 안 함'),
    h('p', { class: 'big', style: 'margin-top:10px' }, orUnknown(ans.next.text)),
  );
}
function renderAnswer() {
  const { answer, answerFrom } = S.a;
  renderTried(answer); renderEvidenceAnswer(answer); renderNext(answer);
  tid('answer-source').textContent = answerFrom ? `아래 답의 기준 발화: “${answerFrom}”` : '';
}
function renderLog() {
  const list = tid('chat-log');
  fill(list, ...S.a.log.slice().reverse().map((e) => h('li', null,
    e.error ? badge('bad', '오류') : badge(e.saved ? 'ok' : 'idle', e.saved ? '✓ 기록됨' : '기록 안 됨'),
    h('span', { class: 'muted' }, e.error ? '전송 실패' : (KIND_LABEL[e.kind] || e.kind)),
    h('span', null, e.text))));
}

async function sendChat() {
  if (S.a.busy) return;
  const input = tid('chat-input');
  const text = input.value.trim();
  if (!text) { setStatus('a', 'error', '입력이 비어 있습니다'); return; }
  S.a.busy = true;
  const btn = tid('chat-send'); btn.disabled = true; btn.textContent = '처리 중…';
  document.querySelector('.answers').classList.add('is-loading');
  setStatus('a', 'loading', '서버가 발화를 해석하는 중… (이전 결과는 그대로 둡니다)');
  try {
    const r = await api('/api/chat', { method: 'POST', body: { text }, timeout: 120000 });
    need(typeof r.kind === 'string', 'kind');
    need(typeof r.saved === 'boolean', 'saved');
    if (r.saved) need(isObj(r.attempt), 'saved=true 인데 attempt 없음');
    S.a.log.push({ text, kind: r.kind, saved: r.saved });
    if (r.saved) {
      S.a.record = { line: r.auto_record_line || fallbackRecordLine(r.attempt), attempt: r.attempt };
      tid('record-status').textContent = `방금 발화: ${KIND_LABEL[r.kind] || r.kind} → 자동으로 기록했습니다`;
    } else {
      tid('record-status').textContent = `방금 발화: ${KIND_LABEL[r.kind] || r.kind} → ${NOT_SAVED_NOTE[r.kind] || NOT_SAVED_NOTE.other}`;
    }
    if (isObj(r.answer)) { S.a.answer = r.answer; S.a.answerFrom = text; }
    input.value = '';
    renderRecord(); renderAnswer(); renderLog();
    setStatus('a', 'success', r.saved ? '완료 — 기록됨 (저장 버튼 없이 자동)' : `완료 — ${NOT_SAVED_NOTE[r.kind] || NOT_SAVED_NOTE.other}`);
    loadC(true);
  } catch (e) {
    S.a.log.push({ text, kind: 'other', saved: false, error: true });
    renderLog();
    setStatus('a', 'error', `발화를 처리하지 못했습니다: ${errText(e)}`);
  } finally {
    S.a.busy = false; btn.disabled = false; btn.textContent = '보내기';
    document.querySelector('.answers').classList.remove('is-loading');
  }
}

/* =====================================================================
 * 화면 B — 승인 대기열
 * ===================================================================== */
function renderTarget() {
  const t = S.b.target;
  tid('target-hash').textContent = t && t.hash_short ? t.hash_short : '—';
  tid('target-path').textContent = t ? (t.exists ? t.path : `${t.path} (파일 없음)`) : '';
}
function runKv(result) {
  if (!isObj(result)) return null;
  if (result.error) return h('div', { class: 'kv' }, h('span', { class: 'b-bad' }, `오류: ${result.error}`));
  return h('div', { class: 'kv' }, Object.entries(result).map(([k, v]) => h('span', null, `${RUN_KEY_LABEL[k] || k} `, h('b', null, String(v)))));
}
function renderRuns() {
  const box = tid('run-list');
  if (!S.b.runs.length) {
    fill(box, h('div', { class: 'empty' }, S.b.loaded ? '아직 실행된 분석이 없습니다. [분석 실행]은 승인 없이 바로 끝납니다.' : '불러오는 중…'));
    return;
  }
  fill(box, ...S.b.runs.map((r) => h('div', { class: 'run', 'data-testid': 'run-result', 'data-run-id': r.id, 'data-status': r.status },
    h('div', { class: 'run-head' },
      h('span', { class: 't' }, `#${r.id} ${orUnknown(r.description)}`),
      badge(r.status === 'completed' ? 'ok' : 'bad', `${r.status === 'completed' ? '✓' : '✕'} ${RUN_LABEL[r.status] || r.status}`)),
    h('div', { class: 'muted', style: 'font-size:14px' }, `승인 불필요 (${orUnknown(r.rule_id)}) · 완료 ${fmtTime(r.completed_at)}`),
    runKv(r.result))));
}
function hashBox(testid, label, short) {
  return h('div', { class: 'hash-box' }, h('small', null, label),
    h('div', { class: 'hash-val', 'data-testid': testid, 'data-empty': short ? '0' : '1' }, short || '—'));
}
function approvalCard(a) {
  const pending = a.status === 'pending';
  const tone = APPROVAL_TONE[a.status] || 'idle';
  const icon = { pending: '⏸', approved: '✓', rejected: '—', failed: '✕' }[a.status] || '';
  const afterLabel = a.status === 'approved' ? '승인 후 hash' : (a.status === 'rejected' ? '승인 후 hash (거절 — 변경 없음)' : '승인 후 hash (아직 없음)');
  return h('article', { class: 'card', 'data-testid': 'approval-card', 'data-approval-id': a.id, 'data-status': a.status },
    h('div', { class: 'card-head' },
      h('div', { class: 'card-title' }, `#${a.id} ${orUnknown(a.description)}`),
      badge(tone, `${icon} ${a.status_label || a.status}`)),
    h('dl', null,
      h('dt', null, '하려는 작업'), h('dd', null, orUnknown(a.description)),
      h('dt', null, '승인 필요 이유'), h('dd', null, `${orUnknown(a.reason)} (${orUnknown(a.rule_id)})`),
      h('dt', null, '영향 대상'), h('dd', null, orUnknown(a.target_path)),
      h('dt', null, '현재 상태'), h('dd', null, `${a.status_label || a.status} · 요청 ${fmtTime(a.created_at)}${a.decided_at ? ` · 처리 ${fmtTime(a.decided_at)}` : ''}`)),
    h('div', { class: 'hash-pair' },
      hashBox('approval-hash-before', '승인 전 hash (앞 8자리)', a.hash_before_short),
      h('div', { class: 'hash-arrow', 'aria-hidden': 'true' }, '→'),
      hashBox('approval-hash-after', afterLabel, a.hash_after_short)),
    a.error ? h('div', { class: 'err' }, `실행 결과: ${a.error}`) : null,
    pending ? h('div', { class: 'card-actions' },
      h('button', { type: 'button', class: 'btn btn-ok', 'data-testid': 'approve-btn', onclick: () => decide(a.id, 'approve') }, '승인'),
      h('button', { type: 'button', class: 'btn', 'data-testid': 'reject-btn', onclick: () => decide(a.id, 'reject') }, '거절')) : null,
  );
}
function renderApprovals() {
  const box = tid('approval-list');
  tid('approval-count').textContent = S.b.loaded ? `${S.b.approvals.length}건 · 대기 ${S.b.approvals.filter((a) => a.status === 'pending').length}건` : '';
  if (!S.b.approvals.length) {
    fill(box, h('div', { class: 'empty' }, S.b.loaded ? '승인 카드가 없습니다. [원본 덮어쓰기 요청]을 누르면 승인 대기 카드가 생깁니다.' : '불러오는 중…'));
    return;
  }
  fill(box, ...S.b.approvals.map(approvalCard));
}
function renderB() { renderTarget(); renderRuns(); renderApprovals(); }

async function loadB(silent) {
  if (!silent) setStatus('b', 'loading', '승인 대기열을 불러오는 중…');
  try {
    const [ap, ru, ta] = await Promise.all([api('/api/approvals'), api('/api/runs'), api('/api/approval/target')]);
    need(Array.isArray(ap.approvals), 'approvals[]');
    need(Array.isArray(ru.runs), 'runs[]');
    S.b.approvals = ap.approvals; S.b.runs = ru.runs; S.b.target = ta; S.b.loaded = true;
    renderB();
    if (!silent) setStatus('b', 'success', `불러옴 — 승인 카드 ${ap.approvals.length}건 · 분석 ${ru.runs.length}건`);
    return true;
  } catch (e) {
    if (!silent) setStatus('b', 'error', `승인 대기열을 불러오지 못했습니다: ${errText(e)}`);
    return false;
  }
}
async function bAction(label, fn) {
  if (S.b.busy) return;
  S.b.busy = true;
  const btns = document.querySelectorAll('#screen-b button');
  btns.forEach((b) => { b.disabled = true; });
  document.querySelector('[data-testid="approval-list"]').classList.add('is-loading');
  setStatus('b', 'loading', `${label} 처리 중…`);
  try {
    const msg = await fn();
    const ok = await loadB(true);
    if (ok) setStatus('b', 'success', msg);
    else setStatus('b', 'error', `${label}는 처리됐으나 목록을 다시 불러오지 못했습니다`);
  } catch (e) {
    setStatus('b', 'error', `${label} 실패: ${errText(e)}`);
    await loadB(true);
  } finally {
    S.b.busy = false;
    document.querySelector('[data-testid="approval-list"]').classList.remove('is-loading');
    document.querySelectorAll('#screen-b button').forEach((b) => { b.disabled = false; });
  }
}
function requestOverwrite() {
  return bAction('원본 덮어쓰기 요청', async () => {
    const r = await api('/api/actions', { method: 'POST', body: { action_type: 'overwrite_original' } });
    need(r.requires_approval === true && isObj(r.approval), 'requires_approval=true + approval');
    return `승인 대기 카드 #${r.approval.id} 생성 — 승인 전에는 원본이 바뀌지 않습니다 (요청 시 hash ${r.approval.hash_before_short})`;
  });
}
function runAnalysis() {
  return bAction('분석 실행', async () => {
    const r = await api('/api/actions', { method: 'POST', body: { action_type: 'run_analysis' } });
    need(r.requires_approval === false && isObj(r.run), 'requires_approval=false + run');
    return `독립 분석 #${r.run.id} ${RUN_LABEL[r.run.status] || r.run.status} — 승인 대기와 무관하게 진행`;
  });
}
function decide(id, verb) {
  const word = verb === 'approve' ? '승인' : '거절';
  return bAction(`카드 #${id} ${word}`, async () => {
    const r = await api(`/api/approvals/${encodeURIComponent(id)}/${verb}`, { method: 'POST' });
    need(isObj(r.approval), 'approval');
    const a = r.approval;
    if (verb === 'approve') {
      need(a.status !== 'pending', '승인 후에도 pending');
      if (a.status === 'failed') throw new ApiError(200, 'APPROVE_FAILED', a.error || '실행 실패');
      return `승인 완료 — hash ${a.hash_before_short} → ${orUnknown(a.hash_after_short)}`;
    }
    return `거절 완료 — 원본은 바뀌지 않았습니다 (hash ${a.hash_before_short} 유지)`;
  });
}

/* =====================================================================
 * 화면 C — 연구 상태 / Evidence Workspace
 * ===================================================================== */
function statusBadge(e) {
  const st = e.status;
  return badge(STATUS_TONE[st] || 'idle', `${STATUS_ICON[st] || ''} ${e.status_label || STATUS_LABEL[st] || st}`);
}
function evidenceRow(e, judgments) {
  const linked = judgments.filter((j) => j.evidence.some((x) => x.id === e.id));
  const notes = [];
  if (e.retraction) {
    const r = e.retraction;
    notes.push(h('div', { class: 'bad' }, `철회 정보(현재 Crossref): 유형 ${orUnknown(r.type)} · 방향 ${orUnknown(r.direction)} · 철회일 ${orUnknown(r.date)} · 출처 ${orUnknown(r.source)}${r.notice_doi ? ` · 공지 DOI ${r.notice_doi}` : ''}`));
  }
  if (e.previous_status && e.previous_status !== e.status) {
    notes.push(h('div', { class: 'warn' }, `근거 상태 변경: ${STATUS_LABEL[e.previous_status] || e.previous_status} → ${e.status_label || STATUS_LABEL[e.status]} (${fmtTime(e.status_changed_at)})`));
  }
  if (e.status === 'unverifiable') {
    notes.push(h('div', null, `사유: ${orUnknown(e.unverifiable_reason_label)} — DOI 등록을 확인하지 못했습니다. 제목·저자 기준으로 추가 확인이 필요합니다.`));
  }
  if (e.status === 'mismatch' && Array.isArray(e.mismatch_fields) && e.mismatch_fields.length) {
    notes.push(h('div', { class: 'warn' }, `서지 불일치 필드: ${e.mismatch_fields.join(', ')}`));
  }
  if (e.latest_check_failed) {
    notes.push(h('div', { class: 'warn' }, `최신 확인 실패 · 마지막 확인 ${fmtTime(e.last_success_at)} (${orUnknown(e.last_error)}) — 이전 상태를 유지합니다. 조회 실패는 논문 부재를 뜻하지 않습니다.`));
  }
  if (e.excluded_reason) notes.push(h('div', null, `검증 근거 집합에서 제외: ${e.excluded_reason} (이력에는 남아 있습니다)`));
  notes.push(h('div', { class: 'muted' }, `마지막 정상 확인 ${fmtTime(e.last_success_at)} · 최근 조회 ${fmtTime(e.last_attempt_at)}${e.last_attempt_ok === false ? ' (실패)' : ''}`));
  const inp = e.input || {};
  return h('div', { class: 'row', 'data-testid': 'evidence-row', 'data-evidence-id': e.id, 'data-status': e.status },
    h('div', { class: 'row-head' },
      h('div', null,
        h('div', { class: 'row-title' }, orUnknown(inp.title)),
        h('div', { class: 'row-sub' },
          [Array.isArray(inp.authors) && inp.authors.length ? `${inp.authors[0]}${inp.authors.length > 1 ? ' 외' : ''}` : null,
            inp.journal || null, inp.year != null ? String(inp.year) : null].filter(Boolean).join(' · '),
          ' ', h('span', { class: 'mono' }, `DOI ${orUnknown(inp.doi)}`))),
      h('div', { class: 'row-badges' }, statusBadge(e), badge('info', '실제 문헌'))),
    h('div', { class: 'row-notes' }, notes),
    e.demo_label ? h('span', { class: 'demo-label' }, `${e.demo_label}`) : null,
    h('div', { class: 'link-ev' }, linked.length ? `이 근거를 쓴 저장된 판단 ${linked.length}건: ${linked.map((j) => `#${j.id}`).join(' ')}` : '이 근거를 쓴 저장된 판단 없음'),
  );
}
function judgmentRow(j) {
  const review = j.needs_review;
  return h('div', { class: 'row', 'data-testid': 'judgment-row', 'data-judgment-id': j.id, 'data-needs-review': review ? '1' : '0' },
    h('div', { class: 'row-head' },
      h('div', null,
        h('div', { class: 'row-title' }, orUnknown(j.proposal)),
        h('div', { class: 'row-sub' }, `질문: ${orUnknown(j.question)} · 판단 시점 ${fmtDate(j.asked_at)}`)),
      h('div', { class: 'row-badges' },
        review ? badge('warn', '▲ 재검토 필요') : badge('idle', '재검토 표시 없음'),
        j.is_synthetic ? badge('idle', '합성 판단') : null)),
    h('div', { class: 'row-notes' },
      review ? h('div', { class: 'warn' }, `${orUnknown(j.review_reason)} · 표시 ${fmtTime(j.review_flagged_at)} — 과거 판단을 사람이 다시 볼 대상입니다. 판단이 틀렸다는 뜻은 아닙니다.`) : null,
      h('div', null, `연구자 조치: ${orUnknown(j.researcher_action)}`)),
    h('div', { class: 'link-ev' }, '연결된 근거:',
      j.evidence.length ? j.evidence.map((e) => statusBadge(e)) : '없음',
      j.evidence.map((e) => h('span', { class: 'mono', style: 'font-size:14px' }, `#${e.id}`))),
    j.demo_label ? h('span', { class: 'demo-label' }, j.demo_label) : null,
  );
}
function attemptRow(a) {
  const meta = [
    ['대상', a.target && a.target.raw], ['방법', a.method && a.method.raw],
    ['환경', a.environment && (a.environment.label || a.environment.raw)],
    ['조건', a.condition && a.condition.raw], ['중단 단계', a.stop_stage && a.stop_stage.raw],
  ];
  return h('div', { class: 'row', 'data-testid': 'attempt-row', 'data-attempt-id': a.id },
    h('div', { class: 'row-head' },
      h('div', { class: 'row-sub' }, `#${a.id} · ${fmtDate(a.occurred_at)}`),
      h('div', { class: 'row-badges' },
        badge(a.result === 'success' ? 'ok' : (a.result === 'stopped' || a.result === 'failure' ? 'warn' : 'idle'), `결과 ${orUnknown(a.result_label)}`),
        a.is_synthetic ? badge('idle', '합성 이력') : badge('ok', '실시간 입력'))),
    h('p', { class: 'raw-text', 'data-testid': 'attempt-raw' }, a.raw_text),
    h('div', { class: 'attempt-meta' }, meta.map(([k, v]) => h('span', { class: 'chip' }, k, h('b', null, orUnknown(v)))),
      a.approach_key ? h('span', { class: 'chip' }, '접근 키', h('b', { class: 'mono', style: 'font-size:13px' }, a.approach_key)) : h('span', { class: 'chip' }, '접근 키', h('b', null, '미확정'))),
  );
}
function renderC() {
  const { attempts, evidence, judgments, loaded } = S.c;
  const empty = (msg) => h('div', { class: 'empty' }, loaded ? msg : '불러오는 중…');
  tid('evidence-count').textContent = loaded ? `${evidence.length}건` : '';
  tid('judgment-count').textContent = loaded ? `${judgments.length}건 · 재검토 필요 ${judgments.filter((j) => j.needs_review).length}건` : '';
  tid('attempt-count').textContent = loaded ? `${attempts.length}건` : '';
  fill(tid('evidence-list'), ...(evidence.length ? evidence.map((e) => evidenceRow(e, judgments)) : [empty('저장된 근거가 없습니다.')]));
  fill(tid('judgment-list'), ...(judgments.length ? judgments.map(judgmentRow) : [empty('저장된 판단이 없습니다.')]));
  fill(tid('attempt-list'), ...(attempts.length ? attempts.map(attemptRow) : [empty('저장된 시도가 없습니다.')]));
}
function renderRecheck() {
  const box = tid('recheck-summary');
  const r = S.c.recheck;
  if (!r) { box.hidden = true; return; }
  box.hidden = false;
  fill(box, 
    h('div', { class: 'panel-title' }, h('span', null, '방금 재검사 결과'),
      h('span', { class: 'panel-sub' }, `${fmtTime(r.rechecked_at)} · 대상 ${r.checked}건`)),
    ...r.results.map((x) => {
      const l = x.lookup || {};
      const flagged = Array.isArray(x.flagged_judgment_ids) ? x.flagged_judgment_ids : [];
      return h('div', { class: 'rs-line', 'data-testid': 'recheck-result', 'data-evidence-id': x.evidence_id },
        h('b', null, `근거 #${x.evidence_id}`),
        badge(STATUS_TONE[x.before] || 'idle', STATUS_LABEL[x.before] || orUnknown(x.before)), '→',
        badge(STATUS_TONE[x.after] || 'idle', STATUS_LABEL[x.after] || orUnknown(x.after)),
        h('span', { class: 'muted' }, `Crossref ${l.mode === 'fresh' ? '현재 조회' : orUnknown(l.mode)} · ${l.ok ? `HTTP ${orUnknown(l.http_status)}` : `조회 실패 (${orUnknown(l.error)}) — 기존 확인 상태를 덮어쓰지 않음, 논문 부재를 뜻하지 않음`}`),
        flagged.length ? badge('warn', `▲ 재검토 필요로 표시된 판단 ${flagged.map((i) => `#${i}`).join(' ')}`) : null);
    }),
  );
}

async function loadC(silent) {
  if (!silent) setStatus('c', 'loading', '연구 상태를 불러오는 중…');
  try {
    const [at, ev, ju] = await Promise.all([api('/api/attempts'), api('/api/evidence'), api('/api/judgments')]);
    need(Array.isArray(at.attempts), 'attempts[]');
    need(Array.isArray(ev.evidence), 'evidence[]');
    need(Array.isArray(ju.judgments), 'judgments[]');
    ju.judgments.forEach((j) => { if (!Array.isArray(j.evidence)) j.evidence = []; });
    S.c.attempts = at.attempts; S.c.evidence = ev.evidence; S.c.judgments = ju.judgments; S.c.loaded = true;
    renderC();
    if (!silent) setStatus('c', 'success', `불러옴 — 시도 ${at.attempts.length} · 근거 ${ev.evidence.length} · 판단 ${ju.judgments.length}`);
    return true;
  } catch (e) {
    if (!silent) setStatus('c', 'error', `연구 상태를 불러오지 못했습니다 (기존 화면 유지): ${errText(e)}`);
    return false;
  }
}
async function recheck() {
  if (S.c.busy) return;
  S.c.busy = true;
  const btn = tid('recheck-btn'); btn.disabled = true; btn.textContent = '재검사 중…';
  document.querySelector('[data-testid="evidence-list"]').classList.add('is-loading');
  setStatus('c', 'loading', '현재 Crossref 를 다시 조회하는 중… (기존 상태는 그대로 둡니다)');
  try {
    const r = await api('/api/recheck', { method: 'POST', body: {}, timeout: 60000 });
    need(Array.isArray(r.results), 'results[]');
    need(typeof r.checked === 'number', 'checked');
    S.c.recheck = r;
    const ok = await loadC(true);
    renderRecheck();
    const changed = r.results.filter((x) => x.before !== x.after).length;
    const flagged = Array.isArray(r.flagged_judgment_ids) ? r.flagged_judgment_ids.length : 0;
    if (ok) setStatus('c', 'success', `재검사 완료 — ${r.checked}건 조회 · 상태 변경 ${changed}건 · 재검토 필요 표시 ${flagged}건`);
    else setStatus('c', 'error', '재검사는 처리됐으나 목록을 다시 불러오지 못했습니다 (표시가 최신이 아닐 수 있음)');
  } catch (e) {
    setStatus('c', 'error', `재검사 실패 — 기존 근거·판단 표시는 그대로입니다. 조회 실패는 논문 부재를 뜻하지 않습니다: ${errText(e)}`);
  } finally {
    S.c.busy = false; btn.disabled = false; btn.textContent = '지금 재검사';
    document.querySelector('[data-testid="evidence-list"]').classList.remove('is-loading');
  }
}

/* =====================================================================
 * 내비게이션 / 시작
 * ===================================================================== */
function show(screen) {
  if (!['a', 'b', 'c'].includes(screen)) screen = 'a';
  document.querySelectorAll('.screen').forEach((s) => { s.hidden = s.dataset.screen !== screen; });
  document.querySelectorAll('.nav-item').forEach((n) => {
    if (n.dataset.screen === screen) n.setAttribute('aria-current', 'page'); else n.removeAttribute('aria-current');
  });
  if (location.hash !== `#${screen}`) history.replaceState(null, '', `#${screen}`);
  if (screen === 'b') loadB(true);
  if (screen === 'c') loadC(true);
}

document.querySelectorAll('.nav-item').forEach((n) => n.addEventListener('click', () => show(n.dataset.screen)));
tid('chat-send').addEventListener('click', sendChat);
tid('chat-input').addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter' && !ev.shiftKey && !ev.isComposing) { ev.preventDefault(); sendChat(); }
});
tid('request-overwrite').addEventListener('click', requestOverwrite);
tid('run-analysis').addEventListener('click', runAnalysis);
tid('recheck-btn').addEventListener('click', recheck);

renderRecord(); renderAnswer(); renderLog(); renderB(); renderC();
show((location.hash || '#a').slice(1));
loadC(false);
loadB(false);

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
  original_unchanged: '원본 변경 없음', original_hash_short: '원본 확인값',
};
const NOT_SAVED_NOTE = {
  plan: '계획이라 연구 시도 건수에 추가하지 않았습니다', question: '질문이라 연구 시도 건수에 추가하지 않았습니다',
  hypothesis: '가설이라 연구 시도 건수에 추가하지 않았습니다', other: '실제 실행 결과가 아니라 연구 시도 건수에 추가하지 않았습니다',
};
// 표시용 라벨 (정규화 코드 → 사람이 읽는 이름). 없으면 원문/코드를 그대로 쓴다.
const METHOD_LABEL = { western_blot: 'Western blot', qpcr: 'qPCR', elisa: 'ELISA' };
const APPROVAL_LABEL = { pending: '승인 대기', approved: '변경 완료', rejected: '거절됨 — 변경 없음', failed: '실행 안 됨' };
const ACTION_LABEL = { overwrite_original: '원래 측정값 파일을 계산된 값으로 바꾸기' };
const ACTION_EXPLAIN = { overwrite_original: '원래 측정값이 들어 있는 파일을 계산 후 변환된 값으로 교체합니다.' };
const ACTION_WHY = { overwrite_original: '원래 측정값이 바뀌므로 먼저 사람의 확인이 필요합니다.' };
const baseName = (p) => (p ? String(p).split(/[\\/]/).pop() : null);

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
// 마지막 글자 받침 유무로 은/는 선택
const topicJosa = (w) => { const c = String(w).charCodeAt(String(w).length - 1) - 0xac00; return c >= 0 && c < 11172 && c % 28 ? '은' : '는'; };

/* ---------- API ---------- */
class ApiError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
async function api(path, { method = 'GET', body, timeout = 20000, headers } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  let res;
  try {
    res = await fetch(path, {
      method, signal: ctrl.signal,
      headers: body === undefined ? headers : { 'content-type': 'application/json', ...headers },
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
  const head = tid('record-head');
  const rec = S.a.record;
  if (!rec) { fill(struct, ); head.hidden = true; return; }
  const a = rec.attempt;
  // 첫 시선: 새 연구 시도 1건 + 구조화 결과 (모두 저장된 attempt 값에서 렌더링)
  const kv = [
    ['대상', a.target && (a.target.norm || a.target.raw)],
    ['방법', a.method && (METHOD_LABEL[a.method.norm] || a.method.raw || a.method.norm)],
    ['환경', a.environment && (a.environment.label || a.environment.raw)],
    ['결과', a.result_label],
    ['중단 단계', a.stop_stage && (a.stop_stage.raw || a.stop_stage.norm)],
  ];
  // 세부값이 미상인 실행 기록 안내 (추측으로 채우지 않았음을 설명). 같은 접근 비교 불가는 approach_key 가 없을 때만.
  const missing = [
    !(a.method && a.method.norm) ? '방법' : null,
    !(a.environment && a.environment.norm) ? '환경' : null,
    a.result === 'unknown' ? '결과' : null,
  ].filter(Boolean);
  head.hidden = false;
  head.classList.toggle('is-older', !rec.latest);
  fill(head,
    h('div', { class: 'rh-title' }, rec.latest ? '✓ 새 연구 시도 1건 기록됨' : '최근 기록된 연구 시도 (방금 발화는 연구 시도로 추가되지 않았습니다)'),
    h('div', { class: 'rh-kv' }, kv.map(([k, v]) => h('span', null, h('small', null, k), h('b', null, orUnknown(v))))),
    missing.length ? h('div', { class: 'rh-note' },
      `실제로 수행한 연구라는 사실은 기록했습니다. 말하지 않은 ${missing.join('·')}${topicJosa(missing[missing.length - 1])} 추측하지 않고 미상으로 남겼습니다.`) : null,
    !a.approach_key ? h('div', { class: 'rh-note' }, '세부 정보가 부족해 같은 접근 비교에는 아직 사용할 수 없습니다.') : null);
  line.textContent = rec.line;
  line.dataset.empty = '0';
  line.dataset.attemptId = a.id;
  // 보조 정보: 원문 · 원문 표기/정규화 값 · 추출기 (작게)
  fill(struct,
    h('div', { class: 'st-src' }, h('small', null, `원문 (기록 #${a.id} · 서버 추출기 ${orUnknown(a.extractor)})`), a.raw_text),
    h('table', { class: 'st-table', 'aria-label': '원문과 구조화 값' },
      h('thead', null, h('tr', null, h('th', null, '항목'), h('th', null, '원문 표기'), h('th', null, '정규화 값'))),
      h('tbody', null, structRows(a))),
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
    h('div', { class: 'asof' }, S.a.answerStale
      ? '방금 전 질문 기준 — 그 뒤 새 연구 시도가 기록됐습니다. 다시 물으면 최신 건수로 계산합니다.'
      : '방금 전 질문 기준'),
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
  // 논문 근거가 없다는 것이지 실험 이력이 불확실하다는 뜻이 아니다
  const hasHistory = isObj(ans.tried) && ans.tried.count > 0;
  fill(box,
    items.length
      ? badge('ok', `✓ 검증된 근거 ${items.length}건`)
      : badge('idle', '연결된 논문 근거 없음'),
    !items.length && hasHistory
      ? h('p', { style: 'margin-top:10px' }, '실험 이력은 있습니다. 다만 이 접근과 연결해 둔 논문 근거는 없습니다.')
      : (ev.text ? h('p', { style: 'margin-top:10px' }, ev.text) : null),
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
  if (ans.next.grounded !== true) {
    fill(box, h('p', { class: 'big' }, '검증된 논문 근거가 없어 다음 경로는 제안하지 않습니다'));
    return;
  }
  fill(box, badge('ok', '✓ 저장 근거 기반'), h('p', { class: 'big', style: 'margin-top:10px' }, orUnknown(ans.next.text)));
}
function renderAnswer() {
  const { answer, answerFrom } = S.a;
  renderTried(answer); renderEvidenceAnswer(answer); renderNext(answer);
  tid('answer-source').textContent = answerFrom ? `아래 답은 방금 전 질문 기준입니다: “${answerFrom}”` : '';
  document.querySelector('.answers').classList.toggle('is-stale', !!S.a.answerStale);
}
function renderLog() {
  const list = tid('chat-log');
  fill(list, ...S.a.log.slice().reverse().map((e) => h('li', null,
    e.error ? badge('bad', '오류') : badge(e.saved ? 'ok' : 'idle', e.saved ? '✓ 시도 기록' : '시도 추가 안 됨'),
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
      S.a.record = { line: r.auto_record_line || fallbackRecordLine(r.attempt), attempt: r.attempt, latest: true };
      tid('record-status').textContent = `방금 발화: ${KIND_LABEL[r.kind] || r.kind} → 새 연구 시도로 기록했습니다`;
      if (S.a.answer) S.a.answerStale = true; // 아래 답은 이 기록 이전의 질문 기준
    } else {
      tid('record-status').textContent = `방금 발화: ${KIND_LABEL[r.kind] || r.kind} → ${NOT_SAVED_NOTE[r.kind] || NOT_SAVED_NOTE.other}`;
      if (S.a.record) S.a.record.latest = false;
    }
    if (isObj(r.answer)) { S.a.answer = r.answer; S.a.answerFrom = text; S.a.answerStale = false; }
    input.value = '';
    renderRecord(); renderAnswer(); renderLog();
    setStatus('a', 'success', r.saved ? '완료 — 새 연구 시도 1건 기록됨 (저장 버튼 없이)' : `완료 — ${NOT_SAVED_NOTE[r.kind] || NOT_SAVED_NOTE.other}`);
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
  tid('target-path').textContent = t ? (t.exists ? `원래 측정값 파일 · ${t.path}` : `${t.path} (파일 없음)`) : '';
}
function runKv(result) {
  if (!isObj(result)) return null;
  if (result.error) return h('div', { class: 'kv' }, h('span', { class: 'b-bad' }, `오류: ${result.error}`));
  return h('div', { class: 'kv' }, Object.entries(result).map(([k, v]) => h('span', null, `${RUN_KEY_LABEL[k] || k} `, h('b', null, String(v)))));
}
function renderRuns() {
  const box = tid('run-list');
  if (!S.b.runs.length) {
    fill(box, h('div', { class: 'empty' }, S.b.loaded ? '아직 실행된 분석이 없습니다. 원본을 바꾸지 않는 분석은 승인 없이 바로 끝납니다.' : '불러오는 중…'));
    return;
  }
  fill(box, ...S.b.runs.map((r) => h('div', { class: 'run', 'data-testid': 'run-result', 'data-run-id': r.id, 'data-status': r.status },
    h('div', { class: 'run-head' },
      h('span', { class: 't' }, `#${r.id} ${orUnknown(r.description)}`),
      badge(r.status === 'completed' ? 'ok' : 'bad', `${r.status === 'completed' ? '✓' : '✕'} ${RUN_LABEL[r.status] || r.status}`)),
    h('div', { class: 'muted', style: 'font-size:14px' }, `원본을 바꾸지 않아 바로 실행됨 · 완료 ${fmtTime(r.completed_at)} · 규칙 ${orUnknown(r.rule_id)}`),
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
  const afterLabel = a.status === 'approved' ? '변경 후 확인값' : (a.status === 'rejected' ? '변경 후 확인값 (거절 — 변경 없음)' : '변경 후 확인값 (승인 전이라 아직 없음)');
  const stLabel = APPROVAL_LABEL[a.status] || a.status_label || a.status;
  const changed = a.hash_before_short && a.hash_after_short && a.hash_before_short !== a.hash_after_short;
  const hashNote = a.status === 'pending' ? '승인 전이라 원래 파일은 그대로입니다.'
    : (changed ? '확인값이 달라졌습니다 → 실제 파일 내용이 바뀌었습니다.' : (a.status === 'rejected' ? '거절했으므로 원래 파일은 그대로입니다.' : null));
  return h('article', { class: 'card', 'data-testid': 'approval-card', 'data-approval-id': a.id, 'data-status': a.status },
    h('div', { class: 'card-head' },
      h('div', { class: 'card-title' }, `#${a.id} ${ACTION_LABEL[a.action_type] || orUnknown(a.description)}`),
      badge(tone, `${icon} ${stLabel}`)),
    h('dl', null,
      h('dt', null, '하려는 작업'), h('dd', null, ACTION_EXPLAIN[a.action_type] || orUnknown(a.description),
        h('div', { class: 'dd-sub' }, orUnknown(a.description))),
      h('dt', null, '왜 확인이 필요한가'), h('dd', null, ACTION_WHY[a.action_type] || orUnknown(a.reason),
        h('div', { class: 'dd-sub' }, `규칙: ${orUnknown(a.reason)} (${orUnknown(a.rule_id)})`)),
      h('dt', null, '바뀌는 파일'), h('dd', null, h('b', null, orUnknown(baseName(a.target_path))),
        h('div', { class: 'dd-sub mono' }, orUnknown(a.target_path))),
      h('dt', null, '현재 상태'), h('dd', null, `${stLabel} · 요청 ${fmtTime(a.created_at)}${a.decided_at ? ` · 처리 ${fmtTime(a.decided_at)}` : ''}`)),
    h('div', { class: 'hash-pair' },
      hashBox('approval-hash-before', '변경 전 확인값', a.hash_before_short),
      h('div', { class: 'hash-arrow', 'aria-hidden': 'true' }, '→'),
      hashBox('approval-hash-after', afterLabel, a.hash_after_short)),
    hashNote ? h('div', { class: changed ? 'hash-note changed' : 'hash-note' }, hashNote) : null,
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
    fill(box, h('div', { class: 'empty' }, S.b.loaded ? '변경 요청이 없습니다. [원본 측정값 파일 바꾸기]를 누르면 승인을 기다리는 변경 요청이 생깁니다.' : '불러오는 중…'));
    return;
  }
  fill(box, ...S.b.approvals.map(approvalCard));
}
function renderB() { renderTarget(); renderRuns(); renderApprovals(); }

async function loadB(silent) {
  if (!silent) setStatus('b', 'loading', '원본 변경 요청을 불러오는 중…');
  try {
    const [ap, ru, ta] = await Promise.all([api('/api/approvals'), api('/api/runs'), api('/api/approval/target')]);
    need(Array.isArray(ap.approvals), 'approvals[]');
    need(Array.isArray(ru.runs), 'runs[]');
    S.b.approvals = ap.approvals; S.b.runs = ru.runs; S.b.target = ta; S.b.loaded = true;
    renderB();
    if (!silent) setStatus('b', 'success', `불러옴 — 변경 요청 ${ap.approvals.length}건 · 분석 ${ru.runs.length}건`);
    return true;
  } catch (e) {
    if (!silent) setStatus('b', 'error', `원본 변경 요청을 불러오지 못했습니다: ${errText(e)}`);
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
    else setStatus('b', 'error', `${label}${topicJosa(label)} 처리됐으나 목록을 다시 불러오지 못했습니다`);
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
  return bAction('원본 측정값 파일 바꾸기 요청', async () => {
    const r = await api('/api/actions', { method: 'POST', body: { action_type: 'overwrite_original' } });
    need(r.requires_approval === true && isObj(r.approval), 'requires_approval=true + approval');
    return `변경 요청 #${r.approval.id} 생성 — 승인 전에는 원본이 바뀌지 않습니다 (현재 확인값 ${r.approval.hash_before_short})`;
  });
}
function runAnalysis() {
  return bAction('분석 실행', async () => {
    const r = await api('/api/actions', { method: 'POST', body: { action_type: 'run_analysis' } });
    need(r.requires_approval === false && isObj(r.run), 'requires_approval=false + run');
    return `원본을 바꾸지 않는 분석 #${r.run.id} ${RUN_LABEL[r.run.status] || r.run.status} — 변경 요청이 대기 중이어도 바로 실행`;
  });
}
function decide(id, verb) {
  const word = verb === 'approve' ? '승인' : '거절';
  return bAction(`변경 요청 #${id} ${word}`, async () => {
    const r = await api(`/api/approvals/${encodeURIComponent(id)}/${verb}`, { method: 'POST' });
    need(isObj(r.approval), 'approval');
    const a = r.approval;
    if (verb === 'approve') {
      need(a.status !== 'pending', '승인 후에도 pending');
      if (a.status === 'failed') throw new ApiError(200, 'APPROVE_FAILED', a.error || '실행 실패');
      return `변경 완료 — 파일 확인값 ${a.hash_before_short} → ${orUnknown(a.hash_after_short)}`;
    }
    return `거절 완료 — 원본은 바뀌지 않았습니다 (확인값 ${a.hash_before_short} 유지)`;
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
    notes.push(h('div', { class: 'bad' }, `공개 실제 데이터(Crossref)에서 철회 확인: 이 논문은 ${orUnknown(r.date)}에 철회되었습니다.`));
    notes.push(h('div', { class: 'muted small' }, `상세: 유형 ${orUnknown(r.type)} · 방향 ${orUnknown(r.direction)} · 출처 ${orUnknown(r.source)}${r.notice_doi ? ` · 공지 DOI ${r.notice_doi}` : ''}`));
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
  notes.push(h('div', { class: 'muted small' }, `마지막 정상 확인 ${fmtTime(e.last_success_at)} · 최근 조회 ${fmtTime(e.last_attempt_at)}${e.last_attempt_ok === false ? ' (실패)' : ''}`));
  const inp = e.input || {};
  return h('div', { class: 'row', 'data-testid': 'evidence-row', 'data-evidence-id': e.id, 'data-status': e.status },
    h('div', { class: 'row-head' },
      h('div', null,
        h('div', { class: 'row-title' }, orUnknown(inp.title)),
        h('div', { class: 'row-sub' },
          [Array.isArray(inp.authors) && inp.authors.length ? `${inp.authors[0]}${inp.authors.length > 1 ? ' 외' : ''}` : null,
            inp.journal || null, inp.year != null ? String(inp.year) : null].filter(Boolean).join(' · '),
          ' ', h('span', { class: 'mono' }, `DOI ${orUnknown(inp.doi)}`))),
      h('div', { class: 'row-badges' }, statusBadge(e), badge('info', '공개 실제 논문'))),
    h('div', { class: 'row-notes' }, notes),
    e.demo_label ? h('span', { class: 'demo-label' }, `${e.demo_label}`) : null,
    e.is_demo_past_state && e.status === 'verified' ? h('div', { class: 'link-ev' }, '당시 사용한 논문 상태: 확인 (철회 이전 시점)') : null,
    h('div', { class: 'link-ev' }, linked.length ? `이 논문을 근거로 한 과거 판단 ${linked.length}건: ${linked.map((j) => `#${j.id}`).join(' ')}` : '이 논문을 근거로 한 저장된 판단 없음'),
    e.status === 'retracted' && linked.some((j) => j.needs_review)
      ? h('div', { class: 'link-ev warn-text' }, `이 논문을 사용한 과거 판단 ${linked.filter((j) => j.needs_review).length}건 → 재검토 필요`) : null,
  );
}
function judgmentRow(j) {
  const review = j.needs_review;
  return h('div', { class: 'row', 'data-testid': 'judgment-row', 'data-judgment-id': j.id, 'data-needs-review': review ? '1' : '0' },
    j.is_synthetic ? h('div', { class: 'syn-head' },
      h('b', null, `시연용 과거 판단 · ${fmtDate(j.asked_at)}`),
      h('span', null, '현재 대화와 별개로 미리 준비된 합성 과거 기록입니다.')) : null,
    h('div', { class: 'row-head' },
      h('div', null,
        h('div', { class: 'row-title' }, orUnknown(j.proposal)),
        h('div', { class: 'row-sub' }, `질문: ${orUnknown(j.question)} · 판단 시점 ${fmtDate(j.asked_at)}`)),
      h('div', { class: 'row-badges' },
        review ? badge('warn', '▲ 재검토 필요') : badge('idle', '재검토 표시 없음'),
        j.is_synthetic ? badge('idle', '시연용 과거 기록') : null)),
    h('div', { class: 'row-notes' },
      review ? h('div', { class: 'warn' }, `${orUnknown(j.review_reason)} · 표시 ${fmtTime(j.review_flagged_at)} — 과거 판단을 사람이 다시 볼 대상입니다. 판단이 틀렸다는 뜻은 아닙니다.`) : null,
      h('div', null, `연구자 조치: ${orUnknown(j.researcher_action)}`)),
    h('div', { class: 'link-ev' }, '근거로 사용한 논문:',
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
        a.is_synthetic ? badge('idle', '시연용 과거 기록') : badge('ok', '현재 대화에서 기록'))),
    h('p', { class: 'raw-text', 'data-testid': 'attempt-raw' }, a.raw_text),
    h('div', { class: 'attempt-meta' }, meta.map(([k, v]) => h('span', { class: 'chip' }, k, h('b', null, orUnknown(v)))),
      a.approach_key ? h('span', { class: 'chip' }, '접근 키', h('b', { class: 'mono', style: 'font-size:13px' }, a.approach_key)) : h('span', { class: 'chip' }, '같은 접근 비교', h('b', null, '세부 정보 부족 — 아직 사용 안 함'))),
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
  if (!S.c.busy) tid('recheck-btn').textContent = recheckLabel();
  renderTimeline();
}
// 버튼 = 등록된 근거 전체를 현재 Crossref 로 다시 조회 (대상 수는 실제 근거 목록 길이)
const recheckLabel = () => (S.c.loaded && S.c.evidence.length ? `등록된 논문 ${S.c.evidence.length}건 현재 상태 확인` : '등록된 논문 현재 상태 확인');

/* ---------- 과거 판단의 근거 타임라인 ----------
 * 가로 → = 시간 흐름 (판단 시점 → 철회 시점 → 현재 확인 시점)
 * 세로 ↓ = 실제 데이터 관계 (판단 ─근거로 사용→ 논문, 철회 논문 ─과거 사용처→ 판단)
 * 모두 실제 judgment↔evidence 링크와 저장값(asked_at · retraction.date · last_attempt_at)에서 그린다. */
const dotDate = (iso) => (iso ? String(iso).slice(0, 10).replace(/-/g, '.') : '미상');
const yearOf = (iso) => (iso ? new Date(iso).getFullYear() : null);
// 판단 시점 이후에 이 근거를 다시 조회했는가 (조회 전이면 당시 상태만 보여 주고 결과를 미리 드러내지 않는다)
const checkedAfter = (e, j) => !!e.last_attempt_at && Date.parse(e.last_attempt_at) > Date.parse(j.asked_at);
function timelinePairs() {
  const byId = new Map(S.c.evidence.map((e) => [e.id, e]));
  return S.c.judgments.flatMap((j) => j.evidence.map((x) => ({ j, e: byId.get(x.id) || x })));
}
function renderTimeline() {
  const pairs = timelinePairs();
  const grid = tid('tl-grid');
  const past = tid('tl-past'); const mid = tid('tl-mid'); const now = tid('tl-now-body'); const found = tid('tl-found');
  if (!pairs.length) {
    fill(past, h('div', { class: 'empty' }, S.c.loaded ? '논문을 근거로 저장한 과거 판단이 없습니다.' : '불러오는 중…'));
    fill(mid); fill(now); fill(found); grid.classList.remove('has-mid');
    tid('tl-now-date').textContent = `${new Date().getFullYear()} · 현재`;
    return;
  }
  fill(past, ...pairs.map(({ j, e }) => {
    const changed = e.previous_status && e.previous_status !== e.status;
    const thenStatus = changed ? e.previous_status : e.status;
    const inp = e.input || {};
    return h('div', { class: 'tl-stack', 'data-testid': 'tl-pair', 'data-judgment-id': j.id, 'data-evidence-id': e.id },
      h('div', { class: 'tl-date' }, dotDate(j.asked_at)),
      h('div', { class: 'tl-card' },
        h('div', { class: 'tl-kind' }, '과거 판단', j.is_synthetic ? h('span', { class: 'tag tag-syn' }, '시연용 과거 판단') : null),
        h('div', { class: 'tl-main' }, orUnknown(j.proposal))),
      h('div', { class: 'tl-down' }, '↓ 이 판단의 근거로 사용'),
      h('div', { class: 'tl-card' },
        h('div', { class: 'tl-kind' }, '논문', h('span', { class: 'tag tag-real' }, '공개 실제 논문')),
        h('div', { class: 'tl-main' }, orUnknown(inp.title)),
        h('div', { class: 'tl-sub' }, [inp.journal, inp.year != null ? String(inp.year) : null].filter(Boolean).join(' · '), ' ', h('span', { class: 'mono' }, `DOI ${orUnknown(inp.doi)}`)),
        h('div', { class: 'tl-then' }, '당시 저장 상태: ', badge(STATUS_TONE[thenStatus] || 'idle', `${STATUS_ICON[thenStatus] || ''} ${STATUS_LABEL[thenStatus] || thenStatus}`))));
  }));
  const retracted = pairs.filter(({ j, e }) => checkedAfter(e, j) && e.status === 'retracted' && e.retraction);
  grid.classList.toggle('has-mid', retracted.length > 0);
  fill(mid, ...retracted.map(({ e }) => h('div', { class: 'tl-stack', 'data-testid': 'tl-retraction' },
    h('div', { class: 'tl-date' }, dotDate(e.retraction.date)),
    h('div', { class: 'tl-card tl-bad' },
      h('div', { class: 'tl-kind' }, '논문 철회', h('span', { class: 'tag tag-real' }, '공개 실제 철회 정보')),
      h('div', { class: 'tl-sub' }, e.retraction.notice_doi ? `철회 공지 DOI ${e.retraction.notice_doi}` : '철회 공지 확인')))));
  const checked = pairs.filter(({ j, e }) => checkedAfter(e, j));
  const lastCheck = checked.map(({ e }) => e.last_attempt_at).sort().pop();
  tid('tl-now-date').textContent = lastCheck ? `${yearOf(lastCheck)} · 현재 확인` : `${new Date().getFullYear()} · 현재`;
  fill(now, ...pairs.map(({ j, e }) => (checkedAfter(e, j)
    ? h('div', { class: 'tl-status', 'data-testid': 'tl-now-status', 'data-status': e.status }, 'Crossref 현재 상태: ', statusBadge(e),
      h('span', { class: 'muted small' }, ` (${fmtTime(e.last_attempt_at)} 조회)`))
    : h('div', { class: 'tl-status muted', 'data-testid': 'tl-now-status', 'data-status': 'pending' }, '아직 현재 상태를 다시 확인하지 않았습니다'))));
  const flaggedPairs = retracted.filter(({ j }) => j.needs_review);
  fill(found, ...flaggedPairs.map(({ j }) => [
    h('div', { class: 'tl-down' }, '↓ 이 철회된 논문을 예전에 어디에 근거로 썼는지 찾음'),
    h('div', { class: 'tl-card tl-found', 'data-testid': 'tl-found-card', 'data-judgment-id': j.id },
      h('div', { class: 'tl-main' }, `${yearOf(j.asked_at)}년 과거 판단 1건 발견`),
      h('div', { class: 'tl-review' }, '▲ 다시 확인 필요'),
      h('div', { class: 'tl-sub' }, '논문이 철회됐다고 과거 판단이 틀렸다는 뜻은 아닙니다. 시스템이 자동으로 결론 내리지 않고, 사람이 다시 보도록 표시합니다.')),
  ]).flat());
}
function renderRecheck() {
  const box = tid('recheck-summary');
  const r = S.c.recheck;
  if (!r) { box.hidden = true; return; }
  box.hidden = false;
  const nChanged = r.results.filter((x) => x.before !== x.after).length;
  const nFlagged = Array.isArray(r.flagged_judgment_ids) ? r.flagged_judgment_ids.length : 0;
  fill(box,
    h('div', { class: 'rs-head', 'data-testid': 'recheck-headline' }, `논문 ${r.checked}건 확인 · 상태가 바뀐 논문 ${nChanged}건 · 다시 확인할 과거 판단 ${nFlagged}건`),
    h('div', { class: 'panel-title rs-detail-title' }, h('span', null, '상세 (논문별 조회 결과)'),
      h('span', { class: 'panel-sub' }, `${fmtTime(r.rechecked_at)} · 대상 ${r.checked}건`)),
    ...r.results.map((x) => {
      const l = x.lookup || {};
      const flagged = Array.isArray(x.flagged_judgment_ids) ? x.flagged_judgment_ids : [];
      return h('div', { class: 'rs-line', 'data-testid': 'recheck-result', 'data-evidence-id': x.evidence_id },
        h('b', null, `근거 #${x.evidence_id}`),
        badge(STATUS_TONE[x.before] || 'idle', STATUS_LABEL[x.before] || orUnknown(x.before)), '→',
        badge(STATUS_TONE[x.after] || 'idle', STATUS_LABEL[x.after] || orUnknown(x.after)),
        h('span', { class: 'muted' }, `Crossref ${l.mode === 'fresh' ? '현재 조회' : orUnknown(l.mode)} · ${l.ok ? `HTTP ${orUnknown(l.http_status)}` : `조회 실패 (${orUnknown(l.error)}) — 기존 확인 상태를 덮어쓰지 않음, 논문 부재를 뜻하지 않음`}`),
        flagged.length ? badge('warn', `▲ 재검토 필요로 표시된 판단 ${flagged.map((i) => `#${i}`).join(' ')}`) : null,
        (() => { // 같은 상태가 반복 확인된 경우: 이전 재검사에서 이미 바뀌었는지 저장값으로 알려 준다
          const ev = S.c.evidence.find((e) => e.id === x.evidence_id);
          return x.before === x.after && ev && ev.previous_status && ev.previous_status !== ev.status && ev.status_changed_at && ev.status_changed_at < r.rechecked_at
            ? h('span', { class: 'muted' }, `(이전 재검사 ${fmtTime(ev.status_changed_at)}에서 이미 ${STATUS_LABEL[ev.previous_status] || ev.previous_status} → ${STATUS_LABEL[ev.status] || ev.status} 상태로 바뀌었습니다)`) : null;
        })());
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
  const btn = tid('recheck-btn'); btn.disabled = true; btn.textContent = '현재 상태 확인 중…';
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
    if (ok) setStatus('c', 'success', `확인 완료 — 논문 ${r.checked}건 · 상태 변경 ${changed}건 · 다시 확인할 과거 판단 ${flagged}건`);
    else setStatus('c', 'error', '재검사는 처리됐으나 목록을 다시 불러오지 못했습니다 (표시가 최신이 아닐 수 있음)');
  } catch (e) {
    setStatus('c', 'error', `재검사 실패 — 기존 근거·판단 표시는 그대로입니다. 조회 실패는 논문 부재를 뜻하지 않습니다: ${errText(e)}`);
  } finally {
    S.c.busy = false; btn.disabled = false; btn.textContent = recheckLabel();
    document.querySelector('[data-testid="evidence-list"]').classList.remove('is-loading');
  }
}

/* =====================================================================
 * 발표 초기화 (시연 전용). 서버가 DEMO_MODE 일 때만 표시한다.
 * 성공 응답(서버가 다시 읽은 baseline 검사 통과)을 받은 뒤에만 페이지를 새로 읽어
 * 이전 시연의 화면 상태를 모두 버리고 화면 1을 서버 값으로 다시 그린다.
 * ===================================================================== */
let demoBusy = false;
async function initDemoReset() {
  try {
    const hl = await api('/api/health');
    tid('demo-reset').hidden = hl.demo_mode !== true;
  } catch { tid('demo-reset').hidden = true; }
}
function demoToast(tone, text) {
  const t = tid('demo-toast');
  t.dataset.tone = tone; t.textContent = text; t.hidden = false;
  clearTimeout(demoToast.timer);
  demoToast.timer = setTimeout(() => { t.hidden = true; }, 8000);
}
async function confirmDemoReset() {
  if (demoBusy) return;
  demoBusy = true;
  const dlg = tid('demo-reset-dialog');
  const btns = [tid('demo-reset-btn'), tid('demo-reset-confirm'), tid('demo-reset-cancel')];
  btns.forEach((b) => { b.disabled = true; });
  tid('demo-reset-confirm').textContent = '초기화 중…';
  try {
    const r = await api('/api/demo/reset', { method: 'POST', body: {}, headers: { 'x-rse-demo': 'reset' }, timeout: 30000 });
    need(r.ok === true && isObj(r.baseline) && r.baseline.total > 0 && r.baseline.passed === r.baseline.total, '초기화 사후 검사');
    location.replace('/?demo_reset=ok#a');
    return;
  } catch (e) {
    dlg.close();
    demoToast('bad', `초기화하지 못했습니다: ${errText(e)}`);
  }
  demoBusy = false;
  btns.forEach((b) => { b.disabled = false; });
  tid('demo-reset-confirm').textContent = '초기화';
}
tid('demo-reset-btn').addEventListener('click', () => { if (!demoBusy) tid('demo-reset-dialog').showModal(); });
tid('demo-reset-cancel').addEventListener('click', () => tid('demo-reset-dialog').close());
tid('demo-reset-confirm').addEventListener('click', confirmDemoReset);
if (new URLSearchParams(location.search).get('demo_reset') === 'ok') {
  history.replaceState(null, '', '/#a');
  demoToast('ok', '✓ 발표 시작 상태로 복원했습니다');
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
initDemoReset();

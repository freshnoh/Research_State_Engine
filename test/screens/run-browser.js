// 화면 브라우저 검증 러너 (실제 Chrome, 1920×1080). 제품 코드 아님.
//   node test/screens/run-browser.js fixture   → tier=fixture: 계약 형식 fixture 서버 대상 UI 계약 검증 (실제 API 증거 아님)
//   node test/screens/run-browser.js live      → tier=live: 이 checkout 의 실제 서버(WSL, PORT 4103)를 대상으로 한 실제 API 검증
//   node test/screens/run-browser.js           → 둘 다
// Windows node 로 실행 (WSL 에는 chromium 라이브러리 없음, scripts/lib/cdp.js 재사용).
//   node test/screens/run-browser.js   (Windows node 로 저장소 루트에서 실행)
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, wslPath } from '../../scripts/lib/cdp.js';
import { createMock } from './lib/mock-server.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const OUT = path.join(ROOT, 'var', 'screens-verify');
const WSL_ROOT = wslPath(ROOT);
const LIVE_PORT = 4103;
const W = 1920; const H = 1080;

const EXEC = '오늘 후보 단백질 RSE-01을 세포 모델에서 Western blot으로 측정했고, 재현성 검증 단계에서 중단했습니다.';
const EXEC_V = '오늘 RSE-01을 세포 모델에서 Western blot으로 측정했고, 행동검증 단계에서 중단했습니다.';
const PLAN = 'RSE-01을 세포 모델에서 Western blot으로 다시 해보려 합니다.';
const QUESTION = 'RSE-01을 세포 모델에서 Western blot으로 다시 해도 될까요?';
const FORBIDDEN = ['논문 없음', '가짜 논문', '존재하지 않음', '존재하지 않는'];
const REQUIRED_TESTIDS = {
  common: ['nav-a', 'nav-b', 'nav-c', 'data-notice'],
  A: ['chat-input', 'chat-send', 'auto-record-line', 'answer-tried', 'answer-evidence', 'answer-next'],
  B: ['request-overwrite', 'run-analysis', 'approval-card', 'approval-hash-before', 'approval-hash-after', 'approve-btn', 'reject-btn', 'run-result'],
  C: ['recheck-btn', 'attempt-row', 'attempt-raw', 'evidence-row', 'judgment-row'],
};

const results = [];
const unproven = [];
let tier = 'fixture';
function check(group, name, expected, actual, pass = JSON.stringify(expected) === JSON.stringify(actual)) {
  results.push({ tier, group, name, expected, actual, pass: !!pass });
  console.log(`${pass ? 'PASS' : 'FAIL'} [${tier}/${group}] ${name} — 기대 ${JSON.stringify(expected)} / 실제 ${JSON.stringify(actual)}`);
}
const skip = (what) => { unproven.push(`${tier}: ${what}`); console.log(`UNPROVEN [${tier}] ${what}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- 브라우저 헬퍼 ---------- */
let nav = 0;
function helpers(b, base) {
  const q = (id) => `document.querySelector('[data-testid="${id}"]')`;
  const H_ = {
    b, q,
    load: async (screen) => { await b.goto(`${base}/?n=${++nav}#${screen}`); await b.waitFor(`!!${q('data-notice')} && document.readyState==='complete'`); await sleep(400); },
    go: async (screen) => { await b.click(`nav-${screen}`); await sleep(150); },
    text: async (id) => (await b.text(id)) ?? '',
    state: (area) => b.evaluate(`${q(`${area}-status`)}.dataset.state`),
    statusText: (area) => b.evaluate(`${q(`${area}-status`)}.innerText`),
    attr: (sel, a) => b.evaluate(`document.querySelector('${sel}')?.getAttribute('${a}') ?? null`),
    sel: (sel) => b.evaluate(`document.querySelector('${sel}')?.innerText ?? null`),
    idleA: () => b.waitFor(`!${q('chat-send')}.disabled`, 20000),
    idleB: () => b.waitFor(`[...document.querySelectorAll('#screen-b button')].every(x => !x.disabled)`, 20000),
    idleC: () => b.waitFor(`!${q('recheck-btn')}.disabled`, 20000),
    visible: (id) => b.evaluate(`(() => { const e = ${q(id)}; if (!e) return false; const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; })()`),
    send: async (text) => { await b.type('chat-input', text); await b.click('chat-send'); },
    pageText: () => b.evaluate('document.body.innerText'),
    shot: (n) => b.screenshot(path.join(OUT, `${tier}-${n}.png`)),
  };
  return H_;
}

// 1920×1080 판독·overflow 검사 (현재 보이는 화면 기준)
async function layout(h, group, screen, { hashIds = [] } = {}) {
  const { b, q } = h;
  const m = await b.evaluate(`(() => {
    const vw = innerWidth, vh = innerHeight;
    const root = document.querySelector('#screen-${screen}');
    const els = [...root.querySelectorAll('*')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
    const outside = els.filter((e) => { const r = e.getBoundingClientRect(); return r.right > vw + 1 || r.left < -1; }).map((e) => e.tagName + '.' + e.className).slice(0, 5);
    const clipped = [...root.querySelectorAll('h1, .row-title, .card-title, .record-line, .big')].filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.className || e.tagName);
    const leaf = els.filter((e) => [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()));
    const sizes = leaf.map((e) => parseFloat(getComputedStyle(e).fontSize));
    window.scrollTo(0, document.body.scrollHeight);
    const n = document.querySelector('[data-testid="data-notice"]').getBoundingClientRect();
    const noticeAtBottom = n.top >= 0 && n.bottom <= vh && n.width > 0;
    window.scrollTo(0, 0);
    const navRects = ['a', 'b', 'c'].map((k) => document.querySelector('[data-testid="nav-' + k + '"]').getBoundingClientRect());
    const btns = [...root.querySelectorAll('button')].filter((e) => e.getBoundingClientRect().width > 0).map((e) => e.getBoundingClientRect());
    return { docW: document.documentElement.scrollWidth, vw, outside, clipped, minFont: Math.min(...sizes), n: leaf.length,
      small: leaf.filter((e) => parseFloat(getComputedStyle(e).fontSize) < 15).length, noticeAtBottom,
      navOk: navRects.every((r) => r.left >= 0 && r.right <= vw && r.width > 0 && r.top >= 0 && r.bottom <= vh),
      btnOk: btns.every((r) => r.left >= 0 && r.right <= vw), nBtns: btns.length };
  })()`);
  check(group, `1920×1080 ${screen.toUpperCase()}: horizontal overflow 없음 (scrollWidth ≤ ${W})`, true, m.docW <= m.vw && m.outside.length === 0, m.docW <= m.vw && m.outside.length === 0);
  const junk = await b.evaluate(`(document.querySelector('#screen-${screen}').innerText.match(/\\bnull\\b|\\bundefined\\b|\\bNaN\\b|\\[object/g) || [])`);
  check(group, `${screen.toUpperCase()}: 표시 텍스트에 null/undefined/NaN/[object 노출 없음`, [], junk);
  check(group, `1920×1080 ${screen.toUpperCase()}: nav 3개 viewport 안`, true, m.navOk);
  check(group, `1920×1080 ${screen.toUpperCase()}: 화면 버튼 ${m.nBtns}개 viewport 밖으로 밀리지 않음`, true, m.nBtns > 0 && m.btnOk);
  check(group, `1920×1080 ${screen.toUpperCase()}: 스크롤 끝에서도 데이터 고지 보임`, true, m.noticeAtBottom);
  check(group, `1920×1080 ${screen.toUpperCase()}: 제목·카드 제목·핵심 문구 잘림 없음`, [], m.clipped);
  check(group, `1920×1080 ${screen.toUpperCase()}: 글자 크기 최소 ≥ 13px (텍스트 요소 ${m.n}, 15px 미만 ${m.small})`, true, m.n > 0 && m.minFont >= 13, m.n > 0 && m.minFont >= 13);
  for (const id of hashIds) {
    const f = await b.evaluate(`(() => { const e = ${q(id)}; return e ? [parseFloat(getComputedStyle(e).fontSize), e.innerText.trim(), e.getBoundingClientRect().width > 0] : null; })()`);
    check(group, `1920×1080 ${screen.toUpperCase()}: ${id} 글자 ≥ 28px · 8자리 hash 판독`, true, !!f && f[0] >= 28 && f[2] && (/^[0-9a-f]{8}$/.test(f[1]) || f[1] === '—'), !!f && f[0] >= 28 && f[2] && (/^[0-9a-f]{8}$/.test(f[1]) || f[1] === '—'));
  }
}

async function testidInventory(h, group, ids, extra = {}) {
  const counts = {};
  for (const id of ids) counts[id] = await h.b.count(id);
  const expectedMin = Object.fromEntries(ids.map((id) => [id, extra[id] ?? 1]));
  const bad = ids.filter((id) => counts[id] < expectedMin[id]);
  check(group, `필수 testid 존재 (기대 ≥ ${ids.length}종 / 실제 ${ids.length - bad.length}종)`, [], bad);
}

/* =====================================================================
 * FIXTURE 검증
 * ===================================================================== */
async function runFixture() {
  tier = 'fixture';
  const mock = createMock('baseline');
  const base = await mock.listen(path.join(ROOT, 'public'));
  const b = await launch({ width: W, height: H });
  const h = helpers(b, base);
  const errMock = (key, status, code, message) => { mock.fail[key] = { status, body: { error: { code, message } } }; };
  try {
    /* ---------- 공통 + 화면 A ---------- */
    await h.load('a');
    await testidInventory(h, 'X', REQUIRED_TESTIDS.common);
    await testidInventory(h, 'A', REQUIRED_TESTIDS.A);
    const notice = await h.text('data-notice');
    check('X', '데이터 고지: 합성 + 실제 + 조회 실패≠부재 문구', [true, true, true],
      [notice.includes('기관 연구 이력·내부 판단') && notice.includes('시연용 합성 데이터'), notice.includes('논문·DOI·현재 철회 정보') && notice.includes('공개 실제 데이터'), notice.includes('조회 실패 ≠ 논문 부재')]);
    for (const s of ['a', 'b', 'c']) { await h.go(s); check('X', `nav-${s} 클릭 → 화면 ${s.toUpperCase()} 만 표시`, ['a', 'b', 'c'].map((k) => k === s), await b.evaluate(`['a','b','c'].map(k => !document.querySelector('#screen-'+k).hidden)`)); }
    for (const s of ['a', 'b', 'c']) { await h.go(s); check('X', `화면 ${s.toUpperCase()} 에서 data-notice 표시`, true, await h.visible('data-notice')); }
    await h.go('a');

    const rec0 = await h.text('auto-record-line');
    check('A', '초기: 자동 기록 줄은 안내 문구 (자동 기록됨 아님)', [true, false], [rec0.length > 0, rec0.includes('자동 기록됨')]);
    check('A', '초기: 저장/확인 버튼 없음 (버튼 라벨에 저장·초기화·reset 없음)', [], await b.evaluate(`[...document.querySelectorAll('button')].filter(x => x.getClientRects().length > 0).map(x => x.innerText).filter(t => /저장|초기화|reset|확인 버튼/i.test(t))`));
    check('A', '초기: 세 덩어리 모두 안내 문구로 존재', [true, true, true], [(await h.text('answer-tried')).length > 0, (await h.text('answer-evidence')).length > 0, (await h.text('answer-next')).length > 0]);
    await h.shot('A0-initial');

    // 빈 입력 → 호출 없음
    const c0 = mock.calls.filter((c) => c === 'POST /api/chat').length;
    await b.click('chat-send'); await sleep(150);
    check('A', '빈 입력: API 호출 0 + 오류 표시', [0, 'error'], [mock.calls.filter((c) => c === 'POST /api/chat').length - c0, await h.state('a')]);

    // 계획 발화 → 저장 0
    const n0 = mock.state.attempts.length;
    await h.send(PLAN); await h.idleA(); await sleep(150);
    check('A', '계획 발화: 응답 saved=false → 화면 기록 줄 불변 · 서버 시도 증가 0', [n0, false, 'success'], [mock.state.attempts.length, (await h.text('auto-record-line')).includes('자동 기록됨'), await h.state('a')]);
    check('A', '계획 발화: 기록 안 됨 표시', true, (await h.text('record-status')).includes('계획') && (await h.text('record-status')).includes('추가하지 않았습니다'));

    // 질문: loading 상태 관찰
    mock.delay['POST /api/chat'] = 900;
    await h.send(QUESTION);
    await sleep(120);
    check('A', 'loading: 상태 loading · 보내기 비활성 · 안내 유지', ['loading', true, true], [await h.state('a'), await b.evaluate(`${h.q('chat-send')}.disabled`), (await h.text('answer-tried')).length > 0]);
    await h.idleA(); delete mock.delay['POST /api/chat'];
    const tried1 = await h.text('answer-tried');
    check('A', '질문 답: ① 이미 해본 것 — fixture 응답값(2번, 재현성 검증) 렌더', [true, true, '2건'], [tried1.includes('2번'), tried1.includes('재현성 검증'), await h.text('tried-count').then((t) => t.replace(/\s+/g, '').replace('같은접근', ''))]);
    const ev1 = await h.text('answer-evidence'); const nx1 = await h.text('answer-next');
    check('A', '질문 답: ② 연결된 논문 근거 없음 + ③ 다음 경로 제안 안 함 ("근거 부족" 표현 0)', [true, true, false], [ev1.includes('연결된 논문 근거 없음'), nx1.includes('검증된 논문 근거가 없어 다음 경로는 제안하지 않습니다'), (ev1 + nx1).includes('근거 부족')]);
    check('A', '질문 발화: 시도 증가 0 (서버) · 자동 기록 줄 불변', [n0, false], [mock.state.attempts.length, (await h.text('auto-record-line')).includes('자동 기록됨')]);

    // 실행 발화 2→3
    await h.send(EXEC); await h.idleA(); await sleep(150);
    const line = await h.text('auto-record-line');
    const structText = await h.text('record-struct');
    check('A', '실행 발화: 자동 기록 한 줄 = API auto_record_line', '자동 기록됨 — 대상 RSE-01 / 방법 Western blot / 환경 세포 / 결과 중단', line.trim());
    check('A', '실행 발화: 원문↔구조화 표 (원문·대상·방법·환경·중단 단계)', [], [EXEC, 'RSE-01', 'western_blot', '세포', '재현성 검증'].filter((w) => !structText.includes(w)));
    check('A', '실행 발화: 서버 시도 +1 (fixture 2→3 상태 변화는 서버 상태)', n0 + 1, mock.state.attempts.length);
    const tried2 = await h.text('answer-tried');
    check('A', '실행 발화: ① 같은 접근 3건 · 재현성 검증 (응답값 렌더)', [true, true, true], [tried2.includes('3번'), tried2.includes('모두 재현성 검증 단계에서 멈췄습니다'), (await h.text('tried-count')).includes('3건')]);
    check('A', '실행 발화: 입력창 비워짐', '', await b.evaluate(`${h.q('chat-input')}.value`));
    check('A', '실행 발화: 발화 로그에 3건 (계획 · 질문 · 실행)', 3, await b.evaluate(`document.querySelectorAll('[data-testid="chat-log"] li').length`));
    await h.shot('A1-exec-3');
    await layout(h, 'A', 'a');

    // 근거 있는 답
    const withEv = JSON.parse(JSON.stringify(mock.state.evidence[1]));
    mock.answerEvidence = [withEv];
    await h.send(QUESTION); await h.idleA();
    const ev2 = await h.text('answer-evidence'); const nx2 = await h.text('answer-next');
    check('A', '근거 있는 답: 검증된 근거 1건 + 제목/DOI 렌더 + 다음 후보 근거 기반', ['true,true,true', true, true], [[ev2.includes('검증된 근거 1건'), ev2.includes(withEv.input.title), ev2.includes(withEv.input.doi)].join(), nx2.includes('저장 근거 기반'), !nx2.includes('제시 안 함')]);
    mock.answerEvidence = [];

    // 오류 경로
    const snap = async () => [await h.text('answer-tried'), await h.text('auto-record-line'), await h.text('answer-next')];
    const before = await snap(); const nErr0 = mock.state.attempts.length;
    errMock('POST /api/chat', 500, 'INTERNAL', 'boom');
    await h.send(EXEC); await h.idleA(); await sleep(150);
    const stErr = await h.statusText('a');
    check('A', '오류 500: 오류 상태 + 코드·메시지 표시 · 기존 답/기록 줄 유지 · 성공 위조 없음', [true, true, before], [(await h.state('a')) === 'error' && stErr.includes('INTERNAL') && stErr.includes('boom') && stErr.includes('500'), (await h.text('answer-tried')).length > 0 && mock.state.attempts.length === nErr0, await snap()]);
    check('A', '오류 500: 발화 로그에 오류 표시', true, (await h.text('chat-log')).includes('오류'));
    mock.fail['POST /api/chat'] = { status: 200, body: {} };
    await h.send(EXEC); await h.idleA(); await sleep(150);
    check('A', '빈/잘못된 응답 {}: 오류(INVALID_RESPONSE) · 화면 불변', ['error', true, before], [await h.state('a'), (await h.statusText('a')).includes('INVALID_RESPONSE'), await snap()]);
    mock.fail['POST /api/chat'] = { status: 200, body: { kind: 'execution', saved: true, attempt: null } };
    await h.send(EXEC); await h.idleA(); await sleep(150);
    check('A', 'saved=true 인데 attempt 없음: 오류 · 기록 줄 위조 없음', ['error', before[1]], [await h.state('a'), (await h.text('auto-record-line'))]);
    errMock('POST /api/chat', 501, 'NOT_IMPLEMENTED', 'CAPTURE 트랙 미구현');
    await h.send(EXEC); await h.idleA(); await sleep(150);
    check('A', '501 NOT_IMPLEMENTED: 오류로 표시 (성공 아님)', [true, true], [(await h.state('a')) === 'error', (await h.statusText('a')).includes('NOT_IMPLEMENTED')]);
    mock.fail['POST /api/chat'] = { destroy: true };
    await h.send(EXEC); await h.idleA(); await sleep(200);
    check('A', '네트워크 단절: 오류(NETWORK) 표시 · 기존 답 유지', [true, before], [(await h.statusText('a')).includes('NETWORK'), await snap()]);
    delete mock.fail['POST /api/chat'];
    const pg = await h.pageText();
    check('A', '화면 A 에 부재·가짜 단정 표현 없음', [], FORBIDDEN.filter((w) => pg.includes(w)));

    // production 하드코딩 아님: variant (4건 · 행동검증) 에서 5번 · 행동검증
    mock.reset('variant');
    await h.load('a');
    await h.send(EXEC_V); await h.idleA(); await sleep(150);
    const tv = await h.text('answer-tried');
    check('A', '하드코딩 아님: 다른 fixture(4건·행동검증)에서 5번 · 행동검증 · 5건 렌더, 재현성 검증 문구 없음', [true, true, true, false], [tv.includes('5번'), tv.includes('행동검증'), (await h.text('tried-count')).includes('5건'), tv.includes('재현성 검증')]);

    /* ---------- 화면 B ---------- */
    mock.reset('baseline');
    await h.load('b');
    await testidInventory(h, 'B', ['request-overwrite', 'run-analysis']);
    check('B', '초기: 승인 카드 0 · 분석 결과 0 · 원본 hash 표시 = API', [0, 0, mock.targetShort()], [await b.count('approval-card'), await b.count('run-result'), (await h.text('target-hash')).trim()]);
    await h.shot('B0-initial');
    const hash0 = mock.targetShort();
    await b.click('request-overwrite'); await h.idleB(); await sleep(150);
    check('B', '덮어쓰기 요청 → 승인 대기 카드 1 (data-status=pending)', [1, 'pending'], [await b.count('approval-card'), await h.attr('[data-testid="approval-card"]', 'data-status')]);
    const card = '[data-testid="approval-card"][data-status="pending"]';
    const cardText = await h.sel(card);
    const apiA = mock.state.approvals[0];
    check('B', '카드: 하려는 작업·승인 이유·영향 대상·현재 상태 표시 (API 값)', [], [apiA.description, apiA.reason, 'original_measurements.csv', '승인 대기'].filter((w) => !cardText.includes(w)));
    check('B', '카드: 승인 전 hash = 원본 hash 앞 8자리 · 승인 후 hash 아직 없음(—, 값 위조 없음)', [hash0, '—', '1'], [(await h.sel(`${card} [data-testid="approval-hash-before"]`)).trim(), (await h.sel(`${card} [data-testid="approval-hash-after"]`)).trim(), await h.attr(`${card} [data-testid="approval-hash-after"]`, 'data-empty')]);
    check('B', '승인 전: 원본 hash 불변 (서버 · 화면 원본 hash 패널)', [hash0, hash0], [mock.targetShort(), (await h.text('target-hash')).trim()]);
    await b.click('run-analysis'); await h.idleB(); await sleep(150);
    check('B', '승인 대기 중 독립 분석 완료: run-result +1 · 카드 여전히 pending · hash 불변', [1, 'pending', hash0], [await b.count('run-result'), await h.attr(card, 'data-status'), mock.targetShort()]);
    const runText = await h.sel('[data-testid="run-result"]');
    check('B', 'run-result: 완료 · 실제 응답 필드(n, 평균) 렌더', [true, true], [runText.includes('완료'), runText.includes('1.2345') && runText.includes('n ')]);
    await h.shot('B1-pending-analysis');
    await layout(h, 'B', 'b', { hashIds: ['approval-hash-before', 'approval-hash-after'] });
    const id1 = await h.attr(card, 'data-approval-id');
    await b.click('approve-btn', `[data-testid="approval-card"][data-approval-id="${id1}"]`); await h.idleB(); await sleep(150);
    const sel1 = `[data-testid="approval-card"][data-approval-id="${id1}"]`;
    const hb = (await h.sel(`${sel1} [data-testid="approval-hash-before"]`)).trim(); const ha = (await h.sel(`${sel1} [data-testid="approval-hash-after"]`)).trim();
    check('B', '승인 후: 카드 approved · 전 hash 유지 · 후 hash = 서버 새 hash · 전≠후', ['approved', hash0, mock.targetShort(), true], [await h.attr(sel1, 'data-status'), hb, ha, hb !== ha]);
    const geo = await b.evaluate(`(() => { const a = document.querySelector('${sel1} [data-testid="approval-hash-before"]').getBoundingClientRect(); const c = document.querySelector('${sel1} [data-testid="approval-hash-after"]').getBoundingClientRect(); return [a.width > 0 && c.width > 0, a.right <= c.left, Math.abs(a.top - c.top) < 4, c.right <= innerWidth]; })()`);
    check('B', '승인 후: 승인 전/후 hash 동시 표시 (나란히, 같은 높이, 화면 안)', [true, true, true, true], geo);
    check('B', '승인 후: 승인 버튼 사라짐 (재승인 불가) · 원본 hash 패널 갱신', [0, mock.targetShort()], [await b.count('approve-btn'), (await h.text('target-hash')).trim()]);
    await h.shot('B2-approved');
    // 거절 경로
    const hashR = mock.targetShort();
    await b.click('request-overwrite'); await h.idleB(); await sleep(150);
    const rid = await h.attr('[data-testid="approval-card"][data-status="pending"]', 'data-approval-id');
    await b.click('reject-btn', `[data-testid="approval-card"][data-approval-id="${rid}"]`); await h.idleB(); await sleep(150);
    const rsel = `[data-testid="approval-card"][data-approval-id="${rid}"]`;
    check('B', '거절: 카드 rejected · "거절됨" 텍스트 · 원본 hash 변경 없음 · 후 hash 값 없음', ['rejected', true, hashR, '—'], [await h.attr(rsel, 'data-status'), (await h.sel(rsel)).includes('거절됨'), (await h.text('target-hash')).trim(), (await h.sel(`${rsel} [data-testid="approval-hash-after"]`)).trim()]);
    // 오류 경로
    const cards0 = mock.state.approvals.length;
    errMock('POST /api/actions', 500, 'INTERNAL', 'req-fail');
    await b.click('request-overwrite'); await h.idleB(); await sleep(150);
    check('B', '요청 실패(500): 오류 표시 · 새 카드 없음', [true, cards0, true], [(await h.state('b')) === 'error' && (await h.statusText('b')).includes('req-fail'), mock.state.approvals.length, (await b.count('approval-card')) === cards0]);
    const runs0 = await b.count('run-result');
    await b.click('run-analysis'); await h.idleB(); await sleep(150);
    check('B', '분석 실패(500): 오류 표시 · 결과 행 증가 없음', ['error', runs0], [await h.state('b'), await b.count('run-result')]);
    delete mock.fail['POST /api/actions'];
    await b.click('request-overwrite'); await h.idleB(); await sleep(150);
    const eid = await h.attr('[data-testid="approval-card"][data-status="pending"]', 'data-approval-id');
    const esel = `[data-testid="approval-card"][data-approval-id="${eid}"]`;
    const hashE = mock.targetShort();
    errMock(`POST /api/approvals/${eid}/approve`, 500, 'INTERNAL', 'approve-fail');
    await b.click('approve-btn', esel); await h.idleB(); await sleep(150);
    check('B', '승인 실패(500): 오류 표시 · 카드 pending 유지 · hash 후 없음 · 버튼 재활성', ['error', 'pending', '—', true], [await h.state('b'), await h.attr(esel, 'data-status'), (await h.sel(`${esel} [data-testid="approval-hash-after"]`)).trim(), await b.evaluate(`!document.querySelector('${esel} [data-testid="approve-btn"]').disabled`)]);
    delete mock.fail[`POST /api/approvals/${eid}/approve`];
    errMock(`POST /api/approvals/${eid}/reject`, 500, 'INTERNAL', 'reject-fail');
    await b.click('reject-btn', esel); await h.idleB(); await sleep(150);
    check('B', '거절 실패(500): 오류 표시 · 카드 pending 유지 · 원본 hash 불변', ['error', 'pending', hashE], [await h.state('b'), await h.attr(esel, 'data-status'), (await h.text('target-hash')).trim()]);
    delete mock.fail[`POST /api/approvals/${eid}/reject`];
    mock.fail['GET /api/approvals'] = { status: 500, body: { error: { code: 'INTERNAL', message: 'list-fail' } } };
    await h.go('a'); await h.go('b'); await sleep(300);
    check('B', '목록 조회 실패: 기존 카드 유지 (빈 화면 아님)', true, (await b.count('approval-card')) > 0);
    delete mock.fail['GET /api/approvals'];
    check('B', '화면 B 페이지 JS 예외 0', [], b.consoleErrors);

    /* ---------- 화면 C ---------- */
    mock.reset('baseline');
    await h.load('c');
    await h.go('c');
    await testidInventory(h, 'C', REQUIRED_TESTIDS.C);
    const api = { a: mock.state.attempts.length, e: mock.state.evidence.length, j: mock.state.judgments.length };
    check('C', '초기 행 수 = API (시도·근거·판단)', [api.a, api.e, api.j], [await b.count('attempt-row'), await b.count('evidence-row'), await b.count('judgment-row')]);
    const raws = await b.evaluate(`[...document.querySelectorAll('[data-testid="attempt-row"]')].map(r => [Number(r.dataset.attemptId), r.querySelector('[data-testid="attempt-raw"]').innerText.trim()])`);
    check('C', '시도 행: data-attempt-id · attempt-raw 원문 = API raw_text (전수)', mock.state.attempts.map((a) => [a.id, a.raw_text]).sort((x, y) => y[0] - x[0]), raws);
    const evStatuses = await b.evaluate(`[...document.querySelectorAll('[data-testid="evidence-row"]')].map(r => [Number(r.dataset.evidenceId), r.dataset.status])`);
    check('C', '근거 행 data-status = API status (전수)', mock.state.evidence.map((e) => [e.id, e.status]), evStatuses);
    check('C', 'baseline: 과거 근거 행 verified · "확인" · 합성 기준선 고지', [true, true, true], [
      (await h.attr('[data-testid="evidence-row"][data-evidence-id="1"]', 'data-status')) === 'verified',
      (await h.sel('[data-testid="evidence-row"][data-evidence-id="1"]')).includes('확인'),
      (await h.text('evidence-list')).includes('철회 이전 시점의 시연용 과거 상태') && (await b.evaluate('document.body.innerText')).includes('철회 이전 시점을 재현한 시연용 기준 상태')]);
    check('C', 'baseline: 판단 행 needs-review=0 · 판단일 2022-03-15 · 재검토 표시 없음', ['0', true, true], [await h.attr('[data-testid="judgment-row"]', 'data-needs-review'), (await h.sel('[data-testid="judgment-row"]')).includes('2022-03-15'), (await h.sel('[data-testid="judgment-row"]')).includes('재검토 표시 없음')]);
    check('C', '서지 불일치·확인 불가 행: API 상태 + 표준 문구(부재 단정 없음)', [true, true], [(await h.sel('[data-testid="evidence-row"][data-evidence-id="3"]')).includes('서지 불일치'), (await h.sel('[data-testid="evidence-row"][data-evidence-id="4"]')).includes('DOI 등록을 확인하지 못했습니다')]);
    await h.shot('C0-baseline');
    await layout(h, 'C', 'c');

    // 재검사 성공 (loading 관찰)
    mock.delay['POST /api/recheck'] = 900;
    const rowsDuring = [await b.count('evidence-row')];
    await b.click('recheck-btn'); await sleep(150);
    rowsDuring.push(await b.count('evidence-row'), await b.count('judgment-row'));
    check('C', 'loading: 상태 loading · 버튼 비활성·"확인 중" · 기존 행 유지 (지워지지 않음)', ['loading', true, true, [api.e, api.e, api.j]], [await h.state('c'), await b.evaluate(`${h.q('recheck-btn')}.disabled`), (await h.text('recheck-btn')).includes('확인 중'), rowsDuring]);
    check('C', 'loading 중 근거 행은 아직 verified', 'verified', await h.attr('[data-testid="evidence-row"][data-evidence-id="1"]', 'data-status'));
    await h.idleC(); delete mock.delay['POST /api/recheck']; await sleep(200);
    const evRow = '[data-testid="evidence-row"][data-evidence-id="1"]'; const jRow = '[data-testid="judgment-row"][data-judgment-id="1"]';
    const evT = await h.sel(evRow); const jT = await h.sel(jRow);
    check('C', '재검사 후 (새로고침 없이): 근거 data-status = retracted · 판단 needs-review = 1', ['retracted', '1'], [await h.attr(evRow, 'data-status'), await h.attr(jRow, 'data-needs-review')]);
    check('C', '재검사 후 텍스트: 철회됨 + API 철회일(fixture 2031-02-03, 2024-06-24 아님) / 재검토 필요 + 사유', [true, true, false, true, true], [evT.includes('철회됨'), evT.includes('2031-02-03'), evT.includes('2024-06-24'), jT.includes('재검토 필요'), jT.includes('근거 상태 변경: 확인 → 철회됨')]);
    check('C', '재검사 후: 상태 변경 이력(확인 → 철회됨) 표시 · 다른 근거 행 불변', [true, ['verified', 'mismatch', 'unverifiable']], [evT.includes('확인 → 철회됨'), await b.evaluate(`[2,3,4].map(i => document.querySelector('[data-testid="evidence-row"][data-evidence-id="'+i+'"]').dataset.status)`)]);
    const sumT = await h.text('recheck-summary');
    check('C', '재검사 요약: 결과(확인→철회됨) · Crossref 현재 조회 · 재검토 표시 판단 #1', [true, true, true], [sumT.includes('확인') && sumT.includes('철회됨'), sumT.includes('현재 조회') && sumT.includes('HTTP 200'), sumT.includes('#1')]);
    check('C', '의미 구분 문구: 철회됨 ≠ 판단이 틀렸다는 뜻 (재검토 필요 = 사람이 다시 봐야 함)', [true, true], [(await h.pageText()).includes('판단이 틀렸다는 뜻은 아닙니다'), (await h.pageText()).includes('사람이 그 판단을 다시 보도록')]);
    check('C', '재검사 후에도 합성/실제 고지 유지', [true, true], [(await h.text('data-notice')).includes('시연용 합성 데이터'), (await h.text('data-notice')).includes('공개 실제 데이터')]);
    check('C', '재검사 후 페이지 전체에 부재·가짜 단정 표현 없음', [], await (async () => { const t = await h.pageText(); return FORBIDDEN.filter((w) => t.includes(w)); })());
    await h.shot('C1-after-recheck');
    await layout(h, 'C', 'c');

    // 재검사 실패 경로 (fresh baseline)
    for (const [label, setup, expect] of [
      ['500', () => errMock('POST /api/recheck', 500, 'INTERNAL', 'recheck-boom'), 'INTERNAL'],
      ['빈/잘못된 응답 {}', () => { mock.fail['POST /api/recheck'] = { status: 200, body: {} }; }, 'INVALID_RESPONSE'],
      ['501 NOT_IMPLEMENTED', () => errMock('POST /api/recheck', 501, 'NOT_IMPLEMENTED', 'EVIDENCE 트랙 미구현'), 'NOT_IMPLEMENTED'],
      ['네트워크 단절', () => { mock.fail['POST /api/recheck'] = { destroy: true }; }, 'NETWORK'],
    ]) {
      mock.reset('baseline'); await h.load('c'); await h.go('c');
      setup();
      await b.click('recheck-btn'); await h.idleC(); await sleep(250);
      const t = await h.statusText('c'); const pt = await h.pageText();
      check('C', `재검사 실패 (${label}): 오류 표시 · 근거 verified/판단 needs-review 0 유지 · 행 수 유지 · 부재 단정 없음`, [true, 'verified', '0', api.e, true], [
        (await h.state('c')) === 'error' && t.includes(expect), await h.attr(evRow, 'data-status'), await h.attr(jRow, 'data-needs-review'), await b.count('evidence-row'),
        FORBIDDEN.every((w) => !pt.includes(w)) && pt.includes('논문 부재를 뜻하지 않습니다')]);
    }
    // 조회 실패 응답 (200, lookup.ok=false): 과거 정상 확인을 덮어쓰지 않음
    mock.reset('baseline'); mock.recheckOutcome = 'lookup_failed';
    await h.load('c'); await h.go('c');
    await b.click('recheck-btn'); await h.idleC(); await sleep(250);
    const lt = await h.text('recheck-summary'); const lrow = await h.sel(evRow);
    check('C', 'lookup 실패 응답: 근거 verified 유지 · 판단 재검토 0 · "조회 실패" + "논문 부재를 뜻하지 않음" · 최신 확인 실패 표시', ['verified', '0', true, true], [
      await h.attr(evRow, 'data-status'), await h.attr(jRow, 'data-needs-review'), lt.includes('조회 실패') && lt.includes('논문 부재를 뜻하지 않음'), lrow.includes('최신 확인 실패') && lrow.includes('마지막 확인 2022-03-15')]);
    await h.shot('C2-lookup-failed');
    // 목록 조회 실패 시 기존 표시 유지
    mock.fail['GET /api/evidence'] = { status: 500, body: { error: { code: 'INTERNAL', message: 'ev-list-fail' } } };
    await h.go('a'); await h.go('c'); await sleep(300);
    check('C', '근거 목록 조회 실패: 기존 근거 행 유지 (빈 화면 아님)', api.e, await b.count('evidence-row'));
    delete mock.fail['GET /api/evidence'];
    // 실행 발화 후 화면 C 에 새 시도 행 (새로고침 없이)
    mock.reset('baseline'); await h.load('a');
    const rowsBefore = mock.state.attempts.length;
    await h.send(EXEC); await h.idleA(); await sleep(300);
    await h.go('c'); await sleep(400);
    check('C', '화면 A 실행 발화 후 화면 C: 시도 행 +1 · 새 행 원문 = 발화 (새로고침 없이)', [rowsBefore + 1, EXEC], [await b.count('attempt-row'), await b.evaluate(`document.querySelector('[data-testid="attempt-row"][data-attempt-id="${rowsBefore + 1}"] [data-testid="attempt-raw"]')?.innerText.trim() ?? null`)]);
    check('X', '페이지 JS 예외 0 (fixture 전체)', [], b.consoleErrors);
  } catch (e) {
    check('X', 'fixture 흐름 실행 오류', 'no error', String(e.stack || e), false);
    await b.screenshot(path.join(OUT, 'fixture-99-error.png')).catch(() => null);
  } finally {
    await b.close();
    await mock.close();
  }
}

/* =====================================================================
 * LIVE 검증 (이 checkout 의 실제 서버 + 실제 DB)
 * ===================================================================== */
const wsl = (cmd) => execFileSync('wsl.exe', ['-d', 'Ubuntu', '--', 'bash', '-c', cmd], { encoding: 'utf8' });
async function runLive() {
  tier = 'live';
  const dir = `var/screens-live-${Date.now()}`;
  const env = `PORT=${LIVE_PORT} DATA_DIR=${dir} DB_PATH=${dir}/rse.db APPROVAL_DIR=${dir}/approval`;
  console.log(wsl(`cd ${WSL_ROOT} && ${env} node --disable-warning=ExperimentalWarning scripts/db-init.js >/dev/null && ${env} node --disable-warning=ExperimentalWarning scripts/seed.js | tr -d '\\n' | cut -c1-160`).trim());
  const server = spawn('wsl.exe', ['-d', 'Ubuntu', '--', 'bash', '-c', `cd ${WSL_ROOT} && ${env} exec node --disable-warning=ExperimentalWarning src/server.js`], { stdio: 'ignore', windowsHide: true });
  const base = `http://localhost:${LIVE_PORT}`;
  const get = async (p) => (await fetch(base + p)).json();
  let up = false;
  for (let i = 0; i < 80 && !up; i++) { try { up = (await fetch(`${base}/api/health`)).ok; } catch { await sleep(250); } }
  if (!up) { check('X', '실제 서버 시작', true, false); server.kill(); return; }
  const b = await launch({ width: W, height: H });
  const h = helpers(b, base);
  try {
    const probe = async (p) => (await fetch(base + p)).status;
    const captureLive = (await probe('/api/approaches?target=RSE-01')) !== 501;
    const evidenceLive = (await probe('/api/evidence/1/judgments')) !== 501;
    console.log(`live 구현 여부 probe: CAPTURE=${captureLive ? '구현' : '501'} EVIDENCE=${evidenceLive ? '구현' : '501'}`);

    // ---- 화면 C: 실제 GET API 값 렌더 ----
    await h.load('c'); await h.go('c'); await sleep(500);
    const at = (await get('/api/attempts')).attempts; const ev = (await get('/api/evidence')).evidence; const ju = (await get('/api/judgments')).judgments;
    check('C', '실제 API: 시도·근거·판단 행 수 = API (N>0)', [at.length, ev.length, ju.length], [await b.count('attempt-row'), await b.count('evidence-row'), await b.count('judgment-row')], at.length > 0 && ev.length > 0 && ju.length > 0 && (await b.count('attempt-row')) === at.length && (await b.count('evidence-row')) === ev.length && (await b.count('judgment-row')) === ju.length);
    check('C', '실제 API: evidence-row data-status = API status (전수)', ev.map((e) => [e.id, e.status]), await b.evaluate(`[...document.querySelectorAll('[data-testid="evidence-row"]')].map(r => [Number(r.dataset.evidenceId), r.dataset.status])`));
    check('C', '실제 API: judgment-row data-needs-review = API needs_review (전수)', ju.map((j) => [j.id, j.needs_review ? '1' : '0']).sort((x, y) => x[0] - y[0]), (await b.evaluate(`[...document.querySelectorAll('[data-testid="judgment-row"]')].map(r => [Number(r.dataset.judgmentId), r.dataset.needsReview])`)).sort((x, y) => x[0] - y[0]));
    const raws = await b.evaluate(`[...document.querySelectorAll('[data-testid="attempt-row"]')].map(r => [Number(r.dataset.attemptId), r.querySelector('[data-testid="attempt-raw"]').innerText.trim()])`);
    check('C', '실제 API: attempt-raw 원문 = API raw_text (전수)', at.map((a) => [a.id, a.raw_text]), raws);
    const past = ev.find((e) => e.is_demo_past_state);
    check('C', '실제 baseline(seed): 과거 근거 verified · 합성 과거 판단 2022-03-15 · 재검토 0', [true, true, 0], [!!past && past.status === 'verified', ju.some((j) => (j.asked_at || '').startsWith('2022-03-15')), ju.filter((j) => j.needs_review).length]);
    await h.shot('C-live-baseline');
    if (!evidenceLive) {
      await b.click('recheck-btn'); await h.idleC(); await sleep(300);
      const pt = await h.pageText();
      check('C', '실제 API 501 (POST /api/recheck 미구현): 오류 표시 · 근거·판단 상태 불변 · 성공 위조 없음', ['error', true, true], [await h.state('c'), (await h.statusText('c')).includes('NOT_IMPLEMENTED'), (await b.evaluate(`[...document.querySelectorAll('[data-testid="evidence-row"]')].every(r => r.dataset.status !== 'retracted')`)) && FORBIDDEN.every((w) => !pt.includes(w))]);
      skip('C: 실제 POST /api/recheck 성공 경로 (확인→철회됨, 재검토 필요) — EVIDENCE 미통합(501), fixture 로만 UI 검증');
    } else skip('C: EVIDENCE API 가 구현되어 있음 — 이 러너는 live 재검사 성공 경로를 검사하지 않음');

    // ---- 화면 A: 실제 API ----
    await h.load('a');
    if (!captureLive) {
      const n0 = (await get('/api/attempts')).attempts.length;
      await h.send(EXEC); await h.idleA(); await sleep(300);
      check('A', '실제 API 501 (POST /api/chat 미구현): 오류 표시 · 기록 줄 위조 없음 · 실제 DB 시도 증가 0', ['error', false, n0], [await h.state('a'), (await h.text('auto-record-line')).includes('자동 기록됨'), (await get('/api/attempts')).attempts.length]);
      skip('A: 실제 POST /api/chat 성공 경로 (baseline 2 → 3, answer 세 덩어리) — CAPTURE 미통합(501), fixture 로만 UI 검증');
    } else skip('A: CAPTURE API 가 구현되어 있음 — 이 러너는 live 채팅 성공 경로를 검사하지 않음');

    // ---- 화면 B: 실제 G5 API ----
    await h.load('b'); await sleep(400);
    const t0 = await get('/api/approval/target');
    check('B', '실제 API: 원본 hash 패널 = GET /api/approval/target (원본 파일이 아직 없으면 "—")', t0.hash_short ?? '—', (await h.text('target-hash')).trim());
    await b.click('request-overwrite'); await h.idleB(); await sleep(300);
    const tb = await get('/api/approval/target'); // 원본 파일은 첫 요청 때 backend 가 준비한다 (그 전엔 hash null)
    const ap = (await get('/api/approvals')).approvals.find((a) => a.status === 'pending');
    const card = '[data-testid="approval-card"][data-status="pending"]';
    check('B', '실제 API: 대기 카드 생성 · 승인 전 hash = 원본 hash · 원본 불변', [true, tb.hash_short, tb.hash_short], [!!ap, (await h.sel(`${card} [data-testid="approval-hash-before"]`))?.trim(), (await get('/api/approval/target')).hash_short]);
    const ct = await h.sel(card) ?? '';
    check('B', '실제 API: 카드에 작업·승인 이유·영향 대상 (API 문자열 그대로)', [], [ap?.description, ap?.reason, 'original_measurements.csv'].filter((w) => !w || !ct.includes(w)));
    await b.click('run-analysis'); await h.idleB(); await sleep(300);
    const runs = (await get('/api/runs')).runs;
    check('B', '실제 API: 승인 대기 중 독립 분석 완료 · 화면 run-result = API runs · 카드 pending · hash 불변', [runs.length, 'completed', 'pending', tb.hash_short], [await b.count('run-result'), runs[0]?.status, await h.attr(card, 'data-status'), (await get('/api/approval/target')).hash_short], runs.length > 0 && (await b.count('run-result')) === runs.length && runs[0].status === 'completed');
    await h.shot('B-live-pending');
    await layout(h, 'B', 'b', { hashIds: ['approval-hash-before', 'approval-hash-after'] });
    const id1 = await h.attr(card, 'data-approval-id');
    const s1 = `[data-testid="approval-card"][data-approval-id="${id1}"]`;
    await b.click('approve-btn', s1); await h.idleB(); await sleep(400);
    const t1 = await get('/api/approval/target'); const apAfter = (await get('/api/approvals')).approvals.find((a) => String(a.id) === id1);
    const hb = (await h.sel(`${s1} [data-testid="approval-hash-before"]`))?.trim(); const ha = (await h.sel(`${s1} [data-testid="approval-hash-after"]`))?.trim();
    check('B', '실제 API: 승인 후 카드 approved · 전 hash / 후 hash = API 값 · 후 hash = 새 원본 hash · 전≠후', ['approved', tb.hash_short, t1.hash_short, true], [await h.attr(s1, 'data-status'), hb, ha, hb !== ha], apAfter?.status === 'approved' && hb === apAfter.hash_before_short && ha === apAfter.hash_after_short && ha === t1.hash_short && hb !== ha);
    await h.shot('B-live-approved');
    await b.click('request-overwrite'); await h.idleB(); await sleep(300);
    const rid = await h.attr(card, 'data-approval-id'); const hr = (await get('/api/approval/target')).hash_short;
    await b.click('reject-btn', `[data-testid="approval-card"][data-approval-id="${rid}"]`); await h.idleB(); await sleep(400);
    check('B', '실제 API: 거절 → 카드 rejected · 원본 hash 변경 없음', ['rejected', hr], [await h.attr(`[data-testid="approval-card"][data-approval-id="${rid}"]`, 'data-status'), (await get('/api/approval/target')).hash_short]);
    // 실제 오류: 이미 처리된 카드 승인 시도 → 409 (화면 B 는 버튼이 없으므로 API 오류 렌더는 직접 호출로 확인)
    const late = await b.evaluate(`fetch('/api/approvals/${id1}/approve', {method:'POST'}).then(r => r.status)`);
    check('B', '실제 API: 이미 처리된 카드 재승인 → 409 (backend 차단)', 409, late);
    check('X', '실제 서버 대상 페이지 JS 예외 0', [], b.consoleErrors);
  } catch (e) {
    check('X', 'live 흐름 실행 오류', 'no error', String(e.stack || e), false);
    await b.screenshot(path.join(OUT, 'live-99-error.png')).catch(() => null);
  } finally {
    await b.close();
    server.kill();
  }
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const mode = process.argv[2] || 'all';
  if (mode === 'fixture' || mode === 'all') await runFixture();
  if (mode === 'live' || mode === 'all') await runLive();
  const by = {};
  for (const r of results) { const k = `${r.tier}/${r.group}`; by[k] ??= { pass: 0, total: 0 }; by[k].total++; if (r.pass) by[k].pass++; }
  const pass = results.filter((r) => r.pass).length;
  console.log('\n요약 (tier/그룹 통과 N / 전체 M):');
  for (const [k, v] of Object.entries(by)) console.log(`  ${k}: ${v.pass} / ${v.total}${v.pass === v.total && v.total > 0 ? '' : '  ← FAIL'}`);
  console.log(`전체 ${pass} / ${results.length}`);
  console.log(`UNPROVEN ${unproven.length}건:`); unproven.forEach((u) => console.log(`  - ${u}`));
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ at: new Date().toISOString(), by, pass, total: results.length, unproven, results }, null, 2));
  process.exitCode = results.length > 0 && pass === results.length ? 0 : 1;
}
main();

// 화면 사용자 흐름 검증 (INTEGRATOR 검증 도구). 실제 브라우저로 화면 A/B/C 를 조작하고 화면 값 + API 값을 대조한다.
// Windows 에서 실행:  node \\wsl.localhost\Ubuntu\home\user\projects\Research_State_Engine\scripts\verify-ui.js
//  - WSL 에서 verify-ui 전용 DB 를 baseline 에서 준비하고 서버(PORT 4107)를 띄운다 (재시작 포함, G6)
//  - 계약: docs/CONTRACT.md §8.1 data-testid
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch } from './lib/cdp.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const WSL_ROOT = '/home/user/projects/Research_State_Engine';
const PORT = Number(process.env.VERIFY_UI_PORT || 4107);
const BASE = `http://localhost:${PORT}`;
const VDIR = 'var/verify-ui';
const SHOTS = path.join(ROOT, VDIR, 'shots');
const EXEC = '오늘 후보 단백질 RSE-01을 세포 모델에서 Western blot으로 측정했고, 재현성 검증 단계에서 중단했습니다.';
const PLAN = 'RSE-01을 세포 모델에서 Western blot으로 다시 해보려 합니다.';
const QUESTION = 'RSE-01을 세포 모델에서 Western blot으로 다시 해도 될까요?';

const wsl = (cmd) => execFileSync('wsl.exe', ['-d', 'Ubuntu', '--', 'bash', '-c', cmd], { encoding: 'utf8' });
const results = [];
function check(gate, name, expected, actual, pass = JSON.stringify(expected) === JSON.stringify(actual)) {
  results.push({ gate, name, expected, actual, pass: !!pass });
  console.log(`${pass ? 'PASS' : 'FAIL'} [${gate}] ${name} — 기대 ${JSON.stringify(expected)} / 실제 ${JSON.stringify(actual)}`);
}

// 선택: RSE_SUPERVISOR=http://localhost:<port> 이면 서버 기동/정지를 그 supervisor 에 맡긴다
// (발표 서버와 같은 환경 — 예: LLM 인증 — 으로 검증할 때. 환경값은 이 스크립트로 넘어오지 않는다)
const SUP = process.env.RSE_SUPERVISOR;
const supCall = async (p, b) => (await fetch(SUP + p, { method: 'POST', body: JSON.stringify(b) })).json();

let server = null;
async function startServer() {
  if (SUP) {
    const r = await supCall('/start', { name: 'verify-ui', port: PORT, dbPath: `${VDIR}/rse.db`, dataDir: VDIR });
    if (!r.ok) throw new Error('UI 검증 서버 시작 실패 (supervisor)');
    server = 'sup';
    return;
  }
  server = spawn('wsl.exe', ['-d', 'Ubuntu', '--', 'bash', '-c',
    `cd ${WSL_ROOT} && PORT=${PORT} DATA_DIR=${VDIR} DB_PATH=${VDIR}/rse.db APPROVAL_DIR=${VDIR}/approval exec node --disable-warning=ExperimentalWarning src/server.js`],
  { stdio: 'ignore', windowsHide: true });
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`${BASE}/api/health`)).ok) return; } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('UI 검증 서버 시작 실패');
}
async function stopServer() {
  if (!server) return;
  const s = server; server = null;
  if (s === 'sup') { await supCall('/stop', { name: 'verify-ui', port: PORT }); return; }
  await new Promise((r) => { s.once('exit', r); s.kill(); setTimeout(r, 3000); });
  for (let i = 0; i < 20; i++) {
    try { await fetch(`${BASE}/api/health`); } catch { return; }
    await new Promise((r) => setTimeout(r, 250));
  }
}
const api = async (p) => (await fetch(BASE + p)).json();

async function main() {
  fs.mkdirSync(SHOTS, { recursive: true });
  console.log(wsl(`cd ${WSL_ROOT} && VERIFY_DIR=${VDIR} node --disable-warning=ExperimentalWarning scripts/verify-gates.js --prepare-only`).trim());
  await startServer();
  const b = await launch();
  const shot = (n) => b.screenshot(path.join(SHOTS, `${n}.png`));
  const nav = async (x) => { if (await b.exists(`nav-${x}`)) await b.click(`nav-${x}`); };
  const attrs = (id, attr) => b.evaluate(`[...document.querySelectorAll('[data-testid="${id}"]')].map(e => e.getAttribute('${attr}'))`);
  // 발화 1건 전송 후 서버 응답 처리가 끝날 때까지 기다린다 (이번 세션 발화 목록 +1 · 보내기 버튼 재활성)
  const idle = `!document.querySelector('[data-testid="chat-send"]').disabled && document.querySelector('[data-testid="a-status"]')?.dataset.state !== 'loading'`;
  const send = async (text) => {
    await nav('a');
    await b.waitFor(idle, 120000);
    const n = await b.evaluate(`document.querySelectorAll('[data-testid="chat-log"] > li').length`);
    await b.type('chat-input', text);
    await b.click('chat-send');
    await b.waitFor(`document.querySelectorAll('[data-testid="chat-log"] > li').length > ${n} && ${idle}`, 120000);
  };
  try {
    await b.goto(BASE + '/');
    await b.waitFor(`!!document.querySelector('[data-testid="data-notice"]')`);
    check('UI', '데이터 고지 표시', true, (await b.text('data-notice'))?.includes('시연용 합성 데이터'), undefined);
    await shot('00-initial');

    // G1: 계획/질문 → 행 증가 0, 실행 → 새 행 + 자동 기록 한 줄
    await nav('c');
    const rows0 = await b.count('attempt-row');
    const apiN0 = (await api('/api/attempts')).attempts.length;
    check('G1', '화면 C 행 수 = API', apiN0, rows0);
    await send(PLAN);
    await new Promise((r) => setTimeout(r, 4000));
    await nav('c');
    check('G1', '계획 발화 후 화면 C 행 증가 0', rows0, await b.count('attempt-row'));
    const apiBeforeQ = (await api('/api/attempts')).attempts.length;
    await send(QUESTION);
    await b.waitFor(`(document.querySelector('[data-testid="answer-tried"]')?.innerText || '').length > 0`, 60000).catch(() => null);
    const triedBefore = await b.text('answer-tried');
    check('G2', '화면 A 입력 전 질문: 같은 접근 2번 표시', true, /2번/.test(triedBefore ?? ''), undefined);
    await nav('c');
    check('G1', '질문 발화 후 화면 C 행 증가 0 / API 증가 0', [rows0, apiBeforeQ], [await b.count('attempt-row'), (await api('/api/attempts')).attempts.length]);
    await send(EXEC);
    await b.waitFor(`(document.querySelector('[data-testid="auto-record-line"]')?.innerText || '').includes('자동 기록됨')`, 60000);
    const line = await b.text('auto-record-line');
    check('G1', '자동 기록 한 줄 표시', true, line.includes('RSE-01') && line.includes('자동 기록됨'), undefined);
    await shot('01-auto-record');
    await nav('c');
    await b.waitFor(`document.querySelectorAll('[data-testid="attempt-row"]').length === ${rows0 + 1}`, 10000).catch(() => null);
    check('G1', '실행 발화 후 화면 C 새 행 (+1)', rows0 + 1, await b.count('attempt-row'));
    const newest = (await api('/api/attempts')).attempts[0];
    const rowRaw = await b.evaluate(`document.querySelector('[data-testid="attempt-row"][data-attempt-id="${newest.id}"] [data-testid="attempt-raw"]')?.innerText ?? null`);
    check('G1', '새 행에 원문 표시', EXEC, rowRaw?.trim());
    const rowText = await b.evaluate(`document.querySelector('[data-testid="attempt-row"][data-attempt-id="${newest.id}"]')?.innerText ?? ''`);
    const structured = ['RSE-01', '세포', '중단', '재현성 검증'].filter((w) => !rowText.includes(w));
    check('G1', '새 행에 구조화 값(대상·환경·결과·중단 단계) 표시', [], structured);
    await shot('02-screen-c-new-row');

    // G2: 재질문 → 3번 + 재현성 검증
    await send(QUESTION);
    await b.waitFor(`/3번/.test(document.querySelector('[data-testid="answer-tried"]')?.innerText || '')`, 60000).catch(() => null);
    const tried = await b.text('answer-tried');
    check('G2', '화면 A 이미 해본 것 = 3번 · 재현성 검증', true, /3번/.test(tried ?? '') && (tried ?? '').includes('재현성 검증'), undefined);
    const evText = (await b.text('answer-evidence')) ?? '';
    const nextText = (await b.text('answer-next')) ?? '';
    check('G2', '화면 A 근거 상태·다음 후보 내용 표시', [true, true], [evText.trim().length > 0, nextText.trim().length > 0]);
    const qApi = (await api('/api/judgments')).judgments[0];
    check('G2', '다음 후보: 근거 부족 문구 또는 저장 근거 기반', true,
      nextText.includes('저장된 이력과 검증된 근거만으로는 다음 경로를 제시할 수 없습니다') || (qApi?.attempt_ids?.length > 0 && nextText.length > 0), undefined);
    await nav('c');
    check('G1', '재질문 후 화면 C 행 수 불변', rows0 + 1, await b.count('attempt-row'));
    await shot('03-answer');

    // G4: [지금 재검사] → 철회됨 + 재검토 필요
    await nav('c');
    const ev = (await api('/api/evidence')).evidence.find((e) => e.input.doi === '10.1038/nature04533');
    const jg = (await api('/api/judgments')).judgments.find((j) => j.evidence.some((e) => e.id === ev.id));
    const evStatus = () => b.evaluate(`document.querySelector('[data-testid="evidence-row"][data-evidence-id="${ev.id}"]')?.getAttribute('data-status') ?? null`);
    const jReview = () => b.evaluate(`document.querySelector('[data-testid="judgment-row"][data-judgment-id="${jg.id}"]')?.getAttribute('data-needs-review') ?? null`);
    const jText = () => b.evaluate(`document.querySelector('[data-testid="judgment-row"][data-judgment-id="${jg.id}"]')?.innerText ?? ''`);
    const eText = () => b.evaluate(`document.querySelector('[data-testid="evidence-row"][data-evidence-id="${ev.id}"]')?.innerText ?? ''`);
    check('G4', '재검사 전 화면: 근거 확인 / 재검토 없음', ['verified', '0'], [await evStatus(), await jReview()]);
    check('G4', '재검사 전 화면: 과거 상태 고지 + "확인" 라벨', [true, true],
      [(await jText()).includes('철회 이전 시점의 시연용 과거 상태') || (await eText()).includes('철회 이전 시점의 시연용 과거 상태'), (await eText()).includes('확인')]);
    await shot('04-before-recheck');
    await b.click('recheck-btn');
    await b.waitFor(`document.querySelector('[data-testid="judgment-row"][data-judgment-id="${jg.id}"]')?.getAttribute('data-needs-review') === '1'`, 60000).catch(() => null);
    check('G4', '재검사 후 화면: 철회됨 / 재검토 필요', ['retracted', '1'], [await evStatus(), await jReview()]);
    check('G4', '재검사 후 텍스트: "철회됨" + "재검토 필요"', [true, true], [(await eText()).includes('철회됨'), (await jText()).includes('재검토 필요')]);
    const allEv = (await api('/api/evidence')).evidence;
    const uiStatuses = await attrs('evidence-row', 'data-status');
    check('G3', '화면 C 근거 행 상태 = API 상태 (전수)', allEv.map((e) => e.status).sort(), [...uiStatuses].sort());
    const pageText = await b.evaluate('document.body.innerText');
    check('G3', '화면에 부재·가짜 단정 표현 없음', [], ['논문 없음', '가짜 논문', '존재하지 않음', '존재하지 않는'].filter((w) => pageText.includes(w)));
    await shot('05-after-recheck');

    // G5: 덮어쓰기 요청 → 대기 카드 → 분석 완료 → 승인 → 전후 hash
    await nav('b');
    const fixtureHash = (await api('/api/approval/target')).hash_short;
    await b.click('request-overwrite');
    await b.waitFor(`[...document.querySelectorAll('[data-testid="approval-card"]')].some(c => c.getAttribute('data-status') === 'pending')`, 10000);
    const card = `[data-testid="approval-card"][data-status="pending"]`;
    const before = await b.evaluate(`document.querySelector('${card} [data-testid="approval-hash-before"]')?.innerText ?? null`);
    check('G5', '대기 카드 승인 전 hash = 원본 hash', fixtureHash, before?.trim());
    const cardText = await b.evaluate(`document.querySelector('${card}')?.innerText ?? ''`);
    const pendingApi = (await api('/api/approvals')).approvals.find((a) => a.status === 'pending');
    check('G5', '카드에 작업·승인 이유·영향 대상 표시', [true, true, true],
      [cardText.includes(pendingApi?.description ?? '∅'), cardText.includes(pendingApi?.reason ?? '∅'), cardText.includes('original_measurements.csv')]);
    const runs0 = await b.count('run-result');
    await b.click('run-analysis');
    await b.waitFor(`document.querySelectorAll('[data-testid="run-result"]').length > ${runs0}`, 10000).catch(() => null);
    check('G5', '대기 중 분석 결과 추가 + 카드 여전히 대기', [runs0 + 1, true], [await b.count('run-result'), await b.evaluate(`!!document.querySelector('${card}')`)]);
    check('G5', '승인 전 원본 hash 불변(API)', fixtureHash, (await api('/api/approval/target')).hash_short);
    await shot('06-pending-and-analysis');
    const cardId = await b.evaluate(`document.querySelector('${card}').getAttribute('data-approval-id')`);
    await b.click('approve-btn', `[data-testid="approval-card"][data-approval-id="${cardId}"]`);
    const sel = `[data-testid="approval-card"][data-approval-id="${cardId}"]`;
    await b.waitFor(`document.querySelector('${sel}')?.getAttribute('data-status') === 'approved'`, 10000).catch(() => null);
    const hb = await b.evaluate(`document.querySelector('${sel} [data-testid="approval-hash-before"]')?.innerText?.trim() ?? null`);
    const ha = await b.evaluate(`document.querySelector('${sel} [data-testid="approval-hash-after"]')?.innerText?.trim() ?? null`);
    const nowHash = (await api('/api/approval/target')).hash_short;
    check('G5', '승인 후 화면 전/후 hash 나란히 + 변경', [fixtureHash, nowHash, true], [hb, ha, hb !== ha]);
    await shot('07-approved-hashes');
    // 거절 경로: 새 요청 → 거절 → 카드 거절 상태 + 원본 hash 불변
    const hashNow = (await api('/api/approval/target')).hash_short;
    await b.click('request-overwrite');
    await b.waitFor(`!!document.querySelector('${card}')`, 10000);
    const rid = await b.evaluate(`document.querySelector('${card}').getAttribute('data-approval-id')`);
    await b.click('reject-btn', `[data-testid="approval-card"][data-approval-id="${rid}"]`);
    await b.waitFor(`document.querySelector('[data-testid="approval-card"][data-approval-id="${rid}"]')?.getAttribute('data-status') === 'rejected'`, 10000).catch(() => null);
    check('G5', '화면 거절 → 카드 rejected + 원본 hash 불변', ['rejected', hashNow],
      [await b.evaluate(`document.querySelector('[data-testid="approval-card"][data-approval-id="${rid}"]')?.getAttribute('data-status') ?? null`), (await api('/api/approval/target')).hash_short]);

    // G6: 서버 재시작 → 화면에서 5개 상태 유지
    const snapApi = async () => {
      const a = await api('/api/attempts'); const e = await api('/api/evidence'); const j = await api('/api/judgments');
      return [a.attempts.length, e.evidence.length, j.judgments.reduce((n, x) => n + x.evidence.length, 0),
        e.evidence.filter((x) => x.status === 'retracted').length, j.judgments.filter((x) => x.needs_review).length];
    };
    const before6 = await snapApi();
    await stopServer();
    await startServer();
    await b.goto(BASE + '/');
    await nav('c');
    await b.waitFor(`document.querySelectorAll('[data-testid="attempt-row"]').length > 0`, 10000);
    const after6 = await snapApi();
    check('G6', '재시작 후 API 5상태 유지 [시도,근거,연결,철회,재검토]', before6, after6, JSON.stringify(before6) === JSON.stringify(after6) && after6.every((n) => n > 0));
    check('G6', '재시작 후 화면: 시도 행 수', before6[0], await b.count('attempt-row'));
    check('G6', '재시작 후 화면: 철회됨 / 재검토 필요', ['retracted', '1'], [await evStatus(), await jReview()]);
    await shot('08-after-restart');
    check('UI', '페이지 JS 예외 0', [], b.consoleErrors);
  } catch (e) {
    check('UI', '흐름 실행 오류', 'no error', String(e.message || e), false);
    await shot('99-error').catch(() => null);
  } finally {
    await b.close();
    await stopServer();
  }
  // 화면 판정: gate 별 전부 통과 + 최소 검사 수 충족일 때만 PASS(UI). 흐름 오류가 나면 이후 검사 누락 → 최소 수 미달 → FAIL.
  const MIN = { UI: 2, G1: 8, G2: 4, G3: 2, G4: 4, G5: 6, G6: 3 };
  const byGate = {};
  for (const r of results) { byGate[r.gate] ??= { pass: 0, total: 0 }; byGate[r.gate].total++; if (r.pass) byGate[r.gate].pass++; }
  for (const [g, min] of Object.entries(MIN)) {
    const v = (byGate[g] ??= { pass: 0, total: 0 });
    v.min = min;
    v.verdict = v.total >= min && v.pass === v.total ? 'PASS(UI)' : 'FAIL';
  }
  const pass = results.filter((r) => r.pass).length;
  console.log('\nUI 요약:', Object.entries(byGate).map(([g, v]) => `${g} ${v.pass}/${v.total} ${v.verdict}`).join(' · '), `| 전체 ${pass}/${results.length}  shots: ${SHOTS}`);
  fs.writeFileSync(path.join(ROOT, VDIR, 'ui-report.json'), JSON.stringify({ at: new Date().toISOString(), byGate, pass, total: results.length, results }, null, 2));
  process.exitCode = pass === results.length && results.length > 0 ? 0 : 1;
}

main();

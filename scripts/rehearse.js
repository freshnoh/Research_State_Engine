// 발표 리허설 (검증 도구, 제품 코드 아님). Windows 에서 실행:
//   node \\wsl.localhost\Ubuntu\home\user\projects\Research_State_Engine\scripts\rehearse.js [회차수=3]
// 매 회차: 서버 정지 → baseline:restore(4/4 확인) → 실제 발표 서버(PORT 4100, 운영 DB) 기동 →
//          실제 브라우저로 발표 순서 실행 → 핵심 DB/API/화면 값 확인 → 서버 정지. 마지막에 baseline 재복원.
import { spawn, execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch } from './lib/cdp.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WSL_ROOT = '/home/user/projects/Research_State_Engine';
const BASE = 'http://localhost:4100';
const ROUNDS = Number(process.argv[2] || 3);
const Q = 'RSE-01 세포에서 WB 해볼 생각인데 전에 해본 적 있어?';
const EXEC = '오늘 RSE-01 세포에서 WB 해봤는데 또 재현성 검증 단계에서 접었어요.';

const wsl = (cmd) => execFileSync('wsl.exe', ['-d', 'Ubuntu', '--', 'bash', '-c', cmd], { encoding: 'utf8' });
const same = () => Number(wsl(`sqlite3 ${WSL_ROOT}/var/rse.db "select count(*) from research_attempt where target_norm='RSE-01' and method_norm='western_blot' and environment_norm='cell'"`).trim());
// 선택: RSE_SUPERVISOR 가 있으면 발표 서버 기동/정지·baseline 복원을 supervisor 에 맡긴다 (발표 서버와 같은 환경)
const SUP = process.env.RSE_SUPERVISOR;
const supCall = async (p, b = {}) => (await fetch(SUP + p, { method: 'POST', body: JSON.stringify(b) })).json();
const restore = async () => {
  if (SUP) { const r = await supCall('/restore'); return { ok: r.ok, line: (r.text || '').split('\n').find((l) => l.startsWith('baseline')) }; }
  const out = wsl(`cd ${WSL_ROOT} && node --disable-warning=ExperimentalWarning scripts/baseline.js restore; echo EXIT=$?`);
  return { ok: /baseline 4\/4/.test(out) && /EXIT=0/.test(out), line: out.split('\n').find((l) => l.startsWith('baseline')) };
};

let server = null;
async function start() {
  if (SUP) {
    const r = await supCall('/start', { name: 'demo', port: 4100 });
    if (!r.ok) throw new Error('발표 서버 시작 실패 (supervisor)');
    server = 'sup';
    return;
  }
  server = spawn('wsl.exe', ['-d', 'Ubuntu', '--', 'bash', '-c', `cd ${WSL_ROOT} && exec node --disable-warning=ExperimentalWarning src/server.js`], { stdio: 'ignore', windowsHide: true });
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) return; } catch {} await new Promise((r) => setTimeout(r, 250)); }
  throw new Error('발표 서버 시작 실패');
}
async function stop() {
  if (!server) return;
  const s = server; server = null;
  if (s === 'sup') { await supCall('/stop', { name: 'demo', port: 4100 }); return; }
  await new Promise((r) => { s.once('exit', r); s.kill(); setTimeout(r, 3000); });
  for (let i = 0; i < 20; i++) { try { await fetch(`${BASE}/api/health`); } catch { return; } await new Promise((r) => setTimeout(r, 250)); }
}

async function round(n) {
  const checks = [];
  const ck = (name, exp, act) => { const pass = JSON.stringify(exp) === JSON.stringify(act); checks.push({ name, exp, act, pass }); return pass; };
  const r0 = await restore();
  ck('시작 baseline 4/4', true, r0.ok);
  await start();
  const b = await launch({ width: 1920, height: 1080 });
  const idle = `!document.querySelector('[data-testid="chat-send"]').disabled && document.querySelector('[data-testid="a-status"]')?.dataset.state !== 'loading'`;
  const send = async (t) => {
    await b.click('nav-a'); await b.waitFor(idle, 120000);
    const k = await b.evaluate(`document.querySelectorAll('[data-testid="chat-log"] > li').length`);
    await b.type('chat-input', t); await b.click('chat-send');
    await b.waitFor(`document.querySelectorAll('[data-testid="chat-log"] > li').length > ${k} && ${idle}`, 120000);
  };
  try {
    await b.goto(BASE + '/');
    await b.waitFor(`!!document.querySelector('[data-testid="data-notice"]')`);
    // ① 계획+질문 → 저장 0, 과거 2건 표시
    await send(Q);
    const t1 = (await b.text('answer-tried')) ?? '';
    ck('질문 후 DB 같은 접근 2', 2, same());
    ck('화면 A 2번·재현성 검증', true, /2번/.test(t1) && t1.includes('재현성 검증'));
    // ② 실제 수행 → 2→3, 자동 기록 한 줄
    await send(EXEC);
    const line = (await b.text('auto-record-line')) ?? '';
    ck('실행 후 DB 같은 접근 3', 3, same());
    if (process.env.RSE_EXPECT_EXTRACTOR) {
      const top = (await (await fetch(BASE + '/api/attempts')).json()).attempts[0];
      ck(`실행 extractor = ${process.env.RSE_EXPECT_EXTRACTOR} (fallback 없음)`, process.env.RSE_EXPECT_EXTRACTOR, top?.extractor);
    }
    ck('자동 기록 한 줄 (RSE-01·세포·중단)', true, line.includes('자동 기록됨') && line.includes('RSE-01') && line.includes('세포') && line.includes('중단'));
    // ③ 재질문 → 3건
    await send(Q);
    const t3 = (await b.text('answer-tried')) ?? '';
    ck('재질문 화면 A 3번·재현성 검증 / DB 3', [true, 3], [/3번/.test(t3) && t3.includes('재현성 검증'), same()]);
    // ④ 화면 C 새 행 + [지금 재검사] → 철회됨·재검토 필요
    await b.click('nav-c');
    const api = async (p) => (await fetch(BASE + p)).json();
    const newest = (await api('/api/attempts')).attempts[0];
    await b.waitFor(`!!document.querySelector('[data-testid="attempt-row"][data-attempt-id="${newest.id}"]')`, 10000).catch(() => null);
    ck('화면 C 새 행 원문', EXEC, (await b.evaluate(`document.querySelector('[data-testid="attempt-row"][data-attempt-id="${newest.id}"] [data-testid="attempt-raw"]')?.innerText ?? null`))?.trim());
    const ev = (await api('/api/evidence')).evidence.find((e) => e.input.doi === '10.1038/nature04533');
    const jg = (await api('/api/judgments')).judgments.find((j) => j.evidence.some((e) => e.id === ev.id));
    const st = () => b.evaluate(`[document.querySelector('[data-testid="evidence-row"][data-evidence-id="${ev.id}"]')?.getAttribute('data-status'), document.querySelector('[data-testid="judgment-row"][data-judgment-id="${jg.id}"]')?.getAttribute('data-needs-review')]`);
    ck('재검사 전 확인 / 재검토 0', ['verified', '0'], await st());
    await b.click('recheck-btn');
    await b.waitFor(`document.querySelector('[data-testid="judgment-row"][data-judgment-id="${jg.id}"]')?.getAttribute('data-needs-review') === '1'`, 60000).catch(() => null);
    ck('재검사 후 철회됨 / 재검토 필요', ['retracted', '1'], await st());
    // ⑤ 화면 B 승인 게이트
    await b.click('nav-b');
    const h0 = (await api('/api/approval/target')).hash_short;
    await b.click('request-overwrite');
    const card = '[data-testid="approval-card"][data-status="pending"]';
    await b.waitFor(`!!document.querySelector('${card}')`, 10000);
    const runs0 = await b.count('run-result');
    await b.click('run-analysis');
    await b.waitFor(`document.querySelectorAll('[data-testid="run-result"]').length > ${runs0}`, 10000).catch(() => null);
    ck('대기 중 분석 완료 + 원본 불변', [runs0 + 1, true, h0], [await b.count('run-result'), await b.evaluate(`!!document.querySelector('${card}')`), (await api('/api/approval/target')).hash_short]);
    const id = await b.evaluate(`document.querySelector('${card}').getAttribute('data-approval-id')`);
    const sel = `[data-testid="approval-card"][data-approval-id="${id}"]`;
    await b.click('approve-btn', sel);
    await b.waitFor(`document.querySelector('${sel}')?.getAttribute('data-status') === 'approved'`, 10000).catch(() => null);
    const hb = await b.evaluate(`document.querySelector('${sel} [data-testid="approval-hash-before"]')?.innerText?.trim()`);
    const ha = await b.evaluate(`document.querySelector('${sel} [data-testid="approval-hash-after"]')?.innerText?.trim()`);
    ck('승인 전/후 hash 나란히 + 변경', [h0, (await api('/api/approval/target')).hash_short, true], [hb, ha, hb !== ha]);
    await b.screenshot(path.join(ROOT, 'var', `rehearsal-${n}.png`));
    ck('페이지 JS 예외 0', [], b.consoleErrors);
  } catch (e) {
    ck('흐름 오류 없음', 'no error', String(e.message || e));
  } finally {
    await b.close();
    await stop();
  }
  const pass = checks.every((c) => c.pass);
  console.log(`${n}회차 ${pass ? 'O' : 'X'} (${checks.filter((c) => c.pass).length}/${checks.length})`);
  for (const c of checks.filter((c) => !c.pass)) console.log(`   ✗ ${c.name} — 기대 ${JSON.stringify(c.exp)} / 실제 ${JSON.stringify(c.act)}`);
  return pass;
}

const results = [];
for (let i = 1; i <= ROUNDS; i++) results.push(await round(i));
const fin = await restore();
console.log(`리허설 ${results.filter(Boolean).length}/${ROUNDS} · 최종 ${fin.line}`);
process.exitCode = results.every(Boolean) && fin.ok ? 0 : 1;

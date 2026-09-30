// SCREENS 정적 계약 검사 (네트워크·브라우저 불필요, npm test 에 포함).
// 브라우저 동작 검증은 test/screens/run-browser.js (실제 Chrome) 에서 한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PUB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'public');
const read = (f) => fs.readFileSync(path.join(PUB, f), 'utf8');
const html = read('index.html');
const js = read('app.js');
const css = read('app.css');
const src = `${html}\n${js}`;

// docs/CONTRACT.md §7.1 필수 testid (23종)
const TESTIDS = [
  'nav-a', 'nav-b', 'nav-c', 'data-notice',
  'chat-input', 'chat-send', 'auto-record-line', 'answer-tried', 'answer-evidence', 'answer-next',
  'request-overwrite', 'run-analysis', 'approval-card', 'approval-hash-before', 'approval-hash-after', 'approve-btn', 'reject-btn', 'run-result',
  'recheck-btn', 'attempt-row', 'attempt-raw', 'evidence-row', 'judgment-row',
];
const ATTRS = ['data-approval-id', 'data-status', 'data-run-id', 'data-attempt-id', 'data-evidence-id', 'data-judgment-id', 'data-needs-review'];
const ALLOWED_API = new Set([
  '/api/chat', '/api/attempts', '/api/evidence', '/api/judgments', '/api/approvals', '/api/runs', '/api/approval/target',
  '/api/actions', '/api/recheck',
]);

test('필수 data-testid 23종이 모두 소스에 정의됨 (기대 23 / 실제 N)', () => {
  const missing = TESTIDS.filter((id) => !src.includes(`data-testid="${id}"`) && !src.includes(`'data-testid': '${id}'`) && !js.includes(`'${id}'`));
  assert.deepEqual(missing, []);
  assert.equal(TESTIDS.length, 23);
});

test('필수 data attribute 7종이 렌더 코드에 존재', () => {
  const missing = ATTRS.filter((a) => !js.includes(`'${a}'`) && !js.includes(`dataset.${a.slice(5).replace(/-(\w)/g, (_, c) => c.toUpperCase())}`));
  assert.deepEqual(missing, []);
});

test('nav 는 3개 · 화면은 A/B/C 3개뿐 (화면 D 없음)', () => {
  assert.equal((html.match(/data-testid="nav-[a-z]"/g) || []).length, 3);
  assert.deepEqual([...html.matchAll(/<section class="screen" id="screen-(\w)"/g)].map((m) => m[1]), ['a', 'b', 'c']);
});

test('호출하는 API 는 CONTRACT §5 범위 안', () => {
  const used = new Set([...js.matchAll(/['"`](\/api\/[a-z/]+)/g)].map((m) => m[1]));
  assert.ok(used.size >= 8, `호출 경로 수 ${used.size}`);
  assert.deepEqual([...used].filter((u) => !ALLOWED_API.has(u) && u !== '/api/approvals/'), []); // /api/approvals/:id/(approve|reject)
});

test('production 코드에 결과 값 하드코딩 없음 (철회일·DOI별 상태·2→3·중단 단계)', () => {
  const bad = [
    /2024-06-24/, /nature04533/i, /10\.\d{4,}\//, /reproducibility_validation/, /재현성 검증/, /행동검증/,
    /\b[23]번\b/, /needs_review\s*=\s*(1|true)/, /status\s*=\s*['"]retracted['"]/, /RSE-01/, /Aβ/,
  ].filter((re) => re.test(js));
  assert.deepEqual(bad.map(String), []);
});

test('부재·가짜·거짓 단정 문구 없음 / 판단이 틀렸다는 단정 없음', () => {
  const all = `${html}\n${js}`;
  const hits = ['논문 없음', '가짜 논문', '존재하지 않음', '존재하지 않는', '거짓'].filter((w) => all.includes(w));
  assert.deepEqual(hits, []);
  assert.equal(/틀렸(?!다는 뜻(이|은) 아닙니다)/.test(all), false);
});

test('데이터 고지·조회 실패 ≠ 논문 부재 문구가 index.html 에 고정', () => {
  const n = html.match(/data-testid="data-notice"[\s\S]*?<\/header>/)[0];
  for (const w of ['기관 연구 이력·내부 판단', '시연용 합성 데이터', '논문·DOI·현재 철회 정보', '공개 실제 데이터', '조회 실패 ≠ 논문 부재']) {
    assert.ok(n.includes(w), w);
  }
});

test('저장/확인/초기화(reset) 버튼 없음 · 외부 스크립트/폰트 없음', () => {
  const labels = [...html.matchAll(/<button[^>]*>([\s\S]*?)<\/button>/g)].map((m) => m[1].replace(/<[^>]+>/g, ''));
  labels.push(...[...js.matchAll(/h\('button',[^\n]*?\}, '([^']+)'/g)].map((m) => m[1]));
  assert.ok(labels.length >= 8, `버튼 라벨 ${labels.length}개`);
  assert.deepEqual(labels.filter((t) => /저장|초기화|reset|리셋/i.test(t)), []);
  assert.deepEqual([...src.matchAll(/(?:src|href)="(https?:)?\/\/[^"]+"/g)].map((m) => m[0]), []);
  assert.equal(/@import|url\(http/.test(css), false);
});

test('상태 표시 4종(idle/loading/success/error)을 모든 화면이 사용', () => {
  for (const s of ['idle', 'loading', 'success', 'error']) assert.ok(js.includes(`'${s}'`) || css.includes(`data-state="${s}"`), s);
  for (const a of ['a', 'b', 'c']) assert.ok(html.includes(`data-testid="${a}-status" data-state="idle"`), `${a}-status`);
});

// 발표 초기화 (본선 시연 전용 운영 예외 — 일반 제품 기능 아님).
// DEMO_MODE=1 일 때만 라우트가 생기고, 루프백 접속 + 전용 헤더가 있는 POST 만 처리한다.
// 복원 원천은 CLI 와 같은 baseline 사본(scripts/baseline.js create)이다. 실행 중인 DB 파일을 덮어쓰지 않고,
// 열려 있는 연결에서 한 트랜잭션으로 모든 테이블 내용을 baseline 사본의 내용으로 바꾼다.
import fs from 'node:fs';
import { HttpError } from './http.js';
import { nowIso, tx } from '../db/index.js';
import { sha256File, ORIGINAL_FIXTURE, originalPath } from '../approval/gate.js';
import { baselineDbPath, checkBaseline } from './baseline.js';

// 서버는 127.0.0.1 에만 바인드한다. 판정은 소켓의 실제 peer 주소로만 한다 (Host·X-Forwarded-For·본문 값은 보지 않음).
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
export const isLoopback = (addr) => LOOPBACK.has(addr);
// 사용자 정의 헤더를 요구해 다른 사이트가 브라우저로 보내는 교차 출처 요청(사전 요청 없이 전송되는 단순 POST)을 막는다.
export const RESET_HEADER = 'x-rse-demo';

const userTables = (db, schema) => db.prepare(`SELECT name FROM ${schema}.sqlite_master
  WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name <> 'schema_meta' ORDER BY name`).all().map((r) => r.name);
const count = (db, schema, t) => db.prepare(`SELECT COUNT(*) AS n FROM ${schema}."${t}"`).get().n;

export function resetToBaseline(db, config) {
  const baseDb = baselineDbPath(config);
  if (!fs.existsSync(baseDb)) throw new HttpError(409, 'NO_BASELINE', 'baseline 사본이 없습니다 (npm run baseline:create)');
  const tables = userTables(db, 'main');
  const counts = {};
  db.prepare('ATTACH DATABASE ? AS base').run(baseDb);
  try {
    const missing = tables.filter((t) => !userTables(db, 'base').includes(t));
    if (missing.length) throw new HttpError(409, 'BASELINE_SCHEMA', `baseline 사본에 없는 테이블: ${missing.join(', ')}`);
    tx(db, () => {
      db.exec('PRAGMA defer_foreign_keys = ON');
      for (const t of tables) db.exec(`DELETE FROM main."${t}"`);
      for (const t of tables) {
        const cols = db.prepare(`PRAGMA main.table_info("${t}")`).all().map((c) => `"${c.name}"`).join(', ');
        db.exec(`INSERT INTO main."${t}" (${cols}) SELECT ${cols} FROM base."${t}"`);
      }
      db.exec('DELETE FROM main.sqlite_sequence');
      db.exec('INSERT INTO main.sqlite_sequence (name, seq) SELECT name, seq FROM base.sqlite_sequence');
    });
    for (const t of tables) counts[t] = { expected: count(db, 'base', t), actual: count(db, 'main', t) };
  } finally {
    db.exec('DETACH DATABASE base');
  }

  // 원본 측정값 파일: 임시 파일에 fixture 복사 → hash 확인 → 교체
  const orig = originalPath(config);
  fs.mkdirSync(config.approvalDir, { recursive: true });
  const tmp = `${orig}.reset-tmp`;
  fs.copyFileSync(ORIGINAL_FIXTURE, tmp);
  if (sha256File(tmp) !== sha256File(ORIGINAL_FIXTURE)) {
    fs.rmSync(tmp, { force: true });
    throw new HttpError(500, 'RESET_FILE', '원본 측정값 임시 파일 hash 불일치');
  }
  fs.renameSync(tmp, orig);

  // 성공 여부는 다시 읽은 실제 값으로만 판정한다
  const baseline = checkBaseline(config.dbPath, orig);
  const live = db.prepare("SELECT COUNT(*) AS n FROM research_attempt WHERE source='live'").get().n;
  const extra = [
    { name: '이번 시연에서 추가된 연구 시도', expected: 0, actual: live },
    ...Object.entries(counts).map(([t, c]) => ({ name: `${t} 행 수 = baseline`, expected: c.expected, actual: c.actual })),
  ];
  for (const c of extra) c.pass = c.expected === c.actual;
  const ok = baseline.ok && extra.every((c) => c.pass);
  return { ok, baseline, extra };
}

export function register(router, { db, config }) {
  if (!config.demoMode) return;
  router.post('/api/demo/reset', ({ req }) => {
    if (!isLoopback(req.socket.remoteAddress)) throw new HttpError(403, 'LOCAL_ONLY', '발표 초기화는 이 컴퓨터에서만 실행할 수 있습니다');
    if (req.headers[RESET_HEADER] !== 'reset') throw new HttpError(403, 'HEADER_REQUIRED', '발표 초기화 요청 형식이 아닙니다');
    const r = resetToBaseline(db, config);
    const summary = {
      baseline: { passed: r.baseline.passed, total: r.baseline.total, checks: r.baseline.checks, guard: r.baseline.guard },
      extra: r.extra.filter((c) => !c.pass || c.name.startsWith('이번')),
    };
    if (!r.ok) {
      const bad = [...r.baseline.checks, r.baseline.guard, ...r.extra].filter((c) => !c.pass).map((c) => `${c.name}: 기대 ${c.expected} / 실제 ${c.actual}`);
      console.error(`[rse] 발표 초기화 사후 검사 실패: ${bad.join(' | ')}`);
      return { status: 500, body: { ok: false, error: { code: 'RESET_POSTCHECK_FAILED', message: bad.join(' | ') }, ...summary } };
    }
    return { ok: true, reset_at: nowIso(), ...summary };
  });
}

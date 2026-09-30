// 시연 baseline 운영 스크립트 (INTEGRATOR 소유). 제품 기능이 아니라 운영 절차다 (SPEC §11).
//   node scripts/baseline.js create   — seed 로 baseline 사본 생성 (var/baseline/)
//   node scripts/baseline.js restore  — 서버 정지 상태에서 DB_PATH·원본 파일을 baseline 으로 복원 후 check
//   node scripts/baseline.js check    — 현재 DB_PATH·원본 파일이 시연 시작 조건 4/4 인지 검사
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { loadConfig } from '../src/config.js';
import { openDb } from '../src/db/index.js';
import { loadSeed } from '../src/core/seed.js';
import { sha256File, ORIGINAL_FIXTURE, originalPath } from '../src/approval/gate.js';

const RETRACTED_DOI = '10.1038/nature04533';
const cfg = loadConfig();
const baselineDir = path.join(cfg.dataDir, 'baseline');
const baselineDb = path.join(baselineDir, 'rse.baseline.db');

const rmDb = (p) => { for (const s of ['', '-wal', '-shm', '-journal']) fs.rmSync(p + s, { force: true }); };

function portInUse(port) {
  return new Promise((resolve) => {
    const s = net.connect({ port, host: '127.0.0.1' }, () => { s.destroy(); resolve(true); });
    s.on('error', () => resolve(false));
  });
}

export function checkBaseline(dbPath, originalFile) {
  const db = openDb(dbPath);
  const same = db.prepare(`SELECT COUNT(*) AS n FROM research_attempt
    WHERE target_norm='RSE-01' AND method_norm='western_blot' AND environment_norm='cell'`).get().n;
  const ev = db.prepare(`SELECT e.status FROM evidence e JOIN evidence_judgment_link l ON l.evidence_id=e.id
    JOIN judgment j ON j.id=l.judgment_id WHERE e.input_doi=? AND j.is_synthetic=1`).all(RETRACTED_DOI);
  const flagged = db.prepare('SELECT COUNT(*) AS n FROM judgment WHERE needs_review=1').get().n;
  const cached = db.prepare('SELECT COUNT(*) AS n FROM crossref_cache WHERE lower(doi)=?').get(RETRACTED_DOI).n;
  db.close();
  const expectHash = sha256File(ORIGINAL_FIXTURE);
  const actualHash = fs.existsSync(originalFile) ? sha256File(originalFile) : null;
  const checks = [
    { name: '같은 접근(RSE-01|western_blot|cell)', expected: 2, actual: same },
    { name: '과거 판단 근거 상태', expected: 'verified', actual: ev.length === 1 ? ev[0].status : `rows=${ev.length}` },
    { name: '재검토 표시 판단 수', expected: 0, actual: flagged },
    { name: '승인 테스트 원본 hash', expected: expectHash.slice(0, 16), actual: actualHash ? actualHash.slice(0, 16) : 'missing' },
  ];
  for (const c of checks) c.pass = c.expected === c.actual;
  const guard = { name: '철회 논문 현재 응답 cache 없음', expected: 0, actual: cached, pass: cached === 0 };
  return { checks, guard, passed: checks.filter((c) => c.pass).length, total: checks.length, ok: checks.every((c) => c.pass) && guard.pass };
}

async function create() {
  fs.mkdirSync(baselineDir, { recursive: true });
  const tmp = baselineDb + '.tmp';
  rmDb(tmp);
  const db = openDb(tmp);
  loadSeed(db);
  // 일반 근거 사전 조회 cache 는 EVIDENCE 모듈이 제공하면 사용한다 (철회 논문 제외)
  // 모듈이 아예 없을 때만 건너뛴다. 모듈이 있는데 오류가 나면 숨기지 않고 실패한다.
  const evidenceIndex = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'src', 'evidence', 'index.js');
  let prewarmed = 'skipped: src/evidence/index.js 없음';
  if (fs.existsSync(evidenceIndex)) {
    const { prewarmBaselineCache } = await import('../src/evidence/index.js');
    if (typeof prewarmBaselineCache !== 'function') throw new Error('src/evidence/index.js 에 prewarmBaselineCache 없음 (CONTRACT §5.2)');
    prewarmed = await prewarmBaselineCache(db, cfg, { exclude: [RETRACTED_DOI] });
  }
  const leaked = db.prepare('SELECT COUNT(*) AS n FROM crossref_cache WHERE lower(doi)=?').get(RETRACTED_DOI).n;
  if (leaked) throw new Error('baseline 거부: 철회 논문 현재 응답이 cache 에 들어감');
  db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
  db.close();
  rmDb(baselineDb);
  fs.renameSync(tmp, baselineDb);
  rmDb(tmp);
  console.log(JSON.stringify({ created: baselineDb, prewarmed }, null, 2));
}

async function restore() {
  if (await portInUse(cfg.port)) {
    console.error(`거부: PORT ${cfg.port} 에서 서버가 실행 중. 서버를 끈 뒤 복원한다.`);
    process.exit(2);
  }
  if (!fs.existsSync(baselineDb)) { console.error(`baseline 없음: ${baselineDb} (먼저 create)`); process.exit(2); }
  rmDb(cfg.dbPath);
  fs.mkdirSync(path.dirname(cfg.dbPath), { recursive: true });
  fs.copyFileSync(baselineDb, cfg.dbPath);
  const orig = originalPath(cfg);
  fs.mkdirSync(path.dirname(orig), { recursive: true });
  fs.copyFileSync(ORIGINAL_FIXTURE, orig);
  report();
}

function report() {
  const r = checkBaseline(cfg.dbPath, originalPath(cfg));
  for (const c of [...r.checks, r.guard]) console.log(`${c.pass ? 'PASS' : 'FAIL'}  ${c.name}: 기대 ${c.expected} / 실제 ${c.actual}`);
  console.log(`baseline ${r.passed}/${r.total} ${r.ok ? '→ 시연 시작 가능' : '→ 시연 시작 금지'}  (DB_PATH=${cfg.dbPath})`);
  process.exitCode = r.ok ? 0 : 1;
}

const cmd = process.argv[2];
if (cmd === 'create') await create();
else if (cmd === 'restore') await restore();
else if (cmd === 'check') report();
else if (cmd) { console.error('usage: baseline.js create|restore|check'); process.exit(2); }

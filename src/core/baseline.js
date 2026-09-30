// 시연 baseline 정의 (단일 원천). CLI(scripts/baseline.js)와 발표 초기화(src/core/demo.js)가 같이 쓴다.
import fs from 'node:fs';
import path from 'node:path';
import { openDb } from '../db/index.js';
import { sha256File, ORIGINAL_FIXTURE } from '../approval/gate.js';

export const RETRACTED_DOI = '10.1038/nature04533';

export const baselineDbPath = (config) => path.join(config.dataDir, 'baseline', 'rse.baseline.db');

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

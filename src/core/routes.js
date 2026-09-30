// 공용 읽기 API. 화면 A/B/C 가 공통으로 읽는다.
import { SCHEMA_VERSION } from '../db/index.js';
import { DATA_NOTICE } from '../contract/enums.js';
import { attemptView, evidenceView, judgmentView, approvalView, runView } from './views.js';

export function register(router, { db, config }) {
  router.get('/api/health', () => {
    const counts = {};
    for (const t of ['research_attempt', 'evidence', 'judgment', 'evidence_judgment_link', 'approval_action', 'action_run', 'crossref_cache']) {
      counts[t] = db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n;
    }
    return { ok: true, schema_version: SCHEMA_VERSION, db_path: config.dbPath, port: config.port, counts, data_notice: DATA_NOTICE };
  });

  router.get('/api/attempts', () => ({
    attempts: db.prepare('SELECT * FROM research_attempt ORDER BY id DESC').all().map(attemptView),
  }));

  router.get('/api/evidence', () => ({
    evidence: db.prepare('SELECT * FROM evidence ORDER BY id').all().map(evidenceView),
  }));

  router.get('/api/judgments', () => ({
    judgments: db.prepare('SELECT * FROM judgment ORDER BY id DESC').all().map((r) => judgmentView(db, r)),
  }));

  router.get('/api/approvals', () => ({
    approvals: db.prepare('SELECT * FROM approval_action ORDER BY id DESC').all().map(approvalView),
  }));

  router.get('/api/runs', () => ({
    runs: db.prepare('SELECT * FROM action_run ORDER BY id DESC').all().map(runView),
  }));
}

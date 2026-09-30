// 근거 API. 계약: docs/CONTRACT.md §5.2
import { HttpError, readJson } from '../core/http.js';
import { createEvidenceService, EvidenceError } from './service.js';

const wrap = (fn) => async (args) => {
  try {
    return await fn(args);
  } catch (e) {
    if (e instanceof EvidenceError) throw new HttpError(e.status, e.code, e.message);
    throw e;
  }
};

export function register(router, ctx) {
  const svc = createEvidenceService({ db: ctx.db, config: ctx.config, ...(ctx.fetch ? { fetch: ctx.fetch } : {}) });

  router.post('/api/evidence', wrap(async ({ req }) => svc.registerEvidence(await readJson(req))));
  router.post('/api/recheck', wrap(async ({ req }) => svc.recheck(await readJson(req))));
  router.get('/api/evidence/:id/judgments', wrap(async ({ params }) => {
    const id = Number(params.id);
    if (!Number.isInteger(id)) throw new EvidenceError(400, 'BAD_ID', 'evidence id 는 정수여야 합니다');
    return svc.judgmentsOf(id);
  }));
}

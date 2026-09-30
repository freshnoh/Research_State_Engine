// 승인 게이트 (INTEGRATOR 소유). 계약: docs/CONTRACT.md §5.3
import { readJson } from '../core/http.js';
import { approvalView, runView } from '../core/views.js';
import { classify } from './policy.js';
import { requestAction, approve, reject, targetInfo } from './gate.js';

export function register(router, { db, config }) {
  router.get('/api/actions/classify', ({ query }) => classify(query.action_type));

  router.get('/api/approval/target', () => targetInfo(config));

  router.post('/api/actions', async ({ req }) => {
    const out = requestAction(db, config, await readJson(req));
    const b = out.body;
    return {
      status: out.status,
      body: b.requires_approval
        ? { requires_approval: true, rule: b.rule, approval: approvalView(b.approval) }
        : { requires_approval: false, rule: b.rule, run: runView(b.run) },
    };
  });

  router.post('/api/approvals/:id/approve', ({ params }) => ({ approval: approvalView(approve(db, params.id)) }));
  router.post('/api/approvals/:id/reject', ({ params }) => ({ approval: approvalView(reject(db, params.id)) }));
}

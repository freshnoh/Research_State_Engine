// 승인 게이트 (INTEGRATOR 소유). 계약: docs/CONTRACT.md §5.3
import { HttpError } from '../core/http.js';

const notYet = () => { throw new HttpError(501, 'NOT_IMPLEMENTED', 'G5 backend 미구현'); };

export function register(router, _ctx) {
  router.post('/api/actions', notYet);
  router.post('/api/approvals/:id/approve', notYet);
  router.post('/api/approvals/:id/reject', notYet);
}

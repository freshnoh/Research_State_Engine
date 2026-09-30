// EVIDENCE 트랙 소유. 계약: docs/CONTRACT.md §5.2
// INTEGRATOR 가 둔 스텁. EVIDENCE 가 구현하면서 교체한다.
import { HttpError } from '../core/http.js';

const notYet = () => { throw new HttpError(501, 'NOT_IMPLEMENTED', 'EVIDENCE 트랙 미구현'); };

export function register(router, _ctx) {
  router.post('/api/evidence', notYet);
  router.post('/api/recheck', notYet);
  router.get('/api/evidence/:id/judgments', notYet);
}

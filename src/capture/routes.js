// CAPTURE 트랙 소유. 계약: docs/CONTRACT.md §5.1
// INTEGRATOR 가 둔 스텁. CAPTURE 가 구현하면서 교체한다.
import { HttpError } from '../core/http.js';

const notYet = () => { throw new HttpError(501, 'NOT_IMPLEMENTED', 'CAPTURE 트랙 미구현'); };

export function register(router, _ctx) {
  router.post('/api/chat', notYet);
  router.get('/api/approaches', notYet);
}

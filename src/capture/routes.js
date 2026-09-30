// CAPTURE 트랙 소유. 계약: docs/CONTRACT.md §5.1
//   POST /api/chat        — 발화 분류 → execution 은 같은 호출 안에서 즉시 저장 (저장/확인 단계 없음)
//   GET  /api/approaches  — 실제 SQLite 를 다시 읽어 같은 접근 분석
import { HttpError, readJson } from '../core/http.js';
import { createExtractor } from './extract.js';
import { handleChat } from './service.js';
import { analyzeApproach, analyzeForAttempt } from './approach.js';
import { normTarget, normMethod, normEnvironment, normCondition } from './dict.js';

export function register(router, ctx) {
  const { db, config } = ctx;
  // ctx.captureExtractor 는 통합 테스트 주입용(선택). 기본은 RSE_LLM 설정.
  const extractor = ctx.captureExtractor ?? createExtractor(config.llmMode);

  router.post('/api/chat', async ({ req }) => {
    const body = await readJson(req);
    if (typeof body.text !== 'string' || !body.text.trim()) {
      throw new HttpError(400, 'BAD_REQUEST', 'text(문자열)가 필요합니다');
    }
    try {
      return await handleChat({ db, extractor }, body.text.trim());
    } catch (e) {
      if (e instanceof HttpError) throw e;
      throw new HttpError(502, 'EXTRACTION_FAILED', `구조화 추출 실패: ${e.message}`);
    }
  });

  router.get('/api/approaches', ({ query }) => {
    if (query.attempt_id != null) {
      const id = Number(query.attempt_id);
      const row = Number.isInteger(id) ? db.prepare('SELECT * FROM research_attempt WHERE id = ?').get(id) : null;
      if (!row) throw new HttpError(404, 'NOT_FOUND', `attempt_id=${query.attempt_id} 없음`);
      return analyzeForAttempt(db, row);
    }
    if (query.target == null && query.method == null && query.environment == null) {
      throw new HttpError(400, 'BAD_REQUEST', 'target·method·environment 또는 attempt_id 가 필요합니다');
    }
    // 입력은 시도와 같은 사전으로 정규화 (이미 norm 이면 그대로 통과)
    return analyzeApproach(db, {
      target: normTarget(query.target),
      method: normMethod(query.method),
      environment: normEnvironment(query.environment),
    }, { condition: normCondition(query.condition) });
  });
}

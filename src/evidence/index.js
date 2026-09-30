// EVIDENCE 공개 모듈 (CONTRACT §5.2, §6). 다른 트랙·scripts 는 이 파일의 export 만 사용한다.
import { createEvidenceService } from './service.js';

export { createEvidenceService, decideFromMessage } from './service.js';
export { extractRelations } from './relations.js';
export { compareBibliography, normalizeTitle } from './compare.js';

/**
 * baseline 일반 근거 사전 조회 (INTEGRATOR scripts/baseline.js 가 호출).
 * samples.json 의 normal / corrupted / unverifiable 만 POST /api/evidence 와 같은 경로로 등록·cache 한다.
 * exclude 의 DOI(철회 논문)와 live_unseeded 는 조회·cache 하지 않는다.
 * @returns {Promise<{registered: {key, evidence_id, status}[], skipped: string[]}>}
 */
export async function prewarmBaselineCache(db, config, { exclude = [], fetch, samplesFile } = {}) {
  const svc = createEvidenceService({ db, config, ...(fetch ? { fetch } : {}) });
  return svc.prewarm({ exclude, ...(samplesFile ? { samplesFile } : {}) });
}

// Crossref 조회. 외부 연구 데이터 소스는 Crossref 하나뿐.
// base URL 은 항상 config.crossrefBaseUrl — 이 파일 밖에는 호스트 문자열을 두지 않는다.

export function normalizeDoi(input) {
  if (typeof input !== 'string') return null;
  // 입력 표기 정리만 한다 (네트워크 조회 아님): 공백, "doi:" / URL 형태 접두사 제거
  const s = input.trim().replace(/^doi:\s*/i, '').replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '');
  return /^10\.\d{4,9}\/\S+$/.test(s) ? s : null;
}

export function workUrl(config, doi) {
  const path = doi.split('/').map(encodeURIComponent).join('/');
  const q = config.crossrefMailto ? `?mailto=${encodeURIComponent(config.crossrefMailto)}` : '';
  return `${config.crossrefBaseUrl}/works/${path}${q}`;
}

/**
 * Crossref works/{doi} 1회 조회. 예외를 던지지 않는다.
 * @returns {{outcome:'found'|'not_found'|'failed', http_status:number|null, raw_json:string|null, error:string|null, fetched_at:string}}
 *   found     : HTTP 200 + 파싱 가능한 work message
 *   not_found : HTTP 404 (Crossref 가 레코드를 확인해 주지 않음 — 부재 증명이 아님)
 *   failed    : timeout / 네트워크 오류 / 그 외 HTTP / 깨진 JSON
 */
export async function fetchWork(config, doi, fetchImpl = globalThis.fetch, nowFn = () => new Date().toISOString()) {
  const headers = { accept: 'application/json' };
  if (config.crossrefMailto) headers['user-agent'] = `ResearchStateEngine/0.1 (mailto:${config.crossrefMailto})`;
  try {
    const res = await fetchImpl(workUrl(config, doi), { headers, signal: AbortSignal.timeout(config.crossrefTimeoutMs) });
    const text = await res.text();
    const fetched_at = nowFn();
    if (res.status === 200) {
      let ok = false;
      try { ok = !!JSON.parse(text)?.message; } catch { ok = false; }
      return ok
        ? { outcome: 'found', http_status: 200, raw_json: text, error: null, fetched_at }
        : { outcome: 'failed', http_status: 200, raw_json: null, error: 'Crossref 응답을 해석하지 못했습니다', fetched_at };
    }
    if (res.status === 404) return { outcome: 'not_found', http_status: 404, raw_json: text, error: null, fetched_at };
    return { outcome: 'failed', http_status: res.status, raw_json: null, error: `HTTP ${res.status}`, fetched_at };
  } catch (e) {
    const timeout = e?.name === 'TimeoutError' || e?.name === 'AbortError';
    return {
      outcome: 'failed', http_status: null, raw_json: null, fetched_at: nowFn(),
      error: timeout ? `timeout (${config.crossrefTimeoutMs}ms)` : `${e?.cause?.code ?? e?.name ?? 'Error'}: ${e?.message ?? e}`,
    };
  }
}

// Crossref message → 비교·저장용 서지
export function metaFromMessage(m) {
  const yearOf = (o) => { const y = o?.['date-parts']?.[0]?.[0]; return Number.isInteger(y) ? y : null; };
  const titles = (Array.isArray(m.title) ? m.title : []).filter((t) => typeof t === 'string' && t.trim());
  const subtitles = (Array.isArray(m.subtitle) ? m.subtitle : []).filter((t) => typeof t === 'string' && t.trim());
  const authors = (Array.isArray(m.author) ? m.author : []).map((a) => a?.family ?? a?.name).filter(Boolean);
  // 발행 연도 후보: issued 우선. online-first 와 print 연도가 다른 논문이 흔하므로 후보 전체와 대조한다.
  const years = [...new Set([yearOf(m.issued), yearOf(m['published-print']), yearOf(m['published-online']), yearOf(m.published)].filter(Number.isInteger))];
  return {
    title: titles[0] ?? null,
    titles: [...titles, ...(titles[0] && subtitles[0] ? [`${titles[0]} ${subtitles[0]}`] : [])],
    authors,
    years,
    year: years[0] ?? null,
  };
}

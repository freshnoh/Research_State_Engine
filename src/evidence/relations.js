// Crossref update relation 해석. deterministic — LLM 판정 없음. CONTRACT §4.
//
// Crossref work 의 두 필드를 구분한다.
//   updated-by : "이 work 를 갱신하는 notice" 목록. 항목 DOI = notice DOI.  → 이 work 의 철회 여부 판정에 쓴다.
//   update-to  : "이 work 가 갱신하는 대상" 목록. 이 work 가 notice 인 쪽. → 이 work 가 철회된 것이 아니다.
// type 이 철회 계열인 updated-by 항목만 철회. correction / expression_of_concern / 기타는 철회가 아니다.

export const RETRACTION_TYPES = new Set(['retraction', 'withdrawal']);

function isoDate(updated) {
  const p = updated?.['date-parts']?.[0];
  if (Array.isArray(p) && Number.isInteger(p[0])) {
    const [y, m = 1, d = 1] = p;
    return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  return typeof updated?.['date-time'] === 'string' ? updated['date-time'].slice(0, 10) : null;
}

function normEntry(e, direction) {
  const type = typeof e?.type === 'string' ? e.type.toLowerCase() : null;
  return {
    type,
    direction,
    source: e?.source ?? null,
    date: isoDate(e?.updated),
    related_doi: e?.DOI ?? null,
    label: e?.label ?? null,
    // 이 work 가 철회되었음을 뜻하는 relation 인가 (방향 + 유형)
    is_retraction_of_this_work: direction === 'updated-by' && RETRACTION_TYPES.has(type),
    raw: e,
  };
}

export const dedupeKey = (r) => `${r.type}|${String(r.related_doi ?? '').toLowerCase()}|${r.date ?? ''}`;

/**
 * @returns {
 *   all: 정규화된 모든 update relation (raw 포함, 중복 원본 그대로),
 *   retraction_raw: 철회로 판정된 원본 relation 배열,
 *   retraction: dedupe 된 철회 relation (사용자 표시 단위) — {key, type, direction, source(병합), date, related_doi, sources[], raw_count},
 *   primary: 화면에 표시할 철회 1건 또는 null,
 *   counts: {all, retraction_raw, retraction_deduped, non_retraction}
 * }
 */
export function extractRelations(message) {
  const list = [];
  for (const e of Array.isArray(message?.['updated-by']) ? message['updated-by'] : []) list.push(normEntry(e, 'updated-by'));
  for (const e of Array.isArray(message?.['update-to']) ? message['update-to'] : []) list.push(normEntry(e, 'update-to'));

  const retractionRaw = list.filter((r) => r.is_retraction_of_this_work);
  const byKey = new Map();
  for (const r of retractionRaw) {
    const k = dedupeKey(r);
    const cur = byKey.get(k);
    if (cur) {
      cur.raw_count += 1;
      if (r.source && !cur.sources.includes(r.source)) cur.sources.push(r.source);
    } else {
      byKey.set(k, {
        key: k, type: r.type, direction: r.direction, date: r.date, related_doi: r.related_doi,
        sources: r.source ? [r.source] : [], raw_count: 1,
      });
    }
  }
  const retraction = [...byKey.values()].map((r) => ({ ...r, sources: [...r.sources].sort(), source: [...r.sources].sort().join(', ') || null }));
  // 여러 notice 가 있으면 가장 최근 것을 표시값으로 (나머지도 retraction 배열·raw 에 보존)
  const primary = [...retraction].sort((a, b) => String(b.date ?? '').localeCompare(String(a.date ?? '')) || a.key.localeCompare(b.key))[0] ?? null;

  return {
    all: list,
    retraction_raw: retractionRaw,
    retraction,
    primary,
    counts: {
      all: list.length,
      retraction_raw: retractionRaw.length,
      retraction_deduped: retraction.length,
      non_retraction: list.length - retractionRaw.length,
    },
  };
}

// 같은 접근 판정 — deterministic, 실제 SQLite 를 매번 다시 읽는다. LLM 관여 없음.
//   approach_key = target_norm | method_norm | environment_norm  (조건·결과·중단 단계는 키 제외)
//   same            : 세 칸 동일
//   exact_repeat    : same + condition_norm 동일(둘 다 값이 있을 때만)
//   adjacent        : 대상·환경만 동일 (방법이 다름, 셋 다 값 있음) — 참고 정보
//   undetermined    : 대상·방법·환경 중 하나 이상 미상 → 같은 접근으로 확정하지 않음
// 하드코딩 금지: 건수·attempt id·중단 단계는 전부 조회 결과에서 만든다.

const FIELDS = ['target', 'method', 'environment'];
const FIELD_LABEL = { target: '대상', method: '방법', environment: '환경' };

export function approachKeyOf(norms) {
  return FIELDS.every((f) => norms[f]) ? FIELDS.map((f) => norms[f]).join('|') : null;
}

const rowNorms = (r) => ({ target: r.target_norm, method: r.method_norm, environment: r.environment_norm });

function mostFrequent(values) {
  const counts = new Map();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best = null;
  for (const [v, n] of counts) if (best == null || n > best[1]) best = [v, n];
  return best?.[0] ?? null;
}

// key = {target, method, environment}(norm, null 가능), condition = norm|null
export function analyzeApproach(db, key, { condition = null, selfId = null } = {}) {
  const missing = FIELDS.filter((f) => !key[f]);
  const out = {
    key: { target: key.target ?? null, method: key.method ?? null, environment: key.environment ?? null },
    match: 'undetermined',
    same_count: 0,
    same_attempt_ids: [],
    common_stop_stage: { norm: null, raw: null, all_same: false },
    exact_repeat_ids: [],
    adjacent_ids: [],
    undetermined_ids: [],
    stop_stages: [],
    text: null,
    exact_repeat_text: null,
    missing_fields: missing,
  };
  if (missing.length) {
    out.text = `${missing.map((f) => FIELD_LABEL[f]).join('·')}가 미상이라 같은 접근으로 확정하지 않았습니다`;
    return out;
  }

  const all = db.prepare('SELECT * FROM research_attempt ORDER BY id').all();
  const same = [];
  for (const r of all) {
    const n = rowNorms(r);
    const known = FIELDS.filter((f) => n[f]);
    if (known.length === 3) {
      if (FIELDS.every((f) => n[f] === key[f])) same.push(r);
      else if (n.target === key.target && n.environment === key.environment) out.adjacent_ids.push(r.id);
    } else if (known.every((f) => n[f] === key[f])) {
      // 미상 칸이 있고 아는 칸은 전부 일치 → 같은 접근으로 확정하지 않는다
      out.undetermined_ids.push(r.id);
    }
  }

  out.match = 'same';
  out.same_count = same.length;
  out.same_attempt_ids = same.map((r) => r.id);
  if (condition) out.exact_repeat_ids = same.filter((r) => r.id !== selfId && r.condition_norm && r.condition_norm === condition).map((r) => r.id);

  // 중단 단계: same 시도들의 stop_stage 를 실제 값으로 집계
  const stages = new Map();
  for (const r of same) {
    if (!r.stop_stage_norm) continue;
    const s = stages.get(r.stop_stage_norm) ?? { norm: r.stop_stage_norm, raws: [], ids: [] };
    s.raws.push(r.stop_stage_raw); s.ids.push(r.id);
    stages.set(r.stop_stage_norm, s);
  }
  out.stop_stages = [...stages.values()].map((s) => ({ norm: s.norm, raw: mostFrequent(s.raws.filter(Boolean)), attempt_ids: s.ids }));
  if (same.length > 0 && stages.size === 1 && out.stop_stages[0].attempt_ids.length === same.length) {
    out.common_stop_stage = { norm: out.stop_stages[0].norm, raw: out.stop_stages[0].raw, all_same: true };
  }

  out.text = buildTriedText(out);
  if (out.exact_repeat_ids.length) out.exact_repeat_text = '조건까지 동일한 시도가 있습니다';
  return out;
}

function buildTriedText(a) {
  const n = a.same_count;
  if (n === 0) return '저장된 같은 접근 시도가 없습니다';
  const c = a.common_stop_stage;
  if (c.all_same) {
    const stage = c.raw ?? c.norm;
    return n === 1
      ? `이 접근은 1번 시도됐고 ${stage} 단계에서 멈췄습니다`
      : `이 접근은 ${n}번 시도됐고 모두 ${stage} 단계에서 멈췄습니다`;
  }
  const parts = a.stop_stages.map((s) => `${s.raw ?? s.norm} ${s.attempt_ids.length}건`);
  const noStage = n - a.stop_stages.reduce((acc, s) => acc + s.attempt_ids.length, 0);
  if (noStage) parts.push(`중단 단계 기록 없음 ${noStage}건`);
  return `이 접근은 ${n}번 시도됐습니다${parts.length ? ` (${parts.join(', ')})` : ''}`;
}

// attempt 행 → 분석 (자기 자신 포함해서 센다)
export function analyzeForAttempt(db, attemptRow) {
  return { ...analyzeApproach(db, rowNorms(attemptRow), { condition: attemptRow.condition_norm, selfId: attemptRow.id }), attempt_id: attemptRow.id };
}

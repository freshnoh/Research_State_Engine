// POST /api/chat 처리: 발화 분류 → (execution) 즉시 저장 / (question) 저장 이력으로 답 + 판단 저장.
// 문구는 전부 저장/조회된 실제 값에서 만든다. 데모용 문자열 하드코딩 없음.
import { nowIso, tx } from '../db/index.js';
import { NO_PATH_MESSAGE } from '../contract/enums.js';
import { attemptView, evidenceView } from '../core/views.js';
import { classifyUtterance } from './classify.js';
import { normTarget, normMethod, normEnvironment, normCondition, normStopStage } from './dict.js';
import { analyzeApproach, analyzeForAttempt } from './approach.js';

// CAPTURE 가 만든 판단의 제안은 이 접두사로 시작한다 → 다시 출처로 쓰지 않는다(인용의 인용 방지)
const DERIVED_PREFIX = '저장된 판단 #';
const OCCURRED_NOW = /오늘|방금|금방/;

export function structure(f) {
  const nz = (v) => (v == null || !String(v).trim() ? null : String(v).trim());
  return {
    target_raw: nz(f.target), target_norm: normTarget(f.target),
    method_raw: nz(f.method), method_norm: normMethod(f.method),
    environment_raw: nz(f.environment), environment_norm: normEnvironment(f.environment),
    condition_raw: nz(f.condition), condition_norm: normCondition(f.condition),
    result: f.result ?? 'unknown',
    stop_stage_raw: nz(f.stop_stage), stop_stage_norm: normStopStage(f.stop_stage),
  };
}

// 저장된 행에서 "자동 기록됨" 한 줄 생성 (미상은 '미상')
export function autoRecordLine(a) {
  return `자동 기록됨 — 대상 ${a.target.norm ?? a.target.raw ?? '미상'} / 방법 ${a.method.raw ?? '미상'}`
    + ` / 환경 ${a.environment.label ?? a.environment.raw ?? '미상'} / 결과 ${a.result_label}`;
}

function insertAttempt(db, rawText, s, extractorName) {
  const now = nowIso();
  const id = tx(db, () => Number(db.prepare(`INSERT INTO research_attempt
    (raw_text, target_raw, target_norm, method_raw, method_norm, environment_raw, environment_norm,
     condition_raw, condition_norm, result, stop_stage_raw, stop_stage_norm, occurred_at, created_at,
     source, is_synthetic, extractor)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'live', 0, ?)`).run(
    rawText, s.target_raw, s.target_norm, s.method_raw, s.method_norm, s.environment_raw, s.environment_norm,
    s.condition_raw, s.condition_norm, s.result, s.stop_stage_raw, s.stop_stage_norm,
    OCCURRED_NOW.test(rawText) ? now : null, now, extractorName).lastInsertRowid));
  return db.prepare('SELECT * FROM research_attempt WHERE id = ?').get(id); // 저장된 실제 행을 다시 읽는다
}

// 질문에 쓸 근거 = 같은 접근 시도를 이미 사용했던 과거 판단에 연결된 근거. 검증(verified)된 것만 items.
function collectEvidence(db, attemptIds) {
  if (!attemptIds.length) return { items: [], excluded: [], rows: [] };
  const ph = attemptIds.map(() => '?').join(',');
  const rows = db.prepare(`SELECT DISTINCT e.* FROM evidence e
    JOIN evidence_judgment_link l ON l.evidence_id = e.id
    JOIN judgment_attempt_link a ON a.judgment_id = l.judgment_id
    WHERE a.attempt_id IN (${ph}) ORDER BY e.id`).all(...attemptIds);
  const views = rows.map(evidenceView);
  return {
    items: views.filter((v) => v.usable_as_verified),
    excluded: views.filter((v) => !v.usable_as_verified).map((v) => ({ id: v.id, reason: v.excluded_reason ?? v.status_label })),
    rows,
  };
}

// 다음 후보: 저장된 시도 + 검증된 근거가 있는 과거 판단의 제안만. 재검토 필요 판단은 쓰지 않는다.
function groundedNext(db, attemptIds) {
  if (!attemptIds.length) return null;
  const ph = attemptIds.map(() => '?').join(',');
  const cands = db.prepare(`SELECT DISTINCT j.* FROM judgment j
    JOIN judgment_attempt_link a ON a.judgment_id = j.id
    WHERE a.attempt_id IN (${ph}) AND j.needs_review = 0 AND j.proposal IS NOT NULL AND j.proposal <> '' AND j.proposal NOT LIKE '${DERIVED_PREFIX}%'
      AND EXISTS (SELECT 1 FROM evidence_judgment_link l JOIN evidence e ON e.id = l.evidence_id
                  WHERE l.judgment_id = j.id AND e.status = 'verified')
    ORDER BY j.id`).all(...attemptIds);
  if (!cands.length) return null;
  const j = cands[0];
  return { text: `${DERIVED_PREFIX}${j.id}의 제안: ${j.proposal}`, grounded: true, judgment_ids: cands.map((c) => c.id) };
}

function evidenceText(ev) {
  if (!ev.items.length && !ev.excluded.length) return '이 접근과 연결된 저장 근거가 없습니다';
  const parts = [`검증된 근거 ${ev.items.length}건`];
  if (ev.excluded.length) parts.push(`제외 ${ev.excluded.length}건(${ev.excluded.map((x) => x.reason).join(', ')})`);
  return parts.join(' · ');
}

function buildAnswer(db, analysis) {
  const ids = analysis.same_attempt_ids;
  const ev = collectEvidence(db, ids);
  const g = groundedNext(db, ids);
  const next = g ? { text: g.text, grounded: true, judgment_ids: g.judgment_ids } : { text: NO_PATH_MESSAGE, grounded: false };
  return {
    answer: {
      tried: {
        text: analysis.text, match: analysis.match, count: analysis.same_count,
        stop_stage: analysis.common_stop_stage.all_same ? (analysis.common_stop_stage.raw ?? analysis.common_stop_stage.norm) : null,
        attempt_ids: ids,
      },
      evidence: { items: ev.items, excluded: ev.excluded, text: evidenceText(ev) },
      next,
    },
    evidenceRows: ev.rows.filter((r) => r.status === 'verified'),
    proposal: g?.text ?? null, // 근거 없는 판단에는 제안을 저장하지 않는다
  };
}

function saveJudgment(db, question, proposal, attemptIds, evidenceRows) {
  return tx(db, () => {
    const now = nowIso();
    const jid = Number(db.prepare(`INSERT INTO judgment
      (question, asked_at, proposal, researcher_action, needs_review, is_synthetic, demo_label, created_at)
      VALUES (?,?,?,NULL,0,0,NULL,?)`).run(question, now, proposal, now).lastInsertRowid);
    for (const id of attemptIds) db.prepare('INSERT INTO judgment_attempt_link (judgment_id, attempt_id) VALUES (?,?)').run(jid, id);
    for (const e of evidenceRows) db.prepare('INSERT INTO evidence_judgment_link (judgment_id, evidence_id, created_at) VALUES (?,?,?)').run(jid, e.id, now);
    return jid;
  });
}

const base = (kind, extracted) => ({
  kind, saved: false, attempt: null, auto_record_line: null, approach: null, answer: null, judgment_id: null,
  extractor: extracted?.extractor ?? null,
  ...(extracted?.fallback ? { extractor_fallback: extracted.fallback } : {}),
});

export async function handleChat({ db, extractor }, text) {
  const cls = classifyUtterance(text);

  if (cls.kind === 'execution') {
    const ex = await extractor(text);
    const row = insertAttempt(db, text, structure(ex.fields), ex.extractor);
    const attempt = attemptView(row);
    return { ...base('execution', ex), saved: true, attempt, auto_record_line: autoRecordLine(attempt), approach: analyzeForAttempt(db, row) };
  }

  if (cls.kind === 'question') {
    const ex = await extractor(text);
    const s = structure(ex.fields);
    const approach = analyzeApproach(db, { target: s.target_norm, method: s.method_norm, environment: s.environment_norm });
    const { answer, evidenceRows, proposal } = buildAnswer(db, approach);
    const judgment_id = saveJudgment(db, text, proposal, approach.same_attempt_ids, evidenceRows);
    return { ...base('question', ex), approach, answer, judgment_id };
  }

  return base(cls.kind, null); // plan / hypothesis / other: 저장 0, 추출기 호출도 없음
}

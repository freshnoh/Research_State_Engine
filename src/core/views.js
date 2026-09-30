// 공용 읽기 뷰 (INTEGRATOR 소유). DB row → CONTRACT 객체. 쓰기는 하지 않는다.
import { parseJson } from '../db/index.js';
import {
  ENVIRONMENT, RESULT, EVIDENCE_STATUS, UNVERIFIABLE_REASON, APPROVAL_STATUS, DEMO_PAST_STATE_LABEL,
} from '../contract/enums.js';

export function attemptView(r) {
  return {
    id: r.id,
    raw_text: r.raw_text,
    target: { raw: r.target_raw, norm: r.target_norm },
    method: { raw: r.method_raw, norm: r.method_norm },
    environment: { raw: r.environment_raw, norm: r.environment_norm, label: ENVIRONMENT[r.environment_norm] ?? null },
    condition: { raw: r.condition_raw, norm: r.condition_norm },
    result: r.result,
    result_label: RESULT[r.result],
    stop_stage: { raw: r.stop_stage_raw, norm: r.stop_stage_norm },
    occurred_at: r.occurred_at,
    created_at: r.created_at,
    source: r.source,
    is_synthetic: !!r.is_synthetic,
    extractor: r.extractor,
    // 대상·방법·환경 중 하나라도 미상이면 같은 접근 판정에 쓰지 않는다
    approach_key: r.target_norm && r.method_norm && r.environment_norm
      ? `${r.target_norm}|${r.method_norm}|${r.environment_norm}` : null,
  };
}

export function evidenceView(r) {
  const latestFailed = r.last_attempt_ok === 0 && !!r.last_success_at;
  return {
    id: r.id,
    input: { doi: r.input_doi, title: r.input_title, authors: parseJson(r.input_authors, []), year: r.input_year },
    crossref: { title: r.cr_title, authors: parseJson(r.cr_authors, []), year: r.cr_year },
    status: r.status,
    status_label: EVIDENCE_STATUS[r.status],
    unverifiable_reason: r.unverifiable_reason,
    unverifiable_reason_label: r.unverifiable_reason ? UNVERIFIABLE_REASON[r.unverifiable_reason] : null,
    mismatch_fields: parseJson(r.mismatch_fields, []),
    retraction: r.retraction_type ? {
      type: r.retraction_type, direction: r.retraction_direction, source: r.retraction_source,
      notice_doi: r.retraction_notice_doi, date: r.retraction_date,
    } : null,
    last_success_at: r.last_success_at,
    last_attempt_at: r.last_attempt_at,
    last_attempt_ok: r.last_attempt_ok == null ? null : !!r.last_attempt_ok,
    last_error: r.last_error,
    // 과거 정상 확인 + 최신 조회 실패 → 상태 유지 + 별도 표시
    latest_check_failed: latestFailed,
    usable_as_verified: r.status === 'verified',
    excluded_reason: r.excluded_reason,
    is_demo_corrupted: !!r.is_demo_corrupted,
    is_demo_past_state: !!r.is_demo_past_state,
    demo_label: r.is_demo_past_state ? DEMO_PAST_STATE_LABEL : (r.is_demo_corrupted ? '시연용으로 일부러 손상시킨 표본' : null),
    previous_status: r.previous_status,
    status_changed_at: r.status_changed_at,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

export function judgmentView(db, r) {
  const evidence = db.prepare(
    `SELECT e.* FROM evidence e JOIN evidence_judgment_link l ON l.evidence_id = e.id WHERE l.judgment_id = ? ORDER BY e.id`,
  ).all(r.id).map(evidenceView);
  const attempt_ids = db.prepare('SELECT attempt_id FROM judgment_attempt_link WHERE judgment_id = ? ORDER BY attempt_id')
    .all(r.id).map((x) => x.attempt_id);
  return {
    id: r.id,
    question: r.question,
    asked_at: r.asked_at,
    proposal: r.proposal,
    researcher_action: r.researcher_action,
    needs_review: !!r.needs_review,
    review_reason: r.review_reason,
    review_flagged_at: r.review_flagged_at,
    is_synthetic: !!r.is_synthetic,
    demo_label: r.demo_label,
    attempt_ids,
    evidence,
    created_at: r.created_at,
  };
}

export function approvalView(r) {
  return {
    id: r.id,
    action_type: r.action_type,
    description: r.description,
    reason: r.reason,
    rule_id: r.rule_id,
    target_path: r.target_path,
    status: r.status,
    status_label: APPROVAL_STATUS[r.status],
    hash_before: r.hash_before,
    hash_before_short: r.hash_before ? r.hash_before.slice(0, 8) : null,
    hash_after: r.hash_after,
    hash_after_short: r.hash_after ? r.hash_after.slice(0, 8) : null,
    error: r.error,
    created_at: r.created_at,
    decided_at: r.decided_at,
  };
}

export function runView(r) {
  return {
    id: r.id, action_type: r.action_type, description: r.description, rule_id: r.rule_id,
    status: r.status, result: parseJson(r.result), created_at: r.created_at, completed_at: r.completed_at,
  };
}

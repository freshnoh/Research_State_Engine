// 승인 필요 여부 deterministic 규칙표 (SPEC §10). LLM 이 판정하지 않는다.
const RULES = {
  literature_search: { requires_approval: false, rule_id: 'R-REV-SEARCH', reason: '문헌 조회·검색은 되돌릴 수 있는 작업' },
  run_analysis: { requires_approval: false, rule_id: 'R-REV-ANALYSIS', reason: '분석 실행은 원본을 바꾸지 않는 작업' },
  copy_create: { requires_approval: false, rule_id: 'R-REV-COPY', reason: '사본 생성은 원본을 바꾸지 않는 작업' },
  copy_modify: { requires_approval: false, rule_id: 'R-REV-COPY', reason: '사본 수정은 원본을 바꾸지 않는 작업' },
  draft_write: { requires_approval: false, rule_id: 'R-REV-DRAFT', reason: '초안 작성은 되돌릴 수 있는 작업' },
  state_save: { requires_approval: false, rule_id: 'R-REV-STATE', reason: '연구 상태 저장은 되돌릴 수 있는 작업' },
  overwrite_original: { requires_approval: true, rule_id: 'R-IRREV-OVERWRITE', reason: '원본 데이터 덮어쓰기는 되돌릴 수 없음' },
  delete_original: { requires_approval: true, rule_id: 'R-IRREV-DELETE', reason: '원본 데이터 삭제는 되돌릴 수 없음' },
  external_submit: { requires_approval: true, rule_id: 'R-IRREV-SUBMIT', reason: '외부 제출·전송은 되돌릴 수 없음' },
  device_command: { requires_approval: true, rule_id: 'R-IRREV-DEVICE', reason: '장비 명령은 되돌릴 수 없음' },
  permanent_delete_record: { requires_approval: true, rule_id: 'R-IRREV-PURGE', reason: '기록의 영구 삭제는 되돌릴 수 없음' },
};

export function classify(actionType) {
  const r = RULES[actionType];
  if (r) return { action_type: actionType, ...r };
  // 애매하면 승인 대기로 보낸다 (SPEC §10)
  return { action_type: actionType ?? null, requires_approval: true, rule_id: 'R-UNKNOWN', reason: '분류되지 않은 작업은 승인 대기' };
}

export const KNOWN_ACTION_TYPES = Object.keys(RULES);

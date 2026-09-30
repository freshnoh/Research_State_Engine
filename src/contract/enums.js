// 공용 enum 과 화면 표시 문구 (docs/CONTRACT.md §3)

export const ENVIRONMENT = {
  in_vitro: '시험관',
  cell: '세포',
  animal: '동물',
  clinical: '임상',
  simulation: '시뮬레이션',
  dataset: '데이터셋',
};

export const RESULT = {
  success: '성공',
  partial: '부분',
  failure: '실패',
  stopped: '중단',
  unknown: '미확인',
};

// 사용자 근거 상태는 정확히 4종
export const EVIDENCE_STATUS = {
  verified: '확인',
  mismatch: '서지 불일치',
  unverifiable: '확인 불가',
  retracted: '철회됨',
};

export const UNVERIFIABLE_REASON = {
  not_found: 'Crossref 레코드 미확인',
  insufficient_fields: '비교 필드 부족',
  lookup_failed: '조회 실패',
};

// 발화 분류 (CAPTURE 판정)
export const UTTERANCE_KIND = {
  execution: '실행 결과',
  plan: '계획',
  question: '질문',
  hypothesis: '가설·구상',
  other: '기타',
};

// 같은 접근 판정 (CAPTURE 판정)
export const APPROACH_MATCH = {
  same: '같은 접근',
  exact_repeat: '완전 반복',
  adjacent: '인접 시도',
  undetermined: '미확정',
};

export const APPROVAL_STATUS = {
  pending: '승인 대기',
  approved: '승인·실행됨',
  rejected: '거절됨',
  failed: '실행 실패',
};

export const DATA_NOTICE =
  '기관 시도 이력과 과거 판단은 시연용 합성 데이터 · 문헌 근거와 철회 정보는 공개 실제 데이터';

export const DEMO_PAST_STATE_LABEL = '철회 이전 시점의 시연용 과거 상태';

export const NO_PATH_MESSAGE =
  '저장된 이력과 검증된 근거만으로는 다음 경로를 제시할 수 없습니다';

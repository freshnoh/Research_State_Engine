# STATUS — INTEGRATOR 단일 작성

> worker 는 이 파일을 수정하지 않는다. 모든 값은 INTEGRATOR 의 실측 기준.

갱신: 2026-09-30 18:40 KST (창1 INTEGRATOR)

| 항목 | 상태 | 근거 / 미검증 |
|---|---|---|
| G1 자동 축적 | NOT_STARTED | seed 상 RSE-01 같은 접근 2건만 존재 (sqlite 실측 2). `/api/chat` = 501 |
| G2 재사용 | NOT_STARTED | — |
| G3 근거 검증 | NOT_STARTED | 표본 5건의 현재 Crossref 응답만 사전 실측 (fixtures/evidence/samples.json) |
| G4 철회와 소급 | NOT_STARTED | 2026-09-30 Crossref 실측: 10.1038/nature04533 `updated-by` 에 type=retraction (publisher, retraction-watch, 2024-06-24). seed 판단·근거 link 1 존재 |
| G5 승인 게이트 | NOT_STARTED | — |
| G6 영속성 | NOT_STARTED | — |
| R1 제출 안전 | NOT_STARTED | public repo 확인(visibility=public). README/PPT/영상 미완 |
| PARALLEL_READY | X (진행 중) | baseline commit/push 전 |

- current main SHA: (baseline commit 전)
- baseline/freeze: 없음
- blocker: 없음
- 위험: LLM API key 환경변수 없음 → CAPTURE 추출기는 로컬 `claude` CLI(2.1.258) 또는 deterministic rules 경로 필요

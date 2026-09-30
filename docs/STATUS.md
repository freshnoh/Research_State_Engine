# STATUS — INTEGRATOR 단일 작성

> worker 는 이 파일을 수정하지 않는다. 모든 값은 INTEGRATOR 의 main 기준 실측.
> 판정: PASS (API/DB + 실제 브라우저 화면 모두 관측) · FAIL (관측했으나 기대와 다름/미구현) · UNPROVEN (API/DB 는 관측됐으나 SPEC 이 요구하는 화면 관측 미완 등)

갱신: 2026-09-30 19:45 KST · main = CAPTURE+EVIDENCE 통합 (통합 commit `181357d`, 이 STATUS commit 은 그 위)

## worker 트랙 통합 (19:31 단회 실측 기준)
| track | worker SHA | 독립 검증 (branch 단독) | main 통합 |
|---|---|---|---|
| CAPTURE | 4209c26 (merge-base d164270, ahead 2 / behind 2) | 정적 4/4 · `npm test` 31/31 · verify-gates G1 15/16 · G2 8/9 (실패 2건 = harness 결함, 아래) | O — merge commit `181357d` |
| EVIDENCE | a70b08b (merge-base ea55992, ahead 3 / behind 0) | 정적 4/4 · `npm test` 42/42 · verify-gates G3 15/15 · G4 15/15 · G6 10/10 (실제 Crossref) · prewarm skip=[nature04533, live_unseeded] | O — merge commit `c5bf7e3` |
| SCREENS | 96cb120 (ahead 2 / behind 0) | 미처리 — 완료 보고 대기 (폴링 안 함) | X |

harness 결함 2건 (INTEGRATOR 수정, 기대값 완화 아님):
1. G1 환경 미상 검사에서 `null ?? 'missing'` 이 정상값 null 을 'missing' 으로 바꿈 → 삼항식으로 수정
2. G2 반-하드코딩 검사가 사전 밖 seed 값(RSE-03 `behavioral_assay`)을 사용 → CONTRACT §7.2 사전 안의 접근(RSE-01 qpcr cell, DB 1건)으로 교체. CONTRACT 에 주의 문구 추가
추가 검사: 가설 발화 증가량 0 (G1 최소 검사 16→17)

## main 검증 (19:44, var/verify 전용 DB, baseline 복제본, 실제 Crossref)
- `npm test`: 59/59 (core 14 · capture 17 · evidence 28), skip 0 · todo 0
- `verify-gates`: 74/74 — G1 17/17 · G2 9/9 · G3 15/15 · G4 15/15 · G5 8/8 · G6 10/10 (모두 API/DB 층)
- `verify-ui`: 미실행 (화면 미통합 — main `public/` 은 placeholder)

## Gate
| Gate | 판정 | 실측 (기대 / 실제) |
|---|---|---|
| G1 자동 축적 | UNPROVEN — 화면 C 새 행 확인만 잔여 | baseline 같은 접근 2/2 · 실행 발화 후 3/3 (attempt +1/+1) · 계획 +0/+0 · 질문 +0/+0 · 가설 +0/+0 · 원문 저장 ✓ · 구조화 RSE-01/western_blot/cell/stopped/reproducibility_validation ✓ (extractor `llm:claude-cli`) · 환경 미상 실행 → 저장 +1, environment_norm NULL, 같은 접근 3 유지, `undetermined` ✓ · auto_record_line ✓ |
| G2 재사용 | UNPROVEN — 화면 A 표시 확인만 잔여 | 같은 접근 3/3 · attempt ids = DB [1,2,8] · common_stop_stage reproducibility_validation, all_same true · 문구 "3번 … 재현성 검증" DB 계산 · 다른 접근(RSE-01 qpcr cell) 1/1 · 판단 저장 + attempt link [1,2,8] |
| G3 근거 검증 | UNPROVEN — 화면 C 상태 표시 확인만 잔여 | 정상 verified/verified · 손상 mismatch/mismatch (mismatch_fields title) · 확인 불가 unverifiable·not_found / 동일 · 현장 DOI(AlphaFold) verified·fresh · 기존 verified + Crossref 도달 불가 → verified 유지, last_attempt_ok 0, latest_check_failed true · 최초 조회 실패 → unverifiable·lookup_failed · raw cache 보존(200, "Deep learning") |
| G4 철회와 소급 | UNPROVEN — 화면 C 확인→철회됨 / 재검토 표시 확인만 잔여 | baseline 근거 verified · 합성 판단 link 1 · 재검토 0 · 철회 논문 cache 0 → [지금 재검사] HTTP 200, lookup `fresh` (log fresh ok 200) · verified→retracted · type retraction / direction updated-by / source publisher, retraction-watch / notice 10.1038/s41586-024-07691-8 / 2024-06-24 · 역조회 judgment 1 needs_review true · review_reason "근거 상태 변경: 확인 → 철회됨" · proposal 불변 |
| G5 승인 게이트 | UNPROVEN — 화면 B 실제 검증 대기 | API/DB 8/8: 승인 전 hash 19b0f12a = 기준, 대기 중 분석 completed + 카드 pending 1, 승인 후 hash 변경 = 파일 실측, 거절 시 불변 |
| G6 영속성 | UNPROVEN — 화면 재확인만 잔여 | 서버 프로세스 종료→재시작(새 프로세스) 후 DB 5/5 유지 (시도 9 · 근거 6 · 연결 1 · 철회 1 · 재검토 1) + API 5/5 동일 |
| R1 제출 안전 | FAIL (미완) | public ✓ · README ✓ (AI 모델 실측 기록) · secret 0 · CLAUDE.md 미추적 · **PPT/PDF 없음 · 데모 영상 없음 · 화면 미통합** |
| PARALLEL_READY | O (25/25) | 18:45 |

## baseline (19:34 재생성, EVIDENCE prewarm 포함)
`var/baseline/rse.baseline.db`: seed + prewarm (normal verified · corrupted mismatch · unverifiable not_found), skip nature04533 · AlphaFold.
restore 후 4/4 — 같은 접근 2/2 · 과거 판단 근거 verified/verified · 재검토 0/0 · 원본 hash 19b0f12a73c59354/19b0f12a73c59354 · 철회 논문 cache 0.
freeze: 없음 (SCREENS 미통합)

## blocker / 위험
- SCREENS 미통합 → G1~G6 화면 관측·G5 전부 대기
- 추출 LLM 은 `claude -p` 계정 기본 모델(실측 claude-sonnet-5). 모델 고정 아님, 호출당 ~4초. 실패 시 rules fallback (응답 표기)
- 시연 당일 Crossref 무응답 시 G4 는 상태 변화 없이 verified 유지(정상 동작) — SPEC 부록 문구 사용
- PPT/PDF·데모 영상 부재 (대표 비가역 잔여)

# STATUS — INTEGRATOR 단일 작성

> worker 는 이 파일을 수정하지 않는다. 모든 값은 INTEGRATOR 의 main 기준 실측.
> 판정: PASS (API/DB + 실제 브라우저 화면 모두 관측) · FAIL · UNPROVEN

갱신: 2026-09-30 20:05 KST · main = 3 트랙 통합 + 통합 수정 (이 STATUS 를 담은 commit)
**기능 동결: 2026-09-30 20:00 KST** — 이후 시연을 깨는 결함·제출물 불일치·보안 문제만 수정

## worker 트랙 통합
| track | worker SHA | branch 단독 독립 검증 | main 통합 |
|---|---|---|---|
| CAPTURE | 4209c26 | 정적 4/4 · `npm test` 31/31 · gates G1 15/16 · G2 8/9 (실패 2 = harness 결함) | O `181357d` |
| EVIDENCE | a70b08b | 정적 4/4 · `npm test` 42/42 · gates G3 15/15 · G4 15/15 · G6 10/10 (실제 Crossref) | O `c5bf7e3` |
| SCREENS | 96cb120 | 정적 4/4 (public/** · test/screens/** · handoff 7파일) · `npm test` 23/23 · 금지 표현 0 · reset 버튼 0 · 외부 URL 0 | O `4768d0d` |

### 통합 시 INTEGRATOR 수정 (시연 결함 · 최소 변경, 해당 worker 소유 파일 포함 — 기록)
1. `src/capture/extract.js` — LLM 이 result 를 `unknown`/enum 밖으로 주면 원문 키워드 규칙(`resultOf`) 사용. 근거: 19:50 main verify-gates 에서 라이브 발화 "…중단했습니다" 가 1회 `unknown` 으로 저장(G1 16/17 FAIL). 직접 CLI 3회는 `stopped` 3/3 → 간헐 변동. 회귀 `test/integration/capture-result.test.js` 4건
2. `src/evidence/service.js` — 조회 전 임시 행의 최초 판정을 "상태 변경"으로 기록하지 않음. 근거: 화면 C 캡처에서 신규 정상 근거가 "확인 불가 → 확인" 으로 표시(실제로 없던 변화). 회귀 `test/integration/evidence-first-lookup.test.js` 2건 (Aβ*56 확인→철회됨 기록은 유지)
3. SCREENS CONTRACT_CHANGE_REQUEST(`input.journal`) 반영 — 과거 상태 행은 Crossref 필드가 비어 있어 저널을 표시할 입력 필드가 필요. `evidence.input_journal` 선택 컬럼(기존 DB 는 ALTER 로 보강) + seed "Nature" + `evidenceView.input.journal`. 프런트 변경 없음
4. harness: verify-ui `send()` 가 응답 완료 전에 다음 발화를 보내던 결함 수정 (이번 세션 발화 목록 +1 · 보내기 버튼 재활성 대기)

## 최종 main 검증 (20:00 전후, baseline 복제본 DB · 실제 Crossref · Windows Chrome 실제 렌더링)
- `npm test`: **74/74** (skip 0 · todo 0)
- `verify-gates` (API/DB): **74/74** — G1 17/17 · G2 9/9 · G3 15/15 · G4 15/15 · G5 8/8 · G6 10/10
- `verify-ui` (브라우저): **29/29** — G1 8/8 · G2 4/4 · G3 2/2 · G4 4/4 · G5 6/6 · G6 3/3 · 공통 2/2 · 페이지 JS 예외 0
- 합계 177/177

## Gate
| Gate | 판정 | 실측 (기대 / 실제) |
|---|---|---|
| G1 자동 축적 | **PASS** | baseline 같은 접근 2/2 → 실행 발화 후 3/3 (+1/+1) · 계획·질문·가설 증가 0/0 · 원문 + 구조화 RSE-01/western_blot/cell/stopped/reproducibility_validation (`llm:claude-cli`) · 환경 미상 → environment NULL·`undetermined` · 화면 A "자동 기록됨 — …" 한 줄 · 화면 C 행 7→8, 새 행 원문·구조화 값 표시 · 계획/질문 후 화면 C 행 불변 |
| G2 재사용 | **PASS** | DB 같은 접근 3/3, ids [1,2,8] · common_stop_stage reproducibility_validation all_same · 화면 A 입력 전 "2번…" / 입력 후 "3번…재현성 검증" · 다른 접근(qPCR) 1 → 하드코딩 아님 · 판단 저장 + attempt link · 다음 후보 = "저장된 이력과 검증된 근거만으로는 다음 경로를 제시할 수 없습니다" |
| G3 근거 검증 | **PASS** | 정상 verified · 손상 mismatch(title) · 확인 불가 unverifiable/not_found · 현장 DOI verified(fresh) · Crossref 도달 불가 시 기존 verified 유지 + latest_check_failed · 최초 조회 실패 unverifiable/lookup_failed · raw cache 보존 · 화면 C 근거 상태 = API 전수 · 화면에 부재·가짜 표현 0 |
| G4 철회와 소급 | **PASS** | baseline 근거 verified · 합성 판단 link 1 · 재검토 0 · 철회 논문 cache 0 → [지금 재검사] fresh HTTP 200 → retraction / updated-by / publisher, retraction-watch / notice 10.1038/s41586-024-07691-8 / 2024-06-24 → verified→retracted · 역조회 판단 #1 needs_review 1 · 화면 C 재검사 전 "확인"·과거 상태 고지 → 후 "철회됨"·"재검토 필요" (판단이 틀렸다는 뜻 아님 문구) |
| G5 승인 게이트 | **PASS** | 화면 B: 대기 카드 승인 전 hash 19b0f12a = 원본 · 작업/이유/영향 대상 표시 · 대기 중 분석 완료(카드 여전히 pending) · 승인 전 원본 불변 · 승인 후 전 19b0f12a / 후 1d733821 나란히 = 파일 실측 · 거절 → rejected + hash 불변 |
| G6 영속성 | **PASS** | 서버 프로세스 종료 → 새 프로세스: DB 5/5 (시도·근거·연결·철회·재검토) + API 5/5 + 화면 시도 행 수·철회됨·재검토 필요 유지 |
| R1 제출 안전 | **FAIL (미완)** | public ✓ · README ✓ · secret 0 · CLAUDE.md 미추적 ✓ · DB/env/log 미추적 ✓ · **PPT/PDF 없음 · 데모 영상 없음** (대표 비가역 잔여) |
| PARALLEL_READY | O (25/25) | 18:45 |

## baseline (20:00 재생성 · 복원)
`var/baseline/rse.baseline.db` = seed + prewarm (normal verified · corrupted mismatch · unverifiable not_found, previous_status 없음), skip nature04533 · AlphaFold.
root `var/rse.db` 복원 후 **4/4** — 같은 접근 2/2 · 과거 판단 근거 verified/verified · 재검토 0/0 · 원본 hash 19b0f12a73c59354/19b0f12a73c59354 · 철회 논문 cache 0.
리허설마다: 서버 정지 → `npm run baseline:restore` → 4/4 확인 후 `npm start`.

## 본선 최종 동결 (2026-09-30 22:10 KST)
- 발견: 21:50 이후 `claude -p` 가 HTTP 403 "organization has disabled Claude subscription access" → 모든 추출이 `rules` fallback (응답 `extractor: rules` 표기). 시연 환경의 실제 추출 경로 = rules
- 발표 말투 표본 (각 표본 baseline 사본 DB·별도 서버 프로세스, 기대값 사전 고정): 1차 8/9 → 실패 1건 "…단계에서 접었어요" result 기대 stopped / 실제 unknown (rules 키워드 누락)
- 수정 1건: `src/capture/extract.js` `resultOf` 에 "접었" 추가 (시연 범위 최소). 회귀 `test/integration/capture-result.test.js` +1
- 재검증: 말투 9/9 (저장 차단 4/4 · 동일 접근 alias 2/2 · 분리 3/3) · `npm test` 75/75 · verify-gates 74/74 · verify-ui 29/29 (rules 경로)
- 신규 발표 흐름 채택: 질문("…WB 해볼 생각인데 전에 해본 적 있어?") → DB 2 유지·화면 "2번" → 실행("…접었어요") → DB 3 → 재질문 "3번" → [지금 재검사] 철회됨·재검토 → 승인 게이트. 실제 발표 서버(4100, 운영 DB)·Chrome 1920×1080 리허설 **3/3** (각 12/12, 회차마다 baseline 4/4 복원)
- 최종 baseline 4/4. 운영 도구 `scripts/rehearse.js` 추가 (제품 코드 아님)

## LLM 주경로 확정 (2026-09-30 23:00 KST)
- 발표 서버(4100, 대표 기동 22:26) 환경: ANTHROPIC_API_KEY 설정됨(존재만 확인), RSE_LLM 미설정 → 기본 `claude-cli`
- 실제 모델: 제품 함수 `runClaudeCli` 를 발표 서버와 같은 환경에서 직접 호출 → `modelUsage` = `claude-sonnet-5-5`, is_error false, 3.96s
- 발견 결함: claude-sonnet-5-5 가 "RSE-01 세포에서…" 를 target "RSE-01 세포" · environment null 로 추출 (LLM 표본 2/6, 실행 표본 4/4 재현) → 같은 접근 미확정, 2→3 실패
- 수정: `src/capture/extract.js` `sanitizeFields` — LLM target 이 원문 규칙 대상 식별자를 포함하면 식별자로, LLM 이 environment 를 비웠을 때만 원문 규칙 환경값 사용 (환각값은 기존대로 null). 회귀 3건 (`test/integration/capture-result.test.js`)
- 재검증 (LLM 경로, 발표 서버 환경): 현실 말투 6/6 (실행 A·WB alias B·계획 C·질문 D·가설 E·하드코딩 반증 H: RSE-77/qpcr/cell 0→1, 질문 "1번…RNA 품질 확인") · 실행 요청 extractor `llm:claude-cli` 전건, unexpected fallback 0 · verify-gates 74/74 · verify-ui 29/29 · 리허설 3/3 (각 13/13, 매 회차 execution extractor = llm:claude-cli)
- rules 경로 회귀 (키 없는 셸): 말투 9/9 · verify-gates 74/74 · 실패 주입(키 제외 격리 프로세스) → `rules` + `extractor_fallback` 표기 1/1
- `npm test` 78/78 · 최종 baseline 4/4 · 발표 서버 같은 환경으로 재기동(4100)
- 검증 도구: `scripts/verify-ui.js`·`scripts/rehearse.js` 에 선택 `RSE_SUPERVISOR` 모드 추가 (서버 기동을 외부 supervisor 에 위임, 환경값 비노출)

## 정리 3종 (20:10)
- 워크트리: 3개(capture/evidence/screens) 모두 main 착지·clean·미push 0·handoff = main 확인 후 제거, `git worktree prune`. 잔여 = main 1개. 검증용 임시 worktree(/tmp/rse-v/*) 3개도 제거
- 브랜치/PR: track/capture·evidence·screens local+origin 삭제 (모두 origin/main 조상 확인). 잔여 = main. PR 0건
- 문서: handoff 3종 = main 과 동일(최신) · CONTRACT 반영(journal·seed 주의) · PARKING 항목 없음 · CLAUDE.md·DB·env·log·var 미추적
- 기록: commit `b863eb2` 의 메시지는 이전 스크립트 문구가 재사용되어 내용(SCREENS 통합 후 수정 4건·기능 동결·STATUS)과 맞지 않는다. history rewrite 금지로 수정하지 않고 여기 기록

## 위험
- 추출 LLM = `claude -p` 계정 기본 모델(실측 claude-sonnet-5), 호출당 ~3~4초. 실패 시 rules fallback(응답 표기)
- 시연 당일 Crossref 무응답 시 G4 는 상태 변화 없이 verified 유지(정상 동작) — SPEC 부록 첫 문장 사용
- PPT/PDF·데모 영상 부재

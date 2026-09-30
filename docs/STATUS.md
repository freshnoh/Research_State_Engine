# Verification Status — 검증 결과

> 모든 값은 main 코드에 대해 실제 서버 프로세스 · 실제 SQLite · 실제 Crossref · 실제 브라우저(Chrome)로 관측한 결과다.
> 판정 기준: API/DB 관측과 화면 관측이 모두 기대값과 일치해야 PASS. 검사 대상 0건은 PASS 로 치지 않는다.

기준일: 2026-09-30 (최종 검증 commit `6a9ac18`)

## 요약

| 검증 | 결과 | 방법 |
|---|---|---|
| 단위·통합 테스트 `npm test` | **78/78** | 네트워크 없이 결정적 (녹화 Crossref 응답·주입 fetch) |
| API/DB 검증 `scripts/verify-gates.js` | **74/74** | 실제 서버 프로세스 + 실제 SQLite + 실제 Crossref, baseline 복제본 DB |
| 브라우저 검증 `scripts/verify-ui.js` | **31/31** | Chrome 1920×1080 실제 렌더링으로 화면 조작, 화면 값 = API 값 대조, 메뉴 순서(1 연구 대화 → 2 연구 상태 → 3 원본 변경 확인)·가로 넘침 검사 포함 (2026-10-01, 화면 문구 정리 후) |
| 발표 흐름 리허설 `scripts/rehearse.js` | **3/3** | 매 회차 baseline 복원(4/4) → 실제 발표 서버 · 1920×1080 · 회차당 13개 확인 |
| 시연 baseline `npm run baseline:check` | **4/4** | 같은 접근 2 · 과거 판단 근거 확인 · 재검토 0 · 원본 hash 기준값 |
| G1~G6 | **PASS** | 아래 표 |

## LLM 추출 경로

- 추출기: 로컬 Claude Code CLI (`claude -p`, `RSE_LLM=claude-cli`). 관측 모델 `modelUsage` = `claude-sonnet-5-5` (Anthropic API 키 인증 환경, 관측값이며 코드에 고정하지 않음)
- 발표 서버에서 실행 발화 저장 시 `extractor = llm:claude-cli`, 정상 경로의 예기치 않은 fallback 0건
- 안전망: CLI 실패 시 규칙 기반 추출(`extractor: rules`)로 전환하고 응답에 `extractor_fallback` 사유 표기. 인증 없는 격리 프로세스에서 실패를 주입해 1/1 확인. 규칙 경로에서도 발화 표본 9/9 · API/DB 74/74
- LLM 은 값 추출만 한다. 실행 흔적 여부·같은 접근·서지 비교·철회 판정·승인 필요 여부는 결정적 규칙이 판정한다

## 발표 말투 검증 (각 표본을 baseline 사본 DB 에서 독립 실행, 기대값 사전 고정)

| 표본 | 기대 | 결과 |
|---|---|---|
| "오늘 RSE-01 세포에서 Western blot 해봤는데 재현성 검증 단계에서 중단했어요." | 저장 +1, RSE-01/western_blot/cell, 같은 접근 2→3 | O |
| "오늘 RSE-01 세포에서 WB 해봤는데 또 재현성 검증 단계에서 접었어요." | 저장 +1, WB → western_blot, 같은 접근 2→3 | O |
| "내일 RSE-01 세포에서 Western blot 해볼 생각이에요" (계획) | 저장 0 | O |
| "RSE-01 세포에서 Western blot 전에 한 적 있나요?" (질문) | 저장 0, DB 기반 "2번" 답 | O |
| "이번에는 잘 될 것 같아요" (가설) | 저장 0 | O |
| "오늘 RSE-77 세포에서 qPCR을 수행했고 RNA 품질 확인 단계에서 중단했습니다." (하드코딩 반증) | RSE-77/qpcr/cell 저장, 새 접근 0→1, 질문 답 "1번…RNA 품질 확인", RSE-01 건수 2 불변 | O |
| 규칙 경로 추가 표본: 동의어(rse01·웨스턴블롯), 다른 대상(RSE-02), 다른 환경(마우스), 환경 미상 | 동의어는 같은 접근, 대상·환경이 다르면 분리, 환경 미상은 null·미확정 | 9/9 |

## Gate

| Gate | 판정 | 실측 (기대 / 실제) |
|---|---|---|
| G1 자동 축적 | **PASS** | baseline 같은 접근 2/2 → 실행 발화 후 3/3 (+1/+1) · 계획·질문·가설 증가 0/0 · 원문 + 구조화 RSE-01/western_blot/cell/stopped/reproducibility_validation · 환경 미상 → environment NULL·`undetermined` · 화면 A "자동 기록됨 — …" 한 줄 · 화면 C 새 행에 원문·구조화 값 표시 · 계획/질문 후 화면 C 행 불변 |
| G2 재사용 | **PASS** | DB 같은 접근 3/3, ids [1,2,8] · common_stop_stage reproducibility_validation all_same · 화면 A 입력 전 "2번…" / 입력 후 "3번…재현성 검증" · 다른 접근은 다른 DB 값 → 하드코딩 아님 · 판단 저장 + 사용 시도 link · 다음 후보 = "저장된 이력과 검증된 근거만으로는 다음 경로를 제시할 수 없습니다" |
| G3 근거 검증 | **PASS** | 정상 verified · 손상 mismatch(title) · 확인 불가 unverifiable/not_found · 현장 입력 DOI verified(fresh) · Crossref 도달 불가 시 기존 verified 유지 + latest_check_failed · 최초 조회 실패 unverifiable/lookup_failed · raw cache 보존 · 화면 C 근거 상태 = API 전수 · 화면에 부재·가짜 단정 표현 0 |
| G4 철회와 소급 | **PASS** | baseline 근거 verified · 합성 과거 판단 link 1 · 재검토 0 · 철회 논문 cache 0 → [지금 재검사] fresh HTTP 200 → retraction / updated-by / publisher, retraction-watch / notice 10.1038/s41586-024-07691-8 / 2024-06-24 → verified→retracted · 역조회 판단 needs_review 1 · 화면 C 재검사 전 "확인"·과거 상태 고지 → 후 "철회됨"·"재검토 필요" (판단이 틀렸다는 뜻 아님 문구) |
| G5 승인 게이트 | **PASS** | 화면 B: 대기 카드 승인 전 hash 19b0f12a = 원본 · 작업/이유/영향 대상 표시 · 대기 중 분석 완료(카드 여전히 대기) · 승인 전 원본 불변 · 승인 후 전 19b0f12a / 후 1d733821 나란히 = 파일 실측 · 거절 → rejected + hash 불변 |
| G6 영속성 | **PASS** | 서버 프로세스 종료 → 새 프로세스: DB 5/5 (시도·근거·연결·철회·재검토) + API 5/5 + 화면 시도 행 수·철회됨·재검토 필요 유지 |

## 검증 중 발견해 고친 결함 (모두 회귀 테스트 추가 후 전체 재검증)

1. **LLM 결과값 간헐 누락** — "…중단했습니다" 가 1회 result `unknown` 으로 저장. LLM 이 결과를 주지 못하면 원문 키워드 규칙으로 결정 (`src/capture/extract.js`)
2. **발표 말투 "접었어요"** — 규칙 경로에서 중단으로 인식하지 못함. 중단 키워드에 추가 (`src/capture/extract.js`)
3. **LLM 추출 경계** — `claude-sonnet-5-5` 가 "RSE-01 세포에서…" 를 대상 "RSE-01 세포"·환경 없음으로 추출해 같은 접근이 미확정됨. 대상에 붙은 환경 표현은 원문 식별자로, LLM 이 비운 환경은 원문 규칙값으로 보정. 원문에 없는 값(환각)은 기존대로 버림 (`src/capture/extract.js`)
4. **가짜 상태 변화 표시** — 새로 등록한 정상 근거가 "확인 불가 → 확인" 으로 표시됨. 조회 전 임시 행의 최초 판정은 상태 변화로 기록하지 않음 (`src/evidence/service.js`)
5. **저널 표시** — 철회 이전 시점 근거는 Crossref 필드가 비어 있어 저널을 보일 수 없었음. 선택 입력 필드 `input_journal` 추가 (seed "Nature")

## 시연 baseline

`var/baseline/rse.baseline.db` = seed + 일반 근거 사전 조회(normal verified · corrupted mismatch · unverifiable not_found). 철회 논문(nature04533)과 현장 입력용 DOI 는 조회·cache 하지 않는다.
복원 후 4/4 — 같은 접근 2/2 · 과거 판단 근거 verified/verified · 재검토 0/0 · 원본 hash 19b0f12a73c59354/19b0f12a73c59354 · 철회 논문 cache 0.
시연 전 절차: 서버 정지 → `npm run baseline:restore` → 4/4 확인 → `npm start`.

## 한계

- 추출 LLM 은 로컬 Claude Code CLI 에 의존한다. 인증 실패 시 규칙 기반으로 동작하며(응답에 표기) 호출당 약 3.5~7초가 걸린다
- 시연 당일 Crossref 가 응답하지 않으면 G4 는 상태 변화 없이 기존 "확인"을 유지한다(정상 동작 — 조회 실패는 부재가 아님)
- 발화 분류와 정규화 사전은 시연 범위의 최소 규칙이다. 다양한 분야의 실제 발화 전반에 대한 정확도는 검증하지 않았다

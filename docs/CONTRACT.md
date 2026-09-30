# CONTRACT — Research State Engine 기술 계약

> 제품 사양은 `docs/SPEC.md`. 이 문서는 그 사양을 구현한 schema · API · 판정 규칙 · fixture 형식을 정리한 기술 계약이다.

## 0. 기술 기준

- 단일 Node.js 애플리케이션 (Node ≥ 22.13, 외부 npm 의존성 0)
  - HTTP: `node:http` / DB: `node:sqlite` (SQLite 단일 파일) / 테스트: `node:test` / 외부 조회: 내장 `fetch`
- 실행: `npm start` · DB 초기화: `npm run db:init` · 시드: `npm run seed` · 테스트: `npm test`
- 테스트 파일 규칙: `test/<영역>/*.test.js`. 테스트는 네트워크 없이도 결정적으로 통과해야 한다
  (Crossref 실제 호출 검증은 `scripts/verify-gates.js` 로 별도 수행하고, 단위 테스트는 녹화 응답/주입 fetch 사용).
- 외부 연구 데이터 소스 = Crossref REST API (`https://api.crossref.org/works/{doi}`) 하나뿐.
- LLM 은 실행 계층: 자연어 → 구조화 후보 추출, 설명 생성, 오케스트레이션만. 최종 판정은 §4 의 deterministic rule.

## 1. 런타임 설정

설정 우선순위: 프로세스 환경변수 > checkout 루트의 `.env.local`(gitignore 대상) > 기본값 (`src/config.js`).

| 키 | 기본값 | 의미 |
|---|---|---|
| `PORT` | 4100 | 서버 포트 (127.0.0.1 바인드) |
| `DATA_DIR` | `var` | 런타임 데이터 루트 (gitignore 대상) |
| `DB_PATH` | `$DATA_DIR/rse.db` | 제품 SQLite 파일 |
| `APPROVAL_DIR` | `$DATA_DIR/approval` | G5 승인 게이트 원본 파일 위치 |
| `CROSSREF_BASE_URL` | `https://api.crossref.org` | Crossref 엔드포인트. 근거 모듈은 반드시 `config.crossrefBaseUrl` 을 쓴다 (통합 검증이 도달 불가 주소로 바꿔 조회 실패 경로를 실제로 검사함). 다른 데이터 소스로 바꾸는 용도 아님 |
| `CROSSREF_MAILTO` | (빈 값) | Crossref polite pool 용 mailto (선택) |
| `CROSSREF_TIMEOUT_MS` | 10000 | Crossref 조회 timeout |
| `RSE_LLM` | `claude-cli` | 추출기 선택: `claude-cli` \| `rules` |

- 여러 인스턴스를 동시에 띄울 때는 `DB_PATH`·`PORT` 를 서로 다르게 둔다. 테스트는 임시 디렉터리의 DB 를 쓴다.
- credential 은 환경변수 또는 gitignore 된 로컬 파일만 쓴다. `.env*`, `*.db`, `var/` 는 저장소에 올리지 않는다.

## 2. SQLite schema (정본: `src/db/schema.sql`)

공통 규칙: `*_raw` = 원문에서 뽑은 그대로, `*_norm` = 정규화 값. **NULL = 미상**(추측 금지). 시각은 ISO-8601 문자열.

| 테이블 | 의미 | 쓰는 곳 |
|---|---|---|
| `research_attempt` | ① 연구 시도 (원문 + 대상/방법/환경/조건/결과/중단 단계, raw·norm 쌍) | `src/capture` (대화), seed |
| `evidence` | ② 근거 (입력 서지 / Crossref 서지 / 4상태 / 확인불가 사유 / 철회 relation 유형·방향·출처 / 마지막 정상확인·최신시도 구분) | `src/evidence`, seed |
| `judgment` | ③ 판단 (질문 / 시각 / 제안 / 이후 행동 / 재검토 필요) | 생성: `src/capture` (질문), seed. `needs_review`·`review_*` 갱신: `src/evidence` 만 |
| `judgment_attempt_link` | 판단이 사용한 시도 | `src/capture` |
| `evidence_judgment_link` | ④ 판단이 사용한 근거 (evidence_id 인덱스로 역조회) | 판단 생성 시 (`src/capture`, seed) |
| `approval_action` | ⑤ 승인 대기 작업 (hash_before/after, 상태) | `src/approval` |
| `action_run` | 승인 불필요 작업 실행 기록 (G5 독립 분석) | `src/approval` |
| `crossref_cache` | ⑥ Crossref raw 응답 cache (doi 소문자 키, http_status, fetched_at) | `src/evidence` |
| `crossref_lookup_log` | 조회 로그 (`cache_hit` / `fresh`, ok, http_status, error) | `src/evidence` |

- 삭제 금지: evidence 는 확인 불가·서지 불일치여도 행을 지우지 않는다. 판단 근거 집합에서만 제외하고 `excluded_reason` 한 줄.
- 과거 정상 확인(`last_success_at`)이 있는 evidence 의 최신 조회 실패는 `status` 를 바꾸지 않고
  `last_attempt_at`, `last_attempt_ok=0`, `last_error` 만 갱신한다.
- 상태 변화 시 `previous_status`, `status_changed_at` 기록 (조회 전 임시 행의 최초 판정은 상태 변화가 아님).

## 3. 공용 객체 / enum (정본: `src/contract/enums.js`, `src/core/views.js`)

enum 코드 (DB·API 는 코드, 화면은 라벨):

- environment: `in_vitro` 시험관 · `cell` 세포 · `animal` 동물 · `clinical` 임상 · `simulation` 시뮬레이션 · `dataset` 데이터셋
- result: `success` 성공 · `partial` 부분 · `failure` 실패 · `stopped` 중단 · `unknown` 미확인
- evidence status (정확히 4종): `verified` 확인 · `mismatch` 서지 불일치 · `unverifiable` 확인 불가 · `retracted` 철회됨
- unverifiable_reason: `not_found` 레코드 미확인 · `insufficient_fields` 비교 필드 부족 · `lookup_failed` 조회 실패
- utterance kind: `execution` · `plan` · `question` · `hypothesis` · `other`
- approach match: `same` 같은 접근 · `exact_repeat` 완전 반복 · `adjacent` 인접 시도 · `undetermined` 미확정
- approval status: `pending` · `approved` · `rejected` · `failed`

### 3.1 Attempt (API 객체, `attemptView`)
```json
{ "id": 8, "raw_text": "…원문…",
  "target": {"raw": "RSE-01", "norm": "RSE-01"},
  "method": {"raw": "Western blot", "norm": "western_blot"},
  "environment": {"raw": "세포 모델", "norm": "cell", "label": "세포"},
  "condition": {"raw": null, "norm": null},
  "result": "stopped", "result_label": "중단",
  "stop_stage": {"raw": "재현성 검증", "norm": "reproducibility_validation"},
  "occurred_at": "…", "created_at": "…", "source": "live", "is_synthetic": false,
  "extractor": "llm:claude-cli", "approach_key": "RSE-01|western_blot|cell" }
```
`approach_key` 는 대상·방법·환경 norm 이 모두 있을 때만 값, 하나라도 미상이면 `null`.

### 3.2 Evidence (`evidenceView`)
```json
{ "id": 1,
  "input": {"doi": "10.1038/nature04533", "title": "…", "authors": ["Lesné"], "year": 2006, "journal": "Nature"},
  "crossref": {"title": null, "authors": [], "year": null},
  "status": "verified", "status_label": "확인",
  "unverifiable_reason": null, "unverifiable_reason_label": null, "mismatch_fields": [],
  "retraction": null,
  "last_success_at": "…", "last_attempt_at": "…", "last_attempt_ok": true, "last_error": null,
  "latest_check_failed": false, "usable_as_verified": true, "excluded_reason": null,
  "is_demo_corrupted": false, "is_demo_past_state": true, "demo_label": "철회 이전 시점의 시연용 과거 상태",
  "previous_status": null, "status_changed_at": null, "created_at": "…", "updated_at": "…" }
```
`retraction` 이 있으면 `{type, direction, source, notice_doi, date}`.
`latest_check_failed=true` 이면 화면은 상태 옆에 "최신 확인 실패 · 마지막 확인 YYYY-MM-DD HH:MM".

### 3.3 Judgment (`judgmentView`)
```json
{ "id": 1, "question": "…", "asked_at": "…", "proposal": "…", "researcher_action": "…",
  "needs_review": false, "review_reason": null, "review_flagged_at": null,
  "is_synthetic": true, "demo_label": "철회 이전 시점의 시연용 과거 상태",
  "attempt_ids": [], "evidence": [ /* Evidence */ ], "created_at": "…" }
```
`needs_review=true` 는 "재검토 필요" 표시일 뿐, 판단이 틀렸다는 자동 판정이 아니다.

### 3.4 Approval / Run (`approvalView`, `runView`)
```json
{ "id": 1, "action_type": "overwrite_original", "description": "…", "reason": "…", "rule_id": "R-IRREV-OVERWRITE",
  "target_path": "…/original_measurements.csv", "status": "pending", "status_label": "승인 대기",
  "hash_before": "<sha256>", "hash_before_short": "1a2b3c4d", "hash_after": null, "hash_after_short": null,
  "error": null, "created_at": "…", "decided_at": null }
{ "id": 1, "action_type": "run_analysis", "description": "…", "rule_id": "R-REV-ANALYSIS",
  "status": "completed", "result": { … }, "created_at": "…", "completed_at": "…" }
```

### 3.5 오류 / 미확정 표현
- HTTP 오류: `{"error": {"code": "<UPPER_SNAKE>", "message": "…"}}` + 4xx/5xx.
- 미상 값: JSON `null`, 화면 "미상". 추측값으로 채우지 않는다.
- 확인 불가를 "논문 없음 / 가짜 논문 / 존재하지 않음" 으로 표시하지 않는다. 표준 문구:
  "DOI 등록을 확인하지 못했습니다. 제목·저자 기준으로 추가 확인이 필요합니다."

## 4. deterministic 정책 경계 (LLM 최종 판정 금지)

| 판정 | 모듈 | 규칙 |
|---|---|---|
| 실행 흔적 여부 (저장 자격) | `src/capture/classify.js` | 과거형 실행/결과 흔적이 있을 때만 `execution`. 계획("~하려 합니다"), 질문("~해도 될까요?"), 가설은 저장 0. 불명확하면 저장하지 않음 |
| 같은 접근 | `src/capture/approach.js` | 키 = target_norm + method_norm + environment_norm. 조건은 변주, 결과는 키 제외. 하나라도 미상 → `undetermined` |
| 추출값 검증 | `src/capture/extract.js` | LLM 값은 원문에 글자 그대로 있을 때만 사용(환각은 null). 대상에 붙은 환경 표현·LLM 이 비운 환경은 원문 규칙으로 보정. LLM 이 결과를 못 주면 원문 키워드로 결정 |
| 서지 비교 | `src/evidence/compare.js` | 표기·대소문자·공백·구두점·`RETRACTED ARTICLE:` 류 접두 정규화 후 비교. 형식 차이는 불일치 아님 |
| 철회 판정 | `src/evidence/relations.js` | Crossref `updated-by`(이 work 를 갱신하는 notice) 중 `type` 이 retraction 계열인 항목만 철회. 유형·방향·출처 저장. expression_of_concern·correction 은 철회 아님. 철회 > 서지 불일치 (철회가 가려지지 않음) |
| 조회 실패 덮어쓰기 | `src/evidence/service.js` | 과거 정상 확인이 있으면 status 유지 + 실패 기록. 과거·cache 모두 없고 최초 조회 실패일 때만 `unverifiable/lookup_failed` |
| 승인 필요 여부 | `src/approval/policy.js` | §5.3 규칙표. 모르는 유형은 승인 대기 |

LLM 이 추출한 값은 작은 별칭 사전(§7.2, `src/capture/dict.js`)으로 정규화된다. 사전에 없는 값은 raw 를 저장하고, norm 은 원문 표기 통일값 또는 NULL.

## 5. API 계약 (화면 A/B/C 가 호출)

### 5.0 공용 읽기 (`src/core/routes.js`)
- `GET /api/health` → `{ok, schema_version, db_path, port, counts:{…}, data_notice}`
- `GET /api/attempts` → `{attempts: Attempt[]}` (id 내림차순)
- `GET /api/evidence` → `{evidence: Evidence[]}`
- `GET /api/judgments` → `{judgments: Judgment[]}`
- `GET /api/approvals` → `{approvals: Approval[]}`
- `GET /api/runs` → `{runs: Run[]}`

### 5.1 연구 대화 (`src/capture/routes.js`)
`POST /api/chat` body `{"text": "…"}` → 200
```json
{ "kind": "execution|plan|question|hypothesis|other",
  "saved": true,
  "attempt": { /* Attempt, saved=true 일 때 */ },
  "auto_record_line": "자동 기록됨 — 대상 RSE-01 / 방법 Western blot / 환경 세포 / 결과 중단",
  "approach": { /* ApproachAnalysis */ },
  "answer": {
    "tried":    {"text": "이 접근은 3번 시도됐고 모두 재현성 검증 단계에서 멈췄습니다", "match": "same", "count": 3, "stop_stage": "재현성 검증", "attempt_ids": [1,2,8]},
    "evidence": {"items": [ /* Evidence */ ], "excluded": [{"id": 3, "reason": "서지 불일치"}], "text": "…"},
    "next":     {"text": "저장된 이력과 검증된 근거만으로는 다음 경로를 제시할 수 없습니다", "grounded": false}
  },
  "judgment_id": 2,
  "extractor": "llm:claude-cli|rules",
  "extractor_fallback": "(claude-cli 실패로 rules 를 썼을 때만) 사유" }
```
- 저장 폼/확인 버튼 없음: `execution` 이면 이 호출 안에서 즉시 저장.
- `plan`/`question`/`hypothesis`/`other` 이면 `saved=false`, `attempt=null`, research_attempt 증가 0.
- `question` 이면 `answer` 를 DB 실제값으로 생성하고 판단(judgment)으로 저장 + 사용 시도/근거 link.
  `answer.next` 는 저장된 시도와 `verified` 근거만 근거로 쓴다. 부족하면 `NO_PATH_MESSAGE`.
- 문구는 DB 조회 결과로 생성 (하드코딩 금지).

`GET /api/approaches?target=RSE-01&method=western_blot&environment=cell` (또는 `?attempt_id=8`) → ApproachAnalysis
```json
{ "key": {"target": "RSE-01", "method": "western_blot", "environment": "cell"},
  "match": "same|undetermined", "same_count": 3, "same_attempt_ids": [1,2,8],
  "common_stop_stage": {"norm": "reproducibility_validation", "raw": "재현성 검증", "all_same": true},
  "exact_repeat_ids": [], "adjacent_ids": [3], "undetermined_ids": [6],
  "text": "이 접근은 3번 시도됐고 모두 재현성 검증 단계에서 멈췄습니다" }
```

### 5.2 근거 (`src/evidence/routes.js`)
- `POST /api/evidence` body `{"doi", "title"?, "authors"?, "year"?, "is_demo_corrupted"?}` → 200
  `{evidence: Evidence, lookup: {mode: "cache_hit|fresh", ok, http_status, fetched_at, error}}`
  - 조회 결과를 cache 하고, 표시할 때 조회 시각을 함께 준다.
- `POST /api/recheck` body `{"evidence_ids"?: number[]}` (생략 = 저장된 근거 전부) → 200
  ```json
  { "rechecked_at": "…", "checked": 4,
    "results": [{"evidence_id": 1, "before": "verified", "after": "retracted",
                 "lookup": {"mode": "fresh", "ok": true, "http_status": 200, "error": null},
                 "flagged_judgment_ids": [1]}],
    "flagged_judgment_ids": [1] }
  ```
  - [지금 재검사] = cache 우회 fresh 조회 (`crossref_lookup_log.mode='fresh'` 로 증명).
  - 새로 `retracted` 가 되면 `evidence_judgment_link` 역조회 → 연결 judgment `needs_review=1`,
    `review_reason='근거 상태 변경: 확인 → 철회됨'`, `review_flagged_at`.
  - 조회 실패 시 §4 조회 실패 규칙.
- `GET /api/evidence/:id/judgments` → `{evidence_id, judgments: Judgment[]}` (역조회)

`src/evidence/index.js` export (baseline 스크립트가 호출):
- `async prewarmBaselineCache(db, config, {exclude: string[]})` →
  `fixtures/evidence/samples.json` 의 `normal`, `corrupted`, `unverifiable` 표본을 **일반 조회 경로(POST /api/evidence 와 동일 로직)** 로
  evidence 행 + crossref_cache 에 등록하고 `{registered: [{key, evidence_id, status}], skipped: [doi]}` 반환.
  `exclude` 의 DOI(철회 논문 `10.1038/nature04533`)와 `live_unseeded` 는 절대 조회·cache 하지 않는다.

### 5.3 승인 게이트 (`src/approval/**`)
규칙표 (`src/approval/policy.js`):

| action_type | 승인 | rule_id |
|---|---|---|
| `literature_search`, `run_analysis`, `copy_create`, `copy_modify`, `draft_write`, `state_save` | 불필요 | `R-REV-*` |
| `overwrite_original`, `delete_original` | 필요 | `R-IRREV-OVERWRITE`, `R-IRREV-DELETE` |
| `external_submit`, `device_command`, `permanent_delete_record` | 필요 | `R-IRREV-SUBMIT`, `R-IRREV-DEVICE`, `R-IRREV-PURGE` |
| 그 외 / 모름 | 필요 | `R-UNKNOWN` |

프로토타입 실행기: `overwrite_original`(G5 원본 파일), `run_analysis`(원본을 읽기만 하는 요약 통계). 그 외 유형은 분류만.

- `GET  /api/actions/classify?action_type=…` → `{action_type, requires_approval, rule_id, reason}`
- `GET  /api/approval/target` → `{path, exists, hash, hash_short}` (원본 파일 현재 hash)
- `POST /api/actions` body `{"action_type": "overwrite_original"}` → 202 `{requires_approval: true, approval: Approval}` (실행 없음, hash_before 기록)
- `POST /api/actions` body `{"action_type": "run_analysis"}` → 200 `{requires_approval: false, run: Run}` (대기 카드와 무관하게 즉시 완료)
- `POST /api/approvals/:id/approve` → 200 `{approval}` : 현재 hash == hash_before 확인 후 덮어쓰기, hash_after 기록
- `POST /api/approvals/:id/reject` → 200 `{approval}` : 원본 불변

## 6. fixture / seed 형식

### 6.1 seed (`fixtures/seed/seed.json`)
`attempts[]`(research_attempt 컬럼 + `key`), `evidence[]`(evidence 컬럼 + `key`), `judgments[]`(+ `evidence_keys`, `attempt_keys`).
`src/core/seed.js#loadSeed(db)` 는 빈 DB 에만 적재한다.
- 데모1: RSE-01 / western_blot / cell 같은 접근 2건 (조건 상이, 둘 다 `reproducibility_validation` 에서 `stopped`) + 인접·미확정·기타 합성 이력 5건 (총 7)
- 데모2: Aβ*56 evidence (`10.1038/nature04533`, status=verified, 2022-03-15, `is_demo_past_state=1`, Crossref 필드 NULL)
  + 합성 과거 judgment "Aβ*56 관련 경로를 후속 검증 후보로 유지" (2022-03-15) + evidence_judgment_link 1
- 철회 논문의 현재 Crossref 응답은 seed/baseline cache 에 넣지 않는다.
- 데모1 과 데모2 사이에 어떤 link 도 만들지 않는다.

### 6.2 데모 정규화 사전 (`src/capture/dict.js` 최소 매핑)
| 필드 | raw 예 | norm |
|---|---|---|
| target | RSE-01, rse-01, RSE01 | `RSE-01` |
| method | Western blot, 웨스턴 블롯, WB | `western_blot` |
| method | qPCR, 정량 PCR | `qpcr` |
| method | ELISA | `elisa` |
| environment | 세포, 세포 모델, cell | `cell` |
| environment | 시험관, in vitro | `in_vitro` |
| environment | 동물, 마우스, 쥐 | `animal` |
| stop_stage | 재현성 검증, 재현성 확인 | `reproducibility_validation` |
| stop_stage | 행동검증 | `behavioral_validation` |

주의: seed 의 `RSE-03` 시도 method_norm `behavioral_assay` 는 위 사전 밖 값이다 ("행동검증" 을 method 로 받으면 표기 통일값 `행동검증` 으로 저장).
따라서 RSE-03 은 라이브 발화와 같은 접근으로 묶이지 않는다. 시연·검증은 사전에 있는 접근(RSE-01 western_blot/qpcr)만 쓴다.

라이브 발화 기대값: "오늘 후보 단백질 RSE-01을 세포 모델에서 Western blot으로 측정했고, 재현성 검증 단계에서 중단했습니다."
→ target `RSE-01`, method `western_blot`, environment `cell`, result `stopped`, stop_stage `reproducibility_validation`, condition NULL.

### 6.3 G3 표본 (`fixtures/evidence/samples.json`)
normal / corrupted(시연용 손상) / unverifiable(404, 형식 정상) / retracted(Aβ*56) / live_unseeded(발표 현장 입력용).
기대 상태는 2026-09-30 실제 Crossref 응답으로 사전 확인. 판정은 항상 현재 응답으로 한다.

### 6.4 G5 원본 (`fixtures/approval/original_measurements.csv`)
baseline 복원 시 `$APPROVAL_DIR/original_measurements.csv` 로 복사. 기준 hash 는 이 fixture 의 sha256.

### 6.5 시연 baseline (`scripts/baseline.js`) — 제품 UI 가 아닌 시연 준비 절차
- `npm run baseline:create` → `$DATA_DIR/baseline/rse.baseline.db` (seed + 근거 사전 조회, 철회 논문 cache 없음)
- `npm run baseline:restore` → 서버가 PORT 에서 실행 중이면 거부. DB_PATH·원본 파일 복원 후 4값 검사
- `npm run baseline:check` → 같은 접근=2 / 과거 판단 근거=verified / 재검토 표시=0 / 원본 hash=fixture hash (+ 철회 논문 cache 0)
  4/4 가 아니면 시연 시작 금지 (exit 1)

## 7. 화면 계약 (`public/`)
- 화면 A 연구 대화: `POST /api/chat` → 세 덩어리(이미 해본 것 / 근거 상태 / 다음 후보) + 저장 시 "자동 기록됨 — …" 한 줄. 저장 폼/확인 버튼 없음.
- 사용자 메뉴 표시 순서: 1 연구 대화(화면 A, `nav-a`) → 2 연구 상태(화면 C, `nav-c`) → 3 원본 변경 확인(화면 B, `nav-b`). 내부 식별자 A/B/C 는 그대로다.
- 화면 B 원본 변경 확인(승인 대기): `GET /api/approvals`, `GET /api/approval/target`, `POST /api/actions`, approve/reject, `GET /api/runs`.
  카드 = 작업 / 승인 필요 이유 / 영향 대상 / hash 앞 8자리. 승인 전·후 hash 나란히.
- 화면 C 연구 상태: `GET /api/attempts`(원문+구조화), `GET /api/judgments`, `GET /api/evidence`, 상단 [지금 재검사] = `POST /api/recheck`.
  재검토 필요 판단·영향 근거에 눈에 띄는 표시(색 + 텍스트).
- 모든 화면에 `DATA_NOTICE` 표시. 데모 과거 상태에는 `demo_label` 표시. 제품 reset 버튼 없음.

### 7.1 검증용 `data-testid` (`scripts/verify-ui.js` 가 실제 브라우저로 사용자 흐름을 검증할 때 사용)
단일 페이지 `public/index.html`. 화면 전환은 `nav-a` / `nav-b` / `nav-c`.

| 화면 | testid | 요소 / 속성 |
|---|---|---|
| 공통 | `data-notice` | 합성/실제 데이터 고지 문구 |
| A | `chat-input`, `chat-send` | 입력창, 보내기 버튼 (Enter 도 가능하되 버튼 필수) |
| A | `auto-record-line` | 가장 최근 "자동 기록됨 — …" 한 줄 |
| A | `answer-tried`, `answer-evidence`, `answer-next` | 가장 최근 답의 세 덩어리 |
| B | `request-overwrite` | "원본 측정값 파일 바꾸기" 버튼 — 변경 요청만 만든다 (`POST /api/actions {action_type:'overwrite_original'}`) |
| B | `run-analysis` | "원본을 바꾸지 않는 분석 실행" 버튼 (`POST /api/actions {action_type:'run_analysis'}`) |
| B | `approval-card` | 카드. 속성 `data-approval-id`, `data-status` |
| B | `approval-hash-before`, `approval-hash-after` | 카드 안 hash 앞 8자리 (승인 전/후 나란히) |
| B | `approve-btn`, `reject-btn` | 카드 안 버튼 |
| B | `run-result` | 분석 결과 행. 속성 `data-run-id` |
| C | `recheck-btn` | 상단 [지금 재검사] |
| C | `attempt-row` | 시도 행. 속성 `data-attempt-id`. 안에 `attempt-raw`(원문) |
| C | `evidence-row` | 근거 행. 속성 `data-evidence-id`, `data-status`(enum 코드) |
| C | `judgment-row` | 판단 행. 속성 `data-judgment-id`, `data-needs-review`("1"/"0") |

화면은 API 응답이 바뀐 뒤 새로고침 없이 갱신된다 (버튼 처리 후 재조회).

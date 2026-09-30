# handoff — EVIDENCE (창3)

> EVIDENCE 소유. 형식: docs/CONTRACT.md §10. 측정 시각 2026-09-30 (KST 19:00대). 최종 G3/G4 판정은 INTEGRATOR 가 main 통합 후 한다.

- 트랙: EVIDENCE
- branch: `track/evidence`
- base main SHA: 착수 `d164270` (ff) → 작업 중 `ea55992` merge (merge commit `6da6fe5`)
- 기능 commit: `822edb2` (evidence: G3 근거 4상태 + G4 철회 재검사·역조회)
- 최신 commit: 이 handoff 를 담은 commit (`git log -1 origin/track/evidence` 로 확인. handoff 가 가리키는 기능 commit = `822edb2`)
- push 여부: O (`origin/track/evidence`)

## 검증: 통과 N / 전체 M

| 검증 | 통과/전체 | 네트워크 |
|---|---|---|
| 단위 `test/evidence/evidence.test.js` | 28 / 28 | 비의존 (녹화 응답 + 주입 fetch + 로컬 mock Crossref HTTP) |
| 전체 `npm test` (origin/main ea55992 merge 후) | 42 / 42 | 비의존 |
| live `test/evidence/live-crossref.js` (자기 서버 4102 + 자기 DB_PATH, 실제 Crossref) | 24 / 24 | 실제 |
| INTEGRATOR harness `scripts/verify-gates.js` (VERIFY_PORT=4102, 자기 worktree var/verify, 실제 Crossref) | G3 15/15 · G4 15/15 · G6 10/10 (G1 2/16 · G2 0/9 는 CAPTURE 미통합 브랜치라 FAIL — EVIDENCE 무관) | 실제 |
| `baseline:create` → `baseline:restore` (자기 DATA_DIR) | 4/4 + 철회 논문 cache 0 | 실제 |
| 도달 불가 base URL 서버 실행 (`CROSSREF_BASE_URL=http://127.0.0.1:9`) | A·B 2 / 2 | 로컬 |

- G3 후보: **PASS** (worker branch 기준. main 통합 후 재판정 필요)
- G4 후보: **PASS** (live 현재 Crossref 로 retraction relation 실제 검출. main 통합 후 재판정 필요)

## nature04533 현재 실제 관측 (2026-09-30 live, [지금 재검사] fresh 조회, HTTP 200)

- 사용자 최종 상태: `retracted` (철회됨)
- relation type: `retraction`
- direction: `updated-by` (이 work 를 갱신하는 notice)
- source: `publisher, retraction-watch` (두 원본 병합)
- date: `2024-06-24`
- notice/related DOI: `10.1038/s41586-024-07691-8`
- 중복 원본 수: retraction relation 원본 2 (retraction-watch 1 + publisher 1). update relation 전체 4
  (그 외: expression_of_concern 2022-07-14 retraction-watch — `updated-by` 1 + `update-to` 1, 철회 아님)
- dedupe 결과: 사용자 표시 1건 (dedupe key `retraction|10.1038/s41586-024-07691-8|2024-06-24`, raw_count 2)
- before 상태: `verified` (seed 합성 기준선, last_success_at 2022-03-15, cache 없음)
- after 상태: `retracted` (previous_status=verified, status_changed_at 기록)
- flagged judgment ids: `[1]` — needs_review 0→1, review_reason `근거 상태 변경: 확인 → 철회됨`, review_flagged_at 기록, proposal 불변
- 역조회: `GET /api/evidence/1/judgments` → judgment 1, needs_review=true
- 재기동 후 유지: judgment 1 needs_review=true, 근거 retracted (서버 재시작 후 API 실측)

## 실패경로 / 상태 규칙

- timeout 기존 상태: 기존 `verified` 유지. `last_attempt_ok=0`, `last_error`, `last_attempt_at` 갱신, `last_success_at` 유지, `latest_check_failed=true`
  - 실서버 실측 (base URL `http://127.0.0.1:9`): 정상 표본 recheck → before/after `verified/verified`, error `TypeError: fetch failed`
  - 단위: 주입 TimeoutError, 기존 verified + 404 도 verified 유지 (cache 200 응답도 덮어쓰지 않음)
- 최초 lookup failure: 실서버 실측 신규 DOI `10.5555/rse.never.cached.2026` → `unverifiable / lookup_failed`, cache 기록 0
- correction: 철회 아님 (단위, 녹화 응답에 correction 주입)
- expression_of_concern: 철회 아님 (live 관측 EoC 2건 + 단위: 철회 이전 시점 응답 → verified 유지, needs_review 0)
- direction: 철회 notice `10.1038/s41586-024-07691-8` 자체(update-to=retraction 2건) → `verified`, 철회 아님 (녹화 실제 응답)
- duplicate relation: 원본 2 → 표시 1 (live + 단위)
- recheck cache bypass: 이미 cache 된 응답이 있어도 recheck 는 네트워크 재조회 (단위: mock 호출 수 증가, lookup_log `fresh,cache_hit,fresh`; live: lookup_log fresh +1)
- 철회 > 서지 불일치: 제목을 틀리게 준 nature04533 → `retracted`, `mismatch_fields=["title"]` 보존
- DOI 하드코딩 없음: 같은 DOI 에 retraction relation 제거 응답 → `verified`. `src/evidence/**` 에 `nature04533`·`api.crossref.org` 문자열 0
- 금지 표현: `src/evidence/**` 및 API 응답에 "논문 없음/가짜 논문/존재하지 않음" 0

## prewarm cache 결과

- `prewarmBaselineCache(db, config, {exclude})` (CONTRACT §5.2 signature 그대로, 선택 인자 `fetch`/`samplesFile` 는 테스트 주입용)
- live baseline:create: normal=`verified`, corrupted=`mismatch`, unverifiable=`unverifiable/not_found`
- skipped: `10.1038/nature04533`, `10.1038/s41586-021-03819-2`(live_unseeded) — 조회 0, cache 0 (exclude 가 비어도 이 두 표본은 조회하지 않음)
- 사전 조회 중 lookup 실패가 있으면 오류를 던진다 (실패 상태를 baseline 에 굳히지 않음)

## fresh/cache 검증

- `POST /api/evidence` 응답 `lookup = {mode, cache_hit, fresh, outcome, ok, http_status, fetched_at, error}` (CONTRACT 필드 + 구분 필드 추가)
- live: prewarm 된 normal 재조회 → `cache_hit`, live_unseeded → `fresh` HTTP 200, DOI 만 입력 → `record_confirmed_only=true`, 서지 일치 주장 없음
- `POST /api/recheck` 결과 전부 `fresh` (live 4/4)

## 구현 요약

- `src/evidence/crossref.js` — 조회 (`config.crossrefBaseUrl` 만 사용, `CROSSREF_MAILTO` 있으면 query + UA), outcome `found / not_found(404) / failed`
- `src/evidence/compare.js` — deterministic 비교. NFKC·소문자·공백·문장부호·태그·`RETRACTED ARTICLE:`/`WITHDRAWN:` 접두 제거 후 **완전 일치**만. fuzzy 임계값 없음.
  저자: 입력 저자 전원이 Crossref family 목록에 있어야 일치. 연도: issued/published-print/online 후보 중 일치
- `src/evidence/relations.js` — `updated-by` + type ∈ {retraction, withdrawal} 만 철회. `update-to` 는 방향상 제외. dedupe key = type|notice DOI|date
- `src/evidence/service.js` — 판정·조회 실패 규칙·소급 표시·역조회·prewarm
- `src/evidence/routes.js` — 3 endpoint (공용 router 수정 없이 기존 register 로 binding)
- 녹화 fixture: `fixtures/evidence/recorded/` — 2026-09-30 실제 Crossref 응답 5건 (단위 테스트 전용, live 결과로 보고하지 않음)

## 미검증 구간

- 화면(SCREENS) 에서 G3/G4 표시 — 이 트랙 범위 밖, 브라우저 미검증
- main 통합 후 CAPTURE 와 합친 상태의 G1~G6 동시 검증 — INTEGRATOR 몫
- Crossref 가 느리지만 timeout 이내로 응답하는 경우의 시연 체감 시간 (live recheck 4건 ≈ 2초 이내 관측)

## 남은 위험

- 시연 당일 Crossref 가 응답하지 않으면 live G4 는 `verified` 유지(정상 동작)로 끝나 상태 변화가 발생하지 않는다 — SPEC 부록 첫 번째 문장 상황
- `unverifiable` 표본 DOI 가 향후 Crossref 에 등록되면 기대값이 바뀐다 (판정은 항상 현재 응답)
- 동일 DOI 를 다른 서지로 입력하면 별도 evidence 행이 생긴다 (입력 서지별 판정이므로 의도). 같은 입력 재등록은 같은 행 재사용
- `unverifiable_reason` 은 CONTRACT enum 3종 (`not_found`/`insufficient_fields`/`lookup_failed`) 만 사용
- review_reason 은 CONTRACT 문구 `근거 상태 변경: 확인 → 철회됨` 그대로 (재검토 필요는 needs_review 로 표시)

## CONTRACT_CHANGE_REQUEST

- 없음 (공용 schema/router/CONTRACT 수정 없이 구현).
- 참고(요청 아님): `POST /api/evidence`·`/api/recheck` 응답에 CONTRACT 에 없는 부가 필드 `lookup.cache_hit/fresh/outcome`, `comparison`, `relations`, `flagged_judgment_ids`(evidence) 를 추가했다. 기존 필드는 모두 CONTRACT 그대로.

## 【청소】

- 워크트리: clean O (push 후 실측) · 제거 책임 INTEGRATOR
- 브랜치/PR: 미착지 (`origin/track/evidence`, PR 없음)
- 문서·상태: handoff 최신 O

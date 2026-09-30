# handoff — CAPTURE (창2)

> CAPTURE 소유. 형식: docs/CONTRACT.md §10. **G1/G2 최종 PASS 는 선언하지 않는다 — INTEGRATOR 가 main 통합 후 재검증.**

트랙: CAPTURE
branch: track/capture
base main SHA: d164270fc91d87b8fbc128c130b2581668af3547 (착수 시 worker 9bf52bf 는 clean·0 ahead·6 behind → `git merge --ff-only origin/main` 로 fast-forward)
구현 commit: a3c5cae (이 handoff 는 그 다음 commit — 브랜치 tip = `git log -1` 이 최신 commit)
push 여부: O (track/capture, 아래 검증 절차 참조)
검증: 통과 49 / 전체 49
  - node:test `test/capture/capture.test.js` 17/17 (외부 LLM 없이, 주입 추출기·fixture) · 전체 `npm test` 31/31 (core 14 + capture 17)
  - 라이브 서버 검증 `test/capture/live-verify.mjs` live 28/28 + restart 4/4 = 32/32 (실제 서버 :4101 + 실제 SQLite)
G1 후보: **검증 통과** (아래 실제값)
G2 후보: **검증 통과** (아래 실제값)
LLM 실제 경로: claude-cli (`RSE_LLM=claude-cli`, CONTRACT 기본값). 요청 단위 실패 시 rules 로 내려가며 응답에 `extractor:"rules"` + `extractor_fallback` 사유가 남는다(숨기지 않음)
Claude CLI 실제 검증:
  - `claude --help` 로 `-p/--print`, `--output-format json`, `--tools`, `--no-session-persistence`, `--system-prompt` 지원 확인. 설치 버전 2.1.258
  - 환경변수 API key 는 없음(ANTHROPIC_* 0개)이지만 CLI 가 로그인 인증으로 동작 → 이 경로 사용 가능
  - 호출: `claude -p --output-format json --no-session-persistence --tools= --system-prompt <추출 지침>` , 프롬프트는 stdin, cwd=임시 디렉터리(CLAUDE.md 자동 로드 방지)
  - 라이브 문장 1건 직접 호출: exit 0, 약 4.1초, stdout 전체가 단일 JSON(오염 없음), `result` 문자열 JSON 파싱 성공, 필드 추출 성공 (실패 0회 → fallback 전환 조건 미발생)
  - 같은 문장을 실제 서버 POST /api/chat 로 재호출: DB `extractor = llm:claude-cli`, fallback 없음
  - 안전장치: LLM 이 준 값이 **원문에 글자 그대로 없으면 폐기(null)** — 환각 차단. "재현성 검증 단계" 의 접미 "단계" 는 제거
  - 단위 테스트는 CLI 를 실행하지 않는다(fixture: `fixtures/capture/cli/*`: clean / 코드펜스 / 앞뒤 문장 / 환각 / is_error / 비JSON)
라이브 추출 실제값 (POST /api/chat, HTTP 200, attempt id=8):
  - target RSE-01 / method Western blot→`western_blot` / environment 세포 모델→`cell` / condition null / result `stopped` / stop_stage 재현성 검증→`reproducibility_validation`
  - approach_key `RSE-01|western_blot|cell`, extractor `llm:claude-cli`
  - auto_record_line: `자동 기록됨 — 대상 RSE-01 / 방법 Western blot / 환경 세포 / 결과 중단` (저장된 행에서 생성)
DB 실제 baseline: research_attempt 7 · 같은 접근(RSE-01|western_blot|cell) **2** (자기 DB `capture/var/rse.db`, seed 계약 그대로)
DB 실제 입력 후: research_attempt 8 (+1) · 같은 접근 **3** (id 1,2,8) · raw_text 원문·raw/norm·created_at·occurred_at·source=live 저장 확인
plan 증가: 0 (기대 0 / 실제 0)
question 증가: 0 (기대 0 / 실제 0)
hypothesis 증가: 0 (기대 0 / 실제 0)
other(실행 불명확) 증가: 0 (기대 0 / 실제 0)
미상 필드 결과: 환경/방법/대상 각각 미상인 execution → 저장은 되나 `approach_key=null`, `approach.match=undetermined`, same_count 0, 같은 접근 2건이 3건이 되지 않음 (단위 테스트 3케이스)
같은 접근 실제값 (GET /api/approaches, 실제 SQLite 재조회): match=same, same_count=3, same_attempt_ids=[1,2,8], stop_stages=[{reproducibility_validation, 재현성 검증, [1,2,8]}], exact_repeat_ids=[], adjacent_ids=[3](qPCR), undetermined_ids=[6](환경 미상), text=`이 접근은 3번 시도됐고 모두 재현성 검증 단계에서 멈췄습니다`
common stop stage: {norm: reproducibility_validation, raw: 재현성 검증, all_same: true}
  - 하드코딩 아님을 테스트로 증명: 다른 중단 단계 1건을 저장하면 `이 접근은 4번 시도됐습니다 (재현성 검증 3건, 행동검증 1건)`, all_same=false; 단계 기록이 없는 same 시도가 있어도 all_same=false; 0건이면 `저장된 같은 접근 시도가 없습니다`
exact_repeat 실제 판정: 조건까지 같은 시도(`1 µM, 24시간` → `1 uM; 24 h`) 저장 → exact_repeat_ids=[1]; 조건이 다르거나 null 이면 exact_repeat 아님
서버 재시작 후: 같은 접근 3 · 문구 · live 시도 1건 모두 SQLite 값 유지 (4/4)
question: attempt 증가 0, 저장 시도 재사용(attempt_ids=[1,2,8]), judgment 저장 + judgment_attempt_link=[1,2,8], 근거 없음 → NO_PATH_MESSAGE 그대로(grounded=false). 미검증(mismatch/unverifiable) 근거는 `evidence.excluded` 로만, `items`·다음 후보 근거에 쓰지 않음. 재검토 필요(needs_review=1) 판단은 다음 후보 출처에서 제외. CAPTURE 가 만든 판단(제안이 `저장된 판단 #` 로 시작)은 출처로 재사용하지 않음(인용의 인용 방지)
실패경로:
  - 본문 없음/빈 text → 400 BAD_REQUEST, `/api/approaches` 인자 없음 → 400, 없는 attempt_id → 404
  - claude-cli 오류/비JSON/타임아웃/미설치 → rules 로 전환 + `extractor_fallback` 표기 (테스트 3경로)
  - 추출기 자체가 예외면 저장하지 않고 502 EXTRACTION_FAILED
  - 부정("측정하지 않았다")·조건("했다면")·인지 동사("생각했다")·실행+계획/가설 혼합 → 저장 안 함(other)
미검증 구간:
  - 화면 A/C 에서의 표시(SCREENS 영역, public/** 미접촉) — 브라우저 검증 안 함
  - 발화 분류는 한국어 규칙 기반의 시연 범위 최소 규칙 — 표현이 다양한 실제 발화 전반에 대한 정확도는 검증하지 않음
  - claude-cli 라이브 호출은 라이브 문장 위주(서버 경유 1회 + 직접 1회 + question 1회). 대량/다양한 문장의 JSON 안정성은 미검증
  - 근거(evidence) 실데이터와 결합한 question 답 — EVIDENCE 트랙 통합 후 재검증 필요(현재는 주입 근거 행으로만 검증)
남은 위험:
  - 실행+계획이 한 문장에 섞이면 보수적으로 저장하지 않는다(실제 실행이 누락될 수 있음, 반대로 오저장은 방지)
  - claude-cli 는 호출당 약 4초·question 도 추출 1회 소요. 발표 현장 네트워크/로그인 만료 시 rules 로 내려감(응답에 표기)
  - 사전 밖 method 는 표기 통일값(소문자·snake)으로 저장, 사전 밖 environment 는 NULL(DB enum 제약) → 후자는 undetermined 가 된다
  - 내 개발 DB(`capture/var/rse.db`)는 라이브 검증으로 attempt 8건·judgment 2건 상태 — 시연 baseline 복원은 INTEGRATOR(`npm run baseline:restore`) 책임
CONTRACT_CHANGE_REQUEST: 없음 (엔드포인트는 스텁 자리 `src/capture/routes.js` 만 사용, 공용 router/schema/CONTRACT 미수정). 참고용 가산 필드(변경 요청 아님):
  - 응답 `extractor_fallback`(fallback 시), `approach.stop_stages/exact_repeat_text/missing_fields/attempt_id`, `answer.next.judgment_ids`
  - GET /api/approaches 선택 파라미터 `condition`(exact_repeat 판정용)
  - execution 응답의 `answer` 는 null (CONTRACT §5.1: answer 는 question 전용)

【청소】
워크트리: clean O/X → 최종 확인은 아래 「청소 확인」 · 제거 책임 INTEGRATOR
브랜치/PR: 미착지
문서·상태: handoff 최신 O

재현: `npm test` · 서버 `npm start`(PORT 4101) 후 `node test/capture/live-verify.mjs live` → 서버 재시작 → `... restart`.

# handoff — SCREENS (창4)

트랙: SCREENS
branch: track/screens
base main SHA: ea55992 (fast-forward 후 기준, 이전 worker 시작점 9bf52bf)
코드 commit: 54de3ef (이 handoff 를 포함한 최신 commit SHA 는 `git log -1 track/screens` / 최종 보고 참조)
push 여부: 최종 보고에서 확인 (handoff 커밋 후 push)

## 검증 요약 (fixture / 실제 서버 / 브라우저를 분리)

전체 검증: 통과 139 / 전체 139  (정적 9 + 브라우저 fixture 106 + 브라우저 live 24)
- 정적 `node --test test/screens/static.test.js`: 9 / 9. `npm test` 전체 23 / 23.
- 화면 A: fixture 33 / 33 · live 1 / 1
- 화면 B: fixture 27 / 27 · live 16 / 16
- 화면 C: fixture 37 / 37 · live 6 / 6
- 공통(X: nav·고지·JS 예외): fixture 9 / 9 · live 1 / 1

필수 testid 기대/실제: 23종 / 23종 (nav 3 + data-notice 1 + A 6 + B 8 + C 5). row 계열(approval-card, run-result, attempt-row, evidence-row, judgment-row)은 ≥1, 실제 행 수는 API 개수와 전수 비교.
data attribute 검증: data-approval-id / data-status / data-run-id / data-attempt-id / data-evidence-id / data-judgment-id / data-needs-review 를 실제 DOM 값 = API 값으로 비교 (fixture 전수, live 전수). 숨김·빈 placeholder 아님 (hash-after 는 값 없을 때 "—" + data-empty=1 로 명시, 값 위조 없음).

### fixture 검증 (UI 계약 검증 — 실제 제품 통합 PASS 아님)
`test/screens/lib/mock-server.js` 가 CONTRACT 형식 응답을 흉내 낸다. 통과한 것은 "UI 가 계약 형식의 응답을 올바르게 렌더한다" 뿐.
- A: 계획·질문 → 기록 줄 불변 · 실행 발화 → 자동 기록 한 줄 + 원문↔구조화 표 · 같은 접근 2→3 은 fixture 서버 상태 · 하드코딩 아님 확인(다른 fixture 4건·행동검증 → 5번·행동검증, "재현성 검증" 문구 없음) · loading · 빈 입력 · 500 · `{}` · saved=true/attempt 없음 · 501 · 네트워크 단절 (기존 답/기록 줄 유지, 성공 위조 없음)
- B: 요청 → pending 카드 → 대기 중 분석 완료 → 승인 → 전/후 hash 나란히(같은 높이, 화면 안) · 거절 → rejected + hash 불변 · 요청/분석/승인/거절 실패 · 목록 조회 실패 시 기존 카드 유지
- C: baseline verified/needs-review 0 → loading(기존 행 유지) → retracted/needs-review 1 · 철회일은 fixture 값(2031-02-03)이 렌더되고 2024-06-24 는 나오지 않음(상수 아님 증명) · 재검사 500/`{}`/501/네트워크 단절 → 기존 상태 유지 + 오류 + "논문 부재를 뜻하지 않습니다" · lookup.ok=false 응답 → verified 유지 + "최신 확인 실패" · 화면 A 실행 후 화면 C 새 행 +1

### 실제 API 검증 (이 worktree 의 실제 서버 PORT 4103, 새 seed DB — 브라우저 클릭)
- PASS: 화면 C 행 수 7/1/1 = API, evidence data-status·judgment data-needs-review·attempt-raw 전수 일치, seed baseline(verified · 2022-03-15 · 재검토 0)
- PASS: 화면 B 전체 G5 흐름 실제 backend — 대기 카드 · 승인 전 hash = 원본 hash · 대기 중 독립 분석 완료 · 승인 후 전/후 hash = API 값(전≠후, 후 = 새 원본 hash) · 거절 → 원본 hash 불변 · 처리된 카드 재승인 409
- PASS(오류 경로): CAPTURE/EVIDENCE 가 아직 501 → 화면이 오류(NOT_IMPLEMENTED)로 표시, 기록 줄·근거 상태·DB 시도 수(7) 불변, 성공 위조 없음
- **UNPROVEN**: 실제 `POST /api/chat` 성공 경로(baseline 2→3, answer 세 덩어리), 실제 `POST /api/recheck` 성공 경로(확인→철회됨, 재검토 필요). 실제 backend 가 main 에 없어(501) 확인 불가. G1/G4 최종 판정은 INTEGRATOR 통합 후 `node scripts/verify-ui.js` 로.
- G5 최종 PASS 는 선언하지 않음 (INTEGRATOR 통합 후 재검증 대상).

브라우저 검증: Windows Chrome(headless, CDP, `scripts/lib/cdp.js` 재사용) 실제 사용 O. 실행: `node \\wsl.localhost\Ubuntu\home\user\projects\.worktrees\research-state-engine\screens\test\screens\run-browser.js [fixture|live|all]` (Windows node). 결과 `var/screens-verify/report.json` + 화면 캡처(gitignore, 미추적).
Windows Chrome 실제 사용 여부: O
1920×1080 판독: PASS — nav 3개·버튼·데이터 고지(스크롤 끝에서도)·제목 잘림 없음, hash 글자 ≥ 28px 8자리, 텍스트 최소 ≥ 13px (15px 미만은 보조 라벨/메타 일부, 상태·hash·본문은 ≥ 16px). A/B/C 캡처를 직접 눈으로 확인.
horizontal overflow: 없음 (A/B/C 각각 scrollWidth ≤ 1920, viewport 밖 요소 0)
깨지는 화면: 없음. 단, viewport < 1500px 에서는 3열 → 1열 전환(발표 해상도 대상 아님, 1440×900 은 미측정).
미검증 구간: 위 UNPROVEN 2건 · 1920×1080 이외 해상도 · Firefox/Safari · 실제 LLM 응답 지연(120s timeout 까지 loading 유지하도록 구현, 실측은 fixture 900ms 지연)
production hardcode 검사: 정적 테스트 PASS — public/app.js 에 2024-06-24 · DOI · reproducibility_validation · "재현성 검증" · 행동검증 · N번 · RSE-01 · Aβ · needs_review=1 · retracted 대입 없음. 호출 API 는 CONTRACT §5 범위. 표시 문구/라벨(enum 코드→한글 라벨)만 상수.

## 구현 메모
- `public/index.html` + `app.css` + `app.js`. 외부 CDN/폰트 없음. `/` 로 서빙(기존 serveStatic).
- 화면 전환 시 화면 B/C 는 조용히 재조회(기존 표시 유지). 화면 A 실행 발화 후 화면 C 도 재조회 → 새로고침 없이 새 시도 행.
- 화면 A: `auto-record-line` 은 마지막 "저장된" 기록 줄만 유지하고, 계획/질문은 별도 `record-status` 에 "기록하지 않았습니다"를 표시. answer 세 덩어리는 answer 가 없는 응답(계획 등)에서는 이전 답을 유지하고 "기준 발화"를 표시.
- 화면 C: 근거 → 판단 연결은 `GET /api/judgments` 의 `evidence[]` 로 계산(별도 API 없음).
- INTEGRATOR `verify-ui` 는 main 체크아웃의 public 을 서빙하므로 통합 후에 실행해야 이 화면이 검증됨. 그 스크립트의 흐름(nav → count → type → click → waitFor)과 호환되게 구현했으나 이 worktree 에서 verify-ui 를 직접 돌린 것은 아님 (별도 러너로 동일 계약 검증).

## 발견한 backend 관찰 (수정 안 함, 참고)
- `GET /api/approval/target` 은 원본 파일이 아직 없으면 `exists:false, hash:null` (파일은 첫 `POST /api/actions` 때 준비). 화면은 "—" 로 표시. baseline restore 를 거치면 정상 표시.

CONTRACT_CHANGE_REQUEST:
- 필요한 변경: Evidence 객체의 `input` 에 선택 필드 `journal` (문자열|null) 추가.
- 이유: 발주는 Aβ*56 문헌의 저널(Nature)을 화면에 표시하라고 하나 API 에 저널 필드가 없다. DOI→저널을 프런트에 하드코딩하지 않는다.
- 현재 막히는 경로: 화면 C 근거 행의 저널 표시 (현재는 저자·연도·DOI·제목만).
- 최소 변경안: `evidence` 에 `input_journal` 컬럼(seed: "Nature") + `evidenceView.input.journal`. 화면은 이미 `input.journal` 이 있으면 표시하도록 구현돼 있어 프런트 추가 변경 불필요.

【청소】
워크트리: clean O/X (최종 보고 참조) · 제거 책임 INTEGRATOR
브랜치/PR: 미착지 (main merge 는 INTEGRATOR)
문서·상태: handoff 최신 O

# STATUS — INTEGRATOR 단일 작성

> worker 는 이 파일을 수정하지 않는다. 모든 값은 INTEGRATOR 의 main 기준 실측.
> 판정: PASS (API/DB + 실제 브라우저 화면 모두 관측) · FAIL (관측했으나 기대와 다름/미구현) · UNPROVEN (관측 불가·부분만 관측)

갱신: 2026-09-30 19:05 KST · main 기준 (이 커밋 직전 main = d164270)

## worker 트랙 (단회 실측 18:55)
| track | origin SHA | origin/main 대비 | 상태 |
|---|---|---|---|
| CAPTURE | 9bf52bf | ahead 0 / behind 6 | 미착수 (변경 0) |
| EVIDENCE | 9bf52bf | ahead 0 / behind 6 | 미착수 (변경 0) |
| SCREENS | 9bf52bf | ahead 0 / behind 6 | 미착수 (변경 0) |

PR: 0건. 폴링 감시는 중단함 — worker 완료 보고 시점에 단회 확인.

## Gate
| Gate | 판정 | 실측 (기대 / 실제) |
|---|---|---|
| G1 자동 축적 | FAIL (미구현) | verify-gates 2/16. baseline 같은 접근 2/2 ✓. `/api/chat` = 501 → 실행 후 3 / 실제 2 |
| G2 재사용 | FAIL (미구현) | verify-gates 0/9 |
| G3 근거 검증 | FAIL (미구현) | verify-gates 1/11. `POST /api/evidence` = 501 |
| G4 철회와 소급 | FAIL (미구현) | verify-gates 4/15. baseline 근거 verified ✓, link 1 ✓, 철회 논문 cache 0 ✓. `POST /api/recheck` = 501. 2026-09-30 Crossref 실측: updated-by type=retraction (publisher·retraction-watch, 2024-06-24) |
| G5 승인 게이트 | UNPROVEN | API/DB 8/8 (승인 전 hash 19b0f12a = 기준, 대기 중 분석 completed + 카드 pending 1, 승인 후 1d733821 = 파일 실측, 거절 시 불변). 단위 5/5. **화면 B 전/후 hash 동시 표시 미관측 (SCREENS 미착수)** |
| G6 영속성 | FAIL (전제 미충족) | 서버 프로세스 재시작 후 시도 7·근거 1·연결 1 유지, 철회 0·재검토 0 → 5/5 중 관측 가능 3 (0건은 PASS 아님) |
| R1 제출 안전 | FAIL (미완) | public ✓ · README ✓(구현 중 표기) · secret 0 hit / tracked 39 ✓ · CLAUDE.md 미추적 ✓ · DB/env/log 미추적 ✓ · **PPT/PDF 없음 · 데모 영상 없음 · README AI 모델 미확정** |
| PARALLEL_READY | O (25/25) | 18:45 실측 |

## baseline (19:03 실측, root DB_PATH)
restore 후 4/4 — 같은 접근 2/2 · 과거 판단 근거 verified/verified · 재검토 0/0 · 원본 hash 19b0f12a73c59354/19b0f12a73c59354.
sqlite3·sha256sum 직접 비교도 동일. 철회 논문 cache 0. EVIDENCE prewarm = skipped(모듈 없음) → EVIDENCE 통합 후 재생성 필요.
freeze: 없음 (G1~G6 미완)

## 검증 도구 상태
- `npm test` 14/14
- `scripts/verify-gates.js` (실서버·실SQLite·실Crossref): gate 별 최소 검사 수(G1 16·G2 9·G3 15·G4 15·G5 8·G6 10) 미달 또는 1건 실패 → FAIL. 요청 실패(501)로 생긴 "증가량 0" 은 PASS 로 치지 않음. 실패 시 exit 1 확인.
- `scripts/verify-ui.js` (Windows Chrome CDP 실제 렌더링): gate 별 최소 검사 수 미달 → FAIL. 현재 0/1 (data-notice 없음).

## blocker / 위험
- worker 3트랙 미착수 → G1~G4, G5 화면, G6 전제 대기
- LLM API key 환경변수 없음 → CAPTURE 는 로컬 `claude` CLI 또는 rules 추출
- WSL chromium 공유 라이브러리 없음(sudo 불가) → UI 검증은 Windows Chrome 경로
- worker base 9bf52bf 는 CONTRACT 추가(CROSSREF_BASE_URL · prewarmBaselineCache · §8.1 testid) 이전 → 통합 시 계약 준수 확인

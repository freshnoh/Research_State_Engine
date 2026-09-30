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
| PARALLEL_READY | **O** (25/25) | 2026-09-30 18:45 실측. 아래 표 |

- current main SHA: 9bf52bff165caee854d1231bc2ab390029ef06d6 (공용 scaffold 기준선, origin/main 포함 확인)

### PARALLEL_READY 실측 (통과 25 / 전체 25)
- scaffold: `npm test` 6/6 pass, `npm start` → `/api/health` ok=true, SQLite 테이블 10개(schema_meta 포함), seed 후 RSE-01 같은 접근 = 2 (sqlite3 실측)
- origin/main = 9bf52bf, `git show origin/main:src/db/schema.sql` CREATE TABLE 10, 트리 30 파일, CLAUDE.md 0
- worker worktree (모두 base 9bf52bf, clean, CLAUDE.md 로컬 복사·ignore·미추적, `.env.local` ignore, origin 브랜치 push):

| track | 경로 | branch | PORT | DB_PATH | health |
|---|---|---|---|---|---|
| CAPTURE | /home/user/projects/.worktrees/research-state-engine/capture | track/capture | 4101 | …/capture/var/rse.db | ok, attempts 7 |
| EVIDENCE | /home/user/projects/.worktrees/research-state-engine/evidence | track/evidence | 4102 | …/evidence/var/rse.db | ok, attempts 7 |
| SCREENS | /home/user/projects/.worktrees/research-state-engine/screens | track/screens | 4103 | …/screens/var/rse.db | ok, attempts 7 |
| INTEGRATOR | /home/user/projects/Research_State_Engine | main | 4100 | …/Research_State_Engine/var/rse.db | — |
- baseline/freeze: 없음
- blocker: 없음
- 위험: LLM API key 환경변수 없음 → CAPTURE 추출기는 로컬 `claude` CLI(2.1.258) 또는 deterministic rules 경로 필요

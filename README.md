# Research State Engine (연구 상태 엔진)

연구자가 따로 기록하지 않아도 대화로 말한 실제 시도·실패가 연구 상태로 쌓이고, 그것이 다음 판단에 다시 쓰이며,
근거(논문)가 나중에 철회되면 그 근거를 썼던 과거 판단까지 재검토 대상으로 표시하는 단일 애플리케이션.

> **기관 시도 이력과 과거 판단은 시연용 합성 데이터 · 문헌 근거와 철회 정보는 공개 실제 데이터**

## 실행

```bash
npm run db:init   # SQLite schema 생성 (DB_PATH, 기본 var/rse.db)
npm run seed      # 빈 DB 에 시연 seed 적재
npm start         # http://127.0.0.1:4100
npm test
```

Node.js ≥ 22.13 만 필요하다 (외부 npm 의존성 없음).

## 구성 (작성 중 — 통합 후 갱신)

- 저장소: SQLite 단일 파일 (`node:sqlite`)
- 외부 연구 데이터: Crossref REST API 하나
- 사양: [docs/SPEC.md](docs/SPEC.md) · 트랙 계약: [docs/CONTRACT.md](docs/CONTRACT.md) · 상태: [docs/STATUS.md](docs/STATUS.md)

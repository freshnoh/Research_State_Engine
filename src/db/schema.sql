-- Research State Engine — 공용 SQLite schema (INTEGRATOR 소유, docs/CONTRACT.md §2)
-- 규칙: *_raw = 원문에서 뽑은 값 그대로, *_norm = 정규화 값. NULL = 미상(추측 금지).
-- 시각은 ISO-8601 문자열(타임존 포함).

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- ① 연구 시도: 실제 실행/결과 흔적이 있는 발화만 저장
CREATE TABLE IF NOT EXISTS research_attempt (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  raw_text          TEXT NOT NULL,
  target_raw        TEXT,
  target_norm       TEXT,
  method_raw        TEXT,
  method_norm       TEXT,
  environment_raw   TEXT,
  environment_norm  TEXT CHECK (environment_norm IS NULL OR environment_norm IN
                      ('in_vitro','cell','animal','clinical','simulation','dataset')),
  condition_raw     TEXT,
  condition_norm    TEXT,
  result            TEXT NOT NULL DEFAULT 'unknown' CHECK (result IN
                      ('success','partial','failure','stopped','unknown')),
  stop_stage_raw    TEXT,
  stop_stage_norm   TEXT,
  occurred_at       TEXT,
  created_at        TEXT NOT NULL,
  source            TEXT NOT NULL CHECK (source IN ('seed','live')),
  is_synthetic      INTEGER NOT NULL DEFAULT 0 CHECK (is_synthetic IN (0,1)),
  extractor         TEXT
);
CREATE INDEX IF NOT EXISTS idx_attempt_key
  ON research_attempt(target_norm, method_norm, environment_norm);

-- ② 근거: 삭제하지 않는다. 상태는 사용자 표시 4종.
CREATE TABLE IF NOT EXISTS evidence (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  input_doi            TEXT NOT NULL,
  input_title          TEXT,
  input_authors        TEXT,            -- JSON array of strings
  input_year           INTEGER,
  cr_title             TEXT,
  cr_authors           TEXT,            -- JSON array of strings
  cr_year              INTEGER,
  status               TEXT NOT NULL CHECK (status IN
                         ('verified','mismatch','unverifiable','retracted')),
  unverifiable_reason  TEXT CHECK (unverifiable_reason IS NULL OR unverifiable_reason IN
                         ('not_found','insufficient_fields','lookup_failed')),
  mismatch_fields      TEXT,            -- JSON array: ["title","authors","year"]
  retraction_type      TEXT,            -- 예: retraction
  retraction_direction TEXT,            -- 'updated-by' (이 work 가 갱신 대상) 등
  retraction_source    TEXT,            -- 예: publisher / retraction-watch
  retraction_notice_doi TEXT,
  retraction_date      TEXT,
  last_success_at      TEXT,            -- 마지막 정상 조회 시각
  last_attempt_at      TEXT,            -- 마지막 조회 시도 시각
  last_attempt_ok      INTEGER CHECK (last_attempt_ok IS NULL OR last_attempt_ok IN (0,1)),
  last_error           TEXT,
  excluded_reason      TEXT,            -- 판단 근거 집합에서 제외된 이유(한 줄)
  is_demo_corrupted    INTEGER NOT NULL DEFAULT 0 CHECK (is_demo_corrupted IN (0,1)),
  is_demo_past_state   INTEGER NOT NULL DEFAULT 0 CHECK (is_demo_past_state IN (0,1)),
  status_changed_at    TEXT,
  previous_status      TEXT,
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_evidence_doi ON evidence(input_doi);

-- ③ 판단
CREATE TABLE IF NOT EXISTS judgment (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  question           TEXT NOT NULL,
  asked_at           TEXT NOT NULL,
  proposal           TEXT,
  researcher_action  TEXT,
  needs_review       INTEGER NOT NULL DEFAULT 0 CHECK (needs_review IN (0,1)),
  review_reason      TEXT,
  review_flagged_at  TEXT,
  is_synthetic       INTEGER NOT NULL DEFAULT 0 CHECK (is_synthetic IN (0,1)),
  demo_label         TEXT,
  created_at         TEXT NOT NULL
);

-- 판단이 사용한 시도
CREATE TABLE IF NOT EXISTS judgment_attempt_link (
  judgment_id  INTEGER NOT NULL REFERENCES judgment(id),
  attempt_id   INTEGER NOT NULL REFERENCES research_attempt(id),
  PRIMARY KEY (judgment_id, attempt_id)
);

-- ④ 판단이 사용한 근거 (evidence → judgment 역조회용 인덱스)
CREATE TABLE IF NOT EXISTS evidence_judgment_link (
  judgment_id  INTEGER NOT NULL REFERENCES judgment(id),
  evidence_id  INTEGER NOT NULL REFERENCES evidence(id),
  created_at   TEXT NOT NULL,
  PRIMARY KEY (judgment_id, evidence_id)
);
CREATE INDEX IF NOT EXISTS idx_ejl_evidence ON evidence_judgment_link(evidence_id);

-- ⑤ 승인 대기 작업
CREATE TABLE IF NOT EXISTS approval_action (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  action_type   TEXT NOT NULL,
  description   TEXT NOT NULL,
  reason        TEXT NOT NULL,
  rule_id       TEXT NOT NULL,
  target_path   TEXT NOT NULL,
  payload       TEXT,               -- JSON
  status        TEXT NOT NULL CHECK (status IN ('pending','approved','rejected','failed')),
  hash_before   TEXT,
  hash_after    TEXT,
  error         TEXT,
  created_at    TEXT NOT NULL,
  decided_at    TEXT
);

-- 승인 불필요 작업(분석 등) 실행 기록
CREATE TABLE IF NOT EXISTS action_run (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  action_type  TEXT NOT NULL,
  description  TEXT NOT NULL,
  rule_id      TEXT NOT NULL,
  status       TEXT NOT NULL CHECK (status IN ('completed','failed')),
  result       TEXT,                -- JSON
  created_at   TEXT NOT NULL,
  completed_at TEXT
);

-- ⑥ Crossref 조회 cache / 조회 로그
CREATE TABLE IF NOT EXISTS crossref_cache (
  doi          TEXT PRIMARY KEY,    -- 소문자 정규화 DOI
  http_status  INTEGER NOT NULL,
  raw_json     TEXT,
  fetched_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS crossref_lookup_log (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  doi          TEXT NOT NULL,
  mode         TEXT NOT NULL CHECK (mode IN ('cache_hit','fresh')),
  ok           INTEGER NOT NULL CHECK (ok IN (0,1)),
  http_status  INTEGER,
  error        TEXT,
  at           TEXT NOT NULL
);

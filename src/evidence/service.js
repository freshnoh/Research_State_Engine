// 근거 검증 · 재검사 · 소급. CONTRACT §2, §4, §5.2.
// 판정은 전부 deterministic rule 이다. LLM 을 쓰지 않는다.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../config.js';
import { nowIso, tx, parseJson } from '../db/index.js';
import { EVIDENCE_STATUS } from '../contract/enums.js';
import { judgmentView, evidenceView } from '../core/views.js';
import { normalizeDoi, fetchWork, metaFromMessage } from './crossref.js';
import { compareBibliography } from './compare.js';
import { extractRelations } from './relations.js';

export class EvidenceError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

export const SAMPLES_FILE = path.join(ROOT, 'fixtures', 'evidence', 'samples.json');
const GENERAL_SAMPLE_KEYS = ['normal', 'corrupted', 'unverifiable'];

/**
 * 현재 Crossref 응답(found) + 사용자 입력 서지 → 상태 판정 (순수 함수).
 * 철회 > 서지 불일치: 철회 relation 이 있으면 status=retracted 이고, 서지 비교 결과(mismatch_fields)는 그대로 남긴다.
 */
export function decideFromMessage(input, message) {
  const meta = metaFromMessage(message);
  const rel = extractRelations(message);
  const cmp = compareBibliography(input, meta);

  let status; let reason = null;
  if (cmp.provided.length === 0) status = 'verified'; // DOI 만 입력: 레코드 확인 사실만 (서지 일치를 주장하지 않음)
  else if (cmp.mismatch_fields.length > 0) status = 'mismatch';
  else if (cmp.compared.length > 0) status = 'verified';
  else { status = 'unverifiable'; reason = 'insufficient_fields'; }

  if (rel.primary) { status = 'retracted'; reason = null; }
  return {
    status, reason, meta, rel, cmp,
    comparison: {
      bibliographic_match_claimed: cmp.compared.length > 0 && cmp.mismatch_fields.length === 0,
      record_confirmed_only: cmp.provided.length === 0,
      fields: cmp.fields, compared_fields: cmp.compared, mismatch_fields: cmp.mismatch_fields,
    },
  };
}

const statusLabel = (s) => EVIDENCE_STATUS[s] ?? s;

export function createEvidenceService({ db, config, fetch: fetchImpl = globalThis.fetch, now = nowIso }) {
  const getRow = (id) => db.prepare('SELECT * FROM evidence WHERE id = ?').get(id);
  const getCache = (doi) => db.prepare('SELECT * FROM crossref_cache WHERE doi = ?').get(doi);
  const log = (doi, mode, ok, http_status, error, at) => db.prepare(
    'INSERT INTO crossref_lookup_log (doi, mode, ok, http_status, error, at) VALUES (?,?,?,?,?,?)',
  ).run(doi, mode, ok ? 1 : 0, http_status ?? null, error ?? null, at);

  // ── 조회 획득: cache 또는 fresh. fresh 성공/404 만 cache 에 반영, 실패는 cache 를 건드리지 않는다.
  async function acquire(doiLower, { fresh }) {
    if (!fresh) {
      const c = getCache(doiLower);
      if (c && (c.http_status === 200 || c.http_status === 404)) {
        const outcome = c.http_status === 200 ? 'found' : 'not_found';
        log(doiLower, 'cache_hit', true, c.http_status, null, now());
        return { mode: 'cache_hit', outcome, http_status: c.http_status, raw_json: c.raw_json, error: null, fetched_at: c.fetched_at };
      }
    }
    const r = await fetchWork(config, doiLower, fetchImpl, now);
    log(doiLower, 'fresh', r.outcome !== 'failed', r.http_status, r.error, r.fetched_at);
    if (r.outcome === 'found') upsertCache(doiLower, r);
    // 이전에 200 을 받은 DOI 의 404 는 마지막 정상 응답(cache)을 덮어쓰지 않는다
    if (r.outcome === 'not_found' && getCache(doiLower)?.http_status !== 200) upsertCache(doiLower, r);
    return { mode: 'fresh', ...r };
  }

  function upsertCache(doiLower, r) {
    db.prepare(`INSERT INTO crossref_cache (doi, http_status, raw_json, fetched_at) VALUES (?,?,?,?)
      ON CONFLICT(doi) DO UPDATE SET http_status=excluded.http_status, raw_json=excluded.raw_json, fetched_at=excluded.fetched_at`)
      .run(doiLower, r.http_status, r.raw_json, r.fetched_at);
  }

  // ── 조회 결과를 evidence 행에 반영 (동기, 트랜잭션 안에서 호출)
  function apply(row, acq, doiLower, cacheBefore) {
    const t = now();
    const before = row.status;
    const upd = { updated_at: t };
    let decision = null;
    let treatedAsFailure = false;
    let failureText = acq.error;

    // 과거 기록 = 정상 확인 이력 또는 cache. 한 번도 조회 시도가 없던 행은 최초 조회로 본다.
    const hasPast = row.last_attempt_at != null && (!!row.last_success_at || !!cacheBefore);
    if (acq.outcome === 'not_found' && row.last_success_at) {
      // 이전에 정상 확인된 근거: 오늘의 "레코드 미확인" 으로 과거 확인을 덮어쓰지 않는다
      treatedAsFailure = true;
      failureText = 'Crossref 레코드 미확인 (HTTP 404) — 기존 확인 상태 유지';
    }

    if (acq.outcome === 'found') {
      const message = JSON.parse(acq.raw_json).message;
      const input = { title: row.input_title, authors: parseJson(row.input_authors, []), year: row.input_year };
      decision = decideFromMessage(input, message);
      Object.assign(upd, {
        cr_title: decision.meta.title,
        cr_authors: JSON.stringify(decision.meta.authors),
        cr_year: decision.meta.year,
        status: decision.status,
        unverifiable_reason: decision.reason,
        mismatch_fields: JSON.stringify(decision.cmp.mismatch_fields),
        retraction_type: decision.rel.primary?.type ?? null,
        retraction_direction: decision.rel.primary?.direction ?? null,
        retraction_source: decision.rel.primary?.source ?? null,
        retraction_notice_doi: decision.rel.primary?.related_doi ?? null,
        retraction_date: decision.rel.primary?.date ?? null,
        excluded_reason: exclusionReason(decision.status, decision.reason),
      });
      if (acq.mode === 'fresh' || !row.last_success_at) {
        Object.assign(upd, { last_success_at: acq.fetched_at, last_attempt_at: acq.fetched_at, last_attempt_ok: 1, last_error: null });
      }
    } else if (acq.outcome === 'not_found' && !treatedAsFailure) {
      Object.assign(upd, {
        status: 'unverifiable', unverifiable_reason: 'not_found', mismatch_fields: '[]',
        retraction_type: null, retraction_direction: null, retraction_source: null, retraction_notice_doi: null, retraction_date: null,
        excluded_reason: exclusionReason('unverifiable', 'not_found'),
      });
      if (acq.mode === 'fresh' || !row.last_attempt_at) {
        Object.assign(upd, { last_attempt_at: acq.fetched_at, last_attempt_ok: 1, last_error: null });
      }
    } else {
      // 조회 실패 (또는 정상 확인 이력 위의 404): 최신 시도 정보만 기록
      Object.assign(upd, { last_attempt_at: acq.fetched_at, last_attempt_ok: 0, last_error: failureText });
      if (!hasPast) {
        // 과거 기록도 cache 도 없는 최초 조회 실패 → 확인 불가 / 조회 실패
        Object.assign(upd, {
          status: 'unverifiable', unverifiable_reason: 'lookup_failed',
          excluded_reason: exclusionReason('unverifiable', 'lookup_failed'),
        });
      }
    }

    // 조회 전 임시 행(한 번도 조회 안 됨)의 최초 판정은 "상태 변경" 이 아니다 (검증 중 보정:
    // 신규 정상 근거가 화면에 "확인 불가 → 확인" 으로 표시되던 문제, 2026-09-30 19:55)
    if (upd.status && upd.status !== before && row.last_attempt_at != null) {
      upd.previous_status = before;
      upd.status_changed_at = t;
    }
    const cols = Object.keys(upd);
    db.prepare(`UPDATE evidence SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`).run(...cols.map((c) => upd[c]), row.id);

    const after = upd.status ?? before;
    const flagged = after === 'retracted' && before !== 'retracted' ? flagLinkedJudgments(row.id, before, t) : [];
    return { before, after, decision, treatedAsFailure, flagged };
  }

  // 판단 근거 집합에서 제외하는 이유 (기록은 삭제하지 않는다)
  function exclusionReason(status, reason) {
    if (status === 'mismatch') return '서지 불일치 — 판단 근거 집합에서 제외';
    if (status === 'unverifiable') return `확인 불가${reason ? ` (${reason})` : ''} — 판단 근거 집합에서 제외`;
    if (status === 'retracted') return '철회됨 — 판단 근거 집합에서 제외';
    return null;
  }

  // 근거 → 판단 역조회 후 재검토 표시. "판단이 틀렸다"는 뜻이 아니다.
  function flagLinkedJudgments(evidenceId, beforeStatus, t) {
    const ids = db.prepare(`SELECT j.id FROM judgment j JOIN evidence_judgment_link l ON l.judgment_id = j.id
      WHERE l.evidence_id = ? AND j.needs_review = 0 ORDER BY j.id`).all(evidenceId).map((r) => r.id);
    const reason = `근거 상태 변경: ${statusLabel(beforeStatus)} → ${statusLabel('retracted')}`;
    const up = db.prepare('UPDATE judgment SET needs_review = 1, review_reason = ?, review_flagged_at = ? WHERE id = ?');
    for (const id of ids) up.run(reason, t, id);
    return ids;
  }

  function findOrCreateRow(doiLower, input) {
    const authorsJson = JSON.stringify(input.authors ?? []);
    const hit = db.prepare(`SELECT * FROM evidence WHERE lower(input_doi) = ?
        AND COALESCE(input_title,'') = ? AND COALESCE(input_authors,'[]') = ?
        AND COALESCE(input_year,-1) = ? AND is_demo_corrupted = ? ORDER BY id LIMIT 1`)
      .get(doiLower, input.title ?? '', authorsJson, input.year ?? -1, input.is_demo_corrupted ? 1 : 0);
    if (hit) return { row: hit, created: false };
    const t = now();
    // 조회 전 임시 행: 최초 조회 실패라면 apply() 가 unverifiable/lookup_failed 로 확정한다
    const id = Number(db.prepare(`INSERT INTO evidence (input_doi, input_title, input_authors, input_year, status,
        is_demo_corrupted, created_at, updated_at) VALUES (?,?,?,?, 'unverifiable', ?, ?, ?)`)
      .run(doiLower, input.title ?? null, authorsJson, input.year ?? null, input.is_demo_corrupted ? 1 : 0, t, t).lastInsertRowid);
    return { row: getRow(id), created: true };
  }

  function lookupView(acq) {
    return {
      mode: acq.mode,
      cache_hit: acq.mode === 'cache_hit',
      fresh: acq.mode === 'fresh',
      outcome: acq.outcome,
      ok: acq.outcome !== 'failed',
      http_status: acq.http_status,
      fetched_at: acq.fetched_at,
      error: acq.error,
    };
  }

  function detailView(res) {
    const d = res.decision;
    return {
      comparison: d ? d.comparison : null,
      relations: d ? {
        counts: d.rel.counts,
        retraction: d.rel.retraction.map(({ key, type, direction, source, date, related_doi, raw_count }) => (
          { dedupe_key: key, type, direction, source, date, notice_doi: related_doi, raw_count })),
        other_updates: d.rel.all.filter((r) => !r.is_retraction_of_this_work)
          .map(({ type, direction, source, date, related_doi }) => ({ type, direction, source, date, related_doi })),
      } : null,
      kept_previous_status: !d && res.after === res.before ? true : undefined,
    };
  }

  // 검증 1건 (공용 경로). fresh=true 면 cache 를 우회한다.
  async function verifyRow(row, { fresh }) {
    const doiLower = row.input_doi.toLowerCase();
    const cacheBefore = getCache(doiLower);
    const acq = await acquire(doiLower, { fresh });
    const res = tx(db, () => apply(getRow(row.id), acq, doiLower, cacheBefore));
    return { acq, res, evidence: evidenceView(getRow(row.id)) };
  }

  // POST /api/evidence
  async function registerEvidence(body = {}) {
    const doi = normalizeDoi(body.doi);
    if (!doi) throw new EvidenceError(400, 'BAD_DOI', 'doi 형식이 올바르지 않습니다 (예: 10.1038/nature14539)');
    const authors = Array.isArray(body.authors) ? body.authors.map(String).map((s) => s.trim()).filter(Boolean)
      : (typeof body.authors === 'string' ? body.authors.split(';').map((s) => s.trim()).filter(Boolean) : []);
    let year = null;
    if (body.year != null && body.year !== '') {
      year = Number(body.year);
      if (!Number.isInteger(year)) throw new EvidenceError(400, 'BAD_YEAR', 'year 는 정수여야 합니다');
    }
    const title = typeof body.title === 'string' && body.title.trim() ? body.title.trim() : null;
    const input = { title, authors, year, is_demo_corrupted: body.is_demo_corrupted === true };
    const { row } = findOrCreateRow(doi.toLowerCase(), input);
    const { acq, res, evidence } = await verifyRow(row, { fresh: false });
    return { evidence, lookup: lookupView(acq), flagged_judgment_ids: res.flagged, ...detailView(res) };
  }

  // POST /api/recheck — 항상 fresh (cache 우회)
  async function recheck(body = {}) {
    let ids;
    if (body.evidence_ids == null) ids = db.prepare('SELECT id FROM evidence ORDER BY id').all().map((r) => r.id);
    else if (Array.isArray(body.evidence_ids) && body.evidence_ids.every(Number.isInteger)) {
      ids = body.evidence_ids;
      for (const id of ids) if (!getRow(id)) throw new EvidenceError(404, 'EVIDENCE_NOT_FOUND', `evidence ${id} 없음`);
    } else throw new EvidenceError(400, 'BAD_IDS', 'evidence_ids 는 정수 배열이어야 합니다');

    const rechecked_at = now();
    const results = [];
    for (const id of ids) {
      const { acq, res, evidence } = await verifyRow(getRow(id), { fresh: true });
      results.push({
        evidence_id: id, before: res.before, after: res.after,
        lookup: lookupView(acq),
        latest_check_failed: evidence.latest_check_failed,
        flagged_judgment_ids: res.flagged,
        ...detailView(res),
      });
    }
    return {
      rechecked_at, checked: results.length, results,
      flagged_judgment_ids: [...new Set(results.flatMap((r) => r.flagged_judgment_ids))].sort((a, b) => a - b),
    };
  }

  // GET /api/evidence/:id/judgments — 역조회
  function judgmentsOf(id) {
    if (!getRow(id)) throw new EvidenceError(404, 'EVIDENCE_NOT_FOUND', `evidence ${id} 없음`);
    const rows = db.prepare(`SELECT j.* FROM judgment j JOIN evidence_judgment_link l ON l.judgment_id = j.id
      WHERE l.evidence_id = ? ORDER BY j.id`).all(id);
    return { evidence_id: id, judgments: rows.map((r) => judgmentView(db, r)) };
  }

  // baseline 사전 조회: 일반 조회 경로(registerEvidence)와 동일 로직. exclude / live_unseeded 는 조회하지 않는다.
  async function prewarm({ exclude = [], samplesFile = SAMPLES_FILE } = {}) {
    const samples = JSON.parse(fs.readFileSync(samplesFile, 'utf8')).samples;
    const excluded = new Set(exclude.map((d) => String(d).toLowerCase()));
    const registered = []; const skipped = []; const failed = [];
    for (const s of samples) {
      const doiLower = s.input_doi.toLowerCase();
      if (!GENERAL_SAMPLE_KEYS.includes(s.key) || excluded.has(doiLower)) { skipped.push(s.input_doi); continue; }
      const out = await registerEvidence({
        doi: s.input_doi, title: s.input_title, authors: s.input_authors, year: s.input_year, is_demo_corrupted: s.is_demo_corrupted === true,
      });
      registered.push({
        key: s.key, evidence_id: out.evidence.id, status: out.evidence.status,
        expected_status: s.expected_status, matches_expected: out.evidence.status === s.expected_status,
        lookup_outcome: out.lookup.outcome, fetched_at: out.lookup.fetched_at,
      });
      // 조회 실패 상태를 baseline 에 굳히지 않는다
      if (out.lookup.outcome === 'failed') failed.push(`${s.key}: ${out.lookup.error}`);
    }
    if (failed.length) throw new EvidenceError(502, 'PREWARM_FAILED', `baseline 사전 조회 실패 — ${failed.join('; ')}`);
    return { registered, skipped };
  }

  return { registerEvidence, recheck, judgmentsOf, prewarm };
}

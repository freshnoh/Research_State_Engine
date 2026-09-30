// EVIDENCE live 통합 검증 — 실제 Crossref 호출 (npm test 대상 아님: *.test.js 가 아님).
//   node --disable-warning=ExperimentalWarning test/evidence/live-crossref.js [--base http://127.0.0.1:4102]
// 실행 중인 자기 checkout 서버(PORT/DB_PATH 는 .env.local)에 HTTP 로 요청하고, 같은 DB_PATH 를 읽어 실제 값을 대조한다.
// 전제: npm run baseline:restore 직후 상태. 결과 요약은 stdout JSON, raw 전문은 출력하지 않는다.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ROOT, loadConfig } from '../../src/config.js';

const cfg = loadConfig();
const base = process.argv.includes('--base') ? process.argv[process.argv.indexOf('--base') + 1] : `http://127.0.0.1:${cfg.port}`;
const samples = JSON.parse(fs.readFileSync(path.join(ROOT, 'fixtures', 'evidence', 'samples.json'), 'utf8')).samples;
const S = (k) => samples.find((s) => s.key === k);
const RETRACTED_DOI = S('retracted').input_doi;
const db = new DatabaseSync(cfg.dbPath, { readOnly: true });
const q = (sql, ...a) => db.prepare(sql).all(...a);

const checks = [];
const check = (name, expected, actual, pass = JSON.stringify(expected) === JSON.stringify(actual)) => {
  checks.push({ name, expected, actual, pass });
};
const call = async (method, p, body) => {
  const r = await fetch(base + p, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json() };
};

// ── baseline 상태 (버튼 전)
const ev0 = q('SELECT * FROM evidence WHERE lower(input_doi)=?', RETRACTED_DOI)[0];
const links0 = q('SELECT j.* FROM judgment j JOIN evidence_judgment_link l ON l.judgment_id=j.id WHERE l.evidence_id=?', ev0?.id);
check('baseline Aβ*56 status', 'verified', ev0?.status);
check('baseline 판단 link 수 ≥1 / needs_review=0', [true, 0], [links0.length >= 1, links0[0]?.needs_review]);
check('baseline 철회 논문 cache 0', 0, q('SELECT COUNT(*) n FROM crossref_cache WHERE lower(doi)=?', RETRACTED_DOI)[0].n);
check('baseline live_unseeded cache 0', 0, q('SELECT COUNT(*) n FROM crossref_cache WHERE lower(doi)=?', S('live_unseeded').input_doi.toLowerCase())[0].n);
const pre = Object.fromEntries(['normal', 'corrupted', 'unverifiable'].map((k) => [k, q('SELECT status, unverifiable_reason FROM evidence WHERE lower(input_doi)=? ORDER BY id LIMIT 1', S(k).input_doi.toLowerCase())[0]]));
check('prewarm normal=verified', 'verified', pre.normal?.status);
check('prewarm corrupted=mismatch', 'mismatch', pre.corrupted?.status);
check('prewarm unverifiable=unverifiable/not_found', ['unverifiable', 'not_found'], [pre.unverifiable?.status, pre.unverifiable?.unverifiable_reason]);

// ── G3: 일반 조회 cache_hit, live_unseeded fresh
const n1 = await call('POST', '/api/evidence', { doi: S('normal').input_doi, title: S('normal').input_title, authors: S('normal').input_authors, year: S('normal').input_year });
check('normal 재조회 → verified / cache_hit', ['verified', 'cache_hit'], [n1.body.evidence?.status, n1.body.lookup?.mode]);
const lu = await call('POST', '/api/evidence', { doi: S('live_unseeded').input_doi });
check('live_unseeded → verified / fresh / HTTP 200', ['verified', 'fresh', 200], [lu.body.evidence?.status, lu.body.lookup?.mode, lu.body.lookup?.http_status]);
check('live_unseeded DOI만 → 서지 일치 주장 안 함', [true, false], [lu.body.comparison?.record_confirmed_only, lu.body.comparison?.bibliographic_match_claimed]);

// ── G4: [지금 재검사]
const logBefore = q("SELECT COUNT(*) n FROM crossref_lookup_log WHERE lower(doi)=? AND mode='fresh'", RETRACTED_DOI)[0].n;
const rc = await call('POST', '/api/recheck', {});
const r = rc.body.results?.find((x) => x.evidence_id === ev0?.id);
const logAfter = q("SELECT COUNT(*) n FROM crossref_lookup_log WHERE lower(doi)=? AND mode='fresh'", RETRACTED_DOI)[0].n;
check('recheck HTTP 200', 200, rc.status);
check('recheck 전 결과 fresh', true, rc.body.results?.every((x) => x.lookup.mode === 'fresh'));
check('Aβ*56 현재 Crossref HTTP 200 / ok', [200, true], [r?.lookup?.http_status, r?.lookup?.ok]);
check('Aβ*56 before→after', ['verified', 'retracted'], [r?.before, r?.after]);
check('lookup_log fresh +1', 1, logAfter - logBefore);
const ev1 = q('SELECT * FROM evidence WHERE id=?', ev0?.id)[0];
check('DB retraction type/direction', ['retraction', 'updated-by'], [ev1?.retraction_type, ev1?.retraction_direction]);
check('DB retraction source/notice/date 존재', true, !!(ev1?.retraction_source && ev1?.retraction_notice_doi && ev1?.retraction_date));
const flagged = q('SELECT id, needs_review, review_reason, review_flagged_at, proposal FROM judgment WHERE id IN (' + links0.map(() => '?').join(',') + ')', ...links0.map((j) => j.id));
check('연결 판단 전부 needs_review=1', true, flagged.length > 0 && flagged.every((j) => j.needs_review === 1));
check('review_reason / review_flagged_at 저장', true, flagged.every((j) => j.review_reason && j.review_flagged_at));
check('proposal 불변', links0.map((j) => j.proposal), flagged.map((j) => j.proposal));
check('응답 flagged_judgment_ids = 연결 판단', links0.map((j) => j.id).sort(), [...(r?.flagged_judgment_ids ?? [])].sort());
const back = await call('GET', `/api/evidence/${ev0?.id}/judgments`);
check('역조회 API needs_review=true', true, back.body.judgments?.length > 0 && back.body.judgments.every((j) => j.needs_review === true));
const others = rc.body.results?.filter((x) => x.evidence_id !== ev0?.id).map((x) => [x.before, x.after]);
check('다른 근거 상태 변화 없음', true, others.every(([b, a]) => b === a));
check('철회 표시 dedupe 후 1건', 1, r?.relations?.retraction?.length);

const summary = {
  base, db_path: cfg.dbPath, rechecked_at: rc.body.rechecked_at,
  nature04533: {
    doi: RETRACTED_DOI, before: r?.before, after: r?.after, http_status: r?.lookup?.http_status, mode: r?.lookup?.mode,
    relation_type: ev1?.retraction_type, direction: ev1?.retraction_direction, source: ev1?.retraction_source,
    date: ev1?.retraction_date, notice_doi: ev1?.retraction_notice_doi,
    relation_counts: r?.relations?.counts, retraction_deduped: r?.relations?.retraction, other_updates: r?.relations?.other_updates,
    flagged_judgment_ids: r?.flagged_judgment_ids,
    review_reason: flagged[0]?.review_reason, review_flagged_at: flagged[0]?.review_flagged_at,
  },
  live_unseeded: { doi: S('live_unseeded').input_doi, status: lu.body.evidence?.status, cr_title: lu.body.evidence?.crossref?.title, mode: lu.body.lookup?.mode },
  passed: checks.filter((c) => c.pass).length, total: checks.length,
  checks,
};
console.log(JSON.stringify(summary, null, 2));
process.exitCode = summary.passed === summary.total && summary.total > 0 ? 0 : 1;

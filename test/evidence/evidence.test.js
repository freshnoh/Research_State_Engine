// EVIDENCE 단위 테스트 — 네트워크 비의존.
// Crossref 응답은 fixtures/evidence/recorded/ 의 녹화본(2026-09-30 실제 응답)과, 그것을 변형한 주입 응답만 쓴다.
// 변형(synthetic) 응답은 테스트 안에서만 만들며 live 관측으로 보고하지 않는다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { ROOT, loadConfig } from '../../src/config.js';
import { openDb } from '../../src/db/index.js';
import { loadSeed } from '../../src/core/seed.js';
import { createApp } from '../../src/app.js';
import {
  createEvidenceService, prewarmBaselineCache, extractRelations, normalizeTitle, decideFromMessage,
} from '../../src/evidence/index.js';

const REC = path.join(ROOT, 'fixtures', 'evidence', 'recorded');
const rec = (f) => fs.readFileSync(path.join(REC, f), 'utf8');
const msg = (f) => JSON.parse(rec(f)).message;
const clone = (o) => JSON.parse(JSON.stringify(o));
const SAMPLES = JSON.parse(fs.readFileSync(path.join(ROOT, 'fixtures', 'evidence', 'samples.json'), 'utf8')).samples;
const sample = (k) => SAMPLES.find((s) => s.key === k);

const ABETA = '10.1038/nature04533';
const NORMAL = sample('normal');
const CORRUPT = sample('corrupted');
const UNVER = sample('unverifiable');

// 녹화 응답 표
const RECORDED = {
  '10.1038/nature04533': { status: 200, body: rec('nature04533.json') },
  '10.1038/nature14539': { status: 200, body: rec('nature14539.json') },
  '10.1016/j.cell.2006.07.024': { status: 200, body: rec('cell.2006.07.024.json') },
  '10.99999/rse.demo.2026.0001': { status: 404, body: rec('rse.demo.404.txt') },
  '10.1038/s41586-024-07691-8': { status: 200, body: rec('s41586-024-07691-8.json') },
};

// 철회 이전 시점 응답 (녹화본에서 retraction relation 만 제거 — 테스트 전용 합성)
function preRetractionAbeta() {
  const m = clone(msg('nature04533.json'));
  m['updated-by'] = m['updated-by'].filter((u) => u.type !== 'retraction');
  return JSON.stringify({ status: 'ok', message: m });
}
function abetaWithUpdatedBy(list) {
  const m = clone(msg('nature04533.json'));
  m['updated-by'] = list;
  return JSON.stringify({ status: 'ok', message: m });
}

function doiFromUrl(u) {
  const p = new URL(u).pathname.replace(/^\/works\//, '');
  return decodeURIComponent(p).toLowerCase();
}

// 주입 fetch: table[doi] = {status, body} | 'fail' | 'timeout'
function mockFetch(table) {
  const calls = [];
  const fn = async (url) => {
    const doi = doiFromUrl(url);
    calls.push({ url, doi });
    const r = table[doi];
    if (r === 'fail' || r === undefined) throw new TypeError('fetch failed');
    if (r === 'timeout') { const e = new Error('The operation was aborted due to timeout'); e.name = 'TimeoutError'; throw e; }
    return { status: r.status, text: async () => r.body };
  };
  fn.calls = calls;
  fn.count = (doi) => calls.filter((c) => c.doi === doi).length;
  return fn;
}

const CONFIG = { ...loadConfig({ CROSSREF_BASE_URL: 'http://crossref.test', CROSSREF_MAILTO: '' }), crossrefTimeoutMs: 2000 };

function freshDb({ seed = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rse-ev-'));
  const db = openDb(path.join(dir, 'rse.db'));
  if (seed) loadSeed(db);
  return db;
}
const svcOf = (db, table, config = CONFIG) => {
  const f = mockFetch(table);
  return { svc: createEvidenceService({ db, config, fetch: f }), f };
};
const row = (db, id) => db.prepare('SELECT * FROM evidence WHERE id=?').get(id);
const abetaRow = (db) => db.prepare('SELECT * FROM evidence WHERE input_doi=?').get(ABETA);
const abetaJudgment = (db) => db.prepare(`SELECT j.* FROM judgment j JOIN evidence_judgment_link l ON l.judgment_id=j.id
  WHERE l.evidence_id=?`).get(abetaRow(db).id);
const body = (s) => ({ doi: s.input_doi, title: s.input_title, authors: s.input_authors, year: s.input_year, is_demo_corrupted: !!s.is_demo_corrupted });

// ───────────────────────── G3 ─────────────────────────

test('G3 정상 DOI + 일치 서지 → verified (fresh, raw cache 보존, 조회 시각)', async () => {
  const db = freshDb();
  const { svc } = svcOf(db, RECORDED);
  const out = await svc.registerEvidence(body(NORMAL));
  assert.equal(out.evidence.status, 'verified');
  assert.equal(out.lookup.mode, 'fresh');
  assert.equal(out.lookup.fresh, true);
  assert.equal(out.lookup.cache_hit, false);
  assert.ok(out.lookup.fetched_at);
  assert.deepEqual(out.comparison.compared_fields, ['title', 'authors', 'year']);
  assert.equal(out.comparison.bibliographic_match_claimed, true);
  assert.equal(out.evidence.crossref.title, 'Deep learning');
  assert.equal(out.evidence.last_attempt_ok, true);
  assert.ok(out.evidence.last_success_at);
  const c = db.prepare('SELECT * FROM crossref_cache WHERE doi=?').get('10.1038/nature14539');
  assert.equal(c.raw_json, RECORDED['10.1038/nature14539'].body); // raw 전문 보존
});

test('G3 정상 DOI + 명백히 무관한 제목(저자·연도 유지) → mismatch, 행 보존', async () => {
  const db = freshDb();
  const { svc } = svcOf(db, RECORDED);
  const out = await svc.registerEvidence(body(CORRUPT));
  assert.equal(out.evidence.status, 'mismatch');
  assert.deepEqual(out.evidence.mismatch_fields, ['title']);
  assert.equal(out.comparison.fields.authors, 'match');
  assert.equal(out.comparison.fields.year, 'match');
  assert.equal(out.evidence.is_demo_corrupted, true);
  assert.equal(out.evidence.usable_as_verified, false);
  assert.match(out.evidence.excluded_reason, /서지 불일치/);
  assert.ok(row(db, out.evidence.id)); // 삭제하지 않음
});

test('G3 대소문자·공백·문장부호·저자 표기 차이 → 정규화 후 verified', async () => {
  const db = freshDb();
  const { svc } = svcOf(db, RECORDED);
  const a = await svc.registerEvidence({ doi: ' 10.1038/NATURE14539 ', title: '  DEEP   learning. ', authors: ['Yann LeCun', 'bengio, Y.'], year: '2015' });
  assert.equal(a.evidence.status, 'verified');
  const b = await svc.registerEvidence({
    doi: CORRUPT.input_doi,
    title: 'induction of pluripotent stem-cells from mouse embryonic and adult fibroblast cultures, by defined factors!',
    authors: ['TAKAHASHI'], year: 2006,
  });
  assert.equal(b.evidence.status, 'verified');
  // 단어 자체가 다르면 정규화로 같게 만들지 않는다 ('&' ≠ 'and')
  const c = await svc.registerEvidence({ doi: CORRUPT.input_doi, title: 'Induction of Pluripotent Stem Cells from Mouse Embryonic & Adult Fibroblast Cultures by Defined Factors' });
  assert.equal(c.evidence.status, 'mismatch');
});

test('G3 RETRACTED ARTICLE: 접두사는 비교에서만 제거, Crossref 원본 제목은 보존', () => {
  assert.equal(normalizeTitle('RETRACTED ARTICLE: A specific amyloid-β protein assembly in the brain impairs memory'),
    normalizeTitle('A specific amyloid-β protein assembly in the brain impairs memory'));
  const d = decideFromMessage({ title: 'A specific amyloid-β protein assembly in the brain impairs memory' }, msg('nature04533.json'));
  assert.equal(d.meta.title.startsWith('RETRACTED ARTICLE:'), true);
  assert.equal(d.cmp.fields.title, 'match');
});

test('G3 Crossref 404 → unverifiable/not_found, 부재 표현 없음', async () => {
  const db = freshDb();
  const { svc } = svcOf(db, RECORDED);
  const out = await svc.registerEvidence(body(UNVER));
  assert.equal(out.evidence.status, 'unverifiable');
  assert.equal(out.evidence.unverifiable_reason, 'not_found');
  assert.equal(out.lookup.ok, true);
  assert.equal(out.lookup.http_status, 404);
  const text = JSON.stringify(out);
  for (const w of ['논문 없음', '가짜 논문', '존재하지 않음', '존재하지 않는']) assert.equal(text.includes(w), false, w);
});

test('G3 비교 필드 부족 → unverifiable/insufficient_fields', async () => {
  const db = freshDb();
  const bare = JSON.stringify({ status: 'ok', message: { DOI: '10.5555/bare.1', title: [], author: [] } });
  const { svc } = svcOf(db, { '10.5555/bare.1': { status: 200, body: bare } });
  const out = await svc.registerEvidence({ doi: '10.5555/bare.1', title: 'Some title', year: 2020 });
  assert.equal(out.evidence.status, 'unverifiable');
  assert.equal(out.evidence.unverifiable_reason, 'insufficient_fields');
});

test('G3 DOI 만 입력 → 레코드 확인만 (서지 일치 주장 없음)', async () => {
  const db = freshDb();
  const { svc } = svcOf(db, RECORDED);
  const out = await svc.registerEvidence({ doi: NORMAL.input_doi });
  assert.equal(out.evidence.status, 'verified');
  assert.equal(out.comparison.record_confirmed_only, true);
  assert.equal(out.comparison.bibliographic_match_claimed, false);
  assert.equal(out.evidence.crossref.title, 'Deep learning');
});

test('G3 최초 조회 실패(과거·cache 없음) → unverifiable/lookup_failed + 실패 기록', async () => {
  const db = freshDb();
  const { svc } = svcOf(db, { '10.1038/nature14539': 'fail' });
  const out = await svc.registerEvidence(body(NORMAL));
  assert.equal(out.evidence.status, 'unverifiable');
  assert.equal(out.evidence.unverifiable_reason, 'lookup_failed');
  assert.equal(out.lookup.ok, false);
  const r = row(db, out.evidence.id);
  assert.equal(r.last_attempt_ok, 0);
  assert.ok(r.last_error);
  assert.ok(r.last_attempt_at);
  assert.equal(r.last_success_at, null);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM crossref_cache').get().n, 0); // 실패는 cache 하지 않음
});

test('G3 기존 verified + 최신 timeout → verified 유지, 실패 metadata 별도, 마지막 정상 시각 유지', async () => {
  const db = freshDb();
  const ok = svcOf(db, RECORDED);
  const first = await ok.svc.registerEvidence(body(NORMAL));
  const before = row(db, first.evidence.id);
  const bad = svcOf(db, { '10.1038/nature14539': 'timeout' });
  const rc = await bad.svc.recheck({ evidence_ids: [first.evidence.id] });
  const after = row(db, first.evidence.id);
  assert.equal(rc.results[0].after, 'verified');
  assert.equal(after.status, 'verified');
  assert.equal(after.unverifiable_reason, null);
  assert.equal(after.last_attempt_ok, 0);
  assert.match(after.last_error, /timeout/);
  assert.equal(after.last_success_at, before.last_success_at);
  assert.notEqual(after.last_attempt_at, null);
  assert.equal(rc.results[0].latest_check_failed, true);
  assert.equal(rc.results[0].lookup.mode, 'fresh');
  // cache 는 마지막 정상 응답 그대로
  assert.equal(db.prepare('SELECT raw_json FROM crossref_cache WHERE doi=?').get('10.1038/nature14539').raw_json, RECORDED['10.1038/nature14539'].body);
});

test('G3 기존 verified + 최신 404 → verified 유지 (조회 실패 ≠ 부재)', async () => {
  const db = freshDb();
  const first = await svcOf(db, RECORDED).svc.registerEvidence(body(NORMAL));
  await svcOf(db, { '10.1038/nature14539': { status: 404, body: 'Resource not found.' } }).svc.recheck({ evidence_ids: [first.evidence.id] });
  const r = row(db, first.evidence.id);
  assert.equal(r.status, 'verified');
  assert.equal(r.last_attempt_ok, 0);
  assert.equal(db.prepare('SELECT http_status FROM crossref_cache WHERE doi=?').get('10.1038/nature14539').http_status, 200);
});

test('G3 seed Aβ*56(과거 확인) + 최신 조회 실패 → verified 유지, 재검토 표시 없음', async () => {
  const db = freshDb();
  const { svc } = svcOf(db, { [ABETA]: 'fail' });
  const id = abetaRow(db).id;
  const rc = await svc.recheck({ evidence_ids: [id] });
  assert.deepEqual([rc.results[0].before, rc.results[0].after], ['verified', 'verified']);
  assert.equal(abetaRow(db).last_attempt_ok, 0);
  assert.equal(abetaRow(db).last_success_at, '2022-03-15T10:00:00+09:00');
  assert.equal(abetaJudgment(db).needs_review, 0);
  assert.deepEqual(rc.flagged_judgment_ids, []);
});

// ───────────────────────── cache / fresh ─────────────────────────

test('cache: 일반 조회는 cache_hit, [지금 재검사]는 항상 fresh (lookup_log 로 증명)', async () => {
  const db = freshDb();
  const { svc, f } = svcOf(db, RECORDED);
  const a = await svc.registerEvidence(body(NORMAL));
  const b = await svc.registerEvidence(body(NORMAL));
  assert.equal(a.lookup.mode, 'fresh');
  assert.equal(b.lookup.mode, 'cache_hit');
  assert.equal(b.lookup.cache_hit, true);
  assert.equal(b.evidence.id, a.evidence.id); // 같은 입력은 같은 행
  assert.equal(f.count('10.1038/nature14539'), 1);
  const rc = await svc.recheck({ evidence_ids: [a.evidence.id] });
  assert.equal(rc.results[0].lookup.mode, 'fresh');
  assert.equal(f.count('10.1038/nature14539'), 2);
  const modes = db.prepare("SELECT mode FROM crossref_lookup_log WHERE doi='10.1038/nature14539' ORDER BY id").all().map((r) => r.mode);
  assert.deepEqual(modes, ['fresh', 'cache_hit', 'fresh']);
});

test('cache: recheck 는 이미 cache 된 Aβ*56 응답이 있어도 네트워크를 다시 조회', async () => {
  const db = freshDb();
  db.prepare('INSERT INTO crossref_cache (doi,http_status,raw_json,fetched_at) VALUES (?,200,?,?)').run(ABETA, preRetractionAbeta(), '2022-03-15T00:00:00Z');
  const { svc, f } = svcOf(db, RECORDED);
  const rc = await svc.recheck({ evidence_ids: [abetaRow(db).id] });
  assert.equal(f.count(ABETA), 1);
  assert.equal(rc.results[0].after, 'retracted'); // stale cache 가 아니라 현재 응답으로 판정
});

// ───────────────────────── G4 철회 / 소급 ─────────────────────────

test('G4 [지금 재검사]: seed verified → retracted, 역조회 판단 needs_review=1 + reason + flagged_at', async () => {
  const db = freshDb();
  const j0 = abetaJudgment(db);
  assert.equal(abetaRow(db).status, 'verified');
  assert.equal(j0.needs_review, 0);
  const { svc, f } = svcOf(db, RECORDED);
  const rc = await svc.recheck({});
  const r = rc.results.find((x) => x.evidence_id === abetaRow(db).id);
  assert.deepEqual([r.before, r.after], ['verified', 'retracted']);
  assert.equal(r.lookup.mode, 'fresh');
  assert.equal(f.count(ABETA), 1);
  assert.deepEqual(r.flagged_judgment_ids, [j0.id]);
  assert.deepEqual(rc.flagged_judgment_ids, [j0.id]);
  const e = abetaRow(db);
  assert.equal(e.retraction_type, 'retraction');
  assert.equal(e.retraction_direction, 'updated-by');
  assert.equal(e.retraction_notice_doi, '10.1038/s41586-024-07691-8');
  assert.equal(e.retraction_date, '2024-06-24');
  assert.equal(e.retraction_source, 'publisher, retraction-watch');
  assert.equal(e.previous_status, 'verified');
  assert.ok(e.status_changed_at);
  const j = abetaJudgment(db);
  assert.equal(j.needs_review, 1);
  assert.equal(j.review_reason, '근거 상태 변경: 확인 → 철회됨');
  assert.ok(j.review_flagged_at);
  assert.equal(j.proposal, j0.proposal); // 판단 내용은 바꾸지 않는다
  for (const w of ['틀렸', '거짓', '잘못된 판단']) assert.equal(j.review_reason.includes(w), false);
  // 두 번째 재검사: 이미 철회 → 새 표시 없음
  const rc2 = await svc.recheck({ evidence_ids: [e.id] });
  assert.deepEqual([rc2.results[0].before, rc2.results[0].after], ['retracted', 'retracted']);
  assert.deepEqual(rc2.flagged_judgment_ids, []);
  assert.equal(abetaJudgment(db).review_flagged_at, j.review_flagged_at);
});

test('G4 역조회: judgmentsOf(evidence) → 연결 판단 (needs_review 반영)', async () => {
  const db = freshDb();
  const { svc } = svcOf(db, RECORDED);
  const id = abetaRow(db).id;
  const before = svc.judgmentsOf(id);
  assert.equal(before.judgments.length, 1);
  assert.equal(before.judgments[0].needs_review, false);
  await svc.recheck({ evidence_ids: [id] });
  const after = svc.judgmentsOf(id);
  assert.equal(after.judgments[0].needs_review, true);
  assert.equal(after.judgments[0].evidence[0].status, 'retracted');
  assert.throws(() => svc.judgmentsOf(99999), /없음/);
});

test('G4 dedupe: 같은 철회(retraction-watch + publisher) 원본 2 → 사용자 표시 1, raw 보존', () => {
  const rel = extractRelations(msg('nature04533.json'));
  assert.equal(rel.counts.retraction_raw, 2);
  assert.equal(rel.counts.retraction_deduped, 1);
  assert.equal(rel.retraction[0].raw_count, 2);
  assert.deepEqual(rel.retraction[0].sources, ['publisher', 'retraction-watch']);
  assert.equal(rel.retraction_raw.every((r) => r.raw && r.raw.type === 'retraction'), true);
});

test('G4 correction 은 철회 아님', () => {
  const m = JSON.parse(abetaWithUpdatedBy([{ DOI: '10.1038/x-corr', type: 'correction', source: 'publisher', updated: { 'date-parts': [[2010, 1, 2]] } }])).message;
  const d = decideFromMessage({ title: 'A specific amyloid-β protein assembly in the brain impairs memory' }, m);
  assert.equal(d.rel.primary, null);
  assert.equal(d.status, 'verified');
  assert.equal(d.rel.counts.non_retraction, 2); // correction + update-to(EoC)
});

test('G4 expression_of_concern 은 철회 아님 (철회 이전 시점 응답 → verified 유지)', async () => {
  const db = freshDb();
  const { svc } = svcOf(db, { [ABETA]: { status: 200, body: preRetractionAbeta() } });
  const rc = await svc.recheck({ evidence_ids: [abetaRow(db).id] });
  assert.deepEqual([rc.results[0].before, rc.results[0].after], ['verified', 'verified']);
  assert.equal(abetaJudgment(db).needs_review, 0);
  assert.equal(rc.results[0].relations.other_updates.some((u) => u.type === 'expression_of_concern'), true);
});

test('G4 방향: 철회 notice(update-to=retraction) 자체는 철회된 work 가 아니다', async () => {
  const rel = extractRelations(msg('s41586-024-07691-8.json'));
  assert.equal(rel.counts.all, 2);
  assert.equal(rel.all.every((r) => r.direction === 'update-to' && r.type === 'retraction'), true);
  assert.equal(rel.primary, null);
  const db = freshDb();
  const out = await svcOf(db, RECORDED).svc.registerEvidence({ doi: '10.1038/s41586-024-07691-8' });
  assert.equal(out.evidence.status, 'verified');
  assert.equal(out.evidence.retraction, null);
});

test('G4 withdrawal 유형도 철회 계열, update-to 방향의 retraction 은 제외', () => {
  const m = JSON.parse(abetaWithUpdatedBy([{ DOI: '10.1/w', type: 'withdrawal', source: 'publisher', updated: { 'date-parts': [[2020, 5, 1]] } }])).message;
  assert.equal(extractRelations(m).primary.type, 'withdrawal');
  const m2 = clone(m); m2['updated-by'] = []; m2['update-to'] = [{ DOI: '10.1/other', type: 'retraction', source: 'publisher' }];
  assert.equal(extractRelations(m2).primary, null);
});

test('G4 철회 > 서지 불일치: 서지가 틀려도 retracted, mismatch_fields 는 보존', async () => {
  const db = freshDb();
  const out = await svcOf(db, RECORDED).svc.registerEvidence({ doi: ABETA, title: 'Totally unrelated title about graphene', authors: ['Lesné'], year: 2006 });
  assert.equal(out.evidence.status, 'retracted');
  assert.deepEqual(out.evidence.mismatch_fields, ['title']);
  assert.equal(out.comparison.fields.title, 'mismatch');
});

test('G4 DOI 하드코딩 없음: 같은 DOI 라도 retraction relation 이 없으면 retracted 아님', async () => {
  const db = freshDb();
  const noRel = abetaWithUpdatedBy([]);
  const out = await svcOf(db, { [ABETA]: { status: 200, body: noRel } }).svc.recheck({ evidence_ids: [abetaRow(db).id] });
  assert.equal(out.results[0].after, 'verified');
  const src = fs.readdirSync(path.join(ROOT, 'src', 'evidence')).map((f) => fs.readFileSync(path.join(ROOT, 'src', 'evidence', f), 'utf8')).join('\n');
  assert.equal(src.includes('nature04533'), false);
  assert.equal(src.includes('api.crossref.org'), false);
  assert.equal(/datacite|pubmed|ncbi|https:\/\/(?:dx\.)?doi\.org/i.test(src), false);
});

// ───────────────────────── prewarm ─────────────────────────

test('prewarmBaselineCache: normal/corrupted/unverifiable 만 등록, Aβ*56·live_unseeded 조회·cache 0', async () => {
  const db = freshDb();
  const f = mockFetch(RECORDED);
  const out = await prewarmBaselineCache(db, CONFIG, { exclude: [ABETA], fetch: f });
  assert.deepEqual(out.registered.map((r) => [r.key, r.status]), [['normal', 'verified'], ['corrupted', 'mismatch'], ['unverifiable', 'unverifiable']]);
  assert.deepEqual(out.skipped.sort(), [ABETA, sample('live_unseeded').input_doi].sort());
  assert.equal(f.count(ABETA), 0);
  assert.equal(f.count(sample('live_unseeded').input_doi), 0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM crossref_cache WHERE lower(doi)=?').get(ABETA).n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM crossref_cache WHERE lower(doi)=?').get(sample('live_unseeded').input_doi).n, 0);
  assert.equal(abetaRow(db).status, 'verified');
  assert.equal(abetaJudgment(db).needs_review, 0);
});

test('prewarmBaselineCache: exclude 가 비어도 retracted/live_unseeded 표본은 조회하지 않음', async () => {
  const db = freshDb();
  const f = mockFetch(RECORDED);
  await prewarmBaselineCache(db, CONFIG, { fetch: f });
  assert.equal(f.count(ABETA), 0);
  assert.equal(f.calls.length, 3);
});

test('prewarmBaselineCache: 조회 실패면 baseline 에 실패 상태를 굳히지 않고 오류', async () => {
  const db = freshDb();
  await assert.rejects(prewarmBaselineCache(db, CONFIG, { exclude: [ABETA], fetch: mockFetch({}) }), /PREWARM|사전 조회 실패/);
});

// ───────────────────────── HTTP 경로 (로컬 mock Crossref, config.crossrefBaseUrl) ─────────────────────────

function mockCrossrefServer(table) {
  const hits = [];
  const srv = http.createServer((req, res) => {
    const doi = decodeURIComponent(new URL(req.url, 'http://x').pathname.replace(/^\/works\//, '')).toLowerCase();
    hits.push({ doi, url: req.url });
    const r = table[doi];
    if (!r) { res.writeHead(404); res.end('Resource not found.'); return; }
    res.writeHead(r.status, { 'content-type': 'application/json' });
    res.end(r.body);
  });
  return new Promise((ok) => srv.listen(0, '127.0.0.1', () => ok({ srv, hits, url: `http://127.0.0.1:${srv.address().port}` })));
}
async function startApp(db, base, extra = {}) {
  const app = createApp({ db, CROSSREF_BASE_URL: base, CROSSREF_TIMEOUT_MS: '2000', ...extra });
  await new Promise((ok) => app.server.listen(0, '127.0.0.1', ok));
  const port = app.server.address().port;
  const call = async (method, p, b) => {
    const r = await fetch(`http://127.0.0.1:${port}${p}`, { method, headers: { 'content-type': 'application/json' }, body: b ? JSON.stringify(b) : undefined });
    return { status: r.status, body: await r.json() };
  };
  return { app, call, close: () => new Promise((ok) => app.server.close(ok)) };
}

test('HTTP: POST /api/evidence · POST /api/recheck · GET /api/evidence/:id/judgments (base URL = config, mailto 반영)', async () => {
  const cr = await mockCrossrefServer(RECORDED);
  const db = freshDb();
  const { call, close } = await startApp(db, cr.url, { CROSSREF_MAILTO: 'ops@example.org' });
  try {
    const a = await call('POST', '/api/evidence', body(NORMAL));
    assert.equal(a.status, 200);
    assert.deepEqual([a.body.evidence.status, a.body.lookup.mode], ['verified', 'fresh']);
    assert.match(cr.hits[0].url, /mailto=ops%40example\.org/);
    const c = await call('POST', '/api/evidence', body(CORRUPT));
    assert.equal(c.body.evidence.status, 'mismatch');
    const u = await call('POST', '/api/evidence', body(UNVER));
    assert.deepEqual([u.body.evidence.status, u.body.evidence.unverifiable_reason], ['unverifiable', 'not_found']);
    const bad = await call('POST', '/api/evidence', { doi: 'not-a-doi' });
    assert.deepEqual([bad.status, bad.body.error.code], [400, 'BAD_DOI']);

    const eid = abetaRow(db).id;
    const j0 = await call('GET', `/api/evidence/${eid}/judgments`);
    assert.deepEqual([j0.status, j0.body.judgments.length, j0.body.judgments[0].needs_review], [200, 1, false]);
    const rc = await call('POST', '/api/recheck', {});
    assert.equal(rc.status, 200);
    assert.equal(rc.body.checked, 4);
    const r = rc.body.results.find((x) => x.evidence_id === eid);
    assert.deepEqual([r.before, r.after, r.lookup.mode], ['verified', 'retracted', 'fresh']);
    assert.equal(rc.body.results.every((x) => x.lookup.mode === 'fresh'), true);
    const j1 = await call('GET', `/api/evidence/${eid}/judgments`);
    assert.equal(j1.body.judgments[0].needs_review, true);
    assert.equal(j1.body.judgments[0].review_reason, '근거 상태 변경: 확인 → 철회됨');
    const nf = await call('GET', '/api/evidence/99999/judgments');
    assert.equal(nf.status, 404);
  } finally { await close(); cr.srv.close(); }
});

test('HTTP 실패경로: 도달 불가 CROSSREF_BASE_URL → (A) 최초 lookup_failed (B) 기존 verified 유지 + 실패 기록', async () => {
  const cr = await mockCrossrefServer(RECORDED);
  const db = freshDb();
  // 정상 base 로 먼저 확인
  let s = await startApp(db, cr.url);
  const ok = await s.call('POST', '/api/evidence', body(NORMAL));
  await s.close(); cr.srv.close();
  assert.equal(ok.body.evidence.status, 'verified');
  // 도달 불가 주소로 재기동 (포트 9: discard, 로컬에 리스너 없음)
  s = await startApp(db, 'http://127.0.0.1:9');
  try {
    const a = await s.call('POST', '/api/evidence', { doi: '10.5555/never.seen.1', title: 'X' });
    assert.deepEqual([a.body.evidence.status, a.body.evidence.unverifiable_reason, a.body.lookup.ok], ['unverifiable', 'lookup_failed', false]);
    const b = await s.call('POST', '/api/recheck', { evidence_ids: [ok.body.evidence.id] });
    assert.deepEqual([b.body.results[0].before, b.body.results[0].after, b.body.results[0].lookup.ok], ['verified', 'verified', false]);
    const list = await s.call('GET', '/api/evidence');
    const ev = list.body.evidence.find((e) => e.id === ok.body.evidence.id);
    assert.deepEqual([ev.status, ev.latest_check_failed, ev.last_attempt_ok], ['verified', true, false]);
    assert.equal(ev.last_success_at, ok.body.evidence.last_success_at);
    assert.ok(ev.last_error);
  } finally { await s.close(); }
});

test('금지 표현: src/evidence 에 부재 단정 문구 없음', () => {
  const src = fs.readdirSync(path.join(ROOT, 'src', 'evidence')).map((f) => fs.readFileSync(path.join(ROOT, 'src', 'evidence', f), 'utf8')).join('\n');
  for (const w of ['논문 없음', '가짜 논문', '존재하지 않음', '존재하지 않는']) assert.equal(src.includes(w), false, w);
});

// 승인 게이트 backend. 승인 전에는 원본을 절대 건드리지 않는다.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../config.js';
import { nowIso } from '../db/index.js';
import { HttpError } from '../core/http.js';
import { classify } from './policy.js';

export const ORIGINAL_NAME = 'original_measurements.csv';
export const ORIGINAL_FIXTURE = path.join(ROOT, 'fixtures', 'approval', ORIGINAL_NAME);
export const REPLACEMENT_FIXTURE = path.join(ROOT, 'fixtures', 'approval', 'replacement_measurements.csv');

export const sha256File = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

export function originalPath(config) {
  return path.join(config.approvalDir, ORIGINAL_NAME);
}

// 원본 파일이 없을 때만 fixture 에서 만든다 (있으면 절대 덮어쓰지 않음)
export function ensureOriginal(config) {
  const p = originalPath(config);
  if (!fs.existsSync(p)) {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.copyFileSync(ORIGINAL_FIXTURE, p);
  }
  return p;
}

export function targetInfo(config) {
  const p = originalPath(config);
  const exists = fs.existsSync(p);
  const hash = exists ? sha256File(p) : null;
  return { path: p, exists, hash, hash_short: hash ? hash.slice(0, 8) : null };
}

// 원본을 읽기만 하는 독립 분석: 수치 열 요약 통계
function runAnalysis(config) {
  const p = ensureOriginal(config);
  const hashBefore = sha256File(p);
  const [header, ...rows] = fs.readFileSync(p, 'utf8').trim().split(/\r?\n/).map((l) => l.split(','));
  const col = header.indexOf('band_intensity');
  const xs = rows.map((r) => Number(r[col])).filter((x) => Number.isFinite(x));
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (xs.length - 1));
  const hashAfter = sha256File(p);
  return {
    input: path.basename(p), column: 'band_intensity', n: xs.length,
    mean: Number(mean.toFixed(4)), sd: Number(sd.toFixed(4)), cv: Number((sd / mean).toFixed(4)),
    min: Math.min(...xs), max: Math.max(...xs),
    original_unchanged: hashBefore === hashAfter, original_hash_short: hashAfter.slice(0, 8),
  };
}

export function requestAction(db, config, body = {}) {
  const rule = classify(body.action_type);
  const now = nowIso();
  if (!rule.requires_approval) {
    if (body.action_type !== 'run_analysis') {
      throw new HttpError(400, 'UNSUPPORTED_ACTION', `프로토타입 실행기 없음: ${body.action_type} (분류: 승인 불필요)`);
    }
    const description = body.description || '원본 측정값 요약 통계 분석 (band_intensity 평균·표준편차·CV)';
    let status = 'completed';
    let result;
    try { result = runAnalysis(config); } catch (e) { status = 'failed'; result = { error: e.message }; }
    const id = Number(db.prepare(`INSERT INTO action_run (action_type, description, rule_id, status, result, created_at, completed_at)
      VALUES (?,?,?,?,?,?,?)`).run(body.action_type, description, rule.rule_id, status, JSON.stringify(result), now, nowIso()).lastInsertRowid);
    return { status: 200, body: { requires_approval: false, rule, run: db.prepare('SELECT * FROM action_run WHERE id=?').get(id) } };
  }

  if (body.action_type !== 'overwrite_original') {
    throw new HttpError(400, 'UNSUPPORTED_ACTION', `프로토타입 실행기 없음: ${body.action_type} (분류: 승인 필요, ${rule.rule_id})`);
  }
  // 영향 대상 확인 + 승인 전 현재 hash 저장. 원본은 건드리지 않는다.
  const target = ensureOriginal(config);
  const hashBefore = sha256File(target);
  const payload = { replacement: path.relative(ROOT, REPLACEMENT_FIXTURE) };
  const description = body.description || `원본 측정 파일 ${ORIGINAL_NAME} 을 정규화 버전으로 덮어쓰기`;
  const id = Number(db.prepare(`INSERT INTO approval_action
    (action_type, description, reason, rule_id, target_path, payload, status, hash_before, created_at)
    VALUES (?,?,?,?,?,?,'pending',?,?)`).run(body.action_type, description, rule.reason, rule.rule_id, target,
    JSON.stringify(payload), hashBefore, now).lastInsertRowid);
  return { status: 202, body: { requires_approval: true, rule, approval: db.prepare('SELECT * FROM approval_action WHERE id=?').get(id) } };
}

function loadPending(db, id) {
  const a = db.prepare('SELECT * FROM approval_action WHERE id=?').get(Number(id));
  if (!a) throw new HttpError(404, 'NOT_FOUND', `approval ${id} 없음`);
  if (a.status !== 'pending') throw new HttpError(409, 'NOT_PENDING', `approval ${id} 상태=${a.status}`);
  return a;
}

export function approve(db, id) {
  const a = loadPending(db, id);
  const now = nowIso();
  const current = sha256File(a.target_path);
  if (current !== a.hash_before) {
    db.prepare("UPDATE approval_action SET status='failed', error=?, decided_at=? WHERE id=?")
      .run(`승인 대기 중 원본이 바뀜 (현재 ${current.slice(0, 8)} ≠ 요청 시 ${a.hash_before.slice(0, 8)}) — 실행 안 함`, now, a.id);
  } else {
    const { replacement } = JSON.parse(a.payload);
    fs.copyFileSync(path.join(ROOT, replacement), a.target_path);
    db.prepare("UPDATE approval_action SET status='approved', hash_after=?, decided_at=? WHERE id=?")
      .run(sha256File(a.target_path), now, a.id);
  }
  return db.prepare('SELECT * FROM approval_action WHERE id=?').get(a.id);
}

export function reject(db, id) {
  const a = loadPending(db, id);
  db.prepare("UPDATE approval_action SET status='rejected', decided_at=? WHERE id=?").run(nowIso(), a.id);
  return db.prepare('SELECT * FROM approval_action WHERE id=?').get(a.id);
}

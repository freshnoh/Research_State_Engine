// 시연 seed 적재 (INTEGRATOR 소유). 빈 DB 에만 적재한다. 기존 데이터를 덮어쓰지 않는다.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../config.js';
import { nowIso, tx } from '../db/index.js';

export const SEED_FILE = path.join(ROOT, 'fixtures', 'seed', 'seed.json');

export function loadSeed(db, file = SEED_FILE) {
  const seed = JSON.parse(fs.readFileSync(file, 'utf8'));
  const existing = db.prepare('SELECT COUNT(*) AS n FROM research_attempt').get().n
    + db.prepare('SELECT COUNT(*) AS n FROM evidence').get().n
    + db.prepare('SELECT COUNT(*) AS n FROM judgment').get().n;
  if (existing > 0) throw new Error(`seed 거부: DB가 비어 있지 않음 (rows=${existing})`);

  return tx(db, () => {
    const now = nowIso();
    const ids = { attempts: {}, evidence: {}, judgments: {} };
    const insA = db.prepare(`INSERT INTO research_attempt
      (raw_text, target_raw, target_norm, method_raw, method_norm, environment_raw, environment_norm,
       condition_raw, condition_norm, result, stop_stage_raw, stop_stage_norm, occurred_at, created_at,
       source, is_synthetic, extractor)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'seed', 1, 'seed')`);
    for (const a of seed.attempts) {
      ids.attempts[a.key] = Number(insA.run(a.raw_text, a.target_raw, a.target_norm, a.method_raw, a.method_norm,
        a.environment_raw, a.environment_norm, a.condition_raw, a.condition_norm, a.result,
        a.stop_stage_raw, a.stop_stage_norm, a.occurred_at, now).lastInsertRowid);
    }
    const insE = db.prepare(`INSERT INTO evidence
      (input_doi, input_title, input_authors, input_year, status, last_success_at, last_attempt_at,
       last_attempt_ok, is_demo_past_state, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
    for (const e of seed.evidence) {
      ids.evidence[e.key] = Number(insE.run(e.input_doi, e.input_title, JSON.stringify(e.input_authors ?? []),
        e.input_year ?? null, e.status, e.last_success_at ?? null, e.last_attempt_at ?? null,
        e.last_attempt_ok ?? null, e.is_demo_past_state ? 1 : 0, now, now).lastInsertRowid);
    }
    const insJ = db.prepare(`INSERT INTO judgment
      (question, asked_at, proposal, researcher_action, needs_review, is_synthetic, demo_label, created_at)
      VALUES (?,?,?,?,0,1,?,?)`);
    const insL = db.prepare('INSERT INTO evidence_judgment_link (judgment_id, evidence_id, created_at) VALUES (?,?,?)');
    const insJA = db.prepare('INSERT INTO judgment_attempt_link (judgment_id, attempt_id) VALUES (?,?)');
    for (const j of seed.judgments) {
      const jid = Number(insJ.run(j.question, j.asked_at, j.proposal, j.researcher_action, j.demo_label ?? null, now).lastInsertRowid);
      ids.judgments[j.key] = jid;
      for (const k of j.evidence_keys ?? []) insL.run(jid, ids.evidence[k], j.asked_at);
      for (const k of j.attempt_keys ?? []) insJA.run(jid, ids.attempts[k]);
    }
    return ids;
  });
}

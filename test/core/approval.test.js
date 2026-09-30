// G5 승인 게이트 검사 (HTTP 경유)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../../src/app.js';
import { classify } from '../../src/approval/policy.js';
import { sha256File, ORIGINAL_FIXTURE } from '../../src/approval/gate.js';

async function startApp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rse-g5-'));
  const app = createApp({ DB_PATH: path.join(dir, 'rse.db'), DATA_DIR: dir, APPROVAL_DIR: path.join(dir, 'approval') });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const call = async (method, p, body) => {
    const res = await fetch(base + p, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json() };
  };
  return { ...app, call, original: path.join(dir, 'approval', 'original_measurements.csv') };
}

test('policy: 가역 6종은 승인 불필요, 비가역 5종·미분류는 승인 필요', () => {
  for (const t of ['literature_search', 'run_analysis', 'copy_create', 'copy_modify', 'draft_write', 'state_save']) {
    assert.equal(classify(t).requires_approval, false, t);
  }
  for (const t of ['overwrite_original', 'delete_original', 'external_submit', 'device_command', 'permanent_delete_record', 'mystery', undefined]) {
    assert.equal(classify(t).requires_approval, true, String(t));
  }
  assert.equal(classify('mystery').rule_id, 'R-UNKNOWN');
});

test('G5: 덮어쓰기 요청 → 대기, 승인 전 원본 불변, 대기 중 독립 분석 완료, 승인 후에만 변경', async () => {
  const app = await startApp();
  try {
    const baseline = sha256File(ORIGINAL_FIXTURE);
    const req = await app.call('POST', '/api/actions', { action_type: 'overwrite_original' });
    assert.equal(req.status, 202);
    assert.equal(req.body.approval.status, 'pending');
    assert.equal(req.body.approval.hash_before, baseline);
    assert.equal(sha256File(app.original), baseline, '승인 전 원본 불변');

    const run = await app.call('POST', '/api/actions', { action_type: 'run_analysis' });
    assert.equal(run.status, 200);
    assert.equal(run.body.run.status, 'completed');
    assert.equal(run.body.run.result.n, 5);
    assert.equal(run.body.run.result.original_unchanged, true);
    const pending = (await app.call('GET', '/api/approvals')).body.approvals.filter((a) => a.status === 'pending');
    assert.equal(pending.length, 1, '분석 완료 시점에도 카드는 대기 중');
    assert.equal(sha256File(app.original), baseline);

    const ok = await app.call('POST', `/api/approvals/${req.body.approval.id}/approve`);
    assert.equal(ok.body.approval.status, 'approved');
    assert.notEqual(ok.body.approval.hash_after, baseline);
    assert.equal(ok.body.approval.hash_after, sha256File(app.original));
    assert.equal(ok.body.approval.hash_before_short, baseline.slice(0, 8));

    const again = await app.call('POST', `/api/approvals/${req.body.approval.id}/approve`);
    assert.equal(again.status, 409);
  } finally { app.server.close(); }
});

test('G5: 거절 → 원본 불변', async () => {
  const app = await startApp();
  try {
    const req = await app.call('POST', '/api/actions', { action_type: 'overwrite_original' });
    const before = sha256File(app.original);
    const rj = await app.call('POST', `/api/approvals/${req.body.approval.id}/reject`);
    assert.equal(rj.body.approval.status, 'rejected');
    assert.equal(rj.body.approval.hash_after, null);
    assert.equal(sha256File(app.original), before);
  } finally { app.server.close(); }
});

test('G5: 대기 중 원본이 바뀌면 승인해도 실행하지 않는다', async () => {
  const app = await startApp();
  try {
    const req = await app.call('POST', '/api/actions', { action_type: 'overwrite_original' });
    fs.appendFileSync(app.original, 'S-999,X,y,0,9\n');
    const tampered = sha256File(app.original);
    const ok = await app.call('POST', `/api/approvals/${req.body.approval.id}/approve`);
    assert.equal(ok.body.approval.status, 'failed');
    assert.equal(sha256File(app.original), tampered);
  } finally { app.server.close(); }
});

test('G5: 실행기 없는 유형은 400, 승인 필요 분류는 유지', async () => {
  const app = await startApp();
  try {
    const r = await app.call('POST', '/api/actions', { action_type: 'device_command' });
    assert.equal(r.status, 400);
    const c = await app.call('GET', '/api/actions/classify?action_type=device_command');
    assert.equal(c.body.requires_approval, true);
  } finally { app.server.close(); }
});

// 회귀: LLM 이 result 를 unknown/enum 밖으로 줘도 원문 흔적으로 결과를 정한다
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeFields, rulesExtract } from '../../src/capture/extract.js';

const LIVE = '오늘 후보 단백질 RSE-01을 세포 모델에서 Western blot으로 측정했고, 재현성 검증 단계에서 중단했습니다.';
const base = { target: 'RSE-01', method: 'Western blot', environment: '세포 모델', condition: null, stop_stage: '재현성 검증 단계' };

test('LLM result=unknown 이어도 "중단했습니다" → stopped', () => {
  assert.equal(sanitizeFields(LIVE, { ...base, result: 'unknown' }).result, 'stopped');
});

test('LLM result 가 enum 밖(한글 등)이면 원문 규칙 사용', () => {
  assert.equal(sanitizeFields(LIVE, { ...base, result: '중단' }).result, 'stopped');
  assert.equal(sanitizeFields(LIVE, { ...base, result: undefined }).result, 'stopped');
});

test('LLM 이 유효한 결과를 주면 그대로 사용', () => {
  assert.equal(sanitizeFields(LIVE, { ...base, result: 'stopped' }).result, 'stopped');
  assert.equal(sanitizeFields('RSE-02를 ELISA로 측정해 성공했다', { result: 'success' }).result, 'success');
});

test('발표 말투 "…단계에서 접었어요" → stopped (rules 경로 포함)', () => {
  const t = '오늘 RSE-01 세포에서 WB 해봤는데 또 재현성 검증 단계에서 접었어요.';
  assert.equal(sanitizeFields(t, { result: 'unknown' }).result, 'stopped');
  assert.equal(rulesExtract(t).fields.result, 'stopped');
});

test('LLM 이 target 에 환경을 붙이고 environment 를 비우면 원문 규칙으로 보정 (2026-09-30 실측 응답)', () => {
  const t = '오늘 RSE-01 세포에서 WB 해봤는데 또 재현성 검증 단계에서 접었어요.';
  const f = sanitizeFields(t, { target: 'RSE-01 세포', method: 'WB', environment: null, condition: null, result: 'stopped', stop_stage: '재현성 검증 단계' });
  assert.equal(f.target, 'RSE-01');
  assert.equal(f.environment, '세포');
  assert.equal(f.method, 'WB');
});

test('원문에 환경 표현이 없으면 environment 는 null 유지 (세포로 추측 금지)', () => {
  const t = 'RSE-01에서 Western blot 했는데 재현성 검증에서 중단했어요';
  const f = sanitizeFields(t, { target: 'RSE-01', method: 'Western blot', environment: null, result: 'stopped' });
  assert.equal(f.environment, null);
  assert.equal(f.target, 'RSE-01');
});

test('LLM 이 원문과 다른 대상을 주면 기존대로 폐기 (환각 차단 유지)', () => {
  const t = '오늘 RSE-01 세포에서 WB 해봤는데 재현성 검증 단계에서 중단했어요.';
  assert.equal(sanitizeFields(t, { target: 'RSE-99', result: 'stopped' }).target, null);
});

test('원문에 결과 흔적이 없으면 unknown 유지 (추측 금지)', () => {
  assert.equal(sanitizeFields('RSE-01을 Western blot으로 한 번 더 봤다', { result: 'unknown' }).result, 'unknown');
});

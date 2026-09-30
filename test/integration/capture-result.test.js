// INTEGRATOR 통합 회귀: LLM 이 result 를 unknown/enum 밖으로 줘도 원문 흔적으로 결과를 정한다
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeFields } from '../../src/capture/extract.js';

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

test('원문에 결과 흔적이 없으면 unknown 유지 (추측 금지)', () => {
  assert.equal(sanitizeFields('RSE-01을 Western blot으로 한 번 더 봤다', { result: 'unknown' }).result, 'unknown');
});

// CAPTURE 소유. 자연어 → 구조화 후보 추출 (raw 값만). 정규화·같은 접근 판정은 여기서 하지 않는다.
//   extractor 계약: async (text) => { fields: {target, method, environment, condition, result, stop_stage}, extractor }
//   fields 의 문자열은 모두 "원문에 실제로 나온 표현"이어야 하며, 없으면 null (추측 금지).
import { spawn } from 'node:child_process';
import os from 'node:os';
import { RESULTS } from './dict.js';

const compact = (s) => String(s).toLowerCase().replace(/[\s ]+/g, '');

// ── rules 추출기 (LLM 불가 시 deterministic fallback; 시연 계약 범위의 최소 구조화만) ──
const METHOD_RE = /Western\s*blot(?:ting)?|웨스턴\s*블[롯랏]|\bWB\b|q\s*PCR|정량\s*PCR|\bELISA\b/i;
const ENV_RE = /세포\s*모델|세포|시험관|in[\s-]?vitro|동물|마우스|쥐|임상|시뮬레이션|데이터셋/i;
const TARGET_RE = /\b([A-Za-z]{2,6})-?(\d{1,4})\b/g;
const DOSE_RE = /\d+(?:\.\d+)?\s*(?:[µμu]M|mM|nM|pM|mg\/kg|ng\/mL|[µμu]g\/mL|mg\/mL|시간|일|분)|\d+(?:\.\d+)?\s*(?:h|hr|d)\b/g;

function stopStageRaw(text) {
  const m = text.match(/([가-힣A-Za-z0-9 ]{2,20}?)\s*단계(?:에서|에|까지)/);
  if (m) return m[1].trim().split(/\s+/).slice(-2).join(' ');
  const b = text.match(/행동\s*검증/);
  return b ? b[0] : null;
}

function resultOf(text) {
  if (/중단|멈췄|멈춤|멈춰|접었/.test(text)) return 'stopped';
  if (/성공하지\s*(?:못|않)|실패/.test(text)) return 'failure';
  if (/부분(?:적)?/.test(text)) return 'partial';
  if (/성공/.test(text)) return 'success';
  return 'unknown';
}

export function rulesExtract(text) {
  const t = String(text);
  const targets = [...new Set([...t.matchAll(TARGET_RE)].map((m) => m[0].toUpperCase()))]
    .filter((c) => !/^(?:CV|HR)\d*$/.test(c));
  const doses = t.match(DOSE_RE);
  return {
    fields: {
      target: targets.length === 1 ? [...t.matchAll(TARGET_RE)].find((m) => m[0].toUpperCase() === targets[0])[0] : null,
      method: t.match(METHOD_RE)?.[0] ?? null,
      environment: t.match(ENV_RE)?.[0] ?? null,
      condition: doses ? doses.map((d) => d.trim()).join(', ') : null,
      result: resultOf(t),
      stop_stage: stopStageRaw(t),
    },
    extractor: 'rules',
  };
}

// ── LLM 응답 검증: 원문에 없는 값은 버린다 (환각 차단) ──
export function sanitizeFields(text, f) {
  const src = compact(text);
  const grounded = (v) => (typeof v === 'string' && v.trim() && src.includes(compact(v)) ? v.trim() : null);
  // LLM 이 결과를 못 뽑았거나(unknown) enum 밖 값을 주면 원문 키워드 규칙으로 결정한다 (INTEGRATOR 통합 수정:
  // 라이브 발화 "…중단했습니다" 가 간헐적으로 unknown 으로 저장된 관측 2026-09-30 19:50)
  const result = RESULTS.includes(f?.result) && f.result !== 'unknown' ? f.result : resultOf(String(text));
  return {
    target: grounded(f?.target),
    method: grounded(f?.method),
    environment: grounded(f?.environment),
    condition: grounded(f?.condition),
    result,
    stop_stage: grounded(f?.stop_stage?.replace?.(/\s*단계\s*$/, '')),
  };
}

// ── claude-cli 추출기 ──
const SYSTEM_PROMPT = [
  '너는 연구자 발화에서 값을 뽑는 추출기다. 판단·해석·추론을 하지 않는다.',
  '반드시 JSON 객체 하나만 출력한다. 설명, 코드펜스, 다른 텍스트 금지.',
  '키: target, method, environment, condition, result, stop_stage.',
  '- target/method/environment/condition/stop_stage: 발화에 실제로 나온 표현을 글자 그대로 복사한 문자열. 발화에 없으면 null. 추측 금지.',
  '- 조사(을/를/에서/으로 등)는 값에 포함하지 않는다.',
  '- result: success | partial | failure | stopped | unknown 중 하나. 발화에 결과 흔적이 없으면 unknown.',
  '- 같은 접근인지, 계획인지 질문인지는 판단하지 않는다.',
].join('\n');

export function parseCliOutput(stdout) {
  let outer;
  try { outer = JSON.parse(stdout); } catch { throw new Error('claude-cli stdout 이 JSON 이 아님'); }
  if (outer?.is_error) throw new Error(`claude-cli is_error: ${String(outer.result ?? '').slice(0, 200)}`);
  let body = typeof outer?.result === 'string' ? outer.result : null;
  if (body == null) throw new Error('claude-cli 응답에 result 없음');
  body = body.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const a = body.indexOf('{'); const b = body.lastIndexOf('}');
  if (a < 0 || b < a) throw new Error('claude-cli result 에 JSON 객체 없음');
  try { return JSON.parse(body.slice(a, b + 1)); } catch { throw new Error('claude-cli result JSON 파싱 실패'); }
}

// 실제 CLI 실행. 프롬프트는 stdin 으로 넘기고, cwd 는 임시 디렉터리(프로젝트 CLAUDE.md 자동 로드 방지).
export function runClaudeCli(text, { bin = 'claude', timeoutMs = 90000 } = {}) {
  return new Promise((resolve, reject) => {
    const args = ['-p', '--output-format', 'json', '--no-session-persistence', '--tools=', '--system-prompt', SYSTEM_PROMPT];
    const child = spawn(bin, args, { cwd: os.tmpdir(), stdio: ['pipe', 'pipe', 'pipe'] });
    let out = ''; let err = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`claude-cli timeout ${timeoutMs}ms`)); }, timeoutMs);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error(`claude-cli exit ${code}: ${err.slice(0, 200)}`));
      else resolve(out);
    });
    child.stdin.end(`발화:\n${text}`);
  });
}

// run: (text) => Promise<stdoutString>  — 테스트에서 fixture 주입
export function claudeCliExtractor({ run = runClaudeCli } = {}) {
  return async (text) => {
    const stdout = await run(text);
    const raw = parseCliOutput(stdout);
    return { fields: sanitizeFields(text, raw), extractor: 'llm:claude-cli' };
  };
}

export const rulesExtractor = () => async (text) => rulesExtract(text);

// RSE_LLM 설정에 따른 추출기. claude-cli 실패 시 rules 로 내려가되 숨기지 않고 fallback 사유를 반환한다.
export function createExtractor(mode, { run } = {}) {
  if (mode === 'rules') return rulesExtractor();
  if (mode !== 'claude-cli') throw new Error(`알 수 없는 RSE_LLM: ${mode}`);
  const cli = claudeCliExtractor({ run });
  return async (text) => {
    try {
      return await cli(text);
    } catch (e) {
      const r = rulesExtract(text);
      return { ...r, fallback: `claude-cli 실패 → rules: ${e.message}` };
    }
  };
}

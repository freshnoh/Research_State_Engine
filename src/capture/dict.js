// CAPTURE 소유. CONTRACT §7.2 데모 정규화 사전 — 시연 범위의 최소 별칭만. 범용 ontology/유사도 없음.
// 규칙: 사전에 있으면 norm, 없으면 "원문 표기 통일값"(target/method) 또는 NULL(environment: enum 한정).
import { ENVIRONMENT } from '../contract/enums.js';

const squash = (s) => String(s).trim().replace(/\s+/g, ' ');

// [정규식, norm]
const METHODS = [
  [/^western\s*blot(ting)?$/i, 'western_blot'],
  [/^웨스턴\s*블[롯랏]$/, 'western_blot'],
  [/^WB$/i, 'western_blot'],
  [/^q\s*PCR$/i, 'qpcr'],
  [/^정량\s*PCR$/i, 'qpcr'],
  [/^ELISA$/i, 'elisa'],
];

const ENVIRONMENTS = [
  [/^(세포(\s*모델)?|cell)$/i, 'cell'],
  [/^(시험관|in[\s-]?vitro)$/i, 'in_vitro'],
  [/^(동물|마우스|쥐)$/, 'animal'],
];

const STOP_STAGES = [
  [/^재현성\s*(검증|확인)$/, 'reproducibility_validation'],
  [/^행동\s*검증$/, 'behavioral_validation'],
];

const lookup = (table, raw) => {
  const s = squash(raw);
  for (const [re, norm] of table) if (re.test(s)) return norm;
  return null;
};

export function normTarget(raw) {
  if (raw == null || !String(raw).trim()) return null;
  const s = squash(raw);
  const m = s.match(/^([A-Za-z]+)[-\s]?(\d+)$/);
  return m ? `${m[1].toUpperCase()}-${m[2]}` : s;
}

export function normMethod(raw) {
  if (raw == null || !String(raw).trim()) return null;
  return lookup(METHODS, raw)
    ?? (squash(raw).toLowerCase().replace(/[^a-z0-9가-힣]+/g, '_').replace(/^_+|_+$/g, '') || null);
}

// environment_norm 은 DB CHECK 로 enum 6종만 허용 → 사전/enum 라벨/enum 코드에 없으면 NULL
export function normEnvironment(raw) {
  if (raw == null || !String(raw).trim()) return null;
  const s = squash(raw);
  const hit = lookup(ENVIRONMENTS, s);
  if (hit) return hit;
  if (Object.hasOwn(ENVIRONMENT, s)) return s;
  for (const [code, label] of Object.entries(ENVIRONMENT)) if (label === s) return code;
  return null;
}

export function normStopStage(raw) {
  if (raw == null || !String(raw).trim()) return null;
  const r = squash(raw).replace(/\s*단계$/, '');
  return lookup(STOP_STAGES, r)
    ?? (r.toLowerCase().replace(/[^a-z0-9가-힣]+/g, '_').replace(/^_+|_+$/g, '') || null);
}

// 조건: 표기 통일만 (µ→u, 공백, 시간/일 → h/d). 숫자는 손대지 않는다.
export function normCondition(raw) {
  if (raw == null || !String(raw).trim()) return null;
  return squash(raw)
    .replace(/[µμ]/g, 'u')
    .replace(/\s*(?:[,，;]\s*)/g, '; ')
    .replace(/(\d)\s*시간/g, '$1 h')
    .replace(/(\d)\s*일/g, '$1 d')
    .replace(/(\d)\s*(uM|mM|nM|pM)/g, '$1 $2')
    .replace(/\s+/g, ' ');
}

export const RESULTS = ['success', 'partial', 'failure', 'stopped', 'unknown'];

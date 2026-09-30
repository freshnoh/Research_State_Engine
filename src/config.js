// 런타임 설정. 우선순위: 프로세스 환경변수 > .env.local (gitignore 대상) > 기본값.
// 여러 인스턴스를 띄울 때는 각자의 .env.local 에 DB_PATH / PORT / DATA_DIR 를 따로 둔다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readEnvFile(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}

export function loadConfig(overrides = {}) {
  const file = readEnvFile(path.join(ROOT, '.env.local'));
  const get = (k, d) => overrides[k] ?? process.env[k] ?? file[k] ?? d;
  const dataDir = path.resolve(ROOT, get('DATA_DIR', 'var'));
  return {
    port: Number(get('PORT', 4100)),
    dataDir,
    dbPath: path.resolve(ROOT, get('DB_PATH', path.join(dataDir, 'rse.db'))),
    approvalDir: path.resolve(ROOT, get('APPROVAL_DIR', path.join(dataDir, 'approval'))),
    crossrefBaseUrl: get('CROSSREF_BASE_URL', 'https://api.crossref.org').replace(/\/+$/, ''),
    crossrefMailto: get('CROSSREF_MAILTO', ''),
    crossrefTimeoutMs: Number(get('CROSSREF_TIMEOUT_MS', 10000)),
    llmMode: get('RSE_LLM', 'claude-cli'),
    demoMode: get('DEMO_MODE', '0') === '1', // 발표 초기화(시연 전용) 허용 여부
  };
}

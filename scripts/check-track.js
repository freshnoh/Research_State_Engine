// worker branch 통합 전 정적 검사 (INTEGRATOR 소유). 사용: node scripts/check-track.js capture|evidence|screens
// fetch 는 호출자가 한 번 한다. 이 스크립트는 origin/track/<t> 와 origin/main 의 merge-base 기준 변경 파일만 본다.
import { execFileSync } from 'node:child_process';

const OWN = {
  capture: [/^src\/capture\//, /^test\/capture\//, /^fixtures\/capture\//, /^docs\/handoff\/CAPTURE\.md$/],
  evidence: [/^src\/evidence\//, /^test\/evidence\//, /^fixtures\/evidence\/recorded\//, /^docs\/handoff\/EVIDENCE\.md$/],
  screens: [/^public\//, /^test\/screens\//, /^docs\/handoff\/SCREENS\.md$/],
};
const t = process.argv[2];
if (!OWN[t]) { console.error('usage: check-track.js capture|evidence|screens'); process.exit(2); }

const git = (...a) => execFileSync('git', a, { encoding: 'utf8' }).trim();
const ref = `origin/track/${t}`;
const sha = git('rev-parse', ref);
const base = git('merge-base', 'origin/main', ref);
const files = git('diff', '--name-only', `${base}..${ref}`).split('\n').filter(Boolean);
const outside = files.filter((f) => !OWN[t].some((re) => re.test(f)));
const forbidden = files.filter((f) => /(^|\/)CLAUDE\.md$|\.env|\.(db|sqlite3?|db-wal|db-shm|log)$|^var\//.test(f));
const diff = files.length ? git('diff', `${base}..${ref}`) : '';
const secrets = (diff.match(/^\+.*(ghp_[A-Za-z0-9]{20,}|github_pat_|sk-ant-|sk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|PRIVATE KEY)/gm) || []);
const checks = [
  ['변경 파일 수 > 0', files.length > 0, files.length],
  ['소유 경계 밖 변경 0', outside.length === 0, outside],
  ['CLAUDE.md/.env/DB/log/var 추적 0', forbidden.length === 0, forbidden],
  ['비밀값 패턴 0', secrets.length === 0, secrets.length],
];
console.log(`track=${t} sha=${sha.slice(0, 7)} merge-base=${base.slice(0, 7)} main=${git('rev-parse', '--short', 'origin/main')} ahead=${git('rev-list', '--count', `origin/main..${ref}`)} behind=${git('rev-list', '--count', `${ref}..origin/main`)}`);
for (const f of files) console.log(`  ${OWN[t].some((re) => re.test(f)) ? ' ' : '✗'} ${f}`);
let pass = 0;
for (const [name, ok, val] of checks) { if (ok) pass++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name} — 실제 ${JSON.stringify(val)}`); }
console.log(`정적 검사 ${pass}/${checks.length}`);
process.exitCode = pass === checks.length ? 0 : 1;

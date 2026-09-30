// DB 초기화: schema 적용만 한다 (데이터 없음). 사용: npm run db:init
import { loadConfig } from '../src/config.js';
import { openDb } from '../src/db/index.js';

const cfg = loadConfig();
const db = openDb(cfg.dbPath);
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((r) => r.name);
console.log(JSON.stringify({ db_path: cfg.dbPath, tables }, null, 2));
db.close();

// 빈 DB 에 시연 seed 적재. 사용: npm run seed  (DB가 비어 있지 않으면 거부)
import { loadConfig } from '../src/config.js';
import { openDb } from '../src/db/index.js';
import { loadSeed } from '../src/core/seed.js';

const cfg = loadConfig();
const db = openDb(cfg.dbPath);
const ids = loadSeed(db);
console.log(JSON.stringify({ db_path: cfg.dbPath, seeded: ids }, null, 2));
db.close();

// 단일 애플리케이션 조립 . 기능별 라우트 모듈은 register(router, ctx) 만 export 한다.
import http from 'node:http';
import path from 'node:path';
import { ROOT, loadConfig } from './config.js';
import { openDb } from './db/index.js';
import { createRouter, sendJson, serveStatic, HttpError } from './core/http.js';
import * as core from './core/routes.js';
import * as approval from './approval/routes.js';
import * as capture from './capture/routes.js';
import * as evidence from './evidence/routes.js';

export function createApp(overrides = {}) {
  const config = loadConfig(overrides);
  const db = overrides.db ?? openDb(config.dbPath);
  const ctx = { db, config };
  const router = createRouter();
  for (const mod of [core, approval, capture, evidence]) mod.register(router, ctx);

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      const hit = router.match(req.method, url.pathname);
      if (hit) {
        const out = await hit.handler({ req, res, params: hit.params, query: Object.fromEntries(url.searchParams), ctx });
        if (!res.headersSent) sendJson(res, out?.status ?? 200, out?.body ?? out ?? {});
        return;
      }
      if (req.method === 'GET' && serveStatic(res, path.join(ROOT, 'public'), url.pathname)) return;
      sendJson(res, 404, { error: { code: 'NOT_FOUND', message: `${req.method} ${url.pathname}` } });
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 500) console.error(e);
      if (!res.headersSent) sendJson(res, status, { error: { code: e.code || 'INTERNAL', message: e.message } });
    }
  });
  return { server, db, config, router };
}

// 최소 CDP 드라이버 (INTEGRATOR 검증 도구, 제품 코드 아님). 외부 의존성 없이 내장 WebSocket 사용.
// 브라우저: RSE_CHROME 환경변수 > (Windows) Chrome/Edge > ~/.cache/ms-playwright 의 chrome-headless-shell.
// 이 PC 의 WSL 에는 chromium 공유 라이브러리가 없어 Windows node + Windows Chrome 으로 실행한다 (WSL 서버는 localhost 포워딩).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function findChrome() {
  if (process.env.RSE_CHROME) return process.env.RSE_CHROME;
  if (process.platform === 'win32') {
    for (const p of ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe']) if (fs.existsSync(p)) return p;
  }
  const root = path.join(os.homedir(), '.cache', 'ms-playwright');
  const dirs = fs.existsSync(root) ? fs.readdirSync(root).filter((d) => d.startsWith('chromium_headless_shell-')).sort().reverse() : [];
  for (const d of dirs) {
    for (const sub of fs.readdirSync(path.join(root, d))) {
      const p = path.join(root, d, sub, 'chrome-headless-shell');
      if (fs.existsSync(p)) return p;
    }
  }
  throw new Error('chrome-headless-shell 없음 (RSE_CHROME 지정 필요)');
}

export async function launch({ width = 1440, height = 900 } = {}) {
  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rse-cdp-'));
  const proc = spawn(findChrome(), ['--headless', '--no-sandbox', '--disable-gpu', '--remote-debugging-port=0',
    `--user-data-dir=${userDir}`, `--window-size=${width},${height}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  const wsUrl = await new Promise((resolve, reject) => {
    let buf = '';
    const t = setTimeout(() => reject(new Error('DevTools 시작 실패')), 15000);
    proc.stderr.on('data', (d) => {
      buf += d;
      const m = buf.match(/DevTools listening on (ws:\/\/\S+)/);
      if (m) { clearTimeout(t); resolve(m[1]); }
    });
  });
  const port = new URL(wsUrl).port;
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = targets.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let seq = 0;
  const pending = new Map();
  const consoleErrors = [];
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
    } else if (msg.method === 'Runtime.exceptionThrown') {
      consoleErrors.push(msg.params.exceptionDetails?.exception?.description || msg.params.exceptionDetails?.text);
    }
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });

  const evaluate = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  const sel = (id) => `[data-testid="${id}"]`;
  const api = {
    consoleErrors,
    evaluate,
    async goto(url) {
      await send('Page.navigate', { url });
      await api.waitFor('document.readyState === "complete"', 15000);
    },
    async waitFor(expr, timeout = 15000) {
      const end = Date.now() + timeout;
      while (Date.now() < end) {
        try { const v = await evaluate(expr); if (v) return v; } catch { /* retry */ }
        await new Promise((r) => setTimeout(r, 150));
      }
      throw new Error(`timeout: ${expr}`);
    },
    count: (id) => evaluate(`document.querySelectorAll('${sel(id)}').length`),
    text: (id) => evaluate(`(document.querySelector('${sel(id)}')||{}).innerText ?? null`),
    exists: (id) => evaluate(`!!document.querySelector('${sel(id)}')`),
    async click(id, within = null) {
      const q = within ? `document.querySelector('${within}')?.querySelector('${sel(id)}')` : `document.querySelector('${sel(id)}')`;
      const ok = await evaluate(`(() => { const el = ${q}; if (!el) return false; el.scrollIntoView(); el.click(); return true; })()`);
      if (!ok) throw new Error(`click: ${id} 없음`);
    },
    async type(id, value) {
      const ok = await evaluate(`(() => { const el = document.querySelector('${sel(id)}'); if (!el) return false; el.focus();
        const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)});
        el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
      if (!ok) throw new Error(`type: ${id} 없음`);
    },
    async screenshot(file) {
      const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
      fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
      return file;
    },
    async close() {
      try { ws.close(); } catch { /* ignore */ }
      await new Promise((r) => { proc.once('exit', r); proc.kill('SIGKILL'); setTimeout(r, 3000); });
      try { fs.rmSync(userDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* 임시 프로필 잔여는 무시 */ }
    },
  };
  return api;
}

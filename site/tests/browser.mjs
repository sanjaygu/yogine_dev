// A small Chrome DevTools driver, so the real pages can be exercised without installing a test framework.
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const CHROME = process.env.CHROME_BIN || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function launch(name, port = 9400 + Math.floor(Math.random() * 400)) {
  const profile = resolve(import.meta.dirname, '.tmp', `chrome-${name}`);
  rmSync(profile, { recursive: true, force: true }); // every run starts with an empty browser
  mkdirSync(profile, { recursive: true });
  const proc = spawn(CHROME, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
  let targets;
  for (let i = 0; i < 60; i++) {
    try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); break; } catch { await sleep(200); }
  }
  const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0;
  const pending = new Map();
  const listeners = [];
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } else listeners.forEach((l) => l(d));
  };
  const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Network.enable');

  const requests = [];
  const consoleErrors = [];
  const consoleLogs = [];
  listeners.push((d) => {
    if (d.method === 'Network.requestWillBeSent') requests.push(d.params.request.url);
    if (d.method === 'Runtime.consoleAPICalled') consoleLogs.push(d.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
    if (d.method === 'Runtime.exceptionThrown') consoleErrors.push(d.params.exceptionDetails.text + ' ' + (d.params.exceptionDetails.exception?.description || ''));
  });

  const page = {
    requests,
    consoleErrors,
    consoleLogs,
    send,
    async goto(url) {
      await send('Page.navigate', { url });
      await sleep(900);
      await page.waitFor('document.readyState === "complete"');
    },
    async eval(expr) {
      const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
      if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || 'eval failed: ' + expr);
      return r.result.result.value;
    },
    async waitFor(expr, timeout = 6000) {
      const end = Date.now() + timeout;
      while (Date.now() < end) {
        try { if (await page.eval(expr)) return true; } catch { /* page navigating */ }
        await sleep(100);
      }
      throw new Error('timed out waiting for: ' + expr);
    },
    async set(selector, value) {
      await page.eval(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); el.focus(); el.value = ${JSON.stringify(value)}; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    },
    async check(selector, on = true) {
      await page.eval(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (el.checked !== ${on}) el.click(); })()`);
    },
    async click(selector) {
      await page.eval(`document.querySelector(${JSON.stringify(selector)}).click()`);
    },
    async text(selector) {
      return page.eval(`document.querySelector(${JSON.stringify(selector)})?.innerText ?? null`);
    },
    // Headless Chrome announces itself as HeadlessChrome, which analytics libraries rightly treat as a bot.
    async looksLikeARealBrowser() {
      const ua = await page.eval('navigator.userAgent');
      await send('Network.setUserAgentOverride', { userAgent: ua.replace('HeadlessChrome', 'Chrome') });
    },
    // Accessibility audit of whatever is on screen right now (WCAG 2.0 to 2.2 AA plus best practice).
    async axe() {
      const src = readFileSync(resolve(import.meta.dirname, '../node_modules/axe-core/axe.min.js'), 'utf8');
      await page.eval(src);
      const out = await page.eval(`axe.run(document, { runOnly: ['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa','best-practice'] }).then(r => JSON.stringify(r.violations.map(v => ({ id: v.id, impact: v.impact, nodes: v.nodes.slice(0, 3).map(n => n.target.join(' ')), help: v.help }))))`);
      return JSON.parse(out);
    },
    async viewport(width, height = 900, mobile = false) {
      await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
    },
    async screenshot(file, height) {
      const h = height || (await page.eval('document.documentElement.scrollHeight'));
      const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: await page.eval('innerWidth'), height: Math.min(h, 3000), scale: 1 } });
      (await import('node:fs')).writeFileSync(file, Buffer.from(shot.result.data, 'base64'));
    },
    // Replace the page at a URL pattern with a stub, so a redirect to Stripe can be observed without leaving the machine.
    async stubUrl(pattern, body = 'stub') {
      await send('Fetch.enable', { patterns: [{ urlPattern: pattern }] });
      listeners.push(async (d) => {
        if (d.method === 'Fetch.requestPaused') {
          await send('Fetch.fulfillRequest', { requestId: d.params.requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'text/html' }], body: Buffer.from(body).toString('base64') });
        }
      });
    },
    close() { ws.close(); proc.kill(); },
  };
  return page;
}

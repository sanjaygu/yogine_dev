// Consent and analytics, against a build that has a (fake) PostHog key and a local stand-in for PostHog.
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { resolve } from 'node:path';
import { startPhp } from './helpers.mjs';
import { launch } from './browser.mjs';

const root = resolve(import.meta.dirname, '..');
const dist = resolve(root, 'dist-analytics');
const SITE_PORT = 8086;
const PH_PORT = 8085;
const SITE = `http://127.0.0.1:${SITE_PORT}`;
const received = [];
let phServer;
let php;
let page;

function decode(req, raw) {
  const url = new URL(req.url, 'http://x');
  let text;
  try {
    text = url.searchParams.get('compression') === 'gzip-js' || raw[0] === 0x1f ? gunzipSync(raw).toString('utf8') : raw.toString('utf8');
  } catch {
    text = raw.toString('utf8');
  }
  if (text.startsWith('data=')) text = Buffer.from(decodeURIComponent(text.slice(5)), 'base64').toString('utf8');
  try { return JSON.parse(text); } catch { return text; }
}
const events = () => received.flatMap((r) => (Array.isArray(r.body) ? r.body : r.body?.batch ? r.body.batch : r.body?.event ? [r.body] : [])).filter((e) => e && e.event);
const eventNames = () => events().map((e) => e.event);

before(async () => {
  const env = { ...process.env, YOGINE_CATALOG: 'catalog.fixture.json', PUBLIC_POSTHOG_KEY: 'phc_test_key', PUBLIC_POSTHOG_HOST: `http://127.0.0.1:${PH_PORT}` };
  execSync('node scripts/sync-catalog.mjs', { cwd: root, env, stdio: 'ignore' });
  execSync('npx astro build --outDir dist-analytics', { cwd: root, env, stdio: 'ignore' });

  phServer = createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks);
      received.push({ url: req.url, method: req.method, body: raw.length ? decode(req, raw) : null });
      res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
      res.setHeader('Access-Control-Allow-Headers', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
      // PostHog loads its settings and helper scripts from the API host as JavaScript, so the stand-in must too.
      if (req.url.includes('/config.js')) {
        res.writeHead(200, { 'content-type': 'application/javascript' });
        return res.end('window._POSTHOG_REMOTE_CONFIG = window._POSTHOG_REMOTE_CONFIG || {}; window._POSTHOG_REMOTE_CONFIG["phc_test_key"] = { config: { enable_collect_everything: true }, siteApps: [] };');
      }
      if (req.url.startsWith('/static/')) {
        res.writeHead(200, { 'content-type': 'application/javascript' });
        return res.end('');
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(req.url.includes('/flags') ? JSON.stringify({ featureFlags: {}, flags: {} }) : '{"status":1}');
    });
  }).listen(PH_PORT);

  php = await startPhp('analytics', { docroot: dist, catalogFile: resolve(dist, 'api/catalog.json'), port: SITE_PORT });
  page = await launch('analytics');
  await page.looksLikeARealBrowser();
  await page.viewport(1280, 900);
});
after(() => {
  page?.close();
  php?.stop();
  phServer?.close();
});

const toPh = () => page.requests.filter((u) => u.startsWith(`http://127.0.0.1:${PH_PORT}`));
const storage = () => page.eval('JSON.stringify({ local: Object.keys(localStorage), session: Object.keys(sessionStorage), cookie: document.cookie })').then(JSON.parse);

describe('before the visitor chooses', () => {
  test('the banner shows, nothing is stored, and nothing is sent to PostHog', async () => {
    await page.goto(`${SITE}/`);
    assert.equal(await page.eval('document.querySelector("#consentBanner").hidden'), false);
    const text = await page.text('#consentBanner');
    assert.match(text, /Accept analytics/);
    assert.match(text, /Decline/);
    await new Promise((r) => setTimeout(r, 1500));
    assert.deepEqual(toPh(), []);
    assert.equal(received.length, 0);
    const s = await storage();
    assert.deepEqual(s.local, []);
    assert.equal(s.cookie, '');
  });

  test('the banner passes an accessibility audit', async () => {
    const v = await page.axe();
    assert.deepEqual(v, [], JSON.stringify(v));
  });

  test('accept and decline are equally prominent', async () => {
    const styles = await page.eval(`[...document.querySelectorAll("#consentBanner button")].map(b => { const c = getComputedStyle(b); return [b.className, c.backgroundColor, c.borderColor, Math.round(b.getBoundingClientRect().height)].join("|"); })`);
    assert.equal(styles[0].split('|').slice(1).join('|'), styles[1].split('|').slice(1).join('|'));
  });

  test('the banner does not trap or steal focus, and the page still works', async () => {
    assert.notEqual(await page.eval('document.activeElement?.closest("#consentBanner") ? 1 : 0'), 1);
    await page.goto(`${SITE}/waitlist/`);
    await page.check('#wl-course-advanced');
    await page.set('#wl-email', 'early@example.com');
    await page.click('#wl-form button[type=submit]');
    await page.waitFor('!document.querySelector("#wl-success").hidden');
    assert.equal(php.sheet().find((s) => s.email === 'early@example.com').ph_visitor_id, '', 'no visitor id without consent');
    assert.deepEqual(toPh(), []);
    assert.deepEqual((await storage()).local, []);
  });
});

describe('declining', () => {
  test('the choice is remembered, nothing is sent, and it can be changed from the footer', async () => {
    await page.goto(`${SITE}/`);
    await page.click('#consentBanner [data-consent="denied"]');
    assert.equal(await page.eval('document.querySelector("#consentBanner").hidden'), true);
    assert.equal(await page.eval('localStorage.getItem("yogine_consent")'), 'denied');
    assert.equal(await page.eval('document.querySelector("#consentReopen").hidden'), false);
    await page.goto(`${SITE}/training/`);
    assert.equal(await page.eval('document.querySelector("#consentBanner").hidden'), true, 'not asked again');
    await page.click('a.btn');
    await new Promise((r) => setTimeout(r, 1500));
    assert.equal(received.length, 0);
    assert.deepEqual(toPh(), []);
  });
});

describe('accepting', () => {
  test('visits and clicks are recorded, first-touch details are kept, and recordings mask fields', async () => {
    await page.goto(`${SITE}/solutions/?utm_source=newsletter&utm_campaign=oct`);
    await page.click('#consentReopen');
    assert.equal(await page.eval('document.querySelector("#consentBanner").hidden'), false);
    await page.click('#consentBanner [data-consent="granted"]');
    await page.waitFor(`localStorage.getItem("yogine_consent") === "granted"`);
    await page.waitFor('Object.keys(localStorage).some(k => k.startsWith("ph_") || k.includes("posthog"))', 8000);
    const first = JSON.parse(await page.eval('localStorage.getItem("yogine_first_touch")'));
    assert.equal(first.landing, '/solutions/');
    assert.match(first.utm, /utm_source=newsletter/);
    await page.click('a.btn[href^="/contact/"]');
    await page.waitFor('location.pathname === "/contact/"');
    const end = Date.now() + 12000;
    while (Date.now() < end && !(eventNames().includes('$pageview') && eventNames().includes('cta_click'))) await new Promise((r) => setTimeout(r, 300));
    assert.ok(eventNames().includes('$pageview'), 'page view captured: ' + [...new Set(eventNames())].join(','));
    assert.ok(eventNames().includes('cta_click'), 'cta click captured: ' + [...new Set(eventNames())].join(','));
    const cta = events().find((e) => e.event === 'cta_click');
    assert.equal(cta.properties.page, '/solutions/');
    assert.match(cta.properties.label, /Talk to us/);
    assert.equal(cta.properties.$lib, 'web');
  });

  test('a contact submission identifies the visitor by email and carries the visitor id into the record', async () => {
    await page.waitFor('document.readyState === "complete" && !document.querySelector("#contact-form button[type=submit]").disabled'); // the button is enabled once the form's script is ready
    await page.set('#contact-name', 'Ida Identified');
    await page.set('#contact-email', 'Ida@Example.com');
    await page.set('#contact-message', 'We would like to talk about governance.');
    await page.click('#contact-form button[type=submit]');
    await page.waitFor('!document.querySelector("#contact-success").hidden');
    const end = Date.now() + 12000;
    while (Date.now() < end && !eventNames().includes('contact_submitted')) await new Promise((r) => setTimeout(r, 300));
    const identify = events().find((e) => e.event === '$identify');
    assert.ok(identify, 'identify sent: ' + [...new Set(eventNames())].join(','));
    assert.equal(identify.properties.distinct_id, 'ida@example.com');
    assert.ok(identify.properties.$anon_distinct_id, 'the earlier anonymous visits are merged in');
    const team = php.outbox().find((m) => m.subject.includes('Contact:') && m.reply_to === 'Ida@Example.com');
    const visitorId = /Visitor ID: (\S+)/.exec(team.text)?.[1];
    assert.equal(visitorId, identify.properties.$anon_distinct_id, 'the record carries the id that PostHog merged');
    assert.ok(eventNames().includes('contact_submitted'));
  });

  test('the build masks form fields in session recordings', () => {
    const dir = resolve(dist, '_astro');
    const code = readdirSync(dir).filter((f) => f.endsWith('.js')).map((f) => readFileSync(resolve(dir, f), 'utf8')).join('\n');
    assert.match(code, /maskAllInputs\s*:\s*(true|!0)/);
  });
});

describe('changing your mind', () => {
  test('declining after accepting stops all further capture', async () => {
    await page.click('#consentReopen');
    await page.click('#consentBanner [data-consent="denied"]');
    assert.equal(await page.eval('localStorage.getItem("yogine_consent")'), 'denied');
    assert.equal(await page.eval('localStorage.getItem("yogine_first_touch")'), null, 'first-touch details removed');
    await new Promise((r) => setTimeout(r, 4000)); // let anything already queued go out
    const before = received.length;
    await page.click('a.btn');
    await page.goto(`${SITE}/training/`);
    await page.click('a.btn');
    await new Promise((r) => setTimeout(r, 4000));
    assert.equal(received.length, before, 'no new requests after declining');
  });
});

// Live mode talks to Resend and the Google Apps Script web app over HTTP. These tests stand in fake
// versions of both, including Apps Script's habit of answering a POST with a redirect to the result.
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { testCatalog, post } from './helpers.mjs';

const root = resolve(import.meta.dirname, '..');
const PHP_PORT = 8082;
const FAKE_PORT = 8083;
const calls = { resend: [], sheet: [] };
let resendStatus = 200;
let sheetOk = true;
let fake;
let php;

before(async () => {
  fake = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      if (req.url === '/resend' && req.method === 'POST') {
        calls.resend.push({ auth: req.headers.authorization, body: JSON.parse(body) });
        res.writeHead(resendStatus, { 'content-type': 'application/json' });
        return res.end('{"id":"x"}');
      }
      if (req.url === '/exec' && req.method === 'POST') {
        calls.sheet.push({ contentType: req.headers['content-type'], body: JSON.parse(body) });
        res.writeHead(302, { location: `http://127.0.0.1:${FAKE_PORT}/echo` });
        return res.end();
      }
      if (req.url === '/echo' && req.method === 'GET') {
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ ok: sheetOk }));
      }
      res.writeHead(404);
      res.end();
    });
  }).listen(FAKE_PORT);

  const dir = resolve(root, 'tests/.tmp/live');
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const secrets = resolve(dir, 'secrets.php');
  writeFileSync(secrets, `<?php return ['mode' => 'live', 'data_dir' => '${resolve(dir, 'data').replaceAll('\\', '/')}', 'stripe_webhook_secret' => 'whsec_x', 'resend_api_key' => 're_test_key', 'resend_url' => 'http://127.0.0.1:${FAKE_PORT}/resend', 'sheet_url' => 'http://127.0.0.1:${FAKE_PORT}/exec', 'sheet_secret' => 'shared-secret', 'extra_allowed_hosts' => ['127.0.0.1']];`);
  const catalog = resolve(dir, 'catalog.json');
  writeFileSync(catalog, JSON.stringify(testCatalog()));
  php = spawn(process.env.PHP_BIN || 'php', ['-S', `127.0.0.1:${PHP_PORT}`, '-t', resolve(root, 'public')], {
    env: { ...process.env, YOGINE_SECRETS: secrets, YOGINE_CATALOG_FILE: catalog },
    stdio: 'ignore',
  });
  for (let i = 0; i < 50; i++) {
    try { await fetch(`http://127.0.0.1:${PHP_PORT}/api/lead.php`); break; } catch { await new Promise((r) => setTimeout(r, 150)); }
  }
});
after(() => { php.kill(); fake.close(); });

const call = (path, body) => fetch(`http://127.0.0.1:${PHP_PORT}/api/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
const lead = (email) => ({ name: 'Live Tester', email, course: 'foundation', session: 'f1', source: { page: '/enroll/' }, ph: 'ph-live' });

describe('live mode', () => {
  test('a lead reaches the sheet through the redirect, with the shared secret, and the team email carries the Resend key', async () => {
    const r = await call('lead.php', lead('live1@example.com'));
    assert.equal(r.status, 200);
    const sheet = calls.sheet.find((c) => c.body.lead_id === r.json.leadId);
    assert.equal(sheet.body.secret, 'shared-secret');
    assert.equal(sheet.body.type, 'lead');
    assert.equal(sheet.body.ph_visitor_id, 'ph-live');
    const mail = calls.resend.find((c) => c.body.subject.includes('New lead'));
    assert.equal(mail.auth, 'Bearer re_test_key');
    assert.deepEqual(mail.body.to, ['hello@yogine.dev']);
  });

  test('a sheet failure never blocks the visitor: the lead still succeeds', async () => {
    sheetOk = false;
    const r = await call('lead.php', lead('live2@example.com'));
    sheetOk = true;
    assert.equal(r.status, 200);
    assert.match(r.json.leadId, /^L/);
  });

  test('registration fails loudly when the confirmation email cannot be sent, so the visitor can retry', async () => {
    resendStatus = 500;
    const r = await call('register.php', { name: 'Retry Me', email: 'retry@example.com', course: 'foundation', event: 'f1' });
    resendStatus = 200;
    assert.equal(r.status, 500);
    const ok = await call('register.php', { name: 'Retry Me', email: 'retry@example.com', course: 'foundation', event: 'f1' });
    assert.equal(ok.status, 200, 'the retry works because nothing was recorded for the failed attempt');
  });

  test('a waitlist entry is still saved when the sheet is down, as long as another route worked', async () => {
    sheetOk = false;
    const r = await call('waitlist.php', { name: 'W', email: 'wl-live@example.com', courses: ['professional'] });
    sheetOk = true;
    assert.equal(r.status, 200);
    assert.match(readFileSync(resolve(root, 'tests/.tmp/live/data/waitlist.csv'), 'utf8'), /wl-live@example.com/);
  });
});

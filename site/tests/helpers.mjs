import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import { resolve } from 'node:path';

export const PORT = 8081;
export const BASE = `http://127.0.0.1:${PORT}`;
const root = resolve(import.meta.dirname, '..');

const day = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);

// Sessions are dated relative to today so the tests do not go stale.
export function testCatalog() {
  const base = JSON.parse(readFileSync(resolve(root, 'src/data/catalog.json'), 'utf8'));
  const courses = base.courses.map((c) => (c.slug === 'professional' ? { ...c, paymentLink: '' } : c));
  courses.push({ ...base.courses.find((c) => c.slug === 'advanced'), slug: 'paid-ok', name: 'Paid course with a link', paymentLink: 'https://example.test/pay' });
  return {
    ...base,
    courses,
    sessions: [
      { id: 'f1', course: 'foundation', date: 'Dec 8, 2026 · 4:00 PM PT', start: day(30), end: day(30), location: 'Virtual · 90 min', virtual: true, note: 'We will email the joining link.' },
      { id: 'p1', course: 'professional', date: 'Dec 12, 2026', start: day(40), end: day(40), venue: 'icc' },
      { id: 'a1', course: 'advanced', date: 'Dec 14, 2026', start: day(45), end: day(45), venue: 'icc' },
      { id: 'k1', course: 'paid-ok', date: 'Dec 16, 2026', start: day(50), end: day(50), venue: 'icc' },
      { id: 'old1', course: 'foundation', date: 'Jan 1, 2020', start: '2020-01-01', end: '2020-01-01', location: 'Virtual · 90 min', virtual: true },
    ],
  };
}

export const WEBHOOK_SECRET = 'whsec_test_secret';

export async function startPhp(name, { docroot = resolve(root, 'public'), catalogFile = null, port = PORT } = {}) {
  const dir = resolve(root, 'tests/.tmp', name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const dataDir = resolve(dir, 'data').replaceAll('\\', '/');
  const secrets = resolve(dir, 'secrets.php');
  writeFileSync(secrets, `<?php return ['mode' => 'file', 'data_dir' => '${dataDir}', 'stripe_webhook_secret' => '${WEBHOOK_SECRET}', 'rate_salt' => 'test-salt', 'extra_allowed_hosts' => ['127.0.0.1', 'localhost']];`);
  const catalog = resolve(dir, 'catalog.json');
  if (!catalogFile) writeFileSync(catalog, JSON.stringify(testCatalog()));

  const proc = spawn(process.env.PHP_BIN || 'php', ['-S', `127.0.0.1:${port}`, '-t', docroot], {
    env: { ...process.env, YOGINE_SECRETS: secrets, YOGINE_CATALOG_FILE: catalogFile || catalog },
    stdio: 'ignore',
  });
  for (let i = 0; i < 50; i++) {
    try {
      await fetch(`http://127.0.0.1:${port}/api/lead.php`);
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 150));
    }
  }
  const read = (file) => {
    const p = resolve(dir, 'data', file);
    return existsSync(p) ? readFileSync(p, 'utf8') : '';
  };
  const jsonl = (file) => read(file).split('\n').filter(Boolean).map((l) => JSON.parse(l));
  return {
    dir,
    read,
    outbox: () => jsonl('outbox.jsonl'),
    sheet: () => jsonl('sheet-outbox.jsonl'),
    stop: () => proc.kill(),
  };
}

export async function post(path, body, headers = {}) {
  const res = await fetch(`${BASE}/api/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  let json = null;
  try {
    json = await res.clone().json();
  } catch {
    /* not JSON */
  }
  return { status: res.status, json, text: await res.text() };
}

export function stripeEvent({ id, ref, email = 'buyer@example.com', name = 'Pat Buyer', paid = 'paid', amount = 49500, type = 'checkout.session.completed' }) {
  const payload = JSON.stringify({
    type,
    data: { object: { id, payment_status: paid, client_reference_id: ref, amount_total: amount, currency: 'usd', customer_details: { email, name } } },
  });
  const t = Math.floor(Date.now() / 1000);
  const sig = createHmac('sha256', WEBHOOK_SECRET).update(`${t}.${payload}`).digest('hex');
  return { payload, header: `t=${t},v1=${sig}` };
}

export async function postRaw(path, payload, headers) {
  const res = await fetch(`${BASE}/api/${path}`, { method: 'POST', headers, body: payload });
  return { status: res.status, text: await res.text() };
}

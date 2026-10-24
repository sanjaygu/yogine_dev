import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const work = resolve(root, 'tests/.tmp/strip');
const secrets = resolve(work, 'secrets.php');
const dist = resolve(work, 'dist');

// Obviously fake values, built from parts so this file itself holds nothing secret-shaped.
const fakeWebhook = 'whsec_' + 'A1b2C3d4E5f6G7h8I9j0K1l2';
const fakeResend = 're_' + 'Zy9Xw8Vu7Ts6Rq5Po4Nm3Lk2';
const fakeSalt = 'a long private phrase that is not shaped like any key';

const run = (...extra) => spawnSync(process.execPath, ['scripts/strip-private.mjs', dist, `--secrets=${secrets}`, ...extra], { cwd: root, encoding: 'utf8' });

beforeEach(() => {
  rmSync(work, { recursive: true, force: true });
  mkdirSync(resolve(dist, 'api'), { recursive: true });
  writeFileSync(resolve(dist, 'index.html'), '<html>nothing private here</html>');
  writeFileSync(resolve(dist, 'api/catalog.json'), '{}');
  writeFileSync(secrets, `<?php return ['rate_salt' => '${fakeSalt}', 'resend_api_key' => 're_PASTE_FROM_RESEND'];`);
});

describe('strip-private', () => {
  test('removes the secrets file and the template from the built API folder', () => {
    writeFileSync(resolve(dist, 'api/config.secrets.php'), '<?php return [];');
    writeFileSync(resolve(dist, 'api/config.secrets.example.php'), '<?php return [];');
    const r = run();
    assert.equal(r.status, 0, r.stderr);
    assert.ok(!existsSync(resolve(dist, 'api/config.secrets.php')));
    assert.ok(!existsSync(resolve(dist, 'api/config.secrets.example.php')));
    assert.ok(existsSync(resolve(dist, 'api/catalog.json')), 'other files stay');
  });

  test('a clean build passes', () => {
    assert.equal(run().status, 0);
  });

  test('fails when a built file holds a Stripe webhook secret, and never prints it', () => {
    writeFileSync(resolve(dist, 'leak.js'), `var x = "${fakeWebhook}";`);
    const r = run();
    assert.equal(r.status, 1);
    assert.match(r.stderr, /leak\.js: looks like a Stripe webhook secret/);
    assert.ok(!r.stderr.includes(fakeWebhook) && !r.stdout.includes(fakeWebhook));
  });

  test('fails when a built file holds a Resend key or an Apps Script URL', () => {
    writeFileSync(resolve(dist, 'a.js'), `k="${fakeResend}"`);
    writeFileSync(resolve(dist, 'b.js'), 'u="https://script.google.com/macros/s/AKfycbxAAAAAAAAAAAAAAAAAAAAAAAAAAAA/exec"');
    const r = run();
    assert.equal(r.status, 1);
    assert.match(r.stderr, /a\.js: looks like a Resend API key/);
    assert.match(r.stderr, /b\.js: looks like a Google Apps Script URL/);
  });

  test('fails when a built file holds a value taken from the secrets file, even one with no tell-tale shape', () => {
    writeFileSync(resolve(dist, 'notes.txt'), `config: ${fakeSalt}`);
    const r = run();
    assert.equal(r.status, 1);
    assert.match(r.stderr, /notes\.txt: contains value #1 from a secrets file/);
    assert.ok(!r.stderr.includes(fakeSalt));
  });

  test('placeholders in the secrets file are not treated as secrets', () => {
    writeFileSync(resolve(dist, 'doc.html'), 're_PASTE_FROM_RESEND is the placeholder');
    assert.equal(run().status, 0);
  });

  test('stops with a clear message when the folder is missing', () => {
    const r = spawnSync(process.execPath, ['scripts/strip-private.mjs', resolve(work, 'nope')], { cwd: root, encoding: 'utf8' });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /does not exist/);
  });
});

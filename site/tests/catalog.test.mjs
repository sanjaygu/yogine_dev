import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
let loadCatalog;
let chooseStripeLinks;
before(async () => {
  process.chdir(root); // the loader reads src/data relative to where it runs
  ({ loadCatalog, chooseStripeLinks } = await import('../src/lib/catalog-data.mjs'));
});

const link = (cat, slug) => cat.courses.find((c) => c.slug === slug).paymentLink;

// Synthetic data, so these tests keep passing whatever real links are added to catalog.json.
const sample = () => ({
  courses: [
    { slug: 'free', free: true },
    { slug: 'paid', price: 10, paymentLink: 'https://book.stripe.com/live-paid', paymentLinkTest: 'https://book.stripe.com/test-paid' },
    { slug: 'paid-no-test', price: 20, paymentLink: 'https://book.stripe.com/live-two' },
    { slug: 'custom', custom: true },
  ],
});

describe('payment links by build mode', () => {
  test('a normal build uses the live links and says so', () => {
    const cat = chooseStripeLinks(sample(), {});
    assert.equal(cat.stripeMode, 'live');
    assert.equal(link(cat, 'paid'), 'https://book.stripe.com/live-paid');
  });

  test('a staging build uses the test links', () => {
    const cat = chooseStripeLinks(sample(), { YOGINE_STRIPE_MODE: 'test' });
    assert.equal(cat.stripeMode, 'test');
    assert.equal(link(cat, 'paid'), 'https://book.stripe.com/test-paid');
  });

  test('a course with no test link falls back to empty (the waitlist) instead of using its live link', () => {
    const cat = chooseStripeLinks(sample(), { YOGINE_STRIPE_MODE: 'test' });
    assert.equal(link(cat, 'paid-no-test'), '');
  });

  test('the test link field never reaches built output, in either mode', () => {
    for (const env of [{}, { YOGINE_STRIPE_MODE: 'test' }]) {
      assert.ok(!JSON.stringify(chooseStripeLinks(sample(), env)).includes('paymentLinkTest'));
    }
  });

  test('free and custom courses are untouched', () => {
    const cat = chooseStripeLinks(sample(), { YOGINE_STRIPE_MODE: 'test' });
    assert.equal(link(cat, 'free'), undefined);
    assert.equal(link(cat, 'custom'), undefined);
  });

  test('any value other than "test" means live, so a typo cannot send test cards to production', () => {
    assert.equal(chooseStripeLinks(sample(), { YOGINE_STRIPE_MODE: 'TEST ' }).stripeMode, 'live');
    assert.equal(chooseStripeLinks(sample(), { YOGINE_STRIPE_MODE: 'staging' }).stripeMode, 'live');
  });

  test('the real catalog never leaks a test link, and the sample-sessions fixture works in either mode', () => {
    for (const env of [{}, { YOGINE_STRIPE_MODE: 'test' }, { YOGINE_CATALOG: 'catalog.fixture.json', YOGINE_STRIPE_MODE: 'test' }]) {
      assert.ok(!JSON.stringify(loadCatalog(env)).includes('paymentLinkTest'));
    }
    const cat = loadCatalog({ YOGINE_CATALOG: 'catalog.fixture.json' });
    assert.ok(cat.sessions.every((s) => s.id.startsWith('t')));
  });
});

describe('sessions', () => {
  test('the placeholder November sessions are in the future and belong to real courses', () => {
    const cat = loadCatalog({});
    const slugs = new Set(cat.courses.map((c) => c.slug));
    const mine = cat.sessions.filter((s) => s.id.startsWith('n'));
    assert.equal(mine.length, 5);
    for (const s of mine) {
      assert.ok(slugs.has(s.course), `${s.id} has a known course`);
      assert.ok(s.start >= '2026-11-01' && s.end >= s.start, `${s.id} dates are in November or later and in order`);
    }
  });

  test('every session names a venue that exists, or a location', () => {
    const cat = loadCatalog({});
    for (const s of cat.sessions) assert.ok(s.venue ? cat.venues[s.venue] : s.location, `${s.id} has somewhere to be`);
  });
});

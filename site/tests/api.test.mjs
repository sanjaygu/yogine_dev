import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { startPhp, post, postRaw, stripeEvent, BASE } from './helpers.mjs';

let php;
before(async () => { php = await startPhp('api'); });
after(() => php.stop());

const src = { page: '/enroll/', landing: '/training/', referrer: 'https://example.com/', utm: 'utm_source=newsletter', device: 'desktop', language: 'en-US', timezone: 'America/Los_Angeles' };
const lead = (over = {}) => ({ name: 'Jordan Rivera', email: 'jordan@example.com', phone: '', course: 'foundation', session: 'f1', source: src, ph: 'ph-abc', ...over });

describe('lead.php', () => {
  let id;
  test('creates a lead, records it three ways, and returns an id', async () => {
    const r = await post('lead.php', lead());
    assert.equal(r.status, 200);
    assert.match(r.json.leadId, /^L[A-Z2-9]{10}$/);
    id = r.json.leadId;
    assert.match(php.read('leads.csv'), new RegExp(id));
    const sheet = php.sheet().find((s) => s.lead_id === id);
    assert.equal(sheet.type, 'lead');
    assert.equal(sheet.status, 'lead');
    assert.equal(sheet.ph_visitor_id, 'ph-abc');
    assert.equal(sheet.utm, 'utm_source=newsletter');
    const mail = php.outbox().find((m) => m.subject.includes('New lead'));
    assert.deepEqual(mail.to, ['hello@yogine.dev']);
    assert.equal(mail.reply_to, 'jordan@example.com');
    assert.equal(mail.bcc, undefined);
  });

  test('the same person and session within a day reuses the lead', async () => {
    const before = php.sheet().filter((s) => s.type === 'lead').length;
    const r = await post('lead.php', lead());
    assert.equal(r.json.leadId, id);
    assert.equal(php.sheet().filter((s) => s.type === 'lead').length, before);
  });

  test('rejects bad input', async () => {
    assert.equal((await post('lead.php', lead({ email: 'nope' }))).status, 400);
    assert.equal((await post('lead.php', lead({ name: 'J' }))).status, 400);
    assert.equal((await post('lead.php', lead({ phone: '12' }))).status, 400);
    assert.equal((await post('lead.php', lead({ session: 'old1' }))).status, 400, 'ended session');
    assert.equal((await post('lead.php', lead({ session: 'p1' }))).status, 400, 'session belongs to another course');
    assert.equal((await post('lead.php', lead({ course: 'enterprise-sdlc', session: '' }))).status, 400, 'custom course');
    assert.equal((await post('lead.php', lead({ course: 'professional', session: 'p1', email: 'a1@example.com' }))).status, 400, 'paid course without a payment link');
    assert.equal((await post('lead.php', lead({ course: 'paid-ok', session: 'k1', email: 'k1@example.com' }))).status, 200, 'paid course with a link');
  });

  test('a filled honeypot looks like success but saves nothing', async () => {
    const r = await post('lead.php', lead({ email: 'bot@example.com', website: 'http://spam.example' }));
    assert.equal(r.status, 200);
    assert.doesNotMatch(php.read('leads.csv'), /bot@example.com/);
  });

  test('payment_started and profile update the lead; unknown leads are refused', async () => {
    assert.equal((await post('lead.php', { action: 'status', leadId: id, status: 'payment_started' })).status, 200);
    assert.equal((await post('lead.php', { action: 'status', leadId: id, status: 'paid' })).status, 400, 'visitors cannot mark themselves paid');
    assert.equal((await post('lead.php', { action: 'status', leadId: 'LAAAAAAAAAA', status: 'payment_started' })).status, 404);
    assert.equal((await post('lead.php', { action: 'profile', leadId: id, codingExperience: '3-7', aiExperience: 'chat', expectations: 'A review skill' })).status, 200);
    const updates = php.sheet().filter((s) => s.type === 'lead_update' && s.lead_id === id);
    assert.ok(updates.some((u) => u.status === 'payment_started'));
    assert.ok(updates.some((u) => u.coding_experience === '3-7' && u.expectations === 'A review skill'));
    assert.ok(!updates.some((u) => u.status === 'paid'));
  });

  test('spreadsheet formulas in a name are neutralised in the saved CSV', async () => {
    await post('lead.php', lead({ name: '=HYPERLINK("http://x")', email: 'f@example.com' }));
    assert.match(php.read('leads.csv'), /'=HYPERLINK/);
  });
});

describe('guards', () => {
  test('only POST is accepted', async () => {
    assert.equal((await fetch(`${BASE}/api/lead.php`)).status, 405);
  });
  test('a request from another site is refused', async () => {
    assert.equal((await post('contact.php', { name: 'X Y', email: 'x@example.com', message: 'hello there' }, { Origin: 'https://evil.example' })).status, 403);
  });
  test('malformed JSON is a 400', async () => {
    assert.equal((await post('lead.php', '{oops')).status, 400);
  });
});

describe('register.php (free sessions)', () => {
  const reg = (over = {}) => ({ name: 'Sam Free', email: 'sam@example.com', course: 'foundation', event: 'f1', ...over });

  test('registers, emails the visitor with a copy to the team, and marks the lead registered', async () => {
    const l = await post('lead.php', lead({ name: 'Sam Free', email: 'sam@example.com' }));
    const r = await post('register.php', reg({ leadId: l.json.leadId }));
    assert.equal(r.status, 200);
    const mail = php.outbox().find((m) => m.to[0] === 'sam@example.com');
    assert.match(mail.subject, /You're registered/);
    assert.match(mail.text, /Virtual · 90 min/);
    assert.deepEqual(mail.bcc, ['hello@yogine.dev']);
    assert.ok(php.sheet().some((s) => s.lead_id === l.json.leadId && s.status === 'registered'));
  });

  test('a repeat registration succeeds without a second email', async () => {
    const before = php.outbox().filter((m) => m.to[0] === 'sam@example.com').length;
    assert.equal((await post('register.php', reg())).status, 200);
    assert.equal(php.outbox().filter((m) => m.to[0] === 'sam@example.com').length, before);
  });

  test('refuses paid courses, ended sessions and wrong sessions', async () => {
    assert.equal((await post('register.php', reg({ course: 'advanced', event: 'a1' }))).status, 400);
    assert.equal((await post('register.php', reg({ event: 'old1', email: 'old@example.com' }))).status, 400);
    assert.equal((await post('register.php', reg({ event: 'p1', email: 'wrong@example.com' }))).status, 400);
  });
});

describe('waitlist.php', () => {
  const wl = (over = {}) => ({ name: 'Wendy', email: 'wendy@example.com', phone: '', courses: ['professional'], note: 'Weekends please', source: src, ph: 'ph-wl', ...over });

  test('email entry: saved to the sheet, team notified, visitor confirmed', async () => {
    const r = await post('waitlist.php', wl());
    assert.equal(r.status, 200);
    assert.equal(r.json.emailed, true);
    const row = php.sheet().find((s) => s.type === 'waitlist' && s.email === 'wendy@example.com');
    assert.match(row.courses, /Professional/);
    assert.equal(row.ph_visitor_id, 'ph-wl');
    const team = php.outbox().find((m) => m.subject.includes('Waitlist: wendy@example.com'));
    assert.deepEqual(team.to, ['hello@yogine.dev']);
    assert.match(team.text, /Weekends please/);
    const visitor = php.outbox().find((m) => m.to[0] === 'wendy@example.com');
    assert.match(visitor.subject, /waitlist/);
    assert.equal(visitor.bcc, undefined, 'the team already has its own notice');
    assert.doesNotMatch(visitor.text, /call you|within \d/i, 'no promised timing or call');
  });

  test('phone-only entry is recorded and notified but sends no visitor email', async () => {
    const r = await post('waitlist.php', wl({ email: '', phone: '(555) 010-0199', name: '' }));
    assert.equal(r.status, 200);
    assert.equal(r.json.emailed, false);
    assert.ok(php.sheet().some((s) => s.type === 'waitlist' && s.phone === '(555) 010-0199'));
    assert.ok(php.outbox().some((m) => m.subject.includes('Waitlist: (555) 010-0199')));
    assert.ok(!php.outbox().some((m) => m.to[0] === ''));
  });

  test('needs an email or phone, a valid course, and valid values', async () => {
    const none = await post('waitlist.php', wl({ email: '', phone: '' }));
    assert.equal(none.status, 400);
    assert.equal(none.json.field, 'contact');
    assert.equal((await post('waitlist.php', wl({ email: 'bad' }))).status, 400);
    assert.equal((await post('waitlist.php', wl({ courses: [] }))).status, 400);
    assert.equal((await post('waitlist.php', wl({ courses: ['enterprise-sdlc'] }))).status, 400, 'enterprise is by contact only');
    assert.equal((await post('waitlist.php', wl({ courses: ['nonsense'] }))).status, 400);
  });

  test('a repeat within a day is accepted without duplicating anything', async () => {
    const count = () => php.sheet().filter((s) => s.type === 'waitlist' && s.email === 'wendy@example.com').length;
    const before = count();
    assert.equal((await post('waitlist.php', wl())).status, 200);
    assert.equal(count(), before);
  });

  test('several courses at once', async () => {
    const r = await post('waitlist.php', wl({ email: 'multi@example.com', courses: ['advanced', 'professional', 'professional'] }));
    assert.equal(r.status, 200);
    const row = php.sheet().find((s) => s.email === 'multi@example.com');
    assert.match(row.courses, /Advanced/);
    assert.match(row.courses, /Professional/);
  });
});

describe('contact.php', () => {
  const ct = (over = {}) => ({ name: 'Casey Lead', email: 'casey@example.com', phone: '', interest: 'solutions', company: 'Acme', teamSize: '200', message: 'We want to roll out agents across engineering.', source: src, ph: 'ph-ct', ...over });

  test('with email: team gets everything and replies go to the visitor; visitor gets a copy', async () => {
    const r = await post('contact.php', ct());
    assert.equal(r.status, 200);
    assert.equal(r.json.emailed, true);
    const team = php.outbox().find((m) => m.subject.includes('Contact:') && m.reply_to === 'casey@example.com');
    assert.match(team.text, /Acme/);
    assert.match(team.text, /Team size: 200/);
    assert.match(team.text, /Solutions for my organization/);
    const visitor = php.outbox().find((m) => m.to[0] === 'casey@example.com' && m.subject.includes('received'));
    assert.match(visitor.text, /roll out agents/);
    assert.doesNotMatch(visitor.text, /call you|within \d/i);
  });

  test('phone only: team notified, no visitor email', async () => {
    const r = await post('contact.php', ct({ email: '', phone: '555 010 0100' }));
    assert.equal(r.status, 200);
    assert.equal(r.json.emailed, false);
    assert.match(php.read('contacts.csv'), /555 010 0100/);
  });

  test('validation', async () => {
    assert.equal((await post('contact.php', ct({ name: '' }))).status, 400);
    assert.equal((await post('contact.php', ct({ email: '', phone: '' }))).json.field, 'contact');
    assert.equal((await post('contact.php', ct({ message: 'hi' }))).status, 400);
    assert.equal((await post('contact.php', ct({ email: 'bad' }))).status, 400);
  });

  test('an unknown interest falls back to Other instead of failing', async () => {
    const r = await post('contact.php', ct({ interest: 'weird', email: 'other@example.com' }));
    assert.equal(r.status, 200);
    assert.ok(php.outbox().some((m) => m.subject.includes('Something else')));
  });
});

describe('stripe-webhook.php', () => {
  const send = (evt) => postRaw('stripe-webhook.php', evt.payload, { 'Content-Type': 'application/json', 'Stripe-Signature': evt.header });

  test('a paid checkout emails the buyer the right course and date and marks the lead paid', async () => {
    const l = await post('lead.php', lead({ course: 'paid-ok', session: 'k1', email: 'buyer@example.com', name: 'Pat Buyer' }));
    const r = await send(stripeEvent({ id: 'cs_1', ref: `paid-ok_k1_${l.json.leadId}` }));
    assert.equal(r.text, 'OK');
    const mail = php.outbox().find((m) => m.to[0] === 'buyer@example.com' && m.subject.includes('registered'));
    assert.match(mail.subject, /Paid course with a link \(Dec 16, 2026\)/);
    assert.match(mail.text, /Paid: \$495\.00/);
    assert.match(mail.text, /India Community Center/);
    assert.match(mail.text, /refund-policy\//);
    const paid = php.sheet().find((s) => s.lead_id === l.json.leadId && s.status === 'paid');
    assert.equal(paid.amount, '495.00');
  });

  test('Stripe retrying the same event does not send a second email', async () => {
    const count = () => php.outbox().filter((m) => m.to[0] === 'buyer@example.com' && m.subject.includes('registered')).length;
    const before = count();
    const r = await send(stripeEvent({ id: 'cs_1', ref: 'paid-ok_k1' }));
    assert.equal(r.text, 'Already sent');
    assert.equal(count(), before);
  });

  test('a payment without a lead id still gets its email', async () => {
    const r = await send(stripeEvent({ id: 'cs_2', ref: 'paid-ok_k1', email: 'nolead@example.com' }));
    assert.equal(r.text, 'OK');
    assert.ok(php.outbox().some((m) => m.to[0] === 'nolead@example.com'));
  });

  test('an unrecognised reference still confirms, and says details will follow', async () => {
    const r = await send(stripeEvent({ id: 'cs_3', ref: 'ghost_zz', email: 'ghost@example.com' }));
    assert.equal(r.text, 'OK');
    const mail = php.outbox().find((m) => m.to[0] === 'ghost@example.com');
    assert.match(mail.text, /separately/);
  });

  test('a bad signature is refused; unpaid and other events are ignored', async () => {
    const evt = stripeEvent({ id: 'cs_4', ref: 'paid-ok_k1' });
    assert.equal((await postRaw('stripe-webhook.php', evt.payload, { 'Stripe-Signature': 't=1,v1=deadbeef' })).status, 400);
    assert.equal((await send(stripeEvent({ id: 'cs_5', ref: 'paid-ok_k1', paid: 'unpaid' }))).text, 'Not paid yet');
    assert.equal((await send(stripeEvent({ id: 'cs_6', ref: 'paid-ok_k1', type: 'charge.refunded' }))).text, 'Ignored');
  });
});

describe('rate limiting', () => {
  test('a visitor who keeps submitting is slowed down', async () => {
    let limited = 0;
    for (let i = 0; i < 12; i++) {
      const r = await post('contact.php', { name: 'Spam Bot', email: `spam${i}@example.com`, message: 'this is a message' });
      if (r.status === 429) limited++;
    }
    assert.ok(limited > 0, 'expected at least one 429');
  });
});

test('data directory is protected from the web server', () => {
  assert.match(php.read('.htaccess'), /Require all denied/);
});

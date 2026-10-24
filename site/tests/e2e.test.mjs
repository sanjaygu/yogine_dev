// Real journeys in a real browser against the built site and the PHP endpoints (file mode).
// Needs a fixture build: npm run build:fixture
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { startPhp } from './helpers.mjs';
import { launch } from './browser.mjs';

const root = resolve(import.meta.dirname, '..');
const dist = resolve(root, 'dist-fixture');
const PORT = 8084;
const SITE = `http://127.0.0.1:${PORT}`;
let php;
let page;

before(async () => {
  assert.ok(existsSync(dist), 'run `npm run build:fixture` first');
  php = await startPhp('e2e', { docroot: dist, catalogFile: resolve(dist, 'api/catalog.json'), port: PORT });
  page = await launch('e2e');
  await page.viewport(1280, 900);
  await page.stubUrl('*book.stripe.com*', '<title>stripe stub</title>');
});
after(() => {
  page?.close();
  php?.stop();
});

describe('without JavaScript', () => {
  test('forms cannot be submitted, and say how to reach us instead', async () => {
    await page.send('Emulation.setScriptExecutionDisabled', { value: true });
    for (const [path, form] of [['/contact/', '#contact-form'], ['/waitlist/', '#wl-form']]) {
      await page.goto(`${SITE}${path}`);
      assert.equal(await page.eval(`document.querySelector("${form} button[type=submit]").disabled`), true, `${path} submit is disabled`);
      assert.equal(await page.eval(`document.querySelector("${form}").method`), 'post', 'details can never end up in the address bar');
    }
    await page.send('Emulation.setScriptExecutionDisabled', { value: false });
    await page.goto(`${SITE}/contact/`);
    assert.equal(await page.eval('document.querySelector("#contact-form button[type=submit]").disabled'), false, 'enabled once the script is running');
  });
});

describe('waitlist', () => {
  test('submitting nothing shows a focused error summary and marks the fields', async () => {
    await page.goto(`${SITE}/waitlist/`);
    await page.click('#wl-form button[type=submit]');
    await page.waitFor('!document.querySelector("#wl-form [data-error-summary]").hidden');
    assert.equal(await page.eval('document.activeElement.hasAttribute("data-error-summary")'), true, 'focus moves to the summary');
    const summary = await page.text('#wl-form [data-error-summary]');
    assert.match(summary, /Choose at least one course/);
    assert.match(summary, /Enter an email or a phone number/);
    assert.equal(await page.eval('document.querySelector("#wl-email").getAttribute("aria-invalid")'), 'true');
    assert.equal(await page.eval('document.querySelector("#wl-email").getAttribute("aria-describedby").includes("err-")'), true);
    assert.equal(await page.eval('document.querySelector("#wl-err-courses").hidden'), false);
  });

  test('a summary link moves focus to the field', async () => {
    await page.click('#wl-form [data-error-summary] a[data-focus="wl-email"]');
    assert.equal(await page.eval('document.activeElement.id'), 'wl-email');
  });

  test('a bad email is caught in the browser before anything is sent', async () => {
    await page.check('#wl-course-professional');
    await page.set('#wl-email', 'not-an-email');
    await page.click('#wl-form button[type=submit]');
    await page.waitFor('document.querySelector("#wl-err-email").textContent.length > 0');
    assert.match(await page.text('#wl-err-email'), /valid email/);
  });

  test('email entry: success message, sheet row, team notice and visitor confirmation', async () => {
    await page.set('#wl-name', 'Wendy Waits');
    await page.set('#wl-email', 'wendy@example.com');
    await page.set('#wl-note', 'Weekends please');
    await page.click('#wl-form button[type=submit]');
    await page.waitFor('!document.querySelector("#wl-success").hidden');
    const msg = await page.text('#wl-success');
    assert.match(msg, /on the list/);
    assert.match(msg, /emailed a confirmation to wendy@example.com/);
    assert.equal(await page.eval('document.querySelector("#wl-form").hidden'), true);
    const row = php.sheet().find((s) => s.type === 'waitlist' && s.email === 'wendy@example.com');
    assert.match(row.courses, /Professional/);
    assert.equal(row.page, '/waitlist/');
    assert.ok(row.timezone, 'timezone recorded');
    assert.ok(php.outbox().some((m) => m.subject.includes('Waitlist: wendy@example.com') && m.reply_to === 'wendy@example.com'));
    assert.ok(php.outbox().some((m) => m.to[0] === 'wendy@example.com'));
  });

  test('phone-only entry: saved, with a message that promises no call and no email', async () => {
    await page.goto(`${SITE}/waitlist/?course=advanced`);
    assert.equal(await page.eval('document.querySelector("#wl-course-advanced").checked'), true, 'course preselected from the link');
    await page.set('#wl-phone', '(555) 010-0199');
    await page.click('#wl-form button[type=submit]');
    await page.waitFor('!document.querySelector("#wl-success").hidden');
    const msg = await page.text('#wl-success');
    assert.match(msg, /saved your request/);
    assert.doesNotMatch(msg, /call|emailed/i);
    assert.ok(php.sheet().some((s) => s.type === 'waitlist' && s.phone === '(555) 010-0199'));
  });
});

describe('contact', () => {
  test('the interest comes from the link, and organisation fields appear only when they apply', async () => {
    await page.goto(`${SITE}/contact/?interest=solutions`);
    assert.equal(await page.eval('document.querySelector("#contact-interest").value'), 'solutions');
    assert.equal(await page.eval('document.querySelector("#orgFields").hidden'), false);
    await page.set('#contact-interest', 'other');
    assert.equal(await page.eval('document.querySelector("#orgFields").hidden'), true);
    await page.set('#contact-interest', 'solutions');
  });

  test('validation: name, contact method and message are required', async () => {
    await page.click('#contact-form button[type=submit]');
    await page.waitFor('!document.querySelector("#contact-form [data-error-summary]").hidden');
    const summary = await page.text('#contact-form [data-error-summary]');
    assert.match(summary, /Enter your name/);
    assert.match(summary, /Enter an email or a phone number/);
    assert.match(summary, /Tell us a little/);
  });

  test('a complete message reaches the team, and the visitor sees a confirmation and gets a copy', async () => {
    await page.set('#contact-name', 'Casey Lead');
    await page.set('#contact-email', 'casey@acme.example');
    await page.set('#contact-company', 'Acme');
    await page.set('#contact-team', '200');
    await page.set('#contact-message', 'We want to roll agents out across engineering.');
    await page.click('#contact-form button[type=submit]');
    await page.waitFor('!document.querySelector("#contact-success").hidden');
    const msg = await page.text('#contact-success');
    assert.match(msg, /we have your message/);
    assert.match(msg, /copy is on its way to casey@acme.example/);
    const team = php.outbox().find((m) => m.subject.includes('Contact:') && m.reply_to === 'casey@acme.example');
    assert.match(team.text, /Company: Acme/);
    assert.match(team.text, /Page: \/contact\//);
    assert.ok(php.outbox().some((m) => m.to[0] === 'casey@acme.example' && m.subject.includes('received')));
  });
});

describe('enroll', () => {
  test('free session: details, registration, thank-you page and optional questions', async () => {
    await page.goto(`${SITE}/enroll/?course=foundation`);
    await page.waitFor('!document.querySelector("#enrollApp").hidden');
    assert.equal(await page.text('#enrollSubmit'), 'Complete registration');
    assert.equal(await page.eval('document.querySelectorAll("input[name=session]").length'), 1);
    assert.equal(await page.eval('document.querySelector("input[name=session]").checked'), true, 'the only session is preselected');
    assert.equal(await page.eval('document.querySelector("#payNote").hidden'), true, 'no refund line for a free course');

    await page.click('#enrollSubmit');
    await page.waitFor('!document.querySelector("#enrollForm [data-error-summary]").hidden');
    assert.match(await page.text('#enrollForm [data-error-summary]'), /Enter your full name/);

    await page.set('#enroll-name', 'Fran Free');
    await page.set('#enroll-email', 'fran@example.com');
    await page.click('#enrollSubmit');
    await page.waitFor('location.pathname === "/thanks/"');
    assert.equal(await page.eval('location.search'), '?type=free');
    await page.waitFor('document.querySelector("#thanksHeading").textContent === "See you there."');

    const lead = php.sheet().find((s) => s.type === 'lead' && s.email === 'fran@example.com');
    assert.equal(lead.course, 'Coding with AI Agents and Skills');
    assert.ok(php.sheet().some((s) => s.type === 'lead_update' && s.lead_id === lead.lead_id && s.status === 'registered'));
    assert.ok(php.outbox().some((m) => m.to[0] === 'fran@example.com' && /registered/i.test(m.subject)));

    assert.equal(await page.eval('document.querySelector("#profileCard").hidden'), false, 'optional questions offered');
    await page.set('#p-coding', '3-7');
    await page.set('#p-expect', 'A review skill');
    await page.click('#profileForm button[type=submit]');
    await page.waitFor('!document.querySelector("#profileDone").hidden');
    assert.ok(php.sheet().some((s) => s.type === 'lead_update' && s.lead_id === lead.lead_id && s.coding_experience === '3-7' && s.expectations === 'A review skill'));
  });

  test('paid session: the lead is saved first, then the visitor goes to Stripe with the lead in the reference', async () => {
    await page.goto(`${SITE}/enroll/?course=advanced`);
    await page.waitFor('!document.querySelector("#enrollApp").hidden');
    assert.match(await page.text('#enrollSubmit'), /Continue to payment — \$495/);
    assert.equal(await page.eval('document.querySelector("#payNote").hidden'), false);

    await page.set('#enroll-name', 'Pat Payer');
    await page.set('#enroll-email', 'pat@example.com');
    await page.set('#enroll-phone', '555 010 0123');
    await page.click('#enrollSubmit');
    await page.waitFor('location.hostname === "book.stripe.com"', 8000);
    const url = new URL(await page.eval('location.href'));
    const lead = php.sheet().find((s) => s.type === 'lead' && s.email === 'pat@example.com');
    assert.equal(url.searchParams.get('client_reference_id'), `advanced_t4_${lead.lead_id}`);
    assert.equal(url.searchParams.get('prefilled_email'), 'pat@example.com');
    assert.equal(lead.phone, '555 010 0123');
    assert.equal(lead.status, 'lead');
    assert.ok(php.sheet().some((s) => s.type === 'lead_update' && s.lead_id === lead.lead_id && s.status === 'payment_started'));
  });

  test('a paid course with no payment link, or no date, offers the waitlist instead of a dead end', async () => {
    await page.goto(`${SITE}/enroll/?course=professional`);
    await page.waitFor('!document.querySelector("#enrollApp").hidden');
    assert.equal(await page.eval('document.querySelector("#enrollForm").hidden'), true);
    assert.equal(await page.eval('document.querySelector("#waitlistPanel").hidden'), false);
    assert.match(await page.text('#waitlistReason'), /payment is not open/);
    assert.equal(await page.eval('document.querySelector("#ew-course-professional").checked'), true);
    assert.equal(await page.eval('document.querySelector("#enroll-course option[value=enterprise-sdlc]")'), null, 'enterprise is by contact only');
  });

  test('switching the course swaps the booking form and the waitlist', async () => {
    await page.set('#enroll-course', 'foundation');
    assert.equal(await page.eval('document.querySelector("#enrollForm").hidden'), false);
    assert.equal(await page.eval('document.querySelector("#waitlistPanel").hidden'), true);
  });

  test('the form survives a refresh', async () => {
    await page.goto(`${SITE}/enroll/?course=foundation`);
    await page.waitFor('!document.querySelector("#enrollApp").hidden');
    await page.set('#enroll-name', 'Rae Refresh');
    await page.set('#enroll-email', 'rae@example.com');
    await page.goto(`${SITE}/enroll/?course=foundation`);
    await page.waitFor('!document.querySelector("#enrollApp").hidden');
    assert.equal(await page.eval('document.querySelector("#enroll-name").value'), 'Rae Refresh');
  });
});

describe('sessions page', () => {
  test('lists the published sessions with accessible, specific reserve links', async () => {
    await page.goto(`${SITE}/sessions/`);
    assert.equal(await page.eval('document.querySelectorAll(".event-row:not([hidden])").length'), 4);
    const names = await page.eval('[...document.querySelectorAll(".event-row .btn")].map(b => b.textContent.replace(/\\s+/g, " ").trim())');
    assert.ok(names.every((n) => n.startsWith('Reserve a seat — ')), names.join(' | '));
    await page.click('.event-row:last-child .btn');
    await page.waitFor('location.pathname === "/enroll/"');
    assert.match(await page.eval('location.search'), /course=advanced&session=t4/);
  });
});

describe('session extras', () => {
  test('single-day sessions offer a calendar file, venues offer a map, and a run of dates has no calendar link', async () => {
    await page.goto(`${SITE}/sessions/`);
    const rows = JSON.parse(await page.eval(`JSON.stringify([...document.querySelectorAll('.event-row')].map(r => ({ date: r.querySelector('.event-date').textContent.trim(), cal: r.querySelector('a[href$=".ics"]')?.getAttribute('href') ?? null, map: r.querySelector('a[href*="google.com/maps"]')?.getAttribute('href') ?? null })))`));
    assert.equal(rows.length, 4);
    const [foundation, proInPerson, proVirtual, advanced] = rows;
    assert.match(foundation.cal, /^\/calendar\/t1\.ics$/);
    assert.equal(foundation.map, null, 'a virtual session has no map');
    assert.match(proInPerson.cal, /^\/calendar\/t2\.ics$/);
    assert.match(proInPerson.map, /query=India%20Community%20Center.*Milpitas/);
    assert.equal(proVirtual.cal, null, 'three separate dates would show as one long block');
    assert.match(advanced.cal, /^\/calendar\/t4\.ics$/);
  });

  test('the calendar files are valid: timed sessions in UTC, all-day sessions with an exclusive end, lines folded', async () => {
    const timed = await (await fetch(`${SITE}/calendar/t1.ics`)).text();
    assert.match(timed, /^BEGIN:VCALENDAR\r\n/);
    assert.match(timed, /SUMMARY:Coding with AI Agents and Skills\r\n/);
    assert.match(timed, /DTSTART:\d{8}T\d{6}Z\r\n/);
    assert.match(timed, /DTEND:\d{8}T\d{6}Z\r\n/);
    assert.match(timed, /UID:t1@yogine\.dev/);
    assert.ok(timed.split('\r\n').every((l) => l.length <= 75), 'no line longer than 75 characters');

    const allDay = await (await fetch(`${SITE}/calendar/t2.ics`)).text();
    const [, start, end] = /DTSTART;VALUE=DATE:(\d{8})\r\nDTEND;VALUE=DATE:(\d{8})/.exec(allDay);
    assert.equal(Number(new Date(`${end.slice(0, 4)}-${end.slice(4, 6)}-${end.slice(6)}`)) - Number(new Date(`${start.slice(0, 4)}-${start.slice(4, 6)}-${start.slice(6)}`)), 86400000, 'a one-day event ends the next day');
    assert.match(allDay, /LOCATION:India Community Center \(ICC\)\\, 525 Los Coches St\\, Milpitas/, 'commas are escaped');

    assert.equal((await fetch(`${SITE}/calendar/t3.ics`)).status, 404);
  });

  test('the training page compares the four levels, and the table becomes stacked cards on a phone', async () => {
    await page.goto(`${SITE}/training/`);
    assert.equal(await page.eval('document.querySelectorAll(".compare tbody tr").length'), 4);
    assert.equal(await page.eval('[...document.querySelectorAll(".compare tbody th")].every(th => th.getAttribute("scope") === "row" && th.querySelector("a"))'), true);
    assert.match(await page.text('.compare'), /Free/);
    assert.match(await page.text('.compare'), /\$495/);
    assert.match(await page.text('.compare'), /Custom/);
    await page.viewport(390, 800, true);
    await page.goto(`${SITE}/training/`);
    assert.equal(await page.eval('getComputedStyle(document.querySelector(".compare td")).display'), 'grid', 'cells stack with their labels');
    assert.equal(await page.eval('document.documentElement.scrollWidth <= innerWidth'), true, 'no sideways scrolling');
    await page.viewport(1280, 900);
  });

  test('pages carry a link-preview image that exists', async () => {
    await page.goto(`${SITE}/`);
    assert.equal(await page.eval('document.querySelector("meta[property=\\"og:image\\"]").content'), 'https://yogine.dev/og-image.png');
    assert.equal(await page.eval('document.querySelector("meta[name=\\"twitter:card\\"]").content'), 'summary_large_image');
    const res = await fetch(`${SITE}/og-image.png`);
    assert.equal(res.status, 200);
    assert.equal((await res.arrayBuffer()).byteLength > 10000, true);
  });
});

test('no script errors on any page', async () => {
  for (const p of ['/', '/training/', '/solutions/', '/sessions/', '/enroll/', '/waitlist/', '/contact/', '/thanks/', '/privacy/']) await page.goto(`${SITE}${p}`);
  assert.deepEqual(page.consoleErrors, []);
});

describe('accessibility (axe, WCAG 2.2 AA and best practice)', () => {
  const audit = async (label) => {
    const v = await page.axe();
    assert.deepEqual(v, [], `${label}: ${JSON.stringify(v)}`);
  };

  test('every page', async () => {
    for (const p of ['/', '/training/', '/solutions/', '/sessions/', '/enroll/', '/waitlist/', '/contact/', '/thanks/', '/refund-policy/', '/privacy/']) {
      await page.goto(`${SITE}${p}`);
      await audit(p);
    }
  });

  test('enrolling: free, paid, and the waitlist state', async () => {
    for (const course of ['foundation', 'advanced', 'professional']) {
      await page.goto(`${SITE}/enroll/?course=${course}`);
      await page.waitFor('!document.querySelector("#enrollApp").hidden');
      await audit(`/enroll/?course=${course}`);
    }
  });

  test('forms showing their errors', async () => {
    for (const [path, form] of [['/waitlist/', '#wl-form'], ['/contact/', '#contact-form']]) {
      await page.goto(`${SITE}${path}`);
      await page.click(`${form} button[type=submit]`);
      await page.waitFor(`!document.querySelector("${form} [data-error-summary]").hidden`);
      await audit(`${path} with errors`);
    }
    await page.eval('sessionStorage.clear()'); // an earlier test left a saved, valid form behind
    await page.goto(`${SITE}/enroll/?course=foundation`);
    await page.waitFor('!document.querySelector("#enrollApp").hidden');
    await page.click('#enrollSubmit');
    await page.waitFor('!document.querySelector("#enrollForm [data-error-summary]").hidden');
    await audit('/enroll/ with errors');
  });

  test('the thank-you page with the optional questions', async () => {
    await page.goto(`${SITE}/thanks/?type=free`);
    await page.eval('sessionStorage.setItem("yogine_lead", JSON.stringify({ leadId: "LABCDEFGHJK", course: "foundation", session: "t1", free: true }))');
    await page.goto(`${SITE}/thanks/?type=free`);
    assert.equal(await page.eval('document.querySelector("#profileCard").hidden'), false);
    await audit('/thanks/ with questions');
  });

  test('on a phone-sized screen too', async () => {
    await page.viewport(390, 800, true);
    for (const p of ['/', '/training/', '/sessions/', '/enroll/?course=advanced', '/contact/']) {
      await page.goto(`${SITE}${p}`);
      if (p.startsWith('/enroll')) await page.waitFor('!document.querySelector("#enrollApp").hidden');
      await audit(`${p} at 390px`);
      assert.equal(await page.eval('document.documentElement.scrollWidth <= innerWidth'), true, `${p} has no horizontal scroll`);
    }
    await page.viewport(1280, 900);
  });
});

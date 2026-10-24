import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (name) => JSON.parse(readFileSync(resolve('src/data', name), 'utf8'));
const iso = (d) => d.toISOString().slice(0, 10);
const label = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

// The fixture holds sample sessions as "days from today", so they stay in the future whenever the site is built.
function fixtureSessions(rows) {
  return rows.map(({ inDays, lasts = 0, time, startsAt, minutes, ...s }) => {
    const start = new Date(Date.now() + inDays * 86400000);
    const end = new Date(start.getTime() + lasts * 86400000);
    const out = { ...s, date: label(start) + (time ? ` · ${time}` : ''), start: iso(start), end: iso(end) };
    if (startsAt) {
      // A clock time such as "16:00:00-08:00" on the start day, lasting `minutes`, gives a timed event.
      out.startAt = `${out.start}T${startsAt}`;
      out.endAt = new Date(new Date(out.startAt).getTime() + minutes * 60000).toISOString();
    }
    return out;
  });
}

// Each paid course keeps a live link and a test-mode link. A staging build (YOGINE_STRIPE_MODE=test) uses the
// test links and a production build the live ones; the other link never reaches the built files. With no test
// link set, the course falls back to the waitlist rather than sending a test card to a live page.
export function chooseStripeLinks(catalog, env) {
  const mode = env.YOGINE_STRIPE_MODE === 'test' ? 'test' : 'live';
  const courses = catalog.courses.map(({ paymentLinkTest, ...course }) => {
    if (course.free || course.custom) return course;
    return { ...course, paymentLink: (mode === 'test' ? paymentLinkTest : course.paymentLink) || '' };
  });
  return { ...catalog, courses, stripeMode: mode };
}

export function loadCatalog(env = process.env) {
  const base = read('catalog.json');
  if (env.YOGINE_CATALOG !== 'catalog.fixture.json') return chooseStripeLinks(base, env);
  const fixture = read('catalog.fixture.json');
  return chooseStripeLinks({ ...base, venues: fixture.venues, sessions: fixtureSessions(fixture.sessions) }, env);
}

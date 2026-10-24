import { loadCatalog } from './catalog-data.mjs';

const data = loadCatalog();

export const SITE_URL = 'https://yogine.dev/';
export const COURSES = data.courses;
export const VENUES = data.venues;
export const SESSIONS = data.sessions.map((s) => ({ ...s, venue: s.venue ? VENUES[s.venue] : null }));

export const courseBySlug = (slug) => COURSES.find((c) => c.slug === slug);

const today = () => new Date().toISOString().slice(0, 10);
export const isUpcoming = (s) => s.end >= today();
export const upcoming = () => SESSIONS.filter(isUpcoming).sort((a, b) => a.start.localeCompare(b.start));
export const upcomingFor = (slug) => upcoming().filter((s) => s.course === slug);

export const sessionLocation = (s) => (s.venue ? `SF Bay Area · ${s.venue.name}` : s.location || '');
export const sessionAddress = (s) =>
  s.venue ? `${s.venue.street}, ${s.venue.city}, ${s.venue.region} ${s.venue.zip}` : '';

export const nextStartLabel = (slug) => {
  const next = upcomingFor(slug)[0];
  if (!next) return '';
  const d = new Date(`${next.start}T00:00:00`);
  return `Next session ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
};

export const priceLabel = (c) => (c.custom ? 'Custom' : c.free ? 'Free' : `$${c.price}`);

export const eventSchema = () =>
  upcoming().map((s) => {
    const c = courseBySlug(s.course);
    const item = {
      '@type': 'Event',
      name: c.name,
      description: c.audience,
      startDate: s.startAt || s.start,
      endDate: s.endAt || s.end,
      eventStatus: 'https://schema.org/EventScheduled',
      organizer: { '@type': 'Organization', name: 'yogine.dev', url: SITE_URL },
      offers: {
        '@type': 'Offer',
        price: String(c.price),
        priceCurrency: 'USD',
        availability: 'https://schema.org/InStock',
        url: `${SITE_URL}enroll/?course=${c.slug}&session=${s.id}`,
      },
    };
    if (s.virtual) {
      item.eventAttendanceMode = 'https://schema.org/OnlineEventAttendanceMode';
      item.location = { '@type': 'VirtualLocation', url: SITE_URL };
    } else {
      item.eventAttendanceMode = 'https://schema.org/OfflineEventAttendanceMode';
      item.location = {
        '@type': 'Place',
        name: s.venue.name,
        address: {
          '@type': 'PostalAddress',
          streetAddress: s.venue.street,
          addressLocality: s.venue.city,
          addressRegion: s.venue.region,
          postalCode: s.venue.zip,
          addressCountry: 'US',
        },
      };
    }
    return item;
  });

export const mapUrl = (s) => (s.venue ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${s.venue.name}, ${sessionAddress(s)}`)}` : '');

// Only single-day sessions get a calendar file; a run of separate dates would show as one long block.
export const hasCalendar = (s) => s.start === s.end;

const icsText = (v) => String(v).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const icsUtc = (iso) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
const icsDay = (d) => d.replace(/-/g, '');
const nextDay = (d) => new Date(new Date(`${d}T00:00:00Z`).getTime() + 86400000).toISOString().slice(0, 10);

// Lines longer than 75 characters must be folded onto continuation lines that start with a space.
const fold = (line) => (line.length <= 75 ? line : line.match(/.{1,74}/g).join('\r\n '));

export function icsFor(s) {
  const c = courseBySlug(s.course);
  const when = s.startAt && s.endAt
    ? [`DTSTART:${icsUtc(s.startAt)}`, `DTEND:${icsUtc(s.endAt)}`]
    : [`DTSTART;VALUE=DATE:${icsDay(s.start)}`, `DTEND;VALUE=DATE:${icsDay(nextDay(s.end))}`];
  const where = s.venue ? `${s.venue.name}, ${sessionAddress(s)}` : s.location;
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//yogine.dev//Sessions//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${s.id}@yogine.dev`,
    `DTSTAMP:${icsUtc(new Date().toISOString())}`,
    ...when,
    `SUMMARY:${icsText(c.name)}`,
    `LOCATION:${icsText(where)}`,
    `DESCRIPTION:${icsText(`${c.level}. Details and changes: ${SITE_URL}sessions/`)}`,
    `URL:${SITE_URL}sessions/`,
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.map(fold).join('\r\n') + '\r\n';
}

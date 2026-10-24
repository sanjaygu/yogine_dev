import { SESSIONS, upcoming, hasCalendar, icsFor } from '../../lib/catalog.js';

export function getStaticPaths() {
  return upcoming().filter(hasCalendar).map((s) => ({ params: { id: s.id } }));
}

export function GET({ params }) {
  const session = SESSIONS.find((s) => s.id === params.id);
  return new Response(icsFor(session), { headers: { 'Content-Type': 'text/calendar; charset=utf-8' } });
}

import { firstTouch, visitorId } from './analytics.js';

export const FALLBACK = 'hello@yogine.dev';

// Only what the form needs: where the visitor was, how they got here, and coarse device details.
export function sourceInfo() {
  const touch = firstTouch();
  return {
    page: location.pathname,
    landing: touch.landing,
    referrer: touch.referrer,
    utm: touch.utm,
    device: matchMedia('(pointer: coarse)').matches || innerWidth < 820 ? 'mobile' : 'desktop',
    language: navigator.language || '',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || '',
  };
}

export async function postJson(endpoint, body, { keepalive = false } = {}) {
  const ph = await visitorId();
  try {
    const res = await fetch(`/api/${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, source: sourceInfo(), ph }),
      keepalive,
    });
    const json = await res.json().catch(() => ({}));
    return { ok: res.ok && json.ok === true, status: res.status, json };
  } catch {
    return { ok: false, status: 0, json: {} };
  }
}

export const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
export const isPhone = (v) => v.replace(/\D/g, '').length >= 7;

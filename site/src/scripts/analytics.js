// Analytics (PostHog) runs only after the visitor accepts. Before that, nothing is loaded and nothing is stored.
// With no project key configured (local work), every function here does nothing.
const KEY = import.meta.env.PUBLIC_POSTHOG_KEY;
const HOST = import.meta.env.PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com';
const CONSENT_KEY = 'yogine_consent';
const FIRST_TOUCH_KEY = 'yogine_first_touch';

export const analyticsConfigured = Boolean(KEY);

let posthog = null;
let ready = null;

export function getConsent() {
  try {
    return localStorage.getItem(CONSENT_KEY);
  } catch {
    return null;
  }
}

function currentTouch() {
  const params = new URLSearchParams(location.search);
  const utm = [...params.entries()].filter(([k]) => k.startsWith('utm_')).map(([k, v]) => `${k}=${v}`).join('&');
  return { landing: location.pathname, referrer: document.referrer, utm };
}

// First-touch details are kept only after the visitor has agreed to analytics.
function rememberFirstTouch() {
  try {
    if (!localStorage.getItem(FIRST_TOUCH_KEY)) localStorage.setItem(FIRST_TOUCH_KEY, JSON.stringify(currentTouch()));
  } catch {
    /* storage unavailable */
  }
}

export function firstTouch() {
  if (getConsent() === 'granted') {
    try {
      const saved = JSON.parse(localStorage.getItem(FIRST_TOUCH_KEY) || 'null');
      if (saved) return saved;
    } catch {
      /* fall through */
    }
  }
  return currentTouch();
}

async function load() {
  if (posthog || !KEY) return;
  const { default: ph } = await import('posthog-js');
  ph.init(KEY, {
    api_host: HOST,
    person_profiles: 'identified_only',
    capture_pageview: true,
    capture_pageleave: true,
    autocapture: true,
    capture_heatmaps: true,
    capture_dead_clicks: false,
    disable_surveys: true,
    respect_dnt: true,
    persistence: 'localStorage+cookie',
    session_recording: { maskAllInputs: true },
    debug: import.meta.env.PUBLIC_POSTHOG_DEBUG === '1',
  });
  ph.opt_in_capturing();
  posthog = ph;
}

export function setConsent(value) {
  try {
    localStorage.setItem(CONSENT_KEY, value);
  } catch {
    /* storage unavailable: the choice applies to this page only */
  }
  applyConsent(value);
}

function applyConsent(value) {
  if (!KEY) return;
  if (value === 'granted') {
    rememberFirstTouch();
    ready = load();
  } else {
    if (posthog) posthog.opt_out_capturing();
    try {
      localStorage.removeItem(FIRST_TOUCH_KEY);
    } catch {
      /* storage unavailable */
    }
  }
}

export function initAnalytics() {
  applyConsent(getConsent());
}

export function track(name, props = {}) {
  if (!ready || getConsent() !== 'granted') return;
  ready.then(() => posthog && posthog.capture(name, props)).catch(() => {});
}

// Called when a visitor gives an email, so their earlier anonymous visits join their identity.
export function identify(email, props = {}) {
  if (!ready || getConsent() !== 'granted' || !email) return;
  ready.then(() => posthog && posthog.identify(email.trim().toLowerCase(), props)).catch(() => {});
}

export async function visitorId() {
  if (!ready || getConsent() !== 'granted') return '';
  try {
    await ready;
    return (posthog && posthog.get_distinct_id()) || '';
  } catch {
    return '';
  }
}

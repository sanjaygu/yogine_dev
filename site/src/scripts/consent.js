import { analyticsConfigured, getConsent, setConsent, initAnalytics, track } from './analytics.js';

const banner = document.getElementById('consentBanner');
const reopen = document.getElementById('consentReopen');
const root = document.documentElement;

function show(open) {
  if (!banner) return;
  banner.hidden = !open;
  document.body.classList.toggle('has-consent-banner', open);
  root.classList.toggle('has-consent-banner-html', open);
  if (open) document.body.style.setProperty('--consent-h', `${banner.offsetHeight + 8}px`);
}

if (!analyticsConfigured) {
  if (reopen) reopen.hidden = true;
} else {
  initAnalytics();
  if (getConsent() === null) show(true);
  if (reopen) reopen.hidden = false;

  banner?.addEventListener('click', (e) => {
    const choice = e.target instanceof Element && e.target.closest('[data-consent]')?.getAttribute('data-consent');
    if (!choice) return;
    setConsent(choice);
    show(false);
    if (reopen && document.activeElement && banner.contains(document.activeElement)) reopen.focus();
  });
  reopen?.addEventListener('click', () => {
    show(true);
    banner?.querySelector('button')?.focus();
  });

  // Link and button clicks are the main conversion signals.
  document.addEventListener('click', (e) => {
    const el = e.target instanceof Element ? e.target.closest('a.btn, button.btn') : null;
    if (!el || el.closest('#consentBanner')) return;
    track('cta_click', {
      label: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80),
      href: el.getAttribute('href') || '',
      page: location.pathname,
    });
  });
}

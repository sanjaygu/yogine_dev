import { postJson, FALLBACK } from './api.js';
import { track } from './analytics.js';
import { busy, showGeneralError } from './forms.js';

const LEAD = 'yogine_lead';
const params = new URLSearchParams(location.search);

if (params.get('type') === 'free') {
  document.getElementById('thanksMark').textContent = "✓ you're registered";
  document.getElementById('thanksHeading').textContent = 'See you there.';
  document.getElementById('thanksBody').innerHTML =
    'We’ve emailed your confirmation. Nothing after a few minutes? Check your spam folder, then write to <a class="text-link" href="mailto:hello@yogine.dev">hello@yogine.dev</a>.';
}

let lead = null;
try {
  lead = JSON.parse(sessionStorage.getItem(LEAD) || 'null');
} catch {
  /* storage unavailable */
}

// The lead id lives only in this browser tab. Without it the optional questions are skipped.
if (lead && lead.leadId) {
  track('registration_confirmed', { course: lead.course, session: lead.session, free: lead.free });
  const card = document.getElementById('profileCard');
  const form = document.getElementById('profileForm');
  card.hidden = false;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const button = form.querySelector('button[type="submit"]');
    busy(button, true, 'Saving…');
    const res = await postJson('lead.php', {
      action: 'profile',
      leadId: lead.leadId,
      codingExperience: form.elements.codingExperience.value,
      aiExperience: form.elements.aiExperience.value,
      expectations: form.elements.expectations.value.trim(),
    });
    busy(button, false);
    if (!res.ok) {
      showGeneralError(form, `We couldn't save that. You can skip it, or email ${FALLBACK}.`);
      return;
    }
    form.hidden = true;
    const done = document.getElementById('profileDone');
    done.hidden = false;
    done.setAttribute('tabindex', '-1');
    done.focus();
    try {
      sessionStorage.removeItem(LEAD);
    } catch {
      /* storage unavailable */
    }
  });
}

import { postJson, isEmail, isPhone, FALLBACK } from './api.js';
import { track, identify } from './analytics.js';
import { showErrors, clearErrors, showGeneralError, busy, escapeHtml } from './forms.js';

const data = JSON.parse(document.getElementById('enroll-data').textContent);
const today = new Date().toISOString().slice(0, 10);
const params = new URLSearchParams(location.search);

const app = document.getElementById('enrollApp');
const courseSelect = document.getElementById('enroll-course');
const form = document.getElementById('enrollForm');
const sessionList = document.getElementById('sessionList');
const panel = document.getElementById('waitlistPanel');
const submitBtn = document.getElementById('enrollSubmit');
const payNote = document.getElementById('payNote');

const STORE = 'yogine_enroll'; // in-progress form only, so a refresh does not lose it
const LEAD = 'yogine_lead';

const course = (slug) => data.courses.find((c) => c.slug === slug);
const sessionsFor = (slug) => data.sessions.filter((s) => s.course === slug && s.end >= today).sort((a, b) => a.start.localeCompare(b.start));
const bookable = (c) => sessionsFor(c.slug).length > 0 && (c.free || Boolean(c.paymentLink));

function load() {
  try {
    return JSON.parse(sessionStorage.getItem(STORE) || '{}');
  } catch {
    return {};
  }
}
function save(patch) {
  try {
    sessionStorage.setItem(STORE, JSON.stringify({ ...load(), ...patch }));
  } catch {
    /* storage unavailable */
  }
}

const saved = load();
let selectedCourse = params.get('course') || saved.course || 'foundation';
if (!course(selectedCourse)) selectedCourse = data.courses[0].slug;
let selectedSession = params.get('session') || saved.session || '';

courseSelect.innerHTML = data.courses
  .map((c) => `<option value="${c.slug}">${escapeHtml(c.name)} — ${c.free ? 'Free' : '$' + c.price}${bookable(c) ? '' : ' (no date yet)'}</option>`)
  .join('');

for (const name of ['name', 'email', 'phone']) {
  const input = form.elements[name];
  input.value = saved[name] || '';
  input.addEventListener('input', () => save({ [name]: input.value }));
}

function render() {
  const c = course(selectedCourse);
  courseSelect.value = c.slug;
  const list = sessionsFor(c.slug);
  const canBook = bookable(c);

  form.hidden = !canBook;
  panel.hidden = canBook;
  clearErrors(form);

  if (!canBook) {
    document.getElementById('waitlistReason').textContent = list.length
      ? 'Online payment is not open for this course yet. Tell us how to reach you and we will let you know when it is.'
      : 'Tell us how to reach you and we will let you know when one is.';
    panel.querySelectorAll('input[name="courses"]').forEach((i) => (i.checked = i.value === c.slug));
    return;
  }

  if (!list.some((s) => s.id === selectedSession)) selectedSession = list[0].id;
  sessionList.innerHTML = list
    .map(
      (s) => `<label class="session-pick">
        <input type="radio" name="session" value="${s.id}" id="session-${s.id}" ${s.id === selectedSession ? 'checked' : ''}>
        <span><strong>${escapeHtml(s.date)}</strong><small>${escapeHtml(s.where)}${s.address ? ' · ' + escapeHtml(s.address) : ''}</small></span>
      </label>`,
    )
    .join('');
  sessionList.querySelectorAll('input').forEach((input) =>
    input.addEventListener('change', () => {
      selectedSession = input.value;
      save({ session: selectedSession });
      track('session_selected', { course: c.slug, session: selectedSession });
    }),
  );

  submitBtn.textContent = c.free ? 'Complete registration' : `Continue to payment — $${c.price}`;
  payNote.hidden = c.free;
  save({ course: c.slug, session: selectedSession });
}

courseSelect.addEventListener('change', () => {
  selectedCourse = courseSelect.value;
  selectedSession = '';
  track('course_selected', { course: selectedCourse });
  render();
});

function validate() {
  const errors = [];
  const name = form.elements.name.value.trim();
  const email = form.elements.email.value.trim();
  const phone = form.elements.phone.value.trim();
  if (!selectedSession) errors.push({ name: 'session', message: 'Choose a session' });
  if (name.length < 2) errors.push({ name: 'name', message: 'Enter your full name' });
  if (!isEmail(email)) errors.push({ name: 'email', message: 'Enter a valid email address, like name@company.com' });
  if (phone && !isPhone(phone)) errors.push({ name: 'phone', message: 'Enter a valid phone number, or leave it blank' });
  return errors;
}

function stripeUrl(c, leadId, email) {
  const url = new URL(c.paymentLink);
  url.searchParams.set('client_reference_id', `${c.slug}_${selectedSession}_${leadId}`);
  url.searchParams.set('prefilled_email', email);
  return url.toString();
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const errors = validate();
  if (errors.length) {
    showErrors(form, errors);
    track('form_error', { form: 'enroll', fields: errors.map((x) => x.name).join(',') });
    return;
  }
  clearErrors(form);

  const c = course(selectedCourse);
  const details = {
    name: form.elements.name.value.trim(),
    email: form.elements.email.value.trim(),
    phone: form.elements.phone.value.trim(),
  };
  const label = submitBtn.textContent;
  busy(submitBtn, true, c.free ? 'Registering…' : 'Saving…');

  const lead = await postJson('lead.php', { ...details, course: c.slug, session: selectedSession, website: form.elements.website.value });
  if (!lead.ok) {
    busy(submitBtn, false);
    submitBtn.textContent = label;
    showGeneralError(form, lead.status === 400 && lead.json.error ? lead.json.error : `We couldn't save your details. Please try again, or email ${FALLBACK}.`);
    track('form_error', { form: 'enroll', status: lead.status });
    return;
  }
  const leadId = lead.json.leadId;
  identify(details.email, { name: details.name });
  track('details_submitted', { course: c.slug, session: selectedSession, free: c.free });
  try {
    sessionStorage.setItem(LEAD, JSON.stringify({ leadId, course: c.slug, session: selectedSession, free: c.free }));
  } catch {
    /* storage unavailable: the optional questions after payment are skipped */
  }

  if (c.free) {
    const reg = await postJson('register.php', { ...details, course: c.slug, event: selectedSession, leadId });
    if (!reg.ok) {
      busy(submitBtn, false);
      submitBtn.textContent = label;
      showGeneralError(form, `We couldn't complete your registration. Please try again, or email ${FALLBACK} and we'll register you.`);
      track('form_error', { form: 'enroll', status: reg.status });
      return;
    }
    track('registered', { course: c.slug, session: selectedSession });
    sessionStorage.removeItem(STORE);
    location.assign('/thanks/?type=free');
    return;
  }

  track('payment_started', { course: c.slug, session: selectedSession, price: c.price });
  busy(submitBtn, true, 'Redirecting to payment…');
  // The status call is a courtesy: never hold the visitor back from paying for it.
  await Promise.race([postJson('lead.php', { action: 'status', leadId, status: 'payment_started' }, { keepalive: true }), new Promise((r) => setTimeout(r, 1500))]);
  location.assign(stripeUrl(c, leadId, details.email));
});

app.hidden = false;
render();

// Coming back from the payment page with the browser's Back button restores this page mid-redirect.
window.addEventListener('pageshow', (e) => {
  if (e.persisted) {
    busy(submitBtn, false);
    render();
  }
});

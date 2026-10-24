import { postJson, isEmail, isPhone, FALLBACK } from './api.js';
import { track, identify } from './analytics.js';

const val = (form, name) => (form.elements[name]?.value ?? '').trim();

function fieldEl(form, name) {
  return form.querySelector(`[data-field="${name}"]`);
}
function errorEl(form, name) {
  return form.querySelector(`[data-error-for="${name}"]`);
}

export function clearErrors(form) {
  form.querySelectorAll('[data-error-for]').forEach((el) => {
    el.hidden = true;
    el.textContent = '';
  });
  form.querySelectorAll('[aria-invalid]').forEach((el) => {
    el.removeAttribute('aria-invalid');
    if (el.dataset.describe) el.setAttribute('aria-describedby', el.dataset.describe);
    else el.removeAttribute('aria-describedby');
  });
  const summary = form.querySelector('[data-error-summary]');
  if (summary) {
    summary.hidden = true;
    summary.innerHTML = '';
  }
  const general = form.querySelector('[data-form-error]');
  if (general) general.hidden = true;
}

// errors: [{ name, message, focus }] where name is a field name or a group (courses, contact).
export function showErrors(form, errors) {
  clearErrors(form);
  const links = [];
  for (const { name, message, focus } of errors) {
    const target = focus || name;
    const input = form.elements[target];
    const holder = errorEl(form, name);
    if (holder) {
      holder.textContent = message;
      holder.hidden = false;
    }
    const controls = name === 'contact' ? ['email', 'phone'] : [target];
    controls.forEach((c) => {
      const el = form.elements[c];
      if (el && !(el instanceof RadioNodeList)) {
        el.setAttribute('aria-invalid', 'true');
        if (holder) el.setAttribute('aria-describedby', `${el.dataset.describe || ''} ${holder.id}`.trim());
      }
    });
    const id = input instanceof RadioNodeList ? input[0]?.id : input?.id;
    links.push(`<li><a href="#${id || ''}" data-focus="${id || ''}">${message}</a></li>`);
  }
  const summary = form.querySelector('[data-error-summary]');
  if (summary) {
    summary.innerHTML = `<h2>There is a problem</h2><ul>${links.join('')}</ul>`;
    summary.hidden = false;
    summary.focus();
    summary.querySelectorAll('a[data-focus]').forEach((a) =>
      a.addEventListener('click', (e) => {
        e.preventDefault();
        document.getElementById(a.getAttribute('data-focus'))?.focus();
      }),
    );
  }
}

export function showGeneralError(form, message) {
  const el = form.querySelector('[data-form-error]');
  if (!el) return;
  el.textContent = message;
  el.hidden = false;
}

export function busy(button, on, busyLabel) {
  if (on) {
    button.dataset.label = button.textContent;
    button.disabled = true;
    button.innerHTML = `<span class="processing"><span class="spinner" aria-hidden="true"></span>${busyLabel}</span>`;
  } else {
    button.disabled = false;
    button.textContent = button.dataset.label || button.textContent;
  }
}

// Shared by the waitlist and contact forms: an email or a phone number, and well-formed values.
export function contactErrors(form) {
  const email = val(form, 'email');
  const phone = val(form, 'phone');
  const errors = [];
  if (!email && !phone) errors.push({ name: 'contact', focus: 'email', message: 'Enter an email or a phone number' });
  if (email && !isEmail(email)) errors.push({ name: 'email', message: 'Enter a valid email address, like name@company.com' });
  if (phone && !isPhone(phone)) errors.push({ name: 'phone', message: 'Enter a valid phone number, or leave it blank' });
  return errors;
}

function checked(form, name) {
  return [...form.querySelectorAll(`input[name="${name}"]:checked`)].map((i) => i.value);
}

function showSuccess(form, html) {
  const box = document.getElementById(form.dataset.success);
  form.hidden = true;
  if (box) {
    box.innerHTML = html;
    box.hidden = false;
    (box.querySelector('h2') || box).setAttribute('tabindex', '-1');
    (box.querySelector('h2') || box).focus();
  }
}

async function submit(form, { endpoint, validate, payload, busyLabel, onSuccess, serverField }) {
  const errors = validate(form);
  if (errors.length) {
    showErrors(form, errors);
    track('form_error', { form: form.dataset.form, fields: errors.map((e) => e.name).join(',') });
    return;
  }
  clearErrors(form);
  const button = form.querySelector('button[type="submit"]');
  busy(button, true, busyLabel);
  const res = await postJson(endpoint, { ...payload(form), website: val(form, 'website') });
  busy(button, false);
  if (res.ok) return onSuccess(form, res.json);
  if (res.status === 400 && res.json.field) {
    showErrors(form, [{ name: res.json.field, focus: serverField?.[res.json.field], message: res.json.error }]);
  } else if (res.status === 429) {
    showGeneralError(form, 'Too many attempts. Please wait a little and try again.');
  } else {
    showGeneralError(form, `We couldn't send that. Please try again, or email ${FALLBACK}.`);
  }
  track('form_error', { form: form.dataset.form, status: res.status });
}

const handlers = {
  waitlist: {
    endpoint: 'waitlist.php',
    busyLabel: 'Sending…',
    validate(form) {
      const errors = [];
      if (checked(form, 'courses').length === 0) errors.push({ name: 'courses', message: 'Choose at least one course' });
      return errors.concat(contactErrors(form));
    },
    payload: (form) => ({ name: val(form, 'name'), email: val(form, 'email'), phone: val(form, 'phone'), courses: checked(form, 'courses'), note: val(form, 'note') }),
    serverField: { contact: 'email' },
    onSuccess(form, json) {
      const email = val(form, 'email');
      track('waitlist_joined', { courses: checked(form, 'courses').join(','), has_email: Boolean(email), has_phone: Boolean(val(form, 'phone')) });
      if (email) identify(email, { name: val(form, 'name') || undefined });
      const line = json.emailed
        ? `We've emailed a confirmation to ${escapeHtml(email)}. We'll use it to let you know when a date is published.`
        : 'We have saved your request and will use the details you gave to let you know when a date is published.';
      showSuccess(form, `<h2>You're on the list</h2><p>${line}</p><p><a class="btn btn-ghost" href="/sessions/">Back to sessions</a></p>`);
    },
  },
  contact: {
    endpoint: 'contact.php',
    busyLabel: 'Sending…',
    validate(form) {
      const errors = [];
      if (val(form, 'name').length < 2) errors.push({ name: 'name', message: 'Enter your name' });
      errors.push(...contactErrors(form));
      if (val(form, 'message').length < 5) errors.push({ name: 'message', message: 'Tell us a little about what you need' });
      return errors;
    },
    payload: (form) => ({ name: val(form, 'name'), email: val(form, 'email'), phone: val(form, 'phone'), interest: val(form, 'interest'), company: val(form, 'company'), teamSize: val(form, 'teamSize'), message: val(form, 'message') }),
    serverField: { contact: 'email' },
    onSuccess(form, json) {
      const email = val(form, 'email');
      track('contact_submitted', { interest: val(form, 'interest'), has_email: Boolean(email), has_phone: Boolean(val(form, 'phone')) });
      if (email) identify(email, { name: val(form, 'name'), company: val(form, 'company') || undefined });
      const copy = json.emailed ? ` A copy is on its way to ${escapeHtml(email)}.` : '';
      showSuccess(form, `<h2>Thanks, we have your message</h2><p>We'll follow up using the details you gave.${copy}</p><p><a class="btn btn-ghost" href="/">Back to home</a></p>`);
    },
  },
};

export function escapeHtml(v) {
  return String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

for (const form of document.querySelectorAll('form[data-form]')) {
  const h = handlers[form.dataset.form];
  if (!h) continue;
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    submit(form, h);
  });
  form.querySelector('button[type="submit"]').disabled = false; // enabled only once this script can handle the submit
  form.addEventListener('focusin', () => track('form_started', { form: form.dataset.form }), { once: true });
}

export { fieldEl };

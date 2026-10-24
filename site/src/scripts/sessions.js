// Pages are built ahead of time, so a session that ended after the build is hidden here.
const today = new Date().toISOString().slice(0, 10);

document.querySelectorAll('[data-session-end]').forEach((el) => {
  if (el.dataset.sessionEnd < today) el.hidden = true;
});

document.querySelectorAll('[data-session-group]').forEach((group) => {
  const anyLeft = [...group.querySelectorAll('[data-session-end]')].some((el) => !el.hidden);
  const empty = group.querySelector('[data-session-empty]');
  const list = group.querySelector('[data-session-list]');
  if (list) list.hidden = !anyLeft;
  if (empty) empty.hidden = anyLeft;
});

/**
 * yogine.dev: writes the Leads and Waitlist tabs of this spreadsheet.
 *
 * Deploy: Extensions > Apps Script (from the spreadsheet), paste this file, then
 *   1. Project Settings > Script properties > add SHEET_SECRET (a long random string;
 *      the same value goes in config.secrets.php as sheet_secret).
 *   2. Deploy > New deployment > Web app: Execute as "Me", access "Anyone".
 *   3. Copy the /exec URL into config.secrets.php as sheet_url.
 * After changing this file, create a new deployment version; the URL stays the same.
 *
 * Callers must send the secret in the JSON body. Anything without it is rejected.
 * Tabs and columns are created on first use; missing columns are added to the right.
 */

var TABS = {
  Leads: ['lead_id', 'created', 'name', 'email', 'phone', 'course', 'session', 'status', 'status_updated', 'amount',
    'page', 'landing_page', 'referrer', 'utm', 'device', 'language', 'timezone', 'country', 'ph_visitor_id',
    'coding_experience', 'ai_experience', 'expectations', 'notes'],
  Waitlist: ['created', 'name', 'email', 'phone', 'courses', 'note', 'page', 'landing_page', 'referrer', 'utm',
    'device', 'language', 'timezone', 'country', 'ph_visitor_id', 'notified', 'notes']
};

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var body = JSON.parse(e.postData.contents);
    var secret = PropertiesService.getScriptProperties().getProperty('SHEET_SECRET');
    if (!secret || body.secret !== secret) return reply({ ok: false, error: 'forbidden' });

    if (body.type === 'lead') appendRow('Leads', body);
    else if (body.type === 'waitlist') appendRow('Waitlist', body);
    else if (body.type === 'lead_update') updateLead(body);
    else return reply({ ok: false, error: 'unknown type' });
    return reply({ ok: true });
  } catch (err) {
    return reply({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

function reply(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// Stop a cell being read as a formula.
function safe(v) {
  var s = v === undefined || v === null ? '' : String(v);
  return /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
}

function tab(name) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(name) || ss.insertSheet(name);
  var wanted = TABS[name];
  var lastCol = sheet.getLastColumn();
  var header = lastCol > 0 ? sheet.getRange(1, 1, 1, lastCol).getValues()[0] : [];
  if (header.length === 0) {
    sheet.getRange(1, 1, 1, wanted.length).setValues([wanted]);
    sheet.setFrozenRows(1);
    header = wanted.slice();
  } else {
    wanted.forEach(function (col) {
      if (header.indexOf(col) === -1) {
        header.push(col);
        sheet.getRange(1, header.length).setValue(col);
      }
    });
  }
  return { sheet: sheet, header: header };
}

function appendRow(name, body) {
  var t = tab(name);
  var row = t.header.map(function (col) { return safe(body[col]); });
  t.sheet.appendRow(row);
}

function updateLead(body) {
  var t = tab('Leads');
  var idCol = t.header.indexOf('lead_id') + 1;
  var last = t.sheet.getLastRow();
  if (last < 2) throw new Error('no leads');
  var ids = t.sheet.getRange(2, idCol, last - 1, 1).getValues();
  var rowIndex = -1;
  for (var i = 0; i < ids.length; i++) {
    if (ids[i][0] === body.lead_id) { rowIndex = i + 2; break; }
  }
  if (rowIndex === -1) throw new Error('lead not found: ' + body.lead_id);

  Object.keys(body).forEach(function (key) {
    if (key === 'type' || key === 'secret' || key === 'lead_id') return;
    var col = t.header.indexOf(key);
    if (col !== -1) t.sheet.getRange(rowIndex, col + 1).setValue(safe(body[key]));
  });
}

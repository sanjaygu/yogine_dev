<?php
/**
 * Free-session registration (no payment involved).
 *
 * The website posts JSON here. The script checks it, emails a confirmation,
 * records the registration, and marks the visitor's lead as registered.
 * One registration per email per session.
 */

declare(strict_types=1);

require_once __DIR__ . '/lib.php';

function handle_registration(): void
{
    $cfg = require __DIR__ . '/config.php';
    $data = begin_post($cfg);

    $name = clean($data['name'] ?? '', 100);
    $email = clean($data['email'] ?? '', 254);
    $phone = clean($data['phone'] ?? '', 30);
    $courseKey = clean($data['course'] ?? '', 40);
    $eventId = clean($data['event'] ?? '', 20);
    $leadId = clean($data['leadId'] ?? '', 11);

    if (mb_strlen($name) < 2 || !valid_email($email)) {
        respond(400, ['ok' => false, 'error' => 'Enter a name and a valid email']);
    }

    $course = $cfg['courses'][$courseKey] ?? null;
    if (!$course || !$course['free']) {
        respond(400, ['ok' => false, 'error' => 'Not open for free registration']);
    }
    $event = $cfg['events'][$eventId] ?? null;
    if (!$event || $event['course'] !== $courseKey) {
        respond(400, ['ok' => false, 'error' => 'Unknown session']);
    }
    if ($event['end'] < gmdate('Y-m-d')) {
        respond(400, ['ok' => false, 'error' => 'That session has ended']);
    }

    enforce_limits($cfg, 'register', 7, 50);

    // Already registered for this session? Say OK, but don't email again.
    $csv = data_path($cfg, 'registrations.csv');
    if (csv_find($csv, ['email' => $email, 'event' => $eventId]) !== null) {
        respond(200, ['ok' => true]);
    }

    [$subject, $html, $text] = build_email($cfg, $name, $courseKey, $eventId, null);
    if (!send_email($cfg, $email, $subject, $html, $text)) {
        respond(500, ['ok' => false, 'error' => 'Email failed']);
    }

    csv_append($csv, ['timestamp', 'name', 'email', 'phone', 'course', 'event', 'lead_id'], [gmdate('c'), $name, $email, $phone, $courseKey, $eventId, $leadId]);

    if (valid_lead_id($leadId)) {
        sheet_send($cfg, ['type' => 'lead_update', 'lead_id' => $leadId, 'status' => 'registered', 'status_updated' => gmdate('c')]);
    }
    respond(200, ['ok' => true]);
}

if (!defined('YOGINE_TEST')) {
    handle_registration();
}

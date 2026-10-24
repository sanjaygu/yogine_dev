<?php
/**
 * Leads: saved the moment someone submits the details form, before payment or
 * free registration, so unfinished sign-ups are still known to the team.
 *
 * action "create"  (default) save a lead and return its id
 * action "status"  mark that payment was started
 * action "profile" add the optional experience answers from the thank-you page
 *
 * A lead is never lost to a sheet or email problem: it is always written to
 * data/leads.csv, and the visitor is never blocked from paying because of one.
 */

declare(strict_types=1);

require_once __DIR__ . '/lib.php';

const LEAD_HEADER = ['lead_id', 'created', 'name', 'email', 'phone', 'course', 'session', 'page', 'landing_page', 'referrer', 'utm', 'device', 'language', 'timezone', 'country', 'ph_visitor_id'];

function session_is_open(array $cfg, string $courseKey, string $eventId): bool
{
    $event = $cfg['events'][$eventId] ?? null;
    return $event !== null && $event['course'] === $courseKey && $event['end'] >= gmdate('Y-m-d');
}

function create_lead(array $cfg, array $data): void
{
    $name = clean($data['name'] ?? '', 100);
    $email = clean($data['email'] ?? '', 254);
    $phone = clean($data['phone'] ?? '', 30);
    $courseKey = clean($data['course'] ?? '', 40);
    $eventId = clean($data['session'] ?? '', 20);

    if (mb_strlen($name) < 2 || !valid_email($email)) {
        respond(400, ['ok' => false, 'error' => 'Enter a name and a valid email']);
    }
    if ($phone !== '' && !valid_phone($phone)) {
        respond(400, ['ok' => false, 'error' => 'Enter a valid phone number, or leave it blank']);
    }

    $course = $cfg['courses'][$courseKey] ?? null;
    if (!$course || $course['custom']) {
        respond(400, ['ok' => false, 'error' => 'Unknown course']);
    }
    if (!session_is_open($cfg, $courseKey, $eventId)) {
        respond(400, ['ok' => false, 'error' => 'That session is not open for booking']);
    }
    if (!$course['free'] && $course['payment_link'] === '') {
        respond(400, ['ok' => false, 'error' => 'Online payment is not open for this course']);
    }

    enforce_limits($cfg, 'lead', 15, 300);

    $csv = data_path($cfg, 'leads.csv');
    $existing = csv_find($csv, ['email' => $email, 'session' => $eventId]);
    if ($existing && strtotime($existing['created']) > time() - 86400) {
        respond(200, ['ok' => true, 'leadId' => $existing['lead_id']]); // same person, same session: reuse
    }

    $src = source_fields($data);
    $leadId = new_lead_id();
    $created = gmdate('c');
    $row = [$leadId, $created, $name, $email, $phone, $courseKey, $eventId, $src['page'], $src['landing_page'], $src['referrer'], $src['utm'], $src['device'], $src['language'], $src['timezone'], $src['country'], $src['ph_visitor_id']];

    $saved = csv_append($csv, LEAD_HEADER, $row);
    $sheetOk = sheet_send($cfg, [
        'type' => 'lead',
        'lead_id' => $leadId,
        'created' => $created,
        'name' => $name,
        'email' => $email,
        'phone' => $phone,
        'course' => $course['name'],
        'session' => $cfg['events'][$eventId]['date'],
        'status' => 'lead',
    ] + $src);
    $mailOk = notify_team($cfg, 'New lead: ' . $name . ' (' . $course['name'] . ')', [
        'Lead ID' => $leadId,
        'Name' => $name,
        'Email' => $email,
        'Phone' => $phone,
        'Course' => $course['name'],
        'Session' => $cfg['events'][$eventId]['date'],
        'Page' => $src['page'],
        'Referrer' => $src['referrer'],
        'Campaign' => $src['utm'],
        'Visitor ID' => $src['ph_visitor_id'],
    ], $email);

    if (!$saved && !$sheetOk && !$mailOk) {
        respond(500, ['ok' => false, 'error' => 'Could not save']);
    }
    respond(200, ['ok' => true, 'leadId' => $leadId]);
}

function update_lead(array $cfg, array $data, string $action): void
{
    $leadId = clean($data['leadId'] ?? '', 11);
    if (!valid_lead_id($leadId) || csv_find(data_path($cfg, 'leads.csv'), ['lead_id' => $leadId]) === null) {
        respond(404, ['ok' => false, 'error' => 'Unknown lead']);
    }
    enforce_limits($cfg, 'lead-update', 30, 600);

    $when = gmdate('c');
    if ($action === 'status') {
        $status = clean($data['status'] ?? '', 30);
        if ($status !== 'payment_started') {
            respond(400, ['ok' => false, 'error' => 'Unknown status']);
        }
        $fields = ['status' => $status, 'status_updated' => $when];
    } else {
        $fields = [
            'coding_experience' => clean($data['codingExperience'] ?? '', 20),
            'ai_experience' => clean($data['aiExperience'] ?? '', 20),
            'expectations' => clean($data['expectations'] ?? '', 1000),
        ];
    }

    foreach ($fields as $k => $v) {
        csv_append(data_path($cfg, 'lead-events.csv'), ['lead_id', 'when', 'field', 'value'], [$leadId, $when, $k, $v]);
    }
    sheet_send($cfg, ['type' => 'lead_update', 'lead_id' => $leadId] + $fields);
    respond(200, ['ok' => true]);
}

function handle_lead(): void
{
    $cfg = require __DIR__ . '/config.php';
    $data = begin_post($cfg);
    $action = clean($data['action'] ?? 'create', 10);

    if ($action === 'create') {
        create_lead($cfg, $data);
    } elseif ($action === 'status' || $action === 'profile') {
        update_lead($cfg, $data, $action);
    }
    respond(400, ['ok' => false, 'error' => 'Unknown action']);
}

if (!defined('YOGINE_TEST')) {
    handle_lead();
}

<?php
/**
 * Waitlist: "tell me when a session is scheduled".
 *
 * Needs an email or a phone number (or both) and at least one course. The entry
 * goes to the Waitlist tab, to the team by email, and to data/waitlist.csv; it
 * counts as saved if any one of those worked. Visitors who gave an email also
 * get a confirmation. A phone-only entry gets none, and nothing here promises a call.
 */

declare(strict_types=1);

require_once __DIR__ . '/lib.php';

const WAITLIST_HEADER = ['created', 'name', 'email', 'phone', 'courses', 'note', 'page', 'landing_page', 'referrer', 'utm', 'device', 'language', 'timezone', 'country', 'ph_visitor_id'];

function handle_waitlist(): void
{
    $cfg = require __DIR__ . '/config.php';
    $data = begin_post($cfg);

    $name = clean($data['name'] ?? '', 100);
    $email = clean($data['email'] ?? '', 254);
    $phone = clean($data['phone'] ?? '', 30);
    $note = clean($data['note'] ?? '', 1000);

    if ($email === '' && $phone === '') {
        respond(400, ['ok' => false, 'error' => 'Enter an email or a phone number', 'field' => 'contact']);
    }
    if ($email !== '' && !valid_email($email)) {
        respond(400, ['ok' => false, 'error' => 'Enter a valid email address', 'field' => 'email']);
    }
    if ($phone !== '' && !valid_phone($phone)) {
        respond(400, ['ok' => false, 'error' => 'Enter a valid phone number', 'field' => 'phone']);
    }

    $courseKeys = [];
    foreach ((array) ($data['courses'] ?? []) as $k) {
        $k = clean($k, 40);
        $c = $cfg['courses'][$k] ?? null;
        if ($c && !$c['custom'] && !in_array($k, $courseKeys, true)) {
            $courseKeys[] = $k;
        }
    }
    if (!$courseKeys) {
        respond(400, ['ok' => false, 'error' => 'Choose at least one course', 'field' => 'courses']);
    }
    sort($courseKeys);
    $courseList = implode(', ', $courseKeys);

    enforce_limits($cfg, 'waitlist', 7, 100);

    // Same person, same courses, within a day: answer OK without doing it all again.
    $csv = data_path($cfg, 'waitlist.csv');
    $key = $email !== '' ? ['email' => $email, 'courses' => $courseList] : ['phone' => $phone, 'courses' => $courseList];
    $existing = csv_find($csv, $key);
    if ($existing && strtotime($existing['created']) > time() - 86400) {
        respond(200, ['ok' => true, 'emailed' => $email !== '']);
    }

    $src = source_fields($data);
    $created = gmdate('c');
    $names = implode(', ', array_map(fn($k) => $cfg['courses'][$k]['name'], $courseKeys));

    $saved = csv_append($csv, WAITLIST_HEADER, [$created, $name, $email, $phone, $courseList, $note, $src['page'], $src['landing_page'], $src['referrer'], $src['utm'], $src['device'], $src['language'], $src['timezone'], $src['country'], $src['ph_visitor_id']]);
    $sheetOk = sheet_send($cfg, [
        'type' => 'waitlist',
        'created' => $created,
        'name' => $name,
        'email' => $email,
        'phone' => $phone,
        'courses' => $names,
        'note' => $note,
    ] + $src);
    $teamOk = notify_team($cfg, 'Waitlist: ' . ($email !== '' ? $email : $phone), [
        'Name' => $name,
        'Email' => $email,
        'Phone' => $phone,
        'Courses' => $names,
        'Note' => $note,
        'Page' => $src['page'],
        'Referrer' => $src['referrer'],
        'Campaign' => $src['utm'],
        'Visitor ID' => $src['ph_visitor_id'],
    ], $email);

    if (!$saved && !$sheetOk && !$teamOk) {
        respond(500, ['ok' => false, 'error' => 'Could not save']);
    }

    $emailed = false;
    if ($email !== '') {
        [$subject, $html, $text] = build_waitlist_email($cfg, $name, $courseKeys);
        $emailed = send_email($cfg, $email, $subject, $html, $text, false);
    }
    respond(200, ['ok' => true, 'emailed' => $emailed]);
}

if (!defined('YOGINE_TEST')) {
    handle_waitlist();
}

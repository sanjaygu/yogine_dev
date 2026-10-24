<?php
/**
 * Contact form. Needs a name, a message, and an email or a phone number (or both).
 *
 * The message goes to the team by email and is kept in data/contacts.csv; it counts
 * as received if either worked. Visitors who gave an email also get a copy. A
 * phone-only message gets no confirmation, and nothing here promises a call.
 */

declare(strict_types=1);

require_once __DIR__ . '/lib.php';

const INTERESTS = [
    'solutions' => 'Solutions for my organization',
    'training-team' => 'Training for my team',
    'enterprise-training' => 'Enterprise training (Governed Agentic SDLC)',
    'other' => 'Something else',
];

function handle_contact(): void
{
    $cfg = require __DIR__ . '/config.php';
    $data = begin_post($cfg);

    $name = clean($data['name'] ?? '', 100);
    $email = clean($data['email'] ?? '', 254);
    $phone = clean($data['phone'] ?? '', 30);
    $message = clean($data['message'] ?? '', 4000);
    $interest = clean($data['interest'] ?? 'other', 30);
    $company = clean($data['company'] ?? '', 120);
    $teamSize = clean($data['teamSize'] ?? '', 40);

    if (mb_strlen($name) < 2) {
        respond(400, ['ok' => false, 'error' => 'Enter your name', 'field' => 'name']);
    }
    if ($email === '' && $phone === '') {
        respond(400, ['ok' => false, 'error' => 'Enter an email or a phone number', 'field' => 'contact']);
    }
    if ($email !== '' && !valid_email($email)) {
        respond(400, ['ok' => false, 'error' => 'Enter a valid email address', 'field' => 'email']);
    }
    if ($phone !== '' && !valid_phone($phone)) {
        respond(400, ['ok' => false, 'error' => 'Enter a valid phone number', 'field' => 'phone']);
    }
    if (mb_strlen($message) < 5) {
        respond(400, ['ok' => false, 'error' => 'Tell us a little about what you need', 'field' => 'message']);
    }
    if (!isset(INTERESTS[$interest])) {
        $interest = 'other';
    }

    enforce_limits($cfg, 'contact', 5, 100);

    $src = source_fields($data);
    $saved = csv_append(data_path($cfg, 'contacts.csv'), ['created', 'name', 'email', 'phone', 'interest', 'company', 'team_size', 'message', 'page', 'referrer', 'utm', 'ph_visitor_id'], [gmdate('c'), $name, $email, $phone, $interest, $company, $teamSize, $message, $src['page'], $src['referrer'], $src['utm'], $src['ph_visitor_id']]);
    $teamOk = notify_team($cfg, 'Contact: ' . INTERESTS[$interest] . ' (' . $name . ')', [
        'Name' => $name,
        'Email' => $email,
        'Phone' => $phone,
        'Interest' => INTERESTS[$interest],
        'Company' => $company,
        'Team size' => $teamSize,
        'Message' => $message,
        'Page' => $src['page'],
        'Referrer' => $src['referrer'],
        'Campaign' => $src['utm'],
        'Visitor ID' => $src['ph_visitor_id'],
    ], $email);

    if (!$saved && !$teamOk) {
        respond(500, ['ok' => false, 'error' => 'Could not send']);
    }

    $emailed = false;
    if ($email !== '') {
        [$subject, $html, $text] = build_contact_email($cfg, $name, $message);
        $emailed = send_email($cfg, $email, $subject, $html, $text, false);
    }
    respond(200, ['ok' => true, 'emailed' => $emailed]);
}

if (!defined('YOGINE_TEST')) {
    handle_contact();
}

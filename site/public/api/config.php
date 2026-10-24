<?php
/**
 * Settings for the endpoints. Nothing secret lives here.
 *
 * Secrets (Stripe webhook secret, Resend key, Google Sheet URL and shared secret)
 * go in config.secrets.php, which is created on the server only and never uploaded
 * by a deploy. Copy config.secrets.example.php to start.
 *
 * Courses and sessions come from catalog.json, the same file the website is built from.
 */

declare(strict_types=1);

$secretsFile = getenv('YOGINE_SECRETS') ?: __DIR__ . '/config.secrets.php';
if (!is_file($secretsFile)) {
    error_log('config.secrets.php is missing');
    http_response_code(500);
    exit('Server is not configured');
}
$secrets = require $secretsFile;

$catalogFile = getenv('YOGINE_CATALOG_FILE') ?: __DIR__ . '/catalog.json';
$catalog = json_decode((string) file_get_contents($catalogFile), true);
if (!is_array($catalog)) {
    error_log('catalog.json is missing or invalid');
    http_response_code(500);
    exit('Server is not configured');
}

$courses = [];
foreach ($catalog['courses'] as $c) {
    $courses[$c['slug']] = [
        'name' => $c['name'],
        'free' => !empty($c['free']),
        'custom' => !empty($c['custom']),
        'price' => $c['price'] ?? null,
        'payment_link' => $c['paymentLink'] ?? '',
        'checklist' => $c['checklist'] ?? [],
    ];
}

$events = [];
foreach ($catalog['sessions'] as $s) {
    $venue = isset($s['venue']) ? ($catalog['venues'][$s['venue']] ?? null) : null;
    $where = $venue
        ? sprintf('%s, %s, %s, %s %s', $venue['name'], $venue['street'], $venue['city'], $venue['region'], $venue['zip'])
        : (string) ($s['location'] ?? '');
    $events[$s['id']] = [
        'course' => $s['course'],
        'date' => $s['date'],
        'end' => $s['end'],
        'where' => $where,
        'note' => $s['note'] ?? '',
    ];
}

return [
    'site_url' => 'https://yogine.dev/',
    'allowed_hosts' => array_merge(['yogine.dev', 'www.yogine.dev'], $secrets['extra_allowed_hosts'] ?? []),
    'from' => 'yogine.dev <hello@yogine.dev>',
    'reply_to' => 'hello@yogine.dev',
    'notify' => 'hello@yogine.dev',

    // 'live' talks to Resend and Google; 'file' writes both to data/ instead (local testing only).
    'mode' => $secrets['mode'] ?? 'live',
    'data_dir' => $secrets['data_dir'] ?? __DIR__ . '/data',

    'stripe_webhook_secret' => $secrets['stripe_webhook_secret'] ?? '',
    'resend_api_key' => $secrets['resend_api_key'] ?? '',
    'resend_url' => $secrets['resend_url'] ?? 'https://api.resend.com/emails',
    'sheet_url' => $secrets['sheet_url'] ?? '',
    'sheet_secret' => $secrets['sheet_secret'] ?? '',
    'rate_salt' => $secrets['rate_salt'] ?? ($secrets['stripe_webhook_secret'] ?? ''),

    'courses' => $courses,
    'events' => $events,
];

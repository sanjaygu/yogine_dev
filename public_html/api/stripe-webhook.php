<?php
/**
 * Stripe webhook -> confirmation email for PAID courses.
 *
 * Stripe calls this URL after a Payment Link checkout completes. The script
 * verifies the request really came from Stripe, works out which course and
 * session the person chose (from client_reference_id, e.g. "professional_e1"),
 * and emails them a confirmation through Resend.
 */

declare(strict_types=1);

require_once __DIR__ . '/lib.php';

function verify_stripe_signature(string $payload, string $header, string $secret, int $tolerance = 300): bool
{
    $timestamp = 0;
    $signatures = [];
    foreach (explode(',', $header) as $part) {
        $kv = explode('=', trim($part), 2);
        if (count($kv) !== 2) {
            continue;
        }
        if ($kv[0] === 't') {
            $timestamp = (int) $kv[1];
        } elseif ($kv[0] === 'v1') {
            $signatures[] = $kv[1];
        }
    }
    if ($timestamp === 0 || count($signatures) === 0) {
        return false;
    }
    if (abs(time() - $timestamp) > $tolerance) {
        return false;
    }
    $expected = hash_hmac('sha256', $timestamp . '.' . $payload, $secret);
    foreach ($signatures as $sig) {
        if (hash_equals($expected, $sig)) {
            return true;
        }
    }
    return false;
}

/** Stripe may retry a webhook; remember which payments were already emailed. */
function already_sent(string $file, string $id): bool
{
    if (!is_file($file)) {
        return false;
    }
    $lines = file($file, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
    return $lines !== false && in_array($id, $lines, true);
}

function mark_sent(string $file, string $id): void
{
    file_put_contents($file, $id . "\n", FILE_APPEND | LOCK_EX);
}

function handle_request(): void
{
    $cfg = require __DIR__ . '/config.php';

    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
        http_response_code(405);
        exit('POST only');
    }

    $payload = file_get_contents('php://input');
    $header = $_SERVER['HTTP_STRIPE_SIGNATURE'] ?? '';
    if (!is_string($payload) || !verify_stripe_signature($payload, $header, $cfg['stripe_webhook_secret'])) {
        http_response_code(400);
        exit('Invalid signature');
    }

    $event = json_decode($payload, true);
    $type = $event['type'] ?? '';
    if ($type !== 'checkout.session.completed' && $type !== 'checkout.session.async_payment_succeeded') {
        http_response_code(200);
        exit('Ignored');
    }

    $session = $event['data']['object'] ?? [];
    if (($session['payment_status'] ?? '') !== 'paid') {
        http_response_code(200);
        exit('Not paid yet');
    }

    $sessionId = (string) ($session['id'] ?? '');
    $email = (string) ($session['customer_details']['email'] ?? '');
    if ($sessionId === '' || $email === '') {
        http_response_code(200);
        exit('No email on session');
    }

    $sentFile = __DIR__ . '/sent-sessions.txt';
    if (already_sent($sentFile, $sessionId)) {
        http_response_code(200);
        exit('Already sent');
    }

    // client_reference_id looks like "professional_e1"
    $ref = (string) ($session['client_reference_id'] ?? '');
    $parts = explode('_', $ref, 2);
    $courseKey = $parts[0] ?? '';
    $eventId = $parts[1] ?? '';

    [$subject, $html, $text] = build_email(
        $cfg,
        (string) ($session['customer_details']['name'] ?? ''),
        $courseKey,
        $eventId,
        (int) ($session['amount_total'] ?? 0),
        (string) ($session['currency'] ?? 'usd')
    );

    if (!send_email($cfg, $email, $subject, $html, $text)) {
        http_response_code(500); // Stripe will retry
        exit('Email failed');
    }

    mark_sent($sentFile, $sessionId);
    http_response_code(200);
    echo 'OK';
}

if (!defined('YOGINE_TEST')) {
    handle_request();
}

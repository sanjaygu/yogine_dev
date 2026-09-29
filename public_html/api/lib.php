<?php
/**
 * Shared helpers: build and send the confirmation email.
 * Used by stripe-webhook.php (paid courses) and register.php (free sessions).
 */

declare(strict_types=1);

function h(string $s): string
{
    return htmlspecialchars($s, ENT_QUOTES, 'UTF-8');
}

/**
 * Returns [subject, html, text].
 * Pass $amountCents = null for a free registration.
 */
function build_email(array $cfg, string $name, string $courseKey, string $eventId, ?int $amountCents, string $currency = 'usd'): array
{
    $courseCfg = $cfg['courses'][$courseKey] ?? null;
    $event = $cfg['events'][$eventId] ?? null;
    $course = $courseCfg['name'] ?? null;
    $checklist = $courseCfg['checklist'] ?? [];
    $isFree = ($amountCents === null);

    $parts = explode(' ', trim($name));
    $first = $parts[0] ?? '';
    $greeting = $first !== '' ? 'Hi ' . $first . ',' : 'Hi,';

    $paid = '';
    if (!$isFree) {
        $paid = strtoupper($currency) === 'USD'
            ? '$' . number_format($amountCents / 100, 2)
            : number_format($amountCents / 100, 2) . ' ' . strtoupper($currency);
    }

    if ($course && $event) {
        $subject = "You're registered: " . $course . ' (' . $event['date'] . ')';
        $details = [
            'Course' => $course,
            'Date' => $event['date'],
            'Where' => $event['where'],
        ];
        if (!$isFree) {
            $details['Paid'] = $paid;
        }
        $note = $event['note'] ?? '';
        $intro = 'Thanks for registering. Your seat is confirmed.';
    } else {
        // Reference missing or not recognised: still confirm, and say details will follow.
        $subject = "You're registered for a yogine.dev session";
        $details = $isFree ? [] : ['Paid' => $paid];
        $note = "We'll email your course and session details separately.";
        $intro = $isFree ? 'Thanks for registering.' : 'Thanks for registering. Your payment went through.';
        $checklist = [];
    }

    $footer = $isFree
        ? "Can't make it? Reply to this email so we can free up your seat."
        : 'Stripe sends your payment receipt separately. Need to reschedule or cancel? See our refund and cancellation policy ('
            . $cfg['site_url'] . '#/refund-policy) or just reply to this email.';

    // ----- Plain text -----
    $text = $greeting . "\n\n" . $intro . "\n\n";
    foreach ($details as $label => $value) {
        $text .= $label . ': ' . $value . "\n";
    }
    if ($note !== '') {
        $text .= "\n" . $note . "\n";
    }
    if (count($checklist) > 0) {
        $text .= "\nBefore you arrive:\n";
        foreach ($checklist as $item) {
            $text .= '- ' . $item . "\n";
        }
    }
    $text .= "\n" . $footer . "\n\nSee you there,\nyogine.dev\n";

    // ----- HTML -----
    $rows = '';
    foreach ($details as $label => $value) {
        $rows .= '<tr><td style="padding:4px 16px 4px 0;color:#666;">' . h((string) $label)
            . '</td><td style="padding:4px 0;">' . h((string) $value) . '</td></tr>';
    }
    $list = '';
    if (count($checklist) > 0) {
        $items = '';
        foreach ($checklist as $item) {
            $items .= '<li>' . h($item) . '</li>';
        }
        $list = '<p style="margin-bottom:4px;"><strong>Before you arrive</strong></p><ul style="margin-top:4px;">' . $items . '</ul>';
    }
    $footerHtml = $isFree
        ? h($footer)
        : 'Stripe sends your payment receipt separately. Need to reschedule or cancel? See our '
            . '<a href="' . h($cfg['site_url']) . '#/refund-policy">refund and cancellation policy</a> or just reply to this email.';

    $html = '<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#222;max-width:560px;">'
        . '<p>' . h($greeting) . '</p>'
        . '<p>' . h($intro) . '</p>'
        . ($rows !== '' ? '<table style="border-collapse:collapse;margin:16px 0;">' . $rows . '</table>' : '')
        . ($note !== '' ? '<p>' . h($note) . '</p>' : '')
        . $list
        . '<p>' . $footerHtml . '</p>'
        . '<p>See you there,<br>yogine.dev</p>'
        . '</div>';

    return [$subject, $html, $text];
}

/** Sends one email through Resend. Returns true on success. */
function send_email(array $cfg, string $to, string $subject, string $html, string $text): bool
{
    $message = [
        'from' => $cfg['from'],
        'to' => [$to],
        'subject' => $subject,
        'html' => $html,
        'text' => $text,
        'reply_to' => $cfg['reply_to'],
    ];
    if (!empty($cfg['notify'])) {
        $message['bcc'] = [$cfg['notify']];
    }

    $ch = curl_init('https://api.resend.com/emails');
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_HTTPHEADER => [
            'Authorization: Bearer ' . $cfg['resend_api_key'],
            'Content-Type: application/json',
        ],
        CURLOPT_POSTFIELDS => json_encode($message),
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 15,
    ]);
    $response = curl_exec($ch);
    $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($status < 200 || $status >= 300) {
        error_log('Resend error ' . $status . ': ' . (is_string($response) ? $response : 'no response'));
        return false;
    }
    return true;
}

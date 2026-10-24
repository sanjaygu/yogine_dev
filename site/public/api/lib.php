<?php
/**
 * Shared helpers for every endpoint: request guards, storage, the Google Sheet,
 * and all emails (course confirmations, waitlist, contact, team notices).
 */

declare(strict_types=1);

function h(string $s): string
{
    return htmlspecialchars($s, ENT_QUOTES, 'UTF-8');
}

/* ---------------------------------------------------------------- requests */

function respond(int $status, array $body): void
{
    http_response_code($status);
    header('Content-Type: application/json');
    echo json_encode($body);
    exit;
}

/** Trim, drop control characters, cap length. */
function clean($value, int $max): string
{
    $s = is_string($value) ? trim($value) : '';
    $s = preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F]/', '', $s);
    return mb_substr($s === null ? '' : $s, 0, $max);
}

/** Stop spreadsheet apps treating a cell as a formula. */
function csv_safe(string $v): string
{
    return preg_match('/^[=+\-@\t\r]/', $v) === 1 ? "'" . $v : $v;
}

function valid_email(string $e): bool
{
    return $e !== '' && filter_var($e, FILTER_VALIDATE_EMAIL) !== false;
}

function valid_phone(string $p): bool
{
    return $p !== '' && strlen(preg_replace('/\D/', '', $p)) >= 7;
}

/** Common start of every POST endpoint: method, same-site check, JSON body, honeypot. */
function begin_post(array $cfg): array
{
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
        respond(405, ['ok' => false, 'error' => 'POST only']);
    }

    // Only accept requests that come from our own site.
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    if ($origin !== '') {
        $host = parse_url($origin, PHP_URL_HOST);
        if (!is_string($host) || !in_array($host, $cfg['allowed_hosts'], true)) {
            respond(403, ['ok' => false, 'error' => 'Not allowed']);
        }
    }

    $data = json_decode((string) file_get_contents('php://input'), true);
    if (!is_array($data)) {
        respond(400, ['ok' => false, 'error' => 'Bad request']);
    }

    // Honeypot: people never see this field, bots fill it in. Pretend it worked.
    if (!empty($data['website'])) {
        respond(200, ['ok' => true, 'leadId' => 'L' . str_repeat('0', 10)]);
    }
    return $data;
}

/* ----------------------------------------------------------------- storage */

function data_path(array $cfg, string $name): string
{
    $dir = $cfg['data_dir'];
    if (!is_dir($dir)) {
        @mkdir($dir, 0755, true);
    }
    $guard = $dir . '/.htaccess';
    if (!is_file($guard)) {
        @file_put_contents($guard, "Require all denied\n");
    }
    return $dir . '/' . $name;
}

/** True if this key has used up its allowance within the time window. */
function rate_limited(string $file, string $key, int $max, int $window): bool
{
    $now = time();
    $kept = [];
    $count = 0;

    $fh = fopen($file, 'c+');
    if ($fh === false) {
        return false; // don't block visitors if the log can't be opened
    }
    flock($fh, LOCK_EX);
    $raw = stream_get_contents($fh);
    foreach (explode("\n", (string) $raw) as $line) {
        if ($line === '') {
            continue;
        }
        $bits = explode(' ', $line, 2);
        $ts = (int) $bits[0];
        $k = $bits[1] ?? '';
        if ($ts >= $now - $window) {
            $kept[] = $line;
            if ($k === $key) {
                $count++;
            }
        }
    }
    $limited = $count >= $max;
    if (!$limited) {
        $kept[] = $now . ' ' . $key;
    }
    ftruncate($fh, 0);
    rewind($fh);
    fwrite($fh, implode("\n", $kept) . "\n");
    flock($fh, LOCK_UN);
    fclose($fh);
    return $limited;
}

/** Per-visitor and overall hourly limits for one endpoint. */
function enforce_limits(array $cfg, string $endpoint, int $perVisitor, int $overall): void
{
    $ip = $_SERVER['HTTP_CF_CONNECTING_IP'] ?? ($_SERVER['REMOTE_ADDR'] ?? 'unknown');
    $visitor = substr(hash('sha256', $ip . '|' . $cfg['rate_salt']), 0, 16);
    $file = data_path($cfg, 'rate-limit.log');
    if (rate_limited($file, $endpoint . ':v:' . $visitor, $perVisitor, 3600) || rate_limited($file, $endpoint . ':all', $overall, 3600)) {
        respond(429, ['ok' => false, 'error' => 'Too many attempts. Please try again later.']);
    }
}

function csv_append(string $file, array $header, array $row): bool
{
    $isNew = !is_file($file);
    $fh = fopen($file, 'a');
    if ($fh === false) {
        error_log('Could not write ' . basename($file));
        return false;
    }
    flock($fh, LOCK_EX);
    if ($isNew) {
        fputcsv($fh, $header);
    }
    fputcsv($fh, array_map(fn($v) => csv_safe((string) $v), $row));
    flock($fh, LOCK_UN);
    fclose($fh);
    return true;
}

/** First row whose given columns equal the given values (case-insensitive), or null. */
function csv_find(string $file, array $match): ?array
{
    if (!is_file($file)) {
        return null;
    }
    $fh = fopen($file, 'r');
    if ($fh === false) {
        return null;
    }
    $header = fgetcsv($fh);
    $found = null;
    while ($header && ($row = fgetcsv($fh)) !== false) {
        if (count($row) !== count($header)) {
            continue;
        }
        $assoc = array_combine($header, $row);
        $ok = true;
        foreach ($match as $col => $val) {
            if (strtolower(ltrim((string) ($assoc[$col] ?? ''), "'")) !== strtolower((string) $val)) {
                $ok = false;
                break;
            }
        }
        if ($ok) {
            $found = $assoc;
            break;
        }
    }
    fclose($fh);
    return $found;
}

function new_lead_id(): string
{
    $alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    $bytes = random_bytes(10);
    $id = 'L';
    for ($i = 0; $i < 10; $i++) {
        $id .= $alphabet[ord($bytes[$i]) % strlen($alphabet)];
    }
    return $id;
}

function valid_lead_id(string $id): bool
{
    return preg_match('/^L[A-Z2-9]{10}$/', $id) === 1;
}

/** Where the visitor came from, as reported by the page, plus what the server can see. */
function source_fields(array $data): array
{
    $s = is_array($data['source'] ?? null) ? $data['source'] : [];
    return [
        'page' => clean($s['page'] ?? '', 200),
        'landing_page' => clean($s['landing'] ?? '', 200),
        'referrer' => clean($s['referrer'] ?? '', 200),
        'utm' => clean($s['utm'] ?? '', 300),
        'device' => clean($s['device'] ?? '', 20),
        'language' => clean($s['language'] ?? '', 20),
        'timezone' => clean($s['timezone'] ?? '', 60),
        'country' => clean($_SERVER['HTTP_CF_IPCOUNTRY'] ?? '', 4),
        'ph_visitor_id' => clean($data['ph'] ?? '', 100),
    ];
}

/* ------------------------------------------------------------- Google Sheet */

/**
 * Sends one record to the Google Apps Script web app. Returns true if it accepted it.
 * In 'file' mode the record is written to data/sheet-outbox.jsonl instead.
 */
function sheet_send(array $cfg, array $payload): bool
{
    if ($cfg['mode'] === 'file') {
        return file_put_contents(data_path($cfg, 'sheet-outbox.jsonl'), json_encode($payload) . "\n", FILE_APPEND | LOCK_EX) !== false;
    }
    if ($cfg['sheet_url'] === '' || $cfg['sheet_secret'] === '') {
        error_log('Sheet is not configured');
        return false;
    }
    $ch = curl_init($cfg['sheet_url']);
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_HTTPHEADER => ['Content-Type: text/plain;charset=utf-8'],
        CURLOPT_POSTFIELDS => json_encode($payload + ['secret' => $cfg['sheet_secret']]),
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true, // Apps Script answers with a redirect to the result
        CURLOPT_TIMEOUT => 20,
    ]);
    $response = curl_exec($ch);
    $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    $decoded = is_string($response) ? json_decode($response, true) : null;
    if ($status < 200 || $status >= 300 || !is_array($decoded) || empty($decoded['ok'])) {
        error_log('Sheet error ' . $status . ': ' . (is_string($response) ? substr($response, 0, 300) : 'no response'));
        return false;
    }
    return true;
}

/* ------------------------------------------------------------------ emails */

/**
 * Sends one email through Resend. Returns true on success.
 * $bccTeam adds the team address as a blind copy; $replyTo overrides the reply address.
 * In 'file' mode the message is written to data/outbox.jsonl instead.
 */
function send_email(array $cfg, string $to, string $subject, string $html, string $text, bool $bccTeam = true, ?string $replyTo = null): bool
{
    $message = [
        'from' => $cfg['from'],
        'to' => [$to],
        'subject' => $subject,
        'html' => $html,
        'text' => $text,
        'reply_to' => $replyTo ?? $cfg['reply_to'],
    ];
    if ($bccTeam && !empty($cfg['notify'])) {
        $message['bcc'] = [$cfg['notify']];
    }

    if ($cfg['mode'] === 'file') {
        return file_put_contents(data_path($cfg, 'outbox.jsonl'), json_encode($message) . "\n", FILE_APPEND | LOCK_EX) !== false;
    }

    $ch = curl_init($cfg['resend_url']);
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

function greeting(string $name): string
{
    $first = explode(' ', trim($name))[0] ?? '';
    return $first !== '' ? 'Hi ' . $first . ',' : 'Hi,';
}

/** Wraps paragraphs in the shared email layout. Each item is already-escaped HTML. */
function email_html(array $blocks): string
{
    return '<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#222;max-width:560px;">'
        . implode('', $blocks) . '</div>';
}

function details_table(array $details): string
{
    if (!$details) {
        return '';
    }
    $rows = '';
    foreach ($details as $label => $value) {
        $rows .= '<tr><td style="padding:4px 16px 4px 0;color:#666;vertical-align:top;">' . h((string) $label)
            . '</td><td style="padding:4px 0;">' . nl2br(h((string) $value)) . '</td></tr>';
    }
    return '<table style="border-collapse:collapse;margin:16px 0;">' . $rows . '</table>';
}

/**
 * Course confirmation after payment or free registration. Returns [subject, html, text].
 * Pass $amountCents = null for a free registration.
 */
function build_email(array $cfg, string $name, string $courseKey, string $eventId, ?int $amountCents, string $currency = 'usd'): array
{
    $courseCfg = $cfg['courses'][$courseKey] ?? null;
    $event = $cfg['events'][$eventId] ?? null;
    $course = $courseCfg['name'] ?? null;
    $checklist = $courseCfg['checklist'] ?? [];
    $isFree = ($amountCents === null);
    $greet = greeting($name);

    $paid = '';
    if (!$isFree) {
        $paid = strtoupper($currency) === 'USD'
            ? '$' . number_format($amountCents / 100, 2)
            : number_format($amountCents / 100, 2) . ' ' . strtoupper($currency);
    }

    if ($course && $event) {
        $subject = "You're registered: " . $course . ' (' . $event['date'] . ')';
        $details = ['Course' => $course, 'Date' => $event['date'], 'Where' => $event['where']];
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

    $policyUrl = $cfg['site_url'] . 'refund-policy/';
    $footer = $isFree
        ? "Can't make it? Reply to this email so we can free up your seat."
        : 'Stripe sends your payment receipt separately. Need to reschedule or cancel? See our refund and cancellation policy (' . $policyUrl . ') or just reply to this email.';

    $text = $greet . "\n\n" . $intro . "\n\n";
    foreach ($details as $label => $value) {
        $text .= $label . ': ' . $value . "\n";
    }
    if ($note !== '') {
        $text .= "\n" . $note . "\n";
    }
    if ($checklist) {
        $text .= "\nBefore you arrive:\n";
        foreach ($checklist as $item) {
            $text .= '- ' . $item . "\n";
        }
    }
    $text .= "\n" . $footer . "\n\nSee you there,\nyogine.dev\n";

    $list = '';
    if ($checklist) {
        $list = '<p style="margin-bottom:4px;"><strong>Before you arrive</strong></p><ul style="margin-top:4px;">'
            . implode('', array_map(fn($i) => '<li>' . h($i) . '</li>', $checklist)) . '</ul>';
    }
    $footerHtml = $isFree
        ? h($footer)
        : 'Stripe sends your payment receipt separately. Need to reschedule or cancel? See our <a href="' . h($policyUrl)
            . '">refund and cancellation policy</a> or just reply to this email.';

    $html = email_html([
        '<p>' . h($greet) . '</p>',
        '<p>' . h($intro) . '</p>',
        details_table($details),
        $note !== '' ? '<p>' . h($note) . '</p>' : '',
        $list,
        '<p>' . $footerHtml . '</p>',
        '<p>See you there,<br>yogine.dev</p>',
    ]);

    return [$subject, $html, $text];
}

/** Waitlist confirmation. Returns [subject, html, text]. Makes no promise about timing. */
function build_waitlist_email(array $cfg, string $name, array $courseKeys): array
{
    $names = [];
    foreach ($courseKeys as $k) {
        $names[] = $cfg['courses'][$k]['name'] ?? $k;
    }
    $greet = greeting($name);
    $subject = "You're on the yogine.dev waitlist";
    $intro = 'Thanks for your interest. No session is scheduled for the course below yet, so we have added you to the waitlist and will email you when a date is published.';
    $footer = 'Entered a wrong address or no longer interested? Reply to this email and we will take you off the list.';

    $text = $greet . "\n\n" . $intro . "\n\n";
    foreach ($names as $n) {
        $text .= '- ' . $n . "\n";
    }
    $text .= "\n" . $footer . "\n\nyogine.dev\n";

    $html = email_html([
        '<p>' . h($greet) . '</p>',
        '<p>' . h($intro) . '</p>',
        '<ul>' . implode('', array_map(fn($n) => '<li>' . h($n) . '</li>', $names)) . '</ul>',
        '<p>' . h($footer) . '</p>',
        '<p>yogine.dev</p>',
    ]);
    return [$subject, $html, $text];
}

/** Contact confirmation. Returns [subject, html, text]. Makes no promise about a reply time. */
function build_contact_email(array $cfg, string $name, string $message): array
{
    $greet = greeting($name);
    $subject = 'We received your message to yogine.dev';
    $intro = 'Thanks for getting in touch. We have your message and will follow up by email. Here is a copy for your records:';
    $text = $greet . "\n\n" . $intro . "\n\n" . $message . "\n\nyogine.dev\n";
    $html = email_html([
        '<p>' . h($greet) . '</p>',
        '<p>' . h($intro) . '</p>',
        '<blockquote style="margin:16px 0;padding-left:12px;border-left:3px solid #ccc;color:#444;">' . nl2br(h($message)) . '</blockquote>',
        '<p>yogine.dev</p>',
    ]);
    return [$subject, $html, $text];
}

/**
 * Email to the team with everything a visitor submitted. Replies go to the visitor
 * when they gave an email address.
 */
function notify_team(array $cfg, string $subject, array $fields, string $replyTo = ''): bool
{
    $text = '';
    foreach ($fields as $label => $value) {
        $text .= $label . ': ' . $value . "\n";
    }
    $html = email_html([details_table($fields)]);
    return send_email($cfg, $cfg['notify'], '[yogine.dev] ' . $subject, $html, $text, false, valid_email($replyTo) ? $replyTo : null);
}

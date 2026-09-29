<?php
/**
 * Free-session registration (no payment involved).
 *
 * The website posts JSON here. The script checks it, emails a confirmation
 * through Resend, and records the registration in registrations.csv.
 *
 * Because anyone on the internet can call this URL, it has guards against
 * abuse: same-site check, hidden "honeypot" field, per-visitor and overall
 * hourly limits, and one registration per email per session.
 */

declare(strict_types=1);

require_once __DIR__ . '/lib.php';

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

/** True if this key has used up its allowance within the time window. */
function rate_limited(string $file, string $key, int $max, int $window): bool
{
    $now = time();
    $kept = [];
    $count = 0;

    $fh = fopen($file, 'c+');
    if ($fh === false) {
        return false; // don't block sign-ups if the log can't be opened
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

function already_registered(string $file, string $email, string $eventId): bool
{
    if (!is_file($file)) {
        return false;
    }
    $fh = fopen($file, 'r');
    if ($fh === false) {
        return false;
    }
    $found = false;
    while (($row = fgetcsv($fh)) !== false) {
        // columns: timestamp, name, email, phone, coding, ai, expectations, course, event
        if (isset($row[2], $row[8]) && strtolower(ltrim($row[2], "'")) === strtolower($email) && $row[8] === $eventId) {
            $found = true;
            break;
        }
    }
    fclose($fh);
    return $found;
}

function handle_registration(): void
{
    $cfg = require __DIR__ . '/config.php';

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
        respond(200, ['ok' => true]);
    }

    $name = clean($data['name'] ?? '', 100);
    $email = clean($data['email'] ?? '', 254);
    $phone = clean($data['phone'] ?? '', 30);
    $coding = clean($data['codingExperience'] ?? '', 20);
    $ai = clean($data['aiExperience'] ?? '', 20);
    $expect = clean($data['expectations'] ?? '', 1000);
    $courseKey = clean($data['course'] ?? '', 40);
    $eventId = clean($data['event'] ?? '', 20);

    if (mb_strlen($name) < 2 || filter_var($email, FILTER_VALIDATE_EMAIL) === false) {
        respond(400, ['ok' => false, 'error' => 'Enter a name and a valid email']);
    }

    $course = $cfg['courses'][$courseKey] ?? null;
    if (!$course || empty($course['free'])) {
        respond(400, ['ok' => false, 'error' => 'Not open for free registration']);
    }
    $event = $cfg['events'][$eventId] ?? null;
    if (!$event || ($event['course'] ?? '') !== $courseKey) {
        respond(400, ['ok' => false, 'error' => 'Unknown session']);
    }

    // Abuse limits: per visitor, and overall.
    $ip = $_SERVER['HTTP_CF_CONNECTING_IP'] ?? ($_SERVER['REMOTE_ADDR'] ?? 'unknown');
    $visitor = substr(hash('sha256', $ip . '|' . $cfg['stripe_webhook_secret']), 0, 16);
    $rateFile = __DIR__ . '/rate-limit.log';
    if (rate_limited($rateFile, 'v:' . $visitor, 7, 3600) || rate_limited($rateFile, 'all', 50, 3600)) {
        respond(429, ['ok' => false, 'error' => 'Too many attempts. Please try again later.']);
    }

    // Already registered for this session? Say OK, but don't email again.
    $csv = __DIR__ . '/registrations.csv';
    if (already_registered($csv, $email, $eventId)) {
        respond(200, ['ok' => true]);
    }

    [$subject, $html, $text] = build_email($cfg, $name, $courseKey, $eventId, null);
    if (!send_email($cfg, $email, $subject, $html, $text)) {
        respond(500, ['ok' => false, 'error' => 'Email failed']);
    }

    $isNew = !is_file($csv);
    $fh = fopen($csv, 'a');
    if ($fh !== false) {
        flock($fh, LOCK_EX);
        if ($isNew) {
            fputcsv($fh, ['timestamp', 'name', 'email', 'phone', 'coding_experience', 'ai_experience', 'expectations', 'course', 'event']);
        }
        fputcsv($fh, [
            gmdate('c'), csv_safe($name), csv_safe($email), csv_safe($phone),
            $coding, $ai, csv_safe($expect), $courseKey, $eventId,
        ]);
        flock($fh, LOCK_UN);
        fclose($fh);
    } else {
        error_log('Could not write registrations.csv');
    }

    respond(200, ['ok' => true]);
}

if (!defined('YOGINE_TEST')) {
    handle_registration();
}

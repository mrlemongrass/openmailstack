#!/usr/bin/php
<?php
// quarantine_filter.php
// Called by Postfix pipe transport
// argv: 1 = sender, 2 = recipient

require_once '/var/www/openmailstack-admin/config.php';

$sender = $argv[1] ?? 'unknown';
$recipient = $argv[2] ?? 'unknown';

$raw_email = file_get_contents("php://stdin");
if (empty($raw_email)) {
    exit(0);
}

// Parse headers to get Subject and Score
$subject = 'No Subject';
$score = 0.0;

$lines = explode("\n", $raw_email);
foreach ($lines as $line) {
    if (trim($line) === '') {
        break; // End of headers
    }
    if (stripos($line, 'Subject:') === 0) {
        $subject = trim(substr($line, 8));
        // Decode MIME subject if necessary (simple decode)
        $subject = iconv_mime_decode($subject, ICONV_MIME_DECODE_CONTINUE_ON_ERROR, 'UTF-8');
    }
    if (stripos($line, 'X-Spam-Score:') === 0) {
        $score_str = trim(substr($line, 13));
        $score = (float)$score_str;
    }
}

// Ensure the quarantine directory exists
$quarantine_dir = '/var/vmail/quarantine';
if (!is_dir($quarantine_dir)) {
    mkdir($quarantine_dir, 0700, true);
    chown($quarantine_dir, 'vmail');
}

// Generate UUID
$uuid = bin2hex(random_bytes(16));
$file_path = $quarantine_dir . '/' . $uuid . '.eml';

// Write raw email to disk
file_put_contents($file_path, $raw_email);
chown($file_path, 'vmail');
chmod($file_path, 0600);

// Insert into MariaDB
try {
    $stmt = $pdo->prepare("INSERT INTO quarantine_log (uuid, sender, recipient, subject, score, file_path, created) VALUES (?, ?, ?, ?, ?, ?, NOW())");
    $stmt->execute([$uuid, $sender, $recipient, $subject, $score, $file_path]);
} catch (Exception $e) {
    // If DB fails, we still saved to disk, but we might want to log it
    error_log("Failed to insert quarantine log for UUID $uuid: " . $e->getMessage());
}

exit(0); // Tell Postfix it was successfully "delivered" (to quarantine)

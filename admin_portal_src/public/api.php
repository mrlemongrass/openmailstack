<?php
session_start();
require_once __DIR__ . '/../config.php';

header('Content-Type: application/json');

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $csrf_token = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? $_POST['csrf_token'] ?? '';
    if (empty($_SESSION['csrf_token']) || !hash_equals($_SESSION['csrf_token'], $csrf_token)) {
        http_response_code(403);
        echo json_encode(['error' => 'CSRF token validation failed']);
        exit;
    }
}

$action = $_GET['action'] ?? '';

if ($action === 'login') {
    $username = $_POST['username'] ?? '';
    $password = $_POST['password'] ?? '';
    
    $stmt = $pdo->prepare("SELECT password FROM admin WHERE username = ? AND active = 1");
    $stmt->execute([$username]);
    $hash = $stmt->fetchColumn();
    
    $success = false;
    if ($hash) {
        if (strpos($hash, '{') === 0) {
            // Dovecot hash format (e.g. {SHA512-CRYPT}...)
            $escaped_pwd = escapeshellarg($password);
            $escaped_hash = escapeshellarg($hash);
            $verify = trim(shell_exec("PATH=/usr/bin:/bin doveadm pw -t $escaped_hash -p $escaped_pwd 2>/dev/null"));
            if (strpos(strtolower($verify), 'ok') !== false || strpos(strtolower($verify), 'verified') !== false) {
                $success = true;
            }
        } else {
            // Native PHP hash (bcrypt/argon2)
            if (password_verify($password, $hash)) {
                $success = true;
            }
        }
    }
    
    if ($success) {
        $_SESSION['admin_logged_in'] = true;
        $_SESSION['admin_username'] = $username;
        echo json_encode(['success' => true]);
    } else {
        echo json_encode(['success' => false, 'error' => 'Invalid username or password']);
    }
    exit;
}

if ($action === 'logout') {
    session_destroy();
    echo json_encode(['success' => true]);
    exit;
}

if (!isset($_SESSION['admin_logged_in']) || $_SESSION['admin_logged_in'] !== true) {
    http_response_code(401);
    echo json_encode(['error' => 'Unauthorized']);
    exit;
}

function hash_password($password) {
    // Handling the necessary doveadm hashing
    $escaped_pwd = escapeshellarg($password);
    // Assuming standard Dovecot path and SHA512-CRYPT scheme
    $hash = trim(shell_exec("PATH=/usr/bin:/bin doveadm pw -s SHA512-CRYPT -p $escaped_pwd 2>/dev/null"));
    if (empty($hash)) {
        // Fallback if doveadm fails (e.g. permission issue on testing)
        // Usually PHP password_hash with BCRYPT works if Dovecot config uses BLF-CRYPT
        // We'll use SHA512 manually as fallback
        $salt = substr(str_shuffle('./ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'), 0, 16);
        $hash = '{SHA512-CRYPT}' . crypt($password, '$6$' . $salt . '$');
    }
    return $hash;
}

function audit_log($pdo, $admin, $domain, $action, $data) {
    $stmt = $pdo->prepare("INSERT INTO log (timestamp, username, domain, action, data) VALUES (NOW(), ?, ?, ?, ?)");
    $stmt->execute([$admin, $domain, $action, $data]);
}

try {
    switch ($action) {
        // --- Dashboard / System Health ---
        case 'get_system_health':
            $services = ['nginx', 'postfix', 'dovecot', 'mariadb', 'rspamd', 'redis-server', 'clamav-daemon'];
            $status = [];
            foreach ($services as $srv) {
                $res = trim(shell_exec("systemctl is-active " . escapeshellarg($srv) . " 2>/dev/null"));
                $status[$srv] = ($res === 'active');
            }
            $load = sys_getloadavg();
            
            $free = shell_exec('free -m');
            $memTotal = 0; $memUsed = 0;
            if (preg_match('/Mem:\s+(\d+)\s+(\d+)/', $free, $m)) {
                $memTotal = $m[1]; $memUsed = $m[2];
            }
            
            $diskTotal = disk_total_space('/');
            $diskFree = disk_free_space('/');
            $diskUsed = $diskTotal - $diskFree;
            
            echo json_encode([
                'success' => true, 
                'services' => $status,
                'stats' => [
                    'load' => $load,
                    'mem_used_mb' => $memUsed,
                    'mem_total_mb' => $memTotal,
                    'disk_used_gb' => round($diskUsed / 1073741824, 2),
                    'disk_total_gb' => round($diskTotal / 1073741824, 2)
                ]
            ]);
            break;

        case 'get_audit_logs':
            $stmt = $pdo->query("SELECT timestamp, username, domain, action, data FROM log ORDER BY timestamp DESC LIMIT 500");
            echo json_encode(['success' => true, 'data' => $stmt->fetchAll()]);
            break;

        case 'get_rspamd_password':
            $pass = defined('RSPAMD_PASS') ? RSPAMD_PASS : 'Unknown';
            echo json_encode(['success' => true, 'password' => $pass]);
            break;

        // --- Domains ---
        case 'get_domains':
            $stmt = $pdo->query("SELECT * FROM domain ORDER BY domain ASC");
            echo json_encode(['success' => true, 'data' => $stmt->fetchAll()]);
            break;

        case 'get_dns_records':
            $domain = $_POST['domain'] ?? '';
            if (empty($domain)) throw new Exception('Domain cannot be empty');
            
            $hostname = gethostname();
            $records = [];
            $records[] = ['type' => 'MX', 'name' => '@', 'value' => "10 $hostname.", 'description' => 'Mail Exchanger'];
            $records[] = ['type' => 'TXT', 'name' => '@', 'value' => "v=spf1 mx a:$hostname -all", 'description' => 'SPF Record'];
            $records[] = ['type' => 'TXT', 'name' => '_dmarc', 'value' => 'v=DMARC1; p=quarantine; sp=quarantine; adkim=r; aspf=r;', 'description' => 'DMARC Record'];
            
            $pub_file = "/var/lib/rspamd/dkim/{$domain}.pub";
            if (file_exists($pub_file)) {
                $pub_content = file_get_contents($pub_file);
                if (preg_match('/\(\s*([^)]+)\s*\)/s', $pub_content, $m)) {
                    $val = preg_replace('/\s+/', '', str_replace('"', '', $m[1]));
                    $records[] = ['type' => 'TXT', 'name' => 'mail._domainkey', 'value' => $val, 'description' => 'DKIM Public Key'];
                }
            } else {
                $records[] = ['type' => 'TXT', 'name' => 'mail._domainkey', 'value' => 'Pending generation... (check back later)', 'description' => 'DKIM Public Key'];
            }
            
            echo json_encode(['success' => true, 'data' => $records]);
            break;

        case 'add_domain':
            $domain = $_POST['domain'] ?? '';
            $quota = isset($_POST['quota']) ? (int)$_POST['quota'] : 0; // Default mailbox quota in MB
            $maxquota = isset($_POST['maxquota']) ? (int)$_POST['maxquota'] : 0; // Max domain quota in MB
            if (empty($domain)) throw new Exception('Domain cannot be empty');
            if (!preg_match('/^[a-zA-Z0-9.-]+$/', $domain)) throw new Exception('Invalid domain format');
            
            // Convert MB to bytes for storage
            $quota_bytes = $quota > 0 ? $quota * 1048576 : 0;
            $maxquota_bytes = $maxquota > 0 ? $maxquota * 1048576 : 0;
            
            $stmt = $pdo->prepare("INSERT INTO domain (domain, description, maxquota, quota, transport, active, created, modified) VALUES (?, '', ?, ?, 'virtual', 1, NOW(), NOW())");
            $stmt->execute([$domain, $maxquota_bytes, $quota_bytes]);
            audit_log($pdo, $_SESSION['admin_username'], $domain, 'add_domain', "Created domain $domain with maxquota=$maxquota MB, quota=$quota MB");
            echo json_encode(['success' => true]);
            break;

        case 'delete_domain':
            $domain = $_POST['domain'] ?? '';
            // Ensure not ALL
            if ($domain === 'ALL') throw new Exception('Cannot delete ALL domain placeholder');
            $pdo->beginTransaction();
            $pdo->prepare("DELETE FROM mailbox WHERE domain = ?")->execute([$domain]);
            $pdo->prepare("DELETE FROM alias WHERE domain = ?")->execute([$domain]);
            $pdo->prepare("DELETE FROM domain WHERE domain = ?")->execute([$domain]);
            $pdo->commit();
            audit_log($pdo, $_SESSION['admin_username'], $domain, 'delete_domain', "Deleted domain $domain and its contents");
            echo json_encode(['success' => true]);
            break;

        // --- Mailboxes ---
        case 'get_mailboxes':
            $stmt = $pdo->query("SELECT username, name, domain, active, quota FROM mailbox ORDER BY domain ASC, username ASC");
            echo json_encode(['success' => true, 'data' => $stmt->fetchAll()]);
            break;

        case 'add_mailbox':
            $username = $_POST['username'] ?? '';
            $domain = $_POST['domain'] ?? '';
            $password = $_POST['password'] ?? '';
            $name = $_POST['name'] ?? '';
            $quota = isset($_POST['quota']) ? (int)$_POST['quota'] : -1;
            
            if (empty($username) || empty($domain) || empty($password)) {
                throw new Exception('Missing required fields');
            }
            if (!preg_match('/^[a-zA-Z0-9_.-]+$/', $username)) throw new Exception('Invalid username format');
            if (!preg_match('/^[a-zA-Z0-9.-]+$/', $domain)) throw new Exception('Invalid domain format');
            
            // If quota is -1, inherit from domain.quota
            if ($quota === -1) {
                $stmt = $pdo->prepare("SELECT quota FROM domain WHERE domain = ?");
                $stmt->execute([$domain]);
                $quota_bytes = (int) $stmt->fetchColumn();
            } else {
                $quota_bytes = $quota > 0 ? $quota * 1048576 : 0;
            }
            
            $email = $username . '@' . $domain;
            $maildir = $domain . '/' . $username . '/';
            $hashed = hash_password($password);

            $pdo->beginTransaction();
            $stmt = $pdo->prepare("INSERT INTO mailbox (username, password, name, maildir, quota, local_part, domain, active, created, modified) VALUES (?, ?, ?, ?, ?, ?, ?, 1, NOW(), NOW())");
            $stmt->execute([$email, $hashed, $name, $maildir, $quota_bytes, $username, $domain]);
            
            // Also create a self-alias for the mailbox
            $stmt = $pdo->prepare("INSERT INTO alias (address, goto, domain, active) VALUES (?, ?, ?, 1)");
            $stmt->execute([$email, $email, $domain]);
            $pdo->commit();

            audit_log($pdo, $_SESSION['admin_username'], $domain, 'add_mailbox', "Created mailbox $email with quota ".($quota_bytes/1048576)." MB");
            echo json_encode(['success' => true]);
            break;

        case 'delete_mailbox':
            $email = $_POST['email'] ?? '';
            $domain = explode('@', $email)[1] ?? '';
            $pdo->beginTransaction();
            $pdo->prepare("DELETE FROM mailbox WHERE username = ?")->execute([$email]);
            // Remove self alias
            $pdo->prepare("DELETE FROM alias WHERE address = ? AND goto = ?")->execute([$email, $email]);
            $pdo->commit();
            audit_log($pdo, $_SESSION['admin_username'], $domain, 'delete_mailbox', "Deleted mailbox $email");
            echo json_encode(['success' => true]);
            break;

        case 'change_password':
            $email = $_POST['email'] ?? '';
            $password = $_POST['password'] ?? '';
            $domain = explode('@', $email)[1] ?? '';
            if (empty($email) || empty($password)) throw new Exception('Missing fields');
            $hashed = hash_password($password);
            
            $pdo->beginTransaction();
            $stmt = $pdo->prepare("UPDATE mailbox SET password = ? WHERE username = ?");
            $stmt->execute([$hashed, $email]);
            
            // Sync to admin table if they are an admin
            $stmt = $pdo->prepare("UPDATE admin SET password = ?, modified = NOW() WHERE username = ?");
            $stmt->execute([$hashed, $email]);
            $pdo->commit();

            audit_log($pdo, $_SESSION['admin_username'], $domain, 'change_password', "Changed password for $email");
            echo json_encode(['success' => true]);
            break;

        // --- Aliases & Groups ---
        case 'get_aliases':
            // Fetch all aliases that are not just self-aliases for mailboxes
            $stmt = $pdo->query("SELECT address, goto, domain FROM alias WHERE address != goto ORDER BY domain ASC, address ASC");
            echo json_encode(['success' => true, 'data' => $stmt->fetchAll()]);
            break;

        case 'add_alias':
            $address = $_POST['address'] ?? ''; // e.g., group@domain.com
            $goto = $_POST['goto'] ?? '';       // e.g., user1@domain.com,user2@domain.com
            $domain = $_POST['domain'] ?? '';
            
            if (empty($address) || empty($goto) || empty($domain)) throw new Exception('Missing fields');
            if (!filter_var($address, FILTER_VALIDATE_EMAIL) && !preg_match('/^@[a-zA-Z0-9.-]+$/', $address)) throw new Exception('Invalid address format');
            if (!preg_match('/^[a-zA-Z0-9.-]+$/', $domain)) throw new Exception('Invalid domain format');
            
            $stmt = $pdo->prepare("INSERT INTO alias (address, goto, domain, active) VALUES (?, ?, ?, 1)");
            $stmt->execute([$address, $goto, $domain]);
            audit_log($pdo, $_SESSION['admin_username'], $domain, 'add_alias', "Created alias $address -> $goto");
            echo json_encode(['success' => true]);
            break;
            
        case 'delete_alias':
            $address = $_POST['address'] ?? '';
            $goto = $_POST['goto'] ?? '';
            $domain = explode('@', $address)[1] ?? '';
            $stmt = $pdo->prepare("DELETE FROM alias WHERE address = ? AND goto = ?");
            $stmt->execute([$address, $goto]);
            audit_log($pdo, $_SESSION['admin_username'], $domain, 'delete_alias', "Deleted alias $address -> $goto");
            echo json_encode(['success' => true]);
            break;

        // --- Catch-Alls ---
        case 'add_catchall':
            $domain = $_POST['domain'] ?? '';
            $goto = $_POST['goto'] ?? '';
            if (empty($domain) || empty($goto)) throw new Exception('Missing fields');
            if (!preg_match('/^[a-zA-Z0-9.-]+$/', $domain)) throw new Exception('Invalid domain format');
            
            // Catchall is typically stored as @domain.com -> user@domain.com
            $address = '@' . $domain;
            $stmt = $pdo->prepare("INSERT INTO alias (address, goto, domain, active) VALUES (?, ?, ?, 1)");
            $stmt->execute([$address, $goto, $domain]);
            audit_log($pdo, $_SESSION['admin_username'], $domain, 'add_catchall', "Created catch-all for $domain -> $goto");
            echo json_encode(['success' => true]);
            break;

        // --- Cross Domain Aliasing (alias_domain) ---
        case 'get_domain_aliases':
            $stmt = $pdo->query("SELECT alias_domain, target_domain FROM alias_domain ORDER BY alias_domain ASC");
            echo json_encode(['success' => true, 'data' => $stmt->fetchAll()]);
            break;

        case 'add_domain_alias':
            $alias_domain = $_POST['alias_domain'] ?? '';
            $target_domain = $_POST['target_domain'] ?? '';
            if (empty($alias_domain) || empty($target_domain)) throw new Exception('Missing fields');
            if (!preg_match('/^[a-zA-Z0-9.-]+$/', $alias_domain) || !preg_match('/^[a-zA-Z0-9.-]+$/', $target_domain)) throw new Exception('Invalid domain format');
            
            $stmt = $pdo->prepare("INSERT INTO alias_domain (alias_domain, target_domain, active) VALUES (?, ?, 1)");
            $stmt->execute([$alias_domain, $target_domain]);
            echo json_encode(['success' => true]);
            break;

        case 'delete_domain_alias':
            $alias_domain = $_POST['alias_domain'] ?? '';
            $stmt = $pdo->prepare("DELETE FROM alias_domain WHERE alias_domain = ?");
            $stmt->execute([$alias_domain]);
            echo json_encode(['success' => true]);
            break;

        // --- Admins ---
        case 'get_admins':
            $stmt = $pdo->query("SELECT username, active, modified FROM admin ORDER BY username ASC");
            echo json_encode(['success' => true, 'data' => $stmt->fetchAll()]);
            break;

        case 'add_admin':
            $username = $_POST['username'] ?? '';
            if (empty($username)) throw new Exception('Missing fields');
            if (!filter_var($username, FILTER_VALIDATE_EMAIL)) throw new Exception('Invalid email format');
            
            $stmt = $pdo->prepare("SELECT password FROM mailbox WHERE username = ?");
            $stmt->execute([$username]);
            $hashed = $stmt->fetchColumn();
            
            if (!$hashed) throw new Exception('User is not a valid mailbox. Please create a mailbox first.');

            $stmt = $pdo->prepare("INSERT INTO admin (username, password, created, modified, active) VALUES (?, ?, NOW(), NOW(), 1) ON DUPLICATE KEY UPDATE password = ?, modified = NOW(), active = 1");
            $stmt->execute([$username, $hashed, $hashed]);
            audit_log($pdo, $_SESSION['admin_username'], 'ALL', 'add_admin', "Created or updated admin $username");
            echo json_encode(['success' => true]);
            break;

        case 'delete_admin':
            $username = $_POST['username'] ?? '';
            $stmt = $pdo->prepare("DELETE FROM admin WHERE username = ?");
            $stmt->execute([$username]);
            
            $logged_out = false;
            if ($username === $_SESSION['admin_username']) {
                session_destroy();
                $logged_out = true;
            }
            audit_log($pdo, $_SESSION['admin_username'], 'ALL', 'delete_admin', "Deleted admin $username");
            echo json_encode(['success' => true, 'logged_out' => $logged_out]);
            break;

        case 'change_admin_password':
            $username = $_POST['username'] ?? '';
            $password = $_POST['password'] ?? '';
            if (empty($username) || empty($password)) throw new Exception('Missing fields');
            $hashed = hash_password($password);
            $stmt = $pdo->prepare("UPDATE admin SET password = ?, modified = NOW() WHERE username = ?");
            $stmt->execute([$hashed, $username]);
            audit_log($pdo, $_SESSION['admin_username'], 'ALL', 'change_admin_password', "Changed admin password for $username");
            echo json_encode(['success' => true]);
            break;

        default:
            echo json_encode(['error' => 'Invalid action']);
            break;
    }
} catch (Exception $e) {
    echo json_encode(['success' => false, 'error' => $e->getMessage()]);
}

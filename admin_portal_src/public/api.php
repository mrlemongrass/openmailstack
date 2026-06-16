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
    
    // Check Admin First
    $stmt = $pdo->prepare("SELECT password FROM admin WHERE username = ? AND active = 1");
    $stmt->execute([$username]);
    $hash = $stmt->fetchColumn();
    $role = 'admin';
    
    // If not admin, check Mailbox
    if (!$hash) {
        $stmt = $pdo->prepare("SELECT password FROM mailbox WHERE username = ? AND active = 1");
        $stmt->execute([$username]);
        $hash = $stmt->fetchColumn();
        $role = 'user';
    }
    
    $success = false;
    if ($hash) {
        if (strpos($hash, '{') === 0) {
            $escaped_pwd = escapeshellarg($password);
            $escaped_hash = escapeshellarg($hash);
            $verify = trim(shell_exec("PATH=/usr/bin:/bin doveadm pw -t $escaped_hash -p $escaped_pwd 2>/dev/null"));
            if (strpos(strtolower($verify), 'ok') !== false || strpos(strtolower($verify), 'verified') !== false) {
                $success = true;
            }
        } else {
            if (password_verify($password, $hash)) {
                $success = true;
            }
        }
    }
    
    if ($success) {
        $_SESSION['role'] = $role;
        $_SESSION['username'] = $username;
        if ($role === 'admin') {
            $_SESSION['admin_logged_in'] = true;
            $_SESSION['admin_username'] = $username;
        }
        echo json_encode(['success' => true, 'role' => $role]);
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

// Session check
$role = $_SESSION['role'] ?? null;
if (!$role) {
    http_response_code(401);
    echo json_encode(['error' => 'Unauthorized']);
    exit;
}

// Enforce admin-only for existing actions
$is_admin = ($role === 'admin');
$is_superadmin = false;
if ($is_admin) {
    $stmt = $pdo->prepare("SELECT superadmin FROM admin WHERE username = ? AND active = 1");
    $stmt->execute([$_SESSION['username']]);
    $is_superadmin = (bool)$stmt->fetchColumn();
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
    $user_actions = ['user_get_profile', 'user_change_password', 'user_get_forwarding', 'user_set_forwarding', 'user_get_spam_rules', 'user_set_spam_rules'];
    if (!$is_admin && !in_array($action, $user_actions)) {
        http_response_code(403);
        throw new Exception('Unauthorized action for standard user');
    }

    switch ($action) {
        // --- End User Portal Actions ---
        case 'user_get_profile':
            echo json_encode(['success' => true, 'username' => $_SESSION['username'], 'role' => $role]);
            break;
            
        case 'user_change_password':
            $password = $_POST['password'] ?? '';
            if (empty($password)) throw new Exception('Missing password');
            $hashed = hash_password($password);
            $stmt = $pdo->prepare("UPDATE mailbox SET password = ?, modified = NOW() WHERE username = ?");
            $stmt->execute([$hashed, $_SESSION['username']]);
            if ($is_admin) {
                $stmt = $pdo->prepare("UPDATE admin SET password = ?, modified = NOW() WHERE username = ?");
                $stmt->execute([$hashed, $_SESSION['username']]);
            }
            audit_log($pdo, $_SESSION['username'], 'USER', 'change_password', "User changed their own password");
            echo json_encode(['success' => true]);
            break;
            
        case 'user_get_forwarding':
            $stmt = $pdo->prepare("SELECT goto FROM alias WHERE address = ?");
            $stmt->execute([$_SESSION['username']]);
            $goto = $stmt->fetchColumn() ?: $_SESSION['username'];
            echo json_encode(['success' => true, 'goto' => $goto]);
            break;
            
        case 'user_set_forwarding':
            $goto = $_POST['goto'] ?? $_SESSION['username'];
            if (empty($goto)) $goto = $_SESSION['username'];
            $stmt = $pdo->prepare("UPDATE alias SET goto = ?, modified = NOW() WHERE address = ?");
            $stmt->execute([$goto, $_SESSION['username']]);
            audit_log($pdo, $_SESSION['username'], 'USER', 'set_forwarding', "User changed forwarding to $goto");
            echo json_encode(['success' => true]);
            break;
            
        case 'user_get_spam_rules':
            $stmt = $pdo->prepare("SELECT rules_json FROM user_spam_rules WHERE username = ?");
            $stmt->execute([$_SESSION['username']]);
            $rules = $stmt->fetchColumn();
            echo json_encode(['success' => true, 'rules' => $rules ? json_decode($rules, true) : []]);
            break;
            
        case 'user_set_spam_rules':
            $rules = $_POST['rules'] ?? '[]';
            if (!json_decode($rules)) throw new Exception('Invalid JSON rules');
            $stmt = $pdo->prepare("INSERT INTO user_spam_rules (username, rules_json) VALUES (?, ?) ON DUPLICATE KEY UPDATE rules_json = ?");
            $stmt->execute([$_SESSION['username'], $rules, $rules]);
            audit_log($pdo, $_SESSION['username'], 'USER', 'set_spam_rules', "User updated their spam rules");
            echo json_encode(['success' => true]);
            break;

        // ==========================================
        // ADMIN ONLY ENDPOINTS BELOW
        // ==========================================
        case 'get_system_health':
            if (!$is_admin) throw new Exception('Unauthorized');
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
            if (!$is_admin) throw new Exception('Unauthorized');
            $stmt = $pdo->query("SELECT timestamp, username, domain, action, data FROM log ORDER BY timestamp DESC LIMIT 500");
            echo json_encode(['success' => true, 'data' => $stmt->fetchAll()]);
            break;

        case 'get_rspamd_password':
            if (!$is_admin) throw new Exception('Unauthorized');
            $pass = defined('RSPAMD_PASS') ? RSPAMD_PASS : 'Unknown';
            echo json_encode(['success' => true, 'password' => $pass]);
            break;

        // --- Domains ---
        case 'get_routing':
            if (!$is_admin) throw new Exception('Unauthorized');
            if ($is_superadmin) {
                $stmt = $pdo->query("SELECT domain, transport FROM domain WHERE transport != 'virtual' ORDER BY domain ASC");
            } else {
                $stmt = $pdo->prepare("SELECT domain, transport FROM domain WHERE transport != 'virtual' AND domain IN (SELECT domain FROM domain_admins WHERE username = ?) ORDER BY domain ASC");
                $stmt->execute([$_SESSION['username']]);
            }
            echo json_encode(['success' => true, 'data' => $stmt->fetchAll()]);
            break;

        case 'get_domains':
            if (!$is_admin) throw new Exception('Unauthorized');
            if ($is_superadmin) {
                $stmt = $pdo->query("SELECT * FROM domain ORDER BY domain ASC");
            } else {
                $stmt = $pdo->prepare("SELECT d.* FROM domain d JOIN domain_admins da ON d.domain = da.domain WHERE da.username = ? ORDER BY d.domain ASC");
                $stmt->execute([$_SESSION['username']]);
            }
            $domains = $stmt->fetchAll();
            
            // Fetch verification tokens
            $tokens = $pdo->query("SELECT domain, token FROM domain_verification")->fetchAll(PDO::FETCH_KEY_PAIR);
            foreach ($domains as &$d) {
                $d['verify_token'] = $tokens[$d['domain']] ?? null;
            }
            
            echo json_encode(['success' => true, 'data' => $domains, 'is_superadmin' => $is_superadmin]);
            break;

        case 'get_dns_records':
            $domain = $_POST['domain'] ?? '';
            if (empty($domain)) throw new Exception('Domain cannot be empty');
            
            // Security check for non-superadmins
            if (!$is_superadmin) {
                $stmt = $pdo->prepare("SELECT 1 FROM domain_admins WHERE username = ? AND domain = ?");
                $stmt->execute([$_SESSION['username'], $domain]);
                if (!$stmt->fetch()) throw new Exception('Unauthorized to view this domain');
            }
            
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
            
            $quota_bytes = $quota > 0 ? $quota * 1048576 : 0;
            $maxquota_bytes = $maxquota > 0 ? $maxquota * 1048576 : 0;
            $is_active = $is_superadmin ? 1 : 0;
            
            $pdo->beginTransaction();
            $stmt = $pdo->prepare("INSERT INTO domain (domain, description, maxquota, quota, transport, active, created, modified) VALUES (?, '', ?, ?, 'virtual', ?, NOW(), NOW())");
            $stmt->execute([$domain, $maxquota_bytes, $quota_bytes, $is_active]);
            
            if (!$is_superadmin) {
                $stmt = $pdo->prepare("INSERT INTO domain_admins (username, domain, created, active) VALUES (?, ?, NOW(), 1)");
                $stmt->execute([$_SESSION['username'], $domain]);
                
                $token = bin2hex(random_bytes(16));
                $stmt = $pdo->prepare("INSERT INTO domain_verification (domain, token) VALUES (?, ?)");
                $stmt->execute([$domain, $token]);
            }
            $pdo->commit();
            
            audit_log($pdo, $_SESSION['username'], $domain, 'add_domain', "Created domain $domain with active=$is_active");
            echo json_encode(['success' => true, 'needs_verification' => !$is_superadmin]);
            break;
            
        case 'verify_domain':
            $domain = $_POST['domain'] ?? '';
            if (empty($domain)) throw new Exception('Domain cannot be empty');
            
            if (!$is_superadmin) {
                $stmt = $pdo->prepare("SELECT 1 FROM domain_admins WHERE username = ? AND domain = ?");
                $stmt->execute([$_SESSION['username'], $domain]);
                if (!$stmt->fetch()) throw new Exception('Unauthorized');
            }
            
            $stmt = $pdo->prepare("SELECT token FROM domain_verification WHERE domain = ?");
            $stmt->execute([$domain]);
            $token = $stmt->fetchColumn();
            
            if (!$token) throw new Exception('Domain does not require verification or does not exist');
            
            $dns_records = dns_get_record("_openmailstack.$domain", DNS_TXT);
            $verified = false;
            foreach ($dns_records as $rec) {
                if (isset($rec['txt']) && strpos($rec['txt'], "openmailstack-verify=$token") !== false) {
                    $verified = true;
                    break;
                }
            }
            
            if ($verified) {
                $pdo->beginTransaction();
                $stmt = $pdo->prepare("UPDATE domain SET active = 1, modified = NOW() WHERE domain = ?");
                $stmt->execute([$domain]);
                $stmt = $pdo->prepare("DELETE FROM domain_verification WHERE domain = ?");
                $stmt->execute([$domain]);
                $pdo->commit();
                audit_log($pdo, $_SESSION['username'], $domain, 'verify_domain', "Successfully verified ownership via DNS");
                echo json_encode(['success' => true]);
            } else {
                echo json_encode(['success' => false, 'error' => "DNS TXT record not found yet. It may take some time for DNS to propagate. Keep checking: _openmailstack.$domain -> openmailstack-verify=$token"]);
            }
            break;

        case 'delete_domain':
            $domain = $_POST['domain'] ?? '';
            if ($domain === 'ALL') throw new Exception('Cannot delete ALL domain placeholder');
            
            if (!$is_superadmin) {
                $stmt = $pdo->prepare("SELECT 1 FROM domain_admins WHERE username = ? AND domain = ?");
                $stmt->execute([$_SESSION['username'], $domain]);
                if (!$stmt->fetch()) throw new Exception('Unauthorized to delete this domain');
            }
            
            $pdo->beginTransaction();
            $pdo->prepare("DELETE FROM mailbox WHERE domain = ?")->execute([$domain]);
            $pdo->prepare("DELETE FROM alias WHERE domain = ?")->execute([$domain]);
            $pdo->prepare("DELETE FROM domain_admins WHERE domain = ?")->execute([$domain]);
            $pdo->prepare("DELETE FROM domain_verification WHERE domain = ?")->execute([$domain]);
            $pdo->prepare("DELETE FROM domain WHERE domain = ?")->execute([$domain]);
            $pdo->commit();
            audit_log($pdo, $_SESSION['username'], $domain, 'delete_domain', "Deleted domain $domain and its contents");
            echo json_encode(['success' => true]);
            break;

        // --- Mailboxes ---
        case 'get_mailboxes':
            if (!$is_admin) throw new Exception('Unauthorized');
            if ($is_superadmin) {
                $stmt = $pdo->query("SELECT username, name, domain, active, quota FROM mailbox ORDER BY domain ASC, username ASC");
            } else {
                $stmt = $pdo->prepare("SELECT username, name, domain, active, quota FROM mailbox WHERE domain IN (SELECT domain FROM domain_admins WHERE username = ?) ORDER BY domain ASC, username ASC");
                $stmt->execute([$_SESSION['username']]);
            }
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

        case 'edit_mailbox':
            $old_username = $_POST['old_username'] ?? '';
            $new_username = $_POST['new_username'] ?? '';
            $name = $_POST['name'] ?? '';
            $quota = isset($_POST['quota']) ? (int)$_POST['quota'] : -1;
            $active = isset($_POST['active']) ? (int)$_POST['active'] : 1;
            
            if (empty($old_username) || empty($new_username)) throw new Exception('Missing username');
            $domain = explode('@', $old_username)[1] ?? '';
            $new_domain = explode('@', $new_username)[1] ?? '';
            
            if ($domain !== $new_domain) throw new Exception('Cannot move mailbox to a different domain');
            $new_local_part = explode('@', $new_username)[0];
            
            // If quota is -1, inherit from domain.quota
            if ($quota === -1) {
                $stmt = $pdo->prepare("SELECT quota FROM domain WHERE domain = ?");
                $stmt->execute([$domain]);
                $quota_bytes = (int) $stmt->fetchColumn();
            } else {
                $quota_bytes = $quota > 0 ? $quota * 1048576 : 0;
            }
            
            $pdo->beginTransaction();
            // Keep the same maildir so existing emails aren't orphaned
            $stmt = $pdo->prepare("UPDATE mailbox SET username = ?, local_part = ?, name = ?, quota = ?, active = ?, modified = NOW() WHERE username = ?");
            $stmt->execute([$new_username, $new_local_part, $name, $quota_bytes, $active, $old_username]);
            
            // Update self alias
            $stmt = $pdo->prepare("UPDATE alias SET address = ?, goto = ?, active = ?, modified = NOW() WHERE address = ? AND goto = ?");
            $stmt->execute([$new_username, $new_username, $active, $old_username, $old_username]);
            $pdo->commit();
            
            audit_log($pdo, $_SESSION['admin_username'], $domain, 'edit_mailbox', "Edited mailbox $old_username -> $new_username (active=$active)");
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
            if (!$is_admin) throw new Exception('Unauthorized');
            if ($is_superadmin) {
                $stmt = $pdo->query("SELECT address, goto, domain FROM alias WHERE address != goto ORDER BY domain ASC, address ASC");
            } else {
                $stmt = $pdo->prepare("SELECT address, goto, domain FROM alias WHERE address != goto AND domain IN (SELECT domain FROM domain_admins WHERE username = ?) ORDER BY domain ASC, address ASC");
                $stmt->execute([$_SESSION['username']]);
            }
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
            
        case 'edit_alias':
            $old_address = $_POST['old_address'] ?? '';
            $new_address = $_POST['new_address'] ?? '';
            $goto = $_POST['goto'] ?? '';
            
            if (empty($old_address) || empty($new_address) || empty($goto)) throw new Exception('Missing fields');
            $domain = explode('@', $old_address)[1] ?? '';
            
            $stmt = $pdo->prepare("UPDATE alias SET address = ?, goto = ?, modified = NOW() WHERE address = ?");
            $stmt->execute([$new_address, $goto, $old_address]);
            
            audit_log($pdo, $_SESSION['admin_username'], $domain, 'edit_alias', "Edited alias $old_address -> $new_address (goto updated)");
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
            if (!$is_admin) throw new Exception('Unauthorized');
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

        // --- API Keys ---
        case 'get_api_keys':
            if (!$is_admin) throw new Exception('Unauthorized');
            $stmt = $pdo->query("SELECT id, description, created_at, last_used FROM api_keys ORDER BY created_at DESC");
            echo json_encode(['success' => true, 'data' => $stmt->fetchAll()]);
            break;

        case 'create_api_key':
            $description = $_POST['description'] ?? '';
            if (empty($description)) throw new Exception('Missing description');
            
            // Generate a secure random API key
            $raw_key = 'sk_' . bin2hex(random_bytes(32));
            $key_hash = password_hash($raw_key, PASSWORD_DEFAULT);
            
            $stmt = $pdo->prepare("INSERT INTO api_keys (description, key_hash, created_at) VALUES (?, ?, NOW())");
            $stmt->execute([$description, $key_hash]);
            
            audit_log($pdo, $_SESSION['admin_username'], 'ALL', 'create_api_key', "Created API key: $description");
            
            // Return the raw key ONLY once
            echo json_encode(['success' => true, 'raw_key' => $raw_key]);
            break;

        case 'delete_api_key':
            $id = $_POST['id'] ?? '';
            if (empty($id)) throw new Exception('Missing ID');
            
            $stmt = $pdo->prepare("DELETE FROM api_keys WHERE id = ?");
            $stmt->execute([$id]);
            
            audit_log($pdo, $_SESSION['admin_username'], 'ALL', 'delete_api_key', "Deleted API key ID: $id");
            echo json_encode(['success' => true]);
            break;

        // --- System & Updates ---
        case 'check_updates':
            if (!$is_admin) throw new Exception('Unauthorized');
            $current_version = file_exists('/var/www/openmailstack-admin/VERSION') 
                ? trim(file_get_contents('/var/www/openmailstack-admin/VERSION')) 
                : '0.1.0';
            
            $context = stream_context_create([
                'http' => [
                    'header' => "User-Agent: OpenMailStack-Admin\r\n",
                    'ignore_errors' => true
                ]
            ]);
            $response = @file_get_contents('https://api.github.com/repos/mrlemongrass/openmailstack/releases/latest', false, $context);
            $data = $response ? json_decode($response, true) : null;
            
            if (isset($data['message']) && $data['message'] === 'Not Found') {
                $latest_version = $current_version;
                $has_update = false;
                $release_notes = "No public releases have been published to GitHub yet. Once you create a Release on GitHub, it will appear here.";
            } else if ($data && isset($data['tag_name'])) {
                $latest_version = str_replace('v', '', $data['tag_name']);
                $has_update = version_compare($latest_version, $current_version, '>');
                $release_notes = $data['body'] ?? '';
            } else {
                echo json_encode(['success' => false, 'error' => 'Failed to check GitHub API. Rate limit exceeded or network error.']);
                exit;
            }

            $components = [
                'Nginx' => trim(shell_exec("nginx -v 2>&1 | awk -F/ '{print $2}' | awk '{print $1}'")),
                'Postfix' => trim(shell_exec("postconf -h mail_version 2>/dev/null")),
                'Dovecot' => trim(shell_exec("dovecot --version 2>/dev/null | awk '{print $1}'")),
                'MariaDB' => trim(shell_exec("mysql -V 2>/dev/null | awk '{print $5}' | cut -d- -f1")),
                'Rspamd' => trim(shell_exec("rspamd --version 2>/dev/null | awk '{print $4}'")),
                'Redis' => trim(shell_exec("redis-server --version 2>/dev/null | awk '{print $3}' | cut -d= -f2")),
                'ClamAV' => trim(shell_exec("clamd --version 2>/dev/null | awk '{print $2}' | cut -d/ -f1"))
            ];
            
            foreach ($components as $k => $v) {
                if (empty($v)) $components[$k] = 'Not Installed';
            }
            
            echo json_encode([
                'success' => true,
                'current_version' => $current_version,
                'latest_version' => $latest_version,
                'has_update' => $has_update,
                'release_notes' => $release_notes,
                'components' => $components
            ]);
            break;
            
        case 'run_upgrade':
            audit_log($pdo, $_SESSION['admin_username'], 'ALL', 'system_upgrade', "Triggered system upgrade via Web Panel");
            
            $output = shell_exec('sudo /usr/local/bin/openmailstack-upgrade.sh 2>&1');
            
            echo json_encode(['success' => true, 'output' => $output]);
            break;
            
        // --- Quarantine & Security ---
        case 'get_quarantine':
            if (!$is_admin) throw new Exception('Unauthorized');
            if ($is_superadmin) {
                $stmt = $pdo->query("SELECT uuid, sender, recipient, subject, score, created FROM quarantine_log ORDER BY created DESC");
            } else {
                $stmt = $pdo->prepare("SELECT uuid, sender, recipient, subject, score, created FROM quarantine_log WHERE recipient LIKE CONCAT('%@', (SELECT domain FROM domain_admins WHERE username = ? LIMIT 1)) ORDER BY created DESC");
                // Note: The above assumes domain admins check their allowed domains. We can do a simpler IN clause.
                $stmt = $pdo->prepare("SELECT q.uuid, q.sender, q.recipient, q.subject, q.score, q.created FROM quarantine_log q JOIN domain_admins da ON q.recipient LIKE CONCAT('%@', da.domain) WHERE da.username = ? ORDER BY q.created DESC");
                $stmt->execute([$_SESSION['username']]);
            }
            echo json_encode(['success' => true, 'data' => $stmt->fetchAll()]);
            break;
            
        case 'view_quarantine':
            if (!$is_admin) throw new Exception('Unauthorized');
            $uuid = $_POST['uuid'] ?? '';
            $stmt = $pdo->prepare("SELECT file_path FROM quarantine_log WHERE uuid = ?");
            $stmt->execute([$uuid]);
            $file = $stmt->fetchColumn();
            if (!$file || !file_exists($file)) throw new Exception("Quarantine file not found");
            echo json_encode(['success' => true, 'content' => file_get_contents($file)]);
            break;
            
        case 'delete_quarantine':
            if (!$is_admin) throw new Exception('Unauthorized');
            $uuid = $_POST['uuid'] ?? '';
            $stmt = $pdo->prepare("SELECT file_path FROM quarantine_log WHERE uuid = ?");
            $stmt->execute([$uuid]);
            $file = $stmt->fetchColumn();
            if ($file && file_exists($file)) unlink($file);
            $pdo->prepare("DELETE FROM quarantine_log WHERE uuid = ?")->execute([$uuid]);
            audit_log($pdo, $_SESSION['username'], 'ALL', 'delete_quarantine', "Deleted quarantined email UUID $uuid");
            echo json_encode(['success' => true]);
            break;
            
        case 'release_quarantine':
            if (!$is_admin) throw new Exception('Unauthorized');
            $uuid = $_POST['uuid'] ?? '';
            $stmt = $pdo->prepare("SELECT recipient, file_path FROM quarantine_log WHERE uuid = ?");
            $stmt->execute([$uuid]);
            $q = $stmt->fetch(PDO::FETCH_ASSOC);
            if (!$q || !file_exists($q['file_path'])) throw new Exception("Quarantine file not found");
            
            // Release via sendmail
            $rcpt = escapeshellarg($q['recipient']);
            $file = escapeshellarg($q['file_path']);
            exec("/usr/sbin/sendmail -t $rcpt < $file", $out, $ret);
            
            if ($ret === 0) {
                unlink($q['file_path']);
                $pdo->prepare("DELETE FROM quarantine_log WHERE uuid = ?")->execute([$uuid]);
                audit_log($pdo, $_SESSION['username'], 'ALL', 'release_quarantine', "Released quarantined email to $rcpt");
                echo json_encode(['success' => true]);
            } else {
                echo json_encode(['success' => false, 'error' => "Failed to release email. Sendmail exit code $ret"]);
            }
            break;

        case 'get_spam_policies':
            if (!$is_admin) throw new Exception('Unauthorized');
            $domain = $_POST['domain'] ?? 'GLOBAL';
            if ($domain === 'GLOBAL') {
                if (!$is_superadmin) throw new Exception('Unauthorized for Global rules');
                $stmt = $pdo->query("SELECT rules_json FROM global_spam_rules WHERE id = 1");
            } else {
                if (!$is_superadmin) {
                    $stmt = $pdo->prepare("SELECT 1 FROM domain_admins WHERE username = ? AND domain = ?");
                    $stmt->execute([$_SESSION['username'], $domain]);
                    if (!$stmt->fetch()) throw new Exception('Unauthorized for this domain');
                }
                $stmt = $pdo->prepare("SELECT rules_json FROM domain_spam_rules WHERE domain = ?");
                $stmt->execute([$domain]);
            }
            $rules = $stmt->fetchColumn();
            echo json_encode(['success' => true, 'rules' => $rules ? json_decode($rules, true) : null]);
            break;
            
        case 'set_spam_policies':
            if (!$is_admin) throw new Exception('Unauthorized');
            $domain = $_POST['domain'] ?? 'GLOBAL';
            $rules = $_POST['rules'] ?? '{}';
            if (!json_decode($rules)) throw new Exception('Invalid JSON payload');
            
            if ($domain === 'GLOBAL') {
                if (!$is_superadmin) throw new Exception('Unauthorized for Global rules');
                $stmt = $pdo->prepare("INSERT INTO global_spam_rules (id, rules_json) VALUES (1, ?) ON DUPLICATE KEY UPDATE rules_json = ?");
                $stmt->execute([$rules, $rules]);
            } else {
                if (!$is_superadmin) {
                    $stmt = $pdo->prepare("SELECT 1 FROM domain_admins WHERE username = ? AND domain = ?");
                    $stmt->execute([$_SESSION['username'], $domain]);
                    if (!$stmt->fetch()) throw new Exception('Unauthorized for this domain');
                }
                $stmt = $pdo->prepare("INSERT INTO domain_spam_rules (domain, rules_json) VALUES (?, ?) ON DUPLICATE KEY UPDATE rules_json = ?");
                $stmt->execute([$domain, $rules, $rules]);
            }
            audit_log($pdo, $_SESSION['username'], $domain, 'set_spam_policies', "Updated spam policies");
            echo json_encode(['success' => true]);
            break;
        default:
            echo json_encode(['error' => 'Invalid action']);
            break;
    }
} catch (Exception $e) {
    echo json_encode(['success' => false, 'error' => $e->getMessage()]);
}

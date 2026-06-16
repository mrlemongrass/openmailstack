<?php
// OpenMailStack REST API v1
// Designed for WHMCS and other automated billing integrations
header('Content-Type: application/json');

require_once '../config.php';

try {
    $pdo = new PDO(
        "mysql:host=localhost;dbname=" . POSTFIXADMIN_DB_NAME . ";charset=utf8mb4",
        POSTFIXADMIN_DB_USER,
        POSTFIXADMIN_DB_PASSWORD,
        [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC
        ]
    );
} catch (PDOException $e) {
    http_response_code(500);
    echo json_encode(['error' => 'Database connection failed']);
    exit;
}

// 1. Authenticate Request
$headers = getallheaders();
$auth_header = $headers['Authorization'] ?? '';
if (!preg_match('/Bearer\s+(sk_[a-f0-9]+)/i', $auth_header, $matches)) {
    http_response_code(401);
    echo json_encode(['error' => 'Unauthorized: Missing or invalid Bearer token']);
    exit;
}
$provided_key = $matches[1];

$stmt = $pdo->query("SELECT id, key_hash, description FROM api_keys");
$api_keys = $stmt->fetchAll();

$authenticated_key_id = null;
$authenticated_desc = null;
foreach ($api_keys as $key_row) {
    if (password_verify($provided_key, $key_row['key_hash'])) {
        $authenticated_key_id = $key_row['id'];
        $authenticated_desc = $key_row['description'];
        break;
    }
}

if (!$authenticated_key_id) {
    http_response_code(401);
    echo json_encode(['error' => 'Unauthorized: Invalid API key']);
    exit;
}

// Update last used timestamp
$stmt = $pdo->prepare("UPDATE api_keys SET last_used = NOW() WHERE id = ?");
$stmt->execute([$authenticated_key_id]);

// Helper Functions
function audit_log_api($pdo, $admin, $domain, $action, $data) {
    $stmt = $pdo->prepare("INSERT INTO log (timestamp, username, domain, action, data) VALUES (NOW(), ?, ?, ?, ?)");
    $stmt->execute([$admin, $domain, $action, $data]);
}

function hash_password($password) {
    $escaped_pwd = escapeshellarg($password);
    $hash = trim(shell_exec("PATH=/usr/bin:/bin doveadm pw -s SHA512-CRYPT -p $escaped_pwd 2>/dev/null"));
    if (empty($hash)) {
        $salt = substr(str_shuffle('./ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'), 0, 16);
        $hash = '{SHA512-CRYPT}' . crypt($password, '$6$' . $salt . '$');
    }
    return $hash;
}

// 2. Parse Request
$method = $_SERVER['REQUEST_METHOD'];
$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
// Extract the route part after /api_v1.php
$route_parts = explode('/api_v1.php/', $path);
$route = isset($route_parts[1]) ? rtrim($route_parts[1], '/') : '';

// Get JSON body
$inputJSON = file_get_contents('php://input');
$input = json_decode($inputJSON, TRUE) ?? [];

$admin_user = "API: " . $authenticated_desc;

// 3. Routing
try {
    if ($method === 'POST' && $route === 'domains') {
        $domain = $input['domain'] ?? '';
        $max_aliases = $input['max_aliases'] ?? 0;
        $max_mailboxes = $input['max_mailboxes'] ?? 0;
        $max_quota = $input['max_quota'] ?? 0; // Total Domain Quota (MB)
        $quota = $input['quota'] ?? 0; // Default Mailbox Quota (MB)
        
        if (empty($domain)) throw new Exception("Missing required field: domain");
        
        $stmt = $pdo->prepare("INSERT INTO domain (domain, description, aliases, mailboxes, maxquota, quota, transport, backupmx, created, modified, active) VALUES (?, ?, ?, ?, ?, ?, 'virtual', 0, NOW(), NOW(), 1)");
        $stmt->execute([$domain, $domain, $max_aliases, $max_mailboxes, $max_quota, $quota]);
        
        audit_log_api($pdo, $admin_user, $domain, 'add_domain', "API created domain $domain");
        echo json_encode(['success' => true, 'message' => "Domain $domain created"]);
        
    } elseif ($method === 'DELETE' && preg_match('/^domains\/(.+)$/', $route, $matches)) {
        $domain = $matches[1];
        if (empty($domain)) throw new Exception("Missing domain in path");
        
        $pdo->beginTransaction();
        $stmt = $pdo->prepare("DELETE FROM mailbox WHERE domain = ?");
        $stmt->execute([$domain]);
        $stmt = $pdo->prepare("DELETE FROM alias WHERE domain = ?");
        $stmt->execute([$domain]);
        $stmt = $pdo->prepare("DELETE FROM domain WHERE domain = ?");
        $stmt->execute([$domain]);
        $pdo->commit();
        
        audit_log_api($pdo, $admin_user, $domain, 'delete_domain', "API deleted domain $domain");
        echo json_encode(['success' => true, 'message' => "Domain $domain and all mailboxes deleted"]);
        
    } elseif ($method === 'POST' && $route === 'mailboxes') {
        $email = $input['email'] ?? '';
        $password = $input['password'] ?? '';
        $name = $input['name'] ?? '';
        $quota = $input['quota'] ?? 0; // MB
        
        if (empty($email) || empty($password)) throw new Exception("Missing email or password");
        $domain = explode('@', $email)[1] ?? '';
        if (empty($domain)) throw new Exception("Invalid email format");
        
        // Verify domain exists
        $stmt = $pdo->prepare("SELECT domain FROM domain WHERE domain = ?");
        $stmt->execute([$domain]);
        if (!$stmt->fetch()) throw new Exception("Domain $domain does not exist");
        
        $maildir = $domain . '/' . explode('@', $email)[0] . '/';
        $hashed_pwd = hash_password($password);
        $quota_bytes = $quota == -1 ? -1 : ($quota == 0 ? 0 : $quota * 1048576);
        
        $stmt = $pdo->prepare("INSERT INTO mailbox (username, password, name, maildir, quota, local_part, domain, created, modified, active) VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW(), 1)");
        $stmt->execute([$email, $hashed_pwd, $name, $maildir, $quota_bytes, explode('@', $email)[0], $domain]);
        
        // Create matching alias for delivery
        $stmt = $pdo->prepare("INSERT INTO alias (address, goto, domain, created, modified, active) VALUES (?, ?, ?, NOW(), NOW(), 1)");
        $stmt->execute([$email, $email, $domain]);
        
        audit_log_api($pdo, $admin_user, $domain, 'add_mailbox', "API created mailbox $email");
        echo json_encode(['success' => true, 'message' => "Mailbox $email created"]);

    } elseif ($method === 'PATCH' && preg_match('/^mailboxes\/(.+)$/', $route, $matches)) {
        $email = $matches[1];
        if (empty($email)) throw new Exception("Missing email in path");
        
        $updates = [];
        $params = [];
        
        if (isset($input['password']) && !empty($input['password'])) {
            $updates[] = "password = ?";
            $params[] = hash_password($input['password']);
        }
        if (isset($input['active'])) {
            $updates[] = "active = ?";
            $params[] = $input['active'] ? 1 : 0;
        }
        if (isset($input['quota'])) {
            $updates[] = "quota = ?";
            $params[] = $input['quota'] == -1 ? -1 : ($input['quota'] == 0 ? 0 : $input['quota'] * 1048576);
        }
        
        if (empty($updates)) throw new Exception("No valid fields to update");
        
        $updates[] = "modified = NOW()";
        $params[] = $email;
        
        $sql = "UPDATE mailbox SET " . implode(", ", $updates) . " WHERE username = ?";
        $stmt = $pdo->prepare($sql);
        $stmt->execute($params);
        
        if (isset($input['active'])) {
            $stmt = $pdo->prepare("UPDATE alias SET active = ?, modified = NOW() WHERE address = ?");
            $stmt->execute([$input['active'] ? 1 : 0, $email]);
        }
        
        audit_log_api($pdo, $admin_user, explode('@', $email)[1], 'edit_mailbox', "API updated mailbox $email");
        echo json_encode(['success' => true, 'message' => "Mailbox $email updated"]);

    } elseif ($method === 'DELETE' && preg_match('/^mailboxes\/(.+)$/', $route, $matches)) {
        $email = $matches[1];
        if (empty($email)) throw new Exception("Missing email in path");
        
        $stmt = $pdo->prepare("DELETE FROM mailbox WHERE username = ?");
        $stmt->execute([$email]);
        
        $stmt = $pdo->prepare("DELETE FROM alias WHERE address = ?");
        $stmt->execute([$email]);
        
        audit_log_api($pdo, $admin_user, explode('@', $email)[1], 'delete_mailbox', "API deleted mailbox $email");
        echo json_encode(['success' => true, 'message' => "Mailbox $email deleted"]);
        
    } else {
        http_response_code(404);
        echo json_encode(['error' => "Endpoint not found: $method /api_v1.php/$route"]);
    }
} catch (Exception $e) {
    http_response_code(400);
    echo json_encode(['error' => $e->getMessage()]);
}

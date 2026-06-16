<?php
session_start();
if (empty($_SESSION['csrf_token'])) {
    $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
}
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="csrf-token" content="<?php echo htmlspecialchars($_SESSION['csrf_token']); ?>">
    <title>OpenMailStack Admin Portal</title>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="css/style.css">
</head>
<body>
    <div id="app">
        <?php if (!isset($_SESSION['role'])): ?>
            <div class="login-container glass">
                <div class="brand">
                    <div class="logo-icon"></div>
                    <h1>OpenMailStack</h1>
                </div>
                <h2>Login</h2>
                <form id="login-form">
                    <div class="input-group">
                        <label for="username">Email Address</label>
                        <input type="text" id="username" name="username" required placeholder="user@domain.com">
                    </div>
                    <div class="input-group">
                        <label for="password">Password</label>
                        <input type="password" id="password" name="password" required>
                    </div>
                    <button type="submit" class="btn btn-primary">Login</button>
                    <div id="login-error" class="error-msg"></div>
                </form>
            </div>
        <?php else: ?>
            <nav class="sidebar glass" data-role="<?php echo htmlspecialchars($_SESSION['role']); ?>">
                <div class="brand">
                    <div class="logo-icon small"></div>
                    <h2>OMS <?php echo $_SESSION['role'] === 'admin' ? 'Admin' : 'Portal'; ?></h2>
                </div>
                <ul class="nav-links">
                    <?php if ($_SESSION['role'] === 'admin'): ?>
                        <li class="active" data-view="dashboard">Dashboard</li>
                        <li data-view="domains">Domains</li>
                        <li data-view="mailboxes">Mailboxes</li>
                        <li data-view="aliases">Aliases & Groups</li>
                        <li data-view="routing">Cross-Domain Routing</li>
                        <li data-view="quarantine">Spam Quarantine</li>
                        <li data-view="spam_policies">Spam Policies</li>
                        <li data-view="spam">Rspamd WebUI</li>
                        <li data-view="admins">Administrators</li>
                        <li data-view="logs">Audit Logs</li>
                        <li data-view="apikeys">API Keys</li>
                        <li data-view="updates">System Updates</li>
                    <?php else: ?>
                        <li class="active" data-view="user_profile">My Account</li>
                        <li data-view="user_forwarding">Mail Forwarding</li>
                        <li data-view="user_spam">Spam Rules</li>
                    <?php endif; ?>
                </ul>
                <div class="user-info" style="margin-top:auto; padding:15px; font-size:0.85rem; color:var(--text-secondary); text-align:center;">
                    Logged in as:<br>
                    <strong style="color:var(--text-primary); word-break: break-all;"><?php echo htmlspecialchars($_SESSION['username'] ?? ''); ?></strong>
                </div>
                <button id="logout-btn" class="btn btn-outline" style="margin: 0 15px 15px 15px;">Logout</button>
            </nav>
            <main class="main-content glass">
                <header>
                    <h2 id="view-title">Dashboard</h2>
                </header>
                <div id="view-content" class="content-area">
                    <!-- Dynamic content injected here -->
                </div>
            </main>
        <?php endif; ?>
    </div>
    <script src="js/app.js"></script>
</body>
</html>

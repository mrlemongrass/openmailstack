document.addEventListener('DOMContentLoaded', () => {
    const loginForm = document.getElementById('login-form');
    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const username = document.getElementById('username').value;
            const password = document.getElementById('password').value;
            const csrfToken = document.querySelector('meta[name="csrf-token"]').getAttribute('content');
            const res = await fetch('api.php?action=login', {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'X-CSRF-Token': csrfToken
                },
                body: `username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`
            });
            const data = await res.json();
            if (data.success) {
                location.reload();
            } else {
                document.getElementById('login-error').innerText = data.error || 'Login failed';
            }
        });
        return; // Stop execution if on login page
    }

    // Dashboard Logic
    const navLinks = document.querySelectorAll('.nav-links li');
    const viewContent = document.getElementById('view-content');
    const viewTitle = document.getElementById('view-title');
    const logoutBtn = document.getElementById('logout-btn');

    logoutBtn.addEventListener('click', async () => {
        await fetch('api.php?action=logout');
        location.reload();
    });

    const views = {
        dashboard: renderDashboard,
        domains: renderDomains,
        mailboxes: renderMailboxes,
        aliases: renderAliases,
        routing: renderRouting,
        spam: renderSpam,
        quarantine: renderQuarantine,
        spam_policies: renderSpamPolicies,
        admins: renderAdmins,
        apikeys: renderApiKeys,
        logs: renderLogs,
        updates: renderUpdates,
        user_profile: renderUserProfile,
        user_forwarding: renderUserForwarding,
        user_spam: renderUserSpam
    };

    async function renderUpdates() {
        viewContent.innerHTML = '<div class="loader">Checking for updates...</div>';
        const res = await apiCall('check_updates');
        
        if(!res.success) {
            viewContent.innerHTML = `<div class="error-msg">${escapeHTML(res.error)}</div>`;
            return;
        }
        
        let html = `
            <div class="form-card" style="text-align:center; padding: 40px; margin-bottom: 20px;">
                <div style="font-size: 3rem; margin-bottom:20px;">📦</div>
                <h2>System Updates</h2>
                <p style="margin-top:20px; font-size:1.1rem;">Current Version: <strong>v${res.current_version}</strong></p>
                <p style="font-size:1.1rem; margin-bottom:30px;">Latest Release: <strong>v${res.latest_version}</strong></p>
        `;
        
        if (res.has_update) {
            html += `
                <div style="background: rgba(0, 255, 0, 0.1); border: 1px solid var(--success); padding: 20px; border-radius: 8px; margin-bottom: 30px;">
                    <h3 style="color: var(--success); margin-bottom: 10px;">Update Available!</h3>
                    <p style="color: var(--text-secondary); margin-bottom: 20px;">A new version of OpenMailStack is available. Click below to safely perform an in-place upgrade.</p>
                    <button id="btn-run-upgrade" class="btn btn-primary" style="font-size: 1.1rem; padding: 12px 24px;">Install Update Now</button>
                </div>
            `;
        } else {
            html += `
                <div style="background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.1); padding: 20px; border-radius: 8px; margin-bottom: 30px;">
                    <h3 style="color: var(--text-primary); margin-bottom: 10px;">System is Up to Date</h3>
                    <p style="color: var(--text-secondary);">You are running the latest version of OpenMailStack.</p>
                </div>
            `;
        }
        
        if (res.release_notes) {
            html += `
                <div style="text-align: left; background: rgba(0,0,0,0.2); padding: 20px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.05);">
                    <h4 style="margin-bottom:15px;">Release Notes:</h4>
                    <pre style="white-space: pre-wrap; font-family: inherit; color: var(--text-secondary); line-height: 1.5;">${escapeHTML(res.release_notes)}</pre>
                </div>
            `;
        }
        
        html += `</div>`;
        
        // Add component versions table
        html += `
            <div class="form-card" style="margin-top: 20px;">
                <h3 style="margin-bottom: 15px;">Component Versions</h3>
                <table style="width: 100%; border-collapse: collapse; text-align: left;">
                    <thead>
                        <tr style="border-bottom: 1px solid rgba(255,255,255,0.1);">
                            <th style="padding: 10px;">Component</th>
                            <th style="padding: 10px;">Version</th>
                        </tr>
                    </thead>
                    <tbody>
        `;
        
        for (const [comp, ver] of Object.entries(res.components || {})) {
            html += `
                <tr style="border-bottom: 1px solid rgba(255,255,255,0.05);">
                    <td style="padding: 10px; font-weight: 500;">${escapeHTML(comp)}</td>
                    <td style="padding: 10px; font-family: monospace; color: var(--text-secondary);">${escapeHTML(ver)}</td>
                </tr>
            `;
        }
        
        html += `
                    </tbody>
                </table>
            </div>
        `;
        
        viewContent.innerHTML = html;
        
        const btnUpgrade = document.getElementById('btn-run-upgrade');
        if (btnUpgrade) {
            btnUpgrade.addEventListener('click', async () => {
                if(!confirm('Are you sure you want to upgrade the system? Services may briefly restart.')) return;
                btnUpgrade.disabled = true;
                btnUpgrade.innerHTML = 'Upgrading... Please wait (this may take a minute)';
                
                const upRes = await apiCall('run_upgrade');
                if (upRes.success) {
                    alert("Upgrade completed successfully!\n\n" + upRes.output);
                    window.location.reload();
                } else {
                    alert("Upgrade failed: " + upRes.error);
                    btnUpgrade.disabled = false;
                    btnUpgrade.innerHTML = 'Install Update Now';
                }
            });
        }
    };

    navLinks.forEach(link => {
        link.addEventListener('click', () => {
            navLinks.forEach(l => l.classList.remove('active'));
            link.classList.add('active');
            const view = link.dataset.view;
            viewTitle.innerText = link.innerText;
            viewContent.style.display = 'block'; // Reset display from flex in spam view
            views[view]();
        });
    });

    // Initial load
    const sidebar = document.querySelector('.sidebar');
    const role = sidebar ? sidebar.getAttribute('data-role') : 'admin';
    if (role === 'admin') {
        views.dashboard();
    } else {
        views.user_profile();
    }

    // Helper: Escape HTML
    function escapeHTML(str) {
        if (!str) return '';
        return String(str).replace(/[&<>"']/g, function(m) {
            return {
                '&': '&amp;', '<': '&lt;', '>': '&gt;',
                '"': '&quot;', "'": '&#39;'
            }[m];
        });
    }

    // Helper: Fetch API
    async function apiCall(action, bodyObj = null) {
        const options = { method: bodyObj ? 'POST' : 'GET' };
        options.headers = { 'X-CSRF-Token': document.querySelector('meta[name="csrf-token"]').getAttribute('content') };
        if (bodyObj) {
            options.headers['Content-Type'] = 'application/x-www-form-urlencoded';
            options.body = new URLSearchParams(bodyObj).toString();
        }
        const res = await fetch(`api.php?action=${action}`, options);
        if (res.status === 401) { location.reload(); return; }
        return res.json();
    }

    // Views
    async function renderDashboard() {
        viewContent.innerHTML = '<div class="loader">Loading...</div>';
        const res = await apiCall('get_system_health');
        if (!res || !res.success) {
            viewContent.innerHTML = '<div class="error-msg">Failed to load system health.</div>';
            return;
        }

        let html = '<div class="dashboard-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 20px;">';
        
        // Services Card
        html += '<div class="form-card" style="margin:0;"><h3>System Services</h3><br><ul style="list-style:none; padding:0;">';
        for (const [srv, active] of Object.entries(res.services)) {
            let color = active ? 'var(--success)' : 'var(--danger)';
            let status = active ? 'Active' : 'Inactive';
            html += `<li style="display:flex; justify-content:space-between; padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.05);">
                        <span><strong style="color:var(--text-primary);">${srv}</strong></span>
                        <span style="color:${color}; font-weight:600;">${status}</span>
                     </li>`;
        }
        html += '</ul></div>';

        // Stats Card
        let memPct = Math.round((res.stats.mem_used_mb / Math.max(1, res.stats.mem_total_mb)) * 100);
        let diskPct = Math.round((res.stats.disk_used_gb / Math.max(1, res.stats.disk_total_gb)) * 100);
        
        html += '<div class="form-card" style="margin:0;"><h3>Server Resources</h3><br><ul style="list-style:none; padding:0;">';
        html += `<li style="padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.05);">
                    <div style="display:flex; justify-content:space-between; margin-bottom:5px;">
                        <span>CPU Load (1m, 5m, 15m)</span>
                        <strong style="color:var(--text-primary);">${res.stats.load.map(n=>n.toFixed(2)).join(', ')}</strong>
                    </div>
                 </li>`;
        html += `<li style="padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.05);">
                    <div style="display:flex; justify-content:space-between; margin-bottom:5px;">
                        <span>Memory Usage</span>
                        <strong style="color:var(--text-primary);">${res.stats.mem_used_mb} MB / ${res.stats.mem_total_mb} MB (${memPct}%)</strong>
                    </div>
                    <div style="width:100%; background:rgba(255,255,255,0.1); height:8px; border-radius:4px; overflow:hidden;">
                        <div style="width:${memPct}%; background:var(--primary); height:100%;"></div>
                    </div>
                 </li>`;
        html += `<li style="padding: 10px 0;">
                    <div style="display:flex; justify-content:space-between; margin-bottom:5px;">
                        <span>Disk Usage (/)</span>
                        <strong style="color:var(--text-primary);">${res.stats.disk_used_gb} GB / ${res.stats.disk_total_gb} GB (${diskPct}%)</strong>
                    </div>
                    <div style="width:100%; background:rgba(255,255,255,0.1); height:8px; border-radius:4px; overflow:hidden;">
                        <div style="width:${diskPct}%; background:var(--primary); height:100%;"></div>
                    </div>
                 </li>`;
        html += '</ul></div>';

        html += '</div>';
        viewContent.innerHTML = html;
    }

    async function renderQuarantine() {
        viewContent.innerHTML = '<div class="loader">Loading Quarantine...</div>';
        const res = await apiCall('get_quarantine');
        if(!res.success) return viewContent.innerHTML = `<div class="error-msg">${escapeHTML(res.error)}</div>`;

        let html = `<table>
            <thead><tr><th>Date</th><th>Score</th><th>Sender</th><th>Recipient</th><th>Subject</th><th>Actions</th></tr></thead>
            <tbody>`;
        if (res.data.length === 0) {
            html += `<tr><td colspan="6" style="text-align:center;">Quarantine is empty! 🎉</td></tr>`;
        } else {
            res.data.forEach(q => {
                html += `<tr>
                    <td><small>${escapeHTML(q.created)}</small></td>
                    <td><span style="color:var(--danger)">${escapeHTML(q.score)}</span></td>
                    <td>${escapeHTML(q.sender)}</td>
                    <td>${escapeHTML(q.recipient)}</td>
                    <td>${escapeHTML(q.subject)}</td>
                    <td class="action-btns">
                        <button class="btn btn-outline" onclick="viewQuarantineEmail('${escapeHTML(q.uuid)}')">View</button>
                        <button class="btn btn-primary" onclick="releaseQuarantine('${escapeHTML(q.uuid)}')">Release</button>
                        <button class="btn btn-danger" onclick="deleteQuarantine('${escapeHTML(q.uuid)}')">Delete</button>
                    </td>
                </tr>`;
            });
        }
        html += `</tbody></table>`;
        viewContent.innerHTML = html;
    }

    window.viewQuarantineEmail = async (uuid) => {
        const res = await apiCall('view_quarantine', { uuid });
        if(!res.success) return alert(res.error);
        
        let modal = document.createElement('div');
        modal.className = 'modal-backdrop';
        modal.innerHTML = `
            <div class="modal-content" style="max-width: 800px; width: 90%;">
                <h3>Raw Email Viewer</h3>
                <pre style="background:var(--bg-dark); padding:15px; border-radius:8px; overflow:auto; max-height:60vh; font-size:12px; color:#fff; white-space:pre-wrap;">${escapeHTML(res.content)}</pre>
                <div class="form-actions" style="margin-top:20px;">
                    <button class="btn btn-outline" onclick="this.closest('.modal-backdrop').remove()">Close</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    }

    window.releaseQuarantine = async (uuid) => {
        if(!confirm("Are you sure you want to release this email to the recipient's inbox?")) return;
        const res = await apiCall('release_quarantine', { uuid });
        if(res.success) renderQuarantine();
        else alert(res.error);
    }

    window.deleteQuarantine = async (uuid) => {
        if(!confirm("Are you sure you want to permanently delete this email?")) return;
        const res = await apiCall('delete_quarantine', { uuid });
        if(res.success) renderQuarantine();
        else alert(res.error);
    }

    async function renderSpamPolicies() {
        viewContent.innerHTML = '<div class="loader">Loading Policies...</div>';
        
        let html = `
            <div class="form-card" style="margin-bottom: 20px;">
                <h3 style="margin-bottom: 10px;">Global & Domain Spam Policies</h3>
                <p style="color:var(--text-secondary); margin-bottom:15px; font-size:0.95rem;">
                    Edit the hierarchical JSON rules used by Rspamd. Supported keys: <br>
                    <code>whitelisted_senders</code>, <code>blacklisted_senders</code>, <code>banned_ips</code>, <code>banned_extensions</code>.
                </p>
                <div style="display:flex; gap:20px; align-items:flex-start;">
                    <div style="flex:1;">
                        <label>Select Scope:</label>
                        <select id="policy-domain" class="input-group input" style="width:100%; padding: 10px; margin-bottom:10px; border-radius:8px;" onchange="loadPolicyScope()">
                            <option value="GLOBAL">GLOBAL (Server-Wide)</option>
                        </select>
                        <textarea id="policy-json" style="width:100%; height:300px; background:var(--bg-dark); color:#fff; border:1px solid var(--border-glass); border-radius:8px; padding:15px; font-family:monospace;"></textarea>
                        <br><br>
                        <button class="btn btn-primary" onclick="savePolicyScope()">Save Policies</button>
                    </div>
                </div>
            </div>
        `;
        viewContent.innerHTML = html;
        
        const dRes = await apiCall('get_domains');
        if(dRes.success) {
            const select = document.getElementById('policy-domain');
            dRes.data.forEach(d => {
                if (d.domain !== 'ALL') {
                    const opt = document.createElement('option');
                    opt.value = d.domain;
                    opt.textContent = d.domain;
                    select.appendChild(opt);
                }
            });
        }
        
        window.loadPolicyScope = async () => {
            const domain = document.getElementById('policy-domain').value;
            const res = await apiCall('get_spam_policies', { domain });
            const rules = (res.success && res.rules) ? res.rules : {
                whitelisted_senders: [],
                blacklisted_senders: [],
                banned_ips: [],
                banned_extensions: []
            };
            document.getElementById('policy-json').value = JSON.stringify(rules, null, 4);
        }
        
        window.savePolicyScope = async () => {
            const domain = document.getElementById('policy-domain').value;
            const rules = document.getElementById('policy-json').value;
            const res = await apiCall('set_spam_policies', { domain, rules });
            if(res.success) alert("Policies saved and immediately active!");
            else alert(res.error);
        }
        
        await loadPolicyScope();
    }

    async function renderSpam() {
        viewContent.innerHTML = '<div class="loader">Loading...</div>';
        const res = await apiCall('get_rspamd_password');
        let passText = (res && res.success && res.password) ? res.password : 'Unknown';
        
        let html = `
            <div class="form-card" style="margin-bottom: 20px;">
                <h3 style="margin-bottom: 10px;">Rspamd Web Interface</h3>
                <p style="color:var(--text-secondary); margin-bottom:15px; font-size:0.95rem;">
                    Use the embedded Rspamd console below to manage Spam thresholds, view real-time scanning logs, and manage global whitelists/blacklists.
                </p>
                <div style="background: rgba(0,0,0,0.3); padding: 15px; border-radius: 8px; border: 1px solid var(--border-glass); display: flex; justify-content: space-between; align-items: center;">
                    <div>
                        <span style="color:var(--text-secondary); font-size: 0.9rem;">Rspamd Master Password:</span>
                        <strong style="margin-left: 10px; font-family: monospace; font-size: 1.1rem; color: var(--accent);">${escapeHTML(passText)}</strong>
                    </div>
                    <button class="btn btn-outline" style="width:auto;" onclick="navigator.clipboard.writeText('${escapeHTML(passText)}'); alert('Password copied!')">Copy Password</button>
                </div>
            </div>
            <div style="flex-grow: 1; border-radius: 12px; overflow: hidden; border: 1px solid var(--border-glass); height: calc(100vh - 350px); min-height: 500px;">
                <iframe src="rspamd/" style="width: 100%; height: 100%; border: none;"></iframe>
            </div>
        `;
        viewContent.innerHTML = html;
        viewContent.style.display = 'flex';
        viewContent.style.flexDirection = 'column';
    }

    async function renderApiKeys() {
        viewTitle.textContent = 'API Keys';
        viewContent.innerHTML = '<div class="loader">Loading...</div>';
        
        const res = await apiCall('get_api_keys');
        if(!res.success) {
            viewContent.innerHTML = `<div class="error-msg">${escapeHTML(res.error)}</div>`;
            return;
        }

        let html = '';
        res.data.forEach(k => {
            html += `<tr>
                <td>${escapeHTML(k.description)}</td>
                <td>${escapeHTML(k.created_at)}</td>
                <td>${escapeHTML(k.last_used || 'Never')}</td>
                <td class="action-btns">
                    <button class="btn btn-danger" onclick="deleteApiKey(${k.id})">Revoke</button>
                </td>
            </tr>`;
        });

        viewContent.innerHTML = `
            <div class="top-actions">
                <button class="btn btn-primary" onclick="createApiKey()">+ Generate New API Key</button>
            </div>
            <div class="card glass">
                <table class="data-table">
                    <thead><tr><th>Description</th><th>Created At</th><th>Last Used</th><th>Actions</th></tr></thead>
                    <tbody>${html || '<tr><td colspan="4" style="text-align:center;">No API Keys generated yet.</td></tr>'}</tbody>
                </table>
            </div>
        `;
    }

    window.createApiKey = async () => {
        const desc = prompt("Enter a description for this API key (e.g. WHMCS Billing System):");
        if(!desc) return;
        
        const res = await apiCall('create_api_key', { description: desc });
        if(res.success) {
            alert("SUCCESS! Please copy this API Key now. It will NEVER be shown again:\n\n" + res.raw_key);
            renderApiKeys();
        } else {
            alert(res.error);
        }
    }

    window.deleteApiKey = async (id) => {
        if(!confirm("Are you sure you want to revoke this API key? External systems using it will immediately lose access.")) return;
        const res = await apiCall('delete_api_key', { id });
        if(res.success) renderApiKeys();
        else alert(res.error);
    }

    // --- End User Views ---
    async function renderUserProfile() {
        viewTitle.textContent = 'My Account';
        const res = await apiCall('user_get_profile');
        if(!res.success) return;
        
        viewContent.innerHTML = `
            <div class="card glass" style="max-width: 500px;">
                <h3>Change Password</h3><br>
                <form id="user-password-form">
                    <div class="input-group">
                        <label>Email Address</label>
                        <input type="text" value="${escapeHTML(res.username)}" disabled>
                    </div>
                    <div class="input-group">
                        <label>New Password</label>
                        <input type="password" id="user-new-pwd" required>
                    </div>
                    <div class="form-actions">
                        <button type="submit" class="btn btn-primary">Update Password</button>
                    </div>
                </form>
            </div>
        `;
        document.getElementById('user-password-form').onsubmit = async (e) => {
            e.preventDefault();
            const pwd = document.getElementById('user-new-pwd').value;
            const updateRes = await apiCall('user_change_password', { password: pwd });
            if(updateRes.success) {
                alert('Password updated successfully! Please use your new password next time you login.');
                document.getElementById('user-new-pwd').value = '';
            } else alert(updateRes.error);
        };
    }

    async function renderUserForwarding() {
        viewTitle.textContent = 'Mail Forwarding';
        const res = await apiCall('user_get_forwarding');
        if(!res.success) return;
        
        viewContent.innerHTML = `
            <div class="card glass" style="max-width: 600px;">
                <p style="color:var(--text-secondary); margin-bottom: 20px;">
                    Enter an email address where you want all your incoming mail to be delivered. 
                    If you want to keep a copy in your own inbox as well, include your own email address separated by a comma.
                </p>
                <form id="user-forward-form">
                    <div class="input-group">
                        <label>Forward To (Comma Separated)</label>
                        <input type="text" id="user-goto" value="${escapeHTML(res.goto)}" required>
                    </div>
                    <div class="form-actions">
                        <button type="submit" class="btn btn-primary">Save Forwarding</button>
                    </div>
                </form>
            </div>
        `;
        document.getElementById('user-forward-form').onsubmit = async (e) => {
            e.preventDefault();
            const goto = document.getElementById('user-goto').value;
            const updateRes = await apiCall('user_set_forwarding', { goto });
            if(updateRes.success) alert('Forwarding updated successfully!');
            else alert(updateRes.error);
        };
    }

    async function renderUserSpam() {
        viewTitle.textContent = 'Spam Rules';
        const res = await apiCall('user_get_spam_rules');
        if(!res.success) return;
        
        const rules = res.rules || { whitelist: '', blacklist: '' };
        
        viewContent.innerHTML = `
            <div class="card glass">
                <p style="color:var(--text-secondary); margin-bottom: 20px;">
                    Define custom email addresses or domains you want to explicitly allow (whitelist) or block (blacklist). 
                    Use one entry per line. You can use wildcards like <code>*@marketing.com</code>.
                </p>
                <form id="user-spam-form">
                    <div style="display:flex; gap: 20px;">
                        <div class="input-group" style="flex: 1;">
                            <label>Whitelist (Never mark as spam)</label>
                            <textarea id="user-whitelist" rows="10" placeholder="friend@example.com&#10;*@trusted-domain.com">${escapeHTML(rules.whitelist || '')}</textarea>
                        </div>
                        <div class="input-group" style="flex: 1;">
                            <label>Blacklist (Always mark as spam)</label>
                            <textarea id="user-blacklist" rows="10" placeholder="spammer@bad.com&#10;*@annoying.com">${escapeHTML(rules.blacklist || '')}</textarea>
                        </div>
                    </div>
                    <div class="form-actions" style="margin-top:20px;">
                        <button type="submit" class="btn btn-primary">Save Spam Rules</button>
                    </div>
                </form>
            </div>
        `;
        document.getElementById('user-spam-form').onsubmit = async (e) => {
            e.preventDefault();
            const wl = document.getElementById('user-whitelist').value;
            const bl = document.getElementById('user-blacklist').value;
            const updateRes = await apiCall('user_set_spam_rules', { 
                rules: JSON.stringify({ whitelist: wl, blacklist: bl }) 
            });
            if(updateRes.success) alert('Spam rules updated successfully!');
            else alert(updateRes.error);
        };
    }

    async function renderLogs() {
        viewContent.innerHTML = '<div class="loader">Loading...</div>';
        const res = await apiCall('get_audit_logs');
        if (!res || !res.success) return;

        let html = `
            <div class="form-card" style="margin-bottom: 20px;">
                <h3 style="margin-bottom: 10px;">Activity History</h3>
                <p style="color:var(--text-secondary); margin-bottom:15px; font-size:0.95rem;">
                    This log tracks all changes made to the system by Administrators.
                </p>
            </div>
            <table>
                <thead>
                    <tr>
                        <th>Timestamp</th>
                        <th>Admin User</th>
                        <th>Domain Target</th>
                        <th>Action Performed</th>
                        <th>Details</th>
                    </tr>
                </thead>
                <tbody>
        `;
        
        if (res.data.length === 0) {
            html += `<tr><td colspan="5" style="text-align:center; color:var(--text-secondary);">No logs found.</td></tr>`;
        } else {
            res.data.forEach(log => {
                html += `
                    <tr>
                        <td style="color:var(--text-secondary); font-size:0.85rem;">${escapeHTML(log.timestamp)}</td>
                        <td><strong>${escapeHTML(log.username)}</strong></td>
                        <td>${escapeHTML(log.domain)}</td>
                        <td><span style="background:rgba(59, 130, 246, 0.2); color:var(--accent); padding:2px 6px; border-radius:4px; font-size:0.8rem;">${escapeHTML(log.action)}</span></td>
                        <td style="font-size:0.85rem;">${escapeHTML(log.data)}</td>
                    </tr>
                `;
            });
        }
        
        html += '</tbody></table>';
        viewContent.innerHTML = html;
    }

    async function renderDomains() {
        viewContent.innerHTML = '<div class="loader">Loading...</div>';
        const { data } = await apiCall('get_domains');
        
        let html = `
            <div class="form-card">
                <h3>Add New Domain</h3><br>
                <form id="add-domain-form" class="form-row">
                    <div class="input-group">
                        <label>Domain Name</label>
                        <input type="text" id="new-domain" placeholder="example.com" required>
                    </div>
                    <div class="input-group">
                        <label>Max Total Storage (MB)</label>
                        <input type="number" id="domain-maxquota" placeholder="0 = Unlimited" value="0" min="0">
                    </div>
                    <div class="input-group">
                        <label>Default Mailbox Quota (MB)</label>
                        <input type="number" id="domain-quota" placeholder="0 = Unlimited" value="0" min="0">
                    </div>
                    <div class="form-actions" style="margin-top: 28px;">
                        <button type="submit" class="btn btn-primary">Add Domain</button>
                    </div>
                </form>
            </div>
            <table>
                <thead><tr><th>Domain</th><th>Status</th><th>Quotas</th><th>Actions</th></tr></thead>
                <tbody>
        `;
        data.forEach(d => {
            if(d.domain === 'ALL') return;
            const mQ = d.maxquota == 0 ? 'Unlimited' : (d.maxquota/1048576) + ' MB';
            const uQ = d.quota == 0 ? 'Unlimited' : (d.quota/1048576) + ' MB';
            
            if (d.active == 0 && d.verify_token) {
                html += `<tr>
                    <td>${escapeHTML(d.domain)}</td>
                    <td><span style="color:var(--danger)">Pending Verification</span></td>
                    <td><small style="color:var(--text-secondary)">Max: ${mQ}<br>Def Mbox: ${uQ}</small></td>
                    <td class="action-btns">
                        <button class="btn btn-primary" onclick="verifyDomain('${escapeHTML(d.domain)}', '${escapeHTML(d.verify_token)}')">Verify</button>
                        <button class="btn btn-danger" onclick="deleteDomain('${escapeHTML(d.domain)}')">Delete</button>
                    </td>
                </tr>`;
            } else {
                html += `<tr>
                    <td>${escapeHTML(d.domain)}</td>
                    <td><span style="color:var(--success)">Active</span></td>
                    <td><small style="color:var(--text-secondary)">Max: ${mQ}<br>Def Mbox: ${uQ}</small></td>
                    <td class="action-btns">
                        <button class="btn btn-outline" onclick="viewDNS('${escapeHTML(d.domain)}')">DNS</button>
                        <button class="btn btn-danger" onclick="deleteDomain('${escapeHTML(d.domain)}')">Delete</button>
                    </td>
                </tr>`;
            }
        });
        html += '</tbody></table>';
        viewContent.innerHTML = html;

        document.getElementById('add-domain-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const domain = document.getElementById('new-domain').value;
            const maxquota = document.getElementById('domain-maxquota').value;
            const quota = document.getElementById('domain-quota').value;
            const res = await apiCall('add_domain', { domain, maxquota, quota });
            if(res.success) {
                if(res.needs_verification) alert("Domain added. It must be verified via DNS before it becomes active.");
                renderDomains();
            }
            else alert(res.error);
        });
    }

    window.verifyDomain = async (domain, token) => {
        const confirmMsg = `To verify ownership of ${domain}, please add the following DNS TXT record:\n\n` +
                           `Host: _openmailstack.${domain}\n` +
                           `Value: openmailstack-verify=${token}\n\n` +
                           `Have you added this record and do you want to verify it now?`;
        if (confirm(confirmMsg)) {
            const res = await apiCall('verify_domain', { domain });
            if(res.success) {
                alert("Domain ownership verified successfully!");
                renderDomains();
            } else {
                alert(res.error);
            }
        }
    }

    window.viewDNS = async (domain) => {
        const res = await apiCall('get_dns_records', { domain });
        if(!res.success) return alert(res.error);
        
        let modal = document.createElement('div');
        modal.className = 'modal-backdrop';
        modal.innerHTML = `
            <div class="form-card glass" style="width: 800px; max-width: 90%; max-height: 90vh; overflow-y:auto; margin: 5vh auto; background:var(--bg-dark);">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <h3 style="margin:0;">DNS Records for ${escapeHTML(domain)}</h3>
                    <button class="btn btn-outline" onclick="this.closest('.modal-backdrop').remove()">Close</button>
                </div>
                <p style="color:var(--text-secondary); margin-top:10px; font-size:0.9rem;">Configure these TXT and MX records in your domain's DNS provider to ensure reliable email delivery.</p>
                <table style="margin-top:20px;">
                    <thead><tr><th style="width:150px;">Type</th><th style="width:150px;">Name / Host</th><th>Value (Click to copy)</th></tr></thead>
                    <tbody>
                        ${res.data.map(r => `
                            <tr>
                                <td><strong style="color:var(--text-primary);">${r.type}</strong><br><small style="color:var(--text-secondary); font-size:0.8rem;">${r.description}</small></td>
                                <td>${escapeHTML(r.name)}</td>
                                <td style="word-break: break-all; font-family: monospace; font-size: 0.85rem; cursor: pointer; background:rgba(0,0,0,0.3); padding:8px; border-radius:4px; border:1px solid rgba(255,255,255,0.05);" onclick="navigator.clipboard.writeText(this.innerText); alert('Copied to clipboard!')" title="Click to copy">${escapeHTML(r.value)}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `;
        document.body.appendChild(modal);
    }

    window.deleteDomain = async (domain) => {
        if(confirm(`Are you sure you want to delete ${domain} and all associated mailboxes/aliases?`)) {
            const res = await apiCall('delete_domain', { domain });
            if(res.success) renderDomains();
            else alert(res.error);
        }
    }

    async function renderMailboxes() {
        viewContent.innerHTML = '<div class="loader">Loading...</div>';
        const domainsRes = await apiCall('get_domains');
        const mailboxesRes = await apiCall('get_mailboxes');
        
        let domainsOpt = domainsRes.data.filter(d => d.domain !== 'ALL').map(d => `<option value="${d.domain}">${d.domain}</option>`).join('');

        let html = `
            <div class="form-card">
                <h3>Add New Mailbox</h3><br>
                <form id="add-mailbox-form" class="form-row" style="flex-wrap: wrap;">
                    <div class="input-group">
                        <label>Username</label>
                        <input type="text" id="mb-user" placeholder="user" required>
                    </div>
                    <div class="input-group">
                        <label>Domain</label>
                        <select id="mb-domain">${domainsOpt}</select>
                    </div>
                    <div class="input-group">
                        <label>Full Name</label>
                        <input type="text" id="mb-name" placeholder="John Doe">
                    </div>
                    <div class="input-group">
                        <label>Password</label>
                        <input type="password" id="mb-pass" placeholder="Required" required>
                    </div>
                    <div class="input-group">
                        <label>Quota (MB)</label>
                        <input type="number" id="mb-quota" placeholder="-1 = Inherit Domain Default" value="-1" min="-1">
                    </div>
                    <div class="form-actions" style="width: 100%; margin-top: 10px;">
                        <button type="submit" class="btn btn-primary">Create Mailbox</button>
                    </div>
                </form>
            </div>
            <table>
                <thead><tr><th>Email Address</th><th>Name</th><th>Status</th><th>Quota</th><th>Actions</th></tr></thead>
                <tbody>
        `;
        mailboxesRes.data.forEach(m => {
            const q = m.quota == 0 ? 'Unlimited' : (m.quota/1048576) + ' MB';
            html += `<tr>
                <td>${escapeHTML(m.username)}</td>
                <td>${escapeHTML(m.name || '-')}</td>
                <td><span style="color:${m.active == 1 ? 'var(--success)' : 'var(--danger)'}">${m.active == 1 ? 'Active' : 'Suspended'}</span></td>
                <td><small style="color:var(--text-secondary)">${q}</small></td>
                <td class="action-btns">
                    <button class="btn btn-outline" onclick="editMailbox('${escapeHTML(m.username)}', '${escapeHTML(m.name || '')}', ${m.quota == 0 ? 0 : m.quota / 1048576}, ${m.active})">Edit Info</button>
                    <button class="btn btn-outline" onclick="changePassword('${escapeHTML(m.username)}')">Reset Password</button>
                    <button class="btn btn-danger" onclick="deleteMailbox('${escapeHTML(m.username)}')">Delete</button>
                </td>
            </tr>`;
        });
        html += '</tbody></table>';
        viewContent.innerHTML = html;

        document.getElementById('add-mailbox-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const username = document.getElementById('mb-user').value;
            const domain = document.getElementById('mb-domain').value;
            const name = document.getElementById('mb-name').value;
            const password = document.getElementById('mb-pass').value;
            const quota = document.getElementById('mb-quota').value;
            
            const res = await apiCall('add_mailbox', { username, domain, name, password, quota });
            if(res.success) renderMailboxes();
            else alert(res.error);
        });
    }

    window.editMailbox = async (username, currentName, currentQuota, currentActive) => {
        let modal = document.createElement('div');
        modal.className = 'modal-backdrop';
        modal.innerHTML = `
            <div class="form-card glass" style="width: 500px; max-width: 90%; background:var(--bg-dark); margin: 10vh auto;">
                <h3 style="margin-top:0;">Edit Mailbox</h3>
                <form id="edit-mailbox-form">
                    <div class="input-group" style="margin-top: 15px;">
                        <label>Email Address</label>
                        <input type="text" id="edit-mb-user" value="${escapeHTML(username)}" required>
                    </div>
                    <div class="input-group">
                        <label>Full Name</label>
                        <input type="text" id="edit-mb-name" value="${escapeHTML(currentName)}">
                    </div>
                    <div class="input-group">
                        <label>Quota (MB) [0 = Unlimited, -1 = Domain Default]</label>
                        <input type="number" id="edit-mb-quota" value="${currentQuota}" min="-1">
                    </div>
                    <div class="input-group">
                        <label>Status</label>
                        <select id="edit-mb-active">
                            <option value="1" ${currentActive == 1 ? 'selected' : ''}>Active</option>
                            <option value="0" ${currentActive == 0 ? 'selected' : ''}>Suspended</option>
                        </select>
                    </div>
                    <div class="form-actions" style="margin-top: 20px; display: flex; justify-content: space-between;">
                        <button type="button" class="btn btn-outline" onclick="this.closest('.modal-backdrop').remove()">Cancel</button>
                        <button type="submit" class="btn btn-primary">Save Changes</button>
                    </div>
                </form>
            </div>
        `;
        document.body.appendChild(modal);

        document.getElementById('edit-mailbox-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const new_username = document.getElementById('edit-mb-user').value;
            const name = document.getElementById('edit-mb-name').value;
            const quota = document.getElementById('edit-mb-quota').value;
            const active = document.getElementById('edit-mb-active').value;

            const res = await apiCall('edit_mailbox', { old_username: username, new_username, name, quota, active });
            if(res.success) {
                modal.remove();
                renderMailboxes();
            } else {
                alert(res.error);
            }
        });
    }

    window.deleteMailbox = async (email) => {
        if(confirm(`Delete mailbox ${email}?`)) {
            const res = await apiCall('delete_mailbox', { email });
            if(res.success) renderMailboxes();
            else alert(res.error);
        }
    }

    window.changePassword = async (email) => {
        const password = prompt(`Enter new password for ${email}:`);
        if(password) {
            const res = await apiCall('change_password', { email, password });
            if(res.success) alert('Password updated successfully');
            else alert(res.error);
        }
    }

    async function renderAliases() {
        viewContent.innerHTML = '<div class="loader">Loading...</div>';
        const domainsRes = await apiCall('get_domains');
        const { data } = await apiCall('get_aliases');
        
        let domainsOpt = domainsRes.data.filter(d => d.domain !== 'ALL').map(d => `<option value="${d.domain}">${d.domain}</option>`).join('');

        let html = `
            <div class="form-card">
                <h3>Add Alias / Group / Catch-All</h3><br>
                <form id="add-alias-form">
                    <div class="form-row">
                        <div class="input-group">
                            <label>Alias Address</label>
                            <input type="text" id="alias-addr" placeholder="sales@domain.com or @domain.com (catch-all)" required>
                        </div>
                        <div class="input-group">
                            <label>Domain</label>
                            <select id="alias-domain">${domainsOpt}</select>
                        </div>
                    </div>
                    <div class="input-group">
                        <label>Target(s) (comma separated for groups)</label>
                        <input type="text" id="alias-goto" placeholder="user1@domain.com, user2@domain.com" required>
                    </div>
                    <div class="form-actions">
                        <button type="submit" class="btn btn-primary">Add Alias</button>
                    </div>
                </form>
            </div>
            <table>
                <thead><tr><th>Alias Address</th><th>Targets (Goto)</th><th>Actions</th></tr></thead>
                <tbody>
        `;
        data.forEach(a => {
            html += `<tr>
                <td>${escapeHTML(a.address)}</td>
                <td>${escapeHTML(a.goto)}</td>
                <td class="action-btns">
                    <button class="btn btn-outline" onclick="editAlias('${escapeHTML(a.address)}', '${escapeHTML(a.goto)}')">Edit</button>
                    <button class="btn btn-danger" onclick="deleteAlias('${escapeHTML(a.address)}', '${escapeHTML(a.goto)}')">Delete</button>
                </td>
            </tr>`;
        });
        html += '</tbody></table>';
        viewContent.innerHTML = html;

        document.getElementById('add-alias-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const address = document.getElementById('alias-addr').value;
            const domain = document.getElementById('alias-domain').value;
            const goto = document.getElementById('alias-goto').value;
            
            let finalAddress = address;
            let action = 'add_alias';
            
            if(address.startsWith('@')) {
                action = 'add_catchall';
                finalAddress = domain;
            } else if(!address.includes('@')) {
                finalAddress = address + '@' + domain;
            }
            
            const res = await apiCall(action, { address: finalAddress, domain, goto });
            if(res.success) renderAliases();
            else alert(res.error);
        });
    }

    window.editAlias = async (address, currentGoto) => {
        let targets = currentGoto.split(',').map(t => t.trim()).filter(t => t);
        
        let modal = document.createElement('div');
        modal.className = 'modal-backdrop';
        modal.innerHTML = `
            <div class="form-card glass" style="width: 600px; max-width: 90%; background:var(--bg-dark); margin: 10vh auto; max-height: 80vh; overflow-y:auto;">
                <h3 style="margin-top:0;">Edit Alias / Group</h3>
                <form id="edit-alias-form">
                    <div class="input-group" style="margin-top: 15px;">
                        <label>Alias Address</label>
                        <input type="text" id="edit-al-addr" value="${escapeHTML(address)}" required>
                    </div>
                    
                    <div style="margin-top: 20px; background: rgba(0,0,0,0.2); padding: 15px; border-radius: 8px;">
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
                            <label style="margin:0;">Current Targets</label>
                            <button type="button" class="btn btn-outline" style="padding: 2px 8px; font-size:0.8rem;" onclick="document.querySelectorAll('.target-cb').forEach(cb => cb.checked = true)">Select All</button>
                        </div>
                        <div id="target-list" style="max-height: 200px; overflow-y:auto;">
                            ${targets.map((t, i) => `
                                <div style="display:flex; align-items:center; margin-bottom: 5px;">
                                    <input type="checkbox" class="target-cb" id="tgt-${i}" value="${escapeHTML(t)}">
                                    <label for="tgt-${i}" style="margin-left:8px; margin-bottom:0; flex-grow:1; cursor:pointer;">${escapeHTML(t)}</label>
                                </div>
                            `).join('')}
                        </div>
                        <button type="button" class="btn btn-danger" style="margin-top:10px; font-size:0.8rem; padding:4px 10px;" id="btn-remove-selected">Remove Selected</button>
                    </div>

                    <div class="input-group" style="margin-top: 20px;">
                        <label>Add New Targets (one per line or comma separated)</label>
                        <textarea id="edit-al-new" rows="3" placeholder="user1@domain.com\nuser2@domain.com"></textarea>
                    </div>

                    <div class="form-actions" style="margin-top: 25px; display: flex; justify-content: space-between;">
                        <button type="button" class="btn btn-outline" onclick="this.closest('.modal-backdrop').remove()">Cancel</button>
                        <button type="submit" class="btn btn-primary">Save Changes</button>
                    </div>
                </form>
            </div>
        `;
        document.body.appendChild(modal);

        document.getElementById('btn-remove-selected').addEventListener('click', () => {
            document.querySelectorAll('.target-cb:checked').forEach(cb => cb.parentElement.remove());
        });

        document.getElementById('edit-alias-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const new_address = document.getElementById('edit-al-addr').value;
            
            // Collect remaining targets
            let finalTargets = [];
            document.querySelectorAll('.target-cb').forEach(cb => finalTargets.push(cb.value));
            
            // Add new targets
            let newLines = document.getElementById('edit-al-new').value.split(/[\n,]+/);
            newLines.forEach(line => {
                let trimmed = line.trim();
                if(trimmed) finalTargets.push(trimmed);
            });

            if (finalTargets.length === 0) {
                alert("You must have at least one target for an alias.");
                return;
            }

            const gotoString = finalTargets.join(',');

            const res = await apiCall('edit_alias', { old_address: address, new_address, goto: gotoString });
            if (res.success) {
                modal.remove();
                renderAliases();
            } else {
                alert(res.error);
            }
        });
    }

    window.deleteAlias = async (address, goto) => {
        if(confirm(`Delete alias ${address}?`)) {
            const res = await apiCall('delete_alias', { address, goto });
            if(res.success) renderAliases();
            else alert(res.error);
        }
    }

    async function renderRouting() {
        viewContent.innerHTML = '<div class="loader">Loading...</div>';
        const domainsRes = await apiCall('get_domains');
        const { data } = await apiCall('get_domain_aliases');
        
        let domainsOpt = domainsRes.data.filter(d => d.domain !== 'ALL').map(d => `<option value="${d.domain}">${d.domain}</option>`).join('');

        let html = `
            <div class="form-card">
                <h3>Domain Alias (Cross-Domain Routing)</h3>
                <p style="color:var(--text-secondary); margin-bottom: 20px; font-size: 0.9rem;">
                    Route all mail from an Alias Domain to a Target Domain. Allows users of target domain to receive and send-as the alias domain.
                </p>
                <form id="add-da-form" class="form-row">
                    <div class="input-group">
                        <label>Alias Domain</label>
                        <input type="text" id="da-alias" placeholder="housevo.org" required>
                    </div>
                    <div class="input-group">
                        <label>Target Domain (Existing)</label>
                        <select id="da-target">${domainsOpt}</select>
                    </div>
                    <div class="form-actions" style="margin-top: 28px;">
                        <button type="submit" class="btn btn-primary">Add Routing</button>
                    </div>
                </form>
            </div>
            <table>
                <thead><tr><th>Alias Domain</th><th>Target Domain</th><th>Actions</th></tr></thead>
                <tbody>
        `;
        data.forEach(d => {
            html += `<tr>
                <td>${escapeHTML(d.alias_domain)}</td>
                <td>${escapeHTML(d.target_domain)}</td>
                <td class="action-btns">
                    <button class="btn btn-danger" onclick="deleteDomainAlias('${escapeHTML(d.alias_domain)}')">Delete</button>
                </td>
            </tr>`;
        });
        html += '</tbody></table>';
        viewContent.innerHTML = html;

        document.getElementById('add-da-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const alias_domain = document.getElementById('da-alias').value;
            const target_domain = document.getElementById('da-target').value;
            const res = await apiCall('add_domain_alias', { alias_domain, target_domain });
            if(res.success) renderRouting();
            else alert(res.error);
        });
    }

    window.deleteDomainAlias = async (alias_domain) => {
        if(confirm(`Delete domain alias ${alias_domain}?`)) {
            const res = await apiCall('delete_domain_alias', { alias_domain });
            if(res.success) renderRouting();
            else alert(res.error);
        }
    }

    async function renderAdmins() {
        viewContent.innerHTML = '<div class="loader">Loading...</div>';
        const adminsRes = await apiCall('get_admins');
        const mailboxesRes = await apiCall('get_mailboxes');
        
        let mailboxesOpt = mailboxesRes.data.map(m => `<option value="${m.username}">${m.username}</option>`).join('');

        let html = `
            <div class="form-card">
                <h3>Promote Mailbox User to Admin</h3><br>
                <form id="add-admin-form" class="form-row">
                    <div class="input-group">
                        <label>Existing Mailbox</label>
                        <select id="admin-user">${mailboxesOpt}</select>
                    </div>
                    <div class="form-actions" style="margin-top: 28px;">
                        <button type="submit" class="btn btn-primary">Promote to Admin</button>
                    </div>
                </form>
            </div>
            <table>
                <thead><tr><th>Admin Username</th><th>Status</th><th>Actions</th></tr></thead>
                <tbody>
        `;
        adminsRes.data.forEach(a => {
            html += `<tr>
                <td>${escapeHTML(a.username)}</td>
                <td><span style="color:var(--success)">Active</span></td>
                <td class="action-btns">
                    <button class="btn btn-outline" onclick="changeAdminPassword('${escapeHTML(a.username)}')">Change Password</button>
                    <button class="btn btn-danger" onclick="deleteAdmin('${escapeHTML(a.username)}')">Demote / Delete</button>
                </td>
            </tr>`;
        });
        html += '</tbody></table>';
        viewContent.innerHTML = html;

        document.getElementById('add-admin-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const username = document.getElementById('admin-user').value;
            const res = await apiCall('add_admin', { username });
            if(res.success) renderAdmins();
            else alert(res.error);
        });
    }

    window.deleteAdmin = async (username) => {
        if(confirm(`Demote ${username} and remove admin access?`)) {
            const res = await apiCall('delete_admin', { username });
            if(res.success) {
                if(res.logged_out) location.reload();
                else renderAdmins();
            }
            else alert(res.error);
        }
    }

    window.changeAdminPassword = async (username) => {
        const password = prompt(`Enter new admin password for ${username}:`);
        if(password) {
            const res = await apiCall('change_admin_password', { username, password });
            if(res.success) alert('Admin password updated successfully');
            else alert(res.error);
        }
    }
});

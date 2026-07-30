const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const api = read('webmail-backend/src/api.ts');
const scheduler = read('webmail-backend/src/scheduler/router.ts');
const auth = read('webmail-backend/src/auth.ts');
const legacy = read('admin_portal_src/public/api.php');
const provisioning = read('admin_portal_src/public/api_v1.php');

const routeLines = (source, router) => source
  .split('\n')
  .map(line => line.trim())
  .filter(line => line.startsWith(`${router}.`) && line.includes("('/admin/"));

const apiRoutes = routeLines(api, 'apiRouter');
assert.equal(apiRoutes.length, 38, 'unexpected modern Admin endpoint count; update the RBAC audit');
for (const route of apiRoutes) {
  assert.match(route, /requireAuth, requireAdmin,/, `missing modern Admin RBAC: ${route}`);
}

const schedulerRoutes = routeLines(scheduler, 'schedulerRouter');
assert.equal(schedulerRoutes.length, 9, 'unexpected Scheduler Admin endpoint count; update the RBAC audit');
for (const route of schedulerRoutes) {
  assert.match(
    route,
    /authenticatedInstalled, requireSession, requireAdminSession,/,
    `missing Scheduler Admin RBAC: ${route}`,
  );
}

assert.match(auth, /SELECT superadmin FROM admin WHERE username = \? AND active = 1 LIMIT 1/);
assert.match(auth, /Forbidden: Superadmins only/);

const caseBlock = action => {
  const marker = `case '${action}':`;
  const start = legacy.indexOf(marker);
  assert.notEqual(start, -1, `missing legacy action ${action}`);
  const nextCase = legacy.indexOf("\n        case '", start + marker.length);
  const defaultCase = legacy.indexOf('\n        default:', start + marker.length);
  const end = [nextCase, defaultCase].filter(index => index >= 0).sort((a, b) => a - b)[0];
  return legacy.slice(start, end);
};

const superadminOnlyActions = [
  'get_system_health',
  'get_audit_logs',
  'get_rspamd_password',
  'get_domain_aliases',
  'add_domain_alias',
  'delete_domain_alias',
  'get_admins',
  'add_admin',
  'delete_admin',
  'change_admin_password',
  'get_api_keys',
  'create_api_key',
  'delete_api_key',
  'check_updates',
  'run_upgrade',
];
for (const action of superadminOnlyActions) {
  assert.match(caseBlock(action), /require_superadmin\(\$is_superadmin\)/, `legacy ${action} must be superadmin-only`);
}

const domainScopedActions = [
  'get_dns_records',
  'verify_domain',
  'delete_domain',
  'add_mailbox',
  'edit_mailbox',
  'delete_mailbox',
  'change_password',
  'add_alias',
  'edit_alias',
  'delete_alias',
  'add_catchall',
];
for (const action of domainScopedActions) {
  assert.match(caseBlock(action), /require_domain_access\(/, `legacy ${action} must check domain ownership`);
}

for (const action of ['view_quarantine', 'delete_quarantine', 'release_quarantine']) {
  assert.match(
    caseBlock(action),
    /authorized_quarantine_record\(/,
    `legacy ${action} must check recipient-domain ownership`,
  );
}

assert.match(legacy, /totp_enabled/);
assert.match(legacy, /modern OpenMailStack app/);
assert.match(legacy, /session_set_cookie_params\(\[/);
assert.match(legacy, /'httponly' => true/);
assert.match(legacy, /'secure' => true/);
assert.match(legacy, /'samesite' => 'Lax'/);

const authPosition = provisioning.indexOf('// 1. Authenticate Request');
const routingPosition = provisioning.indexOf('// 3. Routing');
assert.ok(authPosition >= 0 && routingPosition > authPosition, 'provisioning API must authenticate before routing');
assert.match(provisioning, /password_verify\(\$provided_key, \$key_row\['key_hash'\]\)/);

console.log(`[pass] Admin RBAC guard covers ${apiRoutes.length + schedulerRoutes.length} modern routes and legacy domain boundaries`);

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const legacyApi = read('admin_portal_src/public/api.php');
const legacyUi = read('admin_portal_src/public/js/app.js');
const adminInstaller = read('functions/09_admin_portal.sh');
const installer = read('install.sh');
const upgradeScript = read('upgrade.sh');
const webmailDeploy = read('functions/10_webmail.sh');
const guardedDeploy = read('functions/protocol_guarded_deploy.sh');
const protocolGuardLibrary = read('functions/lib_protocol_guard.sh');
const installationGuide = read('INSTALLATION.md');
const architecture = read('docs/engineering/ARCHITECTURE.md');
const adminRbacAudit = read('docs/engineering/ADMIN_RBAC_AUDIT.md');

const legacyCase = action => {
  const marker = `case '${action}':`;
  const start = legacyApi.indexOf(marker);
  assert.notEqual(start, -1, `missing legacy action ${action}`);
  const nextCase = legacyApi.indexOf("\n        case '", start + marker.length);
  const defaultCase = legacyApi.indexOf('\n        default:', start + marker.length);
  const end = [nextCase, defaultCase].filter(index => index >= 0).sort((a, b) => a - b)[0];
  return legacyApi.slice(start, end);
};

test('legacy upgrade action is a fail-closed manual-policy response', () => {
  const action = legacyCase('run_upgrade');

  assert.doesNotMatch(action, /shell_exec|exec\s*\(|system\s*\(|passthru|proc_open|popen|sudo/i);
  assert.match(action, /'success'\s*=>\s*false/);
  assert.match(action, /manual/i);
});

test('legacy update status uses the deployed VERSION and advertises manual policy only', () => {
  const action = legacyCase('check_updates');
  const updateActions = `${action}\n${legacyCase('run_upgrade')}`;

  assert.match(action, /is_readable\('\/var\/www\/openmailstack-admin\/VERSION'\)/);
  assert.match(action, /http_response_code\(503\)/);
  assert.match(action, /'update_policy'\s*=>\s*\[/);
  assert.match(action, /'mode'\s*=>\s*'manual'/);
  assert.doesNotMatch(action, /api\.github\.com|latest_version|has_update|'0\.1\.0'/);
  assert.doesNotMatch(
    updateActions,
    /shell_exec|(?<![_a-z])exec\s*\(|(?<![_a-z])system\s*\(|passthru|proc_open|popen|`|\bsudo\b/i,
  );
  assert.doesNotMatch(action, /'components'\s*=>/);

  assert.match(legacyUi, /manual update procedure/i);
  assert.doesNotMatch(legacyUi, /run_upgrade|Install Update Now|Latest Release|System is Up to Date/i);
  assert.doesNotMatch(legacyUi, /Component Versions/);
});

test('admin installer decommissions the legacy passwordless upgrade bridge', () => {
  assert.doesNotMatch(adminInstaller, /NOPASSWD:.*openmailstack-upgrade/);
  assert.doesNotMatch(adminInstaller, /cp .*upgrade\.sh.*openmailstack-upgrade\.sh/);
  assert.match(adminInstaller, /rm -f -- \/etc\/sudoers\.d\/openmailstack-upgrade/);
  assert.match(adminInstaller, /rm -f -- \/usr\/local\/bin\/openmailstack-upgrade\.sh/);
  assert.match(installer, /rm -f -- \/etc\/sudoers\.d\/openmailstack-upgrade/);
  assert.match(installer, /rm -f -- \/usr\/local\/bin\/openmailstack-upgrade\.sh/);

  const retirement = adminInstaller.indexOf('rm -f -- /etc/sudoers.d/openmailstack-upgrade');
  const configLoad = adminInstaller.indexOf('source ./config.conf');
  assert.ok(retirement >= 0 && retirement < configLoad, 'bridge retirement must precede fallible configuration loading');
  assert.match(
    adminInstaller,
    /install -o root -g "\$\{WEB_GROUP\}" -m 0640 "\$\{SCRIPT_DIR\}\/\.\.\/VERSION" \/var\/www\/openmailstack-admin\/VERSION/,
  );
  assert.doesNotMatch(adminInstaller, /cp "\$\{SCRIPT_DIR\}\/\.\.\/VERSION" \/var\/www\/openmailstack-admin\/VERSION/);
});

test('root upgrade entrypoint fails closed without changing repository or services', () => {
  assert.doesNotMatch(
    upgradeScript,
    /^\s*(?:git|rm|mv|cp|install|rsync|chmod|chown|systemctl|service|apt(?:-get)?|dnf|yum|sed|tee|dd|truncate|touch|mkdir|rmdir|ln|tar|curl|wget|find|python\d*|perl|php|node|bash|sh)\b|\$\(|`|(?:^|\s)(?:>>?|<<|<>)(?:\s|&|$)/m,
  );
  assert.match(upgradeScript, /set -euo pipefail/);
  assert.match(upgradeScript, /manual/i);
  assert.match(upgradeScript, /exit 1/);

  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'oms-disabled-upgrade-'));
  const scriptPath = path.join(fixture, 'upgrade.sh');
  const sentinelPath = path.join(fixture, 'sentinel.txt');
  fs.copyFileSync(path.join(root, 'upgrade.sh'), scriptPath);
  fs.chmodSync(scriptPath, 0o755);
  fs.writeFileSync(sentinelPath, 'must remain unchanged\n', 'utf8');
  const snapshot = () => fs.readdirSync(fixture).sort().map(name => {
    const entryPath = path.join(fixture, name);
    const stat = fs.statSync(entryPath);
    return { name, mode: stat.mode & 0o777, content: fs.readFileSync(entryPath, 'utf8') };
  });
  const before = snapshot();
  try {
    const result = spawnSync(scriptPath, ['release-that-must-not-run'], {
      cwd: fixture,
      encoding: 'utf8',
      env: { PATH: process.env.PATH || '/usr/bin:/bin', HOME: fixture },
    });
    assert.equal(result.status, 1);
    assert.match(`${result.stdout}${result.stderr}`, /No files, repository state, packages, or services were changed/);
    assert.deepEqual(snapshot(), before);
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

test('modern deployment packages the repository VERSION with the backend runtime', () => {
  assert.match(webmailDeploy, /require_path "\$\{REPO_DIR\}\/VERSION"/);
  assert.match(
    webmailDeploy,
    /install -m 0644 "\$\{REPO_DIR\}\/VERSION" "\$\{BACKEND_DIR\}\/VERSION"/,
  );
  const toolchain = webmailDeploy.slice(
    webmailDeploy.indexOf('install_node_toolchain()'),
    webmailDeploy.indexOf('npm_install_for_build()'),
  );
  assert.match(toolchain, /OMS_PROTOCOL_GUARDED_DEPLOY/);
  assert.match(toolchain, /Verifying Node\.js\/npm and deployment helpers/);
  assert.match(toolchain, /else\s+echo[^\n]+Installing Node\.js\/npm[\s\S]+openmailstack_install_required_packages/);
});

test('guarded webmail rollback validates the snapshot and remains reversible', () => {
  assert.match(guardedDeploy, /restore-webmail/);
  assert.match(guardedDeploy, /Rollback snapshot path must be absolute/);
  assert.match(guardedDeploy, /Rollback snapshot path must be canonical/);
  assert.match(guardedDeploy, /must be a direct child/);
  assert.match(guardedDeploy, /must be owned by root:root/);
  assert.match(guardedDeploy, /must have mode 0700/);
  assert.match(guardedDeploy, /frontend\/index\.html/);
  assert.match(guardedDeploy, /legacy-admin\/config\.php/);
  assert.match(guardedDeploy, /legacy-admin\/public\/api\.php/);
  assert.match(guardedDeploy, /protocol_safe_directory "\$\{FRONTEND_DIR\}" \/var\/www/);
  assert.match(guardedDeploy, /protocol_safe_root_directory "\$\{LEGACY_ADMIN_DIR\}" \/var\/www/);
  assert.match(protocolGuardLibrary, /must be canonical and contain no symlink or traversal components/);
  assert.match(protocolGuardLibrary, /must be a direct child of \$\{allowed_parent\}/);
  assert.match(protocolGuardLibrary, /protocol_read_release_version\(\)/);
  assert.match(protocolGuardLibrary, /protocol_version_file_matches\(\)/);
  assert.match(guardedDeploy, /RELEASE_VERSION=\$\(protocol_read_release_version "\$\{REPO_DIR\}\/VERSION"\)/);
  assert.match(guardedDeploy, /protocol_run_reversible_restore/);
  assert.match(guardedDeploy, /apply_requested_webmail/);
  assert.match(guardedDeploy, /deploy_legacy_admin \|\| exit 1/);
  assert.match(guardedDeploy, /rsync -a --delete "\$\{LEGACY_ADMIN_SOURCE\}\/" "\$\{LEGACY_ADMIN_DIR\}\/public\/"/);
  assert.match(guardedDeploy, /rsync -a --delete "\$\{snapshot_dir\}\/legacy-admin\/" "\$\{LEGACY_ADMIN_DIR\}\/"/);
  assert.match(guardedDeploy, /validate_legacy_admin_against_snapshot/);
  assert.match(guardedDeploy, /validate_deployed_legacy_admin/);
  assert.match(guardedDeploy, /protocol_version_file_matches "\$\{RELEASE_VERSION\}" "\$\{BACKEND_DIR\}\/VERSION"/);
  assert.match(guardedDeploy, /protocol_version_file_matches "\$\{RELEASE_VERSION\}" "\$\{LEGACY_ADMIN_DIR\}\/VERSION"/);
  assert.match(guardedDeploy, /validate_deployed_target/);
  assert.match(guardedDeploy, /validate_webmail_runtime \|\| return 1/);
  assert.match(guardedDeploy, /rsync -a --delete --exclude uploads[^\n]+\|\| return 1/);
  assert.match(guardedDeploy, /if restore_webmail; then\s+restore_status=0\s+else\s+restore_status=\$\?/);
  assert.match(guardedDeploy, /return "\$\{restore_status\}"/);
  assert.match(guardedDeploy, /validate_webmail_runtime/);
  assert.match(guardedDeploy, /https:\/\/\$\{MAIL_HOSTNAME\}\//);
  assert.match(guardedDeploy, /bash "\$\{POST_GATE_SCRIPT\}" "\$\{CONFIG_PATH\}"/);
  assert.match(guardedDeploy, /protocol_recover_after_interruption/);
  assert.match(guardedDeploy, /restore_snapshot\s+\\\s+validate_recovered_target/);
  assert.match(guardedDeploy, /protocol-release\.lock/);
  assert.match(guardedDeploy, /protocol_acquire_lock "\$\{PROTOCOL_LOCK_FD\}"/);
  assert.match(guardedDeploy, /trap 'on_signal HUP' HUP/);
  assert.match(guardedDeploy, /trap 'on_signal INT' INT/);
  assert.match(guardedDeploy, /trap 'on_signal TERM' TERM/);
  const completion = guardedDeploy.slice(
    guardedDeploy.indexOf('complete_success()'),
    guardedDeploy.indexOf('on_signal()'),
  );
  assert.match(completion, /trap '' HUP INT TERM\s+DEPLOY_COMPLETE=1\s+print_success/);
  const signalHandler = guardedDeploy.slice(
    guardedDeploy.indexOf('on_signal()'),
    guardedDeploy.indexOf("trap 'on_signal HUP' HUP"),
  );
  assert.match(signalHandler, /if \[\[ "\$\{DEPLOY_COMPLETE\}" == "1" \]\]; then\s+print_success\s+exit 0/);
  assert.doesNotMatch(guardedDeploy, /restore_snapshot \|\| true/);
  assert.match(guardedDeploy, /fail_with_status 20/);
  assert.match(guardedDeploy, /fail_with_status 30/);
  assert.match(guardedDeploy, /fail_with_status 31/);
  const lockAcquired = guardedDeploy.indexOf('protocol_acquire_lock "${PROTOCOL_LOCK_FD}"');
  const bridgeRetired = guardedDeploy.indexOf('retire_legacy_upgrade_bridge', lockAcquired);
  const snapshotNamed = guardedDeploy.indexOf('timestamp=$(date', bridgeRetired);
  assert.ok(lockAcquired >= 0 && lockAcquired < bridgeRetired && bridgeRetired < snapshotNamed);
});

test('operator documentation defines the bounded manual release and rollback procedure', () => {
  assert.doesNotMatch(installationGuide, /Perfect for upgrading/);
  assert.match(installationGuide, /Option 1 does not upgrade already-installed components/);
  assert.match(installationGuide, /## Manual release upgrade procedure/);
  assert.match(installationGuide, /set -euo pipefail/);
  assert.match(installationGuide, /functions\/protocol_guarded_deploy\.sh webmail/);
  assert.doesNotMatch(installationGuide, /protocol_guarded_deploy\.sh webmail \| tee/);
  assert.match(installationGuide, /as one transaction under one global lock/);
  assert.match(installationGuide, /captures both deployed applications/);
  assert.match(installationGuide, /HUP, INT, and TERM interruptions/);
  assert.match(installationGuide, /Exit `20` means both previous applications were restored and validated/);
  assert.match(installationGuide, /retired passwordless bridge remains absent/);
  assert.match(installationGuide, /functions\/protocol_guarded_deploy\.sh restore-webmail/);
  assert.match(installationGuide, /does not update Postfix, Dovecot, MariaDB, the mail store, or operating-system packages/);
  assert.doesNotMatch(installationGuide, /restore_legacy_admin|deploy_legacy_admin|manual-admin-/);
});

test('architecture and RBAC documentation describe the disabled automatic-update boundary', () => {
  const upgradeSection = architecture.slice(
    architecture.indexOf('### 8.2'),
    architecture.indexOf('### 8.3'),
  );
  assert.match(upgradeSection, /Status: `Partial`/);
  assert.match(upgradeSection, /manual release procedure/i);
  assert.match(upgradeSection, /passwordless bridge is removed/i);
  assert.doesNotMatch(upgradeSection, /allows `www-data`|may run `git pull`|openmailstack-upgrade\.sh/);
  assert.match(adminRbacAudit, /\| `check_updates` \| Installed VERSION reporting; no shell execution \|/);
  assert.match(adminRbacAudit, /\| `run_upgrade` \| Disabled fail-closed compatibility action \|/);
});

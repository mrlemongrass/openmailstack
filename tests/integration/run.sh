#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)

pass() {
    echo "[pass] $1"
}

fail() {
    echo "[fail] $1" >&2
    exit 1
}

assert_contains() {
    local file="$1"
    local pattern="$2"
    if ! grep -Fq -- "${pattern}" "${file}"; then
        fail "Expected pattern not found in ${file}: ${pattern}"
    fi
}

assert_not_contains() {
    local file="$1"
    local pattern="$2"
    if grep -Fq -- "${pattern}" "${file}"; then
        fail "Unexpected pattern found in ${file}: ${pattern}"
    fi
}

test_postfixadmin_nginx_routing() {
    local file="${PROJECT_ROOT}/functions/02_postfixadmin.sh"
    assert_contains "${file}" 'try_files \$uri \$uri/ /postfixadmin/index.php?\$query_string;'
    assert_contains "${file}" 'fastcgi_param SCRIPT_FILENAME /var/www/postfixadmin/public/\$1;'
    assert_not_contains "${file}" '/postfixadmin/public/index.php;'
    pass "PostfixAdmin Nginx routing guard"
}

test_config_defaults() {
    local file="${PROJECT_ROOT}/config.default"
    assert_contains "${file}" 'SSL_CERT_MODE="auto"'
    assert_contains "${file}" 'CLAMAV_ENABLED="1"'
    assert_contains "${file}" 'POSTFIXADMIN_ALLOW_LAB_DOMAINS="0"'
    assert_contains "${file}" 'OMS_WEBMAIL_HOST="127.0.0.1"'
    assert_contains "${file}" 'OMS_WEBMAIL_PORT="20000"'
    pass "Config defaults include SSL_CERT_MODE, CLAMAV_ENABLED, and modern webmail settings"
}

test_cert_host_validation_target() {
    local file="${PROJECT_ROOT}/setup_config.sh"
    assert_contains "${file}" 'MAIL_HOST_TO_VALIDATE="mail.${USER_DOMAIN}"'
    assert_contains "${file}" 'is_resolvable_domain "${MAIL_HOST_TO_VALIDATE}"'
    pass "Wizard validates certificate host (mail.<domain>)"
}

test_postfixadmin_dns_guard_defaults() {
    local file="${PROJECT_ROOT}/functions/02_postfixadmin.sh"
    assert_contains "${file}" 'POSTFIXADMIN_ALLOW_LAB_DOMAINS="${POSTFIXADMIN_ALLOW_LAB_DOMAINS:-0}"'
    assert_contains "${file}" "PFA_DOMAIN_IN_DNS=\"YES\""
    assert_contains "${file}" "PFA_EMAILCHECK_RESOLVE_DOMAIN=\"YES\""
    pass "PostfixAdmin DNS validation defaults to production-safe mode"
}

test_secret_handling_guards() {
    local pfa_file="${PROJECT_ROOT}/functions/02_postfixadmin.sh"
    local rspamd_file="${PROJECT_ROOT}/functions/05_rspamd_clamav.sh"
    local admin_installer="${PROJECT_ROOT}/functions/09_admin_portal.sh"

    assert_contains "${pfa_file}" "POSTFIXADMIN_SETUP_PASSWORD=\"\${POSTFIXADMIN_SETUP_PASSWORD}\" php <<'PHP'"
    assert_not_contains "${pfa_file}" "php -r \"echo password_hash('"
    assert_contains "${rspamd_file}" "printf '%s\\n' \"\${POSTFIXADMIN_SETUP_PASSWORD}\" | rspamadm pw -e"
    assert_not_contains "${rspamd_file}" "rspamadm pw -e -p"
    assert_not_contains "${admin_installer}" 'doveadm pw -s SHA512-CRYPT -p'
    pass "Secrets are not passed on command arguments in hashing paths"
}

test_rspamd_milter_timeout_guards() {
    local rspamd_file="${PROJECT_ROOT}/functions/05_rspamd_clamav.sh"
    local health_service="${PROJECT_ROOT}/packaging/systemd/openmailstack-rspamd-health.service"
    local health_timer="${PROJECT_ROOT}/packaging/systemd/openmailstack-rspamd-health.timer"
    local backend_api="${PROJECT_ROOT}/webmail-backend/src/api.ts"
    local health_dashboard="${PROJECT_ROOT}/webmail-frontend/src/admin/SystemHealthDashboard.tsx"
    local staging_smoke="${PROJECT_ROOT}/tests/integration/staging_smoke.sh"

    assert_contains "${rspamd_file}" 'postconf -e "milter_default_action = accept"'
    assert_contains "${rspamd_file}" 'openmailstack_install_required_packages rspamd rsync'
    assert_contains "${rspamd_file}" 'postconf -e "milter_connect_timeout = 5s"'
    assert_contains "${rspamd_file}" 'postconf -e "milter_command_timeout = 5s"'
    assert_contains "${rspamd_file}" "rspamd_config:register_symbol({"
    assert_not_contains "${rspamd_file}" "rspamd_config:add_on_load(function"
    assert_contains "${rspamd_file}" 'openmailstack-rspamd-health'
    assert_contains "${rspamd_file}" 'openmailstack-rspamd-recover'
    assert_contains "${rspamd_file}" 'rspamd_milter_probe.php'
    assert_contains "${rspamd_file}" 'openmailstack-rspamd-health.timer'
    assert_contains "${health_service}" 'ExecStart=/usr/local/sbin/openmailstack-rspamd-recover'
    assert_not_contains "${health_service}" 'Wants=network-online.target redis-server.service rspamd.service'
    assert_contains "${health_timer}" 'OnUnitActiveSec=1min'
    assert_contains "${backend_api}" 'checkRspamdHealth()'
    assert_contains "${health_dashboard}" '<Shield size={18} /> Mail Filtering'
    assert_contains "${staging_smoke}" 'openmailstack-rspamd-health --json'
    pass "Rspamd milter failures do not block SMTP greetings for default timeouts"
}

test_staging_starttls_output_guard() {
    local staging_smoke="${PROJECT_ROOT}/tests/integration/staging_smoke.sh"
    local dovecot_installer="${PROJECT_ROOT}/functions/04_dovecot.sh"

    assert_contains "${staging_smoke}" 'tls_output=$(openssl s_client -starttls smtp'
    assert_contains "${staging_smoke}" '-verify_hostname "${server_name}"'
    assert_contains "${staging_smoke}" '2>&1)'
    assert_contains "${staging_smoke}" 'grep -q "BEGIN CERTIFICATE" <<< "${tls_output}"'
    assert_contains "${staging_smoke}" 'grep -q "Verify return code: 0 (ok)" <<< "${tls_output}"'
    assert_contains "${staging_smoke}" 'check_tls_endpoint "127.0.0.1:993" "${MAIL_HOSTNAME}"'
    assert_not_contains "${staging_smoke}" 'openssl s_client -starttls smtp -connect "${endpoint}" -servername "${server_name}" < /dev/null 2>/dev/null'
    assert_contains "${dovecot_installer}" 'dovecot_tls_pair_is_usable'
    assert_contains "${dovecot_installer}" 'openssl x509 -in "${cert_file}" -noout -checkhost "${MAIL_HOSTNAME}"'
    assert_contains "${dovecot_installer}" 'ssl_server_cert_file = ${DOVECOT_TLS_CERT_FILE}'
    pass "Staging TLS verifies SMTP/IMAP hostnames and Dovecot preserves its certificate"
}

test_mysql_e_reduction_guards() {
    local rc_file="${PROJECT_ROOT}/functions/06_roundcube.sh"
    local dkim_file="${PROJECT_ROOT}/functions/dkim_sync.sh"

    assert_contains "${rc_file}" "mysql --batch --skip-column-names <<SQL"
    assert_not_contains "${rc_file}" "mysql -e \"SELECT 1 FROM"
    assert_contains "${dkim_file}" "mysql -N -B <<SQL"
    assert_not_contains "${dkim_file}" "mysql -N -B -e"
    pass "Roundcube and DKIM sync use stdin SQL queries"
}

test_modern_webmail_deployment_guards() {
    local install_file="${PROJECT_ROOT}/install.sh"
    local webmail_file="${PROJECT_ROOT}/functions/10_webmail.sh"
    local webmail_env_example="${PROJECT_ROOT}/packaging/webmail-backend.env.example"
    local service_file="${PROJECT_ROOT}/packaging/systemd/openmailstack.service"

    assert_contains "${install_file}" 'INSTALLED_COMPONENTS["modern_webmail"]'
    assert_contains "${install_file}" '"functions/10_webmail.sh"'
    assert_contains "${webmail_file}" 'source "${REPO_DIR}/config.conf"'
    assert_contains "${webmail_file}" 'Node.js >= 20.19.0'
    assert_contains "${webmail_file}" 'umask 022'
    assert_contains "${webmail_file}" 'umask 077'
    assert_contains "${webmail_file}" 'write_env_line "OMS_DB_PASSWORD"'
    assert_contains "${webmail_file}" 'write_env_line "OMS_SMTP_SERVER_NAME" "${OMS_SMTP_SERVER_NAME:-${MAIL_HOSTNAME}}"'
    assert_contains "${webmail_env_example}" 'OMS_SMTP_SERVER_NAME=mail.example.com'
    assert_contains "${webmail_file}" 'OUTBOUND_COMPACTION_MODE="${OUTBOUND_COMPACTION_MODE:-disabled}"'
    assert_contains "${webmail_file}" '"registry-verified-v1"'
    assert_contains "${webmail_file}" 'write_env_line "OMS_OUTBOUND_COMPACTION_MODE" "${OUTBOUND_COMPACTION_MODE}"'
    assert_contains "${webmail_env_example}" 'OMS_OUTBOUND_COMPACTION_MODE=disabled'
    assert_contains "${PROJECT_ROOT}/webmail-backend/src/index.ts" 'createActiveSyncSendMailHttpHandler({'
    assert_contains "${PROJECT_ROOT}/webmail-backend/src/index.ts" 'submit: input => submitOutbound(pool, input)'
    assert_contains "${PROJECT_ROOT}/webmail-backend/src/eas-send-http.ts" 'const submission = await dependencies.submit({'
    assert_contains "${PROJECT_ROOT}/webmail-backend/src/eas-send-http.ts" "origin: 'activesync'"
    assert_not_contains "${PROJECT_ROOT}/webmail-backend/src/index.ts" 'nodemailer.createTransport'
    assert_contains "${webmail_file}" 'location ^~ /api/'
    assert_contains "${webmail_file}" 'location ^~ /carddav'
    assert_contains "${webmail_file}" 'location = /Microsoft-Server-ActiveSync'
    assert_contains "${webmail_file}" '--exclude uploads'
    assert_contains "${webmail_file}" 'if (\$request_method ~ ^(PROPFIND|OPTIONS)$)'
    assert_contains "${webmail_file}" 'END { if (!inserted) exit 2 }'
    assert_contains "${webmail_file}" 'Generated Nginx config failed validation; restoring previous config'
    assert_contains "${webmail_file}" 'Older live deployments predate the managed marker'
    assert_contains "${webmail_file}" '# --- OMS Scheduler Route ---'
    assert_contains "${webmail_file}" 'nginx -t'
    assert_contains "${service_file}" 'EnvironmentFile=/etc/openmailstack/webmail-backend.env'
    pass "Modern webmail deployment guards"
}

test_authenticated_smoke_guards() {
    local mail_smoke="${PROJECT_ROOT}/tests/integration/mail_sync_smoke.sh"
    local calendar_smoke="${PROJECT_ROOT}/tests/integration/calendar_sync_smoke.sh"
    local carddav_smoke="${PROJECT_ROOT}/tests/integration/carddav_sync_smoke.sh"
    local eas_mail_smoke="${PROJECT_ROOT}/tests/integration/activesync_mail_smoke.sh"
    local eas_ping_smoke="${PROJECT_ROOT}/tests/integration/activesync_ping_smoke.sh"
    local eas_contacts_smoke="${PROJECT_ROOT}/tests/integration/activesync_contacts_smoke.sh"

    assert_contains "${mail_smoke}" 'SKIP: set OMS_SMOKE_USER and OMS_SMOKE_PASSWORD'
    assert_contains "${mail_smoke}" 'PASS: mail sync smoke completed'
    assert_contains "${calendar_smoke}" 'PASS: calendar sync smoke completed'
    assert_contains "${calendar_smoke}" 'curl --config "${curl_auth_config}"'
    assert_contains "${calendar_smoke}" '--connect-timeout "${CURL_CONNECT_TIMEOUT}"'
    assert_contains "${calendar_smoke}" 'WARN: cleanup failed:'
    assert_not_contains "${calendar_smoke}" '-u "${SMOKE_USER}:${SMOKE_PASSWORD}"'
    assert_contains "${carddav_smoke}" 'PASS: CardDAV sync smoke completed'
    assert_contains "${eas_mail_smoke}" 'SKIP: set OMS_SMOKE_USER and OMS_SMOKE_PASSWORD'
    assert_contains "${eas_mail_smoke}" 'PASS: ActiveSync mail smoke completed'
    assert_contains "${eas_ping_smoke}" 'SKIP: set OMS_SMOKE_USER and OMS_SMOKE_PASSWORD'
    assert_contains "${eas_ping_smoke}" 'PASS: ActiveSync Ping smoke completed'
    assert_contains "${eas_ping_smoke}" 'OMS_SMOKE_PING_LONG_MODE'
    assert_contains "${eas_ping_smoke}" 'ActiveSync Ping gate observed a backend or proxy restart'
    assert_contains "${eas_contacts_smoke}" 'PASS: ActiveSync contacts smoke completed'
    assert_contains "${eas_contacts_smoke}" 'curl --config "${curl_auth_config}"'
    assert_contains "${eas_contacts_smoke}" '--max-time "${CURL_MAX_TIME}"'
    assert_contains "${eas_contacts_smoke}" 'OMS_SMOKE_CONTACT_RUN_ID'
    assert_contains "${eas_contacts_smoke}" 'Birthday'
    assert_contains "${eas_contacts_smoke}" 'WARN: cleanup failed:'
    assert_not_contains "${eas_contacts_smoke}" '-u "${SMOKE_USER}:${SMOKE_PASSWORD}"'
    bash "${PROJECT_ROOT}/tests/integration/calendar_sync_smoke_test.sh"
    pass "Authenticated smoke scripts are credential-gated and present"
}

test_protocol_release_gate() {
    local gate="${PROJECT_ROOT}/tests/integration/protocol_release_gate.sh"
    local provisioner="${PROJECT_ROOT}/functions/provision_protocol_canary.sh"
    local guarded_deploy="${PROJECT_ROOT}/functions/protocol_guarded_deploy.sh"
    local webmail_deploy="${PROJECT_ROOT}/functions/10_webmail.sh"
    local dovecot_deploy="${PROJECT_ROOT}/functions/04_dovecot.sh"

    "${PROJECT_ROOT}/tests/integration/protocol_release_gate_test.sh"
    assert_contains "${gate}" 'OMS_SMOKE_IMAP_PORT="993"'
    assert_contains "${gate}" 'OMS_SMOKE_IMAP_REJECT_UNAUTHORIZED="true"'
    assert_contains "${gate}" 'activesync_contacts_smoke.sh'
    assert_contains "${gate}" 'activesync_ping_smoke.sh'
    assert_contains "${gate}" 'calendar_sync_smoke.sh'
    assert_contains "${gate}" 'eas_pim_sync_states'
    assert_contains "${gate}" 'oms_protocol_contact_targets'
    assert_contains "${gate}" 'mysql_hex_literal'
    assert_contains "${gate}" 'oms_protocol_birthday_targets'
    assert_contains "${gate}" 'birthday_tombstones'
    assert_contains "${gate}" 'sync_token = calendars.sync_token + 1'
    assert_contains "${gate}" 'OMS_PROTOCOL_GATE_RESIDUE'
    assert_contains "${gate}" 'Synthetic protocol canary cleanup left residue'
    assert_contains "${gate}" 'Authenticated public protocol smoke attempted to skip'
    assert_contains "${gate}" 'Authenticated public protocol smoke reported incomplete cleanup'
    assert_contains "${provisioner}" 'OMS_SMOKE_PASSWORD'
    assert_contains "${guarded_deploy}" 'restore_snapshot'
    assert_contains "${guarded_deploy}" 'Running post-deploy public IMAPS and ActiveSync suite gate'
    assert_contains "${guarded_deploy}" 'bash "${POST_GATE_SCRIPT}" "${CONFIG_PATH}" --profile suite'
    assert_contains "${guarded_deploy}" 'bash "${POST_GATE_SCRIPT}" "${CONFIG_PATH}" --profile suite --require-ping'
    assert_contains "${guarded_deploy}" 'bash "${GATE_SCRIPT}" "${CONFIG_PATH}" --profile auto'
    assert_contains "${webmail_deploy}" 'protocol_guarded_deploy.sh webmail'
    assert_contains "${dovecot_deploy}" 'protocol_guarded_deploy.sh dovecot'
    pass "Public IMAPS and ActiveSync release gate is fail-closed and deployment-enforced"
}

test_protocol_guard_helpers() {
    bash "${PROJECT_ROOT}/tests/integration/protocol_guard_helpers_test.sh"
}

test_outbound_release_bridge_preflight() {
    bash "${PROJECT_ROOT}/tests/integration/outbound_release_bridge_test.sh"
}

test_mail_message_view_regression() {
    (
        cd "${PROJECT_ROOT}/webmail-frontend"
        npm test
    )
    pass "Mail message detail refresh regression"
}

test_scheduler_documentation_guards() {
    node "${PROJECT_ROOT}/tests/integration/scheduler_docs_guard.cjs"
}

test_scheduler_phase1_guards() {
    node "${PROJECT_ROOT}/tests/integration/scheduler_phase1_guard.cjs"
}

test_scheduler_phase3_guards() {
    node "${PROJECT_ROOT}/tests/integration/scheduler_phase3_guard.cjs"
}

test_auth_hardening_guards() {
    node "${PROJECT_ROOT}/tests/integration/auth_hardening_guard.cjs"
}

test_admin_rbac_guards() {
    node "${PROJECT_ROOT}/tests/integration/admin_rbac_guard.cjs"
}

test_update_safety_guards() {
    node --test "${PROJECT_ROOT}/tests/integration/update_safety_guard.cjs"
}

test_dependency_security_guards() {
    node "${PROJECT_ROOT}/tests/integration/dependency_security_guard.cjs"
}

test_mozilla_autoconfig_guards() {
    node "${PROJECT_ROOT}/tests/integration/mozilla_autoconfig_guard.cjs"
}

test_backup_restore_guards() {
    bash "${PROJECT_ROOT}/tests/integration/backup_restore_test.sh"
}

test_dry_run_local() {
    if [[ "$(uname -s)" != "Linux" ]]; then
        echo "[skip] Local dry-run integration requires Linux."
        return 0
    fi

    local out_file
    out_file=$(mktemp)
    trap 'rm -f "${out_file}"' RETURN

    (
        cd "${PROJECT_ROOT}"
        if ! bash ./install.sh --dry-run > "${out_file}" 2>&1; then
            if grep -Fq "Unsupported OS version" "${out_file}"; then
                echo "[skip] Local host platform is not in OpenMailStack's supported matrix."
                return 0
            fi
            cat "${out_file}" >&2
            fail "install.sh --dry-run failed on local host."
        fi
    )

    assert_contains "${out_file}" 'Dry run completed. No changes were made.'
    pass "Local dry-run integration"
}

test_postfixadmin_nginx_routing
test_config_defaults
test_cert_host_validation_target
test_postfixadmin_dns_guard_defaults
test_secret_handling_guards
test_rspamd_milter_timeout_guards
test_staging_starttls_output_guard
"${PROJECT_ROOT}/tests/integration/rspamd_health_recovery_test.sh"
"${PROJECT_ROOT}/tests/integration/rspamd_map_sync_test.sh"
test_mysql_e_reduction_guards
test_modern_webmail_deployment_guards
test_authenticated_smoke_guards
test_protocol_release_gate
test_protocol_guard_helpers
test_outbound_release_bridge_preflight
test_mail_message_view_regression
test_scheduler_documentation_guards
test_scheduler_phase1_guards
test_scheduler_phase3_guards
test_auth_hardening_guards
test_admin_rbac_guards
test_update_safety_guards
test_dependency_security_guards
test_mozilla_autoconfig_guards
test_backup_restore_guards
test_dry_run_local

echo "[ok] Integration checks completed."

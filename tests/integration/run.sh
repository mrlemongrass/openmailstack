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
    pass "Config defaults include SSL_CERT_MODE and CLAMAV_ENABLED"
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

    assert_contains "${pfa_file}" "POSTFIXADMIN_SETUP_PASSWORD=\"\${POSTFIXADMIN_SETUP_PASSWORD}\" php <<'PHP'"
    assert_not_contains "${pfa_file}" "php -r \"echo password_hash('"
    assert_contains "${rspamd_file}" "printf '%s\\n' \"\${POSTFIXADMIN_SETUP_PASSWORD}\" | rspamadm pw -e"
    assert_not_contains "${rspamd_file}" "rspamadm pw -e -p"
    pass "Secrets are not passed on command arguments in hashing paths"
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
test_mysql_e_reduction_guards
test_dry_run_local

echo "[ok] Integration checks completed."

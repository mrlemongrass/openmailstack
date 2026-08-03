#!/usr/bin/env bash
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m'

pass() {
    echo -e "${GREEN}[pass]${NC} $1"
}

fail() {
    echo -e "${RED}[fail]${NC} $1" >&2
    exit 1
}

require_root() {
    if [[ ${EUID} -ne 0 ]]; then
        fail "Run staging smoke tests as root."
    fi
}

check_service_active() {
    local service="$1"
    if systemctl is-active --quiet "${service}"; then
        pass "Service active: ${service}"
    else
        fail "Service not active: ${service}"
    fi
}

check_listen_port() {
    local port="$1"
    if ss -ltn | awk '{print $4}' | grep -Eq "(^|:)${port}$"; then
        pass "Port listening: ${port}"
    else
        fail "Expected listening port not found: ${port}"
    fi
}

check_tls_endpoint() {
    local endpoint="$1"
    local server_name="$2"

    if [[ "${endpoint}" == *":587" ]]; then
        local tls_output
        local tls_status=0
        tls_output=$(openssl s_client -starttls smtp -connect "${endpoint}" -servername "${server_name}" -verify_hostname "${server_name}" < /dev/null 2>&1) || tls_status=$?
        if grep -q "BEGIN CERTIFICATE" <<< "${tls_output}" \
            && grep -q "Verify return code: 0 (ok)" <<< "${tls_output}"; then
            pass "TLS handshake OK (STARTTLS SMTP): ${endpoint}"
        else
            fail "TLS handshake failed (STARTTLS SMTP): ${endpoint} (openssl exit ${tls_status})"
        fi
    else
        if openssl s_client -connect "${endpoint}" -servername "${server_name}" -verify_hostname "${server_name}" < /dev/null 2>/dev/null | grep -q "Verify return code: 0 (ok)"; then
            pass "TLS handshake OK: ${endpoint}"
        else
            fail "TLS handshake failed: ${endpoint}"
        fi
    fi
}

CONFIG_PATH="${1:-./config.conf}"
if [[ ! -f "${CONFIG_PATH}" ]]; then
    fail "Config file not found: ${CONFIG_PATH}"
fi

# shellcheck source=/dev/null
source "${CONFIG_PATH}"

require_root

echo -e "${YELLOW}Running OpenMailStack staging smoke tests...${NC}"

echo "Checking core services..."
check_service_active nginx
check_service_active mariadb
check_service_active postfix
check_service_active dovecot
check_service_active rspamd
check_service_active openmailstack
check_service_active redis-server
check_service_active openmailstack-rspamd-health.timer
if [[ "${ENABLE_OMS_SCHEDULER:-false}" == "true" ]]; then
    check_service_active openmailstack-scheduler-worker
fi

if [[ "${CLAMAV_ENABLED:-1}" -eq 1 ]]; then
    check_service_active clamav-daemon
fi

echo "Checking key listeners..."
for port in 25 80 443 587 993; do
    check_listen_port "${port}"
done
check_listen_port "${OMS_WEBMAIL_PORT:-20000}"

if ss -ltn | awk '{print $4}' | grep -Eq '(^|:)995$'; then
    pass "Optional port listening: 995"
fi

echo "Checking configuration validity..."
nginx -t >/dev/null
pass "Nginx config test"
postfix check >/dev/null
pass "Postfix config test"
doveconf -n >/dev/null
pass "Dovecot config test"
rspamadm configtest >/dev/null
pass "Rspamd config test"

RSPAMD_HEALTH_JSON=$(/usr/local/sbin/openmailstack-rspamd-health --json)
if [[ "${RSPAMD_HEALTH_JSON}" != *'"ok":true'* ]]; then
    fail "Rspamd functional scan failed"
fi
pass "Rspamd functional scan"

echo "Checking TLS endpoints..."
check_tls_endpoint "127.0.0.1:443" "${MAIL_HOSTNAME}"
check_tls_endpoint "127.0.0.1:587" "${MAIL_HOSTNAME}"
check_tls_endpoint "127.0.0.1:993" "${MAIL_HOSTNAME}"

echo "Checking web endpoints..."
curl -kfsS --resolve "${MAIL_HOSTNAME}:443:127.0.0.1" "https://${MAIL_HOSTNAME}/" >/dev/null
pass "Modern webmail endpoint reachable"
curl -kfsS --resolve "${MAIL_HOSTNAME}:443:127.0.0.1" "https://${MAIL_HOSTNAME}/webmail/" >/dev/null
pass "Legacy Roundcube fallback reachable"
API_STATUS=$(curl -ksS -o /dev/null -w "%{http_code}" --resolve "${MAIL_HOSTNAME}:443:127.0.0.1" "https://${MAIL_HOSTNAME}/api/auth/me")
if [[ "${API_STATUS}" != "401" ]]; then
    fail "Expected unauthenticated API to return 401, got ${API_STATUS}"
else
    pass "Unauthenticated API rejects requests with 401"
fi
curl -kfsS --resolve "${MAIL_HOSTNAME}:443:127.0.0.1" "https://${MAIL_HOSTNAME}/postfixadmin/" >/dev/null
pass "PostfixAdmin endpoint reachable"
AUTOCONFIG_XML=$(curl -kfsS --resolve "${MAIL_HOSTNAME}:443:127.0.0.1" \
    "https://${MAIL_HOSTNAME}/.well-known/autoconfig/mail/config-v1.1.xml")
for expected in \
    '<port>993</port>' \
    '<socketType>SSL</socketType>' \
    '<port>587</port>' \
    '<socketType>STARTTLS</socketType>' \
    '<username>%EMAILADDRESS%</username>'; do
    if ! grep -Fq "${expected}" <<< "${AUTOCONFIG_XML}"; then
        fail "Mozilla autoconfiguration response is missing: ${expected}"
    fi
done
pass "Mozilla autoconfiguration advertises secure mail settings"

echo "Checking DKIM assets..."
if [[ ! -f /etc/rspamd/local.d/dkim_signing.conf ]]; then
    fail "Missing /etc/rspamd/local.d/dkim_signing.conf"
fi
if ! find /var/lib/rspamd/dkim -maxdepth 1 -type f -name '*.key' | grep -q .; then
    fail "No DKIM private keys found in /var/lib/rspamd/dkim"
fi
pass "DKIM signing config and keys present"

echo -e "${GREEN}Staging smoke tests completed successfully.${NC}"

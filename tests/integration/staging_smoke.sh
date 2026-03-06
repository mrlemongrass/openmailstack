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
        if openssl s_client -starttls smtp -connect "${endpoint}" -servername "${server_name}" < /dev/null 2>/dev/null | grep -q "BEGIN CERTIFICATE"; then
            pass "TLS handshake OK (STARTTLS SMTP): ${endpoint}"
        else
            fail "TLS handshake failed (STARTTLS SMTP): ${endpoint}"
        fi
    else
        if openssl s_client -connect "${endpoint}" -servername "${server_name}" < /dev/null 2>/dev/null | grep -q "BEGIN CERTIFICATE"; then
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
check_service_active redis-server

if [[ "${CLAMAV_ENABLED:-1}" -eq 1 ]]; then
    check_service_active clamav-daemon
fi

echo "Checking key listeners..."
for port in 25 80 443 587 993; do
    check_listen_port "${port}"
done

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

echo "Checking TLS endpoints..."
check_tls_endpoint "127.0.0.1:443" "${MAIL_HOSTNAME}"
check_tls_endpoint "127.0.0.1:587" "${MAIL_HOSTNAME}"

echo "Checking web endpoints..."
curl -kfsS --resolve "${MAIL_HOSTNAME}:443:127.0.0.1" "https://${MAIL_HOSTNAME}/webmail/" >/dev/null
pass "Webmail endpoint reachable"
curl -kfsS --resolve "${MAIL_HOSTNAME}:443:127.0.0.1" "https://${MAIL_HOSTNAME}/postfixadmin/" >/dev/null
pass "PostfixAdmin endpoint reachable"

echo "Checking DKIM assets..."
if [[ ! -f /etc/rspamd/local.d/dkim_signing.conf ]]; then
    fail "Missing /etc/rspamd/local.d/dkim_signing.conf"
fi
if ! find /var/lib/rspamd/dkim -maxdepth 1 -type f -name '*.key' | grep -q .; then
    fail "No DKIM private keys found in /var/lib/rspamd/dkim"
fi
pass "DKIM signing config and keys present"

echo -e "${GREEN}Staging smoke tests completed successfully.${NC}"

#!/usr/bin/env bash

# ==============================================================================
# Strict Bash Mode
# ==============================================================================
set -euo pipefail

TMP_DKIM_CONF=""
cleanup() {
    if [[ -n "${TMP_DKIM_CONF}" && -f "${TMP_DKIM_CONF}" ]]; then
        rm -f "${TMP_DKIM_CONF}"
    fi
}
trap cleanup EXIT
trap 'echo -e "\033[0;31mERROR in ${BASH_SOURCE[0]} at line ${LINENO}: ${BASH_COMMAND}\033[0m" >&2' ERR

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
NC='\033[0m'

DKIM_SYNC_CONFIG="${DKIM_SYNC_CONFIG:-/etc/openmailstack/dkim-sync.conf}"
if [[ -f "${DKIM_SYNC_CONFIG}" ]]; then
    # shellcheck source=/dev/null
    source "${DKIM_SYNC_CONFIG}"
fi

: "${POSTFIXADMIN_DB_NAME:?POSTFIXADMIN_DB_NAME is required for DKIM sync}"
: "${FIRST_DOMAIN:?FIRST_DOMAIN is required for DKIM sync}"

escape_mysql_identifier() {
    printf "%s" "$1" | sed 's/`/``/g'
}

DKIM_SELECTOR="${DKIM_SELECTOR:-mail}"
DKIM_DIR="${DKIM_DIR:-/var/lib/rspamd/dkim}"
DKIM_SIGNING_CONF="/etc/rspamd/local.d/dkim_signing.conf"

if ! command -v mysql >/dev/null 2>&1; then
    echo -e "${RED}Error: mysql client is required but not installed.${NC}"
    exit 1
fi

if ! command -v rspamadm >/dev/null 2>&1; then
    echo -e "${RED}Error: rspamadm is required but not installed.${NC}"
    exit 1
fi

echo -e "${YELLOW}Syncing DKIM keys and signing map...${NC}"
mkdir -p "${DKIM_DIR}"

FIRST_DOMAIN_LOWER="${FIRST_DOMAIN,,}"
POSTFIXADMIN_DB_NAME_SQL="$(escape_mysql_identifier "${POSTFIXADMIN_DB_NAME}")"
mapfile -t DKIM_DOMAINS < <(
    {
        mysql -N -B <<SQL 2>/dev/null || true
SELECT domain FROM \`${POSTFIXADMIN_DB_NAME_SQL}\`.domain WHERE active = '1';
SQL
        echo "${FIRST_DOMAIN}"
    } | awk 'NF' | tr '[:upper:]' '[:lower:]' | sort -u
)

if [[ ${#DKIM_DOMAINS[@]} -eq 0 ]]; then
    echo -e "${RED}Error: Could not determine any domains for DKIM sync.${NC}"
    exit 1
fi

TMP_DKIM_CONF=$(mktemp)
CHANGED=0
HAS_VALID_DOMAIN=0

cat <<EOF > "${TMP_DKIM_CONF}"
allow_username_mismatch = true;

domain {
EOF

for DOMAIN in "${DKIM_DOMAINS[@]}"; do
    if [[ ! "${DOMAIN}" =~ ^[a-z0-9.-]+$ ]]; then
        echo -e "${YELLOW}Skipping invalid domain value from database: ${DOMAIN}${NC}"
        continue
    fi

    KEY_PATH="${DKIM_DIR}/${DOMAIN}.key"
    PUB_PATH="${DKIM_DIR}/${DOMAIN}.pub"

    # Preserve DNS continuity for installs that used legacy mail.key naming.
    if [[ "${DOMAIN}" == "${FIRST_DOMAIN_LOWER}" && -f "${DKIM_DIR}/mail.key" && ! -f "${KEY_PATH}" ]]; then
        echo -e "Migrating legacy DKIM key to ${DOMAIN}.key..."
        cp -p "${DKIM_DIR}/mail.key" "${KEY_PATH}"
        if [[ -f "${DKIM_DIR}/mail.pub" ]]; then
            cp -p "${DKIM_DIR}/mail.pub" "${PUB_PATH}"
        fi
        CHANGED=1
    fi

    if [[ ! -f "${KEY_PATH}" ]]; then
        echo -e "Generating DKIM key for ${DOMAIN}..."
        rspamadm dkim_keygen -d "${DOMAIN}" -s "${DKIM_SELECTOR}" -k "${KEY_PATH}" > "${PUB_PATH}"
        CHANGED=1
    fi

    cat <<EOF >> "${TMP_DKIM_CONF}"
    ${DOMAIN} {
        path = "${KEY_PATH}";
        selector = "${DKIM_SELECTOR}";
    }
EOF
    HAS_VALID_DOMAIN=1
done

echo "}" >> "${TMP_DKIM_CONF}"

if [[ ${HAS_VALID_DOMAIN} -eq 0 ]]; then
    echo -e "${RED}Error: No valid domains available for DKIM sync.${NC}"
    exit 1
fi

if [[ ! -f "${DKIM_SIGNING_CONF}" ]] || ! cmp -s "${TMP_DKIM_CONF}" "${DKIM_SIGNING_CONF}"; then
    install -m 644 "${TMP_DKIM_CONF}" "${DKIM_SIGNING_CONF}"
    CHANGED=1
fi

if id "_rspamd" &>/dev/null; then
    chown -R _rspamd:_rspamd "${DKIM_DIR}"
fi
find "${DKIM_DIR}" -maxdepth 1 -type f -name '*.key' -exec chmod 400 {} +
find "${DKIM_DIR}" -maxdepth 1 -type f -name '*.pub' -exec chmod 644 {} +

if [[ "${CHANGED}" -eq 1 ]]; then
    echo -e "DKIM material changed. Reloading Rspamd..."
    if command -v systemctl >/dev/null 2>&1; then
        systemctl reload rspamd 2>/dev/null || systemctl restart rspamd
    fi
else
    echo -e "${GREEN}No DKIM changes detected.${NC}"
fi

echo -e "${GREEN}DKIM sync complete.${NC}"

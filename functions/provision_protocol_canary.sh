#!/usr/bin/env bash
set -euo pipefail
trap 'echo "Protocol canary provisioning failed at line ${LINENO}." >&2' ERR

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_DIR=$(cd "${SCRIPT_DIR}/.." && pwd)
CONFIG_PATH="${1:-${REPO_DIR}/config.conf}"
CREDENTIAL_FILE="${OMS_PROTOCOL_GATE_CREDENTIAL_FILE:-/etc/openmailstack/protocol-smoke.env}"
REQUIRED_FILE="${OMS_PROTOCOL_GATE_REQUIRED_FILE:-/etc/openmailstack/protocol-gate.required}"

fail() {
    echo "Error: $1" >&2
    exit 1
}

[[ ${EUID} -eq 0 ]] || fail "Run protocol canary provisioning as root"
[[ -f "${CONFIG_PATH}" ]] || fail "OpenMailStack config file not found: ${CONFIG_PATH}"

# shellcheck source=/dev/null
source "${CONFIG_PATH}"

CANARY_USER="${OMS_PROTOCOL_CANARY_USER:-oms-canary@${FIRST_DOMAIN}}"
CANARY_LOCAL_PART="${CANARY_USER%@*}"
CANARY_DOMAIN="${CANARY_USER#*@}"

[[ "${CANARY_USER}" == *@* ]] || fail "OMS_PROTOCOL_CANARY_USER must be a complete email address"
[[ "${CANARY_LOCAL_PART}" =~ ^[A-Za-z0-9._+-]+$ ]] || fail "Protocol canary local part contains unsupported characters"
[[ "${CANARY_DOMAIN}" =~ ^[A-Za-z0-9.-]+$ ]] || fail "Protocol canary domain contains unsupported characters"
[[ -n "${POSTFIXADMIN_DB_USER:-}" && -n "${POSTFIXADMIN_DB_PASSWORD:-}" && -n "${POSTFIXADMIN_DB_NAME:-}" ]] \
    || fail "PostfixAdmin database settings are incomplete"

mailbox_count=$(MYSQL_PWD="${POSTFIXADMIN_DB_PASSWORD}" mysql \
    --protocol=TCP \
    --host=127.0.0.1 \
    --user="${POSTFIXADMIN_DB_USER}" \
    --batch \
    --skip-column-names \
    "${POSTFIXADMIN_DB_NAME}" \
    -e "SELECT COUNT(*) FROM mailbox WHERE username='${CANARY_USER}'")

if [[ "${mailbox_count}" == "1" ]]; then
    [[ -f "${CREDENTIAL_FILE}" ]] || fail "Canary mailbox exists but ${CREDENTIAL_FILE} is missing; rotate it explicitly instead of resetting the mailbox silently"
    install -o root -g root -m 0600 /dev/null "${REQUIRED_FILE}"
    echo "Protocol canary already provisioned: ${CANARY_USER}"
    exit 0
fi
[[ "${mailbox_count}" == "0" ]] || fail "Unexpected duplicate protocol canary mailbox rows"
[[ ! -e "${CREDENTIAL_FILE}" ]] || fail "Credential file exists but the canary mailbox does not; remove the orphaned file before retrying"

domain_count=$(MYSQL_PWD="${POSTFIXADMIN_DB_PASSWORD}" mysql \
    --protocol=TCP \
    --host=127.0.0.1 \
    --user="${POSTFIXADMIN_DB_USER}" \
    --batch \
    --skip-column-names \
    "${POSTFIXADMIN_DB_NAME}" \
    -e "SELECT COUNT(*) FROM domain WHERE domain='${CANARY_DOMAIN}' AND active=1")
[[ "${domain_count}" == "1" ]] || fail "Protocol canary domain is missing or inactive: ${CANARY_DOMAIN}"

install -d -o root -g root -m 0700 "$(dirname "${CREDENTIAL_FILE}")"
credential_tmp=$(mktemp "$(dirname "${CREDENTIAL_FILE}")/.protocol-smoke.env.XXXXXX")
CANARY_PASSWORD=$(openssl rand -base64 36 | tr -d '\n')
CANARY_HASH=$(printf '%s' "${CANARY_PASSWORD}" | php -r '$password = stream_get_contents(STDIN); echo password_hash($password, PASSWORD_BCRYPT, ["cost" => 12]);')
MAILBOX_CREATED=0
PROVISION_COMPLETE=0

cleanup_tmp() {
    rm -f "${credential_tmp}"
    if [[ "${MAILBOX_CREATED}" == "1" && "${PROVISION_COMPLETE}" != "1" ]]; then
        MYSQL_PWD="${POSTFIXADMIN_DB_PASSWORD}" mysql \
            --protocol=TCP \
            --host=127.0.0.1 \
            --user="${POSTFIXADMIN_DB_USER}" \
            "${POSTFIXADMIN_DB_NAME}" <<SQL >/dev/null 2>&1 || true
START TRANSACTION;
DELETE FROM alias WHERE address='${CANARY_USER}' AND goto='${CANARY_USER}';
DELETE FROM mailbox WHERE username='${CANARY_USER}';
COMMIT;
SQL
        rm -f "${CREDENTIAL_FILE}" "${REQUIRED_FILE}"
    fi
}
trap cleanup_tmp EXIT

(
    umask 077
    {
        printf '# Root-only credential for the OpenMailStack protocol release gate.\n'
        printf "OMS_SMOKE_USER='%s'\n" "${CANARY_USER}"
        printf "OMS_SMOKE_PASSWORD='%s'\n" "${CANARY_PASSWORD}"
    } > "${credential_tmp}"
)

MYSQL_PWD="${POSTFIXADMIN_DB_PASSWORD}" mysql \
    --protocol=TCP \
    --host=127.0.0.1 \
    --user="${POSTFIXADMIN_DB_USER}" \
    "${POSTFIXADMIN_DB_NAME}" <<SQL
START TRANSACTION;
INSERT INTO mailbox
    (username, password, name, maildir, quota, local_part, domain, active, phone, email_other, created, modified)
VALUES
    ('${CANARY_USER}', '${CANARY_HASH}', 'OMS Protocol Canary', '${CANARY_DOMAIN}/${CANARY_LOCAL_PART}/', 0, '${CANARY_LOCAL_PART}', '${CANARY_DOMAIN}', 1, '', '', NOW(), NOW());
INSERT INTO alias
    (address, goto, domain, active, created, modified)
VALUES
    ('${CANARY_USER}', '${CANARY_USER}', '${CANARY_DOMAIN}', 1, NOW(), NOW());
COMMIT;
SQL
MAILBOX_CREATED=1

install -o root -g root -m 0600 "${credential_tmp}" "${CREDENTIAL_FILE}"
install -o root -g root -m 0600 /dev/null "${REQUIRED_FILE}"
PROVISION_COMPLETE=1

echo "Provisioned protocol canary mailbox: ${CANARY_USER}"
echo "Credential file: ${CREDENTIAL_FILE} (root:root 0600)"
echo "Future guarded deployments will fail closed if the public protocol gate cannot run."

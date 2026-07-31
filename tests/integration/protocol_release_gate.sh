#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
CONFIG_PATH="${1:-${PROJECT_ROOT}/config.conf}"
CREDENTIAL_FILE="${OMS_PROTOCOL_GATE_CREDENTIAL_FILE:-/etc/openmailstack/protocol-smoke.env}"
MYSQL_BIN="${OMS_PROTOCOL_GATE_MYSQL_BIN:-mysql}"

fail() {
    echo "FAIL: $1" >&2
    exit 1
}

[[ -f "${CONFIG_PATH}" ]] || fail "OpenMailStack config file not found: ${CONFIG_PATH}"
[[ -f "${CREDENTIAL_FILE}" ]] || fail "Protocol canary credential file not found: ${CREDENTIAL_FILE}"
[[ ! -L "${CREDENTIAL_FILE}" ]] || fail "Protocol canary credential file must not be a symbolic link"

credential_owner=$(stat -c '%u' "${CREDENTIAL_FILE}")
credential_mode=$(stat -c '%a' "${CREDENTIAL_FILE}")
if [[ "${credential_owner}" != "0" ]] || (( (8#${credential_mode} & 077) != 0 )); then
    fail "Protocol canary credential file must be root-owned and inaccessible to group or others"
fi

# shellcheck source=/dev/null
source "${CONFIG_PATH}"
# shellcheck source=/dev/null
source "${CREDENTIAL_FILE}"

[[ -n "${MAIL_HOSTNAME:-}" ]] || fail "MAIL_HOSTNAME is required in ${CONFIG_PATH}"
[[ "${MAIL_HOSTNAME}" =~ ^[A-Za-z0-9.-]+$ ]] || fail "MAIL_HOSTNAME contains unsupported characters"
[[ -n "${OMS_SMOKE_USER:-}" ]] || fail "OMS_SMOKE_USER is required in ${CREDENTIAL_FILE}"
[[ -n "${OMS_SMOKE_PASSWORD:-}" ]] || fail "OMS_SMOKE_PASSWORD is required in ${CREDENTIAL_FILE}"
[[ "${OMS_SMOKE_USER}" =~ ^[A-Za-z0-9._+%-]+@[A-Za-z0-9.-]+$ ]] || fail "OMS_SMOKE_USER contains unsupported characters"
[[ -n "${POSTFIXADMIN_DB_USER:-}" && -n "${POSTFIXADMIN_DB_PASSWORD:-}" && -n "${POSTFIXADMIN_DB_NAME:-}" ]] \
    || fail "PostfixAdmin database settings are required for synthetic ActiveSync state cleanup"
if [[ "${MYSQL_BIN}" == */* ]]; then
    [[ -x "${MYSQL_BIN}" ]] || fail "MySQL client is not executable: ${MYSQL_BIN}"
else
    MYSQL_BIN=$(command -v "${MYSQL_BIN}") || fail "MySQL client is not available: ${MYSQL_BIN}"
fi

SMOKE_SCRIPT="${OMS_PROTOCOL_GATE_SMOKE_SCRIPT:-${PROJECT_ROOT}/tests/integration/activesync_mail_smoke.sh}"
[[ -f "${SMOKE_SCRIPT}" ]] || fail "ActiveSync mail smoke script not found: ${SMOKE_SCRIPT}"

export OMS_SMOKE_BASE_URL="https://${MAIL_HOSTNAME}"
export OMS_SMOKE_USER
export OMS_SMOKE_PASSWORD
export OMS_SMOKE_IMAP_HOST="${MAIL_HOSTNAME}"
export OMS_SMOKE_IMAP_PORT="993"
export OMS_SMOKE_IMAP_SECURE="true"
export OMS_SMOKE_IMAP_SERVER_NAME="${MAIL_HOSTNAME}"
export OMS_SMOKE_IMAP_REJECT_UNAUTHORIZED="true"
export OMS_SMOKE_SMTP_HOST="${MAIL_HOSTNAME}"
export OMS_SMOKE_SMTP_PORT="587"
export OMS_SMOKE_SMTP_SERVER_NAME="${MAIL_HOSTNAME}"
export OMS_SMOKE_SMTP_REJECT_UNAUTHORIZED="true"
OMS_SMOKE_DEVICE_ID="OMSPG$(openssl rand -hex 12)"
export OMS_SMOKE_DEVICE_ID

state_cleaned=0
cleanup_device_state() {
    local cleanup_output
    local cleanup_status=0
    if [[ "${state_cleaned}" == "1" ]]; then
        return 0
    fi
    cleanup_output=$(MYSQL_PWD="${POSTFIXADMIN_DB_PASSWORD}" "${MYSQL_BIN}" \
        --protocol=TCP \
        --host=127.0.0.1 \
        --user="${POSTFIXADMIN_DB_USER}" \
        "${POSTFIXADMIN_DB_NAME}" 2>&1 <<SQL
DELETE FROM eas_mail_sync_states
WHERE username='${OMS_SMOKE_USER}' AND device_id='${OMS_SMOKE_DEVICE_ID}';
SQL
    ) || cleanup_status=$?
    if (( cleanup_status != 0 )); then
        echo "Synthetic ActiveSync state cleanup failed: ${cleanup_output}" >&2
        return "${cleanup_status}"
    fi
    state_cleaned=1
}
trap 'cleanup_device_state || true' EXIT

set +e
smoke_output=$(bash "${SMOKE_SCRIPT}" 2>&1)
smoke_status=$?
set -e

printf '%s\n' "${smoke_output}"
if ! cleanup_device_state; then
    fail "Could not remove the synthetic ActiveSync partnership"
fi
if (( smoke_status != 0 )); then
    fail "Authenticated public protocol smoke failed with exit ${smoke_status}"
fi
if grep -Eq '^SKIP:' <<< "${smoke_output}"; then
    fail "Authenticated public protocol smoke attempted to skip"
fi
if grep -Eq '^WARN: (cleanup|session cleanup) failed:' <<< "${smoke_output}"; then
    fail "Authenticated public protocol smoke reported incomplete cleanup"
fi
if ! grep -Fq 'PASS:' <<< "${smoke_output}"; then
    fail "Authenticated public protocol smoke returned no PASS marker"
fi

echo "PASS: protocol release gate completed (public IMAPS and ActiveSync)"

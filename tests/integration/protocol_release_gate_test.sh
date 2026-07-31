#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
GATE_SCRIPT="${PROJECT_ROOT}/tests/integration/protocol_release_gate.sh"

TEST_ROOT=$(mktemp -d)
trap 'rm -rf "${TEST_ROOT}"' EXIT

CONFIG_PATH="${TEST_ROOT}/config.conf"
OUTPUT_PATH="${TEST_ROOT}/output.log"
CLEANUP_LOG="${TEST_ROOT}/cleanup.sql"
MYSQL_PATH="${TEST_ROOT}/mysql"

cat > "${CONFIG_PATH}" <<'EOF'
MAIL_HOSTNAME="mail.example.test"
POSTFIXADMIN_DB_USER="test-user"
POSTFIXADMIN_DB_PASSWORD="test-password"
POSTFIXADMIN_DB_NAME="test-db"
EOF

cat > "${MYSQL_PATH}" <<'EOF'
#!/usr/bin/env bash
cat > "${OMS_PROTOCOL_GATE_CLEANUP_LOG}"
EOF
chmod 0755 "${MYSQL_PATH}"
export OMS_PROTOCOL_GATE_CLEANUP_LOG="${CLEANUP_LOG}"

if OMS_PROTOCOL_GATE_CREDENTIAL_FILE="${TEST_ROOT}/missing.env" \
    bash "${GATE_SCRIPT}" "${CONFIG_PATH}" >"${OUTPUT_PATH}" 2>&1; then
    echo "FAIL: protocol release gate accepted missing credentials" >&2
    exit 1
fi

if ! grep -Fq 'Protocol canary credential file not found' "${OUTPUT_PATH}"; then
    echo "FAIL: protocol release gate did not explain the missing credential failure" >&2
    exit 1
fi

echo "PASS: protocol release gate fails closed when credentials are missing"

if [[ ${EUID} -ne 0 ]]; then
    echo "SKIP: secure credential ownership checks require root"
    exit 0
fi

CREDENTIAL_PATH="${TEST_ROOT}/protocol-smoke.env"
SMOKE_PATH="${TEST_ROOT}/smoke.sh"

cat > "${CREDENTIAL_PATH}" <<'EOF'
OMS_SMOKE_USER='oms-canary@example.test'
OMS_SMOKE_PASSWORD='test-only-password'
EOF
chmod 0600 "${CREDENTIAL_PATH}"

cat > "${SMOKE_PATH}" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf 'BASE=%s\n' "${OMS_SMOKE_BASE_URL}"
printf 'IMAP=%s:%s secure=%s server=%s verify=%s\n' \
    "${OMS_SMOKE_IMAP_HOST}" \
    "${OMS_SMOKE_IMAP_PORT}" \
    "${OMS_SMOKE_IMAP_SECURE}" \
    "${OMS_SMOKE_IMAP_SERVER_NAME}" \
    "${OMS_SMOKE_IMAP_REJECT_UNAUTHORIZED}"
printf 'SMTP=%s:%s server=%s verify=%s\n' \
    "${OMS_SMOKE_SMTP_HOST}" \
    "${OMS_SMOKE_SMTP_PORT}" \
    "${OMS_SMOKE_SMTP_SERVER_NAME}" \
    "${OMS_SMOKE_SMTP_REJECT_UNAUTHORIZED}"
printf 'DEVICE=%s\n' "${OMS_SMOKE_DEVICE_ID}"
[[ -n "${OMS_SMOKE_USER}" && -n "${OMS_SMOKE_PASSWORD}" ]]
echo 'PASS: fake dual-protocol smoke completed'
EOF
chmod 0755 "${SMOKE_PATH}"

OMS_PROTOCOL_GATE_CREDENTIAL_FILE="${CREDENTIAL_PATH}" \
OMS_PROTOCOL_GATE_SMOKE_SCRIPT="${SMOKE_PATH}" \
OMS_PROTOCOL_GATE_MYSQL_BIN="${MYSQL_PATH}" \
    bash "${GATE_SCRIPT}" "${CONFIG_PATH}" >"${OUTPUT_PATH}" 2>&1

grep -Fq 'BASE=https://mail.example.test' "${OUTPUT_PATH}"
grep -Fq 'IMAP=mail.example.test:993 secure=true server=mail.example.test verify=true' "${OUTPUT_PATH}"
grep -Fq 'SMTP=mail.example.test:587 server=mail.example.test verify=true' "${OUTPUT_PATH}"
grep -Eq '^DEVICE=OMSPG[0-9a-f]{24}$' "${OUTPUT_PATH}"
grep -Fq 'PASS: protocol release gate completed' "${OUTPUT_PATH}"
grep -Fq 'DELETE FROM eas_mail_sync_states' "${CLEANUP_LOG}"

echo "PASS: protocol release gate configures the public authenticated client seams"

chmod 0644 "${CREDENTIAL_PATH}"
if OMS_PROTOCOL_GATE_CREDENTIAL_FILE="${CREDENTIAL_PATH}" \
    OMS_PROTOCOL_GATE_SMOKE_SCRIPT="${SMOKE_PATH}" \
    OMS_PROTOCOL_GATE_MYSQL_BIN="${MYSQL_PATH}" \
    bash "${GATE_SCRIPT}" "${CONFIG_PATH}" >"${OUTPUT_PATH}" 2>&1; then
    echo "FAIL: protocol release gate accepted exposed credentials" >&2
    exit 1
fi
grep -Fq 'must be root-owned and inaccessible to group or others' "${OUTPUT_PATH}"
chmod 0600 "${CREDENTIAL_PATH}"

cat > "${SMOKE_PATH}" <<'EOF'
#!/usr/bin/env bash
echo 'SKIP: simulated optional smoke'
EOF
chmod 0755 "${SMOKE_PATH}"

if OMS_PROTOCOL_GATE_CREDENTIAL_FILE="${CREDENTIAL_PATH}" \
    OMS_PROTOCOL_GATE_SMOKE_SCRIPT="${SMOKE_PATH}" \
    OMS_PROTOCOL_GATE_MYSQL_BIN="${MYSQL_PATH}" \
    bash "${GATE_SCRIPT}" "${CONFIG_PATH}" >"${OUTPUT_PATH}" 2>&1; then
    echo "FAIL: protocol release gate accepted a skipped authenticated smoke" >&2
    exit 1
fi
grep -Fq 'Authenticated public protocol smoke attempted to skip' "${OUTPUT_PATH}"

echo "PASS: protocol release gate rejects exposed credentials and skipped smokes"

cat > "${SMOKE_PATH}" <<'EOF'
#!/usr/bin/env bash
echo 'WARN: session cleanup failed: simulated logout failure'
echo 'PASS: simulated smoke with incomplete cleanup'
EOF
chmod 0755 "${SMOKE_PATH}"

if OMS_PROTOCOL_GATE_CREDENTIAL_FILE="${CREDENTIAL_PATH}" \
    OMS_PROTOCOL_GATE_SMOKE_SCRIPT="${SMOKE_PATH}" \
    OMS_PROTOCOL_GATE_MYSQL_BIN="${MYSQL_PATH}" \
    bash "${GATE_SCRIPT}" "${CONFIG_PATH}" >"${OUTPUT_PATH}" 2>&1; then
    echo "FAIL: protocol release gate accepted incomplete smoke cleanup" >&2
    exit 1
fi
grep -Fq 'Authenticated public protocol smoke reported incomplete cleanup' "${OUTPUT_PATH}"

echo "PASS: protocol release gate rejects incomplete smoke cleanup"

REQUIRED_PATH="${TEST_ROOT}/protocol-gate.required"
install -m 0600 /dev/null "${REQUIRED_PATH}"

if OMS_PROTOCOL_GATE_REQUIRED_FILE="${REQUIRED_PATH}" \
    bash "${PROJECT_ROOT}/functions/10_webmail.sh" >"${OUTPUT_PATH}" 2>&1; then
    echo "FAIL: direct webmail deployment bypassed protocol protection" >&2
    exit 1
fi
grep -Fq 'run functions/protocol_guarded_deploy.sh webmail instead' "${OUTPUT_PATH}"

if OMS_PROTOCOL_GATE_REQUIRED_FILE="${REQUIRED_PATH}" \
    bash "${PROJECT_ROOT}/functions/04_dovecot.sh" >"${OUTPUT_PATH}" 2>&1; then
    echo "FAIL: direct Dovecot deployment bypassed protocol protection" >&2
    exit 1
fi
grep -Fq 'run functions/protocol_guarded_deploy.sh dovecot instead' "${OUTPUT_PATH}"

if bash "${PROJECT_ROOT}/functions/protocol_guarded_deploy.sh" unsupported "${CONFIG_PATH}" >"${OUTPUT_PATH}" 2>&1; then
    echo "FAIL: guarded deploy accepted an unsupported target" >&2
    exit 1
fi
grep -Fq 'Usage:' "${OUTPUT_PATH}"

echo "PASS: protected protocol modules require the guarded deployment interface"

#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
PROVISIONER="${PROJECT_ROOT}/functions/provision_protocol_canary.sh"
TEST_ROOT=$(mktemp -d)
trap 'rm -rf -- "${TEST_ROOT}"' EXIT

BIN_DIR="${TEST_ROOT}/bin"
STATE_DIR="${TEST_ROOT}/openmailstack"
LOCK_DIR="${TEST_ROOT}/run/openmailstack"
STATE_FILE="${TEST_ROOT}/database.state"
MUTATION_LOG="${TEST_ROOT}/mutations.log"
CONFIG_PATH="${TEST_ROOT}/config.conf"
CREDENTIAL_PATH="${STATE_DIR}/protocol-smoke.env"
IDENTITY_PATH="${STATE_DIR}/protocol-canary.identity"
REQUIRED_PATH="${STATE_DIR}/protocol-gate.required"
LOCK_PATH="${LOCK_DIR}/protocol-canary-provision.lock"
OUTPUT_PATH="${TEST_ROOT}/output.log"

mkdir -p "${BIN_DIR}" "${STATE_DIR}" "${LOCK_DIR}"
chmod 0700 "${STATE_DIR}" "${LOCK_DIR}"

cat > "${CONFIG_PATH}" <<'EOF'
FIRST_DOMAIN='example.test'
POSTFIXADMIN_DB_USER='fixture-user'
POSTFIXADMIN_DB_PASSWORD='fixture-password'
POSTFIXADMIN_DB_NAME='fixture-db'
EOF

write_state() {
    local mailbox_exists=${1:-1}
    local mailbox_name=${2:-OMS Protocol Canary}
    local email_other=${3:-}
    local alias_active=${4:-1}

    cat > "${STATE_FILE}" <<EOF
MAILBOX_EXISTS='${mailbox_exists}'
MAILBOX_ACTIVE='1'
MAILBOX_NAME='${mailbox_name}'
MAILBOX_EMAIL_OTHER='${email_other}'
MAILBOX_PASSWORD_HASH='legacy-hash'
MAILBOX_MAILDIR='example.test/oms-canary/'
ALIAS_ACTIVE='${alias_active}'
EOF
    : > "${MUTATION_LOG}"
}

write_legacy_credential() {
    local username=${1:-oms-canary@example.test}
    local attestation=${2:-}

    {
        printf "OMS_SMOKE_USER='%s'\n" "${username}"
        printf "OMS_SMOKE_PASSWORD='legacy-password'\n"
        if [[ -n "${attestation}" ]]; then
            printf "OMS_PROTOCOL_CANARY_ATTESTATION='%s'\n" "${attestation}"
        fi
    } > "${CREDENTIAL_PATH}"
    chmod 0600 "${CREDENTIAL_PATH}"
    rm -f -- "${IDENTITY_PATH}"
    install -m 0600 /dev/null "${REQUIRED_PATH}"
}

cat > "${BIN_DIR}/openssl" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
case "$*" in
    'rand -base64 36') printf '%s\n' 'rotated-password' ;;
    'rand -hex 32') printf '%064d\n' 0 | tr '0' 'a' ;;
    *) echo "unexpected openssl fixture arguments: $*" >&2; exit 2 ;;
esac
EOF
chmod 0755 "${BIN_DIR}/openssl"

cat > "${BIN_DIR}/php" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
password=$(cat)
if [[ "$*" == *password_verify* ]]; then
    case "${OMS_PROTOCOL_CANARY_HASH:-}:${password}" in
        'legacy-hash:legacy-password'|'rotated-hash:rotated-password') exit 0 ;;
        *) exit 1 ;;
    esac
fi
printf '%s' 'rotated-hash'
EOF
chmod 0755 "${BIN_DIR}/php"

cat > "${BIN_DIR}/mysql" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

query=''
while (( $# > 0 )); do
    if [[ "$1" == '-e' ]]; then
        shift
        query=${1:-}
        break
    fi
    shift
done
if [[ -z "${query}" ]]; then
    query=$(cat)
fi

# shellcheck source=/dev/null
source "${OMS_PROTOCOL_CANARY_FIXTURE_STATE}"

write_state() {
    cat > "${OMS_PROTOCOL_CANARY_FIXTURE_STATE}" <<STATE
MAILBOX_EXISTS='${MAILBOX_EXISTS}'
MAILBOX_ACTIVE='${MAILBOX_ACTIVE}'
MAILBOX_NAME='${MAILBOX_NAME}'
MAILBOX_EMAIL_OTHER='${MAILBOX_EMAIL_OTHER}'
MAILBOX_PASSWORD_HASH='${MAILBOX_PASSWORD_HASH}'
MAILBOX_MAILDIR='${MAILBOX_MAILDIR}'
ALIAS_ACTIVE='${ALIAS_ACTIVE}'
STATE
}

if [[ "${query}" == *OMS_PROTOCOL_CANARY_ROTATE_LEGACY* ]]; then
    if [[ "${query}" == *"SELECT 'OMS_PROTOCOL_CANARY_ROTATED', @oms_protocol_canary_rotated;"* ]]; then
        rotation_output_format='columns'
    elif [[ "${query}" == *"SELECT CONCAT_WS(CHAR(9), 'OMS_PROTOCOL_CANARY_ROTATED', @oms_protocol_canary_rotated);"* ]]; then
        # mysql --batch escapes tabs embedded inside a field unless --raw is used.
        rotation_output_format='escaped-field'
    else
        echo 'unexpected rotation result query shape' >&2
        exit 2
    fi
    if [[ "${MAILBOX_EXISTS}" == '1' && "${MAILBOX_ACTIVE}" == '1'
        && "${MAILBOX_NAME}" == 'OMS Protocol Canary' && -z "${MAILBOX_EMAIL_OTHER}"
        && "${MAILBOX_PASSWORD_HASH}" == 'legacy-hash' && "${ALIAS_ACTIVE}" == '1' ]]; then
        MAILBOX_PASSWORD_HASH='rotated-hash'
        MAILBOX_EMAIL_OTHER="oms-protocol-canary:$(printf '%064d' 0 | tr '0' 'a')"
        write_state
        echo 'ROTATE' >> "${OMS_PROTOCOL_CANARY_FIXTURE_MUTATIONS}"
        if [[ "${rotation_output_format}" == 'columns' ]]; then
            printf 'OMS_PROTOCOL_CANARY_ROTATED\t1\n'
        else
            printf 'OMS_PROTOCOL_CANARY_ROTATED\\t1\n'
        fi
    else
        if [[ "${rotation_output_format}" == 'columns' ]]; then
            printf 'OMS_PROTOCOL_CANARY_ROTATED\t0\n'
        else
            printf 'OMS_PROTOCOL_CANARY_ROTATED\\t0\n'
        fi
    fi
    exit 0
fi

if [[ "${query}" == *OMS_PROTOCOL_CANARY_ROLLBACK_LEGACY* ]]; then
    MAILBOX_PASSWORD_HASH='legacy-hash'
    MAILBOX_EMAIL_OTHER=''
    write_state
    echo 'ROLLBACK' >> "${OMS_PROTOCOL_CANARY_FIXTURE_MUTATIONS}"
    exit 0
fi

if [[ "${query}" == *'INSERT INTO mailbox'* ]]; then
    echo 'CREATE' >> "${OMS_PROTOCOL_CANARY_FIXTURE_MUTATIONS}"
    exit 0
fi

if [[ "${query}" == *'SELECT IF(email_other IS NULL'* ]]; then
    [[ -z "${MAILBOX_EMAIL_OTHER}" ]] && printf 'EMPTY\n' || printf 'MARKED\n'
elif [[ "${query}" == *'SELECT password FROM mailbox'*'AND email_other=0x'* ]]; then
    [[ "${MAILBOX_EMAIL_OTHER}" == oms-protocol-canary:* ]] && printf '%s\n' "${MAILBOX_PASSWORD_HASH}"
elif [[ "${query}" == *'SELECT password FROM mailbox'* ]]; then
    if [[ "${MAILBOX_EXISTS}" == '1' && "${MAILBOX_ACTIVE}" == '1'
        && "${MAILBOX_NAME}" == 'OMS Protocol Canary' && -z "${MAILBOX_EMAIL_OTHER}" ]]; then
        printf '%s\n' "${MAILBOX_PASSWORD_HASH}"
    fi
elif [[ "${query}" == *'SELECT COUNT(*) FROM mailbox'*"name='OMS Protocol Canary'"*'(email_other='* ]]; then
    if [[ "${MAILBOX_EXISTS}" == '1' && "${MAILBOX_ACTIVE}" == '1'
        && "${MAILBOX_NAME}" == 'OMS Protocol Canary' && -z "${MAILBOX_EMAIL_OTHER}" ]]; then
        printf '1\n'
    else
        printf '0\n'
    fi
elif [[ "${query}" == *'SELECT COUNT(*) FROM mailbox'*'AND email_other=0x'* ]]; then
    if [[ "${MAILBOX_EXISTS}" == '1' && "${MAILBOX_ACTIVE}" == '1'
        && "${MAILBOX_EMAIL_OTHER}" == oms-protocol-canary:* ]]; then
        printf '1\n'
    else
        printf '0\n'
    fi
elif [[ "${query}" == *'SELECT COUNT(*) FROM mailbox'* ]]; then
    printf '%s\n' "${MAILBOX_EXISTS}"
elif [[ "${query}" == *'SELECT COUNT(*) FROM alias'* ]]; then
    printf '%s\n' "${ALIAS_ACTIVE}"
elif [[ "${query}" == *'SELECT COUNT(*) FROM domain'* ]]; then
    printf '1\n'
else
    echo "unexpected mysql fixture query: ${query}" >&2
    exit 2
fi
EOF
chmod 0755 "${BIN_DIR}/mysql"

export PATH="${BIN_DIR}:${PATH}"
export OMS_PROTOCOL_GATE_CREDENTIAL_FILE="${CREDENTIAL_PATH}"
export OMS_PROTOCOL_GATE_IDENTITY_FILE="${IDENTITY_PATH}"
export OMS_PROTOCOL_GATE_REQUIRED_FILE="${REQUIRED_PATH}"
export OMS_PROTOCOL_CANARY_LOCK_FILE="${LOCK_PATH}"
export OMS_PROTOCOL_CANARY_FIXTURE_STATE="${STATE_FILE}"
export OMS_PROTOCOL_CANARY_FIXTURE_MUTATIONS="${MUTATION_LOG}"

write_state
write_legacy_credential
legacy_state_hash=$(sha256sum "${STATE_FILE}")
legacy_credential_hash=$(sha256sum "${CREDENTIAL_PATH}")
if bash "${PROVISIONER}" "${CONFIG_PATH}" >"${OUTPUT_PATH}" 2>&1; then
    echo 'FAIL: normal provisioning silently migrated the legacy canary' >&2
    exit 1
fi
grep -Fq -- '--rotate-legacy' "${OUTPUT_PATH}"
[[ "$(sha256sum "${STATE_FILE}")" == "${legacy_state_hash}" ]]
[[ "$(sha256sum "${CREDENTIAL_PATH}")" == "${legacy_credential_hash}" ]]
[[ ! -e "${IDENTITY_PATH}" && ! -s "${MUTATION_LOG}" ]]

if ! bash "${PROVISIONER}" --rotate-legacy "${CONFIG_PATH}" >"${OUTPUT_PATH}" 2>&1; then
    cat "${OUTPUT_PATH}" >&2
    echo 'FAIL: exact legacy protocol canary rotation did not complete' >&2
    exit 1
fi
grep -Fq 'Rotated and attested legacy protocol canary mailbox' "${OUTPUT_PATH}"
grep -Fq "OMS_SMOKE_PASSWORD='rotated-password'" "${CREDENTIAL_PATH}"
grep -Eq "^OMS_PROTOCOL_CANARY_ATTESTATION='[0-9a-f]{64}'$" "${CREDENTIAL_PATH}"
grep -Fq "OMS_PROTOCOL_CANARY_USER='oms-canary@example.test'" "${IDENTITY_PATH}"
[[ "$(stat -c '%U:%G:%a' "${CREDENTIAL_PATH}")" == 'root:root:600' ]]
[[ "$(stat -c '%U:%G:%a' "${IDENTITY_PATH}")" == 'root:root:600' ]]
# shellcheck source=/dev/null
source "${STATE_FILE}"
[[ "${MAILBOX_PASSWORD_HASH}" == 'rotated-hash' ]]
[[ "${MAILBOX_EMAIL_OTHER}" == oms-protocol-canary:* ]]
[[ "${MAILBOX_MAILDIR}" == 'example.test/oms-canary/' ]]
[[ "$(cat "${MUTATION_LOG}")" == 'ROTATE' ]]

rotated_state_hash=$(sha256sum "${STATE_FILE}")
rotated_credential_hash=$(sha256sum "${CREDENTIAL_PATH}")
rotated_identity_hash=$(sha256sum "${IDENTITY_PATH}")
bash "${PROVISIONER}" --rotate-legacy "${CONFIG_PATH}" >"${OUTPUT_PATH}" 2>&1
grep -Fq 'Protocol canary already provisioned' "${OUTPUT_PATH}"
[[ "$(sha256sum "${STATE_FILE}")" == "${rotated_state_hash}" ]]
[[ "$(sha256sum "${CREDENTIAL_PATH}")" == "${rotated_credential_hash}" ]]
[[ "$(sha256sum "${IDENTITY_PATH}")" == "${rotated_identity_hash}" ]]
[[ "$(cat "${MUTATION_LOG}")" == 'ROTATE' ]]

echo 'PASS: explicit legacy canary rotation is positive, password-verified, and idempotent'

for near_miss in mailbox_name marker alias credential_user credential_attestation; do
    case "${near_miss}" in
        mailbox_name)
            write_state 1 'OMS Protocol Canarx' '' 1
            write_legacy_credential
            ;;
        marker)
            write_state 1 'OMS Protocol Canary' 'existing-marker' 1
            write_legacy_credential
            ;;
        alias)
            write_state 1 'OMS Protocol Canary' '' 0
            write_legacy_credential
            ;;
        credential_user)
            write_state
            write_legacy_credential 'real-user@example.test'
            ;;
        credential_attestation)
            write_state
            write_legacy_credential 'oms-canary@example.test' "$(printf '%064d' 0 | tr '0' 'b')"
            ;;
    esac
    state_hash_before=$(sha256sum "${STATE_FILE}")
    credential_hash_before=$(sha256sum "${CREDENTIAL_PATH}")
    if bash "${PROVISIONER}" --rotate-legacy "${CONFIG_PATH}" >"${OUTPUT_PATH}" 2>&1; then
        echo "FAIL: legacy rotation accepted near-miss ${near_miss}" >&2
        exit 1
    fi
    [[ "$(sha256sum "${STATE_FILE}")" == "${state_hash_before}" ]]
    [[ "$(sha256sum "${CREDENTIAL_PATH}")" == "${credential_hash_before}" ]]
    [[ ! -e "${IDENTITY_PATH}" && ! -s "${MUTATION_LOG}" ]]
done

echo 'PASS: legacy rotation rejects near-miss identities without database or secret mutation'

UNSAFE_PARENT="${TEST_ROOT}/unsafe-parent"
mkdir "${UNSAFE_PARENT}"
chmod 0755 "${UNSAFE_PARENT}"
write_state 0
export OMS_PROTOCOL_GATE_CREDENTIAL_FILE="${UNSAFE_PARENT}/protocol-smoke.env"
export OMS_PROTOCOL_GATE_IDENTITY_FILE="${UNSAFE_PARENT}/protocol-canary.identity"
export OMS_PROTOCOL_GATE_REQUIRED_FILE="${UNSAFE_PARENT}/protocol-gate.required"
if bash "${PROVISIONER}" "${CONFIG_PATH}" >"${OUTPUT_PATH}" 2>&1; then
    echo 'FAIL: provisioner accepted a non-dedicated override parent' >&2
    exit 1
fi
[[ "$(stat -c '%a' "${UNSAFE_PARENT}")" == '755' ]]
[[ ! -e "${UNSAFE_PARENT}/protocol-smoke.env" ]]

echo 'PASS: provisioner never chmods or populates an arbitrary override parent'

bash "${PROVISIONER}" --help >"${OUTPUT_PATH}"
grep -Fq -- '--rotate-legacy' "${OUTPUT_PATH}"
grep -Fq 'Normal provisioning never migrates a legacy mailbox' "${OUTPUT_PATH}"

echo 'PASS: provisioner help documents the explicit fail-closed migration mode'

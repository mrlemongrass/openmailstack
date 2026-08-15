#!/usr/bin/env bash
set -euo pipefail
trap 'echo "Protocol canary provisioning failed at line ${LINENO}." >&2' ERR

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_DIR=$(cd "${SCRIPT_DIR}/.." && pwd)

usage() {
    cat <<EOF
Usage: $0 [--rotate-legacy] [config-path]

Provision or verify the dedicated OpenMailStack protocol canary.

  --rotate-legacy  Explicitly rotate only the exact unmarked legacy OMS Protocol
                   Canary mailbox after credential, password, row, and alias proof.
  --help           Show this help.

Normal provisioning never migrates a legacy mailbox. It fails closed and requires
the explicit --rotate-legacy mode after an operator reviews the candidate.
EOF
}

ROTATE_LEGACY=0
case "${1:-}" in
    --help|-h)
        usage
        exit 0
        ;;
    --rotate-legacy)
        ROTATE_LEGACY=1
        shift
        ;;
    --*)
        echo "Error: unsupported option: $1" >&2
        usage >&2
        exit 2
        ;;
esac
if (( $# > 1 )); then
    usage >&2
    exit 2
fi

CONFIG_PATH="${1:-${REPO_DIR}/config.conf}"
CREDENTIAL_FILE="${OMS_PROTOCOL_GATE_CREDENTIAL_FILE:-/etc/openmailstack/protocol-smoke.env}"
IDENTITY_FILE="${OMS_PROTOCOL_GATE_IDENTITY_FILE:-/etc/openmailstack/protocol-canary.identity}"
REQUIRED_FILE="${OMS_PROTOCOL_GATE_REQUIRED_FILE:-/etc/openmailstack/protocol-gate.required}"
LOCK_FILE="${OMS_PROTOCOL_CANARY_LOCK_FILE:-/run/openmailstack/protocol-canary-provision.lock}"
readonly CANONICAL_CREDENTIAL_FILE="${CREDENTIAL_FILE}"
readonly CANONICAL_IDENTITY_FILE="${IDENTITY_FILE}"
readonly CANONICAL_REQUIRED_FILE="${REQUIRED_FILE}"
readonly CANONICAL_LOCK_FILE="${LOCK_FILE}"

fail() {
    echo "Error: $1" >&2
    exit 1
}

mysql_hex_literal() {
    local value=$1
    local hex
    hex=$(printf '%s' "${value}" | LC_ALL=C od -An -v -tx1 | tr -d '[:space:]')
    [[ -n "${hex}" ]] || fail "Cannot encode an empty protocol canary identity"
    printf '0x%s' "${hex}"
}

validate_secure_directory() {
    local path=$1
    local description=$2
    local owner
    local mode

    [[ -d "${path}" && ! -L "${path}" ]] || fail "${description} must be a real directory: ${path}"
    [[ "$(readlink -f -- "${path}")" == "${path}" ]] \
        || fail "${description} must not traverse symbolic links: ${path}"
    owner=$(stat -c '%u' "${path}")
    mode=$(stat -c '%a' "${path}")
    if [[ "${owner}" != "0" ]] || (( (8#${mode} & 022) != 0 )); then
        fail "${description} must be root-owned and not writable by group or others"
    fi
}

prepare_dedicated_directory() {
    local path=$1
    local description=$2
    local parent

    [[ "${path}" == /* && "$(readlink -m -- "${path}")" == "${path}" ]] \
        || fail "${description} path must be absolute and normalized"
    [[ "$(basename -- "${path}")" == "openmailstack" ]] \
        || fail "${description} must use a dedicated openmailstack directory"
    parent=$(dirname -- "${path}")
    validate_secure_directory "${parent}" "${description} parent"
    if [[ ! -e "${path}" && ! -L "${path}" ]]; then
        install -d -o root -g root -m 0700 -- "${path}"
    fi
    validate_secure_directory "${path}" "${description}"
}

validate_direct_child() {
    local path=$1
    local directory=$2
    local expected_name=$3
    local description=$4

    [[ "${path}" == "${directory}/${expected_name}" ]] \
        || fail "${description} must be the safe direct child ${directory}/${expected_name}"
}

validate_root_secret_file() {
    local path=$1
    local description=$2
    local owner
    local mode

    [[ -f "${path}" ]] || fail "${description} is missing: ${path}"
    [[ ! -L "${path}" ]] || fail "${description} must not be a symbolic link"
    owner=$(stat -c '%u' "${path}")
    mode=$(stat -c '%a' "${path}")
    if [[ "${owner}" != "0" ]] || (( (8#${mode} & 077) != 0 )); then
        fail "${description} must be root-owned and inaccessible to group or others"
    fi
}

seal_secret_temp() {
    local path=$1
    chown root:root -- "${path}"
    chmod 0600 -- "${path}"
    sync -f -- "${path}"
}

atomic_replace_secret() {
    local source_path=$1
    local destination_path=$2
    [[ ! -L "${destination_path}" ]] || return 1
    mv -fT -- "${source_path}" "${destination_path}" || return 1
    sync -f -- "${destination_path}" || return 1
    sync -f -- "$(dirname -- "${destination_path}")"
}

ensure_required_file() {
    local required_tmp
    if [[ -e "${REQUIRED_FILE}" || -L "${REQUIRED_FILE}" ]]; then
        validate_root_secret_file "${REQUIRED_FILE}" "Protocol gate sentinel"
        return 0
    fi
    required_tmp=$(mktemp "${STATE_DIR}/.protocol-gate.required.XXXXXX")
    seal_secret_temp "${required_tmp}"
    atomic_replace_secret "${required_tmp}" "${REQUIRED_FILE}"
}

mysql_query() {
    local query=$1
    MYSQL_PWD="${POSTFIXADMIN_DB_PASSWORD}" mysql \
        --protocol=TCP \
        --host=127.0.0.1 \
        --user="${POSTFIXADMIN_DB_USER}" \
        --batch \
        --skip-column-names \
        "${POSTFIXADMIN_DB_NAME}" \
        -e "${query}"
}

mysql_script() {
    MYSQL_PWD="${POSTFIXADMIN_DB_PASSWORD}" mysql \
        --protocol=TCP \
        --host=127.0.0.1 \
        --user="${POSTFIXADMIN_DB_USER}" \
        --batch \
        --skip-column-names \
        "${POSTFIXADMIN_DB_NAME}"
}

password_matches_hash() {
    local password=$1
    local password_hash=$2
    # shellcheck disable=SC2016 # The single-quoted program is evaluated by PHP.
    printf '%s' "${password}" | OMS_PROTOCOL_CANARY_HASH="${password_hash}" \
        php -r '$password = stream_get_contents(STDIN); exit(password_verify($password, getenv("OMS_PROTOCOL_CANARY_HASH")) ? 0 : 1);'
}

verify_existing_attested_canary() {
    local OMS_PROTOCOL_CANARY_USER=''
    local OMS_PROTOCOL_CANARY_ATTESTATION=''
    local OMS_SMOKE_USER=''
    local OMS_SMOKE_PASSWORD=''
    local attested_user
    local attested_token
    local credential_token
    local marker
    local marker_literal
    local attested_count
    local self_alias_count
    local database_hash

    validate_root_secret_file "${CREDENTIAL_FILE}" "Protocol canary credential file"
    validate_root_secret_file "${IDENTITY_FILE}" "Protocol canary identity file"
    # shellcheck source=/dev/null
    source "${IDENTITY_FILE}"
    attested_user=${OMS_PROTOCOL_CANARY_USER}
    attested_token=${OMS_PROTOCOL_CANARY_ATTESTATION}
    OMS_PROTOCOL_CANARY_USER=''
    OMS_PROTOCOL_CANARY_ATTESTATION=''
    # shellcheck source=/dev/null
    source "${CREDENTIAL_FILE}"
    credential_token=${OMS_PROTOCOL_CANARY_ATTESTATION}
    [[ "${attested_user}" == "${CANARY_USER}" && "${OMS_SMOKE_USER}" == "${CANARY_USER}" ]] \
        || fail "Existing protocol canary files do not attest the configured mailbox"
    [[ "${attested_token}" =~ ^[0-9a-f]{64}$ && "${credential_token}" == "${attested_token}" ]] \
        || fail "Existing protocol canary attestation is missing or invalid"
    [[ -n "${OMS_SMOKE_PASSWORD}" ]] || fail "Existing protocol canary credential has no password"
    marker="oms-protocol-canary:${attested_token}"
    marker_literal=$(mysql_hex_literal "${marker}")
    attested_count=$(mysql_query "SELECT COUNT(*) FROM mailbox WHERE username=${CANARY_USER_SQL_LITERAL} AND active=1 AND name='OMS Protocol Canary' AND email_other=${marker_literal}")
    self_alias_count=$(mysql_query "SELECT COUNT(*) FROM alias WHERE address=${CANARY_USER_SQL_LITERAL} AND goto=${CANARY_USER_SQL_LITERAL} AND active=1")
    database_hash=$(mysql_query "SELECT password FROM mailbox WHERE username=${CANARY_USER_SQL_LITERAL} AND active=1 AND name='OMS Protocol Canary' AND email_other=${marker_literal}")
    [[ "${attested_count}" == "1" && "${self_alias_count}" == "1" && -n "${database_hash}" ]] \
        || fail "Existing mailbox is not a durably attested dedicated protocol canary"
    password_matches_hash "${OMS_SMOKE_PASSWORD}" "${database_hash}" \
        || fail "Existing protocol canary credential password does not match the mailbox hash"
}

rotate_legacy_canary() (
    set -euo pipefail
    local OMS_SMOKE_USER=''
    local OMS_SMOKE_PASSWORD=''
    local OMS_PROTOCOL_CANARY_ATTESTATION=''
    local legacy_count
    local self_alias_count
    local legacy_marker_kind
    local legacy_hash
    local legacy_hash_literal
    local new_password
    local new_hash
    local new_hash_literal
    local new_attestation
    local new_marker
    local new_marker_literal
    local credential_tmp
    local identity_tmp
    local credential_backup
    local rotation_output
    local rotation_line
    local rotation_label
    local rotation_rows
    local rotation_extra
    local rollback_marker
    local db_maybe_updated=0
    local credential_replaced=0
    local identity_replaced=0
    local required_preexisting=0
    local rotation_complete=0

    validate_root_secret_file "${CREDENTIAL_FILE}" "Legacy protocol canary credential file"
    [[ ! -e "${IDENTITY_FILE}" && ! -L "${IDENTITY_FILE}" ]] \
        || fail "Legacy rotation requires no existing protocol canary identity file"
    # shellcheck source=/dev/null
    source "${CREDENTIAL_FILE}"
    [[ "${OMS_SMOKE_USER}" == "${CANARY_USER}" ]] \
        || fail "Legacy credential user does not match the configured protocol canary"
    [[ -n "${OMS_SMOKE_PASSWORD}" ]] || fail "Legacy protocol canary credential has no password"
    [[ -z "${OMS_PROTOCOL_CANARY_ATTESTATION}" ]] \
        || fail "Legacy credential already contains an attestation without an identity file"

    legacy_count=$(mysql_query "SELECT COUNT(*) FROM mailbox WHERE username=${CANARY_USER_SQL_LITERAL} AND active=1 AND name='OMS Protocol Canary' AND (email_other='' OR email_other IS NULL)")
    self_alias_count=$(mysql_query "SELECT COUNT(*) FROM alias WHERE address=${CANARY_USER_SQL_LITERAL} AND goto=${CANARY_USER_SQL_LITERAL} AND active=1")
    legacy_marker_kind=$(mysql_query "SELECT IF(email_other IS NULL, 'NULL', 'EMPTY') FROM mailbox WHERE username=${CANARY_USER_SQL_LITERAL} AND active=1 AND name='OMS Protocol Canary' AND (email_other='' OR email_other IS NULL)")
    legacy_hash=$(mysql_query "SELECT password FROM mailbox WHERE username=${CANARY_USER_SQL_LITERAL} AND active=1 AND name='OMS Protocol Canary' AND (email_other='' OR email_other IS NULL)")
    [[ "${legacy_count}" == "1" && "${self_alias_count}" == "1"
        && ( "${legacy_marker_kind}" == "EMPTY" || "${legacy_marker_kind}" == "NULL" )
        && -n "${legacy_hash}" ]] \
        || fail "Legacy mailbox does not exactly match the dedicated OMS Protocol Canary identity"
    password_matches_hash "${OMS_SMOKE_PASSWORD}" "${legacy_hash}" \
        || fail "Legacy credential password does not match the mailbox hash"

    new_password=$(openssl rand -base64 36 | tr -d '\n')
    # shellcheck disable=SC2016 # The single-quoted program is evaluated by PHP.
    new_hash=$(printf '%s' "${new_password}" | php -r '$password = stream_get_contents(STDIN); echo password_hash($password, PASSWORD_BCRYPT, ["cost" => 12]);')
    new_attestation=$(openssl rand -hex 32)
    [[ "${new_attestation}" =~ ^[0-9a-f]{64}$ && -n "${new_hash}" ]] \
        || fail "Could not generate a valid protocol canary attestation"
    new_marker="oms-protocol-canary:${new_attestation}"
    legacy_hash_literal=$(mysql_hex_literal "${legacy_hash}")
    new_hash_literal=$(mysql_hex_literal "${new_hash}")
    new_marker_literal=$(mysql_hex_literal "${new_marker}")
    if [[ "${legacy_marker_kind}" == "NULL" ]]; then
        rollback_marker='NULL'
    else
        rollback_marker="''"
    fi

    credential_tmp=$(mktemp "${STATE_DIR}/.protocol-smoke.env.rotate.XXXXXX")
    identity_tmp=$(mktemp "${STATE_DIR}/.protocol-canary.identity.rotate.XXXXXX")
    credential_backup=$(mktemp "${STATE_DIR}/.protocol-smoke.env.backup.XXXXXX")
    cp -p -- "${CREDENTIAL_FILE}" "${credential_backup}"
    seal_secret_temp "${credential_backup}"
    (
        umask 077
        {
            printf '# Root-only credential for the OpenMailStack protocol release gate.\n'
            printf "OMS_SMOKE_USER='%s'\n" "${CANARY_USER}"
            printf "OMS_SMOKE_PASSWORD='%s'\n" "${new_password}"
            printf "OMS_PROTOCOL_CANARY_ATTESTATION='%s'\n" "${new_attestation}"
        } > "${credential_tmp}"
        {
            printf '# Root-only dedicated mailbox identity for the OpenMailStack protocol release gate.\n'
            printf "OMS_PROTOCOL_CANARY_USER='%s'\n" "${CANARY_USER}"
            printf "OMS_PROTOCOL_CANARY_ATTESTATION='%s'\n" "${new_attestation}"
        } > "${identity_tmp}"
    )
    seal_secret_temp "${credential_tmp}"
    seal_secret_temp "${identity_tmp}"
    [[ -e "${REQUIRED_FILE}" || -L "${REQUIRED_FILE}" ]] && required_preexisting=1

    # shellcheck disable=SC2317 # Invoked indirectly by the EXIT trap below.
    cleanup_rotation() {
        local exit_status=$?
        local rollback_ok=1
        trap - EXIT HUP INT TERM
        rm -f -- "${credential_tmp}" "${identity_tmp}"
        if [[ "${rotation_complete}" != "1" ]]; then
            if [[ "${db_maybe_updated}" == "1" ]]; then
                if ! mysql_script >/dev/null 2>&1 <<SQL
START TRANSACTION;
/* OMS_PROTOCOL_CANARY_ROLLBACK_LEGACY */
UPDATE mailbox
SET password=${legacy_hash_literal}, email_other=${rollback_marker}, modified=NOW()
WHERE username=${CANARY_USER_SQL_LITERAL}
  AND password=${new_hash_literal}
  AND email_other=${new_marker_literal};
COMMIT;
SQL
                then
                    rollback_ok=0
                fi
            fi
            if [[ "${credential_replaced}" == "1" ]]; then
                atomic_replace_secret "${credential_backup}" "${CREDENTIAL_FILE}" || rollback_ok=0
                credential_backup=''
            fi
            if [[ "${identity_replaced}" == "1" ]]; then
                rm -f -- "${IDENTITY_FILE}" || rollback_ok=0
                sync -f -- "${STATE_DIR}" || rollback_ok=0
            fi
            if [[ "${required_preexisting}" == "0" ]]; then
                rm -f -- "${REQUIRED_FILE}" || rollback_ok=0
            fi
            if [[ "${rollback_ok}" != "1" ]]; then
                echo "WARN: legacy protocol canary rotation rollback was incomplete" >&2
            fi
        fi
        [[ -z "${credential_backup}" ]] || rm -f -- "${credential_backup}"
        exit "${exit_status}"
    }
    trap cleanup_rotation EXIT
    trap 'exit 130' HUP INT TERM

    db_maybe_updated=1
    rotation_output=$(mysql_script <<SQL
START TRANSACTION;
/* OMS_PROTOCOL_CANARY_ROTATE_LEGACY */
UPDATE mailbox
SET password=${new_hash_literal}, email_other=${new_marker_literal}, modified=NOW()
WHERE username=${CANARY_USER_SQL_LITERAL}
  AND active=1
  AND name='OMS Protocol Canary'
  AND (email_other='' OR email_other IS NULL)
  AND password=${legacy_hash_literal};
SET @oms_protocol_canary_rotated = ROW_COUNT();
SELECT 'OMS_PROTOCOL_CANARY_ROTATED', @oms_protocol_canary_rotated;
COMMIT;
SQL
    )
    rotation_line=$(grep -F $'OMS_PROTOCOL_CANARY_ROTATED\t' <<< "${rotation_output}" | tail -n 1 || true)
    IFS=$'\t' read -r rotation_label rotation_rows rotation_extra <<< "${rotation_line}"
    [[ "${rotation_label}" == "OMS_PROTOCOL_CANARY_ROTATED" && "${rotation_rows}" == "1"
        && -z "${rotation_extra}" ]] \
        || fail "Legacy canary changed during verification; rotation was not applied"

    credential_replaced=1
    atomic_replace_secret "${credential_tmp}" "${CREDENTIAL_FILE}"
    identity_replaced=1
    atomic_replace_secret "${identity_tmp}" "${IDENTITY_FILE}"
    ensure_required_file
    verify_existing_attested_canary
    rotation_complete=1
    echo "Rotated and attested legacy protocol canary mailbox: ${CANARY_USER}"
)

[[ ${EUID} -eq 0 ]] || fail "Run protocol canary provisioning as root"
[[ -f "${CONFIG_PATH}" ]] || fail "OpenMailStack config file not found: ${CONFIG_PATH}"

# shellcheck source=/dev/null
source "${CONFIG_PATH}"
CREDENTIAL_FILE="${CANONICAL_CREDENTIAL_FILE}"
IDENTITY_FILE="${CANONICAL_IDENTITY_FILE}"
REQUIRED_FILE="${CANONICAL_REQUIRED_FILE}"
LOCK_FILE="${CANONICAL_LOCK_FILE}"

CANARY_USER="${OMS_PROTOCOL_CANARY_USER:-oms-canary@${FIRST_DOMAIN}}"
CANARY_LOCAL_PART="${CANARY_USER%@*}"
CANARY_DOMAIN="${CANARY_USER#*@}"

[[ "${CANARY_USER}" == *@* ]] || fail "OMS_PROTOCOL_CANARY_USER must be a complete email address"
[[ "${CANARY_LOCAL_PART}" =~ ^[A-Za-z0-9._+-]+$ ]] || fail "Protocol canary local part contains unsupported characters"
[[ "${CANARY_DOMAIN}" =~ ^[A-Za-z0-9.-]+$ ]] || fail "Protocol canary domain contains unsupported characters"
[[ -n "${POSTFIXADMIN_DB_USER:-}" && -n "${POSTFIXADMIN_DB_PASSWORD:-}" && -n "${POSTFIXADMIN_DB_NAME:-}" ]] \
    || fail "PostfixAdmin database settings are incomplete"
CANARY_USER_SQL_LITERAL=$(mysql_hex_literal "${CANARY_USER}")

STATE_DIR=$(dirname -- "${CREDENTIAL_FILE}")
[[ "$(dirname -- "${IDENTITY_FILE}")" == "${STATE_DIR}"
    && "$(dirname -- "${REQUIRED_FILE}")" == "${STATE_DIR}" ]] \
    || fail "Protocol canary credential, identity, and sentinel must share one dedicated directory"
prepare_dedicated_directory "${STATE_DIR}" "Protocol canary state directory"
validate_direct_child "${CREDENTIAL_FILE}" "${STATE_DIR}" 'protocol-smoke.env' "Credential file"
validate_direct_child "${IDENTITY_FILE}" "${STATE_DIR}" 'protocol-canary.identity' "Identity file"
validate_direct_child "${REQUIRED_FILE}" "${STATE_DIR}" 'protocol-gate.required' "Protocol gate sentinel"

LOCK_DIR=$(dirname -- "${LOCK_FILE}")
prepare_dedicated_directory "${LOCK_DIR}" "Protocol canary lock directory"
validate_direct_child "${LOCK_FILE}" "${LOCK_DIR}" 'protocol-canary-provision.lock' "Provisioning lock"
if [[ ! -e "${LOCK_FILE}" && ! -L "${LOCK_FILE}" ]]; then
    (
        umask 077
        : > "${LOCK_FILE}"
    )
fi
validate_root_secret_file "${LOCK_FILE}" "Protocol canary provisioning lock"
exec {PROVISION_LOCK_FD}<>"${LOCK_FILE}"
flock -n "${PROVISION_LOCK_FD}" || fail "Another protocol canary provision or rotation is running"

mailbox_count=$(mysql_query "SELECT COUNT(*) FROM mailbox WHERE username=${CANARY_USER_SQL_LITERAL}")
if [[ "${mailbox_count}" == "1" ]]; then
    if [[ -e "${IDENTITY_FILE}" || -L "${IDENTITY_FILE}" ]]; then
        verify_existing_attested_canary
        ensure_required_file
        echo "Protocol canary already provisioned: ${CANARY_USER}"
        exit 0
    fi
    if [[ "${ROTATE_LEGACY}" == "1" ]]; then
        rotate_legacy_canary
        exit 0
    fi
    validate_root_secret_file "${CREDENTIAL_FILE}" "Legacy protocol canary credential file"
    fail "Legacy protocol canary requires explicit review; rerun with --rotate-legacy to attest it"
fi
[[ "${mailbox_count}" == "0" ]] || fail "Unexpected duplicate protocol canary mailbox rows"
[[ "${ROTATE_LEGACY}" == "0" ]] || fail "Legacy rotation requires exactly one existing protocol canary mailbox"
[[ ! -e "${CREDENTIAL_FILE}" && ! -L "${CREDENTIAL_FILE}" ]] \
    || fail "Credential file exists but the canary mailbox does not; remove the orphaned file before retrying"
[[ ! -e "${IDENTITY_FILE}" && ! -L "${IDENTITY_FILE}" ]] \
    || fail "Identity file exists but the canary mailbox does not; remove the orphaned file before retrying"

domain_count=$(mysql_query "SELECT COUNT(*) FROM domain WHERE domain='${CANARY_DOMAIN}' AND active=1")
[[ "${domain_count}" == "1" ]] || fail "Protocol canary domain is missing or inactive: ${CANARY_DOMAIN}"

credential_tmp=$(mktemp "${STATE_DIR}/.protocol-smoke.env.XXXXXX")
identity_tmp=$(mktemp "${STATE_DIR}/.protocol-canary.identity.XXXXXX")
CANARY_PASSWORD=$(openssl rand -base64 36 | tr -d '\n')
# shellcheck disable=SC2016 # The single-quoted program is evaluated by PHP.
CANARY_HASH=$(printf '%s' "${CANARY_PASSWORD}" | php -r '$password = stream_get_contents(STDIN); echo password_hash($password, PASSWORD_BCRYPT, ["cost" => 12]);')
CANARY_ATTESTATION=$(openssl rand -hex 32)
CANARY_ATTESTATION_MARKER="oms-protocol-canary:${CANARY_ATTESTATION}"
CANARY_HASH_SQL_LITERAL=$(mysql_hex_literal "${CANARY_HASH}")
CANARY_ATTESTATION_SQL_LITERAL=$(mysql_hex_literal "${CANARY_ATTESTATION_MARKER}")
MAILBOX_MAYBE_CREATED=0
PROVISION_COMPLETE=0

cleanup_new_canary() {
    local exit_status=$?
    trap - EXIT
    rm -f -- "${credential_tmp}" "${identity_tmp}"
    if [[ "${MAILBOX_MAYBE_CREATED}" == "1" && "${PROVISION_COMPLETE}" != "1" ]]; then
        mysql_script >/dev/null 2>&1 <<SQL || true
START TRANSACTION;
DELETE FROM alias WHERE address=${CANARY_USER_SQL_LITERAL} AND goto=${CANARY_USER_SQL_LITERAL};
DELETE FROM mailbox WHERE username=${CANARY_USER_SQL_LITERAL} AND email_other=${CANARY_ATTESTATION_SQL_LITERAL};
COMMIT;
SQL
        rm -f -- "${CREDENTIAL_FILE}" "${IDENTITY_FILE}" "${REQUIRED_FILE}"
    fi
    exit "${exit_status}"
}
trap cleanup_new_canary EXIT

(
    umask 077
    {
        printf '# Root-only credential for the OpenMailStack protocol release gate.\n'
        printf "OMS_SMOKE_USER='%s'\n" "${CANARY_USER}"
        printf "OMS_SMOKE_PASSWORD='%s'\n" "${CANARY_PASSWORD}"
        printf "OMS_PROTOCOL_CANARY_ATTESTATION='%s'\n" "${CANARY_ATTESTATION}"
    } > "${credential_tmp}"
    {
        printf '# Root-only dedicated mailbox identity for the OpenMailStack protocol release gate.\n'
        printf "OMS_PROTOCOL_CANARY_USER='%s'\n" "${CANARY_USER}"
        printf "OMS_PROTOCOL_CANARY_ATTESTATION='%s'\n" "${CANARY_ATTESTATION}"
    } > "${identity_tmp}"
)
seal_secret_temp "${credential_tmp}"
seal_secret_temp "${identity_tmp}"

MAILBOX_MAYBE_CREATED=1
mysql_script <<SQL
START TRANSACTION;
INSERT INTO mailbox
    (username, password, name, maildir, quota, local_part, domain, active, phone, email_other, created, modified)
VALUES
    (${CANARY_USER_SQL_LITERAL}, ${CANARY_HASH_SQL_LITERAL}, 'OMS Protocol Canary', '${CANARY_DOMAIN}/${CANARY_LOCAL_PART}/', 0, '${CANARY_LOCAL_PART}', '${CANARY_DOMAIN}', 1, '', ${CANARY_ATTESTATION_SQL_LITERAL}, NOW(), NOW());
INSERT INTO alias
    (address, goto, domain, active, created, modified)
VALUES
    (${CANARY_USER_SQL_LITERAL}, ${CANARY_USER_SQL_LITERAL}, '${CANARY_DOMAIN}', 1, NOW(), NOW());
COMMIT;
SQL

atomic_replace_secret "${credential_tmp}" "${CREDENTIAL_FILE}"
atomic_replace_secret "${identity_tmp}" "${IDENTITY_FILE}"
ensure_required_file
PROVISION_COMPLETE=1

echo "Provisioned protocol canary mailbox: ${CANARY_USER}"
echo "Credential file: ${CREDENTIAL_FILE} (root:root 0600)"
echo "Identity file: ${IDENTITY_FILE} (root:root 0600)"
echo "Future guarded deployments will fail closed if the public protocol gate cannot run."

#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
readonly CANONICAL_PROJECT_ROOT="${PROJECT_ROOT}"
CONFIG_PATH="${1:-${PROJECT_ROOT}/config.conf}"
CREDENTIAL_FILE="${OMS_PROTOCOL_GATE_CREDENTIAL_FILE:-/etc/openmailstack/protocol-smoke.env}"
IDENTITY_FILE="${OMS_PROTOCOL_GATE_IDENTITY_FILE:-/etc/openmailstack/protocol-canary.identity}"
REQUIRED_FILE="${OMS_PROTOCOL_GATE_REQUIRED_FILE:-/etc/openmailstack/protocol-gate.required}"
INHERITED_PROTOCOL_GATE_RUN_ID="${OMS_PROTOCOL_GATE_RUN_ID:-}"
readonly INHERITED_PROTOCOL_GATE_RUN_ID
readonly CANONICAL_CONFIG_PATH="${CONFIG_PATH}"
readonly CANONICAL_CREDENTIAL_FILE="${CREDENTIAL_FILE}"
readonly CANONICAL_IDENTITY_FILE="${IDENTITY_FILE}"
readonly CANONICAL_REQUIRED_FILE="${REQUIRED_FILE}"
CLI_GATE_PROFILE=''
GATE_MODE='validate'

case "${2:-}" in
    '')
        [[ $# -le 1 ]] || {
            echo "FAIL: unsupported protocol gate arguments" >&2
            exit 1
        }
        ;;
    --profile)
        [[ $# -eq 3 && -n "${3:-}" ]] || {
            echo "FAIL: --profile requires exactly one value" >&2
            exit 1
        }
        CLI_GATE_PROFILE=${3}
        ;;
    --cleanup-suite-only)
        [[ $# -eq 2 ]] || {
            echo "FAIL: --cleanup-suite-only accepts no value" >&2
            exit 1
        }
        GATE_MODE='cleanup-suite-only'
        CLI_GATE_PROFILE='suite'
        ;;
    *)
        echo "FAIL: unsupported protocol gate argument: ${2}" >&2
        exit 1
        ;;
esac
readonly CLI_GATE_PROFILE GATE_MODE

fail() {
    echo "FAIL: $1" >&2
    exit 1
}

mysql_hex_literal() {
    local value=$1
    local hex
    hex=$(printf '%s' "${value}" | LC_ALL=C od -An -v -tx1 | tr -d '[:space:]')
    [[ -n "${hex}" ]] || fail "Cannot encode an empty MySQL cleanup identity"
    printf '0x%s' "${hex}"
}

validate_protocol_overrides() {
    local fixture_mode="${OMS_PROTOCOL_GATE_FIXTURE_MODE:-0}"
    local fixture_override=0
    local override_name

    case "${fixture_mode}" in
        0|1) ;;
        *) fail "OMS_PROTOCOL_GATE_FIXTURE_MODE must be 0 or 1" ;;
    esac
    for override_name in \
        OMS_PROTOCOL_GATE_SMOKE_SCRIPT \
        OMS_PROTOCOL_GATE_MAIL_SMOKE_SCRIPT \
        OMS_PROTOCOL_GATE_CONTACTS_SMOKE_SCRIPT \
        OMS_PROTOCOL_GATE_CALENDAR_SMOKE_SCRIPT \
        OMS_PROTOCOL_GATE_MYSQL_BIN \
        OMS_PROTOCOL_GATE_PIM_MARKER \
        OMS_PROTOCOL_GATE_PROFILE \
        OMS_SMOKE_POSTQUEUE_BIN \
        OMS_SMOKE_POSTCAT_BIN \
        OMS_SMOKE_POSTSUPER_BIN \
        OMS_SMOKE_MAIL_CLEANUP_QUIET_MS \
        OMS_SMOKE_MAIL_CLEANUP_DEADLINE_MS \
        OMS_SMOKE_MAIL_CLEANUP_POLL_MS \
        OMS_PROTOCOL_GATE_CLEANUP_QUIET_MS \
        OMS_PROTOCOL_GATE_CLEANUP_DEADLINE_MS \
        OMS_PROTOCOL_GATE_CLEANUP_POLL_MS \
        OMS_SMOKE_CLEANUP_ONLY \
        OMS_SMOKE_NETWORK_TIMEOUT_MS; do
        if [[ -n "${!override_name:-}" ]]; then
            fixture_override=1
        fi
    done
    if [[ "${fixture_override}" == "1" ]]; then
        [[ "${fixture_mode}" == "1" ]] \
            || fail "Protocol command overrides are fixture-only protocol overrides"
        [[ ! -e "${REQUIRED_FILE}" && ! -L "${REQUIRED_FILE}" ]] \
            || fail "The production sentinel rejects fixture-only protocol overrides"
    fi
    if [[ "${fixture_mode}" == "1" ]]; then
        [[ ! -e "${REQUIRED_FILE}" && ! -L "${REQUIRED_FILE}" ]] \
            || fail "The production sentinel rejects fixture-only protocol overrides"
    fi
}

validate_protocol_overrides

[[ -f "${CONFIG_PATH}" ]] || fail "OpenMailStack config file not found: ${CONFIG_PATH}"
[[ -f "${CREDENTIAL_FILE}" ]] || fail "Protocol canary credential file not found: ${CREDENTIAL_FILE}"
[[ ! -L "${CREDENTIAL_FILE}" ]] || fail "Protocol canary credential file must not be a symbolic link"
[[ -f "${IDENTITY_FILE}" ]] || fail "Protocol canary identity file not found: ${IDENTITY_FILE}"
[[ ! -L "${IDENTITY_FILE}" ]] || fail "Protocol canary identity file must not be a symbolic link"

credential_owner=$(stat -c '%u' "${CREDENTIAL_FILE}")
credential_mode=$(stat -c '%a' "${CREDENTIAL_FILE}")
if [[ "${credential_owner}" != "0" ]] || (( (8#${credential_mode} & 077) != 0 )); then
    fail "Protocol canary credential file must be root-owned and inaccessible to group or others"
fi
identity_owner=$(stat -c '%u' "${IDENTITY_FILE}")
identity_mode=$(stat -c '%a' "${IDENTITY_FILE}")
if [[ "${identity_owner}" != "0" ]] || (( (8#${identity_mode} & 077) != 0 )); then
    fail "Protocol canary identity file must be root-owned and inaccessible to group or others"
fi

# shellcheck source=/dev/null
source "${CONFIG_PATH}"
PROJECT_ROOT="${CANONICAL_PROJECT_ROOT}"
CONFIG_PATH="${CANONICAL_CONFIG_PATH}"
CREDENTIAL_FILE="${CANONICAL_CREDENTIAL_FILE}"
IDENTITY_FILE="${CANONICAL_IDENTITY_FILE}"
REQUIRED_FILE="${CANONICAL_REQUIRED_FILE}"
OMS_PROTOCOL_GATE_RUN_ID="${INHERITED_PROTOCOL_GATE_RUN_ID}"
export OMS_PROTOCOL_GATE_RUN_ID
validate_protocol_overrides
unset OMS_PROTOCOL_CANARY_USER OMS_PROTOCOL_CANARY_ATTESTATION
# shellcheck source=/dev/null
source "${IDENTITY_FILE}"
PROJECT_ROOT="${CANONICAL_PROJECT_ROOT}"
CONFIG_PATH="${CANONICAL_CONFIG_PATH}"
CREDENTIAL_FILE="${CANONICAL_CREDENTIAL_FILE}"
IDENTITY_FILE="${CANONICAL_IDENTITY_FILE}"
REQUIRED_FILE="${CANONICAL_REQUIRED_FILE}"
OMS_PROTOCOL_GATE_RUN_ID="${INHERITED_PROTOCOL_GATE_RUN_ID}"
export OMS_PROTOCOL_GATE_RUN_ID
validate_protocol_overrides
ATTESTED_CANARY_USER="${OMS_PROTOCOL_CANARY_USER:-}"
ATTESTED_CANARY_TOKEN="${OMS_PROTOCOL_CANARY_ATTESTATION:-}"
readonly ATTESTED_CANARY_USER ATTESTED_CANARY_TOKEN
unset OMS_PROTOCOL_CANARY_USER OMS_PROTOCOL_CANARY_ATTESTATION OMS_SMOKE_USER OMS_SMOKE_PASSWORD
# shellcheck source=/dev/null
source "${CREDENTIAL_FILE}"
PROJECT_ROOT="${CANONICAL_PROJECT_ROOT}"
CONFIG_PATH="${CANONICAL_CONFIG_PATH}"
CREDENTIAL_FILE="${CANONICAL_CREDENTIAL_FILE}"
IDENTITY_FILE="${CANONICAL_IDENTITY_FILE}"
REQUIRED_FILE="${CANONICAL_REQUIRED_FILE}"
OMS_PROTOCOL_GATE_RUN_ID="${INHERITED_PROTOCOL_GATE_RUN_ID}"
export OMS_PROTOCOL_GATE_RUN_ID
validate_protocol_overrides

MYSQL_BIN="${OMS_PROTOCOL_GATE_MYSQL_BIN:-mysql}"

[[ -n "${MAIL_HOSTNAME:-}" ]] || fail "MAIL_HOSTNAME is required in ${CONFIG_PATH}"
[[ "${MAIL_HOSTNAME}" =~ ^[A-Za-z0-9.-]+$ ]] || fail "MAIL_HOSTNAME contains unsupported characters"
[[ -n "${OMS_SMOKE_USER:-}" ]] || fail "OMS_SMOKE_USER is required in ${CREDENTIAL_FILE}"
[[ -n "${OMS_SMOKE_PASSWORD:-}" ]] || fail "OMS_SMOKE_PASSWORD is required in ${CREDENTIAL_FILE}"
SMOKE_USER_PATTERN=$'^[A-Za-z0-9.!#$%&\'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+$'
[[ "${OMS_SMOKE_USER}" =~ ${SMOKE_USER_PATTERN} ]] || fail "OMS_SMOKE_USER contains unsupported characters"
[[ "${ATTESTED_CANARY_USER}" =~ ${SMOKE_USER_PATTERN} ]] \
    || fail "Protocol canary identity contains an invalid mailbox"
[[ "${ATTESTED_CANARY_TOKEN}" =~ ^[0-9a-f]{64}$ ]] \
    || fail "Protocol canary identity contains an invalid attestation"
[[ "${OMS_PROTOCOL_CANARY_ATTESTATION:-}" =~ ^[0-9a-f]{64}$ ]] \
    || fail "Protocol canary credential contains an invalid attestation"
[[ "${OMS_SMOKE_USER}" == "${ATTESTED_CANARY_USER}"
    && "${OMS_PROTOCOL_CANARY_ATTESTATION}" == "${ATTESTED_CANARY_TOKEN}" ]] \
    || fail "Protocol smoke credential does not match the dedicated protocol canary identity"
[[ -n "${POSTFIXADMIN_DB_USER:-}" && -n "${POSTFIXADMIN_DB_PASSWORD:-}" && -n "${POSTFIXADMIN_DB_NAME:-}" ]] \
    || fail "PostfixAdmin database settings are required for synthetic ActiveSync state cleanup"
if [[ "${MYSQL_BIN}" == */* ]]; then
    [[ -x "${MYSQL_BIN}" ]] || fail "MySQL client is not executable: ${MYSQL_BIN}"
else
    MYSQL_BIN=$(command -v "${MYSQL_BIN}") || fail "MySQL client is not available: ${MYSQL_BIN}"
fi

SMOKE_USER_SQL_LITERAL=$(mysql_hex_literal "${OMS_SMOKE_USER}")
CANARY_ATTESTATION_MARKER="oms-protocol-canary:${ATTESTED_CANARY_TOKEN}"
CANARY_ATTESTATION_SQL_LITERAL=$(mysql_hex_literal "${CANARY_ATTESTATION_MARKER}")

verify_dedicated_canary_identity() {
    local attestation_output
    local attestation_status=0
    local attestation_line
    local attestation_label
    local dedicated_rows
    local mailbox_rows
    local self_alias_rows
    local attestation_extra

    attestation_output=$(MYSQL_PWD="${POSTFIXADMIN_DB_PASSWORD}" "${MYSQL_BIN}" \
        --batch \
        --skip-column-names \
        --protocol=TCP \
        --host=127.0.0.1 \
        --user="${POSTFIXADMIN_DB_USER}" \
        "${POSTFIXADMIN_DB_NAME}" 2>&1 <<SQL
SELECT 'OMS_PROTOCOL_GATE_CANARY_ATTESTATION',
    (SELECT COUNT(*) FROM mailbox
     WHERE username=${SMOKE_USER_SQL_LITERAL} AND active=1
       AND email_other=${CANARY_ATTESTATION_SQL_LITERAL}),
    (SELECT COUNT(*) FROM mailbox WHERE username=${SMOKE_USER_SQL_LITERAL}),
    (SELECT COUNT(*) FROM alias
     WHERE address=${SMOKE_USER_SQL_LITERAL} AND goto=${SMOKE_USER_SQL_LITERAL} AND active=1);
SQL
    ) || attestation_status=$?
    if (( attestation_status != 0 )); then
        fail "Could not verify the dedicated protocol canary database identity: ${attestation_output}"
    fi
    attestation_line=$(grep -F $'OMS_PROTOCOL_GATE_CANARY_ATTESTATION\t' \
        <<< "${attestation_output}" | tail -n 1 || true)
    IFS=$'\t' read -r attestation_label dedicated_rows mailbox_rows self_alias_rows \
        attestation_extra <<< "${attestation_line}"
    if [[ "${attestation_label}" != "OMS_PROTOCOL_GATE_CANARY_ATTESTATION"
        || -n "${attestation_extra}"
        || ! "${dedicated_rows}" =~ ^[0-9]+$
        || ! "${mailbox_rows}" =~ ^[0-9]+$
        || ! "${self_alias_rows}" =~ ^[0-9]+$
        || "${dedicated_rows}" != "1"
        || "${mailbox_rows}" != "1"
        || "${self_alias_rows}" != "1" ]]; then
        fail "Dedicated protocol canary database attestation is missing or ambiguous"
    fi
}

verify_dedicated_canary_identity

GATE_PROFILE="${CLI_GATE_PROFILE:-${OMS_PROTOCOL_GATE_PROFILE:-auto}}"
PIM_RUNTIME_MARKER="${OMS_PROTOCOL_GATE_PIM_MARKER:-/opt/openmailstack-backend/src/eas-pim-sync.js}"
case "${GATE_PROFILE}" in
    auto)
        if [[ -f "${PIM_RUNTIME_MARKER}" ]]; then
            GATE_PROFILE="suite"
        else
            GATE_PROFILE="mail"
        fi
        ;;
    mail|suite)
        ;;
    *)
        fail "Unsupported protocol gate profile: ${GATE_PROFILE}"
        ;;
esac
export OMS_SMOKE_PROTOCOL_PROFILE="${GATE_PROFILE}"

FIXTURE_MODE="${OMS_PROTOCOL_GATE_FIXTURE_MODE:-0}"
if [[ "${FIXTURE_MODE}" == "1" ]]; then
    DEFAULT_CLEANUP_QUIET_MS=20
    DEFAULT_CLEANUP_DEADLINE_MS=1000
    DEFAULT_CLEANUP_POLL_MS=10
else
    DEFAULT_CLEANUP_QUIET_MS=10000
    DEFAULT_CLEANUP_DEADLINE_MS=90000
    DEFAULT_CLEANUP_POLL_MS=1000
fi
CLEANUP_QUIET_MS="${OMS_PROTOCOL_GATE_CLEANUP_QUIET_MS:-${DEFAULT_CLEANUP_QUIET_MS}}"
CLEANUP_DEADLINE_MS="${OMS_PROTOCOL_GATE_CLEANUP_DEADLINE_MS:-${DEFAULT_CLEANUP_DEADLINE_MS}}"
CLEANUP_POLL_MS="${OMS_PROTOCOL_GATE_CLEANUP_POLL_MS:-${DEFAULT_CLEANUP_POLL_MS}}"
for cleanup_timing in "${CLEANUP_QUIET_MS}" "${CLEANUP_DEADLINE_MS}" "${CLEANUP_POLL_MS}"; do
    [[ "${cleanup_timing}" =~ ^[1-9][0-9]*$ ]] \
        || fail "Protocol cleanup timing values must be positive integers"
done
(( CLEANUP_QUIET_MS >= 10 && CLEANUP_QUIET_MS < CLEANUP_DEADLINE_MS \
    && CLEANUP_POLL_MS <= CLEANUP_QUIET_MS && CLEANUP_DEADLINE_MS <= 300000 )) \
    || fail "Protocol cleanup timing bounds are invalid"

MAIL_SMOKE_SCRIPT="${OMS_PROTOCOL_GATE_MAIL_SMOKE_SCRIPT:-${OMS_PROTOCOL_GATE_SMOKE_SCRIPT:-${PROJECT_ROOT}/tests/integration/activesync_mail_smoke.sh}}"
[[ -f "${MAIL_SMOKE_SCRIPT}" ]] \
    || fail "Authenticated mail cleanup script not found: ${MAIL_SMOKE_SCRIPT}"

if [[ "${GATE_MODE}" == "cleanup-suite-only" ]]; then
    SMOKE_SCRIPTS=()
elif [[ -n "${OMS_PROTOCOL_GATE_SMOKE_SCRIPT:-}" ]]; then
    # Backward-compatible single-script override for disposable gate tests.
    SMOKE_SCRIPTS=("${OMS_PROTOCOL_GATE_SMOKE_SCRIPT}")
elif [[ "${GATE_PROFILE}" == "mail" ]]; then
    SMOKE_SCRIPTS=(
        "${MAIL_SMOKE_SCRIPT}"
    )
else
    SMOKE_SCRIPTS=(
        "${MAIL_SMOKE_SCRIPT}"
        "${OMS_PROTOCOL_GATE_CONTACTS_SMOKE_SCRIPT:-${PROJECT_ROOT}/tests/integration/activesync_contacts_smoke.sh}"
        "${OMS_PROTOCOL_GATE_CALENDAR_SMOKE_SCRIPT:-${PROJECT_ROOT}/tests/integration/calendar_sync_smoke.sh}"
    )
fi
for smoke_script in "${SMOKE_SCRIPTS[@]}"; do
    [[ -f "${smoke_script}" ]] || fail "Authenticated protocol smoke script not found: ${smoke_script}"
done

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
PROTOCOL_GATE_RUN_ID="${OMS_PROTOCOL_GATE_RUN_ID:-$(openssl rand -hex 12)}"
[[ "${PROTOCOL_GATE_RUN_ID}" =~ ^[0-9a-f]{24}$ ]] \
    || fail "OMS_PROTOCOL_GATE_RUN_ID must contain exactly 24 lowercase hexadecimal characters"
OMS_SMOKE_DEVICE_ID="OMSPG${PROTOCOL_GATE_RUN_ID}"
export OMS_SMOKE_DEVICE_ID
OMS_SMOKE_CONTACT_RUN_ID=${OMS_SMOKE_DEVICE_ID,,}
export OMS_SMOKE_CONTACT_RUN_ID
OMS_SMOKE_CALENDAR_RUN_ID=${OMS_SMOKE_CONTACT_RUN_ID}
export OMS_SMOKE_CALENDAR_RUN_ID
CONTACT_SEED_UID="oms-eas-seed-${OMS_SMOKE_CONTACT_RUN_ID}"
CONTACT_SEED_EMAIL="oms-eas-seed-${OMS_SMOKE_CONTACT_RUN_ID}@example.invalid"
CONTACT_ADDED_EMAIL="oms-eas-added-${OMS_SMOKE_CONTACT_RUN_ID}@example.invalid"
CONTACT_CHANGED_EMAIL="oms-eas-changed-${OMS_SMOKE_CONTACT_RUN_ID}@example.invalid"
BIRTHDAY_CALENDAR_RUN_NAME="OMS Protocol Birthdays ${OMS_SMOKE_CONTACT_RUN_ID}"
CALENDAR_RUN_SLUG="oms-eas-calendar-${OMS_SMOKE_CALENDAR_RUN_ID}"
CALENDAR_RUN_NAME="OMS EAS Calendar ${OMS_SMOKE_CALENDAR_RUN_ID}"
SMOKE_DEVICE_SQL_LITERAL=$(mysql_hex_literal "${OMS_SMOKE_DEVICE_ID}")
CONTACT_SEED_UID_SQL_LITERAL=$(mysql_hex_literal "${CONTACT_SEED_UID}")
CONTACT_SEED_EMAIL_SQL_LITERAL=$(mysql_hex_literal "${CONTACT_SEED_EMAIL}")
CONTACT_ADDED_EMAIL_SQL_LITERAL=$(mysql_hex_literal "${CONTACT_ADDED_EMAIL}")
CONTACT_CHANGED_EMAIL_SQL_LITERAL=$(mysql_hex_literal "${CONTACT_CHANGED_EMAIL}")
BIRTHDAY_CALENDAR_RUN_NAME_SQL_LITERAL=$(mysql_hex_literal "${BIRTHDAY_CALENDAR_RUN_NAME}")
CALENDAR_RUN_SLUG_SQL_LITERAL=$(mysql_hex_literal "${CALENDAR_RUN_SLUG}")
CALENDAR_RUN_NAME_SQL_LITERAL=$(mysql_hex_literal "${CALENDAR_RUN_NAME}")
BIRTHDAY_CALENDAR_ID=''
BIRTHDAY_CALENDAR_CREATED=''
CONTACT_ADDED_DAV_UID=''

prepare_birthday_calendar() {
    local setup_output
    local setup_status=0
    local setup_line=''
    local setup_label=''
    local calendar_id=''
    local calendar_created=''
    local setup_extra=''

    setup_output=$(MYSQL_PWD="${POSTFIXADMIN_DB_PASSWORD}" "${MYSQL_BIN}" \
        --batch \
        --skip-column-names \
        --protocol=TCP \
        --host=127.0.0.1 \
        --user="${POSTFIXADMIN_DB_USER}" \
        "${POSTFIXADMIN_DB_NAME}" 2>&1 <<SQL
START TRANSACTION;
SET @oms_birthday_run_name = CONVERT(${BIRTHDAY_CALENDAR_RUN_NAME_SQL_LITERAL} USING utf8mb4);
SET @oms_birthday_calendar_id = NULL;
SELECT id INTO @oms_birthday_calendar_id
FROM calendars
WHERE user_id=${SMOKE_USER_SQL_LITERAL}
  AND dav_slug='birthdays'
ORDER BY id
LIMIT 1
FOR UPDATE;
SET @oms_birthday_calendar_created = IF(@oms_birthday_calendar_id IS NULL, 1, 0);
INSERT INTO calendars (user_id, name, dav_slug, color, components, subscribed_url, sync_token)
SELECT ${SMOKE_USER_SQL_LITERAL}, @oms_birthday_run_name, 'birthdays', '#e91e63', 'VEVENT', NULL, 0
FROM DUAL
WHERE @oms_birthday_calendar_created=1;
SET @oms_birthday_calendar_id = IF(
    @oms_birthday_calendar_created=1,
    LAST_INSERT_ID(),
    @oms_birthday_calendar_id
);
SELECT CONCAT_WS(CHAR(9), 'OMS_PROTOCOL_GATE_BIRTHDAY_CALENDAR',
    @oms_birthday_calendar_id, @oms_birthday_calendar_created)
FROM calendars
WHERE id=@oms_birthday_calendar_id
  AND user_id=${SMOKE_USER_SQL_LITERAL}
  AND dav_slug='birthdays';
COMMIT;
SQL
    ) || setup_status=$?
    setup_line=$(grep -F $'OMS_PROTOCOL_GATE_BIRTHDAY_CALENDAR\t' <<< "${setup_output}" | tail -n 1 || true)
    IFS=$'\t' read -r setup_label calendar_id calendar_created setup_extra <<< "${setup_line}"
    if [[ "${setup_label}" == "OMS_PROTOCOL_GATE_BIRTHDAY_CALENDAR"
        && -z "${setup_extra}"
        && "${calendar_id}" =~ ^[1-9][0-9]*$
        && "${calendar_created}" =~ ^[01]$ ]]; then
        BIRTHDAY_CALENDAR_ID=${calendar_id}
        BIRTHDAY_CALENDAR_CREATED=${calendar_created}
    fi
    if (( setup_status != 0 )); then
        echo "Synthetic Birthdays calendar preparation failed" >&2
        return "${setup_status}"
    fi
    if [[ "${setup_label}" != "OMS_PROTOCOL_GATE_BIRTHDAY_CALENDAR"
        || -n "${setup_extra}"
        || ! "${calendar_id}" =~ ^[1-9][0-9]*$
        || ! "${calendar_created}" =~ ^[01]$ ]]; then
        echo "Synthetic Birthdays calendar preparation returned no valid identity proof" >&2
        return 1
    fi
}

state_cleaned=0
CLEANUP_CHANGES_LAST=0
cleanup_device_state() {
    local cleanup_output
    local cleanup_status=0
    local residue_line=''
    local residue_label=''
    local contact_active=''
    local contact_deleted=''
    local contact_tombstones=''
    local birthday_events=''
    local birthday_tombstones=''
    local birthday_calendar=''
    local calendar_events=''
    local calendar_tombstones=''
    local calendar_shares=''
    local calendar_rows=''
    local mail_states=''
    local pim_states=''
    local webmail_sessions=''
    local cleanup_changes=''
    local residue_extra=''
    local birthday_calendar_id_sql='NULL'
    local birthday_calendar_created_sql='0'
    local contact_added_dav_uid_sql_literal='NULL'
    if [[ "${BIRTHDAY_CALENDAR_ID}" =~ ^[1-9][0-9]*$
        && "${BIRTHDAY_CALENDAR_CREATED}" =~ ^[01]$ ]]; then
        birthday_calendar_id_sql=${BIRTHDAY_CALENDAR_ID}
        birthday_calendar_created_sql=${BIRTHDAY_CALENDAR_CREATED}
    fi
    if [[ "${CONTACT_ADDED_DAV_UID}" =~ ^[A-Za-z0-9._~-]{1,255}$ ]]; then
        contact_added_dav_uid_sql_literal=$(mysql_hex_literal "${CONTACT_ADDED_DAV_UID}")
    fi
    if [[ "${GATE_PROFILE}" == "suite" ]]; then
        cleanup_output=$(MYSQL_PWD="${POSTFIXADMIN_DB_PASSWORD}" "${MYSQL_BIN}" \
            --batch \
            --skip-column-names \
            --protocol=TCP \
            --host=127.0.0.1 \
            --user="${POSTFIXADMIN_DB_USER}" \
            "${POSTFIXADMIN_DB_NAME}" 2>&1 <<SQL
START TRANSACTION;
SET @oms_cleanup_changes = 0;
SET @oms_birthday_run_name = CONVERT(${BIRTHDAY_CALENDAR_RUN_NAME_SQL_LITERAL} USING utf8mb4);
SET @oms_birthday_identity_proven = IF(${birthday_calendar_id_sql} IS NULL, 0, 1);
SET @oms_birthday_calendar_id = ${birthday_calendar_id_sql};
SET @oms_birthday_calendar_created = ${birthday_calendar_created_sql};
SELECT COUNT(*), MIN(id)
INTO @oms_birthday_marker_rows, @oms_birthday_marker_calendar_id
FROM calendars
WHERE user_id=${SMOKE_USER_SQL_LITERAL}
  AND dav_slug='birthdays'
  AND name=@oms_birthday_run_name;
SET @oms_birthday_calendar_id = IF(
    @oms_birthday_identity_proven=1,
    @oms_birthday_calendar_id,
    IF(@oms_birthday_marker_rows=1, @oms_birthday_marker_calendar_id, NULL)
);
SET @oms_birthday_calendar_created = IF(
    @oms_birthday_identity_proven=1,
    @oms_birthday_calendar_created,
    IF(@oms_birthday_marker_rows=1, 1, 0)
);
SET @oms_birthday_identity_proven = IF(
    @oms_birthday_identity_proven=1 OR @oms_birthday_marker_rows=1,
    1,
    0
);
CREATE TEMPORARY TABLE oms_protocol_calendar_targets (
    calendar_id BIGINT NOT NULL PRIMARY KEY
) ENGINE=MEMORY;
INSERT IGNORE INTO oms_protocol_calendar_targets (calendar_id)
SELECT id
FROM calendars
WHERE user_id=${SMOKE_USER_SQL_LITERAL}
  AND name=CONVERT(${CALENDAR_RUN_NAME_SQL_LITERAL} USING utf8mb4)
  AND dav_slug=CONVERT(${CALENDAR_RUN_SLUG_SQL_LITERAL} USING utf8mb4)
  AND subscribed_url IS NULL;
CREATE TEMPORARY TABLE oms_protocol_contact_targets (
    contact_id BIGINT NULL,
    dav_uid VARCHAR(255) NOT NULL PRIMARY KEY,
    birthday_uid VARCHAR(255) NOT NULL,
    UNIQUE KEY oms_protocol_contact_id (contact_id)
) ENGINE=MEMORY;
INSERT IGNORE INTO oms_protocol_contact_targets (contact_id, dav_uid, birthday_uid)
SELECT id,
       dav_uid,
       CONCAT(
           'birthday-',
           LEFT(SHA2(CONCAT(
               LOWER(TRIM(CONVERT(${SMOKE_USER_SQL_LITERAL} USING utf8mb4))),
               CHAR(0),
               dav_uid
           ), 256), 48),
           '@openmailstack'
       )
FROM contacts
WHERE username=${SMOKE_USER_SQL_LITERAL}
  AND (
      email IN (${CONTACT_SEED_EMAIL_SQL_LITERAL}, ${CONTACT_ADDED_EMAIL_SQL_LITERAL}, ${CONTACT_CHANGED_EMAIL_SQL_LITERAL})
      OR dav_uid=${CONTACT_SEED_UID_SQL_LITERAL}
      OR (${contact_added_dav_uid_sql_literal} IS NOT NULL AND dav_uid=${contact_added_dav_uid_sql_literal})
  );
INSERT IGNORE INTO oms_protocol_contact_targets (contact_id, dav_uid, birthday_uid)
VALUES (
    NULL,
    ${CONTACT_SEED_UID_SQL_LITERAL},
    CONCAT(
        'birthday-',
        LEFT(SHA2(CONCAT(
            LOWER(TRIM(CONVERT(${SMOKE_USER_SQL_LITERAL} USING utf8mb4))),
            CHAR(0),
            CONVERT(${CONTACT_SEED_UID_SQL_LITERAL} USING utf8mb4)
        ), 256), 48),
        '@openmailstack'
    )
);
INSERT IGNORE INTO oms_protocol_contact_targets (contact_id, dav_uid, birthday_uid)
SELECT NULL,
       CONVERT(${contact_added_dav_uid_sql_literal} USING utf8mb4),
       CONCAT(
           'birthday-',
           LEFT(SHA2(CONCAT(
               LOWER(TRIM(CONVERT(${SMOKE_USER_SQL_LITERAL} USING utf8mb4))),
               CHAR(0),
               CONVERT(${contact_added_dav_uid_sql_literal} USING utf8mb4)
           ), 256), 48),
           '@openmailstack'
       )
FROM DUAL
WHERE ${contact_added_dav_uid_sql_literal} IS NOT NULL;
CREATE TEMPORARY TABLE oms_protocol_birthday_targets (
    calendar_id BIGINT NOT NULL,
    uid VARCHAR(255) NOT NULL,
    PRIMARY KEY (calendar_id, uid)
) ENGINE=MEMORY;
INSERT IGNORE INTO oms_protocol_birthday_targets (calendar_id, uid)
SELECT calendars.id, targets.birthday_uid
FROM calendars
CROSS JOIN oms_protocol_contact_targets AS targets
WHERE calendars.user_id=${SMOKE_USER_SQL_LITERAL}
  AND calendars.dav_slug='birthdays';
CREATE TEMPORARY TABLE oms_protocol_birthday_changed_calendars (
    calendar_id BIGINT NOT NULL PRIMARY KEY
) ENGINE=MEMORY;
INSERT IGNORE INTO oms_protocol_birthday_changed_calendars (calendar_id)
SELECT birthday_events.calendar_id
FROM events AS birthday_events
JOIN oms_protocol_birthday_targets AS targets
  ON targets.calendar_id=birthday_events.calendar_id AND targets.uid=birthday_events.uid;
INSERT IGNORE INTO oms_protocol_birthday_changed_calendars (calendar_id)
SELECT birthday_tombstones.calendar_id
FROM calendar_tombstones AS birthday_tombstones
JOIN oms_protocol_birthday_targets AS targets
  ON targets.calendar_id=birthday_tombstones.calendar_id AND targets.uid=birthday_tombstones.uid;
DELETE gate_shares
FROM calendar_shares AS gate_shares
JOIN oms_protocol_calendar_targets AS targets ON targets.calendar_id=gate_shares.calendar_id;
SET @oms_cleanup_changes = @oms_cleanup_changes + ROW_COUNT();
DELETE gate_events
FROM events AS gate_events
JOIN oms_protocol_calendar_targets AS targets ON targets.calendar_id=gate_events.calendar_id;
SET @oms_cleanup_changes = @oms_cleanup_changes + ROW_COUNT();
DELETE gate_tombstones
FROM calendar_tombstones AS gate_tombstones
JOIN oms_protocol_calendar_targets AS targets ON targets.calendar_id=gate_tombstones.calendar_id;
SET @oms_cleanup_changes = @oms_cleanup_changes + ROW_COUNT();
DELETE calendar_rows
FROM calendars AS calendar_rows
JOIN oms_protocol_calendar_targets AS targets ON targets.calendar_id=calendar_rows.id
WHERE calendar_rows.user_id=${SMOKE_USER_SQL_LITERAL}
  AND calendar_rows.name=CONVERT(${CALENDAR_RUN_NAME_SQL_LITERAL} USING utf8mb4)
  AND calendar_rows.dav_slug=CONVERT(${CALENDAR_RUN_SLUG_SQL_LITERAL} USING utf8mb4)
  AND calendar_rows.subscribed_url IS NULL;
SET @oms_cleanup_changes = @oms_cleanup_changes + ROW_COUNT();
DELETE members
FROM contact_group_members AS members
JOIN oms_protocol_contact_targets AS targets ON targets.contact_id=members.contact_id;
SET @oms_cleanup_changes = @oms_cleanup_changes + ROW_COUNT();
DELETE tombstones
FROM contact_tombstones AS tombstones
JOIN oms_protocol_contact_targets AS targets
  ON targets.dav_uid=tombstones.dav_uid
WHERE tombstones.username=${SMOKE_USER_SQL_LITERAL};
SET @oms_cleanup_changes = @oms_cleanup_changes + ROW_COUNT();
DELETE contacts
FROM contacts
JOIN oms_protocol_contact_targets AS targets ON targets.contact_id=contacts.id
WHERE contacts.username=${SMOKE_USER_SQL_LITERAL};
SET @oms_cleanup_changes = @oms_cleanup_changes + ROW_COUNT();
DELETE birthday_events
FROM events AS birthday_events
JOIN oms_protocol_birthday_targets AS targets
  ON targets.calendar_id=birthday_events.calendar_id AND targets.uid=birthday_events.uid;
SET @oms_cleanup_changes = @oms_cleanup_changes + ROW_COUNT();
DELETE birthday_tombstones
FROM calendar_tombstones AS birthday_tombstones
JOIN oms_protocol_birthday_targets AS targets
  ON targets.calendar_id=birthday_tombstones.calendar_id AND targets.uid=birthday_tombstones.uid;
SET @oms_cleanup_changes = @oms_cleanup_changes + ROW_COUNT();
UPDATE calendars
JOIN oms_protocol_birthday_changed_calendars AS changed
  ON changed.calendar_id=calendars.id
SET calendars.sync_token = calendars.sync_token + 1;
SET @oms_cleanup_changes = @oms_cleanup_changes + ROW_COUNT();
DELETE gate_calendar
FROM calendars AS gate_calendar
WHERE gate_calendar.id=@oms_birthday_calendar_id
  AND gate_calendar.user_id=${SMOKE_USER_SQL_LITERAL}
  AND gate_calendar.dav_slug='birthdays'
  AND gate_calendar.name=@oms_birthday_run_name
  AND @oms_birthday_identity_proven=1
  AND @oms_birthday_calendar_created=1
  AND NOT EXISTS (
      SELECT 1 FROM events
      WHERE events.calendar_id=gate_calendar.id
  )
  AND NOT EXISTS (
      SELECT 1 FROM calendar_tombstones
      WHERE calendar_tombstones.calendar_id=gate_calendar.id
  )
  AND NOT EXISTS (
      SELECT 1 FROM calendar_shares
      WHERE calendar_shares.calendar_id=gate_calendar.id
  );
SET @oms_cleanup_changes = @oms_cleanup_changes + ROW_COUNT();
DELETE FROM eas_mail_sync_states
WHERE username=${SMOKE_USER_SQL_LITERAL} AND device_id=${SMOKE_DEVICE_SQL_LITERAL};
SET @oms_cleanup_changes = @oms_cleanup_changes + ROW_COUNT();
SET @oms_has_pim_states = EXISTS(
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = DATABASE() AND table_name = 'eas_pim_sync_states'
    );
SET @oms_pim_cleanup = IF(
    @oms_has_pim_states,
    'DELETE FROM eas_pim_sync_states WHERE username=${SMOKE_USER_SQL_LITERAL} AND device_id=${SMOKE_DEVICE_SQL_LITERAL}',
    'SELECT 1'
);
PREPARE oms_pim_cleanup_statement FROM @oms_pim_cleanup;
EXECUTE oms_pim_cleanup_statement;
SET @oms_cleanup_changes = @oms_cleanup_changes + IF(@oms_has_pim_states, GREATEST(ROW_COUNT(), 0), 0);
DEALLOCATE PREPARE oms_pim_cleanup_statement;
SET @oms_has_webmail_sessions = EXISTS(
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = DATABASE() AND table_name = 'webmail_sessions'
);
SET @oms_session_cleanup = IF(
    @oms_has_webmail_sessions,
    'DELETE FROM webmail_sessions WHERE username=${SMOKE_USER_SQL_LITERAL}',
    'SELECT 1'
);
PREPARE oms_session_cleanup_statement FROM @oms_session_cleanup;
EXECUTE oms_session_cleanup_statement;
SET @oms_cleanup_changes = @oms_cleanup_changes + IF(@oms_has_webmail_sessions, GREATEST(ROW_COUNT(), 0), 0);
DEALLOCATE PREPARE oms_session_cleanup_statement;
SELECT COUNT(*) INTO @oms_contact_active
FROM contacts
WHERE username=${SMOKE_USER_SQL_LITERAL}
  AND deleted_at IS NULL
  AND (email IN (${CONTACT_SEED_EMAIL_SQL_LITERAL}, ${CONTACT_ADDED_EMAIL_SQL_LITERAL}, ${CONTACT_CHANGED_EMAIL_SQL_LITERAL})
       OR dav_uid=${CONTACT_SEED_UID_SQL_LITERAL}
       OR (${contact_added_dav_uid_sql_literal} IS NOT NULL AND dav_uid=${contact_added_dav_uid_sql_literal}));
SELECT COUNT(*) INTO @oms_contact_deleted
FROM contacts
WHERE username=${SMOKE_USER_SQL_LITERAL}
  AND deleted_at IS NOT NULL
  AND (email IN (${CONTACT_SEED_EMAIL_SQL_LITERAL}, ${CONTACT_ADDED_EMAIL_SQL_LITERAL}, ${CONTACT_CHANGED_EMAIL_SQL_LITERAL})
       OR dav_uid=${CONTACT_SEED_UID_SQL_LITERAL}
       OR (${contact_added_dav_uid_sql_literal} IS NOT NULL AND dav_uid=${contact_added_dav_uid_sql_literal}));
SELECT COUNT(*) INTO @oms_contact_tombstones
FROM contact_tombstones AS tombstones
JOIN oms_protocol_contact_targets AS targets ON targets.dav_uid=tombstones.dav_uid
WHERE tombstones.username=${SMOKE_USER_SQL_LITERAL};
SELECT COUNT(*) INTO @oms_birthday_events
FROM events AS birthday_events
JOIN oms_protocol_birthday_targets AS targets
  ON targets.calendar_id=birthday_events.calendar_id AND targets.uid=birthday_events.uid;
SELECT COUNT(*) INTO @oms_birthday_tombstones
FROM calendar_tombstones AS birthday_tombstones
JOIN oms_protocol_birthday_targets AS targets
  ON targets.calendar_id=birthday_tombstones.calendar_id AND targets.uid=birthday_tombstones.uid;
SELECT COUNT(*) INTO @oms_birthday_exact_calendar_rows
FROM calendars
WHERE id=@oms_birthday_calendar_id
  AND user_id=${SMOKE_USER_SQL_LITERAL}
  AND dav_slug='birthdays';
SET @oms_birthday_calendar_rows = IF(
    @oms_birthday_identity_proven=1 AND @oms_birthday_calendar_created=1,
    @oms_birthday_exact_calendar_rows,
    0
);
SELECT COUNT(*) INTO @oms_calendar_events
FROM events AS gate_events
JOIN oms_protocol_calendar_targets AS targets ON targets.calendar_id=gate_events.calendar_id;
SELECT COUNT(*) INTO @oms_calendar_tombstones
FROM calendar_tombstones AS gate_tombstones
JOIN oms_protocol_calendar_targets AS targets ON targets.calendar_id=gate_tombstones.calendar_id;
SELECT COUNT(*) INTO @oms_calendar_shares
FROM calendar_shares AS gate_shares
JOIN oms_protocol_calendar_targets AS targets ON targets.calendar_id=gate_shares.calendar_id;
SELECT COUNT(*) INTO @oms_calendar_rows
FROM calendars AS calendar_rows
JOIN oms_protocol_calendar_targets AS targets ON targets.calendar_id=calendar_rows.id;
SELECT COUNT(*) INTO @oms_mail_states
FROM eas_mail_sync_states
WHERE username=${SMOKE_USER_SQL_LITERAL} AND device_id=${SMOKE_DEVICE_SQL_LITERAL};
SET @oms_pim_states = 0;
SET @oms_pim_count = IF(
    EXISTS(
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = DATABASE() AND table_name = 'eas_pim_sync_states'
    ),
    'SELECT COUNT(*) INTO @oms_pim_states FROM eas_pim_sync_states WHERE username=${SMOKE_USER_SQL_LITERAL} AND device_id=${SMOKE_DEVICE_SQL_LITERAL}',
    'SET @oms_pim_states = 0'
);
PREPARE oms_pim_count_statement FROM @oms_pim_count;
EXECUTE oms_pim_count_statement;
DEALLOCATE PREPARE oms_pim_count_statement;
SET @oms_webmail_sessions = 0;
SET @oms_session_count = IF(
    @oms_has_webmail_sessions,
    'SELECT COUNT(*) INTO @oms_webmail_sessions FROM webmail_sessions WHERE username=${SMOKE_USER_SQL_LITERAL}',
    'SET @oms_webmail_sessions = 0'
);
PREPARE oms_session_count_statement FROM @oms_session_count;
EXECUTE oms_session_count_statement;
DEALLOCATE PREPARE oms_session_count_statement;
DROP TEMPORARY TABLE oms_protocol_birthday_changed_calendars;
DROP TEMPORARY TABLE oms_protocol_birthday_targets;
DROP TEMPORARY TABLE oms_protocol_contact_targets;
DROP TEMPORARY TABLE oms_protocol_calendar_targets;
COMMIT;
SELECT CONCAT_WS(CHAR(9), 'OMS_PROTOCOL_GATE_RESIDUE', @oms_contact_active,
    @oms_contact_deleted, @oms_contact_tombstones, @oms_birthday_events,
    @oms_birthday_tombstones, @oms_birthday_calendar_rows, @oms_calendar_events,
    @oms_calendar_tombstones, @oms_calendar_shares, @oms_calendar_rows,
    @oms_mail_states, @oms_pim_states, @oms_webmail_sessions, @oms_cleanup_changes);
SQL
        ) || cleanup_status=$?
    else
        cleanup_output=$(MYSQL_PWD="${POSTFIXADMIN_DB_PASSWORD}" "${MYSQL_BIN}" \
            --batch \
            --skip-column-names \
            --protocol=TCP \
            --host=127.0.0.1 \
            --user="${POSTFIXADMIN_DB_USER}" \
            "${POSTFIXADMIN_DB_NAME}" 2>&1 <<SQL
START TRANSACTION;
SET @oms_cleanup_changes = 0;
DELETE FROM eas_mail_sync_states
WHERE username=${SMOKE_USER_SQL_LITERAL} AND device_id=${SMOKE_DEVICE_SQL_LITERAL};
SET @oms_cleanup_changes = @oms_cleanup_changes + ROW_COUNT();
SET @oms_has_pim_states = EXISTS(
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = DATABASE() AND table_name = 'eas_pim_sync_states'
    );
SET @oms_pim_cleanup = IF(
    @oms_has_pim_states,
    'DELETE FROM eas_pim_sync_states WHERE username=${SMOKE_USER_SQL_LITERAL} AND device_id=${SMOKE_DEVICE_SQL_LITERAL}',
    'SELECT 1'
);
PREPARE oms_pim_cleanup_statement FROM @oms_pim_cleanup;
EXECUTE oms_pim_cleanup_statement;
SET @oms_cleanup_changes = @oms_cleanup_changes + IF(@oms_has_pim_states, GREATEST(ROW_COUNT(), 0), 0);
DEALLOCATE PREPARE oms_pim_cleanup_statement;
SET @oms_has_webmail_sessions = EXISTS(
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = DATABASE() AND table_name = 'webmail_sessions'
);
SET @oms_session_cleanup = IF(
    @oms_has_webmail_sessions,
    'DELETE FROM webmail_sessions WHERE username=${SMOKE_USER_SQL_LITERAL}',
    'SELECT 1'
);
PREPARE oms_session_cleanup_statement FROM @oms_session_cleanup;
EXECUTE oms_session_cleanup_statement;
SET @oms_cleanup_changes = @oms_cleanup_changes + IF(@oms_has_webmail_sessions, GREATEST(ROW_COUNT(), 0), 0);
DEALLOCATE PREPARE oms_session_cleanup_statement;
SELECT COUNT(*) INTO @oms_mail_states
FROM eas_mail_sync_states
WHERE username=${SMOKE_USER_SQL_LITERAL} AND device_id=${SMOKE_DEVICE_SQL_LITERAL};
SET @oms_pim_states = 0;
SET @oms_pim_count = IF(
    EXISTS(
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = DATABASE() AND table_name = 'eas_pim_sync_states'
    ),
    'SELECT COUNT(*) INTO @oms_pim_states FROM eas_pim_sync_states WHERE username=${SMOKE_USER_SQL_LITERAL} AND device_id=${SMOKE_DEVICE_SQL_LITERAL}',
    'SET @oms_pim_states = 0'
);
PREPARE oms_pim_count_statement FROM @oms_pim_count;
EXECUTE oms_pim_count_statement;
DEALLOCATE PREPARE oms_pim_count_statement;
SET @oms_webmail_sessions = 0;
SET @oms_session_count = IF(
    @oms_has_webmail_sessions,
    'SELECT COUNT(*) INTO @oms_webmail_sessions FROM webmail_sessions WHERE username=${SMOKE_USER_SQL_LITERAL}',
    'SET @oms_webmail_sessions = 0'
);
PREPARE oms_session_count_statement FROM @oms_session_count;
EXECUTE oms_session_count_statement;
DEALLOCATE PREPARE oms_session_count_statement;
COMMIT;
SELECT CONCAT_WS(CHAR(9), 'OMS_PROTOCOL_GATE_RESIDUE', 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, @oms_mail_states, @oms_pim_states, @oms_webmail_sessions,
    @oms_cleanup_changes);
SQL
        ) || cleanup_status=$?
    fi
    if (( cleanup_status != 0 )); then
        echo "Synthetic ActiveSync state cleanup failed: ${cleanup_output}" >&2
        return "${cleanup_status}"
    fi
    residue_line=$(grep -F $'OMS_PROTOCOL_GATE_RESIDUE\t' <<< "${cleanup_output}" | tail -n 1 || true)
    IFS=$'\t' read -r residue_label contact_active contact_deleted contact_tombstones \
        birthday_events birthday_tombstones birthday_calendar calendar_events calendar_tombstones \
        calendar_shares calendar_rows mail_states pim_states webmail_sessions cleanup_changes \
        residue_extra <<< "${residue_line}"
    if [[ "${residue_label}" != "OMS_PROTOCOL_GATE_RESIDUE"
        || -n "${residue_extra}"
        || ! "${contact_active}" =~ ^[0-9]+$
        || ! "${contact_deleted}" =~ ^[0-9]+$
        || ! "${contact_tombstones}" =~ ^[0-9]+$
        || ! "${birthday_events}" =~ ^[0-9]+$
        || ! "${birthday_tombstones}" =~ ^[0-9]+$
        || ! "${birthday_calendar}" =~ ^[0-9]+$
        || ! "${calendar_events}" =~ ^[0-9]+$
        || ! "${calendar_tombstones}" =~ ^[0-9]+$
        || ! "${calendar_shares}" =~ ^[0-9]+$
        || ! "${calendar_rows}" =~ ^[0-9]+$
        || ! "${mail_states}" =~ ^[0-9]+$
        || ! "${pim_states}" =~ ^[0-9]+$
        || ! "${webmail_sessions}" =~ ^[0-9]+$
        || ! "${cleanup_changes}" =~ ^[0-9]+$ ]]; then
        echo "Synthetic protocol canary cleanup returned no valid residue proof" >&2
        return 1
    fi
    if (( contact_active != 0 || contact_deleted != 0 || contact_tombstones != 0 \
        || birthday_events != 0 || birthday_tombstones != 0 || birthday_calendar != 0 \
        || calendar_events != 0 || calendar_tombstones != 0 || calendar_shares != 0 \
        || calendar_rows != 0 \
        || mail_states != 0 || pim_states != 0 || webmail_sessions != 0 )); then
        echo "Synthetic protocol canary cleanup left residue: active=${contact_active}, deleted=${contact_deleted}, tombstones=${contact_tombstones}, birthday_events=${birthday_events}, birthday_tombstones=${birthday_tombstones}, birthday_calendar=${birthday_calendar}, calendar_events=${calendar_events}, calendar_tombstones=${calendar_tombstones}, calendar_shares=${calendar_shares}, calendar_rows=${calendar_rows}, mail_states=${mail_states}, pim_states=${pim_states}, webmail_sessions=${webmail_sessions}" >&2
        return 1
    fi
    CLEANUP_CHANGES_LAST=${cleanup_changes}
}

protocol_now_ms() {
    date +%s%3N
}

protocol_sleep_ms() {
    local milliseconds="$1"
    local delay
    printf -v delay '%d.%03d' "$((milliseconds / 1000))" "$((milliseconds % 1000))"
    sleep "${delay}"
}

reconcile_device_state_cleanup() {
    local started_at
    local quiet_since
    local checked_at
    local elapsed
    local remaining
    local sleep_for
    local proof_observed=0

    if [[ "${state_cleaned}" == "1" ]]; then
        return 0
    fi
    started_at=$(protocol_now_ms)
    quiet_since=${started_at}
    while true; do
        cleanup_device_state || return 1
        checked_at=$(protocol_now_ms)
        if (( CLEANUP_CHANGES_LAST > 0 || proof_observed == 0 )); then
            quiet_since=${checked_at}
            proof_observed=1
        elif (( checked_at - quiet_since >= CLEANUP_QUIET_MS )); then
            state_cleaned=1
            return 0
        fi
        elapsed=$((checked_at - started_at))
        if (( elapsed >= CLEANUP_DEADLINE_MS )); then
            echo "Synthetic protocol canary cleanup did not reach a bounded quiet window" >&2
            return 1
        fi
        remaining=$((CLEANUP_DEADLINE_MS - elapsed))
        sleep_for=${CLEANUP_POLL_MS}
        if (( sleep_for > remaining )); then
            sleep_for=${remaining}
        fi
        protocol_sleep_ms "${sleep_for}"
    done
}

cleanup_on_exit() {
    local exit_status=$?
    trap - EXIT
    if ! reconcile_device_state_cleanup; then
        echo "WARN: cleanup failed: could not remove the synthetic ActiveSync partnership" >&2
        if (( exit_status == 0 )); then
            exit_status=1
        fi
    fi
    exit "${exit_status}"
}
trap cleanup_on_exit EXIT

if ! reconcile_device_state_cleanup; then
    fail "Could not clear a prior synthetic protocol canary run"
fi

if [[ "${GATE_MODE}" == "cleanup-suite-only" ]]; then
    set +e
    mail_cleanup_output=$(OMS_SMOKE_CLEANUP_ONLY=1 bash "${MAIL_SMOKE_SCRIPT}" 2>&1)
    mail_cleanup_status=$?
    set -e
    printf '%s\n' "${mail_cleanup_output}"
    (( mail_cleanup_status == 0 )) \
        || fail "Authenticated mail and Postfix cleanup failed with exit ${mail_cleanup_status}"
    grep -Eq '^PASS:' <<< "${mail_cleanup_output}" \
        || fail "Authenticated mail and Postfix cleanup returned no PASS marker"
    if grep -Eq '^SKIP:' <<< "${mail_cleanup_output}"; then
        fail "Authenticated mail and Postfix cleanup attempted to skip"
    fi
    if grep -Eq '^WARN: (cleanup|session cleanup) failed:' <<< "${mail_cleanup_output}"; then
        fail "Authenticated mail and Postfix cleanup reported incomplete cleanup"
    fi
    state_cleaned=0
    reconcile_device_state_cleanup \
        || fail "Could not prove database and session cleanup after mail reconciliation"
    trap - EXIT
    echo "PASS: protocol release gate removed and proved zero database, EAS/PIM, mailbox, Postfix, and web-session canary residue"
    exit 0
fi

state_cleaned=0

if [[ "${GATE_PROFILE}" == "suite" ]] && ! prepare_birthday_calendar; then
    fail "Could not prepare the synthetic Birthdays calendar"
fi

smoke_output=''
smoke_status=0
smoke_without_pass=''

capture_contact_cleanup_identity() {
    local output=$1
    local identity_lines=()
    local identity_label=''
    local dav_uid=''
    local identity_extra=''
    mapfile -t identity_lines < <(grep -F $'OMS_PROTOCOL_GATE_CONTACT_DAV_UID\t' <<< "${output}" || true)
    if (( ${#identity_lines[@]} == 0 )); then
        return 0
    fi
    if (( ${#identity_lines[@]} != 1 )) || [[ -n "${CONTACT_ADDED_DAV_UID}" ]]; then
        echo "Authenticated Contacts smoke returned duplicate cleanup identities" >&2
        return 1
    fi
    IFS=$'\t' read -r identity_label dav_uid identity_extra <<< "${identity_lines[0]}"
    if [[ "${identity_label}" != "OMS_PROTOCOL_GATE_CONTACT_DAV_UID"
        || -n "${identity_extra}"
        || ! "${dav_uid}" =~ ^[A-Za-z0-9._~-]{1,255}$ ]]; then
        echo "Authenticated Contacts smoke returned an invalid cleanup identity" >&2
        return 1
    fi
    CONTACT_ADDED_DAV_UID=${dav_uid}
}

for smoke_script in "${SMOKE_SCRIPTS[@]}"; do
    set +e
    current_smoke_output=$(bash "${smoke_script}" 2>&1)
    current_smoke_status=$?
    set -e
    if [[ -n "${smoke_output}" && -n "${current_smoke_output}" ]]; then
        smoke_output+=$'\n'
    fi
    smoke_output+="${current_smoke_output}"
    if ! capture_contact_cleanup_identity "${current_smoke_output}"; then
        smoke_status=1
        break
    fi
    if (( current_smoke_status != 0 )); then
        smoke_status=${current_smoke_status}
        break
    fi
    if ! grep -Eq '^PASS:' <<< "${current_smoke_output}"; then
        smoke_without_pass=${smoke_script##*/}
        break
    fi
done

printf '%s\n' "${smoke_output}"
if ! reconcile_device_state_cleanup; then
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
if [[ -n "${smoke_without_pass}" ]]; then
    fail "Authenticated protocol smoke returned no PASS marker: ${smoke_without_pass}"
fi
if [[ "${GATE_PROFILE}" == "suite" ]]; then
    echo "PASS: protocol release gate completed (public IMAPS and ActiveSync mail, contacts, and calendar)"
else
    echo "PASS: protocol release gate completed (public IMAPS and ActiveSync mail)"
fi

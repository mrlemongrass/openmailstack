#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
GATE_SCRIPT="${PROJECT_ROOT}/tests/integration/protocol_release_gate.sh"

TEST_ROOT=$(mktemp -d)
trap 'rm -rf "${TEST_ROOT}"' EXIT
export OMS_PROTOCOL_GATE_FIXTURE_MODE=1
export OMS_PROTOCOL_GATE_REQUIRED_FILE="${TEST_ROOT}/fixture-no-sentinel"

CONFIG_PATH="${TEST_ROOT}/config.conf"
OUTPUT_PATH="${TEST_ROOT}/output.log"
CLEANUP_LOG="${TEST_ROOT}/cleanup.sql"
ORDER_LOG="${TEST_ROOT}/order.log"
MYSQL_PATH="${TEST_ROOT}/mysql"

cat > "${CONFIG_PATH}" <<'EOF'
MAIL_HOSTNAME="mail.example.test"
POSTFIXADMIN_DB_USER="test-user"
POSTFIXADMIN_DB_PASSWORD="test-password"
POSTFIXADMIN_DB_NAME="test-db"
EOF

cat > "${MYSQL_PATH}" <<'EOF'
#!/usr/bin/env bash
sql=$(cat)
{
    printf '%s\n' 'OMS_PROTOCOL_GATE_MYSQL_INVOCATION_BEGIN'
    printf '%s\n' "${sql}"
} >> "${OMS_PROTOCOL_GATE_CLEANUP_LOG}"

if grep -Fq "'OMS_PROTOCOL_GATE_CANARY_ATTESTATION'" <<< "${sql}"; then
    if grep -Fq "SELECT 'OMS_PROTOCOL_GATE_CANARY_ATTESTATION'," <<< "${sql}"; then
        attestation_output_format='columns'
    elif grep -Fq "SELECT CONCAT_WS(CHAR(9), 'OMS_PROTOCOL_GATE_CANARY_ATTESTATION'," <<< "${sql}"; then
        # mysql --batch escapes tabs embedded inside a field unless --raw is used.
        attestation_output_format='escaped-field'
    else
        echo "unexpected fake canary attestation query shape" >&2
        exit 2
    fi
    case "${OMS_PROTOCOL_GATE_FAKE_CANARY_ATTESTATION:-present}" in
        present)
            if [[ "${attestation_output_format}" == 'columns' ]]; then
                printf 'OMS_PROTOCOL_GATE_CANARY_ATTESTATION\t1\t1\t1\n'
            else
                printf 'OMS_PROTOCOL_GATE_CANARY_ATTESTATION\\t1\\t1\\t1\n'
            fi
            ;;
        missing) : ;;
        mismatched)
            if [[ "${attestation_output_format}" == 'columns' ]]; then
                printf 'OMS_PROTOCOL_GATE_CANARY_ATTESTATION\t0\t1\t1\n'
            else
                printf 'OMS_PROTOCOL_GATE_CANARY_ATTESTATION\\t0\\t1\\t1\n'
            fi
            ;;
        *) echo "unexpected fake canary attestation" >&2; exit 2 ;;
    esac
    exit 0
fi

if grep -Fq "'OMS_PROTOCOL_GATE_BIRTHDAY_CALENDAR'" <<< "${sql}"; then
    printf '%s\n' 'setup' >> "${OMS_PROTOCOL_GATE_ORDER_LOG}"
    if [[ "${OMS_PROTOCOL_GATE_FAKE_SETUP_PROOF:-present}" != "missing" ]]; then
        if [[ "${OMS_PROTOCOL_GATE_FAKE_BIRTHDAY_CALENDAR_PREEXISTING:-false}" == "true" ]]; then
            printf 'OMS_PROTOCOL_GATE_BIRTHDAY_CALENDAR\t700\t0\n'
        else
            printf 'OMS_PROTOCOL_GATE_BIRTHDAY_CALENDAR\t701\t1\n'
        fi
    fi
    if [[ "${OMS_PROTOCOL_GATE_FAKE_SETUP_FAIL:-false}" == "true" ]]; then
        exit 23
    fi
    exit 0
fi

printf '%s\n' 'cleanup' >> "${OMS_PROTOCOL_GATE_ORDER_LOG}"

cleanup_changes=0
if [[ "${OMS_PROTOCOL_GATE_FAKE_CLEANUP_CHANGES:-none}" == "once" \
    && ! -e "${OMS_PROTOCOL_GATE_FAKE_CHANGE_MARKER}" ]]; then
    install -m 0600 /dev/null "${OMS_PROTOCOL_GATE_FAKE_CHANGE_MARKER}"
    cleanup_changes=1
fi

emit_residue() {
    printf 'OMS_PROTOCOL_GATE_RESIDUE'
    printf '\t%s' "$@"
    printf '\n'
}

case "${OMS_PROTOCOL_GATE_FAKE_RESIDUE:-none}" in
    active) emit_residue 1 0 0 0 0 0 0 0 0 0 0 0 0 "${cleanup_changes}" ;;
    deleted) emit_residue 0 1 0 0 0 0 0 0 0 0 0 0 0 "${cleanup_changes}" ;;
    tombstones) emit_residue 0 0 1 0 0 0 0 0 0 0 0 0 0 "${cleanup_changes}" ;;
    birthday_events) emit_residue 0 0 0 1 0 0 0 0 0 0 0 0 0 "${cleanup_changes}" ;;
    birthday_tombstones) emit_residue 0 0 0 0 1 0 0 0 0 0 0 0 0 "${cleanup_changes}" ;;
    birthday_calendar) emit_residue 0 0 0 0 0 1 0 0 0 0 0 0 0 "${cleanup_changes}" ;;
    calendar_events) emit_residue 0 0 0 0 0 0 1 0 0 0 0 0 0 "${cleanup_changes}" ;;
    calendar_tombstones) emit_residue 0 0 0 0 0 0 0 1 0 0 0 0 0 "${cleanup_changes}" ;;
    calendar_shares) emit_residue 0 0 0 0 0 0 0 0 1 0 0 0 0 "${cleanup_changes}" ;;
    calendar_rows) emit_residue 0 0 0 0 0 0 0 0 0 1 0 0 0 "${cleanup_changes}" ;;
    mail_states) emit_residue 0 0 0 0 0 0 0 0 0 0 1 0 0 "${cleanup_changes}" ;;
    pim_states) emit_residue 0 0 0 0 0 0 0 0 0 0 0 1 0 "${cleanup_changes}" ;;
    webmail_sessions) emit_residue 0 0 0 0 0 0 0 0 0 0 0 0 1 "${cleanup_changes}" ;;
    missing) : ;;
    none) emit_residue 0 0 0 0 0 0 0 0 0 0 0 0 0 "${cleanup_changes}" ;;
    *) echo "unexpected fake residue kind" >&2; exit 2 ;;
esac
EOF
chmod 0755 "${MYSQL_PATH}"
export OMS_PROTOCOL_GATE_CLEANUP_LOG="${CLEANUP_LOG}"
export OMS_PROTOCOL_GATE_ORDER_LOG="${ORDER_LOG}"

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

"${PROJECT_ROOT}/tests/integration/activesync_mail_smoke_test.sh"
"${PROJECT_ROOT}/tests/integration/activesync_contacts_smoke_test.sh"
bash "${PROJECT_ROOT}/tests/integration/protocol_pending_runs_test.sh"
bash "${PROJECT_ROOT}/tests/integration/provision_protocol_canary_test.sh"

if [[ ${EUID} -ne 0 ]]; then
    echo "SKIP: secure credential ownership checks require root"
    exit 0
fi

CREDENTIAL_PATH="${TEST_ROOT}/protocol-smoke.env"
IDENTITY_PATH="${TEST_ROOT}/protocol-canary.identity"
SMOKE_PATH="${TEST_ROOT}/smoke.sh"
CONTACTS_SMOKE_PATH="${TEST_ROOT}/contacts-smoke.sh"
CALENDAR_SMOKE_PATH="${TEST_ROOT}/calendar-smoke.sh"
CANARY_ATTESTATION='0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'

cat > "${IDENTITY_PATH}" <<EOF
OMS_PROTOCOL_CANARY_USER="o'ms-canary@example.test"
OMS_PROTOCOL_CANARY_ATTESTATION='${CANARY_ATTESTATION}'
EOF
chmod 0600 "${IDENTITY_PATH}"
export OMS_PROTOCOL_GATE_IDENTITY_FILE="${IDENTITY_PATH}"

cat > "${CREDENTIAL_PATH}" <<EOF
OMS_SMOKE_USER="o'ms-canary@example.test"
OMS_SMOKE_PASSWORD='test-only-password'
OMS_PROTOCOL_CANARY_ATTESTATION='${CANARY_ATTESTATION}'
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
printf 'PROFILE=%s\n' "${OMS_SMOKE_PROTOCOL_PROFILE}"
[[ -n "${OMS_SMOKE_USER}" && -n "${OMS_SMOKE_PASSWORD}" ]]
printf '%s\n' 'mail' >> "${OMS_PROTOCOL_GATE_ORDER_LOG}"
echo 'PASS: fake dual-protocol smoke completed'
EOF
chmod 0755 "${SMOKE_PATH}"

cat > "${CONTACTS_SMOKE_PATH}" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf 'CONTACTS_DEVICE=%s\n' "${OMS_SMOKE_DEVICE_ID}"
printf 'CONTACT_RUN=%s\n' "${OMS_SMOKE_CONTACT_RUN_ID}"
printf 'OMS_PROTOCOL_GATE_CONTACT_DAV_UID\t%s\n' '11111111-2222-4333-8444-555555555555'
printf '%s\n' 'contacts' >> "${OMS_PROTOCOL_GATE_ORDER_LOG}"
echo 'PASS: fake ActiveSync contacts smoke completed'
EOF
chmod 0755 "${CONTACTS_SMOKE_PATH}"

cat > "${CALENDAR_SMOKE_PATH}" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf 'CALENDAR_DEVICE=%s\n' "${OMS_SMOKE_DEVICE_ID}"
printf '%s\n' 'calendar' >> "${OMS_PROTOCOL_GATE_ORDER_LOG}"
echo 'PASS: fake ActiveSync calendar smoke completed'
EOF
chmod 0755 "${CALENDAR_SMOKE_PATH}"

MISPOINTED_CREDENTIAL_PATH="${TEST_ROOT}/mispointed-protocol-smoke.env"
cat > "${MISPOINTED_CREDENTIAL_PATH}" <<EOF
OMS_SMOKE_USER='existing-user@example.test'
OMS_SMOKE_PASSWORD='test-only-password'
OMS_PROTOCOL_CANARY_ATTESTATION='${CANARY_ATTESTATION}'
EOF
chmod 0600 "${MISPOINTED_CREDENTIAL_PATH}"
: > "${CLEANUP_LOG}"
if OMS_PROTOCOL_GATE_CREDENTIAL_FILE="${MISPOINTED_CREDENTIAL_PATH}" \
    OMS_PROTOCOL_GATE_PROFILE="mail" \
    OMS_PROTOCOL_GATE_MAIL_SMOKE_SCRIPT="${SMOKE_PATH}" \
    OMS_PROTOCOL_GATE_MYSQL_BIN="${MYSQL_PATH}" \
    bash "${GATE_SCRIPT}" "${CONFIG_PATH}" >"${OUTPUT_PATH}" 2>&1; then
    echo "FAIL: protocol release gate accepted credentials for an unattested mailbox" >&2
    exit 1
fi
grep -Fq 'does not match the dedicated protocol canary identity' "${OUTPUT_PATH}"
if grep -Fq 'DELETE FROM webmail_sessions' "${CLEANUP_LOG}"; then
    echo "FAIL: mispointed protocol credentials triggered account-wide session cleanup" >&2
    exit 1
fi

echo "PASS: protocol release gate protects arbitrary mailboxes from account-wide canary cleanup"

: > "${CLEANUP_LOG}"
if OMS_PROTOCOL_GATE_CREDENTIAL_FILE="${CREDENTIAL_PATH}" \
    OMS_PROTOCOL_GATE_PROFILE="mail" \
    OMS_PROTOCOL_GATE_MAIL_SMOKE_SCRIPT="${SMOKE_PATH}" \
    OMS_PROTOCOL_GATE_MYSQL_BIN="${MYSQL_PATH}" \
    OMS_PROTOCOL_GATE_FAKE_CANARY_ATTESTATION='mismatched' \
    bash "${GATE_SCRIPT}" "${CONFIG_PATH}" >"${OUTPUT_PATH}" 2>&1; then
    echo "FAIL: protocol release gate accepted a mailbox without its database attestation" >&2
    exit 1
fi
grep -Fq 'Dedicated protocol canary database attestation is missing or ambiguous' "${OUTPUT_PATH}"
grep -Fq "SELECT 'OMS_PROTOCOL_GATE_CANARY_ATTESTATION'," "${CLEANUP_LOG}"
if grep -Fq 'DELETE FROM webmail_sessions' "${CLEANUP_LOG}"; then
    echo "FAIL: missing database attestation triggered account-wide session cleanup" >&2
    exit 1
fi

echo "PASS: protocol release gate requires the provisioned database canary marker before cleanup"

: > "${CLEANUP_LOG}"
: > "${ORDER_LOG}"
if ! OMS_PROTOCOL_GATE_CREDENTIAL_FILE="${CREDENTIAL_PATH}" \
    OMS_PROTOCOL_GATE_PROFILE="suite" \
    OMS_PROTOCOL_GATE_MAIL_SMOKE_SCRIPT="${SMOKE_PATH}" \
    OMS_PROTOCOL_GATE_CONTACTS_SMOKE_SCRIPT="${CONTACTS_SMOKE_PATH}" \
    OMS_PROTOCOL_GATE_CALENDAR_SMOKE_SCRIPT="${CALENDAR_SMOKE_PATH}" \
    OMS_PROTOCOL_GATE_MYSQL_BIN="${MYSQL_PATH}" \
        bash "${GATE_SCRIPT}" "${CONFIG_PATH}" >"${OUTPUT_PATH}" 2>&1; then
    cat "${OUTPUT_PATH}" >&2
    echo "FAIL: protocol release gate rejected the complete fake suite" >&2
    exit 1
fi

grep -Fq 'BASE=https://mail.example.test' "${OUTPUT_PATH}"
grep -Fq 'IMAP=mail.example.test:993 secure=true server=mail.example.test verify=true' "${OUTPUT_PATH}"
grep -Fq 'SMTP=mail.example.test:587 server=mail.example.test verify=true' "${OUTPUT_PATH}"
grep -Eq '^DEVICE=OMSPG[0-9a-f]{24}$' "${OUTPUT_PATH}"
grep -Fq 'PROFILE=suite' "${OUTPUT_PATH}"
grep -Eq '^CONTACTS_DEVICE=OMSPG[0-9a-f]{24}$' "${OUTPUT_PATH}"
grep -Eq '^CONTACT_RUN=omspg[0-9a-f]{24}$' "${OUTPUT_PATH}"
grep -Eq '^CALENDAR_DEVICE=OMSPG[0-9a-f]{24}$' "${OUTPUT_PATH}"
grep -Fq 'PASS: fake ActiveSync contacts smoke completed' "${OUTPUT_PATH}"
grep -Fq 'PASS: fake ActiveSync calendar smoke completed' "${OUTPUT_PATH}"
grep -Fq 'PASS: protocol release gate completed' "${OUTPUT_PATH}"
collapsed_order=$(awk 'NR == 1 || $0 != previous { print } { previous = $0 }' "${ORDER_LOG}" | paste -sd ' ')
[[ "${collapsed_order}" == 'cleanup setup mail contacts calendar cleanup' ]] \
    || { echo "FAIL: gate did not reconcile the deterministic run identity before and after its suite" >&2; exit 1; }
if ! grep -Fq "'OMS_PROTOCOL_GATE_BIRTHDAY_CALENDAR'" "${CLEANUP_LOG}"; then
    echo "FAIL: suite gate did not pre-record an exact Birthdays calendar" >&2
    exit 1
fi
grep -Fq 'INSERT INTO calendars (user_id, name, dav_slug, color, components, subscribed_url, sync_token)' "${CLEANUP_LOG}"
grep -Fq "@oms_birthday_run_name, 'birthdays', '#e91e63', 'VEVENT', NULL, 0" "${CLEANUP_LOG}"
grep -Fq 'WHERE @oms_birthday_calendar_created=1' "${CLEANUP_LOG}"
grep -Fq 'LAST_INSERT_ID()' "${CLEANUP_LOG}"
grep -Fq 'SET @oms_birthday_calendar_id = 701;' "${CLEANUP_LOG}"
grep -Fq "AND calendars.dav_slug='birthdays'" "${CLEANUP_LOG}"
grep -Fq 'DELETE gate_calendar' "${CLEANUP_LOG}"
grep -Fq 'gate_calendar.id=@oms_birthday_calendar_id' "${CLEANUP_LOG}"
grep -Fq "gate_calendar.dav_slug='birthdays'" "${CLEANUP_LOG}"
grep -Fq 'AND @oms_birthday_identity_proven=1' "${CLEANUP_LOG}"
grep -Fq 'AND @oms_birthday_calendar_created=1' "${CLEANUP_LOG}"
grep -Fq 'WHERE events.calendar_id=gate_calendar.id' "${CLEANUP_LOG}"
grep -Fq 'WHERE calendar_tombstones.calendar_id=gate_calendar.id' "${CLEANUP_LOG}"
grep -Fq 'WHERE calendar_shares.calendar_id=gate_calendar.id' "${CLEANUP_LOG}"
grep -Fq '@oms_birthday_calendar_rows' "${CLEANUP_LOG}"
grep -Fq '@oms_birthday_identity_proven=1 AND @oms_birthday_calendar_created=1' "${CLEANUP_LOG}"
grep -Fq 'DELETE FROM eas_mail_sync_states' "${CLEANUP_LOG}"
grep -Fq 'eas_pim_sync_states' "${CLEANUP_LOG}"
grep -Fq 'DELETE FROM webmail_sessions WHERE username=' "${CLEANUP_LOG}"
grep -Fq '@oms_webmail_sessions' "${CLEANUP_LOG}"
grep -Fq '@oms_cleanup_changes' "${CLEANUP_LOG}"
grep -Fq "'OMS_PROTOCOL_GATE_CANARY_ATTESTATION'" "${CLEANUP_LOG}"
grep -Fq 'AND email_other=' "${CLEANUP_LOG}"
grep -Fq 'CREATE TEMPORARY TABLE oms_protocol_contact_targets' "${CLEANUP_LOG}"
grep -Fq 'DELETE members' "${CLEANUP_LOG}"
grep -Fq 'DELETE tombstones' "${CLEANUP_LOG}"
grep -Fq 'DELETE contacts' "${CLEANUP_LOG}"
grep -Fq 'oms_protocol_birthday_targets' "${CLEANUP_LOG}"
grep -Fq 'oms_protocol_calendar_targets' "${CLEANUP_LOG}"
grep -Fq 'DELETE gate_events' "${CLEANUP_LOG}"
grep -Fq 'DELETE gate_tombstones' "${CLEANUP_LOG}"
grep -Fq 'DELETE gate_shares' "${CLEANUP_LOG}"
grep -Fq 'DELETE gate_calendar' "${CLEANUP_LOG}"
grep -Fq 'DELETE birthday_events' "${CLEANUP_LOG}"
grep -Fq 'DELETE birthday_tombstones' "${CLEANUP_LOG}"
grep -Fq 'ON targets.calendar_id=birthday_events.calendar_id AND targets.uid=birthday_events.uid;' "${CLEANUP_LOG}"
grep -Fq 'ON targets.calendar_id=birthday_tombstones.calendar_id AND targets.uid=birthday_tombstones.uid;' "${CLEANUP_LOG}"
grep -Fq 'JOIN oms_protocol_birthday_changed_calendars AS changed' "${CLEANUP_LOG}"
grep -Fq 'sync_token = calendars.sync_token + 1' "${CLEANUP_LOG}"
if grep -Eq '^DELETE FROM (events|calendar_tombstones)([[:space:]]|;)' "${CLEANUP_LOG}"; then
    echo "FAIL: protocol release gate emitted a broad calendar artifact delete" >&2
    exit 1
fi
if grep -Eq 'sync_token[[:space:]]*=[[:space:]]*(0|calendars\.sync_token[[:space:]]*-[[:space:]]*[0-9]+)' "${CLEANUP_LOG}"; then
    echo "FAIL: protocol release gate reset or decremented a calendar collection token" >&2
    exit 1
fi
if grep -Fq "o'ms-canary@example.test" "${CLEANUP_LOG}"; then
    echo "FAIL: protocol release gate interpolated the raw canary mailbox into SQL" >&2
    exit 1
fi
grep -Fq '0x6f276d732d63616e617279406578616d706c652e74657374' "${CLEANUP_LOG}"
grep -Fq 'deleted_at IS NULL' "${CLEANUP_LOG}"
grep -Fq 'deleted_at IS NOT NULL' "${CLEANUP_LOG}"
grep -Fq "'OMS_PROTOCOL_GATE_RESIDUE'" "${CLEANUP_LOG}"
contact_run_id=$(sed -n 's/^CONTACT_RUN=//p' "${OUTPUT_PATH}")
contact_seed_email="oms-eas-seed-${contact_run_id}@example.invalid"
contact_added_email="oms-eas-added-${contact_run_id}@example.invalid"
contact_changed_email="oms-eas-changed-${contact_run_id}@example.invalid"
birthday_run_name="OMS Protocol Birthdays ${contact_run_id}"
calendar_run_slug="oms-eas-calendar-${contact_run_id}"
contact_seed_email_hex=$(printf '%s' "${contact_seed_email}" | LC_ALL=C od -An -v -tx1 | tr -d '[:space:]')
contact_added_email_hex=$(printf '%s' "${contact_added_email}" | LC_ALL=C od -An -v -tx1 | tr -d '[:space:]')
contact_changed_email_hex=$(printf '%s' "${contact_changed_email}" | LC_ALL=C od -An -v -tx1 | tr -d '[:space:]')
birthday_run_name_hex=$(printf '%s' "${birthday_run_name}" | LC_ALL=C od -An -v -tx1 | tr -d '[:space:]')
calendar_run_slug_hex=$(printf '%s' "${calendar_run_slug}" | LC_ALL=C od -An -v -tx1 | tr -d '[:space:]')
grep -Fq "0x${contact_seed_email_hex}" "${CLEANUP_LOG}"
grep -Fq "0x${contact_added_email_hex}" "${CLEANUP_LOG}"
grep -Fq "0x${contact_changed_email_hex}" "${CLEANUP_LOG}"
grep -Fq "0x${birthday_run_name_hex}" "${CLEANUP_LOG}"
grep -Fq "0x${calendar_run_slug_hex}" "${CLEANUP_LOG}"
grep -Fq '0x31313131313131312d323232322d343333332d383434342d353535353535353535353535' "${CLEANUP_LOG}"
if grep -Fq "${contact_seed_email}" "${CLEANUP_LOG}" ||
    grep -Fq "${contact_added_email}" "${CLEANUP_LOG}" ||
    grep -Fq "${contact_changed_email}" "${CLEANUP_LOG}" ||
    grep -Fq "${birthday_run_name}" "${CLEANUP_LOG}"; then
    echo "FAIL: protocol release gate interpolated a raw canary marker into SQL" >&2
    exit 1
fi

echo "PASS: protocol release gate configures the public authenticated client seams"

PRODUCTION_SENTINEL="${TEST_ROOT}/protocol-gate.required"
install -m 0600 /dev/null "${PRODUCTION_SENTINEL}"
if OMS_PROTOCOL_GATE_REQUIRED_FILE="${PRODUCTION_SENTINEL}" \
    OMS_PROTOCOL_GATE_FIXTURE_MODE=1 \
    OMS_PROTOCOL_GATE_CREDENTIAL_FILE="${CREDENTIAL_PATH}" \
    OMS_PROTOCOL_GATE_PROFILE="suite" \
    OMS_PROTOCOL_GATE_MAIL_SMOKE_SCRIPT="${SMOKE_PATH}" \
    OMS_PROTOCOL_GATE_CONTACTS_SMOKE_SCRIPT="${CONTACTS_SMOKE_PATH}" \
    OMS_PROTOCOL_GATE_CALENDAR_SMOKE_SCRIPT="${CALENDAR_SMOKE_PATH}" \
    OMS_PROTOCOL_GATE_MYSQL_BIN="${MYSQL_PATH}" \
    bash "${GATE_SCRIPT}" "${CONFIG_PATH}" >"${OUTPUT_PATH}" 2>&1; then
    echo "FAIL: production sentinel accepted fixture-only protocol overrides" >&2
    exit 1
fi
grep -Fq 'fixture-only protocol overrides' "${OUTPUT_PATH}"

grep -Fq 'OMS_PROTOCOL_POST_GATE_SCRIPT is fixture-only' \
    "${PROJECT_ROOT}/functions/protocol_guarded_deploy.sh" \
    || { echo "FAIL: guarded deploy retained a production post-gate override" >&2; exit 1; }
grep -Fq "POST_GATE_SCRIPT=\"\${GATE_SCRIPT}\"" \
    "${PROJECT_ROOT}/functions/protocol_guarded_deploy.sh" \
    || { echo "FAIL: guarded deploy does not pin its canonical post-gate script" >&2; exit 1; }
grep -Fq 'export OMS_PROTOCOL_GATE_RUN_ID' \
    "${PROJECT_ROOT}/functions/protocol_guarded_deploy.sh" \
    || { echo "FAIL: guarded deploy does not retain one cleanup identity across rollback" >&2; exit 1; }
grep -Fq 'OMS_PROTOCOL_GATE_FIXTURE_MODE' \
    "${PROJECT_ROOT}/functions/protocol_guarded_deploy.sh" \
    || { echo "FAIL: guarded deploy does not reject inherited fixture mode" >&2; exit 1; }
grep -Fq 'OMS_SMOKE_POSTQUEUE_BIN' \
    "${PROJECT_ROOT}/functions/protocol_guarded_deploy.sh" \
    || { echo "FAIL: guarded deploy does not reject inherited mail cleanup helpers" >&2; exit 1; }
grep -Fq 'OMS_SMOKE_MAIL_CLEANUP_QUIET_MS' "${GATE_SCRIPT}" \
    || { echo "FAIL: protocol gate does not classify mail quiet-window overrides as fixture-only" >&2; exit 1; }
calendar_created_line=$(grep -n '^calendar_created=true$' \
    "${PROJECT_ROOT}/tests/integration/calendar_sync_smoke.sh" | cut -d: -f1)
mkcalendar_line=$(grep -n '^mkcalendar_status=' \
    "${PROJECT_ROOT}/tests/integration/calendar_sync_smoke.sh" | cut -d: -f1)
[[ -n "${calendar_created_line}" && -n "${mkcalendar_line}" \
    && ${calendar_created_line} -lt ${mkcalendar_line} ]] \
    || { echo "FAIL: calendar smoke does not own uncertain MKCALENDAR outcomes" >&2; exit 1; }

echo "PASS: production protocol gate rejects fixture-only overrides"

SOURCED_OVERRIDE_CONFIG="${TEST_ROOT}/sourced-override.conf"
cat > "${SOURCED_OVERRIDE_CONFIG}" <<EOF
MAIL_HOSTNAME="mail.example.test"
POSTFIXADMIN_DB_USER="test-user"
POSTFIXADMIN_DB_PASSWORD="test-password"
POSTFIXADMIN_DB_NAME="test-db"
REQUIRED_FILE="${TEST_ROOT}/attacker-selected-no-sentinel"
OMS_PROTOCOL_GATE_FIXTURE_MODE=1
OMS_PROTOCOL_GATE_MAIL_SMOKE_SCRIPT="${SMOKE_PATH}"
EOF
if OMS_PROTOCOL_GATE_REQUIRED_FILE="${PRODUCTION_SENTINEL}" \
    OMS_PROTOCOL_GATE_FIXTURE_MODE=0 \
    OMS_PROTOCOL_GATE_CREDENTIAL_FILE="${CREDENTIAL_PATH}" \
    bash "${GATE_SCRIPT}" "${SOURCED_OVERRIDE_CONFIG}" --profile mail >"${OUTPUT_PATH}" 2>&1; then
    echo "FAIL: config-sourced smoke override bypassed the production sentinel" >&2
    exit 1
fi
grep -Fq 'fixture-only protocol overrides' "${OUTPUT_PATH}"

SOURCED_OVERRIDE_CREDENTIAL="${TEST_ROOT}/sourced-override.env"
cat > "${SOURCED_OVERRIDE_CREDENTIAL}" <<EOF
OMS_SMOKE_USER="fixture@example.test"
OMS_SMOKE_PASSWORD="test-only-password"
OMS_PROTOCOL_GATE_FIXTURE_MODE=0
OMS_PROTOCOL_GATE_MYSQL_BIN="${MYSQL_PATH}"
EOF
chmod 0600 "${SOURCED_OVERRIDE_CREDENTIAL}"
if OMS_PROTOCOL_GATE_REQUIRED_FILE="${PRODUCTION_SENTINEL}" \
    OMS_PROTOCOL_GATE_FIXTURE_MODE=0 \
    OMS_PROTOCOL_GATE_CREDENTIAL_FILE="${SOURCED_OVERRIDE_CREDENTIAL}" \
    bash "${GATE_SCRIPT}" "${CONFIG_PATH}" --profile mail >"${OUTPUT_PATH}" 2>&1; then
    echo "FAIL: credential-sourced command override bypassed the production sentinel" >&2
    exit 1
fi
grep -Fq 'fixture-only protocol overrides' "${OUTPUT_PATH}"

PINNED_RUN_CONFIG="${TEST_ROOT}/pinned-run.conf"
PINNED_RUN_CREDENTIAL="${TEST_ROOT}/pinned-run.env"
cat > "${PINNED_RUN_CONFIG}" <<'EOF'
MAIL_HOSTNAME="mail.example.test"
POSTFIXADMIN_DB_USER="test-user"
POSTFIXADMIN_DB_PASSWORD="test-password"
POSTFIXADMIN_DB_NAME="test-db"
OMS_PROTOCOL_GATE_RUN_ID="bbbbbbbbbbbbbbbbbbbbbbbb"
EOF
cat > "${PINNED_RUN_CREDENTIAL}" <<EOF
OMS_SMOKE_USER="o'ms-canary@example.test"
OMS_SMOKE_PASSWORD="test-only-password"
OMS_PROTOCOL_GATE_RUN_ID="cccccccccccccccccccccccc"
OMS_PROTOCOL_CANARY_ATTESTATION='${CANARY_ATTESTATION}'
EOF
chmod 0600 "${PINNED_RUN_CREDENTIAL}"
OMS_PROTOCOL_GATE_RUN_ID="aaaaaaaaaaaaaaaaaaaaaaaa" \
OMS_PROTOCOL_GATE_CREDENTIAL_FILE="${PINNED_RUN_CREDENTIAL}" \
OMS_PROTOCOL_GATE_PROFILE=mail \
OMS_PROTOCOL_GATE_MAIL_SMOKE_SCRIPT="${SMOKE_PATH}" \
OMS_PROTOCOL_GATE_MYSQL_BIN="${MYSQL_PATH}" \
    bash "${GATE_SCRIPT}" "${PINNED_RUN_CONFIG}" --profile mail >"${OUTPUT_PATH}" 2>&1
grep -Fq 'DEVICE=OMSPGaaaaaaaaaaaaaaaaaaaaaaaa' "${OUTPUT_PATH}"

echo "PASS: inherited guarded run identity remains pinned across sourced config and credentials"

GUARD_FIXTURE_ROOT="${TEST_ROOT}/guarded-wrapper"
mkdir -p "${GUARD_FIXTURE_ROOT}/functions" "${GUARD_FIXTURE_ROOT}/tests/integration"
cp "${PROJECT_ROOT}/functions/protocol_guarded_deploy.sh" "${GUARD_FIXTURE_ROOT}/functions/"
cp "${PROJECT_ROOT}/functions/lib_protocol_guard.sh" "${GUARD_FIXTURE_ROOT}/functions/"
cp "${PROJECT_ROOT}/functions/lib_protocol_pending_runs.sh" "${GUARD_FIXTURE_ROOT}/functions/"
install -m 0755 /dev/null "${GUARD_FIXTURE_ROOT}/tests/integration/protocol_release_gate.sh"
cat > "${GUARD_FIXTURE_ROOT}/config.conf" <<'EOF'
GATE_SCRIPT="/tmp/not-the-openmailstack-gate"
POST_GATE_SCRIPT="/tmp/not-the-openmailstack-post-gate"
EOF
if OMS_PROTOCOL_GATE_REQUIRED_FILE="${PRODUCTION_SENTINEL}" \
    OMS_PROTOCOL_GATE_FIXTURE_MODE='' \
    bash "${GUARD_FIXTURE_ROOT}/functions/protocol_guarded_deploy.sh" webmail >"${OUTPUT_PATH}" 2>&1; then
    echo "FAIL: guarded deploy accepted config-sourced gate script reassignment" >&2
    exit 1
fi
grep -Fq 'cannot reassign the canonical protocol gate scripts' "${OUTPUT_PATH}"

SIGNAL_HARNESS="${TEST_ROOT}/repeated-signal-harness.sh"
SIGNAL_OUTPUT="${TEST_ROOT}/repeated-signal-output.log"
cat > "${SIGNAL_HARNESS}" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

GUARD_SCRIPT=$1
TARGET='webmail'
ROLLBACK_READY=1
DEPLOY_COMPLETE=0
RECOVERY_CALLS=0
RECOVERY_PROVED=0

protocol_recover_after_interruption() {
    RECOVERY_CALLS=$((RECOVERY_CALLS + 1))
    printf 'RECOVERY_CALL=%s\n' "${RECOVERY_CALLS}"
    if (( RECOVERY_CALLS > 1 )); then
        echo 'RECOVERY_REENTERED'
        return 1
    fi
    kill -HUP "$$"
    sleep 0.05
    RECOVERY_PROVED=1
    echo 'RECOVERY_PROVED'
    return 0
}

clear_current_pending_run() {
    if [[ "${RECOVERY_PROVED}" != "1" ]]; then
        echo 'JOURNAL_CLEAR_BEFORE_PROOF'
        return 1
    fi
    echo 'JOURNAL_CLEARED_AFTER_PROOF'
}

restore_snapshot() { :; }
validate_recovered_target() { :; }
print_success() { :; }
fail() { echo "FAIL_CALLED: $*"; exit 1; }
fail_with_status() {
    local status=$1
    shift
    printf 'EXIT_STATUS=%s %s\n' "${status}" "$*"
    exit "${status}"
}

on_signal_source=$(awk '
    /^on_signal\(\) \{/ { capture=1 }
    capture { print }
    capture && /^}$/ { exit }
' "${GUARD_SCRIPT}")
[[ -n "${on_signal_source}" ]]
eval "${on_signal_source}"
trap 'on_signal HUP' HUP
trap 'on_signal INT' INT
trap 'on_signal TERM' TERM
kill -TERM "$$"
echo 'FAIL: signal handler returned instead of terminating'
exit 99
EOF
chmod 0755 "${SIGNAL_HARNESS}"
set +e
bash "${SIGNAL_HARNESS}" "${PROJECT_ROOT}/functions/protocol_guarded_deploy.sh" \
    >"${SIGNAL_OUTPUT}" 2>&1
signal_status=$?
set -e
if [[ "${signal_status}" != "20" ]]; then
    cat "${SIGNAL_OUTPUT}" >&2
    echo "FAIL: a repeated signal interrupted guarded recovery" >&2
    exit 1
fi
[[ $(grep -Fc 'RECOVERY_CALL=' "${SIGNAL_OUTPUT}") -eq 1 ]]
grep -Fq 'RECOVERY_PROVED' "${SIGNAL_OUTPUT}"
grep -Fq 'JOURNAL_CLEARED_AFTER_PROOF' "${SIGNAL_OUTPUT}"
if grep -Fq 'RECOVERY_REENTERED' "${SIGNAL_OUTPUT}" \
    || grep -Fq 'JOURNAL_CLEAR_BEFORE_PROOF' "${SIGNAL_OUTPUT}"; then
    cat "${SIGNAL_OUTPUT}" >&2
    echo "FAIL: repeated signal recovery re-entered or cleared its journal early" >&2
    exit 1
fi

echo "PASS: guarded recovery masks repeated signals until proof and journal clearance"

echo "PASS: sourced config and credential overrides cannot bypass canonical production gates"

: > "${CLEANUP_LOG}"
: > "${ORDER_LOG}"
OMS_PROTOCOL_GATE_CREDENTIAL_FILE="${CREDENTIAL_PATH}" \
OMS_PROTOCOL_GATE_MYSQL_BIN="${MYSQL_PATH}" \
OMS_PROTOCOL_GATE_MAIL_SMOKE_SCRIPT="${SMOKE_PATH}" \
    bash "${GATE_SCRIPT}" "${CONFIG_PATH}" --cleanup-suite-only >"${OUTPUT_PATH}" 2>&1 \
    || { cat "${OUTPUT_PATH}" >&2; echo "FAIL: cleanup-only recovery fixture failed" >&2; exit 1; }
grep -Fq 'PASS: protocol release gate removed and proved zero database, EAS/PIM, mailbox, Postfix, and web-session canary residue' "${OUTPUT_PATH}"
collapsed_order=$(awk 'NR == 1 || $0 != previous { print } { previous = $0 }' "${ORDER_LOG}" | paste -sd ' ')
[[ "${collapsed_order}" == 'cleanup mail cleanup' ]] \
    || { echo "FAIL: suite cleanup-only mode did not bracket mail cleanup with database proof" >&2; exit 1; }
grep -Fq 'oms_protocol_contact_targets' "${CLEANUP_LOG}"
grep -Fq "calendars.dav_slug='birthdays'" "${CLEANUP_LOG}"
grep -Fq '@oms_birthday_marker_rows' "${CLEANUP_LOG}"

echo "PASS: cleanup-only recovery removes and proves exact suite canary residue without requiring the suite runtime"

: > "${CLEANUP_LOG}"
: > "${ORDER_LOG}"
LATE_CHANGE_MARKER="${TEST_ROOT}/late-cleanup-change.seen"
OMS_PROTOCOL_GATE_CREDENTIAL_FILE="${CREDENTIAL_PATH}" \
OMS_PROTOCOL_GATE_MYSQL_BIN="${MYSQL_PATH}" \
OMS_PROTOCOL_GATE_MAIL_SMOKE_SCRIPT="${SMOKE_PATH}" \
OMS_PROTOCOL_GATE_CLEANUP_QUIET_MS=30 \
OMS_PROTOCOL_GATE_CLEANUP_DEADLINE_MS=500 \
OMS_PROTOCOL_GATE_CLEANUP_POLL_MS=10 \
OMS_PROTOCOL_GATE_FAKE_CLEANUP_CHANGES=once \
OMS_PROTOCOL_GATE_FAKE_CHANGE_MARKER="${LATE_CHANGE_MARKER}" \
    bash "${GATE_SCRIPT}" "${CONFIG_PATH}" --cleanup-suite-only >"${OUTPUT_PATH}" 2>&1
[[ -f "${LATE_CHANGE_MARKER}" ]]
if [[ $(grep -Fc 'OMS_PROTOCOL_GATE_MYSQL_INVOCATION_BEGIN' "${CLEANUP_LOG}") -lt 3 ]]; then
    echo "FAIL: cleanup proof did not keep polling through the bounded quiet window" >&2
    exit 1
fi
grep -Fq 'PASS: protocol release gate removed and proved zero database, EAS/PIM, mailbox, Postfix, and web-session canary residue' "${OUTPUT_PATH}"

echo "PASS: protocol release cleanup repeats through a bounded quiet window after observing late state"

for residue_kind in active deleted tombstones birthday_events birthday_tombstones birthday_calendar \
    calendar_events calendar_tombstones calendar_shares calendar_rows mail_states pim_states webmail_sessions; do
    if OMS_PROTOCOL_GATE_CREDENTIAL_FILE="${CREDENTIAL_PATH}" \
        OMS_PROTOCOL_GATE_PROFILE="suite" \
        OMS_PROTOCOL_GATE_MAIL_SMOKE_SCRIPT="${SMOKE_PATH}" \
        OMS_PROTOCOL_GATE_CONTACTS_SMOKE_SCRIPT="${CONTACTS_SMOKE_PATH}" \
        OMS_PROTOCOL_GATE_CALENDAR_SMOKE_SCRIPT="${CALENDAR_SMOKE_PATH}" \
        OMS_PROTOCOL_GATE_MYSQL_BIN="${MYSQL_PATH}" \
        OMS_PROTOCOL_GATE_FAKE_RESIDUE="${residue_kind}" \
        bash "${GATE_SCRIPT}" "${CONFIG_PATH}" >"${OUTPUT_PATH}" 2>&1; then
        echo "FAIL: protocol release gate accepted ${residue_kind} canary residue" >&2
        exit 1
    fi
    grep -Fq 'Synthetic protocol canary cleanup left residue' "${OUTPUT_PATH}"
    grep -Eq "${residue_kind}=[1-9][0-9]*" "${OUTPUT_PATH}"
done

: > "${CLEANUP_LOG}"
OMS_PROTOCOL_GATE_CREDENTIAL_FILE="${CREDENTIAL_PATH}" \
OMS_PROTOCOL_GATE_PROFILE="suite" \
OMS_PROTOCOL_GATE_MAIL_SMOKE_SCRIPT="${SMOKE_PATH}" \
OMS_PROTOCOL_GATE_CONTACTS_SMOKE_SCRIPT="${CONTACTS_SMOKE_PATH}" \
OMS_PROTOCOL_GATE_CALENDAR_SMOKE_SCRIPT="${CALENDAR_SMOKE_PATH}" \
OMS_PROTOCOL_GATE_MYSQL_BIN="${MYSQL_PATH}" \
OMS_PROTOCOL_GATE_FAKE_BIRTHDAY_CALENDAR_PREEXISTING="true" \
    bash "${GATE_SCRIPT}" "${CONFIG_PATH}" >"${OUTPUT_PATH}" 2>&1
grep -Fq 'SET @oms_birthday_calendar_id = 700;' "${CLEANUP_LOG}"
grep -Fq 'SET @oms_birthday_calendar_created = 0;' "${CLEANUP_LOG}"
grep -Fq 'AND @oms_birthday_calendar_created=1' "${CLEANUP_LOG}"
if grep -Fq 'SET @oms_birthday_calendar_id = 701;' "${CLEANUP_LOG}"; then
    echo "FAIL: suite gate targeted the fixture-created calendar during a pre-existing-calendar run" >&2
    exit 1
fi

if grep -Fq "OR calendars.name='Birthdays'" "${CLEANUP_LOG}" \
    || grep -Fq "OR name='Birthdays'" "${CLEANUP_LOG}"; then
    echo "FAIL: suite gate treated a calendar name as managed Birthdays identity" >&2
    exit 1
fi

echo "PASS: protocol release gate preserves a pre-existing managed Birthdays calendar and name-only calendars"

: > "${CLEANUP_LOG}"
if OMS_PROTOCOL_GATE_CREDENTIAL_FILE="${CREDENTIAL_PATH}" \
    OMS_PROTOCOL_GATE_PROFILE="suite" \
    OMS_PROTOCOL_GATE_MAIL_SMOKE_SCRIPT="${SMOKE_PATH}" \
    OMS_PROTOCOL_GATE_CONTACTS_SMOKE_SCRIPT="${CONTACTS_SMOKE_PATH}" \
    OMS_PROTOCOL_GATE_CALENDAR_SMOKE_SCRIPT="${CALENDAR_SMOKE_PATH}" \
    OMS_PROTOCOL_GATE_MYSQL_BIN="${MYSQL_PATH}" \
    OMS_PROTOCOL_GATE_FAKE_SETUP_FAIL="true" \
    bash "${GATE_SCRIPT}" "${CONFIG_PATH}" >"${OUTPUT_PATH}" 2>&1; then
    echo "FAIL: protocol release gate accepted a failed Birthdays calendar setup" >&2
    exit 1
fi
grep -Fq 'Could not prepare the synthetic Birthdays calendar' "${OUTPUT_PATH}"
if [[ $(grep -Fc 'OMS_PROTOCOL_GATE_MYSQL_INVOCATION_BEGIN' "${CLEANUP_LOG}") -lt 2 ]]; then
    echo "FAIL: protocol release gate did not run trap cleanup after Birthdays setup failure" >&2
    exit 1
fi
grep -Fq 'SET @oms_birthday_calendar_id = 701;' "${CLEANUP_LOG}"
grep -Fq 'AND @oms_birthday_calendar_created=1' "${CLEANUP_LOG}"

echo "PASS: protocol release gate traps Birthdays calendar setup failures"

: > "${CLEANUP_LOG}"
if OMS_PROTOCOL_GATE_CREDENTIAL_FILE="${CREDENTIAL_PATH}" \
    OMS_PROTOCOL_GATE_PROFILE="suite" \
    OMS_PROTOCOL_GATE_MAIL_SMOKE_SCRIPT="${SMOKE_PATH}" \
    OMS_PROTOCOL_GATE_CONTACTS_SMOKE_SCRIPT="${CONTACTS_SMOKE_PATH}" \
    OMS_PROTOCOL_GATE_CALENDAR_SMOKE_SCRIPT="${CALENDAR_SMOKE_PATH}" \
    OMS_PROTOCOL_GATE_MYSQL_BIN="${MYSQL_PATH}" \
    OMS_PROTOCOL_GATE_FAKE_SETUP_PROOF="missing" \
    bash "${GATE_SCRIPT}" "${CONFIG_PATH}" >"${OUTPUT_PATH}" 2>&1; then
    echo "FAIL: protocol release gate accepted missing Birthdays identity output" >&2
    exit 1
fi
grep -Fq 'Synthetic Birthdays calendar preparation returned no valid identity proof' "${OUTPUT_PATH}"
if [[ $(grep -Fc 'OMS_PROTOCOL_GATE_MYSQL_INVOCATION_BEGIN' "${CLEANUP_LOG}") -lt 2 ]]; then
    echo "FAIL: protocol release gate did not run cleanup after missing setup output" >&2
    exit 1
fi
grep -Fq "calendars.dav_slug='birthdays'" "${CLEANUP_LOG}"
if ! grep -Fq '@oms_birthday_marker_rows' "${CLEANUP_LOG}"; then
    echo "FAIL: protocol release gate cannot recover its exact managed calendar after setup output loss" >&2
    exit 1
fi
grep -Fq 'gate_calendar.name=@oms_birthday_run_name' "${CLEANUP_LOG}"

echo "PASS: protocol release gate recovers and cleans its exact managed Birthdays calendar after setup output loss"

if OMS_PROTOCOL_GATE_CREDENTIAL_FILE="${CREDENTIAL_PATH}" \
    OMS_PROTOCOL_GATE_PROFILE="suite" \
    OMS_PROTOCOL_GATE_MAIL_SMOKE_SCRIPT="${SMOKE_PATH}" \
    OMS_PROTOCOL_GATE_CONTACTS_SMOKE_SCRIPT="${CONTACTS_SMOKE_PATH}" \
    OMS_PROTOCOL_GATE_CALENDAR_SMOKE_SCRIPT="${CALENDAR_SMOKE_PATH}" \
    OMS_PROTOCOL_GATE_MYSQL_BIN="${MYSQL_PATH}" \
    OMS_PROTOCOL_GATE_FAKE_RESIDUE="missing" \
    bash "${GATE_SCRIPT}" "${CONFIG_PATH}" >"${OUTPUT_PATH}" 2>&1; then
    echo "FAIL: protocol release gate accepted cleanup without residue proof" >&2
    exit 1
fi
grep -Fq 'Synthetic protocol canary cleanup returned no valid residue proof' "${OUTPUT_PATH}"

echo "PASS: protocol release gate rejects residual protocol canary artifacts"

cat > "${CONTACTS_SMOKE_PATH}" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
echo 'contacts smoke accidentally did nothing'
EOF
chmod 0755 "${CONTACTS_SMOKE_PATH}"

if OMS_PROTOCOL_GATE_CREDENTIAL_FILE="${CREDENTIAL_PATH}" \
    OMS_PROTOCOL_GATE_PROFILE="suite" \
    OMS_PROTOCOL_GATE_MAIL_SMOKE_SCRIPT="${SMOKE_PATH}" \
    OMS_PROTOCOL_GATE_CONTACTS_SMOKE_SCRIPT="${CONTACTS_SMOKE_PATH}" \
    OMS_PROTOCOL_GATE_CALENDAR_SMOKE_SCRIPT="${CALENDAR_SMOKE_PATH}" \
    OMS_PROTOCOL_GATE_MYSQL_BIN="${MYSQL_PATH}" \
    bash "${GATE_SCRIPT}" "${CONFIG_PATH}" >"${OUTPUT_PATH}" 2>&1; then
    echo "FAIL: protocol release gate accepted a smoke script without its own PASS marker" >&2
    exit 1
fi
grep -Fq 'Authenticated protocol smoke returned no PASS marker' "${OUTPUT_PATH}"

echo "PASS: protocol release gate requires proof from every configured smoke"

: > "${CLEANUP_LOG}"
OMS_PROTOCOL_GATE_CREDENTIAL_FILE="${CREDENTIAL_PATH}" \
OMS_PROTOCOL_GATE_PROFILE="auto" \
OMS_PROTOCOL_GATE_PIM_MARKER="${TEST_ROOT}/not-installed/eas-pim-sync.js" \
OMS_PROTOCOL_GATE_MAIL_SMOKE_SCRIPT="${SMOKE_PATH}" \
OMS_PROTOCOL_GATE_CONTACTS_SMOKE_SCRIPT="${TEST_ROOT}/missing-contacts-smoke.sh" \
OMS_PROTOCOL_GATE_CALENDAR_SMOKE_SCRIPT="${TEST_ROOT}/missing-calendar-smoke.sh" \
OMS_PROTOCOL_GATE_MYSQL_BIN="${MYSQL_PATH}" \
    bash "${GATE_SCRIPT}" "${CONFIG_PATH}" >"${OUTPUT_PATH}" 2>&1
grep -Fq 'PASS: fake dual-protocol smoke completed' "${OUTPUT_PATH}"
grep -Fq 'PROFILE=mail' "${OUTPUT_PATH}"
if grep -Fq 'contacts smoke accidentally did nothing' "${OUTPUT_PATH}"; then
    echo "FAIL: compatibility pre-gate ran the PIM smoke before the engine was installed" >&2
    exit 1
fi
if grep -Fq 'oms_protocol_contact_targets' "${CLEANUP_LOG}"; then
    echo "FAIL: compatibility pre-gate required the post-deploy Contacts schema" >&2
    exit 1
fi

echo "PASS: protocol release pre-gate remains compatible with the installed artifact"

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

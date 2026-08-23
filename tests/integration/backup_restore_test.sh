#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
BACKUP_SCRIPT="${PROJECT_ROOT}/functions/backup_restore.sh"
TEST_ROOT=$(mktemp -d)
trap 'rm -rf -- "${TEST_ROOT}"' EXIT

LIVE_ROOT="${TEST_ROOT}/live"
BACKUP_ROOT="${TEST_ROOT}/backups"
STATE_ROOT="${TEST_ROOT}/state"
BIN_ROOT="${TEST_ROOT}/bin"
EVENT_LOG="${TEST_ROOT}/events.log"
SERVICE_STATE="${TEST_ROOT}/services.state"
INSTALL_CONFIG="${TEST_ROOT}/config.conf"
IMPORT_COUNT="${STATE_ROOT}/import.count"
HEALTH_COUNT="${STATE_ROOT}/health.count"
RSYNC_FAIL_STATE="${STATE_ROOT}/rsync-fail.state"

fail() {
    echo "FAIL: $*" >&2
    exit 1
}

assert_contains() {
    local file="$1"
    local expected="$2"
    grep -Fq -- "${expected}" "${file}" || fail "Expected ${file} to contain: ${expected}"
}

assert_absent() {
    local path="$1"
    [[ ! -e "${path}" && ! -L "${path}" ]] || fail "Expected path to be absent: ${path}"
}

assert_equals() {
    local expected="$1"
    local actual="$2"
    local label="$3"
    [[ "${actual}" == "${expected}" ]] \
        || fail "${label}: expected '${expected}', got '${actual}'"
}

assert_event_count() {
    local expected="$1"
    local event="$2"
    local actual
    actual=$(grep -Fxc -- "${event}" "${EVENT_LOG}" || true)
    if [[ "${actual}" != "${expected}" ]]; then
        sed 's/^/EVENT: /' "${EVENT_LOG}" >&2
        fail "event count for ${event}: expected '${expected}', got '${actual}'"
    fi
}

first_event_line() {
    grep -nF -m1 -- "$1" "${EVENT_LOG}" | cut -d: -f1
}

last_event_line() {
    grep -nF -- "$1" "${EVENT_LOG}" | tail -n 1 | cut -d: -f1
}

assert_event_before() {
    local earlier="$1"
    local later="$2"
    local label="$3"
    local earlier_line
    local later_line
    earlier_line=$(last_event_line "${earlier}")
    later_line=$(first_event_line "${later}")
    if [[ -z "${earlier_line}" || -z "${later_line}" \
        || "${earlier_line}" -ge "${later_line}" ]]; then
        sed 's/^/EVENT: /' "${EVENT_LOG}" >&2
        fail "${label}: expected ${earlier} before ${later}"
    fi
}

assert_exact_service_state() {
    local active_unit
    local leaked_sentinel
    for active_unit in monit.service nginx.service postfix.service dovecot.service rspamd.service openmailstack.service; do
        assert_equals active \
            "$(awk -F= -v unit="${active_unit}" '$1 == unit { print $2 }' "${SERVICE_STATE}")" \
            "${active_unit} activity"
    done
    assert_equals inactive \
        "$(awk -F= '$1 == "openmailstack-scheduler-worker.service" { print $2 }' "${SERVICE_STATE}")" \
        "inactive Scheduler worker activity"
    if [[ -d "$(fixture_path /var/vmail)" ]]; then
        leaked_sentinel=$(find "$(fixture_path /var/vmail)" -maxdepth 1 \
            -name '.oms-backup-watch-*' -print -quit)
        [[ -z "${leaked_sentinel}" ]] \
            || fail "Mail-store watcher sentinel leaked after backup recovery"
    fi
}

reset_fake_counters() {
    rm -f -- \
        "${IMPORT_COUNT}" \
        "${HEALTH_COUNT}" \
        "${RSYNC_FAIL_STATE}" \
        "${STATE_ROOT}/start-fail.state" \
        "${TEST_ROOT}/imported.sql"
}

fixture_path() {
    printf '%s%s\n' "${LIVE_ROOT}" "$1"
}

prepare_live_inventory() {
    local relative_path
    local source_path

    rm -rf -- "${LIVE_ROOT}"
    mkdir -p "${LIVE_ROOT}"

    for relative_path in \
        /var/vmail \
        /var/spool/postfix \
        /etc/openmailstack \
        /etc/mysql \
        /etc/postfix \
        /etc/dovecot \
        /etc/nginx \
        /etc/rspamd \
        /var/lib/rspamd/dkim \
        /etc/letsencrypt \
        /etc/ssl/openmailstack \
        /opt/openmailstack-backend \
        /var/www/openmailstack \
        /var/www/postfixadmin \
        /var/www/roundcube \
        /var/www/openmailstack-admin \
        /var/lib/openmailstack \
        /etc/systemd/system/dovecot.service.d \
        /etc/fail2ban \
        /etc/monit \
        /etc/monit.d; do
        source_path=$(fixture_path "${relative_path}")
        mkdir -p "${source_path}"
        printf 'fixture:%s\n' "${relative_path}" > "${source_path}/fixture.txt"
    done

    for relative_path in \
        /etc/systemd/system/openmailstack.service \
        /etc/systemd/system/openmailstack-scheduler-worker.service \
        /etc/systemd/system/openmailstack-dkim-sync.service \
        /etc/systemd/system/openmailstack-dkim-sync.timer \
        /etc/systemd/system/openmailstack-spam-map-sync.service \
        /etc/systemd/system/openmailstack-spam-map-sync.timer \
        /etc/systemd/system/openmailstack-rspamd-health.service \
        /etc/systemd/system/openmailstack-rspamd-health.timer \
        /usr/local/sbin/openmailstack-remediate \
        /usr/local/sbin/openmailstack-dkim-sync \
        /usr/local/sbin/openmailstack-spam-map-sync \
        /usr/local/sbin/openmailstack-rspamd-health \
        /usr/local/sbin/openmailstack-rspamd-recover \
        /usr/local/bin/quarantine_filter.php \
        /etc/sudoers.d/openmailstack-remediate; do
        source_path=$(fixture_path "${relative_path}")
        mkdir -p "$(dirname "${source_path}")"
        printf 'fixture:%s\n' "${relative_path}" > "${source_path}"
    done

    mkdir -p \
        "$(fixture_path /etc/nginx)/sites-available" \
        "$(fixture_path /etc/nginx)/sites-enabled"
    printf '%s\n' 'server {}' \
        > "$(fixture_path /etc/nginx)/sites-available/mailserver.conf"
    ln -s -- /etc/nginx/sites-available/mailserver.conf \
        "$(fixture_path /etc/nginx)/sites-enabled/mailserver.conf"

    mkdir -p \
        "$(fixture_path /etc/ssl/certs)" \
        "$(fixture_path /etc/ssl/private)" \
        "$(fixture_path /etc/dovecot/private)"
    printf '%s\n' 'fixture Dovecot fallback certificate' \
        > "$(fixture_path /etc/ssl/certs/ssl-cert-snakeoil.pem)"
    printf '%s\n' 'fixture Dovecot fallback key' \
        > "$(fixture_path /etc/ssl/private/ssl-cert-snakeoil.key)"
    ln -s -- /etc/ssl/certs/ssl-cert-snakeoil.pem \
        "$(fixture_path /etc/dovecot/private/dovecot.pem)"
    ln -s -- /etc/ssl/private/ssl-cert-snakeoil.key \
        "$(fixture_path /etc/dovecot/private/dovecot.key)"

    # Runtime IPC objects can remain in a quiesced Postfix spool. They are
    # recreated by the service and must never make a portable snapshot fail
    # validation or be restored as live endpoints.
    mkfifo "$(fixture_path /var/spool/postfix)/runtime.pipe"

    printf '%s\n' 'FIRST_DOMAIN=example.test' > "${INSTALL_CONFIG}"
}

write_service_state() {
    cat > "${SERVICE_STATE}" <<'EOF'
monit.service=active
nginx.service=active
postfix.service=active
dovecot.service=active
rspamd.service=active
openmailstack.service=active
openmailstack-scheduler-worker.service=inactive
openmailstack-dkim-sync.service=inactive
openmailstack-dkim-sync.timer=inactive
openmailstack-spam-map-sync.service=inactive
openmailstack-spam-map-sync.timer=inactive
openmailstack-rspamd-health.service=inactive
openmailstack-rspamd-health.timer=inactive
certbot.timer=inactive
EOF
}

prepare_fake_commands() {
    mkdir -p "${BIN_ROOT}" "${STATE_ROOT}"

    cat > "${BIN_ROOT}/systemctl" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
command_name="${1:-}"
shift || true
unit_name="${*: -1}"
state_for() {
    awk -F= -v unit="$1" '$1 == unit { print $2; found=1 } END { if (!found) print "not-found" }' "${FAKE_SERVICE_STATE}"
}
set_state() {
    local unit="$1"
    local state="$2"
    awk -F= -v unit="${unit}" -v state="${state}" '
        BEGIN { updated=0 }
        $1 == unit { print unit "=" state; updated=1; next }
        { print }
        END { if (!updated) print unit "=" state }
    ' "${FAKE_SERVICE_STATE}" > "${FAKE_SERVICE_STATE}.tmp"
    mv "${FAKE_SERVICE_STATE}.tmp" "${FAKE_SERVICE_STATE}"
}
case "${command_name}" in
    show)
        state=$(state_for "${unit_name}")
        if [[ " $* " == *" --property=LoadState "* ]]; then
            [[ "${state}" == "not-found" ]] && printf '%s\n' 'not-found' || printf '%s\n' 'loaded'
        elif [[ " $* " == *" --property=ActiveState "* ]]; then
            printf '%s\n' "${state}"
        else
            echo "Unexpected show property: $*" >&2
            exit 64
        fi
        ;;
    is-active)
        [[ "$(state_for "${unit_name}")" == "active" ]]
        ;;
    stop)
        printf 'STOP:%s\n' "${unit_name}" >> "${FAKE_EVENT_LOG}"
        if [[ "${FAKE_STOP_FAIL_UNIT:-}" == "${unit_name}" ]]; then
            exit 42
        fi
        set_state "${unit_name}" inactive
        ;;
    start)
        printf 'START:%s\n' "${unit_name}" >> "${FAKE_EVENT_LOG}"
        if [[ "${FAKE_START_FAIL_UNIT:-}" == "${unit_name}" ]]; then
            if [[ "${FAKE_START_FAIL_MODE:-always}" == "always" \
                || ! -e "${FAKE_START_FAIL_STATE}" ]]; then
                : > "${FAKE_START_FAIL_STATE}"
                exit 42
            fi
        fi
        set_state "${unit_name}" active
        ;;
    daemon-reload)
        printf '%s\n' 'DAEMON_RELOAD' >> "${FAKE_EVENT_LOG}"
        ;;
    *)
        echo "Unexpected systemctl call: ${command_name} $*" >&2
        exit 64
        ;;
esac
EOF

    cat > "${BIN_ROOT}/mariadb-dump" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf 'DUMP:%s\n' "$*" >> "${FAKE_EVENT_LOG}"
case "${FAKE_DUMP_MODE:-ok}" in
    ok)
        if [[ -n "${FAKE_DUMP_SOURCE_FILE:-}" ]]; then
            cat -- "${FAKE_DUMP_SOURCE_FILE}"
        else
            printf '%s\n' '-- complete fixture database dump'
            database_mode=0
            for argument in "$@"; do
                if [[ "${argument}" == "--databases" ]]; then
                    database_mode=1
                    continue
                fi
                if [[ "${database_mode}" == "1" ]]; then
                    printf 'DROP DATABASE IF EXISTS `%s`;\n' "${argument}"
                    printf 'CREATE DATABASE `%s`;\n' "${argument}"
                fi
            done
        fi
        ;;
    empty) exit 0 ;;
    fail) printf '%s\n' 'fixture dump failed' >&2; exit 42 ;;
esac
EOF

    cat > "${BIN_ROOT}/mariadb" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
count=0
[[ ! -f "${FAKE_IMPORT_COUNT}" ]] || count=$(<"${FAKE_IMPORT_COUNT}")
count=$((count + 1))
printf '%s\n' "${count}" > "${FAKE_IMPORT_COUNT}"
printf 'IMPORT_ATTEMPT:%s\n' "${count}" >> "${FAKE_EVENT_LOG}"
case "${FAKE_IMPORT_MODE:-ok}" in
    ok) ;;
    fail) exit 42 ;;
    fail-first) [[ "${count}" -gt 1 ]] || exit 42 ;;
    *) exit 64 ;;
esac
cat > "${FAKE_IMPORTED_SQL}"
printf '%s\n' 'IMPORT' >> "${FAKE_EVENT_LOG}"
EOF

    cat > "${BIN_ROOT}/healthcheck" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' 'HEALTH' >> "${FAKE_EVENT_LOG}"
sleep "${FAKE_HEALTH_DELAY_SECONDS:-0}"
count=0
[[ ! -f "${FAKE_HEALTH_COUNT}" ]] || count=$(<"${FAKE_HEALTH_COUNT}")
count=$((count + 1))
printf '%s\n' "${count}" > "${FAKE_HEALTH_COUNT}"
case "${FAKE_HEALTH_MODE:-ok}" in
    ok) ;;
    fail) exit 42 ;;
    fail-on:*) [[ "${count}" != "${FAKE_HEALTH_MODE#fail-on:}" ]] || exit 42 ;;
    fail-first:*) [[ "${count}" -gt "${FAKE_HEALTH_MODE#fail-first:}" ]] || exit 42 ;;
    *) exit 64 ;;
esac
EOF

    cat > "${BIN_ROOT}/move-watch" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
trap 'printf "%s\n" WATCH_STOP >> "${FAKE_EVENT_LOG}"; exit 0' TERM INT HUP
watch_root=""
control_dir=""
sentinel_name=""
while [[ $# -gt 0 ]]; do
    case "$1" in
        --root) watch_root="$2"; shift 2 ;;
        --control-dir) control_dir="$2"; shift 2 ;;
        --sentinel) sentinel_name="$2"; shift 2 ;;
        *) exit 64 ;;
    esac
done
[[ -n "${watch_root}" && -n "${control_dir}" && -n "${sentinel_name}" ]] || exit 64
printf '%s\n' WATCH_START >> "${FAKE_EVENT_LOG}"
proc_stat=$(<"/proc/$$/stat")
proc_tail="${proc_stat##*) }"
read -r -a proc_fields <<< "${proc_tail}"
[[ "${proc_fields[19]:-}" =~ ^[0-9]+$ ]] || exit 65
ready_start_time="${proc_fields[19]}"
printf 'WATCH_IDENTITY:%s:%s\n' "$$" "${ready_start_time}" >> "${FAKE_EVENT_LOG}"
if [[ "${FAKE_MOVE_WATCH_MODE:-ok}" == "stop-before-ready" ]]; then
    kill -STOP "$$"
fi
if [[ "${FAKE_MOVE_WATCH_MODE:-ok}" == "forged-ready-identity" ]]; then
    ready_start_time=$((ready_start_time + 1))
fi
printf 'Watches established: %s:%s\n' "$$" "${ready_start_time}" >&2
if [[ "${FAKE_MOVE_WATCH_MODE:-ok}" == "exit-after-ready" ]]; then
    exit 42
fi
if [[ "${FAKE_MOVE_WATCH_MODE:-ok}" == "ignore-term" ]]; then
    trap '' TERM
fi
if [[ "${FAKE_MOVE_WATCH_MODE:-ok}" == "early-drain" ]]; then
    printf '%s\n' 'Drain complete.' >&2
fi
if [[ "${FAKE_MOVE_WATCH_MODE:-ok}" == "foreign-sentinel" ]]; then
    printf '%s\n' 'foreign sentinel' > "${control_dir}/${sentinel_name}"
fi
while :; do
    if [[ -e "${control_dir}/${sentinel_name}" ]]; then
        if [[ "${FAKE_MOVE_WATCH_MODE:-ok}" == "early-drain" \
            || "${FAKE_MOVE_WATCH_MODE:-ok}" == "foreign-sentinel" ]]; then
            sleep 0.01
            continue
        fi
        sentinel_token=$(<"${control_dir}/${sentinel_name}")
        [[ "${sentinel_token}" =~ ^[0-9a-f]{32}$ ]] || exit 65
        printf '%s\n' WATCH_DRAIN >> "${FAKE_EVENT_LOG}"
        printf 'Drain complete: %s\n' "${sentinel_token}" >&2
        while :; do
            sleep 0.01
        done
    fi
    sleep 0.01
done
EOF

    cat > "${BIN_ROOT}/ps" <<'EOF'
#!/usr/bin/env bash
exit 127
EOF

    cat > "${BIN_ROOT}/rsync" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
matches=0
phase="${OMS_BR_RSYNC_PHASE:-unspecified}"
source_argument="${@: -2:1}"
destination_argument="${@: -1}"
printf 'RSYNC:%s:%s\n' "${phase}" "${source_argument}" >> "${FAKE_EVENT_LOG}"
for argument in "$@"; do
    if [[ "${argument}" == "--delete" ]]; then
        printf 'RSYNC_DELETE:%s\n' "${phase}" >> "${FAKE_EVENT_LOG}"
    elif [[ "${argument}" == "--ignore-times" ]]; then
        printf 'RSYNC_IGNORE_TIMES:%s\n' "${phase}" >> "${FAKE_EVENT_LOG}"
    elif [[ "${argument}" == --files-from=* \
        && -n "${FAKE_UNCHANGED_MAILDIR_PATH:-}" ]]; then
        printf 'RSYNC_FILES_FROM_CHECK:%s\n' "${FAKE_UNCHANGED_MAILDIR_PATH}" \
            >> "${FAKE_EVENT_LOG}"
        while IFS= read -r -d '' forced_path; do
            if [[ "${forced_path}" == "${FAKE_UNCHANGED_MAILDIR_PATH}" ]]; then
                printf 'RSYNC_FORCED_PATH:%s\n' "${forced_path}" >> "${FAKE_EVENT_LOG}"
            fi
        done < "${argument#--files-from=}"
    fi
done
if [[ -n "${FAKE_RSYNC_FAIL_MATCH:-}" \
    && "${source_argument}" == *"${FAKE_RSYNC_FAIL_MATCH}"* \
    && ( -z "${FAKE_RSYNC_FAIL_PHASE:-}" \
        || "${phase}" == "${FAKE_RSYNC_FAIL_PHASE}" ) ]]; then
    matches=1
fi
if [[ "${matches}" == "1" ]]; then
    failure_status="${FAKE_RSYNC_FAIL_STATUS:-42}"
    [[ "${failure_status}" =~ ^[0-9]+$ ]] || exit 64
    failure_status=$((10#${failure_status}))
    (( failure_status >= 1 && failure_status <= 255 )) || exit 64
    case "${FAKE_RSYNC_FAIL_MODE:-once}" in
        always)
            printf '%s\n' 'RSYNC_FAIL' >> "${FAKE_EVENT_LOG}"
            printf 'RSYNC_FAIL_DETAIL:%s:%s\n' "${phase}" "${failure_status}" \
                >> "${FAKE_EVENT_LOG}"
            exit "${failure_status}"
            ;;
        once)
            if [[ ! -e "${FAKE_RSYNC_FAIL_STATE}" ]]; then
                : > "${FAKE_RSYNC_FAIL_STATE}"
                printf '%s\n' 'RSYNC_FAIL' >> "${FAKE_EVENT_LOG}"
                printf 'RSYNC_FAIL_DETAIL:%s:%s\n' "${phase}" "${failure_status}" \
                    >> "${FAKE_EVENT_LOG}"
                exit "${failure_status}"
            fi
            ;;
        *) exit 64 ;;
    esac
fi
if [[ "${phase}" == "live-precopy" \
    && "${FAKE_INOTIFY_OVERFLOW:-0}" == "1" ]]; then
    staging_root="${destination_argument%/payload/mail-store/}"
    [[ "${staging_root}" != "${destination_argument}" ]] || exit 64
    printf '%s\0%s\0' \
        "${source_argument%/}" 'Q_OVERFLOW' \
        >> "${staging_root}/mail-store-directory-moves.events"
fi
if [[ "${phase}" == "live-precopy" \
    && "${FAKE_MOVE_WATCH_MALFORMED:-0}" == "1" ]]; then
    staging_root="${destination_argument%/payload/mail-store/}"
    [[ "${staging_root}" != "${destination_argument}" ]] || exit 64
    printf '%s' "${source_argument%/}/truncated-directory" \
        >> "${staging_root}/mail-store-directory-moves.events"
fi
if [[ "${phase}" == "live-precopy" \
    && "${FAKE_MOVE_WATCH_CORRUPT_TAG:-0}" == "1" ]]; then
    staging_root="${destination_argument%/payload/mail-store/}"
    [[ "${staging_root}" != "${destination_argument}" ]] || exit 64
    printf '%s\0%s\0' \
        "${source_argument%/}/maildir" 'MOVED_TO,ISDIR,CORRUPT' \
        >> "${staging_root}/mail-store-directory-moves.events"
fi
if [[ "${phase}" == "live-precopy" \
    && "${FAKE_MUTATE_MAIL_STORE_AFTER_PRECOPY:-0}" == "1" ]]; then
    mutation_root="${source_argument%/}"
    [[ "${mutation_root}" == "${FAKE_PRECOPY_MUTATION_ROOT}" ]] || exit 64
    staging_root="${destination_argument%/payload/mail-store/}"
    [[ "${staging_root}" != "${destination_argument}" ]] || exit 64
    if [[ "${FAKE_SYNTHETIC_MOVE_EVENTS:-1}" == "1" ]]; then
        printf '%s\0%s\0' \
            "${mutation_root}/.aba-a" 'MOVED_FROM,ISDIR' \
            "${mutation_root}/.aba-temporary" 'MOVED_TO,ISDIR' \
            "${mutation_root}/.aba-b" 'MOVED_FROM,ISDIR' \
            "${mutation_root}/.aba-a" 'MOVED_TO,ISDIR' \
            "${mutation_root}/.aba-temporary" 'MOVED_FROM,ISDIR' \
            "${mutation_root}/.aba-b" 'MOVED_TO,ISDIR' \
            >> "${staging_root}/mail-store-directory-moves.events"
    fi
    mv -- "${mutation_root}/.aba-a" "${mutation_root}/.aba-temporary"
    mv -- "${mutation_root}/.aba-b" "${mutation_root}/.aba-a"
    mv -- "${mutation_root}/.aba-temporary" "${mutation_root}/.aba-b"
fi
"${FAKE_REAL_RSYNC}" "$@"
if [[ "${phase}" == "live-precopy" \
    && "${FAKE_MUTATE_MAIL_STORE_AFTER_PRECOPY:-0}" == "1" ]]; then
    mutation_root="${source_argument%/}"
    [[ "${mutation_root}" == "${FAKE_PRECOPY_MUTATION_ROOT}" ]] || exit 64
    mv -- "${mutation_root}/.aba-a" "${mutation_root}/.aba-temporary"
    mv -- "${mutation_root}/.aba-b" "${mutation_root}/.aba-a"
    mv -- "${mutation_root}/.aba-temporary" "${mutation_root}/.aba-b"
    mtime_reference=$(mktemp)
    touch -r "${mutation_root}/changed-after-precopy.txt" "${mtime_reference}"
    printf '%s' 'BBBB' > "${mutation_root}/changed-after-precopy.txt"
    touch -r "${mtime_reference}" "${mutation_root}/changed-after-precopy.txt"
    rm -f -- "${mtime_reference}"
    mtime_reference=$(mktemp)
    touch -r "${mutation_root}/maildir/cur/changed-message" "${mtime_reference}"
    printf '%s' 'DDDD' > "${mutation_root}/maildir/cur/changed-message"
    touch -r "${mtime_reference}" "${mutation_root}/maildir/cur/changed-message"
    rm -f -- "${mtime_reference}"
    mtime_reference=$(mktemp)
    touch -r "${mutation_root}/hardlinks/cur/primary" "${mtime_reference}"
    printf '%s' 'FFFF' > "${mutation_root}/hardlinks/cur/primary"
    touch -r "${mtime_reference}" "${mutation_root}/hardlinks/cur/primary"
    rm -f -- "${mtime_reference}"
    weird_file="${mutation_root}/--leading-name"
    mtime_reference=$(mktemp)
    touch -r "${weird_file}" "${mtime_reference}"
    printf '%s' 'HHHH' > "${weird_file}"
    touch -r "${mtime_reference}" "${weird_file}"
    rm -f -- "${mtime_reference}"
    mv -- "${mutation_root}/swap-a" "${mutation_root}/swap-temporary"
    mv -- "${mutation_root}/swap-b" "${mutation_root}/swap-a"
    mv -- "${mutation_root}/swap-temporary" "${mutation_root}/swap-b"
    rm -f -- "${mutation_root}/special-after-precopy"
    mkfifo "${mutation_root}/special-after-precopy"
    rm -f -- "${mutation_root}/removed-after-precopy.txt"
    printf '%s\n' 'created after live pre-copy' \
        > "${mutation_root}/created-after-precopy.txt"
    : > "${mutation_root}/.busy/dovecot-uidlist.tmp"
    rm -f -- "${mutation_root}/.busy/dovecot-uidlist.tmp"
fi
EOF

    cat > "${BIN_ROOT}/sha256sum" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' 'SHA256SUM' >> "${FAKE_EVENT_LOG}"
if [[ "${FAKE_SHA256SUM_MODE:-ok}" == "fail" ]]; then
    printf '%s\n' 'SHA256SUM_FAIL' >> "${FAKE_EVENT_LOG}"
    exit 42
fi
exec "${FAKE_REAL_SHA256SUM}" "$@"
EOF

    chmod 0755 "${BIN_ROOT}"/*
}

run_oms_command() {
    local timestamp="$1"
    local action="$2"
    shift 2
    local -a action_args=()
    case "${action}" in
        backup) action_args=(backup) ;;
        verify) action_args=(verify "$1"); shift ;;
        restore) action_args=(restore "$1" --confirm); shift ;;
        *) fail "Unknown test action: ${action}" ;;
    esac
    env \
        OMS_BACKUP_FIXTURE_MODE=1 \
        OMS_BACKUP_PATH_PREFIX="${LIVE_ROOT}" \
        OMS_BACKUP_ROOT="${BACKUP_ROOT}" \
        OMS_BACKUP_LOCK_FILE="${STATE_ROOT}/backup-restore.lock" \
        OMS_BACKUP_INSTALL_CONFIG="${INSTALL_CONFIG}" \
        OMS_BACKUP_SYSTEMCTL_BIN="${BIN_ROOT}/systemctl" \
        OMS_BACKUP_MYSQLDUMP_BIN="${BIN_ROOT}/mariadb-dump" \
        OMS_BACKUP_MYSQL_BIN="${BIN_ROOT}/mariadb" \
        OMS_BACKUP_HEALTHCHECK_BIN="${BIN_ROOT}/healthcheck" \
        OMS_BACKUP_MOVE_WATCH_BIN="${OMS_BACKUP_TEST_MOVE_WATCH_BIN:-${BIN_ROOT}/move-watch}" \
        OMS_BACKUP_RSYNC_BIN="${BIN_ROOT}/rsync" \
        OMS_BACKUP_TIMESTAMP="${timestamp}" \
        FAKE_SERVICE_STATE="${SERVICE_STATE}" \
        FAKE_EVENT_LOG="${EVENT_LOG}" \
        FAKE_IMPORTED_SQL="${TEST_ROOT}/imported.sql" \
        FAKE_IMPORT_COUNT="${IMPORT_COUNT}" \
        FAKE_HEALTH_COUNT="${HEALTH_COUNT}" \
        FAKE_RSYNC_FAIL_STATE="${RSYNC_FAIL_STATE}" \
        FAKE_START_FAIL_STATE="${STATE_ROOT}/start-fail.state" \
        FAKE_REAL_RSYNC="$(command -v rsync)" \
        FAKE_REAL_SHA256SUM="$(command -v sha256sum)" \
        PATH="${BIN_ROOT}:${PATH}" \
        "$@" \
        bash "${BACKUP_SCRIPT}" "${action_args[@]}"
}

run_backup_command() {
    local timestamp="$1"
    shift
    run_oms_command "${timestamp}" backup "$@"
}

run_verify_command() {
    local snapshot="$1"
    shift
    run_oms_command 20260815T000000Z verify "${snapshot}" "$@"
}

run_restore_command() {
    local timestamp="$1"
    local snapshot="$2"
    shift 2
    run_oms_command "${timestamp}" restore "${snapshot}" "$@"
}

regenerate_snapshot_checksums() {
    local snapshot="$1"

    bash -c '
        source "$1"
        oms_br_generate_checksums "$2" "$2/checksums.sha256"
    ' backup-restore-regenerate "${BACKUP_SCRIPT}" "${snapshot}"
    chmod 0600 -- "${snapshot}/checksums.sha256"
}

assert_metadata_rejected() {
    local snapshot="$1"
    local label="$2"

    regenerate_snapshot_checksums "${snapshot}"
    if run_verify_command "${snapshot}" >"${TEST_ROOT}/${label}.out" 2>&1; then
        fail "Verification accepted malformed service timing metadata: ${label}"
    fi
}

prepare_live_inventory
write_service_state
prepare_fake_commands
: > "${EVENT_LOG}"
printf '%s\n' 'removed after live pre-copy' \
    > "$(fixture_path /var/vmail)/removed-after-precopy.txt"
printf '%s' 'AAAA' > "$(fixture_path /var/vmail)/changed-after-precopy.txt"
mkdir -p \
    "$(fixture_path /var/vmail)/.aba-a/cur" \
    "$(fixture_path /var/vmail)/.aba-b/cur" \
    "$(fixture_path /var/vmail)/.busy/cur" \
    "$(fixture_path /var/vmail)/.stable/cur" \
    "$(fixture_path /var/vmail)/.cross/new" \
    "$(fixture_path /var/vmail)/.cross/tmp" \
    "$(fixture_path /var/vmail)/hardlinks/cur" \
    "$(fixture_path /var/vmail)/maildir/cur" \
    "$(fixture_path /var/vmail)/swap-a/cur" \
    "$(fixture_path /var/vmail)/swap-b/cur"
printf '%s' 'CCCC' > "$(fixture_path /var/vmail)/maildir/cur/changed-message"
printf '%s' 'IIII' > "$(fixture_path /var/vmail)/.aba-a/cur/message"
printf '%s' 'JJJJ' > "$(fixture_path /var/vmail)/.aba-b/cur/message"
touch -r \
    "$(fixture_path /var/vmail)/.aba-a/cur/message" \
    "$(fixture_path /var/vmail)/.aba-b/cur/message"
printf '%s' 'KKKK' > "$(fixture_path /var/vmail)/.aba-a/cur/shared"
ln \
    "$(fixture_path /var/vmail)/.aba-a/cur/shared" \
    "$(fixture_path /var/vmail)/.stable/cur/shared"
printf '%s' 'LLLL' > "$(fixture_path /var/vmail)/.aba-b/cur/shared"
touch -r \
    "$(fixture_path /var/vmail)/.aba-a/cur/shared" \
    "$(fixture_path /var/vmail)/.aba-b/cur/shared"
printf '%s' 'MMMM' > "$(fixture_path /var/vmail)/.busy/cur/unchanged"
printf '%s' 'EEEE' > "$(fixture_path /var/vmail)/hardlinks/cur/primary"
ln \
    "$(fixture_path /var/vmail)/hardlinks/cur/primary" \
    "$(fixture_path /var/vmail)/hardlinks/cur/secondary"
printf '%s' 'NNNN' > "$(fixture_path /var/vmail)/.cross/tmp/shared"
ln \
    "$(fixture_path /var/vmail)/.cross/tmp/shared" \
    "$(fixture_path /var/vmail)/.cross/new/shared"
printf '%s' 'GGGG' > "$(fixture_path /var/vmail)/--leading-name"
printf '%s' 'AAAA' > "$(fixture_path /var/vmail)/swap-a/cur/message"
printf '%s' 'BBBB' > "$(fixture_path /var/vmail)/swap-b/cur/message"
touch -r \
    "$(fixture_path /var/vmail)/swap-a/cur/message" \
    "$(fixture_path /var/vmail)/swap-b/cur/message"
printf '%s' 'stale' > "$(fixture_path /var/vmail)/special-after-precopy"

# $1 expands inside the isolated child shell.
# shellcheck disable=SC2016
DEFAULT_CONFIG_PATH=$(env -u OMS_BACKUP_INSTALL_CONFIG \
    bash -c 'source "$1"; oms_br_actual_path installer-config ignored' \
    backup-restore-default-path "${BACKUP_SCRIPT}")
assert_equals "${PROJECT_ROOT}/config.conf" "${DEFAULT_CONFIG_PATH}" \
    "canonical default installer config path"
[[ "${DEFAULT_CONFIG_PATH}" != */../* ]] \
    || fail "Default installer config path retained a traversal component"

# Keep seeded inode ctimes older than the deliberately backdated pre-copy marker.
sleep 2
run_backup_command 20260815T120000Z \
    FAKE_MUTATE_MAIL_STORE_AFTER_PRECOPY=1 \
    FAKE_PRECOPY_MUTATION_ROOT="$(fixture_path /var/vmail)" \
    FAKE_UNCHANGED_MAILDIR_PATH=./.busy/cur/unchanged
SNAPSHOT="${BACKUP_ROOT}/oms-backup-20260815T120000Z"
[[ -d "${SNAPSHOT}" ]] || fail "Successful backup was not atomically promoted"
assert_absent "${SNAPSHOT}.incomplete"
assert_absent "${SNAPSHOT}/mail-store-watch-control"
[[ "$(stat -c '%U:%G:%a' "${SNAPSHOT}")" == "root:root:700" ]] \
    || fail "Snapshot root is not root-only"
[[ -s "${SNAPSHOT}/databases.sql" ]] || fail "Database dump is absent or empty"
assert_contains "${SNAPSHOT}/snapshot.meta" $'encryption\tnone'
assert_contains "${SNAPSHOT}/snapshot.meta" $'point_in_time_recovery\tnot_available'
assert_contains "${SNAPSHOT}/snapshot.meta" \
    $'database_restore_semantics\tlogical_replace_listed_databases'
assert_contains "${SNAPSHOT}/snapshot.meta" \
    $'database_scope\tconfigured_openmailstack_databases'
assert_contains "${SNAPSHOT}/snapshot.meta" $'mysql_configuration\tnot_included'
assert_contains "${SNAPSHOT}/snapshot.meta" $'service_quiescence_mode\tmanaged'
QUIESCENCE_MS=$(awk -F'\t' '$1 == "service_quiescence_ms" { print $2 }' \
    "${SNAPSHOT}/snapshot.meta")
[[ "${QUIESCENCE_MS}" =~ ^[0-9]+$ ]] \
    || fail "Managed backup did not record a numeric service quiescence duration"
OUTAGE_WINDOW_MS=$(awk -F'\t' '$1 == "service_outage_window_ms" { print $2 }' \
    "${SNAPSHOT}/snapshot.meta")
[[ "${OUTAGE_WINDOW_MS}" =~ ^[0-9]+$ ]] \
    || fail "Managed backup did not record a numeric service outage window"
(( OUTAGE_WINDOW_MS >= QUIESCENCE_MS )) \
    || fail "Service outage window ended before command-level quiescence"
assert_equals $'postfixadmin\nroundcube\nvmail' "$(<"${SNAPSHOT}/databases.tsv")" \
    "configured database manifest"
assert_contains "${SNAPSHOT}/inventory.tsv" \
    $'database\tlogical:oms-databases\tpresent\tfile'
assert_contains "${SNAPSHOT}/inventory.tsv" $'mail-store\t/var/vmail\tpresent\tdirectory'
assert_absent "${SNAPSHOT}/payload/mail-store/removed-after-precopy.txt"
assert_contains "${SNAPSHOT}/payload/mail-store/created-after-precopy.txt" \
    'created after live pre-copy'
assert_equals BBBB \
    "$(<"${SNAPSHOT}/payload/mail-store/changed-after-precopy.txt")" \
    "same-size and same-mtime mail-store convergence"
assert_equals DDDD \
    "$(<"${SNAPSHOT}/payload/mail-store/maildir/cur/changed-message")" \
    "same-inode Maildir message convergence"
assert_equals FFFF \
    "$(<"${SNAPSHOT}/payload/mail-store/hardlinks/cur/primary")" \
    "hardlinked Maildir message convergence"
assert_equals \
    "$(stat -c '%d:%i' -- "${SNAPSHOT}/payload/mail-store/hardlinks/cur/primary")" \
    "$(stat -c '%d:%i' -- "${SNAPSHOT}/payload/mail-store/hardlinks/cur/secondary")" \
    "hardlinked Maildir message topology"
assert_equals \
    "$(stat -c '%d:%i' -- "${SNAPSHOT}/payload/mail-store/.cross/tmp/shared")" \
    "$(stat -c '%d:%i' -- "${SNAPSHOT}/payload/mail-store/.cross/new/shared")" \
    "cross-class Maildir hardlink topology"
assert_equals HHHH \
    "$(<"${SNAPSHOT}/payload/mail-store/--leading-name")" \
    "leading-dash mail-store path convergence"
assert_equals BBBB \
    "$(<"${SNAPSHOT}/payload/mail-store/swap-a/cur/message")" \
    "Maildir directory-swap convergence at the first path"
assert_equals AAAA \
    "$(<"${SNAPSHOT}/payload/mail-store/swap-b/cur/message")" \
    "Maildir directory-swap convergence at the second path"
assert_equals IIII \
    "$(<"${SNAPSHOT}/payload/mail-store/.aba-a/cur/message")" \
    "Maildir ABA folder convergence at the first path"
assert_equals JJJJ \
    "$(<"${SNAPSHOT}/payload/mail-store/.aba-b/cur/message")" \
    "Maildir ABA folder convergence at the second path"
assert_equals KKKK \
    "$(<"${SNAPSHOT}/payload/mail-store/.aba-a/cur/shared")" \
    "Maildir ABA hardlink convergence"
assert_equals \
    "$(stat -c '%d:%i' -- "${SNAPSHOT}/payload/mail-store/.aba-a/cur/shared")" \
    "$(stat -c '%d:%i' -- "${SNAPSHOT}/payload/mail-store/.stable/cur/shared")" \
    "Maildir ABA cross-folder hardlink topology"
assert_equals MMMM \
    "$(<"${SNAPSHOT}/payload/mail-store/.busy/cur/unchanged")" \
    "unchanged message below a Maildir with control-file entry churn"
assert_contains "${EVENT_LOG}" 'RSYNC_FILES_FROM_CHECK:./.busy/cur/unchanged'
if grep -Fq 'RSYNC_FORCED_PATH:./.busy/cur/unchanged' "${EVENT_LOG}"; then
    fail "Ordinary Maildir entry churn forced an unchanged message into stopped convergence"
fi
assert_absent "${SNAPSHOT}/payload/mail-store/special-after-precopy"
assert_contains "${SNAPSHOT}/inventory.tsv" \
    $'postfix-spool\t/var/spool/postfix\tpresent\tdirectory'
assert_absent "${SNAPSHOT}/payload/postfix-spool/runtime.pipe"
assert_contains "${SNAPSHOT}/payload/postfix-spool/fixture.txt" \
    'fixture:/var/spool/postfix'
assert_contains "${SNAPSHOT}/inventory.tsv" $'oms-config\t/etc/openmailstack\tpresent\tdirectory'
if grep -Fq $'mysql-config\t/etc/mysql\t' "${SNAPSHOT}/inventory.tsv"; then
    fail "Snapshot unexpectedly captured package-managed MariaDB configuration"
fi
assert_absent "${SNAPSHOT}/payload/mysql-config"
assert_contains "${SNAPSHOT}/inventory.tsv" $'dkim-keys\t/var/lib/rspamd/dkim\tpresent\tdirectory'
assert_contains "${SNAPSHOT}/inventory.tsv" \
    $'dovecot-fallback-cert\t/etc/ssl/certs/ssl-cert-snakeoil.pem\tpresent\tfile'
assert_contains "${SNAPSHOT}/inventory.tsv" \
    $'dovecot-fallback-key\t/etc/ssl/private/ssl-cert-snakeoil.key\tpresent\tfile'
assert_contains "${SNAPSHOT}/inventory.tsv" $'tls-letsencrypt\t/etc/letsencrypt\tpresent\tdirectory'
assert_contains "${SNAPSHOT}/inventory.tsv" $'modern-backend\t/opt/openmailstack-backend\tpresent\tdirectory'
assert_contains "${SNAPSHOT}/inventory.tsv" $'modern-frontend\t/var/www/openmailstack\tpresent\tdirectory'
assert_contains "${SNAPSHOT}/inventory.tsv" $'admin-portal\t/var/www/openmailstack-admin\tpresent\tdirectory'
assert_contains "${SNAPSHOT}/inventory.tsv" $'backend-unit\t/etc/systemd/system/openmailstack.service\tpresent\tfile'
assert_contains "${SNAPSHOT}/inventory.tsv" \
    $'quarantine-filter\t/usr/local/bin/quarantine_filter.php\tpresent\tfile'
assert_contains "${EVENT_LOG}" '--add-drop-database'
assert_contains "${EVENT_LOG}" '--databases postfixadmin roundcube vmail'
assert_contains "${SNAPSHOT}/databases.sql" $'DROP DATABASE IF EXISTS `postfixadmin`;'
assert_equals /etc/nginx/sites-available/mailserver.conf \
    "$(readlink -- "${SNAPSHOT}/payload/nginx-config/sites-enabled/mailserver.conf")" \
    "bounded absolute Nginx symlink"
(cd "${SNAPSHOT}" && sha256sum -c checksums.sha256 >/dev/null) \
    || fail "Promoted snapshot checksums do not verify"
[[ "$(awk -F= '$1 == "openmailstack-scheduler-worker.service" { print $2 }' "${SERVICE_STATE}")" == "inactive" ]] \
    || fail "Backup started a service that was previously inactive"
grep -Fq 'START:openmailstack.service' "${EVENT_LOG}" || fail "Backup did not restore the active backend service"
assert_equals 'STOP:monit.service' "$(grep '^STOP:' "${EVENT_LOG}" | head -n 1)" \
    "first quiesced service"
assert_equals 'START:monit.service' "$(grep '^START:' "${EVENT_LOG}" | tail -n 1)" \
    "last resumed service"
if grep -Fq 'START:openmailstack-scheduler-worker.service' "${EVENT_LOG}"; then
    fail "Backup started the previously inactive Scheduler worker"
fi
assert_event_before 'STOP:' 'DUMP:' \
    "database capture began before services were quiesced"
if grep -Fq 'WATCH_START' "${EVENT_LOG}"; then
    assert_event_before 'WATCH_START' 'RSYNC:live-precopy:' \
        "mail-store directory move watch did not become ready before live pre-copy"
fi
assert_event_before 'RSYNC:live-precopy:' 'STOP:' \
    "mail-store pre-copy did not complete before service quiescence"
if grep -Fq 'WATCH_STOP' "${EVENT_LOG}"; then
    assert_event_before 'STOP:' 'WATCH_DRAIN' \
        "mail-store directory move watch drained before service quiescence"
    assert_event_before 'WATCH_DRAIN' 'WATCH_STOP' \
        "mail-store directory move watch stopped before its drain barrier"
    assert_event_before 'WATCH_STOP' 'DUMP:' \
        "database capture began before the mail-store directory move watch stopped"
fi
assert_event_before 'DUMP:' 'RSYNC:quiesced-convergence:' \
    "inventory capture began before the database dump completed"
assert_event_before 'RSYNC:quiesced-convergence:' 'START:' \
    "services resumed before the immutable inventory capture completed"
assert_contains "${EVENT_LOG}" 'RSYNC_DELETE:quiesced-convergence'
assert_contains "${EVENT_LOG}" 'RSYNC_IGNORE_TIMES:quiesced-changed-files'
assert_event_before 'RSYNC:quiesced-changed-files:' 'START:' \
    "services resumed before changed mail-store files converged"
assert_event_before 'START:' 'HEALTH' \
    "health verification ran before services resumed"
assert_event_before 'HEALTH' 'SHA256SUM' \
    "snapshot checksums ran before service health recovered"

echo 'PASS: complete snapshot is root-only, checksummed, explicit, and restores exact service activity'

write_service_state
reset_fake_counters
: > "${EVENT_LOG}"
if run_backup_command 20260815T120010Z \
    FAKE_RSYNC_FAIL_MATCH=/var/vmail/ \
    FAKE_RSYNC_FAIL_PHASE=live-precopy \
    FAKE_RSYNC_FAIL_MODE=always \
    FAKE_RSYNC_FAIL_STATUS=42 >"${TEST_ROOT}/precopy-failure.out" 2>&1; then
    fail "Backup accepted a hard live mail-store pre-copy failure"
fi
assert_absent "${BACKUP_ROOT}/oms-backup-20260815T120010Z"
[[ -d "${BACKUP_ROOT}/oms-backup-20260815T120010Z.incomplete" ]] \
    || fail "Failed live pre-copy did not remain visibly incomplete"
if grep -Eq '^(STOP:|DUMP:)' "${EVENT_LOG}"; then
    fail "Hard live pre-copy failure quiesced services or dumped databases"
fi
assert_exact_service_state

echo 'PASS: hard live pre-copy failure aborts before service quiescence'

write_service_state
reset_fake_counters
: > "${EVENT_LOG}"
if run_backup_command 20260815T120006Z \
    OMS_BACKUP_MOVE_WATCH_BIN= \
    OMS_BACKUP_PYTHON_BIN="${BIN_ROOT}/missing-python" \
    >"${TEST_ROOT}/watch-runtime-missing.out" 2>&1; then
    fail "Backup accepted a missing raw-watcher runtime"
fi
assert_absent "${BACKUP_ROOT}/oms-backup-20260815T120006Z"
[[ -d "${BACKUP_ROOT}/oms-backup-20260815T120006Z.incomplete" ]] \
    || fail "Missing watcher runtime did not remain visibly incomplete"
if grep -Eq '^(STOP:|DUMP:)' "${EVENT_LOG}"; then
    fail "Missing watcher runtime reached service quiescence"
fi
assert_exact_service_state

echo 'PASS: missing raw-watcher runtime fails before service quiescence'

write_service_state
reset_fake_counters
: > "${EVENT_LOG}"
WATCH_NEVER_READY_STARTED=$(date +%s)
if run_backup_command 20260815T120042Z \
    OMS_BACKUP_MOVE_WATCH_BIN="${BIN_ROOT}/move-watch" \
    OMS_BACKUP_TEST_MOVE_WATCH_READY_ATTEMPTS=5 \
    FAKE_MOVE_WATCH_MODE=stop-before-ready \
    >"${TEST_ROOT}/watch-never-ready.out" 2>&1; then
    fail "Backup accepted a directory move watcher that never became ready"
fi
WATCH_NEVER_READY_ELAPSED=$(( $(date +%s) - WATCH_NEVER_READY_STARTED ))
(( WATCH_NEVER_READY_ELAPSED < 10 )) \
    || fail "Never-ready watcher cleanup took ${WATCH_NEVER_READY_ELAPSED}s"
assert_absent "${BACKUP_ROOT}/oms-backup-20260815T120042Z"
[[ -d "${BACKUP_ROOT}/oms-backup-20260815T120042Z.incomplete" ]] \
    || fail "Never-ready watcher failure did not remain visibly incomplete"
assert_event_count 1 WATCH_START
WATCH_NEVER_READY_IDENTITY=$(awk -F: \
    '$1 == "WATCH_IDENTITY" { print $2 ":" $3; exit }' "${EVENT_LOG}")
[[ "${WATCH_NEVER_READY_IDENTITY}" =~ ^[0-9]+:[0-9]+$ ]] \
    || fail "Never-ready watcher did not record its exact process identity"
WATCH_NEVER_READY_PID="${WATCH_NEVER_READY_IDENTITY%%:*}"
WATCH_NEVER_READY_START_TIME="${WATCH_NEVER_READY_IDENTITY#*:}"
if [[ -r "/proc/${WATCH_NEVER_READY_PID}/stat" ]]; then
    WATCH_NEVER_READY_STAT=$(<"/proc/${WATCH_NEVER_READY_PID}/stat")
    WATCH_NEVER_READY_TAIL="${WATCH_NEVER_READY_STAT##*) }"
    read -r -a WATCH_NEVER_READY_FIELDS <<< "${WATCH_NEVER_READY_TAIL}"
    [[ "${WATCH_NEVER_READY_FIELDS[19]:-}" \
        != "${WATCH_NEVER_READY_START_TIME}" ]] \
        || fail "Never-ready watcher remained alive after bounded cleanup"
fi
assert_absent \
    "${BACKUP_ROOT}/oms-backup-20260815T120042Z.incomplete/mail-store-watch-control"
if grep -Eq '^(STOP:|DUMP:)' "${EVENT_LOG}"; then
    fail "Never-ready watcher reached service quiescence"
fi
assert_exact_service_state

echo 'PASS: stopped never-ready watcher cancellation is identity-bound and bounded'

write_service_state
reset_fake_counters
: > "${EVENT_LOG}"
if run_backup_command 20260815T120041Z \
    OMS_BACKUP_MOVE_WATCH_BIN="${BIN_ROOT}/move-watch" \
    FAKE_MOVE_WATCH_MODE=forged-ready-identity \
    >"${TEST_ROOT}/watch-forged-ready.out" 2>&1; then
    fail "Backup accepted a forged watcher readiness identity"
fi
assert_absent "${BACKUP_ROOT}/oms-backup-20260815T120041Z"
[[ -d "${BACKUP_ROOT}/oms-backup-20260815T120041Z.incomplete" ]] \
    || fail "Forged watcher readiness did not remain visibly incomplete"
assert_contains "${TEST_ROOT}/watch-forged-ready.out" \
    'Mail-store directory move watch reported an unexpected readiness identity'
if grep -Eq '^(STOP:|DUMP:)' "${EVENT_LOG}"; then
    fail "Forged watcher readiness reached service quiescence"
fi
assert_exact_service_state

echo 'PASS: watcher readiness authenticates the launched process identity'

write_service_state
reset_fake_counters
: > "${EVENT_LOG}"
if run_backup_command 20260815T120011Z \
    OMS_BACKUP_MOVE_WATCH_BIN="${BIN_ROOT}/move-watch" \
    FAKE_MOVE_WATCH_MODE=early-drain \
    >"${TEST_ROOT}/watch-early-drain.out" 2>&1; then
    fail "Backup accepted a stale pre-quiescence watcher drain acknowledgment"
fi
assert_absent "${BACKUP_ROOT}/oms-backup-20260815T120011Z"
[[ -d "${BACKUP_ROOT}/oms-backup-20260815T120011Z.incomplete" ]] \
    || fail "Stale watcher acknowledgment did not remain visibly incomplete"
grep -Fq 'START:openmailstack.service' "${EVENT_LOG}" \
    && fail "Stale watcher acknowledgment quiesced active services"
if grep -Eq '^(STOP:|DUMP:)' "${EVENT_LOG}"; then
    fail "Stale watcher acknowledgment reached service quiescence"
fi
assert_exact_service_state

echo 'PASS: stale pre-quiescence drain acknowledgments fail closed'

write_service_state
reset_fake_counters
: > "${EVENT_LOG}"
if run_backup_command 20260815T120008Z \
    OMS_BACKUP_MOVE_WATCH_BIN="${BIN_ROOT}/move-watch" \
    FAKE_MOVE_WATCH_MODE=foreign-sentinel \
    >"${TEST_ROOT}/watch-foreign-sentinel.out" 2>&1; then
    fail "Backup accepted a foreign watcher sentinel"
fi
FOREIGN_SENTINEL=$(find \
    "${BACKUP_ROOT}/oms-backup-20260815T120008Z.incomplete/mail-store-watch-control" \
    -maxdepth 1 \
    -name '.oms-backup-watch-*' -print -quit)
[[ -n "${FOREIGN_SENTINEL}" && -f "${FOREIGN_SENTINEL}" ]] \
    || fail "Backup cleanup deleted a foreign watcher sentinel"
assert_contains "${FOREIGN_SENTINEL}" 'foreign sentinel'
rm -f -- "${FOREIGN_SENTINEL}"
grep -Fq 'START:openmailstack.service' "${EVENT_LOG}" \
    && fail "Foreign watcher sentinel quiesced active services"
if grep -Eq '^(STOP:|DUMP:)' "${EVENT_LOG}"; then
    fail "Foreign watcher sentinel reached service quiescence"
fi
assert_exact_service_state

echo 'PASS: backup isolates the drain sentinel in protected control storage'

write_service_state
reset_fake_counters
: > "${EVENT_LOG}"
if run_backup_command 20260815T120007Z \
    OMS_BACKUP_MOVE_WATCH_BIN="${BIN_ROOT}/move-watch" \
    FAKE_MOVE_WATCH_MODE=exit-after-ready \
    >"${TEST_ROOT}/watch-exit.out" 2>&1; then
    fail "Backup accepted a directory move watch that exited before quiescence"
fi
assert_absent "${BACKUP_ROOT}/oms-backup-20260815T120007Z"
[[ -d "${BACKUP_ROOT}/oms-backup-20260815T120007Z.incomplete" ]] \
    || fail "Failed move watch did not leave a visible incomplete snapshot"
if grep -Eq '^(STOP:|DUMP:)' "${EVENT_LOG}"; then
    fail "Backup quiesced services after the directory move watch exited"
fi
assert_exact_service_state

echo 'PASS: directory move watch failure remains fail-closed and restores service state'

write_service_state
reset_fake_counters
: > "${EVENT_LOG}"
WATCH_TIMEOUT_STARTED=$(date +%s)
if run_backup_command 20260815T120012Z \
    OMS_BACKUP_MOVE_WATCH_BIN="${BIN_ROOT}/move-watch" \
    FAKE_MOVE_WATCH_MODE=ignore-term \
    >"${TEST_ROOT}/watch-term-timeout.out" 2>&1; then
    fail "Backup accepted a directory move watcher that ignored TERM"
fi
WATCH_TIMEOUT_ELAPSED=$(( $(date +%s) - WATCH_TIMEOUT_STARTED ))
(( WATCH_TIMEOUT_ELAPSED < 15 )) \
    || fail "Watcher TERM timeout delayed service recovery for ${WATCH_TIMEOUT_ELAPSED}s"
assert_absent "${BACKUP_ROOT}/oms-backup-20260815T120012Z"
[[ -d "${BACKUP_ROOT}/oms-backup-20260815T120012Z.incomplete" ]] \
    || fail "Watcher TERM timeout did not remain visibly incomplete"
grep -Fq 'START:openmailstack.service' "${EVENT_LOG}" \
    || fail "Watcher TERM timeout did not restore active services"
assert_exact_service_state

echo 'PASS: watcher TERM timeout is ps-independent and bounded before exact service recovery'

write_service_state
reset_fake_counters
: > "${EVENT_LOG}"
if run_backup_command 20260815T120013Z \
    FAKE_INOTIFY_OVERFLOW=1 \
    >"${TEST_ROOT}/watch-overflow.out" 2>&1; then
    fail "Backup accepted a directory move event queue overflow"
fi
assert_absent "${BACKUP_ROOT}/oms-backup-20260815T120013Z"
[[ -d "${BACKUP_ROOT}/oms-backup-20260815T120013Z.incomplete" ]] \
    || fail "Move event overflow did not leave a visible incomplete snapshot"
assert_contains "${EVENT_LOG}" 'DUMP:'
grep -Fq 'START:openmailstack.service' "${EVENT_LOG}" \
    || fail "Move event overflow did not restore active services"
assert_exact_service_state

echo 'PASS: directory move event overflow fails closed after exact service recovery'

write_service_state
reset_fake_counters
: > "${EVENT_LOG}"
if run_backup_command 20260815T120014Z \
    FAKE_MOVE_WATCH_MALFORMED=1 \
    >"${TEST_ROOT}/watch-malformed.out" 2>&1; then
    fail "Backup accepted a truncated directory move event record"
fi
assert_absent "${BACKUP_ROOT}/oms-backup-20260815T120014Z"
[[ -d "${BACKUP_ROOT}/oms-backup-20260815T120014Z.incomplete" ]] \
    || fail "Malformed move event stream did not remain visibly incomplete"
assert_contains "${TEST_ROOT}/watch-malformed.out" \
    'Mail-store directory move event log is truncated'
grep -Fq 'START:openmailstack.service' "${EVENT_LOG}" \
    || fail "Malformed move event stream did not restore active services"
assert_exact_service_state

echo 'PASS: truncated directory move event streams fail closed after exact service recovery'

write_service_state
reset_fake_counters
: > "${EVENT_LOG}"
if run_backup_command 20260815T120016Z \
    FAKE_MOVE_WATCH_CORRUPT_TAG=1 \
    >"${TEST_ROOT}/watch-corrupt-tag.out" 2>&1; then
    fail "Backup accepted an unknown directory move event tag"
fi
assert_absent "${BACKUP_ROOT}/oms-backup-20260815T120016Z"
[[ -d "${BACKUP_ROOT}/oms-backup-20260815T120016Z.incomplete" ]] \
    || fail "Unknown move event tag did not remain visibly incomplete"
grep -Fq 'START:openmailstack.service' "${EVENT_LOG}" \
    || fail "Unknown move event tag did not restore active services"
assert_exact_service_state

echo 'PASS: unknown directory move event tags fail closed after exact service recovery'

write_service_state
reset_fake_counters
: > "${EVENT_LOG}"
run_backup_command 20260815T120015Z \
    FAKE_RSYNC_FAIL_MATCH=/var/vmail/ \
    FAKE_RSYNC_FAIL_PHASE=live-precopy \
    FAKE_RSYNC_FAIL_MODE=always \
    FAKE_RSYNC_FAIL_STATUS=24
VANISHED_FILE_SNAPSHOT="${BACKUP_ROOT}/oms-backup-20260815T120015Z"
[[ -d "${VANISHED_FILE_SNAPSHOT}" ]] \
    || fail "Backup rejected rsync status 24 from the mutable live pre-copy"
assert_absent "${VANISHED_FILE_SNAPSHOT}.incomplete"
assert_contains "${EVENT_LOG}" 'RSYNC_FAIL_DETAIL:live-precopy:24'
assert_contains "${EVENT_LOG}" 'RSYNC:quiesced-convergence:'
assert_exact_service_state

echo 'PASS: vanished files are tolerated only during live pre-copy'

write_service_state
reset_fake_counters
: > "${EVENT_LOG}"
if run_backup_command 20260815T120020Z \
    FAKE_RSYNC_FAIL_MATCH=/var/vmail/ \
    FAKE_RSYNC_FAIL_PHASE=quiesced-changed-files \
    FAKE_RSYNC_FAIL_MODE=always \
    FAKE_RSYNC_FAIL_STATUS=24 >"${TEST_ROOT}/convergence-failure.out" 2>&1; then
    fail "Backup accepted rsync status 24 from stopped convergence"
fi
assert_absent "${BACKUP_ROOT}/oms-backup-20260815T120020Z"
[[ -d "${BACKUP_ROOT}/oms-backup-20260815T120020Z.incomplete" ]] \
    || fail "Failed stopped convergence did not remain visibly incomplete"
assert_contains "${EVENT_LOG}" 'RSYNC_FAIL_DETAIL:quiesced-changed-files:24'
grep -Fq 'START:openmailstack.service' "${EVENT_LOG}" \
    || fail "Stopped convergence failure did not restore active services"
assert_exact_service_state

echo 'PASS: stopped convergence fails closed and restores service state'

write_service_state
reset_fake_counters
: > "${EVENT_LOG}"
if run_backup_command 20260815T120025Z \
    FAKE_SHA256SUM_MODE=fail >"${TEST_ROOT}/checksum-failure.out" 2>&1; then
    fail "Backup promoted a snapshot after finalization failed"
fi
assert_absent "${BACKUP_ROOT}/oms-backup-20260815T120025Z"
[[ -d "${BACKUP_ROOT}/oms-backup-20260815T120025Z.incomplete" ]] \
    || fail "Finalization failure did not remain visibly incomplete"
assert_exact_service_state
assert_event_before 'HEALTH' 'SHA256SUM_FAIL' \
    "checksum failure occurred before service health recovered"

echo 'PASS: post-resume finalization failure leaves services healthy and the snapshot incomplete'

if [[ "${OMS_BACKUP_TEST_STOP_AFTER_INITIAL:-0}" == "1" ]]; then
    exit 0
fi

write_service_state
reset_fake_counters
: > "${EVENT_LOG}"
run_backup_command 20260815T120050Z \
    FAKE_HEALTH_MODE=fail-first:3 \
    FAKE_HEALTH_DELAY_SECONDS=0.02
TRANSIENT_HEALTH_SNAPSHOT="${BACKUP_ROOT}/oms-backup-20260815T120050Z"
[[ -d "${TRANSIENT_HEALTH_SNAPSHOT}" ]] \
    || fail "Backup did not tolerate transient post-resume health failures"
assert_absent "${TRANSIENT_HEALTH_SNAPSHOT}.incomplete"
assert_event_count 4 'HEALTH'
assert_exact_service_state
TRANSIENT_QUIESCENCE_MS=$(awk -F'\t' \
    '$1 == "service_quiescence_ms" { print $2 }' \
    "${TRANSIENT_HEALTH_SNAPSHOT}/snapshot.meta")
TRANSIENT_OUTAGE_WINDOW_MS=$(awk -F'\t' \
    '$1 == "service_outage_window_ms" { print $2 }' \
    "${TRANSIENT_HEALTH_SNAPSHOT}/snapshot.meta")
(( 10#${TRANSIENT_OUTAGE_WINDOW_MS} - 10#${TRANSIENT_QUIESCENCE_MS} >= 50 )) \
    || fail "Service outage window did not include delayed health recovery"

echo 'PASS: backup waits for transient service readiness before promotion'

: > "${EVENT_LOG}"
if run_backup_command 20260815T120100Z FAKE_DUMP_MODE=fail >"${TEST_ROOT}/dump-failure.out" 2>&1; then
    fail "Backup accepted a failed database dump"
fi
assert_absent "${BACKUP_ROOT}/oms-backup-20260815T120100Z"
grep -Fq 'START:openmailstack.service' "${EVENT_LOG}" \
    || fail "Database dump failure did not restore active services"

echo 'PASS: database dump failure aborts promotion and restores service state'

: > "${EVENT_LOG}"
if run_backup_command 20260815T120200Z FAKE_DUMP_MODE=empty >"${TEST_ROOT}/empty-dump.out" 2>&1; then
    fail "Backup accepted an empty database dump"
fi
assert_absent "${BACKUP_ROOT}/oms-backup-20260815T120200Z"
[[ -d "${BACKUP_ROOT}/oms-backup-20260815T120200Z.incomplete" ]] \
    || fail "Failed backup did not remain visibly incomplete"
grep -Fq 'START:openmailstack.service' "${EVENT_LOG}" \
    || fail "Empty database dump failure did not restore active services"

echo 'PASS: empty database dump fails closed and remains visibly incomplete'

write_service_state
: > "${EVENT_LOG}"
rm -f -- "${STATE_ROOT}/start-fail.state"
if run_backup_command 20260815T120300Z \
    FAKE_START_FAIL_UNIT=openmailstack.service \
    FAKE_START_FAIL_MODE=once >"${TEST_ROOT}/start-failure.out" 2>&1; then
    fail "Backup reported success after a service resume error"
fi
assert_absent "${BACKUP_ROOT}/oms-backup-20260815T120300Z"
assert_equals active \
    "$(awk -F= '$1 == "openmailstack.service" { print $2 }' "${SERVICE_STATE}")" \
    "backend state after transient resume failure"
assert_event_count 2 'START:openmailstack.service'

write_service_state
: > "${EVENT_LOG}"
if run_backup_command 20260815T120400Z \
    FAKE_STOP_FAIL_UNIT=postfix.service >"${TEST_ROOT}/stop-failure.out" 2>&1; then
    fail "Backup reported success after a service quiesce error"
fi
assert_absent "${BACKUP_ROOT}/oms-backup-20260815T120400Z"
for active_unit in monit.service nginx.service postfix.service dovecot.service rspamd.service openmailstack.service; do
    assert_equals active \
        "$(awk -F= -v unit="${active_unit}" '$1 == unit { print $2 }' "${SERVICE_STATE}")" \
        "${active_unit} state after quiesce failure"
done

echo 'PASS: service stop/resume failures are loud and recover exact prior activity'

write_service_state
: > "${EVENT_LOG}"
rm -rf -- "$(fixture_path /var/www/roundcube)"
run_backup_command 20260815T120500Z >/dev/null
ABSENT_SNAPSHOT="${BACKUP_ROOT}/oms-backup-20260815T120500Z"
assert_contains "${ABSENT_SNAPSHOT}/inventory.tsv" \
    $'roundcube\t/var/www/roundcube\tabsent\tdirectory'
assert_absent "${ABSENT_SNAPSHOT}/payload/roundcube"

echo 'PASS: inventory records absent components explicitly'

run_verify_command "${SNAPSHOT}"

LEGACY_SNAPSHOT="${BACKUP_ROOT}/oms-backup-20260815T120900Z"
cp -a -- "${SNAPSHOT}" "${LEGACY_SNAPSHOT}"
sed -i \
    -e '/^service_quiescence_mode\t/d' \
    -e '/^service_quiescence_ms\t/d' \
    -e '/^service_outage_window_ms\t/d' \
    "${LEGACY_SNAPSHOT}/snapshot.meta"
regenerate_snapshot_checksums "${LEGACY_SNAPSHOT}"
run_verify_command "${LEGACY_SNAPSHOT}"

BLANK_MODE_SNAPSHOT="${BACKUP_ROOT}/oms-backup-20260815T120910Z"
cp -a -- "${SNAPSHOT}" "${BLANK_MODE_SNAPSHOT}"
sed -i 's/^service_quiescence_mode\t.*/service_quiescence_mode\t/' \
    "${BLANK_MODE_SNAPSHOT}/snapshot.meta"
assert_metadata_rejected "${BLANK_MODE_SNAPSHOT}" blank-mode

DUPLICATE_MODE_SNAPSHOT="${BACKUP_ROOT}/oms-backup-20260815T120920Z"
cp -a -- "${SNAPSHOT}" "${DUPLICATE_MODE_SNAPSHOT}"
printf 'service_quiescence_mode\tmanaged\n' \
    >> "${DUPLICATE_MODE_SNAPSHOT}/snapshot.meta"
assert_metadata_rejected "${DUPLICATE_MODE_SNAPSHOT}" duplicate-mode

MISSING_DURATION_SNAPSHOT="${BACKUP_ROOT}/oms-backup-20260815T120930Z"
cp -a -- "${SNAPSHOT}" "${MISSING_DURATION_SNAPSHOT}"
sed -i '/^service_quiescence_ms\t/d' \
    "${MISSING_DURATION_SNAPSHOT}/snapshot.meta"
assert_metadata_rejected "${MISSING_DURATION_SNAPSHOT}" missing-duration

BLANK_DURATION_SNAPSHOT="${BACKUP_ROOT}/oms-backup-20260815T120940Z"
cp -a -- "${SNAPSHOT}" "${BLANK_DURATION_SNAPSHOT}"
sed -i 's/^service_quiescence_ms\t.*/service_quiescence_ms\t/' \
    "${BLANK_DURATION_SNAPSHOT}/snapshot.meta"
assert_metadata_rejected "${BLANK_DURATION_SNAPSHOT}" blank-duration

NONNUMERIC_DURATION_SNAPSHOT="${BACKUP_ROOT}/oms-backup-20260815T120950Z"
cp -a -- "${SNAPSHOT}" "${NONNUMERIC_DURATION_SNAPSHOT}"
sed -i 's/^service_quiescence_ms\t.*/service_quiescence_ms\tnot-a-number/' \
    "${NONNUMERIC_DURATION_SNAPSHOT}/snapshot.meta"
assert_metadata_rejected "${NONNUMERIC_DURATION_SNAPSHOT}" nonnumeric-duration

EXTRA_FIELD_SNAPSHOT="${BACKUP_ROOT}/oms-backup-20260815T120951Z"
cp -a -- "${SNAPSHOT}" "${EXTRA_FIELD_SNAPSHOT}"
sed -i 's/^service_quiescence_mode\t.*/service_quiescence_mode\tmanaged\textra/' \
    "${EXTRA_FIELD_SNAPSHOT}/snapshot.meta"
assert_metadata_rejected "${EXTRA_FIELD_SNAPSHOT}" extra-mode-field

EXTERNAL_DURATION_SNAPSHOT="${BACKUP_ROOT}/oms-backup-20260815T120952Z"
cp -a -- "${SNAPSHOT}" "${EXTERNAL_DURATION_SNAPSHOT}"
sed -i 's/^service_quiescence_mode\t.*/service_quiescence_mode\tmanaged_externally/' \
    "${EXTERNAL_DURATION_SNAPSHOT}/snapshot.meta"
assert_metadata_rejected "${EXTERNAL_DURATION_SNAPSHOT}" external-with-duration

echo 'PASS: timing metadata is strict while legacy format-1 snapshots remain compatible'

if run_verify_command "${SNAPSHOT}" \
    OMS_BACKUP_DATABASES='postfixadmin roundcube unexpected' \
    >"${TEST_ROOT}/database-allowlist-verify.out" 2>&1; then
    fail "Verification accepted a snapshot outside the configured database allowlist"
fi

TAMPERED_SNAPSHOT="${BACKUP_ROOT}/oms-backup-20260815T121000Z"
cp -a -- "${SNAPSHOT}" "${TAMPERED_SNAPSHOT}"
printf '%s\n' 'tampered' >> "${TAMPERED_SNAPSHOT}/payload/mail-store/fixture.txt"
: > "${EVENT_LOG}"
if run_restore_command 20260815T131000Z "${TAMPERED_SNAPSHOT}" \
    >"${TEST_ROOT}/tampered-restore.out" 2>&1; then
    fail "Restore accepted a snapshot with invalid checksums"
fi
assert_absent "${BACKUP_ROOT}/oms-pre-restore-20260815T131000Z"
if grep -Eq '^(STOP:|START:|IMPORT|DUMP:|RSYNC:)' "${EVENT_LOG}"; then
    fail "Rejected snapshot mutated services or databases"
fi

MODE_SNAPSHOT="${BACKUP_ROOT}/oms-backup-20260815T121100Z"
cp -a -- "${SNAPSHOT}" "${MODE_SNAPSHOT}"
chmod 0777 -- "${MODE_SNAPSHOT}"
if run_verify_command "${MODE_SNAPSHOT}" >"${TEST_ROOT}/mode-verify.out" 2>&1; then
    fail "Verification accepted a group/world-writable snapshot root"
fi

CONTROL_MODE_SNAPSHOT="${BACKUP_ROOT}/oms-backup-20260815T121200Z"
cp -a -- "${SNAPSHOT}" "${CONTROL_MODE_SNAPSHOT}"
chmod 0660 -- "${CONTROL_MODE_SNAPSHOT}/inventory.tsv"
if run_verify_command "${CONTROL_MODE_SNAPSHOT}" >"${TEST_ROOT}/control-mode.out" 2>&1; then
    fail "Verification accepted a group-writable control file"
fi

FIFO_SNAPSHOT="${BACKUP_ROOT}/oms-backup-20260815T121300Z"
cp -a -- "${SNAPSHOT}" "${FIFO_SNAPSHOT}"
mkfifo "${FIFO_SNAPSHOT}/payload/mail-store/untrusted.pipe"
if run_verify_command "${FIFO_SNAPSHOT}" >"${TEST_ROOT}/fifo-verify.out" 2>&1; then
    fail "Verification accepted an unsupported payload object"
fi

ABSOLUTE_LINK_SNAPSHOT="${BACKUP_ROOT}/oms-backup-20260815T121350Z"
cp -a -- "${SNAPSHOT}" "${ABSOLUTE_LINK_SNAPSHOT}"
ln -s -- /etc/shadow "${ABSOLUTE_LINK_SNAPSHOT}/payload/mail-store/untrusted.link"
bash -c '
    source "$1"
    oms_br_symlink_manifest "$2" "$2/symlinks.tsv"
    oms_br_generate_checksums "$2" "$2/checksums.sha256"
' backup-restore-regenerate "${BACKUP_SCRIPT}" "${ABSOLUTE_LINK_SNAPSHOT}"
chmod 0600 -- \
    "${ABSOLUTE_LINK_SNAPSHOT}/symlinks.tsv" \
    "${ABSOLUTE_LINK_SNAPSHOT}/checksums.sha256"
if run_verify_command "${ABSOLUTE_LINK_SNAPSHOT}" \
    >"${TEST_ROOT}/absolute-link-verify.out" 2>&1; then
    fail "Verification accepted an absolute symlink target outside inventory"
fi

SYMLINK_SNAPSHOT="${BACKUP_ROOT}/oms-backup-20260815T121400Z"
ln -s -- "${SNAPSHOT}" "${SYMLINK_SNAPSHOT}"
if run_verify_command "${SYMLINK_SNAPSHOT}" >"${TEST_ROOT}/symlink-verify.out" 2>&1; then
    fail "Verification accepted a symlink snapshot root"
fi

if run_verify_command \
    "${BACKUP_ROOT}/../backups/$(basename -- "${SNAPSHOT}")" \
    >"${TEST_ROOT}/traversal-verify.out" 2>&1; then
    fail "Verification accepted a traversal-bearing snapshot path"
fi

echo 'PASS: restore preflight rejects tampering, unsafe modes, special objects, symlinks, and traversal'

LOCK_READY="${STATE_ROOT}/lock.ready"
LOCK_RELEASE="${STATE_ROOT}/lock.release"
rm -f -- "${LOCK_READY}" "${LOCK_RELEASE}"
(
    exec 9>"${STATE_ROOT}/backup-restore.lock"
    flock -x 9
    : > "${LOCK_READY}"
    while [[ ! -e "${LOCK_RELEASE}" ]]; do
        sleep 0.02
    done
) &
LOCK_PID=$!
while [[ ! -e "${LOCK_READY}" ]]; do
    sleep 0.02
done
: > "${EVENT_LOG}"
if run_backup_command 20260815T121500Z >"${TEST_ROOT}/lock.out" 2>&1; then
    fail "Concurrent backup bypassed the exclusive lock"
fi
: > "${LOCK_RELEASE}"
wait "${LOCK_PID}"
assert_absent "${BACKUP_ROOT}/oms-backup-20260815T121500Z"
[[ ! -s "${EVENT_LOG}" ]] || fail "Lock rejection mutated services"

echo 'PASS: backup and restore use a non-blocking exclusive lock'

UNSAFE_BACKUP_PARENT="${TEST_ROOT}/unsafe-backup-parent"
mkdir -p "${UNSAFE_BACKUP_PARENT}"
chmod 0777 -- "${UNSAFE_BACKUP_PARENT}"
: > "${EVENT_LOG}"
if run_backup_command 20260815T121600Z \
    OMS_BACKUP_ROOT="${UNSAFE_BACKUP_PARENT}/backups" \
    >"${TEST_ROOT}/unsafe-backup-root.out" 2>&1; then
    fail "Backup accepted a group/world-writable backup parent"
fi
assert_absent "${UNSAFE_BACKUP_PARENT}/backups"
[[ ! -s "${EVENT_LOG}" ]] || fail "Unsafe backup path rejection mutated services"

echo 'PASS: backup storage and lock paths require root-owned non-writable directories'

prepare_live_inventory
write_service_state
reset_fake_counters
: > "${EVENT_LOG}"
printf '%s\n' 'live state before successful restore' > "$(fixture_path /var/vmail)/fixture.txt"
printf '%s\n' 'live package-managed MariaDB config' > "$(fixture_path /etc/mysql)/fixture.txt"
printf '%s\n' 'FIRST_DOMAIN=changed.example.test' > "${INSTALL_CONFIG}"
rm -f -- "$(fixture_path /etc/systemd/system/openmailstack.service)"
run_restore_command 20260815T130000Z "${SNAPSHOT}" >/dev/null
SAFETY_SNAPSHOT="${BACKUP_ROOT}/oms-pre-restore-20260815T130000Z"
[[ -d "${SAFETY_SNAPSHOT}" ]] || fail "Restore did not create a pre-restore safety snapshot"
run_verify_command "${SAFETY_SNAPSHOT}"
assert_contains "${SAFETY_SNAPSHOT}/snapshot.meta" \
    $'service_quiescence_mode\tmanaged_externally'
if grep -Eq '^service_(quiescence_ms|outage_window_ms)\t' \
    "${SAFETY_SNAPSHOT}/snapshot.meta"; then
    fail "Externally managed safety snapshot recorded an invented timing duration"
fi
assert_equals 'fixture:/var/vmail' \
    "$(<"$(fixture_path /var/vmail)/fixture.txt")" \
    "mail store after successful restore"
assert_equals 'live state before successful restore' \
    "$(<"${SAFETY_SNAPSHOT}/payload/mail-store/fixture.txt")" \
    "safety snapshot mail-store state"
assert_equals 'live package-managed MariaDB config' \
    "$(<"$(fixture_path /etc/mysql)/fixture.txt")" \
    "package-managed MariaDB config after successful restore"
assert_equals 'FIRST_DOMAIN=example.test' "$(<"${INSTALL_CONFIG}")" \
    "installer config after successful restore"
[[ -f "$(fixture_path /etc/systemd/system/openmailstack.service)" ]] \
    || fail "Successful restore did not replace a missing systemd unit"
cmp -s -- "${SNAPSHOT}/databases.sql" "${TEST_ROOT}/imported.sql" \
    || fail "Successful restore did not import the requested database dump"
assert_event_count 1 'STOP:openmailstack.service'
assert_event_count 1 'START:openmailstack.service'
assert_event_count 1 'HEALTH'
assert_exact_service_state

echo 'PASS: verified safety snapshot remains continuously quiesced through successful restore'

write_service_state
reset_fake_counters
: > "${EVENT_LOG}"
mkdir -p "$(fixture_path /var/www/roundcube)"
printf '%s\n' 'must be removed' > "$(fixture_path /var/www/roundcube)/unexpected.txt"
run_restore_command 20260815T130100Z "${ABSENT_SNAPSHOT}" >/dev/null
assert_absent "$(fixture_path /var/www/roundcube)"
assert_exact_service_state

echo 'PASS: restore enforces explicit absent inventory state'

prepare_live_inventory
write_service_state
reset_fake_counters
: > "${EVENT_LOG}"
printf '%s\n' 'unchanged when safety snapshot fails' > "$(fixture_path /var/vmail)/fixture.txt"
if run_restore_command 20260815T130200Z "${SNAPSHOT}" \
    FAKE_DUMP_MODE=fail >"${TEST_ROOT}/safety-failure.out" 2>&1; then
    fail "Restore continued after its safety database dump failed"
fi
assert_absent "${BACKUP_ROOT}/oms-pre-restore-20260815T130200Z"
[[ -d "${BACKUP_ROOT}/oms-pre-restore-20260815T130200Z.incomplete" ]] \
    || fail "Failed safety snapshot was not marked incomplete"
assert_equals 'unchanged when safety snapshot fails' \
    "$(<"$(fixture_path /var/vmail)/fixture.txt")" \
    "live data after safety snapshot failure"
[[ ! -e "${IMPORT_COUNT}" ]] || fail "Safety snapshot failure reached database restore"
assert_exact_service_state

echo 'PASS: restore aborts before mutation when the verified safety snapshot cannot be created'

prepare_live_inventory
write_service_state
reset_fake_counters
: > "${EVENT_LOG}"
printf '%s\n' 'recover after partial filesystem restore' > "$(fixture_path /var/vmail)/fixture.txt"
if run_restore_command 20260815T130300Z "${SNAPSHOT}" \
    FAKE_RSYNC_FAIL_MATCH="${SNAPSHOT}/payload/postfix-config/" \
    >"${TEST_ROOT}/filesystem-failure.out" 2>&1; then
    fail "Restore reported success after a filesystem restore failure"
fi
FS_SAFETY="${BACKUP_ROOT}/oms-pre-restore-20260815T130300Z"
run_verify_command "${FS_SAFETY}"
assert_equals 'recover after partial filesystem restore' \
    "$(<"$(fixture_path /var/vmail)/fixture.txt")" \
    "mail store after filesystem recovery"
assert_event_count 1 'RSYNC_FAIL'
assert_event_count 1 'IMPORT_ATTEMPT:1'
assert_event_count 1 'STOP:openmailstack.service'
assert_event_count 1 'START:openmailstack.service'
assert_exact_service_state

echo 'PASS: partial filesystem restore failure rolls back from the verified safety snapshot'

prepare_live_inventory
write_service_state
reset_fake_counters
: > "${EVENT_LOG}"
printf '%s\n' 'recover after database restore failure' > "$(fixture_path /var/vmail)/fixture.txt"
printf '%s\n' '-- safety database' 'CREATE DATABASE safety_recovery;' \
    > "${TEST_ROOT}/safety-database.sql"
if run_restore_command 20260815T130400Z "${SNAPSHOT}" \
    FAKE_IMPORT_MODE=fail-first \
    FAKE_DUMP_SOURCE_FILE="${TEST_ROOT}/safety-database.sql" \
    >"${TEST_ROOT}/database-restore-failure.out" 2>&1; then
    fail "Restore reported success after the requested database import failed"
fi
DB_SAFETY="${BACKUP_ROOT}/oms-pre-restore-20260815T130400Z"
run_verify_command "${DB_SAFETY}"
assert_equals 'recover after database restore failure' \
    "$(<"$(fixture_path /var/vmail)/fixture.txt")" \
    "mail store after database recovery"
assert_contains "${TEST_ROOT}/imported.sql" 'CREATE DATABASE safety_recovery;'
assert_equals 2 "$(<"${IMPORT_COUNT}")" "database import attempts after recovery"
assert_exact_service_state

echo 'PASS: requested database import failure re-applies safety files and logical database dump'

prepare_live_inventory
write_service_state
reset_fake_counters
: > "${EVENT_LOG}"
printf '%s\n' 'recover after health-check failure' > "$(fixture_path /var/vmail)/fixture.txt"
printf '%s\n' '-- health safety database' 'CREATE DATABASE health_recovery;' \
    > "${TEST_ROOT}/health-safety-database.sql"
if run_restore_command 20260815T130500Z "${SNAPSHOT}" \
    FAKE_HEALTH_MODE=fail-first:15 \
    FAKE_DUMP_SOURCE_FILE="${TEST_ROOT}/health-safety-database.sql" \
    >"${TEST_ROOT}/health-failure.out" 2>&1; then
    fail "Restore reported success after its requested-state health check failed"
fi
HEALTH_SAFETY="${BACKUP_ROOT}/oms-pre-restore-20260815T130500Z"
run_verify_command "${HEALTH_SAFETY}"
assert_equals 'recover after health-check failure' \
    "$(<"$(fixture_path /var/vmail)/fixture.txt")" \
    "mail store after health-check recovery"
assert_contains "${TEST_ROOT}/imported.sql" 'CREATE DATABASE health_recovery;'
assert_equals 2 "$(<"${IMPORT_COUNT}")" "database imports after health-check recovery"
assert_event_count 2 'STOP:openmailstack.service'
assert_event_count 2 'START:openmailstack.service'
assert_event_count 16 'HEALTH'
assert_exact_service_state

echo 'PASS: health-check failure triggers full safety rollback before returning failure'

prepare_live_inventory
write_service_state
reset_fake_counters
: > "${EVENT_LOG}"
printf '%s\n' 'recover after partial service resume' > "$(fixture_path /var/vmail)/fixture.txt"
printf '%s\n' '-- resume safety database' 'CREATE DATABASE resume_recovery;' \
    > "${TEST_ROOT}/resume-safety-database.sql"
if run_restore_command 20260815T130550Z "${SNAPSHOT}" \
    FAKE_START_FAIL_UNIT=openmailstack.service \
    FAKE_START_FAIL_MODE=once \
    FAKE_DUMP_SOURCE_FILE="${TEST_ROOT}/resume-safety-database.sql" \
    >"${TEST_ROOT}/resume-failure.out" 2>&1; then
    fail "Restore reported success after a partial service-resume failure"
fi
RESUME_SAFETY="${BACKUP_ROOT}/oms-pre-restore-20260815T130550Z"
run_verify_command "${RESUME_SAFETY}"
assert_equals 'recover after partial service resume' \
    "$(<"$(fixture_path /var/vmail)/fixture.txt")" \
    "mail store after partial-resume recovery"
assert_contains "${TEST_ROOT}/imported.sql" 'CREATE DATABASE resume_recovery;'
assert_equals 2 "$(<"${IMPORT_COUNT}")" "database imports after partial-resume recovery"
assert_event_count 2 'STOP:rspamd.service'
assert_event_count 2 'STOP:dovecot.service'
assert_event_count 2 'START:openmailstack.service'
second_rspamd_stop=$(grep -nFx 'STOP:rspamd.service' "${EVENT_LOG}" | sed -n '2s/:.*//p')
recovery_import=$(grep -nFx 'IMPORT_ATTEMPT:2' "${EVENT_LOG}" | sed -n '1s/:.*//p')
[[ -n "${second_rspamd_stop}" && -n "${recovery_import}" \
    && ${second_rspamd_stop} -lt ${recovery_import} ]] \
    || fail "Safety recovery imported databases before partially resumed services were stopped"
assert_exact_service_state

echo 'PASS: partial service-resume failure re-quiesces before safety rollback'

prepare_live_inventory
write_service_state
reset_fake_counters
: > "${EVENT_LOG}"
printf '%s\n' 'filesystem still recoverable' > "$(fixture_path /var/vmail)/fixture.txt"
if run_restore_command 20260815T130600Z "${SNAPSHOT}" \
    FAKE_IMPORT_MODE=fail >"${TEST_ROOT}/recovery-failure.out" 2>&1; then
    fail "Restore hid a database failure that also blocked safety recovery"
fi
assert_equals 'filesystem still recoverable' \
    "$(<"$(fixture_path /var/vmail)/fixture.txt")" \
    "filesystem after unrecoverable database import failure"
assert_equals 2 "$(<"${IMPORT_COUNT}")" "failed target and safety database attempts"
assert_contains "${TEST_ROOT}/recovery-failure.out" 'Pre-restore safety snapshot recovery failed'
assert_exact_service_state

echo 'PASS: failed safety recovery stays fail-closed and reports the unrecovered database import'

prepare_live_inventory
write_service_state
reset_fake_counters
: > "${EVENT_LOG}"
mv -- "$(fixture_path /var/www/roundcube)" "${TEST_ROOT}/roundcube-real"
ln -s -- "${TEST_ROOT}/roundcube-real" "$(fixture_path /var/www/roundcube)"
if run_backup_command 20260815T130700Z >"${TEST_ROOT}/source-symlink.out" 2>&1; then
    fail "Backup followed a symlink inventory root"
fi
assert_absent "${BACKUP_ROOT}/oms-backup-20260815T130700Z"
assert_exact_service_state

echo 'PASS: backup rejects symlink inventory roots without losing service state'

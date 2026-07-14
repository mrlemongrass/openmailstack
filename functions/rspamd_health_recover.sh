#!/usr/bin/env bash
set -euo pipefail

HEALTHCHECK_BIN="${HEALTHCHECK_BIN:-/usr/local/sbin/openmailstack-rspamd-health}"
SYSTEMCTL_BIN="${SYSTEMCTL_BIN:-/usr/bin/systemctl}"
STATE_DIR="${STATE_DIR:-/run/openmailstack-rspamd-health}"
STATUS_FILE="${STATUS_FILE:-${STATE_DIR}/status.json}"
STATE_FILE="${STATE_FILE:-${STATE_DIR}/state}"
FAILURE_THRESHOLD="${FAILURE_THRESHOLD:-3}"
RESTART_COOLDOWN_SECONDS="${RESTART_COOLDOWN_SECONDS:-900}"
RECOVERY_SETTLE_SECONDS="${RECOVERY_SETTLE_SECONDS:-2}"
NOW_EPOCH="${NOW_EPOCH:-$(date +%s)}"

install -d -m 0755 "${STATE_DIR}"
exec 9> "${STATE_DIR}/lock"
if ! flock -n 9; then
    exit 0
fi

failures=0
last_restart=0
generation=""
main_pid=0
restart_count=0
if [[ -f "${STATE_FILE}" ]]; then
    stored_failures=$(sed -n 's/^failures=\([0-9][0-9]*\)$/\1/p' "${STATE_FILE}" | head -n 1)
    stored_restart=$(sed -n 's/^last_restart=\([0-9][0-9]*\)$/\1/p' "${STATE_FILE}" | head -n 1)
    stored_generation=$(sed -n 's/^generation=\([A-Za-z0-9._-][A-Za-z0-9._-]*\)$/\1/p' "${STATE_FILE}" | head -n 1)
    stored_main_pid=$(sed -n 's/^main_pid=\([0-9][0-9]*\)$/\1/p' "${STATE_FILE}" | head -n 1)
    stored_restart_count=$(sed -n 's/^restart_count=\([0-9][0-9]*\)$/\1/p' "${STATE_FILE}" | head -n 1)
    failures="${stored_failures:-0}"
    last_restart="${stored_restart:-0}"
    generation="${stored_generation:-}"
    main_pid="${stored_main_pid:-0}"
    restart_count="${stored_restart_count:-0}"
fi

write_state() {
    local next_failures="$1"
    local next_restart="$2"
    local next_generation="${3:-${generation}}"
    local next_main_pid="${4:-${main_pid}}"
    local next_restart_count="${5:-${restart_count}}"
    local tmp="${STATE_FILE}.tmp.$$"
    printf 'failures=%s\nlast_restart=%s\ngeneration=%s\nmain_pid=%s\nrestart_count=%s\n' \
        "${next_failures}" "${next_restart}" "${next_generation}" "${next_main_pid}" "${next_restart_count}" > "${tmp}"
    chmod 0644 "${tmp}"
    mv -f "${tmp}" "${STATE_FILE}"
}

write_status() {
    local payload="$1"
    local tmp="${STATUS_FILE}.tmp.$$"
    if [[ "${payload}" != *'"ok":'* ]]; then
        payload='{"ok":false,"latencyMs":null,"lastError":"Rspamd functional scan failed","checkedAt":null}'
    fi
    printf '%s\n' "${payload}" > "${tmp}"
    chmod 0644 "${tmp}"
    mv -f "${tmp}" "${STATUS_FILE}"
}

run_healthcheck() {
    set +e
    health_output=$("${HEALTHCHECK_BIN}" --json 2>/dev/null)
    health_status=$?
    set -e
}

parse_health_generation() {
    current_generation=$(sed -n 's/.*"workerGeneration":"\([^"]*\)".*/\1/p' <<< "${health_output}")
    current_main_pid=$(sed -n 's/.*"mainPid":\([0-9][0-9]*\).*/\1/p' <<< "${health_output}")
    current_restart_count=$(sed -n 's/.*"restartCount":\([0-9][0-9]*\).*/\1/p' <<< "${health_output}")
    [[ -n "${current_generation}" && "${current_main_pid}" =~ ^[0-9]+$ && "${current_restart_count}" =~ ^[0-9]+$ ]]
}

write_generation_failure() {
    local checked_at endpoint
    checked_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
    endpoint=$(sed -n 's/.*"endpoint":"\([^"]*\)".*/\1/p' <<< "${health_output}")
    endpoint="${endpoint:-unknown}"
    health_output=$(printf '{"ok":false,"latencyMs":null,"lastError":"Rspamd worker generation changed between health probes","checkedAt":"%s","endpoint":"%s","workerGeneration":"%s","mainPid":%s,"restartCount":%s}' \
        "${checked_at}" "${endpoint}" "${current_generation}" "${current_main_pid}" "${current_restart_count}")
}

run_healthcheck
if [[ "${health_status}" -eq 0 ]]; then
    if ! parse_health_generation; then
        health_status=1
        health_output='{"ok":false,"latencyMs":null,"lastError":"Rspamd health result omitted worker generation","checkedAt":null,"endpoint":"unknown"}'
    elif [[ -n "${generation}" && "${current_generation}" != "${generation}" \
        && ( "${current_main_pid}" == "${main_pid}" || "${current_restart_count}" -gt "${restart_count}" ) ]]; then
        health_status=1
        write_generation_failure
    else
        write_state 0 "${last_restart}" "${current_generation}" "${current_main_pid}" "${current_restart_count}"
        write_status "${health_output}"
        exit 0
    fi
fi

failures=$((failures + 1))
write_state "${failures}" "${last_restart}"
write_status "${health_output}"

if (( failures < FAILURE_THRESHOLD )); then
    exit 1
fi

if (( last_restart > 0 && NOW_EPOCH - last_restart < RESTART_COOLDOWN_SECONDS )); then
    exit 1
fi

last_restart="${NOW_EPOCH}"
write_state "${failures}" "${last_restart}"
logger -t openmailstack-rspamd-health "Functional scan failed ${failures} consecutive times; restarting rspamd.service" || true
"${SYSTEMCTL_BIN}" restart rspamd.service

if (( RECOVERY_SETTLE_SECONDS > 0 )); then
    sleep "${RECOVERY_SETTLE_SECONDS}"
fi

run_healthcheck
if [[ "${health_status}" -eq 0 ]]; then
    if parse_health_generation; then
        write_state 0 "${last_restart}" "${current_generation}" "${current_main_pid}" "${current_restart_count}"
        write_status "${health_output}"
        logger -t openmailstack-rspamd-health "Rspamd functional scan recovered after service restart" || true
        exit 0
    fi
fi

write_status "${health_output}"
exit 1

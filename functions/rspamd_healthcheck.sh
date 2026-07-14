#!/usr/bin/env bash
set -euo pipefail

RSPAMC_BIN="${RSPAMC_BIN:-/usr/bin/rspamc}"
MILTER_PROBE_BIN="${MILTER_PROBE_BIN:-/usr/local/libexec/openmailstack-rspamd-milter-probe}"
PS_BIN="${PS_BIN:-/usr/bin/ps}"
SHA256SUM_BIN="${SHA256SUM_BIN:-/usr/bin/sha256sum}"
SYSTEMCTL_SHOW_BIN="${SYSTEMCTL_SHOW_BIN:-/usr/bin/systemctl}"
RSPAMD_SCAN_ENDPOINT="${RSPAMD_SCAN_ENDPOINT:-127.0.0.1:11333}"
RSPAMD_MILTER_HOST="${RSPAMD_MILTER_HOST:-127.0.0.1}"
RSPAMD_MILTER_PORT="${RSPAMD_MILTER_PORT:-11332}"
RSPAMD_SCAN_TIMEOUT="${RSPAMD_SCAN_TIMEOUT:-12}"
OUTPUT_FORMAT="text"

if [[ "${1:-}" == "--json" ]]; then
    OUTPUT_FORMAT="json"
elif [[ -n "${1:-}" ]]; then
    echo "Usage: $0 [--json]" >&2
    exit 64
fi

checked_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
started_ms=$(date +%s%3N)

worker_snapshot() {
    "${PS_BIN}" -eo pid=,ppid=,args= \
        | awk '$3 == "rspamd:" && ($4 == "normal" || $4 == "rspamd_proxy") { print $1 ":" $2 ":" $4 }' \
        | LC_ALL=C sort
}

set +e
workers_before=$(worker_snapshot)
workers_before_status=$?
set -e

set +e
scan_output=$(
    printf '%s\n' \
        'From: healthcheck@openmailstack.invalid' \
        'To: healthcheck@openmailstack.invalid' \
        'Subject: OpenMailStack Rspamd functional health probe' \
        'Message-ID: <rspamd-health@openmailstack.invalid>' \
        'Date: Tue, 14 Jul 2026 12:00:00 +0000' \
        '' \
        'Functional filtering probe.' \
        | "${RSPAMC_BIN}" -h "${RSPAMD_SCAN_ENDPOINT}" -t "${RSPAMD_SCAN_TIMEOUT}" --compact 2>&1
)
scan_status=$?
milter_output=$("${MILTER_PROBE_BIN}" "${RSPAMD_MILTER_HOST}" "${RSPAMD_MILTER_PORT}" "${RSPAMD_SCAN_TIMEOUT}" 2>&1)
milter_status=$?
workers_after=$(worker_snapshot)
workers_after_status=$?
restart_count=$("${SYSTEMCTL_SHOW_BIN}" show rspamd.service --property=NRestarts --value 2>/dev/null)
restart_count_status=$?
set -e

worker_generation=$(printf '%s\n' "${workers_after}" | "${SHA256SUM_BIN}" | awk '{ print $1 }')
main_pid=$(awk -F: 'NR == 1 { print $2 }' <<< "${workers_after}")
restart_state_ok=1
if [[ "${restart_count_status}" -ne 0 || ! "${restart_count}" =~ ^[0-9]+$ ]]; then
    restart_state_ok=0
    restart_count=0
fi
if [[ ! "${main_pid}" =~ ^[0-9]+$ ]]; then
    main_pid=0
fi

finished_ms=$(date +%s%3N)
latency_ms=$((finished_ms - started_ms))
ok=1
error=""

if [[ "${workers_before_status}" -ne 0 || -z "${workers_before}" ]]; then
    ok=0
    error="Rspamd scan and proxy workers were not running before the probe"
elif [[ "${restart_state_ok}" -ne 1 ]]; then
    ok=0
    error="Rspamd systemd restart state was unavailable"
elif [[ "${scan_status}" -ne 0 ]]; then
    ok=0
    error="Rspamd functional scan failed"
elif ! grep -Eq '"action"[[:space:]]*:' <<< "${scan_output}" || ! grep -Eq '"score"[[:space:]]*:' <<< "${scan_output}"; then
    ok=0
    error="Rspamd functional scan returned an invalid response"
elif [[ "${milter_status}" -ne 0 ]]; then
    ok=0
    error="Rspamd Milter transaction failed"
elif [[ "${workers_after_status}" -ne 0 || -z "${workers_after}" ]]; then
    ok=0
    error="Rspamd scan and proxy workers were not running after the probe"
elif [[ "${workers_before}" != "${workers_after}" ]]; then
    ok=0
    error="Rspamd replaced a scan or proxy worker during the probe"
fi

endpoint="${RSPAMD_SCAN_ENDPOINT} scan; ${RSPAMD_MILTER_HOST}:${RSPAMD_MILTER_PORT} milter"

if [[ "${OUTPUT_FORMAT}" == "json" ]]; then
    if [[ "${ok}" -eq 1 ]]; then
        printf '{"ok":true,"latencyMs":%d,"lastError":null,"checkedAt":"%s","endpoint":"%s","workerGeneration":"%s","mainPid":%d,"restartCount":%d}\n' \
            "${latency_ms}" "${checked_at}" "${endpoint}" "${worker_generation}" "${main_pid}" "${restart_count}"
    else
        printf '{"ok":false,"latencyMs":%d,"lastError":"%s","checkedAt":"%s","endpoint":"%s","workerGeneration":"%s","mainPid":%d,"restartCount":%d}\n' \
            "${latency_ms}" "${error}" "${checked_at}" "${endpoint}" "${worker_generation}" "${main_pid}" "${restart_count}"
    fi
else
    if [[ "${ok}" -eq 1 ]]; then
        printf 'Rspamd functional scan passed in %dms\n' "${latency_ms}"
    else
        printf '%s\n' "${error}" >&2
    fi
fi

if [[ "${ok}" -ne 1 ]]; then
    if [[ -n "${scan_output}" ]]; then
        printf 'rspamc: %.200s\n' "${scan_output//$'\n'/ }" >&2
    fi
    if [[ -n "${milter_output}" ]]; then
        printf 'milter: %.200s\n' "${milter_output//$'\n'/ }" >&2
    fi
    exit 1
fi

#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
HEALTH_SCRIPT="${PROJECT_ROOT}/functions/rspamd_healthcheck.sh"
RECOVERY_SCRIPT="${PROJECT_ROOT}/functions/rspamd_health_recover.sh"
TMP_DIR=$(mktemp -d)
trap 'rm -rf "${TMP_DIR}"' EXIT

fail() {
    echo "[fail] $*" >&2
    exit 1
}

assert_contains() {
    local file="$1"
    local expected="$2"
    grep -Fq -- "${expected}" "${file}" || fail "Expected ${file} to contain: ${expected}"
}

[[ -x "${HEALTH_SCRIPT}" ]] || fail "Missing executable Rspamd functional health script"
[[ -x "${RECOVERY_SCRIPT}" ]] || fail "Missing executable Rspamd recovery script"

mkdir -p "${TMP_DIR}/bin" "${TMP_DIR}/state"

cat > "${TMP_DIR}/bin/rspamc" <<'EOF'
#!/usr/bin/env bash
case "${FAKE_RSPAMC_MODE:-ok}" in
    ok)
        printf '%s\n' '{"action":"no action","score":0.0}'
        ;;
    malformed)
        printf '%s\n' 'not-json'
        ;;
    fail)
        echo 'IO read error: unexpected EOF' >&2
        exit 1
        ;;
esac
EOF
chmod 0755 "${TMP_DIR}/bin/rspamc"

cat > "${TMP_DIR}/bin/milter-probe" <<'EOF'
#!/usr/bin/env bash
if [[ "${FAKE_MILTER_MODE:-ok}" == "fail" ]]; then
    echo 'Milter transaction failed' >&2
    exit 1
fi
printf '%s\n' 'Rspamd Milter transaction passed'
EOF
chmod 0755 "${TMP_DIR}/bin/milter-probe"

cat > "${TMP_DIR}/bin/ps" <<'EOF'
#!/usr/bin/env bash
call=0
if [[ -f "${FAKE_PS_STATE}" ]]; then
    call=$(<"${FAKE_PS_STATE}")
fi
call=$((call + 1))
printf '%s\n' "${call}" > "${FAKE_PS_STATE}"
if [[ "${FAKE_PS_MODE:-stable}" == "replaced" && "${call}" -gt 1 ]]; then
    printf '%s\n' \
        '102 1 rspamd: rspamd_proxy process (localhost:11332)' \
        '201 1 rspamd: normal process (localhost:11333)'
else
    printf '%s\n' \
        '101 1 rspamd: rspamd_proxy process (localhost:11332)' \
        '201 1 rspamd: normal process (localhost:11333)'
fi
EOF
chmod 0755 "${TMP_DIR}/bin/ps"

cat > "${TMP_DIR}/bin/systemctl-show" <<'EOF'
#!/usr/bin/env bash
if [[ "${FAKE_SYSTEMCTL_MODE:-ok}" == "fail" ]]; then
    exit 1
fi
if [[ "${FAKE_SYSTEMCTL_MODE:-ok}" == "malformed" ]]; then
    printf '%s\n' 'unknown'
    exit 0
fi
printf '%s\n' "${FAKE_RESTART_COUNT:-0}"
EOF
chmod 0755 "${TMP_DIR}/bin/systemctl-show"

run_health() {
    rm -f "${TMP_DIR}/ps-state"
    FAKE_PS_STATE="${TMP_DIR}/ps-state" \
        RSPAMC_BIN="${TMP_DIR}/bin/rspamc" \
        MILTER_PROBE_BIN="${TMP_DIR}/bin/milter-probe" \
        PS_BIN="${TMP_DIR}/bin/ps" \
        SYSTEMCTL_SHOW_BIN="${TMP_DIR}/bin/systemctl-show" \
        "${HEALTH_SCRIPT}" --json
}

FAKE_RSPAMC_MODE=ok FAKE_MILTER_MODE=ok FAKE_PS_MODE=stable run_health > "${TMP_DIR}/health-ok.json"
assert_contains "${TMP_DIR}/health-ok.json" '"ok":true'
assert_contains "${TMP_DIR}/health-ok.json" '127.0.0.1:11333 scan; 127.0.0.1:11332 milter'
assert_contains "${TMP_DIR}/health-ok.json" '"workerGeneration":'
assert_contains "${TMP_DIR}/health-ok.json" '"mainPid":1'
assert_contains "${TMP_DIR}/health-ok.json" '"restartCount":0'

if FAKE_RSPAMC_MODE=ok FAKE_MILTER_MODE=ok FAKE_PS_MODE=stable FAKE_SYSTEMCTL_MODE=fail run_health > "${TMP_DIR}/health-restart-state-fail.json" 2>/dev/null; then
    fail "Functional health probe accepted unavailable systemd restart state"
fi
assert_contains "${TMP_DIR}/health-restart-state-fail.json" '"ok":false'

if FAKE_RSPAMC_MODE=fail FAKE_MILTER_MODE=ok FAKE_PS_MODE=stable run_health > "${TMP_DIR}/health-fail.json" 2>/dev/null; then
    fail "Functional health probe accepted a failed scan"
fi
assert_contains "${TMP_DIR}/health-fail.json" '"ok":false'

if FAKE_RSPAMC_MODE=malformed FAKE_MILTER_MODE=ok FAKE_PS_MODE=stable run_health > "${TMP_DIR}/health-malformed.json" 2>/dev/null; then
    fail "Functional health probe accepted malformed scan output"
fi
assert_contains "${TMP_DIR}/health-malformed.json" '"ok":false'

if FAKE_RSPAMC_MODE=ok FAKE_MILTER_MODE=fail FAKE_PS_MODE=stable run_health > "${TMP_DIR}/health-milter-fail.json" 2>/dev/null; then
    fail "Functional health probe accepted a failed Milter transaction"
fi
assert_contains "${TMP_DIR}/health-milter-fail.json" '"ok":false'

if FAKE_RSPAMC_MODE=ok FAKE_MILTER_MODE=ok FAKE_PS_MODE=replaced run_health > "${TMP_DIR}/health-replaced.json" 2>/dev/null; then
    fail "Functional health probe accepted a worker replacement during the scan"
fi
assert_contains "${TMP_DIR}/health-replaced.json" '"ok":false'

cat > "${TMP_DIR}/bin/healthcheck" <<'EOF'
#!/usr/bin/env bash
if [[ "${FAKE_HEALTH_MODE:-fail}" == "ok" ]]; then
    printf '{"ok":true,"latencyMs":3,"lastError":null,"checkedAt":"2026-07-14T12:00:00Z","endpoint":"test","workerGeneration":"%s","mainPid":%s,"restartCount":%s}\n' \
        "${FAKE_WORKER_GENERATION:-generation-a}" "${FAKE_MAIN_PID:-100}" "${FAKE_RESTART_COUNT:-0}"
    exit 0
fi
printf '%s\n' '{"ok":false,"latencyMs":3,"lastError":"Rspamd functional scan failed","checkedAt":"2026-07-14T12:00:00Z","endpoint":"test","workerGeneration":"generation-a","mainPid":100,"restartCount":0}'
exit 1
EOF
chmod 0755 "${TMP_DIR}/bin/healthcheck"

cat > "${TMP_DIR}/bin/systemctl" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "${SYSTEMCTL_LOG}"
EOF
chmod 0755 "${TMP_DIR}/bin/systemctl"

run_recovery() {
    local now="$1"
    set +e
    FAKE_HEALTH_MODE="${FAKE_HEALTH_MODE:-fail}" \
        HEALTHCHECK_BIN="${TMP_DIR}/bin/healthcheck" \
        SYSTEMCTL_BIN="${TMP_DIR}/bin/systemctl" \
        SYSTEMCTL_LOG="${RECOVERY_SYSTEMCTL_LOG:-${TMP_DIR}/systemctl.log}" \
        STATE_DIR="${RECOVERY_STATE_DIR:-${TMP_DIR}/state}" \
        NOW_EPOCH="${now}" \
        FAILURE_THRESHOLD=3 \
        RESTART_COOLDOWN_SECONDS=900 \
        RECOVERY_SETTLE_SECONDS=0 \
        "${RECOVERY_SCRIPT}" >/dev/null 2>&1
    local status=$?
    set -e
    return "${status}"
}

run_recovery 1000 && fail "First failed health probe should be reported"
run_recovery 1001 && fail "Second failed health probe should be reported"
[[ ! -e "${TMP_DIR}/systemctl.log" ]] || fail "Rspamd restarted before the failure threshold"

run_recovery 1002 && fail "Failed post-restart health probe should remain unhealthy"
[[ "$(grep -Fc 'restart rspamd.service' "${TMP_DIR}/systemctl.log")" -eq 1 ]] || fail "Rspamd was not restarted exactly once at the failure threshold"

run_recovery 1100 && fail "Cooldown probe should remain unhealthy"
[[ "$(grep -Fc 'restart rspamd.service' "${TMP_DIR}/systemctl.log")" -eq 1 ]] || fail "Rspamd restart cooldown was not enforced"

FAKE_HEALTH_MODE=ok run_recovery 1101 || fail "Successful health probe did not reset recovery state"
assert_contains "${TMP_DIR}/state/status.json" '"ok":true'
assert_contains "${TMP_DIR}/state/state" 'failures=0'

mkdir -p "${TMP_DIR}/generation-state"
RECOVERY_STATE_DIR="${TMP_DIR}/generation-state" \
    RECOVERY_SYSTEMCTL_LOG="${TMP_DIR}/generation-systemctl.log" \
    FAKE_HEALTH_MODE=ok \
    FAKE_WORKER_GENERATION=generation-a \
    FAKE_MAIN_PID=100 \
    FAKE_RESTART_COUNT=0 \
    run_recovery 2000 || fail "Initial worker generation did not establish a healthy baseline"

RECOVERY_STATE_DIR="${TMP_DIR}/generation-state" \
    RECOVERY_SYSTEMCTL_LOG="${TMP_DIR}/generation-systemctl.log" \
    FAKE_HEALTH_MODE=ok \
    FAKE_WORKER_GENERATION=generation-controlled \
    FAKE_MAIN_PID=200 \
    FAKE_RESTART_COUNT=0 \
    run_recovery 2001 || fail "Intentional full Rspamd restart did not establish a new baseline"
assert_contains "${TMP_DIR}/generation-state/state" 'generation=generation-controlled'

for now in 2001 2002; do
    if RECOVERY_STATE_DIR="${TMP_DIR}/generation-state" \
        RECOVERY_SYSTEMCTL_LOG="${TMP_DIR}/generation-systemctl.log" \
        FAKE_HEALTH_MODE=ok \
        FAKE_WORKER_GENERATION=generation-b \
        FAKE_MAIN_PID=200 \
        FAKE_RESTART_COUNT=0 \
        run_recovery "${now}"; then
        fail "Worker replacement between probes was reported healthy"
    fi
done
[[ ! -e "${TMP_DIR}/generation-systemctl.log" ]] || fail "Rspamd restarted before repeated generation failures"

RECOVERY_STATE_DIR="${TMP_DIR}/generation-state" \
    RECOVERY_SYSTEMCTL_LOG="${TMP_DIR}/generation-systemctl.log" \
    FAKE_HEALTH_MODE=ok \
    FAKE_WORKER_GENERATION=generation-b \
    FAKE_MAIN_PID=200 \
    FAKE_RESTART_COUNT=0 \
    run_recovery 2003 || fail "Worker replacement did not recover after the threshold restart"
[[ "$(grep -Fc 'restart rspamd.service' "${TMP_DIR}/generation-systemctl.log")" -eq 1 ]] || fail "Generation failure did not restart Rspamd exactly once"
assert_contains "${TMP_DIR}/generation-state/state" 'generation=generation-b'
assert_contains "${TMP_DIR}/generation-state/state" 'failures=0'

mkdir -p "${TMP_DIR}/master-state"
RECOVERY_STATE_DIR="${TMP_DIR}/master-state" \
    RECOVERY_SYSTEMCTL_LOG="${TMP_DIR}/master-systemctl.log" \
    FAKE_HEALTH_MODE=ok \
    FAKE_WORKER_GENERATION=master-a \
    FAKE_MAIN_PID=500 \
    FAKE_RESTART_COUNT=0 \
    run_recovery 3000 || fail "Initial master generation did not establish a healthy baseline"
if RECOVERY_STATE_DIR="${TMP_DIR}/master-state" \
    RECOVERY_SYSTEMCTL_LOG="${TMP_DIR}/master-systemctl.log" \
    FAKE_HEALTH_MODE=ok \
    FAKE_WORKER_GENERATION=master-b \
    FAKE_MAIN_PID=600 \
    FAKE_RESTART_COUNT=1 \
    run_recovery 3001; then
    fail "Systemd crash restart between probes was reported healthy"
fi
assert_contains "${TMP_DIR}/master-state/state" 'failures=1'
[[ ! -e "${TMP_DIR}/master-systemctl.log" ]] || fail "Master crash triggered recovery before the threshold"

echo "[pass] Rspamd functional health and rate-limited recovery"

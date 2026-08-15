#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
GUARDED_DEPLOY="${PROJECT_ROOT}/functions/protocol_guarded_deploy.sh"
WEBMAIL_DEPLOY="${PROJECT_ROOT}/functions/10_webmail.sh"
FIXTURE_ROOT=$(mktemp -d)
trap 'rm -rf -- "${FIXTURE_ROOT}"' EXIT

EVENT_LOG="${FIXTURE_ROOT}/events.log"
ERROR_LOG="${FIXTURE_ROOT}/errors.log"
REQUESTED_SNAPSHOT="${FIXTURE_ROOT}/requested"
CURRENT_SNAPSHOT="${FIXTURE_ROOT}/current"
REPO_DIR="${FIXTURE_ROOT}/repo"
BACKEND_SRC="${REPO_DIR}/webmail-backend"
FRONTEND_SRC="${REPO_DIR}/webmail-frontend"
BACKEND_DIR="${FIXTURE_ROOT}/live/backend"
FRONTEND_DIR="${FIXTURE_ROOT}/live/frontend"
LEGACY_ADMIN_DIR="${FIXTURE_ROOT}/live/legacy-admin"
# The extracted production function expands these variables at runtime.
# shellcheck disable=SC2034
NGINX_CONF="${FIXTURE_ROOT}/live/mailserver.conf"
# shellcheck disable=SC2034
BACKEND_ENV="${FIXTURE_ROOT}/live/webmail-backend.env"
# shellcheck disable=SC2034
BACKEND_SERVICE="${FIXTURE_ROOT}/live/openmailstack.service"
# shellcheck disable=SC2034
REMEDIATE_SCRIPT="${FIXTURE_ROOT}/live/openmailstack-remediate"
# shellcheck disable=SC2034
REMEDIATE_SUDOERS="${FIXTURE_ROOT}/live/openmailstack-remediate.sudoers"
# shellcheck disable=SC2034
SERVICE_FILE="${FIXTURE_ROOT}/live/openmailstack.service"
# shellcheck disable=SC2034
WEBMAIL_USER="openmailstack"
# shellcheck disable=SC2034
WEBMAIL_GROUP="openmailstack"
# shellcheck disable=SC2034
OMS_PROTOCOL_GUARDED_DEPLOY=1

mkdir -p \
    "${REQUESTED_SNAPSHOT}/backend" \
    "${REQUESTED_SNAPSHOT}/frontend" \
    "${REQUESTED_SNAPSHOT}/legacy-admin" \
    "${CURRENT_SNAPSHOT}/backend" \
    "${CURRENT_SNAPSHOT}/frontend" \
    "${CURRENT_SNAPSHOT}/legacy-admin" \
    "${BACKEND_SRC}" "${FRONTEND_SRC}/dist" "${REPO_DIR}/packaging/systemd" \
    "${BACKEND_DIR}" "${FRONTEND_DIR}" "${LEGACY_ADMIN_DIR}"

extract_function() {
    local source_file="$1"
    local function_name="$2"

    awk -v signature="${function_name}() {" '
        $0 == signature { capture=1 }
        capture { print }
        capture && /^}$/ { exit }
    ' "${source_file}"
}

for function_spec in \
    "${GUARDED_DEPLOY}:restore_webmail_from" \
    "${WEBMAIL_DEPLOY}:build_backend" \
    "${WEBMAIL_DEPLOY}:build_frontend" \
    "${WEBMAIL_DEPLOY}:deploy_frontend" \
    "${WEBMAIL_DEPLOY}:deploy_backend"; do
    source_file="${function_spec%:*}"
    function_name="${function_spec##*:}"
    function_source=$(extract_function "${source_file}" "${function_name}")
    [[ -n "${function_source}" ]] || {
        echo "FAIL: could not extract ${function_name} from guarded deploy" >&2
        exit 1
    }
    # shellcheck disable=SC2294
    eval "${function_source}"
done

# shellcheck source=/dev/null
source "${PROJECT_ROOT}/functions/lib_protocol_guard.sh"
# shellcheck source=/dev/null
source "${PROJECT_ROOT}/functions/lib_webmail_runtime.sh"

FAIL_STEP=""
FAIL_REMAINING=0
ACTIVE_RESTORE_SOURCE="none"
SCHEDULER_PRESENT=1
declare -A UNIT_STATE=()
declare -A UNIT_LOAD_STATE=()

event() {
    printf '%s\n' "$1" >> "${EVENT_LOG}"
}

consume_failure() {
    local step="$1"

    if [[ "${FAIL_STEP}" == "${step}" && ${FAIL_REMAINING} -gt 0 ]]; then
        FAIL_REMAINING=$((FAIL_REMAINING - 1))
        return 0
    fi
    return 1
}

reset_fixture() {
    : > "${EVENT_LOG}"
    : > "${ERROR_LOG}"
    FAIL_STEP=""
    FAIL_REMAINING=0
    ACTIVE_RESTORE_SOURCE="none"
    SCHEDULER_PRESENT=1
    UNIT_STATE[openmailstack.service]="active"
    UNIT_STATE[openmailstack-scheduler-worker.service]="active"
    UNIT_LOAD_STATE[openmailstack.service]="loaded"
    UNIT_LOAD_STATE[openmailstack-scheduler-worker.service]="loaded"
}

protocol_retry_command() {
    local attempts="$1"
    local _delay_seconds="$2"
    local attempt
    shift 2

    for ((attempt = 1; attempt <= attempts; attempt += 1)); do
        "$@" && return 0
    done
    return 1
}

openmailstack_webmail_scheduler_worker_managed() {
    [[ "${SCHEDULER_PRESENT}" == "1" ]]
}

systemctl() {
    local command_name="${1:-}"
    local unit_name="${2:-}"

    case "${command_name}" in
        stop)
            unit_name="${3:-}"
            if [[ "${unit_name}" == "openmailstack.service" ]]; then
                event "STOP_BACKEND"
                consume_failure stop-backend && return 1
                if consume_failure backend-remains-active; then
                    UNIT_STATE["${unit_name}"]="active"
                    return 0
                fi
            else
                event "STOP_SCHEDULER"
                consume_failure stop-scheduler && return 1
            fi
            UNIT_STATE["${unit_name}"]="inactive"
            ;;
        show)
            unit_name="${*: -1}"
            if [[ "$*" == *"--property=LoadState"* ]]; then
                consume_failure scheduler-discovery && return 1
                event "DISCOVER_${unit_name}_${UNIT_LOAD_STATE[${unit_name}]}"
                printf '%s\n' "${UNIT_LOAD_STATE[${unit_name}]}"
            else
                if [[ "${unit_name}" == "openmailstack.service" ]]; then
                    event "PROVE_BACKEND_${UNIT_STATE[${unit_name}]}"
                else
                    event "PROVE_SCHEDULER_${UNIT_STATE[${unit_name}]}"
                fi
                printf '%s\n' "${UNIT_STATE[${unit_name}]}"
            fi
            ;;
        daemon-reload)
            event "DAEMON_RELOAD:${ACTIVE_RESTORE_SOURCE}"
            ;;
        start)
            if [[ "${unit_name}" == "openmailstack.service" ]]; then
                event "START_BACKEND:${ACTIVE_RESTORE_SOURCE}"
                consume_failure start-backend && return 1
            else
                event "START_SCHEDULER:${ACTIVE_RESTORE_SOURCE}"
                consume_failure start-scheduler && return 1
            fi
            UNIT_STATE["${unit_name}"]="active"
            ;;
        reset-failed)
            if [[ "${unit_name}" == "openmailstack.service" ]]; then
                event "RESET_BACKEND:${ACTIVE_RESTORE_SOURCE}"
                consume_failure reset-backend && return 1
            else
                event "RESET_SCHEDULER:${ACTIVE_RESTORE_SOURCE}"
                consume_failure reset-scheduler && return 1
            fi
            return 0
            ;;
        is-active)
            unit_name="${*: -1}"
            [[ "${UNIT_STATE[${unit_name}]}" == "active" ]]
            ;;
        enable)
            event "ENABLE_${unit_name}:${ACTIVE_RESTORE_SOURCE}"
            ;;
        restart)
            event "RESTART_${unit_name}:${ACTIVE_RESTORE_SOURCE}"
            UNIT_STATE["${unit_name}"]="active"
            ;;
        reload)
            event "RELOAD_${unit_name}:${ACTIVE_RESTORE_SOURCE}"
            ;;
        *)
            echo "FAIL: unexpected systemctl command: $*" >&2
            return 1
            ;;
    esac
}

rsync() {
    local argument
    local copy_kind=""
    local source_label=""

    for argument in "$@"; do
        case "${argument}" in
            "${REQUESTED_SNAPSHOT}/backend/") copy_kind="BACKEND"; source_label="requested" ;;
            "${CURRENT_SNAPSHOT}/backend/") copy_kind="BACKEND"; source_label="current" ;;
            "${REQUESTED_SNAPSHOT}/frontend/") copy_kind="FRONTEND"; source_label="requested" ;;
            "${CURRENT_SNAPSHOT}/frontend/") copy_kind="FRONTEND"; source_label="current" ;;
            "${REQUESTED_SNAPSHOT}/legacy-admin/") copy_kind="LEGACY_ADMIN"; source_label="requested" ;;
            "${CURRENT_SNAPSHOT}/legacy-admin/") copy_kind="LEGACY_ADMIN"; source_label="current" ;;
            "${BACKEND_SRC}/") copy_kind="BACKEND"; source_label="forward" ;;
            "${FRONTEND_SRC}/dist/") copy_kind="FRONTEND"; source_label="forward" ;;
        esac
    done
    [[ -n "${copy_kind}" && -n "${source_label}" ]] || {
        echo "FAIL: unexpected rsync arguments: $*" >&2
        return 1
    }
    if [[ "${copy_kind}" == "BACKEND" ]]; then
        ACTIVE_RESTORE_SOURCE="${source_label}"
    fi
    event "COPY_${copy_kind}:${source_label}"
    if [[ "${copy_kind}" == "BACKEND" ]]; then
        consume_failure copy-backend && return 1
    fi
    return 0
}

cp() {
    local source_path="${2:-}"
    local copy_kind

    case "$(basename -- "${source_path}")" in
        mailserver.conf) copy_kind="NGINX_CONFIG" ;;
        webmail-backend.env) copy_kind="BACKEND_ENV" ;;
        openmailstack.service) copy_kind="BACKEND_UNIT" ;;
        openmailstack-remediate) copy_kind="REMEDIATE_SCRIPT" ;;
        openmailstack-remediate.sudoers) copy_kind="REMEDIATE_SUDOERS" ;;
        *)
            echo "FAIL: unexpected cp arguments: $*" >&2
            return 1
            ;;
    esac
    event "COPY_${copy_kind}:${ACTIVE_RESTORE_SOURCE}"
}

chown() { event "CHOWN:${ACTIVE_RESTORE_SOURCE}"; }
chmod() { event "CHMOD:${ACTIVE_RESTORE_SOURCE}"; }
visudo() { event "VISUDO:${ACTIVE_RESTORE_SOURCE}"; }
nginx() { event "NGINX_TEST:${ACTIVE_RESTORE_SOURCE}"; }
retire_legacy_upgrade_bridge() { event "RETIRE_BRIDGE:${ACTIVE_RESTORE_SOURCE}"; }
npm_install_for_build() {
    if [[ "$1" == "${BACKEND_SRC}" ]]; then
        event "PREPARE_BACKEND_BUILD_NPM"
    else
        event "PREPARE_FRONTEND_BUILD_NPM"
    fi
}
ensure_service_user() { event "ENSURE_SERVICE_USER"; }
install_remediation_bridge() { event "INSTALL_REMEDIATION_BRIDGE"; }
render_backend_env() { event "RENDER_BACKEND_ENV:${ACTIVE_RESTORE_SOURCE}"; }
check_deployed_webmail_backend_readiness() {
    event "READY_BACKEND:${ACTIVE_RESTORE_SOURCE}"
    consume_failure backend-readiness && return 1
    return 0
}

npm() {
    if [[ "${PWD}" == "${BACKEND_DIR}" ]]; then
        event "LIVE_NPM:${ACTIVE_RESTORE_SOURCE}"
        consume_failure live-npm && return 1
    elif [[ "$*" == *"${BACKEND_SRC}"* ]]; then
        event "BUILD_BACKEND_NPM"
    else
        event "BUILD_FRONTEND_NPM"
    fi
    return 0
}

install() {
    if [[ "$*" == *"${BACKEND_DIR}/VERSION"* ]]; then
        event "INSTALL_VERSION:${ACTIVE_RESTORE_SOURCE}"
    elif [[ "$*" == *"${SERVICE_FILE}"* ]]; then
        event "INSTALL_BACKEND_UNIT:${ACTIVE_RESTORE_SOURCE}"
    else
        event "INSTALL_PATH:${ACTIVE_RESTORE_SOURCE}"
    fi
}

prepare_fixture() { event "PREPARE"; }
apply_requested_fixture() { restore_webmail_from "$1"; }
validate_requested_fixture() { event "VALIDATE_REQUESTED"; }
recover_current_fixture() { restore_webmail_from "${CURRENT_SNAPSHOT}"; }
validate_recovered_fixture() { event "VALIDATE_RECOVERED"; }
deploy_forward_fixture() { deploy_backend; }
deploy_release_fixture() {
    build_frontend || return 1
    build_backend || return 1
    deploy_backend || return 1
    deploy_frontend
}
validate_forward_fixture() { event "VALIDATE_FORWARD"; }

line_number() {
    local expected_event="$1"
    local result

    result=$(grep -Fnm1 -- "${expected_event}" "${EVENT_LOG}" | cut -d: -f1) || true
    [[ -n "${result}" ]] || {
        echo "FAIL: missing event ${expected_event}" >&2
        cat "${EVENT_LOG}" >&2
        exit 1
    }
    printf '%s\n' "${result}"
}

assert_before() {
    local first_event="$1"
    local second_event="$2"
    local first_line
    local second_line

    first_line=$(line_number "${first_event}")
    second_line=$(line_number "${second_event}")
    if (( first_line >= second_line )); then
        echo "FAIL: ${first_event} did not occur before ${second_event}" >&2
        cat "${EVENT_LOG}" >&2
        exit 1
    fi
}

assert_absent() {
    local unexpected_event="$1"

    if grep -Fq -- "${unexpected_event}" "${EVENT_LOG}"; then
        echo "FAIL: unexpected event ${unexpected_event}" >&2
        cat "${EVENT_LOG}" >&2
        exit 1
    fi
}

run_reversible_failure() {
    local failure_step="$1"
    local failure_count="$2"
    local expected_status="$3"
    local actual_status

    reset_fixture
    FAIL_STEP="${failure_step}"
    FAIL_REMAINING="${failure_count}"
    set +e
    protocol_run_reversible_restore \
        "${REQUESTED_SNAPSHOT}" \
        prepare_fixture \
        apply_requested_fixture \
        validate_requested_fixture \
        recover_current_fixture \
        validate_recovered_fixture 2>> "${ERROR_LOG}"
    actual_status=$?
    set -e
    if [[ "${actual_status}" != "${expected_status}" ]]; then
        echo "FAIL: ${failure_step} returned ${actual_status}, expected ${expected_status}" >&2
        cat "${EVENT_LOG}" >&2
        exit 1
    fi
}

run_forward_failure() {
    local failure_step="$1"
    local failure_count="$2"
    local expected_status="$3"
    local actual_status

    reset_fixture
    FAIL_STEP="${failure_step}"
    FAIL_REMAINING="${failure_count}"
    set +e
    protocol_run_reversible_restore \
        webmail \
        prepare_fixture \
        deploy_release_fixture \
        validate_forward_fixture \
        recover_current_fixture \
        validate_recovered_fixture 2>> "${ERROR_LOG}"
    actual_status=$?
    set -e
    if [[ "${actual_status}" != "${expected_status}" ]]; then
        echo "FAIL: forward ${failure_step} returned ${actual_status}, expected ${expected_status}" >&2
        cat "${EVENT_LOG}" >&2
        exit 1
    fi
}

reset_fixture
restore_webmail_from "${REQUESTED_SNAPSHOT}"
assert_before "STOP_BACKEND" "COPY_BACKEND:requested"
assert_before "PROVE_BACKEND_inactive" "COPY_BACKEND:requested"
assert_before "STOP_SCHEDULER" "COPY_BACKEND:requested"
assert_before "PROVE_SCHEDULER_inactive" "COPY_BACKEND:requested"
assert_before "COPY_BACKEND_UNIT:requested" "DAEMON_RELOAD:requested"
assert_before "DAEMON_RELOAD:requested" "START_BACKEND:requested"
assert_before "NGINX_TEST:requested" "START_BACKEND:requested"
assert_before "RESET_BACKEND:requested" "START_BACKEND:requested"
assert_before "START_BACKEND:requested" "START_SCHEDULER:requested"
assert_before "RESET_SCHEDULER:requested" "START_SCHEDULER:requested"

echo "PASS: guarded webmail restore stops and proves backend consumers quiesced before copying, then starts only after code and configuration are complete"

reset_fixture
SCHEDULER_PRESENT=0
set +e
restore_webmail_from "${REQUESTED_SNAPSHOT}" 2>> "${ERROR_LOG}"
unmanaged_active_status=$?
set -e
[[ "${unmanaged_active_status}" == "1" ]]
assert_before "DISCOVER_openmailstack-scheduler-worker.service_loaded" "PROVE_SCHEDULER_active"
assert_absent "STOP_BACKEND"
assert_absent "STOP_SCHEDULER"
assert_absent "COPY_BACKEND:requested"
grep -Fq 'Refusing backend mutation while an unmanaged Scheduler worker is not quiesced' "${ERROR_LOG}"

reset_fixture
SCHEDULER_PRESENT=0
UNIT_STATE[openmailstack-scheduler-worker.service]="inactive"
restore_webmail_from "${REQUESTED_SNAPSHOT}"
assert_before "PROVE_SCHEDULER_inactive" "STOP_BACKEND"
[[ $(grep -Fc 'PROVE_SCHEDULER_inactive' "${EVENT_LOG}") -eq 2 ]]
last_scheduler_proof=$(grep -Fn 'PROVE_SCHEDULER_inactive' "${EVENT_LOG}" | tail -n 1 | cut -d: -f1)
(( last_scheduler_proof < $(line_number 'COPY_BACKEND:requested') ))
assert_absent "STOP_SCHEDULER"
assert_absent "RESET_SCHEDULER"
assert_absent "START_SCHEDULER"

reset_fixture
SCHEDULER_PRESENT=0
UNIT_LOAD_STATE[openmailstack-scheduler-worker.service]="not-found"
UNIT_STATE[openmailstack-scheduler-worker.service]="inactive"
restore_webmail_from "${REQUESTED_SNAPSHOT}"
assert_before "DISCOVER_openmailstack-scheduler-worker.service_not-found" "COPY_BACKEND:requested"
assert_absent "STOP_SCHEDULER"
assert_absent "RESET_SCHEDULER"
assert_absent "START_SCHEDULER"

echo "PASS: active unmanaged workers refuse mutation before any stop, while inactive unmanaged and truly absent workers remain untouched"

reset_fixture
FAIL_STEP="scheduler-discovery"
FAIL_REMAINING=1
set +e
openmailstack_quiesce_webmail_runtime_for_tree_mutation 2>> "${ERROR_LOG}"
discovery_status=$?
set -e
[[ "${discovery_status}" == "1" ]]
assert_absent "STOP_BACKEND"
assert_absent "STOP_SCHEDULER"
grep -Fq 'Could not determine whether openmailstack-scheduler-worker.service is loaded' "${ERROR_LOG}"

echo "PASS: scheduler discovery failure stops before runtime or file mutation"

reset_fixture
deploy_release_fixture
assert_before "BUILD_FRONTEND_NPM" "STOP_BACKEND"
assert_before "BUILD_BACKEND_NPM" "STOP_BACKEND"
assert_before "PROVE_BACKEND_inactive" "COPY_BACKEND:forward"
assert_before "PROVE_SCHEDULER_inactive" "COPY_BACKEND:forward"
assert_before "COPY_BACKEND:forward" "LIVE_NPM:forward"
assert_before "INSTALL_BACKEND_UNIT:forward" "RESET_BACKEND:forward"
assert_before "RESET_BACKEND:forward" "START_BACKEND:forward"
assert_before "RESET_SCHEDULER:forward" "START_SCHEDULER:forward"
assert_before "START_BACKEND:forward" "READY_BACKEND:forward"
assert_before "READY_BACKEND:forward" "COPY_FRONTEND:forward"

echo "PASS: guarded forward deploy builds both artifacts before mutation, quiesces backend and worker, proves backend readiness, then publishes the frontend"

reset_fixture
SCHEDULER_PRESENT=0
set +e
deploy_release_fixture 2>> "${ERROR_LOG}"
forward_unmanaged_active_status=$?
set -e
[[ "${forward_unmanaged_active_status}" == "1" ]]
assert_before "BUILD_BACKEND_NPM" "PROVE_SCHEDULER_active"
assert_absent "STOP_BACKEND"
assert_absent "STOP_SCHEDULER"
assert_absent "COPY_BACKEND:forward"
assert_absent "COPY_FRONTEND:forward"
grep -Fq 'Refusing backend mutation while an unmanaged Scheduler worker is not quiesced' "${ERROR_LOG}"

reset_fixture
SCHEDULER_PRESENT=0
UNIT_STATE[openmailstack-scheduler-worker.service]="inactive"
deploy_release_fixture
assert_before "PROVE_SCHEDULER_inactive" "STOP_BACKEND"
[[ $(grep -Fc 'PROVE_SCHEDULER_inactive' "${EVENT_LOG}") -eq 2 ]]
last_scheduler_proof=$(grep -Fn 'PROVE_SCHEDULER_inactive' "${EVENT_LOG}" | tail -n 1 | cut -d: -f1)
(( last_scheduler_proof < $(line_number 'COPY_BACKEND:forward') ))
assert_absent "STOP_SCHEDULER"
assert_absent "RESET_SCHEDULER"
assert_absent "START_SCHEDULER"
assert_before "READY_BACKEND:forward" "COPY_FRONTEND:forward"

echo "PASS: guarded forward deploy refuses an active unmanaged worker and preserves an inactive unmanaged worker without re-enabling it"

run_forward_failure backend-remains-active 1 20
assert_absent "COPY_BACKEND:forward"
assert_before "COPY_BACKEND:current" "START_BACKEND:current"
grep -Fq 'VALIDATE_RECOVERED' "${EVENT_LOG}"

run_forward_failure stop-scheduler 1 20
assert_absent "COPY_BACKEND:forward"
assert_before "COPY_BACKEND:current" "START_BACKEND:current"
grep -Fq 'VALIDATE_RECOVERED' "${EVENT_LOG}"

run_forward_failure live-npm 1 20
assert_absent "START_BACKEND:forward"
assert_before "LIVE_NPM:forward" "COPY_BACKEND:current"
assert_before "RESET_BACKEND:current" "START_BACKEND:current"
grep -Fq 'VALIDATE_RECOVERED' "${EVENT_LOG}"

run_forward_failure backend-readiness 30 20
[[ $(grep -Fc 'READY_BACKEND:forward' "${EVENT_LOG}") -eq 30 ]] || {
    echo "FAIL: forward backend readiness did not stop after its bounded attempts" >&2
    cat "${EVENT_LOG}" >&2
    exit 1
}
assert_before "READY_BACKEND:forward" "COPY_BACKEND:current"
assert_absent "COPY_FRONTEND:forward"
grep -Fq 'VALIDATE_RECOVERED' "${EVENT_LOG}"

echo "PASS: forward quiesce, scheduler-stop, live dependency, and bounded-readiness failures recover the captured deployment with status 20"

run_reversible_failure stop-backend 1 20
assert_absent "COPY_BACKEND:requested"
assert_before "COPY_BACKEND:current" "START_BACKEND:current"
grep -Fq 'VALIDATE_RECOVERED' "${EVENT_LOG}"

run_reversible_failure backend-remains-active 1 20
assert_absent "COPY_BACKEND:requested"
grep -Fq 'Timed out waiting for openmailstack.service to stop before mutating backend files' "${ERROR_LOG}"
[[ $(grep -Fc 'PROVE_BACKEND_active' "${EVENT_LOG}") -eq 30 ]] || {
    echo "FAIL: backend quiesce proof did not stop after its bounded attempts" >&2
    cat "${EVENT_LOG}" >&2
    exit 1
}
assert_before "COPY_BACKEND:current" "START_BACKEND:current"
grep -Fq 'VALIDATE_RECOVERED' "${EVENT_LOG}"

run_reversible_failure copy-backend 1 20
assert_absent "COPY_FRONTEND:requested"
assert_before "COPY_BACKEND:current" "START_BACKEND:current"
grep -Fq 'VALIDATE_RECOVERED' "${EVENT_LOG}"

run_reversible_failure start-backend 1 20
assert_absent "START_SCHEDULER:requested"
assert_before "START_BACKEND:requested" "COPY_BACKEND:current"
assert_before "COPY_BACKEND_UNIT:current" "START_BACKEND:current"
grep -Fq 'VALIDATE_RECOVERED' "${EVENT_LOG}"

run_reversible_failure reset-backend 1 20
assert_absent "START_BACKEND:requested"
assert_before "RESET_BACKEND:requested" "COPY_BACKEND:current"
assert_before "RESET_BACKEND:current" "START_BACKEND:current"
grep -Fq 'VALIDATE_RECOVERED' "${EVENT_LOG}"

echo "PASS: stop-command, bounded-quiesce, copy, reset-failed, and start failures recover the captured current deployment and return status 20"

run_reversible_failure stop-backend 2 30
assert_absent "COPY_BACKEND:requested"
assert_absent "COPY_BACKEND:current"
assert_absent "VALIDATE_RECOVERED"

run_reversible_failure copy-backend 2 30
assert_absent "START_BACKEND:requested"
assert_absent "START_BACKEND:current"
assert_absent "VALIDATE_RECOVERED"

run_reversible_failure start-backend 2 30
assert_absent "VALIDATE_RECOVERED"

run_reversible_failure reset-backend 2 30
assert_absent "START_BACKEND:requested"
assert_absent "START_BACKEND:current"
assert_absent "VALIDATE_RECOVERED"

echo "PASS: persistent stop, copy, reset-failed, and start failures remain fail-closed with unrecovered status 30"

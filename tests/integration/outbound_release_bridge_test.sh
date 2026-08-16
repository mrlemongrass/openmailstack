#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
FIXTURE_ROOT=$(mktemp -d)
trap 'rm -rf -- "${FIXTURE_ROOT}"' EXIT

FAKE_MYSQL="${FIXTURE_ROOT}/mysql"
QUERY_LOG="${FIXTURE_ROOT}/queries.log"
ARGUMENT_LOG="${FIXTURE_ROOT}/arguments.log"

cat > "${FAKE_MYSQL}" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

query=$(cat)
printf '%s\n' "$*" >> "${OMS_FAKE_ARGUMENT_LOG}"
printf '%s\n--QUERY-END--\n' "${query}" >> "${OMS_FAKE_QUERY_LOG}"

if [[ "${query}" == *"INFORMATION_SCHEMA.COLUMNS"* ]]; then
    printf '%s\n' "${OMS_FAKE_SCHEMA_COLUMN_COUNT}"
elif [[ "${query}" == *"FROM scheduled_emails"* ]]; then
    printf '%s\n' "${OMS_FAKE_NONLEGACY_ROWS}"
else
    echo "unexpected query" >&2
    exit 92
fi
EOF
chmod 0755 "${FAKE_MYSQL}"

# shellcheck source=/dev/null
source "${PROJECT_ROOT}/functions/lib_outbound_release_bridge.sh"

run_check() {
    local schema_columns="$1"
    local nonlegacy_rows="$2"
    : > "${QUERY_LOG}"
    : > "${ARGUMENT_LOG}"
    OMS_FAKE_SCHEMA_COLUMN_COUNT="${schema_columns}" \
    OMS_FAKE_NONLEGACY_ROWS="${nonlegacy_rows}" \
    OMS_FAKE_QUERY_LOG="${QUERY_LOG}" \
    OMS_FAKE_ARGUMENT_LOG="${ARGUMENT_LOG}" \
        openmailstack_verify_outbound_bridge_transition \
            "${FAKE_MYSQL}" 127.0.0.1 3306 fixture-user fixture-secret fixture-db
}

run_check 0 99
[[ $(grep -Fc -- '--QUERY-END--' "${QUERY_LOG}") -eq 1 ]] \
    || { echo 'FAIL: a legacy schema should require one read-only query' >&2; exit 1; }

run_check 24 0
[[ $(grep -Fc -- '--QUERY-END--' "${QUERY_LOG}") -eq 2 ]] \
    || { echo 'FAIL: an expanded schema should prove its row state' >&2; exit 1; }
grep -Fq 'idempotency_key IS NOT NULL' "${QUERY_LOG}"
grep -Fq "COALESCE(submission_kind, '') <> 'scheduled'" "${QUERY_LOG}"
grep -Fq "COALESCE(status, '') <> 'scheduled'" "${QUERY_LOG}"
grep -Fq 'smtp_accepted_at IS NOT NULL' "${QUERY_LOG}"
grep -Fq 'removed_at IS NOT NULL' "${QUERY_LOG}"
if grep -Fq 'fixture-secret' "${ARGUMENT_LOG}"; then
    echo 'FAIL: database password was exposed on a command argument' >&2
    exit 1
fi

if run_check 24 1 >"${FIXTURE_ROOT}/unsafe.out" 2>&1; then
    echo 'FAIL: a universal row was accepted by the legacy transition preflight' >&2
    exit 1
fi
grep -Fq 'nonlegacy outbound row' "${FIXTURE_ROOT}/unsafe.out"

if run_check 5 0 >"${FIXTURE_ROOT}/partial.out" 2>&1; then
    echo 'FAIL: a partially expanded schema was accepted' >&2
    exit 1
fi
grep -Fq 'partially expanded' "${FIXTURE_ROOT}/partial.out"

if run_check invalid 0 >"${FIXTURE_ROOT}/malformed.out" 2>&1; then
    echo 'FAIL: malformed database evidence was accepted' >&2
    exit 1
fi
grep -Fq 'invalid schema evidence' "${FIXTURE_ROOT}/malformed.out"

MARKER_SOURCE="${FIXTURE_ROOT}/source-marker"
MARKER_CANDIDATE="${FIXTURE_ROOT}/candidate-marker"
RUNTIME_ROOT="${FIXTURE_ROOT}/runtime"
BACKEND_ENV="${FIXTURE_ROOT}/webmail-backend.env"
RECOVERY_SNAPSHOT="${FIXTURE_ROOT}/recovery-snapshot"
printf 'universal-outbox-bridge-v1\n' > "${MARKER_SOURCE}"
cp "${MARKER_SOURCE}" "${MARKER_CANDIDATE}"
chmod 0444 "${MARKER_CANDIDATE}"
mkdir -p "${RUNTIME_ROOT}/src" "${RUNTIME_ROOT}/uploads"
cp "${MARKER_SOURCE}" "${RUNTIME_ROOT}/OUTBOUND_RELEASE_COMPATIBILITY"
for runtime_file in config.js scheduled-send.js api.js index.js eas-send.js; do
    printf 'trusted runtime fixture: %s\n' "${runtime_file}" > "${RUNTIME_ROOT}/src/${runtime_file}"
done
chmod -R go-w "${RUNTIME_ROOT}"

stat() {
    [[ "$1" == '-c' && "$2" == '%u:%g:%a' && "$3" == '--' ]] || return 93
    case "$4" in
        "${MARKER_CANDIDATE}"|"${RUNTIME_ROOT}/OUTBOUND_RELEASE_COMPATIBILITY"|"${RECOVERY_SNAPSHOT}/backend/OUTBOUND_RELEASE_COMPATIBILITY")
            printf '%s\n' "${OMS_FAKE_MARKER_METADATA:-0:0:444}"
            ;;
        "${BACKEND_ENV}"|*/webmail-backend.env)
            printf '%s\n' "${OMS_FAKE_ENV_METADATA:-0:0:600}"
            ;;
        "${RECOVERY_SNAPSHOT}")
            printf '0:0:700\n'
            ;;
        "${FIXTURE_ROOT}")
            printf '0:0:%s\n' "$(command stat -c '%a' -- "$4")"
            ;;
        /tmp|/)
            printf '0:0:755\n'
            ;;
        *)
            command stat "$@"
            ;;
    esac
}

find() {
    if [[ "$1" == "${RUNTIME_ROOT}" && -n "${OMS_FAKE_RUNTIME_UNSAFE_PATH:-}" ]]; then
        printf '%s\n' "${OMS_FAKE_RUNTIME_UNSAFE_PATH}"
        return 0
    fi
    if [[ "$1" == "${RUNTIME_ROOT}" && "$*" == *'-print0'* \
        && "${OMS_FAKE_SYMLINK_FIND_FAILURE:-0}" == '1' ]]; then
        command find "$@"
        return 91
    fi
    command find "$@"
}

OMS_FAKE_MARKER_METADATA='0:0:444' \
    openmailstack_outbound_compatibility_marker_is_trusted "${MARKER_SOURCE}" "${MARKER_CANDIDATE}"
if OMS_FAKE_MARKER_METADATA='1000:1000:444' \
    openmailstack_outbound_compatibility_marker_is_trusted "${MARKER_SOURCE}" "${MARKER_CANDIDATE}"; then
    echo 'FAIL: a service-owned compatibility marker was trusted' >&2
    exit 1
fi
chmod 0644 "${MARKER_CANDIDATE}"
printf 'tampered-marker\n' > "${MARKER_CANDIDATE}"
chmod 0444 "${MARKER_CANDIDATE}"
if OMS_FAKE_MARKER_METADATA='0:0:444' \
    openmailstack_outbound_compatibility_marker_is_trusted "${MARKER_SOURCE}" "${MARKER_CANDIDATE}"; then
    echo 'FAIL: a content-tampered compatibility marker was trusted' >&2
    exit 1
fi

OMS_FAKE_MARKER_METADATA='0:0:444' \
    openmailstack_outbound_runtime_is_trusted "${MARKER_SOURCE}" "${RUNTIME_ROOT}"
chmod 0777 "${FIXTURE_ROOT}"
if OMS_FAKE_MARKER_METADATA='0:0:444' \
    openmailstack_outbound_runtime_is_trusted "${MARKER_SOURCE}" "${RUNTIME_ROOT}"; then
    echo 'FAIL: a runtime beneath a service-replaceable parent was trusted' >&2
    exit 1
fi
if [[ ${EUID} -eq 0 ]] && command -v setpriv >/dev/null 2>&1; then
    setpriv --reuid=65534 --regid=65534 --clear-groups \
        mv -- "${RUNTIME_ROOT}" "${RUNTIME_ROOT}-service-replaced"
    mv -- "${RUNTIME_ROOT}-service-replaced" "${RUNTIME_ROOT}"
fi
chmod 0700 "${FIXTURE_ROOT}"
mv "${RUNTIME_ROOT}/src" "${RUNTIME_ROOT}/src-real"
ln -s src-real "${RUNTIME_ROOT}/src"
if OMS_FAKE_MARKER_METADATA='0:0:444' \
    openmailstack_outbound_runtime_is_trusted "${MARKER_SOURCE}" "${RUNTIME_ROOT}"; then
    echo 'FAIL: a symlink-replaceable src parent was trusted' >&2
    exit 1
fi
rm "${RUNTIME_ROOT}/src"
mv "${RUNTIME_ROOT}/src-real" "${RUNTIME_ROOT}/src"
if OMS_FAKE_MARKER_METADATA='0:0:444' \
    OMS_FAKE_RUNTIME_UNSAFE_PATH="${RUNTIME_ROOT}/src" \
    openmailstack_outbound_runtime_is_trusted "${MARKER_SOURCE}" "${RUNTIME_ROOT}"; then
    echo 'FAIL: a runtime with a service-replaceable src parent was trusted' >&2
    exit 1
fi

NEWLINE_RUNTIME_SYMLINK="${RUNTIME_ROOT}/src/internal"$'\n'"config.js"
ln -s config.js "${RUNTIME_ROOT}/src/internal-config.js"
ln -s config.js "${NEWLINE_RUNTIME_SYMLINK}"
OMS_FAKE_MARKER_METADATA='0:0:444' \
    openmailstack_outbound_runtime_is_trusted "${MARKER_SOURCE}" "${RUNTIME_ROOT}"
if OMS_FAKE_MARKER_METADATA='0:0:444' OMS_FAKE_SYMLINK_FIND_FAILURE=1 \
    openmailstack_outbound_runtime_is_trusted "${MARKER_SOURCE}" "${RUNTIME_ROOT}"; then
    echo 'FAIL: a failed NUL-safe symlink enumeration was trusted' >&2
    exit 1
fi
if [[ ${EUID} -eq 0 ]] && command -v setpriv >/dev/null 2>&1; then
    chmod 0755 "${FIXTURE_ROOT}"
    # shellcheck disable=SC2016
    if setpriv --reuid=65534 --regid=65534 --clear-groups \
        sh -c 'printf "%s\n" tampered > "$1"' _ \
        "${RUNTIME_ROOT}/src/internal-config.js" >/dev/null 2>&1; then
        echo 'FAIL: an unprivileged user changed a protected internal symlink target' >&2
        exit 1
    fi
    chmod 0700 "${FIXTURE_ROOT}"
fi
rm "${RUNTIME_ROOT}/src/internal-config.js" "${NEWLINE_RUNTIME_SYMLINK}"

printf 'service-controlled\n' > "${RUNTIME_ROOT}/uploads/service-controlled.js"
chmod 0777 "${RUNTIME_ROOT}/uploads"
chmod 0666 "${RUNTIME_ROOT}/uploads/service-controlled.js"
ln -s ../uploads/service-controlled.js "${RUNTIME_ROOT}/src/upload-controlled.js"
if [[ ${EUID} -eq 0 ]] && command -v setpriv >/dev/null 2>&1; then
    chmod 0755 "${FIXTURE_ROOT}"
    # shellcheck disable=SC2016
    setpriv --reuid=65534 --regid=65534 --clear-groups \
        sh -c 'printf "%s\n" tampered-by-service > "$1"' _ \
        "${RUNTIME_ROOT}/src/upload-controlled.js"
    grep -Fq 'tampered-by-service' "${RUNTIME_ROOT}/uploads/service-controlled.js"
    chmod 0700 "${FIXTURE_ROOT}"
fi
if OMS_FAKE_MARKER_METADATA='0:0:444' \
    openmailstack_outbound_runtime_is_trusted "${MARKER_SOURCE}" "${RUNTIME_ROOT}"; then
    echo 'FAIL: a protected runtime symlink into service-writable uploads was trusted' >&2
    exit 1
fi
rm "${RUNTIME_ROOT}/src/upload-controlled.js" "${RUNTIME_ROOT}/uploads/service-controlled.js"
chmod 0755 "${RUNTIME_ROOT}/uploads"

printf 'OMS_OUTBOUND_RELEASE_MODE="bridge"\n' > "${BACKEND_ENV}"
openmailstack_outbound_environment_is_trusted "${BACKEND_ENV}"
if OMS_FAKE_ENV_METADATA='1000:1000:600' \
    openmailstack_outbound_environment_is_trusted "${BACKEND_ENV}"; then
    echo 'FAIL: a service-owned outbound environment was trusted' >&2
    exit 1
fi
if OMS_FAKE_ENV_METADATA='0:0:644' \
    openmailstack_outbound_environment_is_trusted "${BACKEND_ENV}"; then
    echo 'FAIL: a non-root-only outbound environment was trusted' >&2
    exit 1
fi

extract_function() {
    local source_file="$1"
    local function_name="$2"
    awk -v signature="${function_name}() {" '
        $0 == signature { capture=1 }
        capture { print }
        capture && /^}$/ { exit }
    ' "${source_file}"
}

validation_source=$(extract_function \
    "${PROJECT_ROOT}/functions/protocol_guarded_deploy.sh" \
    validate_live_outbound_rollback_target)
[[ -n "${validation_source}" ]]
# shellcheck disable=SC2294
eval "${validation_source}"
recovery_validation_source=$(extract_function \
    "${PROJECT_ROOT}/functions/protocol_guarded_deploy.sh" \
    validate_recovered_outbound_runtime)
[[ -n "${recovery_validation_source}" ]]
# shellcheck disable=SC2294
eval "${recovery_validation_source}"
record_legacy_source=$(extract_function \
    "${PROJECT_ROOT}/functions/protocol_guarded_deploy.sh" \
    record_legacy_unmarked_rollback_state)
[[ -n "${record_legacy_source}" ]]
# shellcheck disable=SC2294
eval "${record_legacy_source}"
# Used by the dynamically extracted guarded-deploy function above.
# shellcheck disable=SC2034
OUTBOUND_COMPATIBILITY_SOURCE="${MARKER_SOURCE}"
# shellcheck disable=SC2034
BACKEND_DIR="${RUNTIME_ROOT}"
# shellcheck disable=SC2034
OUTBOUND_COMPATIBILITY_LIVE="${RUNTIME_ROOT}/OUTBOUND_RELEASE_COMPATIBILITY"
printf 'universal-outbox-bridge-v1\n' > "${MARKER_CANDIDATE}"
chmod 0444 "${MARKER_CANDIDATE}"
# shellcheck source=/dev/null
source "${PROJECT_ROOT}/functions/lib_os.sh"
# shellcheck source=/dev/null
source "${PROJECT_ROOT}/functions/lib_protocol_guard.sh"
OMS_FAKE_MARKER_METADATA='0:0:444' validate_live_outbound_rollback_target bridge
if OMS_FAKE_MARKER_METADATA='0:0:444' \
    OMS_FAKE_RUNTIME_UNSAFE_PATH="${RUNTIME_ROOT}/src" \
    validate_live_outbound_rollback_target bridge; then
    echo 'FAIL: writable runtime ancestry qualified as a live bridge rollback target' >&2
    exit 1
fi
printf 'OMS_OUTBOUND_RELEASE_MODE="active"\n' > "${BACKEND_ENV}"
OMS_FAKE_MARKER_METADATA='0:0:444' validate_live_outbound_rollback_target
if OMS_FAKE_MARKER_METADATA='0:0:444' validate_live_outbound_rollback_target bridge; then
    echo 'FAIL: active live mode qualified as the required bridge rollback target' >&2
    exit 1
fi
# A failed active deployment restores the captured bridge environment; the
# exact bridge precondition must qualify again before the next active attempt.
printf 'OMS_OUTBOUND_RELEASE_MODE="bridge"\n' > "${BACKEND_ENV}"
OMS_FAKE_MARKER_METADATA='0:0:444' validate_live_outbound_rollback_target bridge

mkdir -p "${RECOVERY_SNAPSHOT}/backend"
cp "${MARKER_SOURCE}" "${RECOVERY_SNAPSHOT}/backend/OUTBOUND_RELEASE_COMPATIBILITY"
printf 'OMS_OUTBOUND_RELEASE_MODE="bridge"\n' > "${RECOVERY_SNAPSHOT}/webmail-backend.env"
printf 'OMS_OUTBOUND_RELEASE_MODE="active"\n' > "${BACKEND_ENV}"
if validate_recovered_outbound_runtime "${RECOVERY_SNAPSHOT}"; then
    echo 'FAIL: recovery accepted a live mode different from the captured bridge' >&2
    exit 1
fi
printf 'OMS_OUTBOUND_RELEASE_MODE="bridge"\n' > "${BACKEND_ENV}"
LEGACY_RECOVERY_SNAPSHOT="${FIXTURE_ROOT}/legacy-recovery-snapshot"
mkdir -p "${LEGACY_RECOVERY_SNAPSHOT}/backend"
# A markerless snapshot is not intrinsically legacy. Even if caller state says
# it was recorded, a live compatible/active runtime must never qualify for the
# one-time first-bridge recovery exception.
# Used by the dynamically extracted guarded-deploy functions above.
# shellcheck disable=SC2034
ACTION='webmail-bridge'
ROLLBACK_READY=1
# shellcheck disable=SC2034
LEGACY_UNMARKED_BRIDGE_PREFLIGHT=1
LEGACY_UNMARKED_ROLLBACK_RECORDED=1
LEGACY_UNMARKED_ROLLBACK_DIR="${LEGACY_RECOVERY_SNAPSHOT}"
# shellcheck disable=SC2034
ROLLBACK_DIR="${LEGACY_RECOVERY_SNAPSHOT}"
rm "${RUNTIME_ROOT}/OUTBOUND_RELEASE_COMPATIBILITY"
printf 'OMS_OUTBOUND_RELEASE_MODE="active"\n' > "${BACKEND_ENV}"
if validate_recovered_outbound_runtime "${LEGACY_RECOVERY_SNAPSHOT}"; then
    echo 'FAIL: markerless recovery accepted a live active runtime' >&2
    exit 1
fi

# Record and validate the only permitted markerless case: this process has
# just captured the exact unmarked legacy state for its first bridge attempt.
cp -a "${RUNTIME_ROOT}/." "${LEGACY_RECOVERY_SNAPSHOT}/backend/"
printf 'OMS_SMTP_HOST="127.0.0.1"\n' > "${BACKEND_ENV}"
cp "${BACKEND_ENV}" "${LEGACY_RECOVERY_SNAPSHOT}/webmail-backend.env"
chmod 0600 "${LEGACY_RECOVERY_SNAPSHOT}/webmail-backend.env"
ROLLBACK_READY=0
LEGACY_UNMARKED_ROLLBACK_RECORDED=0
# shellcheck disable=SC2034
LEGACY_UNMARKED_ROLLBACK_DIR=''
record_legacy_unmarked_rollback_state "${LEGACY_RECOVERY_SNAPSHOT}"
[[ "${LEGACY_UNMARKED_ROLLBACK_RECORDED}" == '1' ]]
# shellcheck disable=SC2034
ROLLBACK_READY=1
validate_recovered_outbound_runtime "${LEGACY_RECOVERY_SNAPSHOT}"

printf 'OMS_SMTP_HOST="changed.example.test"\n' > "${BACKEND_ENV}"
if validate_recovered_outbound_runtime "${LEGACY_RECOVERY_SNAPSHOT}"; then
    echo 'FAIL: first-bridge legacy recovery accepted changed live environment content' >&2
    exit 1
fi
cp "${LEGACY_RECOVERY_SNAPSHOT}/webmail-backend.env" "${BACKEND_ENV}"
printf '\nchanged-runtime-byte\n' >> "${RUNTIME_ROOT}/src/config.js"
if validate_recovered_outbound_runtime "${LEGACY_RECOVERY_SNAPSHOT}"; then
    echo 'FAIL: first-bridge legacy recovery accepted changed live runtime content' >&2
    exit 1
fi
cp "${LEGACY_RECOVERY_SNAPSHOT}/backend/src/config.js" "${RUNTIME_ROOT}/src/config.js"
validate_recovered_outbound_runtime "${LEGACY_RECOVERY_SNAPSHOT}"

# Restore the compatible bridge fixture used by the forced active failure.
cp "${MARKER_SOURCE}" "${RUNTIME_ROOT}/OUTBOUND_RELEASE_COMPATIBILITY"
chmod 0444 "${RUNTIME_ROOT}/OUTBOUND_RELEASE_COMPATIBILITY"
printf 'OMS_OUTBOUND_RELEASE_MODE="bridge"\n' > "${BACKEND_ENV}"
DURABLE_ROW="${FIXTURE_ROOT}/durable-row"
DURABLE_ROW_AFTER_ACTIVE="${FIXTURE_ROOT}/durable-row-after-active"
SIDE_EFFECT_LOG="${FIXTURE_ROOT}/delivery-side-effects"
: > "${SIDE_EFFECT_LOG}"

prepare_active_failure() { return 0; }
apply_active_failure() {
    printf '%s\n' '901|owner@example.test|durable-before-rollback|claimed|payload-v2' > "${DURABLE_ROW}"
    cp "${DURABLE_ROW}" "${DURABLE_ROW_AFTER_ACTIVE}"
    printf 'OMS_OUTBOUND_RELEASE_MODE="active"\n' > "${BACKEND_ENV}"
}
reject_active_runtime() { return 1; }
restore_bridge_runtime() {
    printf 'OMS_OUTBOUND_RELEASE_MODE="bridge"\n' > "${BACKEND_ENV}"
}
validate_bridge_recovery() {
    validate_recovered_outbound_runtime "${RECOVERY_SNAPSHOT}" \
        && cmp -s "${DURABLE_ROW_AFTER_ACTIVE}" "${DURABLE_ROW}" \
        && [[ ! -s "${SIDE_EFFECT_LOG}" ]]
}

set +e
protocol_run_reversible_restore \
    active-deploy \
    prepare_active_failure \
    apply_active_failure \
    reject_active_runtime \
    restore_bridge_runtime \
    validate_bridge_recovery
recovery_status=$?
set -e
[[ "${recovery_status}" == "20" ]] || {
    echo 'FAIL: forced active failure did not recover through the attested bridge' >&2
    exit 1
}
cmp -s "${DURABLE_ROW_AFTER_ACTIVE}" "${DURABLE_ROW}" || {
    echo 'FAIL: bridge recovery changed the durable immediate row' >&2
    exit 1
}

echo 'PASS: outbound release bridge preflight, runtime attestation, and mode transitions are fail-closed'

#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_DIR=$(cd "${SCRIPT_DIR}/.." && pwd)
# shellcheck source=/dev/null
source "${SCRIPT_DIR}/lib_protocol_guard.sh"
ACTION="${1:-}"
RESTORE_SOURCE="${2:-}"
TARGET=""
CONFIG_PATH="${REPO_DIR}/config.conf"
GATE_SCRIPT="${REPO_DIR}/tests/integration/protocol_release_gate.sh"
POST_GATE_SCRIPT="${OMS_PROTOCOL_POST_GATE_SCRIPT:-${GATE_SCRIPT}}"
REQUIRED_FILE="${OMS_PROTOCOL_GATE_REQUIRED_FILE:-/etc/openmailstack/protocol-gate.required}"
BACKUP_ROOT="${OMS_PROTOCOL_ROLLBACK_ROOT:-/var/backups/openmailstack}"
BACKEND_DIR="/opt/openmailstack-backend"
FRONTEND_DIR="${OPENMAILSTACK_WEB_ROOT:-/var/www/openmailstack}"
LEGACY_ADMIN_DIR="/var/www/openmailstack-admin"
LEGACY_ADMIN_SOURCE="${REPO_DIR}/admin_portal_src/public"
LEGACY_UPGRADE_SCRIPT="/usr/local/bin/openmailstack-upgrade.sh"
LEGACY_UPGRADE_SUDOERS="/etc/sudoers.d/openmailstack-upgrade"
NGINX_CONF="/etc/nginx/sites-available/mailserver.conf"
BACKEND_ENV="/etc/openmailstack/webmail-backend.env"
BACKEND_SERVICE="/etc/systemd/system/openmailstack.service"
REMEDIATE_SCRIPT="/usr/local/sbin/openmailstack-remediate"
REMEDIATE_SUDOERS="/etc/sudoers.d/openmailstack-remediate"
DOVECOT_DIR="/etc/dovecot"
DOVECOT_DROPIN_DIR="/etc/systemd/system/dovecot.service.d"
LOCK_ROOT="/run/openmailstack"
LOCK_FILE="${LOCK_ROOT}/protocol-release.lock"
TARGET_SCRIPT=""
ROLLBACK_READY=0
DEPLOY_COMPLETE=0
ROLLBACK_RUNNING=0
REQUESTED_SNAPSHOT=""
RELEASE_VERSION=""

fail() {
    echo "Error: $1" >&2
    exit 1
}

fail_with_status() {
    local status="$1"
    shift
    echo "Error: $*" >&2
    exit "${status}"
}

retire_legacy_upgrade_bridge() {
    rm -f -- "${LEGACY_UPGRADE_SCRIPT}" "${LEGACY_UPGRADE_SUDOERS}" || return 1
    visudo -cf /etc/sudoers >/dev/null || return 1
}

case "${ACTION}" in
    webmail|dovecot)
        TARGET="${ACTION}"
        ;;
    restore-webmail)
        TARGET="webmail"
        [[ -n "${RESTORE_SOURCE}" ]] \
            || fail "Usage: $0 restore-webmail /var/backups/openmailstack/protocol-guarded-webmail-<timestamp>"
        ;;
    *)
        fail "Usage: $0 <webmail|dovecot> | restore-webmail <snapshot>"
        ;;
esac

if [[ "${TARGET}" == "webmail" ]]; then
    TARGET_SCRIPT="${SCRIPT_DIR}/10_webmail.sh"
else
    TARGET_SCRIPT="${SCRIPT_DIR}/04_dovecot.sh"
fi

[[ ${EUID} -eq 0 ]] || fail "Run guarded deployment as root"
[[ -f "${CONFIG_PATH}" ]] || fail "OpenMailStack config file not found: ${CONFIG_PATH}"
[[ -f "${REQUIRED_FILE}" ]] || fail "Protocol gate is not provisioned; run functions/provision_protocol_canary.sh first"
[[ -f "${GATE_SCRIPT}" ]] || fail "Protocol release gate not found: ${GATE_SCRIPT}"

# shellcheck source=/dev/null
source "${CONFIG_PATH}"

FRONTEND_DIR="${OPENMAILSTACK_WEB_ROOT:-/var/www/openmailstack}"
DOVECOT_MASTER_SECRET_FILE="${OMS_DOVECOT_MASTER_SECRET_FILE:-/etc/openmailstack/dovecot-master.secret}"

BACKUP_ROOT=$(protocol_safe_root_directory "${BACKUP_ROOT}" /var/backups "rollback root") \
    || fail "Unsafe rollback root"
BACKEND_DIR=$(protocol_safe_directory "${BACKEND_DIR}" /opt "backend deployment root") \
    || fail "Unsafe backend deployment path"
FRONTEND_DIR=$(protocol_safe_directory "${FRONTEND_DIR}" /var/www "frontend deployment root") \
    || fail "Unsafe frontend deployment path"
if [[ "${TARGET}" == "webmail" ]]; then
    LEGACY_ADMIN_DIR=$(protocol_safe_root_directory "${LEGACY_ADMIN_DIR}" /var/www "legacy Admin Portal deployment root") \
        || fail "Unsafe legacy Admin Portal deployment path"
fi
DOVECOT_DIR=$(protocol_safe_directory "${DOVECOT_DIR}" /etc "Dovecot configuration root") \
    || fail "Unsafe Dovecot configuration path"
[[ "${DOVECOT_DIR}" == "/etc/dovecot" ]] || fail "Unsafe Dovecot configuration path"
if [[ "${TARGET}" == "webmail" ]]; then
    RELEASE_VERSION=$(protocol_read_release_version "${REPO_DIR}/VERSION") \
        || fail "Repository VERSION is missing, unsafe, or invalid"
fi

LOCK_ROOT=$(protocol_prepare_secure_directory "${LOCK_ROOT}" /run "protocol release lock root") \
    || fail "Protocol release lock directory is unsafe"
LOCK_FILE="${LOCK_ROOT}/protocol-release.lock"
[[ "$(stat -c '%U:%G:%a' -- "${LOCK_ROOT}")" == "root:root:755" ]] \
    || fail "Protocol release lock directory must be root:root mode 0755"
protocol_validate_lock_file "${LOCK_FILE}" \
    || fail "Protocol release lock file is unsafe"
exec {PROTOCOL_LOCK_FD}>"${LOCK_FILE}"
chown root:root "${LOCK_FILE}"
chmod 0600 "${LOCK_FILE}"
protocol_acquire_lock "${PROTOCOL_LOCK_FD}" \
    || fail "Another guarded deploy or rollback is already running"
if [[ "${TARGET}" == "webmail" ]]; then
    retire_legacy_upgrade_bridge \
        || fail "The historical passwordless upgrade bridge could not be retired safely"
fi

timestamp=$(date -u +%Y%m%dT%H%M%SZ)
ROLLBACK_DIR="${BACKUP_ROOT}/protocol-guarded-${TARGET}-${timestamp}"
[[ ! -e "${ROLLBACK_DIR}" ]] || fail "Rollback snapshot path already exists: ${ROLLBACK_DIR}"

snapshot_file() {
    local source_path="$1"
    local destination_name="$2"
    [[ -e "${source_path}" ]] || fail "Required live file missing before guarded deployment: ${source_path}"
    cp -a "${source_path}" "${ROLLBACK_DIR}/${destination_name}" || return 1
}

prepare_snapshot() {
    install -d -o root -g root -m 0700 "${ROLLBACK_DIR}" || return 1
    if [[ "${TARGET}" == "webmail" ]]; then
        [[ -d "${BACKEND_DIR}" && -d "${FRONTEND_DIR}" && -d "${LEGACY_ADMIN_DIR}" ]] \
            || fail "Existing modern and legacy webmail deployments are required for guarded upgrade"
        install -d -o root -g root -m 0700 "${ROLLBACK_DIR}/backend" "${ROLLBACK_DIR}/frontend" || return 1
        rsync -a --delete --exclude uploads "${BACKEND_DIR}/" "${ROLLBACK_DIR}/backend/" || return 1
        rsync -a --delete "${FRONTEND_DIR}/" "${ROLLBACK_DIR}/frontend/" || return 1
        cp -a "${LEGACY_ADMIN_DIR}" "${ROLLBACK_DIR}/legacy-admin" || return 1
        snapshot_file "${NGINX_CONF}" "mailserver.conf" || return 1
        snapshot_file "${BACKEND_ENV}" "webmail-backend.env" || return 1
        snapshot_file "${BACKEND_SERVICE}" "openmailstack.service" || return 1
        snapshot_file "${REMEDIATE_SCRIPT}" "openmailstack-remediate" || return 1
        snapshot_file "${REMEDIATE_SUDOERS}" "openmailstack-remediate.sudoers" || return 1
    else
        [[ -d "${DOVECOT_DIR}" ]] || fail "Existing Dovecot configuration is required for guarded upgrade"
        install -d -o root -g root -m 0700 "${ROLLBACK_DIR}/dovecot" || return 1
        rsync -a --delete "${DOVECOT_DIR}/" "${ROLLBACK_DIR}/dovecot/" || return 1
        snapshot_file "${DOVECOT_MASTER_SECRET_FILE}" "dovecot-master.secret" || return 1
        if [[ -d "${DOVECOT_DROPIN_DIR}" ]]; then
            install -d -o root -g root -m 0700 "${ROLLBACK_DIR}/dovecot.service.d" || return 1
            rsync -a --delete "${DOVECOT_DROPIN_DIR}/" "${ROLLBACK_DIR}/dovecot.service.d/" || return 1
        fi
    fi
    ROLLBACK_READY=1
}

restore_webmail_from() {
    local snapshot_dir="$1"
    rsync -a --delete --exclude uploads "${snapshot_dir}/backend/" "${BACKEND_DIR}/" || return 1
    rsync -a --delete "${snapshot_dir}/frontend/" "${FRONTEND_DIR}/" || return 1
    rsync -a --delete "${snapshot_dir}/legacy-admin/" "${LEGACY_ADMIN_DIR}/" || return 1
    chown --reference="${snapshot_dir}/legacy-admin" "${LEGACY_ADMIN_DIR}" || return 1
    chmod --reference="${snapshot_dir}/legacy-admin" "${LEGACY_ADMIN_DIR}" || return 1
    cp -a "${snapshot_dir}/mailserver.conf" "${NGINX_CONF}" || return 1
    cp -a "${snapshot_dir}/webmail-backend.env" "${BACKEND_ENV}" || return 1
    cp -a "${snapshot_dir}/openmailstack.service" "${BACKEND_SERVICE}" || return 1
    cp -a "${snapshot_dir}/openmailstack-remediate" "${REMEDIATE_SCRIPT}" || return 1
    cp -a "${snapshot_dir}/openmailstack-remediate.sudoers" "${REMEDIATE_SUDOERS}" || return 1
    visudo -cf /etc/sudoers >/dev/null || return 1
    chown -R openmailstack:openmailstack "${BACKEND_DIR}" || return 1
    chown -R root:root "${FRONTEND_DIR}" || return 1
    retire_legacy_upgrade_bridge || return 1
    systemctl daemon-reload || return 1
    nginx -t || return 1
    systemctl restart openmailstack.service || return 1
    systemctl reload nginx || return 1
    if [[ -f /etc/openmailstack/scheduler.enabled && -f /etc/systemd/system/openmailstack-scheduler-worker.service ]]; then
        systemctl restart openmailstack-scheduler-worker.service || return 1
    fi
    return 0
}

restore_webmail() {
    restore_webmail_from "${ROLLBACK_DIR}"
}

apply_requested_webmail() {
    restore_webmail_from "$1"
}

deploy_legacy_admin() {
    local live_group

    [[ -d "${LEGACY_ADMIN_SOURCE}" ]] || return 1
    [[ -s "${LEGACY_ADMIN_DIR}/config.php" ]] || return 1
    php -l "${LEGACY_ADMIN_SOURCE}/api.php" >/dev/null || return 1
    live_group=$(stat -c '%g' -- "${LEGACY_ADMIN_DIR}") || return 1
    retire_legacy_upgrade_bridge || return 1
    rsync -a --delete "${LEGACY_ADMIN_SOURCE}/" "${LEGACY_ADMIN_DIR}/public/" || return 1
    chown -R root:"${live_group}" "${LEGACY_ADMIN_DIR}/public" || return 1
    find "${LEGACY_ADMIN_DIR}/public" -type d -exec chmod 0750 {} + || return 1
    find "${LEGACY_ADMIN_DIR}/public" -type f -exec chmod 0640 {} + || return 1
    install -o root -g "${live_group}" -m 0640 "${REPO_DIR}/VERSION" "${LEGACY_ADMIN_DIR}/VERSION" || return 1
    nginx -t || return 1
    systemctl reload nginx || return 1
}

restore_dovecot() {
    rsync -a --delete "${ROLLBACK_DIR}/dovecot/" "${DOVECOT_DIR}/" || return 1
    cp -a "${ROLLBACK_DIR}/dovecot-master.secret" "${DOVECOT_MASTER_SECRET_FILE}" || return 1
    if [[ -d "${ROLLBACK_DIR}/dovecot.service.d" ]]; then
        install -d -o root -g root -m 0755 "${DOVECOT_DROPIN_DIR}" || return 1
        rsync -a --delete "${ROLLBACK_DIR}/dovecot.service.d/" "${DOVECOT_DROPIN_DIR}/" || return 1
    fi
    systemctl daemon-reload || return 1
    doveconf -n >/dev/null || return 1
    systemctl restart dovecot.service || return 1
    return 0
}

validate_webmail_snapshot() {
    local requested_path="$1"
    local backup_root_real
    local snapshot_real
    local snapshot_name
    local required_directory
    local required_file

    [[ "${requested_path}" == /* ]] || fail "Rollback snapshot path must be absolute"
    [[ ! -L "${requested_path}" ]] || fail "Rollback snapshot must not be a symlink"
    [[ -d "${requested_path}" ]] || fail "Rollback snapshot is not a directory: ${requested_path}"

    backup_root_real=$(readlink -f -- "${BACKUP_ROOT}") \
        || fail "Rollback root is unavailable: ${BACKUP_ROOT}"
    snapshot_real=$(readlink -f -- "${requested_path}") \
        || fail "Rollback snapshot cannot be resolved: ${requested_path}"
    [[ "${requested_path}" == "${snapshot_real}" ]] \
        || fail "Rollback snapshot path must be canonical"
    [[ "$(dirname -- "${snapshot_real}")" == "${backup_root_real}" ]] \
        || fail "Rollback snapshot must be a direct child of ${BACKUP_ROOT}"

    snapshot_name=$(basename -- "${snapshot_real}")
    [[ "${snapshot_name}" =~ ^protocol-guarded-webmail-[0-9]{8}T[0-9]{6}Z$ ]] \
        || fail "Rollback snapshot name is not a guarded webmail snapshot"
    [[ "$(stat -c '%U:%G' -- "${snapshot_real}")" == "root:root" ]] \
        || fail "Rollback snapshot must be owned by root:root"
    [[ "$(stat -c '%a' -- "${snapshot_real}")" == "700" ]] \
        || fail "Rollback snapshot directory must have mode 0700"

    for required_directory in backend frontend legacy-admin; do
        [[ -d "${snapshot_real}/${required_directory}" && ! -L "${snapshot_real}/${required_directory}" ]] \
            || fail "Rollback snapshot is missing ${required_directory}/"
    done
    for required_file in mailserver.conf webmail-backend.env openmailstack.service openmailstack-remediate openmailstack-remediate.sudoers; do
        [[ -f "${snapshot_real}/${required_file}" && ! -L "${snapshot_real}/${required_file}" ]] \
            || fail "Rollback snapshot is missing ${required_file}"
    done
    for required_file in backend/package.json backend/src/index.js frontend/index.html legacy-admin/config.php legacy-admin/VERSION legacy-admin/public/api.php legacy-admin/public/js/app.js; do
        [[ -s "${snapshot_real}/${required_file}" && ! -L "${snapshot_real}/${required_file}" ]] \
            || fail "Rollback snapshot is missing ${required_file}"
    done

    printf '%s\n' "${snapshot_real}"
}

check_webmail_backend_readiness() {
    local readiness_status

    readiness_status=$(curl --silent --output /dev/null --write-out '%{http_code}' --noproxy '*' \
        --connect-timeout 1 --max-time 1 http://127.0.0.1:20000/api/auth/me) || return 1
    [[ "${readiness_status}" == "401" ]]
}

validate_webmail_runtime() {
    nginx -t || return 1
    systemctl is-active --quiet openmailstack.service || return 1
    systemctl is-active --quiet nginx.service || return 1
    [[ -s "${LEGACY_ADMIN_DIR}/config.php" && -s "${LEGACY_ADMIN_DIR}/VERSION" ]] || return 1
    [[ ! -e "${LEGACY_UPGRADE_SCRIPT}" && ! -L "${LEGACY_UPGRADE_SCRIPT}" ]] || return 1
    [[ ! -e "${LEGACY_UPGRADE_SUDOERS}" && ! -L "${LEGACY_UPGRADE_SUDOERS}" ]] || return 1
    php -l "${LEGACY_ADMIN_DIR}/public/api.php" >/dev/null || return 1
    if [[ -f /etc/openmailstack/scheduler.enabled && -f /etc/systemd/system/openmailstack-scheduler-worker.service ]]; then
        systemctl is-active --quiet openmailstack-scheduler-worker.service || return 1
    fi
    protocol_retry_command 30 1 check_webmail_backend_readiness || {
        echo "Webmail backend did not become ready within the bounded startup window" >&2
        return 1
    }
    curl --fail --silent --show-error --max-time 15 --noproxy '*' \
        --resolve "${MAIL_HOSTNAME}:443:127.0.0.1" \
        "https://${MAIL_HOSTNAME}/" -o /dev/null || return 1
    curl --fail --silent --show-error --max-time 15 --noproxy '*' \
        --resolve "${MAIL_HOSTNAME}:443:127.0.0.1" \
        "https://${MAIL_HOSTNAME}/SOGo/admin/" -o /dev/null || return 1
    return 0
}

validate_legacy_admin_against_snapshot() {
    local snapshot_dir="$1"
    [[ "$(stat -c '%u:%g:%a' -- "${LEGACY_ADMIN_DIR}")" == \
        "$(stat -c '%u:%g:%a' -- "${snapshot_dir}/legacy-admin")" ]] || return 1
    diff -qr "${snapshot_dir}/legacy-admin" "${LEGACY_ADMIN_DIR}" >/dev/null || return 1
}

validate_deployed_legacy_admin() {
    protocol_version_file_matches "${RELEASE_VERSION}" "${BACKEND_DIR}/VERSION" || return 1
    protocol_version_file_matches "${RELEASE_VERSION}" "${LEGACY_ADMIN_DIR}/VERSION" || return 1
    diff -qr "${LEGACY_ADMIN_SOURCE}" "${LEGACY_ADMIN_DIR}/public" >/dev/null || return 1
    [[ -z "$(find "${LEGACY_ADMIN_DIR}/public" -perm /022 -print -quit)" ]] || return 1
}

validate_requested_webmail() {
    validate_webmail_runtime || return 1
    validate_legacy_admin_against_snapshot "${REQUESTED_SNAPSHOT}" || return 1
    bash "${POST_GATE_SCRIPT}" "${CONFIG_PATH}" || return 1
}

validate_recovered_webmail() {
    validate_webmail_runtime || return 1
    validate_legacy_admin_against_snapshot "${ROLLBACK_DIR}" || return 1
    bash "${GATE_SCRIPT}" "${CONFIG_PATH}" || return 1
}

deploy_target() {
    local requested_target="$1"
    [[ "${requested_target}" == "${TARGET}" ]] || return 1
    (
        cd "${REPO_DIR}"
        if [[ "${TARGET}" == "webmail" ]]; then
            deploy_legacy_admin || exit 1
        fi
        OMS_PROTOCOL_GUARDED_DEPLOY=1 bash "${TARGET_SCRIPT}"
    )
}

validate_deployed_target() {
    if [[ "${TARGET}" == "webmail" ]]; then
        validate_webmail_runtime || return 1
        validate_deployed_legacy_admin || return 1
    fi
    echo "Running post-deploy public IMAPS and ActiveSync gate..."
    bash "${POST_GATE_SCRIPT}" "${CONFIG_PATH}" || return 1
}

validate_recovered_target() {
    if [[ "${TARGET}" == "webmail" ]]; then
        validate_recovered_webmail || return 1
    else
        bash "${GATE_SCRIPT}" "${CONFIG_PATH}" || return 1
    fi
}

restore_requested_webmail_snapshot() {
    local requested_snapshot
    local restore_status

    requested_snapshot=$(validate_webmail_snapshot "${RESTORE_SOURCE}")
    REQUESTED_SNAPSHOT="${requested_snapshot}"
    echo "Snapshotting the current webmail deployment before guarded rollback..."
    set +e
    protocol_run_reversible_restore \
        "${requested_snapshot}" \
        prepare_snapshot \
        apply_requested_webmail \
        validate_requested_webmail \
        restore_snapshot \
        validate_recovered_webmail
    restore_status=$?
    set -e

    case "${restore_status}" in
        0)
            ;;
        10)
            fail "The current deployment could not be snapshotted; no rollback was attempted"
            ;;
        20)
            fail_with_status 20 "Requested webmail snapshot failed validation; the pre-restore deployment was recovered"
            ;;
        30)
            fail_with_status 30 "Requested snapshot failed and the pre-restore deployment could not be recovered"
            ;;
        31)
            fail_with_status 31 "Pre-restore deployment was recovered but readiness or the protocol gate is failing"
            ;;
        *)
            fail "Guarded webmail rollback failed with unexpected status ${restore_status}"
            ;;
    esac

    complete_success
}

restore_snapshot() {
    local restore_status
    if [[ "${ROLLBACK_READY}" != "1" || "${ROLLBACK_RUNNING}" == "1" ]]; then
        return 1
    fi
    ROLLBACK_RUNNING=1
    echo "Guarded ${TARGET} deployment failed; restoring ${ROLLBACK_DIR}." >&2
    if [[ "${TARGET}" == "webmail" ]]; then
        if restore_webmail; then
            restore_status=0
        else
            restore_status=$?
        fi
    else
        if restore_dovecot; then
            restore_status=0
        else
            restore_status=$?
        fi
    fi
    ROLLBACK_RUNNING=0
    return "${restore_status}"
}

print_success() {
    if [[ "${ACTION}" == "restore-webmail" ]]; then
        echo "Guarded webmail rollback passed. Pre-restore snapshot retained at ${ROLLBACK_DIR}."
    else
        echo "Guarded ${TARGET} deployment passed. Rollback snapshot retained at ${ROLLBACK_DIR}."
    fi
}

complete_success() {
    trap '' HUP INT TERM
    DEPLOY_COMPLETE=1
    print_success
}

on_signal() {
    local signal="$1"
    local recovery_status
    set +e
    if [[ "${DEPLOY_COMPLETE}" == "1" ]]; then
        print_success
        exit 0
    fi
    protocol_recover_after_interruption \
        "${ROLLBACK_READY}" \
        "${DEPLOY_COMPLETE}" \
        restore_snapshot \
        validate_recovered_target
    recovery_status=$?
    set -e
    case "${recovery_status}" in
        0)
            ;;
        1)
            fail_with_status 30 "Guarded ${TARGET} deployment interrupted by ${signal}; rollback also failed"
            ;;
        2)
            fail_with_status 31 "Guarded ${TARGET} deployment interrupted by ${signal}; rollback completed but remains unhealthy"
            ;;
        *)
            fail_with_status 30 "Guarded ${TARGET} deployment interrupted by ${signal}; recovery returned unexpected status ${recovery_status}"
            ;;
    esac
    if [[ "${ROLLBACK_READY}" == "1" && "${DEPLOY_COMPLETE}" != "1" ]]; then
        fail_with_status 20 "Guarded ${TARGET} deployment interrupted by ${signal}; the prior release was restored"
    fi
    fail "Guarded ${TARGET} deployment interrupted by ${signal} before mutation"
}
trap 'on_signal HUP' HUP
trap 'on_signal INT' INT
trap 'on_signal TERM' TERM

if [[ "${ACTION}" == "restore-webmail" ]]; then
    restore_requested_webmail_snapshot
    exit 0
fi

echo "Running pre-deploy public IMAPS and ActiveSync gate..."
bash "${GATE_SCRIPT}" "${CONFIG_PATH}" \
    || fail "Pre-deploy protocol gate failed; no deployment was attempted"
echo "Running guarded deployment with local readiness and post-deploy protocol validation..."
set +e
protocol_run_reversible_restore \
    "${TARGET}" \
    prepare_snapshot \
    deploy_target \
    validate_deployed_target \
    restore_snapshot \
    validate_recovered_target
deploy_status=$?
set -e

case "${deploy_status}" in
    0)
        ;;
    10)
        fail "The current deployment could not be snapshotted; no deployment was attempted"
        ;;
    20)
        fail_with_status 20 "Deployment or post-deploy validation failed; the prior release was restored"
        ;;
    30)
        fail_with_status 30 "Deployment or validation failed and rollback could not be completed"
        ;;
    31)
        fail_with_status 31 "Rollback completed but readiness or the protocol gate is still failing"
        ;;
    *)
        fail "Guarded deployment failed with unexpected status ${deploy_status}"
        ;;
esac

complete_success

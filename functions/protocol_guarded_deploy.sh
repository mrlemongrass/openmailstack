#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_DIR=$(cd "${SCRIPT_DIR}/.." && pwd)
TARGET="${1:-}"
CONFIG_PATH="${REPO_DIR}/config.conf"
GATE_SCRIPT="${REPO_DIR}/tests/integration/protocol_release_gate.sh"
POST_GATE_SCRIPT="${OMS_PROTOCOL_POST_GATE_SCRIPT:-${GATE_SCRIPT}}"
REQUIRED_FILE="${OMS_PROTOCOL_GATE_REQUIRED_FILE:-/etc/openmailstack/protocol-gate.required}"
BACKUP_ROOT="${OMS_PROTOCOL_ROLLBACK_ROOT:-/var/backups/openmailstack}"
BACKEND_DIR="/opt/openmailstack-backend"
FRONTEND_DIR="${OPENMAILSTACK_WEB_ROOT:-/var/www/openmailstack}"
NGINX_CONF="/etc/nginx/sites-available/mailserver.conf"
BACKEND_ENV="/etc/openmailstack/webmail-backend.env"
BACKEND_SERVICE="/etc/systemd/system/openmailstack.service"
DOVECOT_DIR="/etc/dovecot"
DOVECOT_DROPIN_DIR="/etc/systemd/system/dovecot.service.d"
if [[ "${TARGET}" == "webmail" ]]; then
    TARGET_SCRIPT="${SCRIPT_DIR}/10_webmail.sh"
else
    TARGET_SCRIPT="${SCRIPT_DIR}/04_dovecot.sh"
fi
ROLLBACK_READY=0
DEPLOY_COMPLETE=0
ROLLBACK_RUNNING=0

fail() {
    echo "Error: $1" >&2
    exit 1
}

[[ "${TARGET}" == "webmail" || "${TARGET}" == "dovecot" ]] \
    || fail "Usage: $0 <webmail|dovecot>"
[[ ${EUID} -eq 0 ]] || fail "Run guarded deployment as root"
[[ -f "${CONFIG_PATH}" ]] || fail "OpenMailStack config file not found: ${CONFIG_PATH}"
[[ -f "${REQUIRED_FILE}" ]] || fail "Protocol gate is not provisioned; run functions/provision_protocol_canary.sh first"
[[ -f "${GATE_SCRIPT}" ]] || fail "Protocol release gate not found: ${GATE_SCRIPT}"

# shellcheck source=/dev/null
source "${CONFIG_PATH}"

FRONTEND_DIR="${OPENMAILSTACK_WEB_ROOT:-/var/www/openmailstack}"
DOVECOT_MASTER_SECRET_FILE="${OMS_DOVECOT_MASTER_SECRET_FILE:-/etc/openmailstack/dovecot-master.secret}"

[[ "${BACKEND_DIR}" == /opt/* && "${BACKEND_DIR}" != "/opt" ]] || fail "Unsafe backend deployment path"
[[ "${FRONTEND_DIR}" == /var/www/* && "${FRONTEND_DIR}" != "/var/www" ]] || fail "Unsafe frontend deployment path"
[[ "${DOVECOT_DIR}" == "/etc/dovecot" ]] || fail "Unsafe Dovecot configuration path"

timestamp=$(date -u +%Y%m%dT%H%M%SZ)
ROLLBACK_DIR="${BACKUP_ROOT}/protocol-guarded-${TARGET}-${timestamp}"

snapshot_file() {
    local source_path="$1"
    local destination_name="$2"
    [[ -e "${source_path}" ]] || fail "Required live file missing before guarded deployment: ${source_path}"
    cp -a "${source_path}" "${ROLLBACK_DIR}/${destination_name}"
}

prepare_snapshot() {
    install -d -o root -g root -m 0700 "${ROLLBACK_DIR}"
    if [[ "${TARGET}" == "webmail" ]]; then
        [[ -d "${BACKEND_DIR}" && -d "${FRONTEND_DIR}" ]] || fail "Existing webmail deployment is required for guarded upgrade"
        install -d -o root -g root -m 0700 "${ROLLBACK_DIR}/backend" "${ROLLBACK_DIR}/frontend"
        rsync -a --delete --exclude uploads "${BACKEND_DIR}/" "${ROLLBACK_DIR}/backend/"
        rsync -a --delete "${FRONTEND_DIR}/" "${ROLLBACK_DIR}/frontend/"
        snapshot_file "${NGINX_CONF}" "mailserver.conf"
        snapshot_file "${BACKEND_ENV}" "webmail-backend.env"
        snapshot_file "${BACKEND_SERVICE}" "openmailstack.service"
    else
        [[ -d "${DOVECOT_DIR}" ]] || fail "Existing Dovecot configuration is required for guarded upgrade"
        install -d -o root -g root -m 0700 "${ROLLBACK_DIR}/dovecot"
        rsync -a --delete "${DOVECOT_DIR}/" "${ROLLBACK_DIR}/dovecot/"
        snapshot_file "${DOVECOT_MASTER_SECRET_FILE}" "dovecot-master.secret"
        if [[ -d "${DOVECOT_DROPIN_DIR}" ]]; then
            install -d -o root -g root -m 0700 "${ROLLBACK_DIR}/dovecot.service.d"
            rsync -a --delete "${DOVECOT_DROPIN_DIR}/" "${ROLLBACK_DIR}/dovecot.service.d/"
        fi
    fi
    ROLLBACK_READY=1
}

restore_webmail() {
    rsync -a --delete --exclude uploads "${ROLLBACK_DIR}/backend/" "${BACKEND_DIR}/"
    rsync -a --delete "${ROLLBACK_DIR}/frontend/" "${FRONTEND_DIR}/"
    cp -a "${ROLLBACK_DIR}/mailserver.conf" "${NGINX_CONF}"
    cp -a "${ROLLBACK_DIR}/webmail-backend.env" "${BACKEND_ENV}"
    cp -a "${ROLLBACK_DIR}/openmailstack.service" "${BACKEND_SERVICE}"
    chown -R openmailstack:openmailstack "${BACKEND_DIR}"
    chown -R root:root "${FRONTEND_DIR}"
    systemctl daemon-reload
    nginx -t
    systemctl restart openmailstack.service
    systemctl reload nginx
    if [[ -f /etc/openmailstack/scheduler.enabled && -f /etc/systemd/system/openmailstack-scheduler-worker.service ]]; then
        systemctl restart openmailstack-scheduler-worker.service
    fi
}

restore_dovecot() {
    rsync -a --delete "${ROLLBACK_DIR}/dovecot/" "${DOVECOT_DIR}/"
    cp -a "${ROLLBACK_DIR}/dovecot-master.secret" "${DOVECOT_MASTER_SECRET_FILE}"
    if [[ -d "${ROLLBACK_DIR}/dovecot.service.d" ]]; then
        install -d -o root -g root -m 0755 "${DOVECOT_DROPIN_DIR}"
        rsync -a --delete "${ROLLBACK_DIR}/dovecot.service.d/" "${DOVECOT_DROPIN_DIR}/"
    fi
    systemctl daemon-reload
    doveconf -n >/dev/null
    systemctl restart dovecot.service
}

restore_snapshot() {
    if [[ "${ROLLBACK_READY}" != "1" || "${ROLLBACK_RUNNING}" == "1" ]]; then
        return 1
    fi
    ROLLBACK_RUNNING=1
    echo "Guarded ${TARGET} deployment failed; restoring ${ROLLBACK_DIR}." >&2
    if [[ "${TARGET}" == "webmail" ]]; then
        restore_webmail
    else
        restore_dovecot
    fi
    ROLLBACK_RUNNING=0
}

on_signal() {
    local signal="$1"
    if [[ "${ROLLBACK_READY}" == "1" && "${DEPLOY_COMPLETE}" != "1" ]]; then
        restore_snapshot || true
    fi
    fail "Guarded ${TARGET} deployment interrupted by ${signal}"
}
trap 'on_signal INT' INT
trap 'on_signal TERM' TERM

echo "Running pre-deploy public IMAPS and ActiveSync gate..."
bash "${GATE_SCRIPT}" "${CONFIG_PATH}"
prepare_snapshot

set +e
(
    cd "${REPO_DIR}"
    OMS_PROTOCOL_GUARDED_DEPLOY=1 bash "${TARGET_SCRIPT}"
)
deploy_status=$?
set -e
if (( deploy_status != 0 )); then
    restore_snapshot || fail "Deployment failed and rollback could not be completed"
    bash "${GATE_SCRIPT}" "${CONFIG_PATH}" || fail "Rollback completed but the protocol gate is still failing"
    fail "Deployment command failed with exit ${deploy_status}; the prior release was restored"
fi

echo "Running post-deploy public IMAPS and ActiveSync gate..."
set +e
bash "${POST_GATE_SCRIPT}" "${CONFIG_PATH}"
gate_status=$?
set -e
if (( gate_status != 0 )); then
    restore_snapshot || fail "Protocol gate failed and rollback could not be completed"
    bash "${GATE_SCRIPT}" "${CONFIG_PATH}" || fail "Rollback completed but the protocol gate is still failing"
    fail "Post-deploy protocol gate failed; the prior release was restored"
fi

DEPLOY_COMPLETE=1
echo "Guarded ${TARGET} deployment passed. Rollback snapshot retained at ${ROLLBACK_DIR}."

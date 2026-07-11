#!/usr/bin/env bash

set -euo pipefail
trap 'echo "ERROR in ${BASH_SOURCE[0]} at line ${LINENO}: ${BASH_COMMAND}" >&2' ERR

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_DIR=$(cd "${SCRIPT_DIR}/.." && pwd)
source "${REPO_DIR}/config.conf"

if [[ "${ENABLE_OMS_SCHEDULER:-false}" != "true" ]]; then
    echo "OMS Scheduler is disabled; no Scheduler schema was applied."
    exit 0
fi

DB_HOST="${OMS_DB_HOST:-127.0.0.1}"
DB_PORT="${OMS_DB_PORT:-3306}"
DB_USER="${OMS_DB_USER:-${POSTFIXADMIN_DB_USER}}"
DB_PASSWORD="${OMS_DB_PASSWORD:-${POSTFIXADMIN_DB_PASSWORD}}"
DB_NAME="${OMS_DB_NAME:-${POSTFIXADMIN_DB_NAME}}"
MIGRATION_DIR="${REPO_DIR}/webmail-backend/migrations"
MYSQL_BIN="$(command -v mariadb || command -v mysql || true)"

if [[ -z "${MYSQL_BIN}" ]]; then
    echo "Error: mariadb or mysql client is required for Scheduler installation." >&2
    exit 1
fi

shopt -s nullglob
migrations=("${MIGRATION_DIR}"/[0-9][0-9][0-9]_*.sql)
if [[ ${#migrations[@]} -eq 0 ]]; then
    echo "Error: no Scheduler migrations found in ${MIGRATION_DIR}." >&2
    exit 1
fi

for migration in "${migrations[@]}"; do
    echo "Applying Scheduler migration $(basename "${migration}")..."
    MYSQL_PWD="${DB_PASSWORD}" "${MYSQL_BIN}" \
        --protocol=TCP \
        --host="${DB_HOST}" \
        --port="${DB_PORT}" \
        --user="${DB_USER}" \
        "${DB_NAME}" < "${migration}"
done

install -d -m 0700 /etc/openmailstack
printf 'enabled_at=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > /etc/openmailstack/scheduler.enabled
chmod 0600 /etc/openmailstack/scheduler.enabled
echo "OMS Scheduler schema installed. Mailboxes remain disabled until enabled by an administrator."

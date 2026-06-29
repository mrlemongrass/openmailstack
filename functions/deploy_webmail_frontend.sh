#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_DIR=$(cd "${SCRIPT_DIR}/.." && pwd)
FRONTEND_DIR="${REPO_DIR}/webmail-frontend"
DEPLOY_DIR="${OPENMAILSTACK_WEB_ROOT:-/var/www/openmailstack}"

cd "${FRONTEND_DIR}"
npm run build

install -d -m 0755 "${DEPLOY_DIR}"
rsync -a --delete "${FRONTEND_DIR}/dist/" "${DEPLOY_DIR}/"
chown -R root:root "${DEPLOY_DIR}"
find "${DEPLOY_DIR}" -type d -exec chmod 755 {} \;
find "${DEPLOY_DIR}" -type f -exec chmod 644 {} \;

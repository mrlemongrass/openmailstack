#!/usr/bin/env bash

# ==============================================================================
# Strict Bash Mode
# ==============================================================================
set -euo pipefail
trap 'echo -e "\033[0;31mERROR in ${BASH_SOURCE[0]} at line ${LINENO}: ${BASH_COMMAND}\033[0m" >&2' ERR

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m'

echo -e "${YELLOW}Installing OpenMailStack DKIM Sync Automation...${NC}"

# Source the configuration file
source ./config.conf

SCRIPT_SRC="./functions/dkim_sync.sh"
SCRIPT_DEST="/usr/local/sbin/openmailstack-dkim-sync"
CONFIG_DIR="/etc/openmailstack"
CONFIG_PATH="${CONFIG_DIR}/dkim-sync.conf"
SERVICE_PATH="/etc/systemd/system/openmailstack-dkim-sync.service"
TIMER_PATH="/etc/systemd/system/openmailstack-dkim-sync.timer"

echo -e "Installing DKIM sync script..."
install -D -m 750 "${SCRIPT_SRC}" "${SCRIPT_DEST}"

echo -e "Writing DKIM sync environment file..."
install -d -m 700 "${CONFIG_DIR}"
cat <<EOF > "${CONFIG_PATH}"
POSTFIXADMIN_DB_NAME="${POSTFIXADMIN_DB_NAME}"
FIRST_DOMAIN="${FIRST_DOMAIN}"
DKIM_SELECTOR="mail"
DKIM_DIR="/var/lib/rspamd/dkim"
EOF
chmod 600 "${CONFIG_PATH}"

echo -e "Creating systemd service and timer..."
cat <<EOF > "${SERVICE_PATH}"
[Unit]
Description=OpenMailStack DKIM key sync
After=network-online.target mariadb.service rspamd.service
Wants=network-online.target mariadb.service rspamd.service
ConditionPathExists=${CONFIG_PATH}

[Service]
Type=oneshot
ExecStart=${SCRIPT_DEST}
EOF

cat <<EOF > "${TIMER_PATH}"
[Unit]
Description=Run OpenMailStack DKIM key sync hourly

[Timer]
OnBootSec=5m
OnUnitActiveSec=1h
RandomizedDelaySec=5m
Persistent=true

[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload
systemctl enable --now openmailstack-dkim-sync.timer
systemctl start openmailstack-dkim-sync.service

echo -e "${GREEN}DKIM sync automation installed and enabled.${NC}"

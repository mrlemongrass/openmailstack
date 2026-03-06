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

echo -e "${YELLOW}Starting Rspamd, Redis, and ClamAV Installation...${NC}"

# Source the configuration file
source ./config.conf
SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
source "${SCRIPT_DIR}/lib_os.sh"
detect_openmailstack_os

export DEBIAN_FRONTEND=noninteractive

# 1. Install Redis Server
echo -e "Installing Redis Server..."
openmailstack_install_required_packages redis-server
systemctl enable --now redis-server

# 2. Add Official Rspamd Repository (Now using HTTPS)
echo -e "Adding Rspamd official repository..."
RSPAMD_REPO_CODENAME=$(openmailstack_rspamd_repo_codename)
RSPAMD_EXPECTED_FPR="3FA347D5E599BE4595CA2576FFA232EDBF21E25E"
mkdir -p /etc/apt/keyrings
RSPAMD_KEY_TMP=$(mktemp)
wget -q -O "${RSPAMD_KEY_TMP}" https://rspamd.com/apt-stable/gpg.key
RSPAMD_KEY_FPR=$(gpg --show-keys --with-colons --fingerprint "${RSPAMD_KEY_TMP}" | awk -F: '$1=="fpr"{print $10; exit}')
if [[ "${RSPAMD_KEY_FPR}" != "${RSPAMD_EXPECTED_FPR}" ]]; then
    echo -e "\033[0;31mError: Rspamd signing key fingerprint mismatch. Expected ${RSPAMD_EXPECTED_FPR}, got ${RSPAMD_KEY_FPR}.\033[0m" >&2
    rm -f "${RSPAMD_KEY_TMP}"
    exit 1
fi
gpg --dearmor < "${RSPAMD_KEY_TMP}" > /etc/apt/keyrings/rspamd.gpg
rm -f "${RSPAMD_KEY_TMP}"
# Fixed: Using https:// instead of http://
echo -e "Using Rspamd repo codename: ${RSPAMD_REPO_CODENAME}"
echo "deb [signed-by=/etc/apt/keyrings/rspamd.gpg] https://rspamd.com/apt-stable/ ${RSPAMD_REPO_CODENAME} main" | tee /etc/apt/sources.list.d/rspamd.list

apt-get update -qq
echo -e "Installing Rspamd and optional ClamAV packages..."
openmailstack_install_required_packages rspamd
openmailstack_install_optional_packages clamav-daemon clamav-freshclam

# Allow pre-setting CLAMAV_ENABLED to disable antivirus on low-memory systems
CLAMAV_ENABLED="${CLAMAV_ENABLED:-1}"
if [[ ! "${CLAMAV_ENABLED}" =~ ^[01]$ ]]; then
    openmailstack_record_soft_error "Invalid CLAMAV_ENABLED='${CLAMAV_ENABLED}'. Expected 0 or 1; defaulting to 1."
    CLAMAV_ENABLED=1
fi

if [[ "${CLAMAV_ENABLED}" -eq 0 ]]; then
    echo -e "${YELLOW}ClamAV is disabled (CLAMAV_ENABLED=0) to save memory.${NC}"
else
    if openmailstack_package_installed "clamav-daemon"; then
        CLAMAV_ENABLED=1
    else
        openmailstack_record_soft_error "ClamAV daemon is not installed on ${OPENMAILSTACK_OS_LABEL}; antivirus scanning will be disabled."
        CLAMAV_ENABLED=0
    fi
fi

# 3. Configure ClamAV Access
if [[ "${CLAMAV_ENABLED}" -eq 1 ]]; then
    echo -e "Configuring ClamAV permissions..."
    # usermod is inherently safe to run multiple times
    if getent group clamav >/dev/null 2>&1; then
        usermod -aG clamav _rspamd
    else
        openmailstack_record_soft_error "ClamAV group is missing; Rspamd antivirus integration may not work."
    fi
fi

# 4. Configure Rspamd (Idempotent Overwrites)
echo -e "Configuring Rspamd modules..."
mkdir -p /etc/rspamd/local.d/

cat <<EOF > /etc/rspamd/local.d/redis.conf
servers = "127.0.0.1";
EOF

if [[ "${CLAMAV_ENABLED}" -eq 1 ]]; then
cat <<EOF > /etc/rspamd/local.d/antivirus.conf
clamav {
  action = "reject";
  symbol = "CLAM_VIRUS";
  type = "clamav";
  servers = "/var/run/clamav/clamd.ctl";
}
EOF
else
    rm -f /etc/rspamd/local.d/antivirus.conf
fi

# Hash the setup password and apply it to the Web UI
RSPAMD_PASSWORD=$(printf '%s\n' "${POSTFIXADMIN_SETUP_PASSWORD}" | rspamadm pw -e)
cat <<EOF > /etc/rspamd/local.d/worker-controller.inc
password = "${RSPAMD_PASSWORD}";
EOF

# 5. Generate DKIM keys and signing map for all managed domains
echo -e "Syncing DKIM keys and signing map..."
POSTFIXADMIN_DB_NAME="${POSTFIXADMIN_DB_NAME}" \
FIRST_DOMAIN="${FIRST_DOMAIN}" \
DKIM_SELECTOR="mail" \
DKIM_DIR="/var/lib/rspamd/dkim" \
bash "${SCRIPT_DIR}/dkim_sync.sh"

# 6. Link Rspamd to Postfix (postconf is idempotent)
echo -e "Connecting Postfix to Rspamd Milter..."
postconf -e "smtpd_milters = inet:127.0.0.1:11332"
postconf -e "non_smtpd_milters = inet:127.0.0.1:11332"
postconf -e "milter_protocol = 6"
postconf -e "milter_mail_macros = i {mail_addr} {client_addr} {client_name} {auth_authen}"
postconf -e "milter_default_action = accept"

# 7. Restart Services
echo -e "Restarting Rspamd, ClamAV, and Postfix..."
systemctl enable --now rspamd
if [[ "${CLAMAV_ENABLED}" -eq 1 ]]; then
    systemctl restart clamav-daemon || openmailstack_record_soft_error "ClamAV daemon failed to start; antivirus scanning is currently inactive."
fi
systemctl restart rspamd postfix

echo -e "${GREEN}Rspamd and ClamAV setup complete!${NC}"
if find /var/lib/rspamd/dkim -maxdepth 1 -type f -name '*.pub' | grep -q .; then
    echo -e "${YELLOW}Important: DKIM public keys for DNS are stored in /var/lib/rspamd/dkim/*.pub (one file per domain).${NC}"
fi

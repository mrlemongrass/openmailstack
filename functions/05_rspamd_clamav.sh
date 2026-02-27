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

export DEBIAN_FRONTEND=noninteractive

# 1. Install Redis Server
echo -e "Installing Redis Server..."
apt-get install -y -qq redis-server
systemctl enable --now redis-server

# 2. Add Official Rspamd Repository (Now using HTTPS)
echo -e "Adding Rspamd official repository..."
mkdir -p /etc/apt/keyrings
wget -qO- https://rspamd.com/apt-stable/gpg.key | gpg --dearmor | tee /etc/apt/keyrings/rspamd.gpg > /dev/null
# Fixed: Using https:// instead of http://
echo "deb [signed-by=/etc/apt/keyrings/rspamd.gpg] https://rspamd.com/apt-stable/ $(lsb_release -c -s) main" | tee /etc/apt/sources.list.d/rspamd.list

apt-get update -qq
echo -e "Installing Rspamd and ClamAV..."
apt-get install -y -qq rspamd clamav-daemon clamav-freshclam

# 3. Configure ClamAV Access
echo -e "Configuring ClamAV permissions..."
# usermod is inherently safe to run multiple times
usermod -aG clamav _rspamd

# 4. Configure Rspamd (Idempotent Overwrites)
echo -e "Configuring Rspamd modules..."
mkdir -p /etc/rspamd/local.d/

cat <<EOF > /etc/rspamd/local.d/redis.conf
servers = "127.0.0.1";
EOF

cat <<EOF > /etc/rspamd/local.d/antivirus.conf
clamav {
  action = "reject";
  symbol = "CLAM_VIRUS";
  type = "clamav";
  servers = "/var/run/clamav/clamd.ctl";
}
EOF

# Hash the setup password and apply it to the Web UI
RSPAMD_PASSWORD=$(rspamadm pw -e -p "${POSTFIXADMIN_SETUP_PASSWORD}")
cat <<EOF > /etc/rspamd/local.d/worker-controller.inc
password = "${RSPAMD_PASSWORD}";
EOF

# 5. Generate DKIM Key (Guarded!)
echo -e "Configuring DKIM for ${FIRST_DOMAIN}..."
mkdir -p /var/lib/rspamd/dkim

# CRITICAL IDEMPOTENCY: Do not overwrite the key if it already exists, 
# otherwise we will break the user's DNS records and mail deliverability.
if [[ ! -f "/var/lib/rspamd/dkim/mail.key" ]]; then
    echo -e "Generating new DKIM key..."
    rspamadm dkim_keygen -d "${FIRST_DOMAIN}" -s mail -k /var/lib/rspamd/dkim/mail.key > /var/lib/rspamd/dkim/mail.pub
    chown -R _rspamd:_rspamd /var/lib/rspamd/dkim
    chmod 400 /var/lib/rspamd/dkim/mail.key
else
    echo -e "${GREEN}DKIM key already exists. Skipping generation to preserve DNS validity.${NC}"
fi

cat <<EOF > /etc/rspamd/local.d/dkim_signing.conf
allow_username_mismatch = true;

domain {
    ${FIRST_DOMAIN} {
        path = "/var/lib/rspamd/dkim/mail.key";
        selector = "mail";
    }
}
EOF

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
systemctl restart clamav-daemon || echo -e "${YELLOW}Notice: ClamAV daemon might take a few minutes to start up.${NC}"
systemctl restart rspamd postfix

echo -e "${GREEN}Rspamd and ClamAV setup complete!${NC}"
if [[ -f "/var/lib/rspamd/dkim/mail.pub" ]]; then
    echo -e "${YELLOW}Important: Your DKIM public key for your DNS records is located at /var/lib/rspamd/dkim/mail.pub${NC}"
fi
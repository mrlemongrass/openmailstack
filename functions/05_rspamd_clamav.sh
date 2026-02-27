#!/usr/bin/env bash

# Exit on error
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m'

echo -e "${YELLOW}Starting Rspamd, Redis, and ClamAV Installation...${NC}"

# Source the configuration file
source ./config.conf

export DEBIAN_FRONTEND=noninteractive

# 1. Install Redis (Required by Rspamd for caching and greylisting)
echo -e "Installing Redis Server..."
apt-get install -y -qq redis-server
systemctl enable redis-server
systemctl start redis-server

# 2. Add Official Rspamd Repository and Install
# We use the official repo to get the latest features and bug fixes
echo -e "Adding Rspamd official repository..."
mkdir -p /etc/apt/keyrings
wget -qO- https://rspamd.com/apt-stable/gpg.key | gpg --dearmor | tee /etc/apt/keyrings/rspamd.gpg > /dev/null
echo "deb [signed-by=/etc/apt/keyrings/rspamd.gpg] http://rspamd.com/apt-stable/ $(lsb_release -c -s) main" | tee /etc/apt/sources.list.d/rspamd.list

apt-get update -qq
echo -e "Installing Rspamd and ClamAV..."
apt-get install -y -qq rspamd clamav-daemon clamav-freshclam

# 3. Configure ClamAV
echo -e "Configuring ClamAV..."
# Add the Rspamd user to the ClamAV group so it can read the local socket
usermod -aG clamav _rspamd

# 4. Configure Rspamd
echo -e "Configuring Rspamd modules..."
mkdir -p /etc/rspamd/local.d/

# Tell Rspamd to use Redis
cat <<EOF > /etc/rspamd/local.d/redis.conf
servers = "127.0.0.1";
EOF

# Tell Rspamd to use ClamAV
cat <<EOF > /etc/rspamd/local.d/antivirus.conf
clamav {
  action = "reject";
  symbol = "CLAM_VIRUS";
  type = "clamav";
  servers = "/var/run/clamav/clamd.ctl";
}
EOF

# Set a password for the Rspamd Web UI (using the Setup Password)
# We hash it using rspamadm
RSPAMD_PASSWORD=$(rspamadm pw -e -p "${POSTFIXADMIN_SETUP_PASSWORD}")
cat <<EOF > /etc/rspamd/local.d/worker-controller.inc
password = "${RSPAMD_PASSWORD}";
EOF

# 5. Generate a DKIM Key for the Primary Domain
echo -e "Generating DKIM key for ${FIRST_DOMAIN}..."
mkdir -p /var/lib/rspamd/dkim
# Generate the key using rspamadm
rspamadm dkim_keygen -d "${FIRST_DOMAIN}" -s mail -k /var/lib/rspamd/dkim/mail.key > /var/lib/rspamd/dkim/mail.pub
chown -R _rspamd:_rspamd /var/lib/rspamd/dkim
chmod 400 /var/lib/rspamd/dkim/mail.key

# Tell Rspamd to use this key to sign outgoing mail
cat <<EOF > /etc/rspamd/local.d/dkim_signing.conf
allow_username_mismatch = true;

domain {
    ${FIRST_DOMAIN} {
        path = "/var/lib/rspamd/dkim/mail.key";
        selector = "mail";
    }
}
EOF

# 6. Link Rspamd to Postfix
# Rspamd acts as a "Milter" (Mail Filter). Postfix sends it the email, Rspamd scores it, and tells Postfix to accept or reject.
echo -e "Connecting Postfix to Rspamd Milter..."
postconf -e "smtpd_milters = inet:127.0.0.1:11332"
postconf -e "non_smtpd_milters = inet:127.0.0.1:11332"
postconf -e "milter_protocol = 6"
postconf -e "milter_mail_macros = i {mail_addr} {client_addr} {client_name} {auth_authen}"
# If Rspamd crashes, we default to accept so mail flow doesn't stop
postconf -e "milter_default_action = accept"

# 7. Restart Services
echo -e "Restarting Rspamd, ClamAV, and Postfix..."
systemctl restart clamav-daemon || echo -e "${YELLOW}Notice: ClamAV daemon might take a few minutes to start up.${NC}"
systemctl enable rspamd
systemctl restart rspamd
systemctl restart postfix

echo -e "${GREEN}Rspamd and ClamAV setup complete!${NC}"
echo -e "${YELLOW}Important: Your DKIM public key for your DNS records is located at /var/lib/rspamd/dkim/mail.pub${NC}"

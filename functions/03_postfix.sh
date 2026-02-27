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

echo -e "${YELLOW}Starting Postfix MTA Installation and Configuration...${NC}"

# Source the configuration file
source ./config.conf

export DEBIAN_FRONTEND=noninteractive

# 1. Pre-seed Postfix installation answers
echo -e "Pre-configuring Postfix installation answers..."
echo "postfix postfix/main_mailer_type string 'Internet Site'" | debconf-set-selections
echo "postfix postfix/mailname string ${MAIL_HOSTNAME}" | debconf-set-selections

# 2. Install Postfix and the MySQL plugin
echo -e "Installing Postfix and postfix-mysql..."
apt-get install -y -qq postfix postfix-mysql

# 3. Create the 'vmail' user and group (Idempotent check)
echo -e "Creating local 'vmail' user and mail directory..."
if ! getent group vmail > /dev/null; then
    groupadd -g 5000 vmail
fi
if ! getent passwd vmail > /dev/null; then
    useradd -u 5000 -g vmail -s /usr/sbin/nologin -d /var/vmail -m vmail
fi
# Ensure permissions are always correct
mkdir -p /var/vmail
chown -R vmail:vmail /var/vmail
chmod -R 770 /var/vmail

# 4. Create Postfix MySQL mapping files (Overwrites existing, inherently idempotent)
echo -e "Creating Postfix MySQL mapping files..."
mkdir -p /etc/postfix/sql

cat <<EOF > /etc/postfix/sql/mysql_virtual_domains_maps.cf
user = ${POSTFIXADMIN_DB_USER}
password = ${POSTFIXADMIN_DB_PASSWORD}
hosts = 127.0.0.1
dbname = ${POSTFIXADMIN_DB_NAME}
query = SELECT domain FROM domain WHERE domain='%s' AND active = '1'
EOF

cat <<EOF > /etc/postfix/sql/mysql_virtual_mailbox_maps.cf
user = ${POSTFIXADMIN_DB_USER}
password = ${POSTFIXADMIN_DB_PASSWORD}
hosts = 127.0.0.1
dbname = ${POSTFIXADMIN_DB_NAME}
query = SELECT maildir FROM mailbox WHERE username='%s' AND active = '1'
EOF

cat <<EOF > /etc/postfix/sql/mysql_virtual_alias_maps.cf
user = ${POSTFIXADMIN_DB_USER}
password = ${POSTFIXADMIN_DB_PASSWORD}
hosts = 127.0.0.1
dbname = ${POSTFIXADMIN_DB_NAME}
query = SELECT goto FROM alias WHERE address='%s' AND active = '1'
EOF

chmod 640 /etc/postfix/sql/*
chgrp postfix /etc/postfix/sql/*

# 5. Configure Postfix main.cf (postconf -e is natively idempotent)
echo -e "Configuring Postfix (main.cf)..."
postconf -e "myhostname = ${MAIL_HOSTNAME}"
postconf -e "mydestination = localhost, localhost.localdomain"
postconf -e "myorigin = /etc/mailname"
postconf -e "virtual_mailbox_domains = proxy:mysql:/etc/postfix/sql/mysql_virtual_domains_maps.cf"
postconf -e "virtual_mailbox_maps = proxy:mysql:/etc/postfix/sql/mysql_virtual_mailbox_maps.cf"
postconf -e "virtual_alias_maps = proxy:mysql:/etc/postfix/sql/mysql_virtual_alias_maps.cf"
postconf -e "virtual_transport = lmtp:unix:private/dovecot-lmtp"
postconf -e "smtpd_sasl_type = dovecot"
postconf -e "smtpd_sasl_path = private/auth"
postconf -e "smtpd_sasl_auth_enable = yes"
postconf -e "smtpd_recipient_restrictions = permit_mynetworks, permit_sasl_authenticated, reject_unauth_destination"

# 6. Enable Submission port (587) in master.cf (Guarded by marker)
echo -e "Enabling Submission (port 587) in master.cf..."

# We check if our custom OpenMailStack marker exists. If not, we append it.
if ! grep -q "# --- OpenMailStack Submission ---" /etc/postfix/master.cf; then
cat <<EOF >> /etc/postfix/master.cf

# --- OpenMailStack Submission ---
submission inet n       -       y       -       -       smtpd
  -o syslog_name=postfix/submission
  -o smtpd_tls_security_level=encrypt
  -o smtpd_sasl_auth_enable=yes
  -o smtpd_reject_unlisted_recipient=no
# --------------------------------
EOF
fi

# Restart Postfix
systemctl enable --now postfix
systemctl restart postfix

echo -e "${GREEN}Postfix setup complete!${NC}"

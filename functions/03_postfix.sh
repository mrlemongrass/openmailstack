#!/usr/bin/env bash

# Exit on error
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m'

echo -e "${YELLOW}Starting Postfix MTA Installation and Configuration...${NC}"

# Source the configuration file
source ./config.conf

export DEBIAN_FRONTEND=noninteractive

# 1. Pre-seed Postfix installation answers
# This prevents the interactive pink/blue screen from interrupting the script
echo -e "Pre-configuring Postfix installation answers..."
echo "postfix postfix/main_mailer_type string 'Internet Site'" | debconf-set-selections
echo "postfix postfix/mailname string ${MAIL_HOSTNAME}" | debconf-set-selections

# 2. Install Postfix and the MySQL plugin
echo -e "Installing Postfix and postfix-mysql..."
apt-get install -y -qq postfix postfix-mysql

# 3. Create the 'vmail' user and group
# Even though our users are virtual in the database, the physical emails 
# need to be owned by a real Linux user on the hard drive. 
# UID/GID 5000 is the standard for virtual mail.
echo -e "Creating local 'vmail' user and mail directory..."
groupadd -g 5000 vmail || true
useradd -u 5000 -g vmail -s /usr/sbin/nologin -d /var/vmail -m vmail || true
chmod 770 /var/vmail

# 4. Create Postfix MySQL mapping files
echo -e "Creating Postfix MySQL mapping files..."
mkdir -p /etc/postfix/sql

# Domains mapping
cat <<EOF > /etc/postfix/sql/mysql_virtual_domains_maps.cf
user = ${POSTFIXADMIN_DB_USER}
password = ${POSTFIXADMIN_DB_PASSWORD}
hosts = 127.0.0.1
dbname = ${POSTFIXADMIN_DB_NAME}
query = SELECT domain FROM domain WHERE domain='%s' AND active = '1'
EOF

# Mailboxes mapping
cat <<EOF > /etc/postfix/sql/mysql_virtual_mailbox_maps.cf
user = ${POSTFIXADMIN_DB_USER}
password = ${POSTFIXADMIN_DB_PASSWORD}
hosts = 127.0.0.1
dbname = ${POSTFIXADMIN_DB_NAME}
query = SELECT maildir FROM mailbox WHERE username='%s' AND active = '1'
EOF

# Aliases mapping
cat <<EOF > /etc/postfix/sql/mysql_virtual_alias_maps.cf
user = ${POSTFIXADMIN_DB_USER}
password = ${POSTFIXADMIN_DB_PASSWORD}
hosts = 127.0.0.1
dbname = ${POSTFIXADMIN_DB_NAME}
query = SELECT goto FROM alias WHERE address='%s' AND active = '1'
EOF

# Secure the SQL files so only root and Postfix can read the database passwords
chmod 640 /etc/postfix/sql/*
chgrp postfix /etc/postfix/sql/*

# 5. Configure Postfix main.cf
echo -e "Configuring Postfix (main.cf)..."

# We use 'postconf' to edit main.cf safely and idempotently
postconf -e "myhostname = ${MAIL_HOSTNAME}"
# CRITICAL: Do NOT put virtual domains in mydestination, or Postfix will loop
postconf -e "mydestination = localhost, localhost.localdomain"
postconf -e "myorigin = /etc/mailname"

# Tell Postfix to use our MySQL files to find domains, users, and aliases
postconf -e "virtual_mailbox_domains = proxy:mysql:/etc/postfix/sql/mysql_virtual_domains_maps.cf"
postconf -e "virtual_mailbox_maps = proxy:mysql:/etc/postfix/sql/mysql_virtual_mailbox_maps.cf"
postconf -e "virtual_alias_maps = proxy:mysql:/etc/postfix/sql/mysql_virtual_alias_maps.cf"

# Tell Postfix to hand over the actual email delivery to Dovecot via LMTP
postconf -e "virtual_transport = lmtp:unix:private/dovecot-lmtp"

# Configure SASL authentication (so users can log in to send mail)
# Postfix asks Dovecot to verify the username/password
postconf -e "smtpd_sasl_type = dovecot"
postconf -e "smtpd_sasl_path = private/auth"
postconf -e "smtpd_sasl_auth_enable = yes"

# Basic security restrictions
postconf -e "smtpd_recipient_restrictions = permit_mynetworks, permit_sasl_authenticated, reject_unauth_destination"

# 6. Enable Submission port (587) in master.cf
# This allows mail clients like Outlook/Thunderbird to send mail
echo -e "Enabling Submission (port 587) in master.cf..."
sed -i '/^#submission/s/^#//' /etc/postfix/master.cf
sed -i '/^submission/a \  -o syslog_name=postfix/submission\n  -o smtpd_tls_security_level=encrypt\n  -o smtpd_sasl_auth_enable=yes\n  -o smtpd_reject_unlisted_recipient=no' /etc/postfix/master.cf

# Restart Postfix to apply changes
systemctl enable postfix
systemctl restart postfix

echo -e "${GREEN}Postfix setup complete!${NC}"

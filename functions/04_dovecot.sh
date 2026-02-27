#!/usr/bin/env bash

# Exit on error
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m'

echo -e "${YELLOW}Starting Dovecot IMAP/POP3 Installation...${NC}"

# Source the configuration file
source ./config.conf

export DEBIAN_FRONTEND=noninteractive

# 1. Install Dovecot and required modules
echo -e "Installing Dovecot and MySQL modules..."
apt-get install -y -qq dovecot-core dovecot-imapd dovecot-pop3d dovecot-lmtpd dovecot-mysql

# 2. Configure the SQL Connection
# This tells Dovecot how to connect to the PostfixAdmin database to verify passwords
echo -e "Configuring Dovecot SQL connection..."
cat <<EOF > /etc/dovecot/dovecot-sql.conf.ext
driver = mysql
connect = host=127.0.0.1 dbname=${POSTFIXADMIN_DB_NAME} user=${POSTFIXADMIN_DB_USER} password=${POSTFIXADMIN_DB_PASSWORD}
default_pass_scheme = BLF-CRYPT

# How to verify the password
password_query = SELECT username AS user, password FROM mailbox WHERE username = '%u' AND active = '1'

# How to find the user's mail folder on the hard drive
user_query = SELECT maildir, 5000 AS uid, 5000 AS gid FROM mailbox WHERE username = '%u' AND active = '1'
EOF

# Secure the SQL config file since it contains database passwords
chown root:root /etc/dovecot/dovecot-sql.conf.ext
chmod 600 /etc/dovecot/dovecot-sql.conf.ext

# 3. Create the clean local override configuration
# This cleanly overrides default settings without breaking original config files
echo -e "Applying Dovecot local configuration overrides..."
cat <<EOF > /etc/dovecot/local.conf
# Enable required protocols
protocols = imap pop3 lmtp

# Disable plain text authentication (unless running over SSL/TLS)
disable_plaintext_auth = yes
auth_mechanisms = plain login

# Define where the mail is physically stored
mail_location = maildir:/var/vmail/%domain/%n
mail_uid = 5000
mail_gid = 5000
first_valid_uid = 5000
last_valid_uid = 5000

# Tell Dovecot to use our SQL file for Passwords and Users
passdb {
  driver = sql
  args = /etc/dovecot/dovecot-sql.conf.ext
}
userdb {
  driver = sql
  args = /etc/dovecot/dovecot-sql.conf.ext
}

# Configure LMTP socket so Postfix can hand off incoming mail
service lmtp {
  unix_listener /var/spool/postfix/private/dovecot-lmtp {
    mode = 0600
    user = postfix
    group = postfix
  }
}

# Configure Authentication socket so Postfix can verify users sending outgoing mail
service auth {
  unix_listener /var/spool/postfix/private/auth {
    mode = 0666
    user = postfix
    group = postfix
  }
  
  # Auth worker for Dovecot itself
  unix_listener auth-userdb {
    mode = 0600
    user = vmail
  }
}
EOF

# Ensure the vmail directory has correct permissions again, just in case
chown -R vmail:vmail /var/vmail
chmod -R 770 /var/vmail

# 4. Restart and enable Dovecot
echo -e "Restarting Dovecot..."
systemctl enable dovecot
systemctl restart dovecot

echo -e "${GREEN}Dovecot setup complete!${NC}"

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

echo -e "${YELLOW}Starting Dovecot IMAP/POP3 Installation...${NC}"

# Source the configuration file
source ./config.conf

export DEBIAN_FRONTEND=noninteractive

# 1. Install Dovecot
echo -e "Installing Dovecot and MySQL modules..."
apt-get install -y -qq dovecot-core dovecot-imapd dovecot-pop3d dovecot-lmtpd dovecot-mysql

# Determine Dovecot Version (e.g., 2.3 or 2.4)
DOVECOT_VERSION=$(dovecot --version | grep -oE '^[0-9]+\.[0-9]+')
echo -e "Detected Dovecot Version: ${DOVECOT_VERSION}"

# 2. Configure the SQL Connection
echo -e "Configuring Dovecot SQL connection..."

if [[ "$DOVECOT_VERSION" == "2.4" ]]; then
    # Dovecot 2.4+ Syntax
    cat <<EOF > /etc/dovecot/dovecot-sql.conf.ext
driver = mysql
connect = host=127.0.0.1 dbname=${POSTFIXADMIN_DB_NAME} user=${POSTFIXADMIN_DB_USER} password=${POSTFIXADMIN_DB_PASSWORD}
default_pass_scheme = BLF-CRYPT
password_query = SELECT username AS user, password FROM mailbox WHERE username = '%{user}' AND active = '1'
user_query = SELECT maildir, 5000 AS uid, 5000 AS gid FROM mailbox WHERE username = '%{user}' AND active = '1'
EOF
else
    # Dovecot 2.3 and below Syntax
    cat <<EOF > /etc/dovecot/dovecot-sql.conf.ext
driver = mysql
connect = host=127.0.0.1 dbname=${POSTFIXADMIN_DB_NAME} user=${POSTFIXADMIN_DB_USER} password=${POSTFIXADMIN_DB_PASSWORD}
default_pass_scheme = BLF-CRYPT
password_query = SELECT username AS user, password FROM mailbox WHERE username = '%u' AND active = '1'
user_query = SELECT maildir, 5000 AS uid, 5000 AS gid FROM mailbox WHERE username = '%u' AND active = '1'
EOF
fi

chown root:root /etc/dovecot/dovecot-sql.conf.ext
chmod 600 /etc/dovecot/dovecot-sql.conf.ext

# 3. Create the clean local override configuration
echo -e "Applying Dovecot local configuration overrides..."

if [[ "$DOVECOT_VERSION" == "2.4" ]]; then
    # Dovecot 2.4+ Configuration block
    cat <<EOF > /etc/dovecot/local.conf
dovecot_config_version = 2.4.0
dovecot_storage_version = 2.4.0

protocols = imap pop3 lmtp

disable_plaintext_auth = yes
auth_mechanisms = plain login

mail_driver = maildir
mail_path = /var/vmail/%{user | domain}/%{user | username}
mail_uid = 5000
mail_gid = 5000
first_valid_uid = 5000
last_valid_uid = 5000

passdb sql {
  args = /etc/dovecot/dovecot-sql.conf.ext
}
userdb sql {
  args = /etc/dovecot/dovecot-sql.conf.ext
}

service lmtp {
  unix_listener /var/spool/postfix/private/dovecot-lmtp {
    mode = 0600
    user = postfix
    group = postfix
  }
}
service auth {
  unix_listener /var/spool/postfix/private/auth {
    mode = 0666
    user = postfix
    group = postfix
  }
  unix_listener auth-userdb {
    mode = 0600
    user = vmail
  }
}
EOF

else
    # Dovecot 2.3 and below Configuration block
    cat <<EOF > /etc/dovecot/local.conf
protocols = imap pop3 lmtp

disable_plaintext_auth = yes
auth_mechanisms = plain login

mail_location = maildir:/var/vmail/%domain/%n
mail_uid = 5000
mail_gid = 5000
first_valid_uid = 5000
last_valid_uid = 5000

passdb {
  driver = sql
  args = /etc/dovecot/dovecot-sql.conf.ext
}
userdb {
  driver = sql
  args = /etc/dovecot/dovecot-sql.conf.ext
}

service lmtp {
  unix_listener /var/spool/postfix/private/dovecot-lmtp {
    mode = 0600
    user = postfix
    group = postfix
  }
}
service auth {
  unix_listener /var/spool/postfix/private/auth {
    mode = 0666
    user = postfix
    group = postfix
  }
  unix_listener auth-userdb {
    mode = 0600
    user = vmail
  }
}
EOF
fi

# Restart and enable Dovecot
echo -e "Restarting Dovecot..."
systemctl enable --now dovecot
systemctl restart dovecot

echo -e "${GREEN}Dovecot setup complete!${NC}"

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
SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
source "${SCRIPT_DIR}/lib_os.sh"
detect_openmailstack_os

PROTOCOL_GATE_REQUIRED_FILE="${OMS_PROTOCOL_GATE_REQUIRED_FILE:-/etc/openmailstack/protocol-gate.required}"
if [[ -f "${PROTOCOL_GATE_REQUIRED_FILE}" && "${OMS_PROTOCOL_GUARDED_DEPLOY:-0}" != "1" ]]; then
    echo "Error: protocol protection is enabled; run functions/protocol_guarded_deploy.sh dovecot instead." >&2
    exit 1
fi

export DEBIAN_FRONTEND=noninteractive

# 1. Install Dovecot
echo -e "Installing Dovecot and MySQL modules..."
openmailstack_install_required_packages dovecot-core dovecot-imapd dovecot-lmtpd dovecot-mysql
openmailstack_install_optional_packages dovecot-pop3d

DOVECOT_MASTER_USER="${OMS_DOVECOT_MASTER_USER:-oms-internal}"
DOVECOT_MASTER_SECRET_FILE="${OMS_DOVECOT_MASTER_SECRET_FILE:-/etc/openmailstack/dovecot-master.secret}"
DOVECOT_MASTER_USERS_FILE="${OMS_DOVECOT_MASTER_USERS_FILE:-/etc/dovecot/passwd.masterusers}"
install -d -o root -g root -m 0700 "$(dirname "${DOVECOT_MASTER_SECRET_FILE}")"
if [[ ! -s "${DOVECOT_MASTER_SECRET_FILE}" ]]; then
    master_secret_tmp=$(mktemp)
    openssl rand -hex 32 > "${master_secret_tmp}"
    install -o root -g root -m 0600 "${master_secret_tmp}" "${DOVECOT_MASTER_SECRET_FILE}"
    rm -f "${master_secret_tmp}"
fi
DOVECOT_MASTER_PASSWORD=$(<"${DOVECOT_MASTER_SECRET_FILE}")
if (( ${#DOVECOT_MASTER_PASSWORD} < 32 )); then
    echo "Dovecot master secret must contain at least 32 characters." >&2
    exit 1
fi
DOVECOT_MASTER_HASH=$(printf '%s\n' "${DOVECOT_MASTER_PASSWORD}" | openssl passwd -6 -stdin)
(
    umask 077
    printf '%s:{SHA512-CRYPT}%s\n' "${DOVECOT_MASTER_USER}" "${DOVECOT_MASTER_HASH}" > "${DOVECOT_MASTER_USERS_FILE}"
)
chown root:root "${DOVECOT_MASTER_SECRET_FILE}"
chmod 0600 "${DOVECOT_MASTER_SECRET_FILE}"
chown root:dovecot "${DOVECOT_MASTER_USERS_FILE}"
chmod 0640 "${DOVECOT_MASTER_USERS_FILE}"

echo -e "Preparing app-password and two-factor authentication tables..."
MYSQL_PWD="${POSTFIXADMIN_DB_PASSWORD}" mysql \
    --protocol=TCP \
    --host=127.0.0.1 \
    --user="${POSTFIXADMIN_DB_USER}" \
    "${POSTFIXADMIN_DB_NAME}" <<'SQL'
CREATE TABLE IF NOT EXISTS account_security (
    username VARCHAR(255) NOT NULL PRIMARY KEY,
    totp_secret_ciphertext TEXT NULL,
    totp_secret_iv VARBINARY(12) NULL,
    totp_secret_tag VARBINARY(16) NULL,
    pending_totp_ciphertext TEXT NULL,
    pending_totp_iv VARBINARY(12) NULL,
    pending_totp_tag VARBINARY(16) NULL,
    recovery_code_hashes JSON NULL,
    totp_enabled_at DATETIME NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS app_passwords (
    id CHAR(36) NOT NULL PRIMARY KEY,
    username VARCHAR(255) NOT NULL,
    label VARCHAR(80) NOT NULL,
    secret_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    prefix VARCHAR(24) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_used_at DATETIME NULL,
    revoked_at DATETIME NULL,
    UNIQUE KEY uq_app_password_secret_hash (secret_hash),
    KEY idx_app_password_owner (username, revoked_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
SQL

DOVECOT_PROTOCOLS="imap lmtp sieve"
if openmailstack_package_installed "dovecot-pop3d"; then
    DOVECOT_PROTOCOLS="imap pop3 lmtp sieve"
fi

# A targeted Dovecot rerun must not discard TLS configured by the later security
# module. Prefer the active, hostname-valid pair; otherwise recover a valid
# certificate from one of the security module's deterministic locations.
DOVECOT_TLS_CERT_FILE=""
DOVECOT_TLS_KEY_FILE=""

dovecot_tls_pair_is_usable() {
    local cert_file="$1"
    local key_file="$2"
    local cert_public_key
    local key_public_key

    [[ -r "${cert_file}" && -r "${key_file}" ]] || return 1
    openssl x509 -in "${cert_file}" -noout -checkhost "${MAIL_HOSTNAME}" >/dev/null 2>&1 || return 1
    cert_public_key=$(openssl x509 -in "${cert_file}" -pubkey -noout 2>/dev/null | openssl pkey -pubin -outform DER 2>/dev/null | sha256sum | awk '{print $1}') || return 1
    key_public_key=$(openssl pkey -in "${key_file}" -pubout -outform DER 2>/dev/null | sha256sum | awk '{print $1}') || return 1
    [[ -n "${cert_public_key}" && "${cert_public_key}" == "${key_public_key}" ]]
}

use_dovecot_tls_pair_if_valid() {
    local cert_file="$1"
    local key_file="$2"

    if [[ -z "${DOVECOT_TLS_CERT_FILE}" ]] && dovecot_tls_pair_is_usable "${cert_file}" "${key_file}"; then
        DOVECOT_TLS_CERT_FILE="${cert_file}"
        DOVECOT_TLS_KEY_FILE="${key_file}"
    fi
}

if [[ -f /etc/dovecot/local.conf ]]; then
    existing_dovecot_cert=$(awk -F= '/^(ssl_server_cert_file|ssl_cert)[[:space:]]*=/ { sub(/^[^=]*=[[:space:]]*/, ""); sub(/^</, ""); print; exit }' /etc/dovecot/local.conf)
    existing_dovecot_key=$(awk -F= '/^(ssl_server_key_file|ssl_key)[[:space:]]*=/ { sub(/^[^=]*=[[:space:]]*/, ""); sub(/^</, ""); print; exit }' /etc/dovecot/local.conf)
    if [[ -n "${existing_dovecot_cert}" && -n "${existing_dovecot_key}" ]]; then
        use_dovecot_tls_pair_if_valid "${existing_dovecot_cert}" "${existing_dovecot_key}"
    fi
fi
use_dovecot_tls_pair_if_valid \
    "/etc/letsencrypt/live/${MAIL_HOSTNAME}/fullchain.pem" \
    "/etc/letsencrypt/live/${MAIL_HOSTNAME}/privkey.pem"
use_dovecot_tls_pair_if_valid \
    "/etc/ssl/openmailstack/fullchain.pem" \
    "/etc/ssl/openmailstack/privkey.pem"

# Determine Dovecot Version (e.g., 2.3 or 2.4)
DOVECOT_VERSION=$(dovecot --version 2>/dev/null | grep -oE '^[0-9]+\.[0-9]+' || echo "unknown")
if [[ "$DOVECOT_VERSION" == "unknown" ]]; then
    echo -e "${YELLOW}Warning: Could not dynamically parse Dovecot version. Defaulting to 2.3 logic.${NC}"
    DOVECOT_VERSION="2.3"
fi
echo -e "Detected Dovecot Version: ${DOVECOT_VERSION}"

# 2. Configure the SQL Connection & Local Overrides
echo -e "Applying Dovecot local configuration overrides..."

if [[ "$DOVECOT_VERSION" == "2.4" ]]; then
    # ==========================================
    # Dovecot 2.4+ Syntax
    # ==========================================
    
    # Clean up the old ext file if it exists from a previous run
    rm -f /etc/dovecot/dovecot-sql.conf.ext /etc/dovecot/dovecot-app-passwords-sql.conf.ext

    cat <<EOF > /etc/dovecot/local.conf
protocols = ${DOVECOT_PROTOCOLS}

# disable_plaintext_auth was removed in 2.4. auth_allow_cleartext = no is the new default.
auth_mechanisms = plain login
auth_master_user_separator = *

mail_driver = maildir
mail_path = /var/vmail/%{user | domain}/%{user | username}
mail_uid = 5000
mail_gid = 5000
first_valid_uid = 5000
last_valid_uid = 5000

# In 2.4, SQL connections are defined natively at the global level
sql_driver = mysql
mysql 127.0.0.1 {
  user = ${POSTFIXADMIN_DB_USER}
  password = ${POSTFIXADMIN_DB_PASSWORD}
  dbname = ${POSTFIXADMIN_DB_NAME}
}

passdb_default_password_scheme = BLF-CRYPT

passdb passwd-file {
  passwd_file_path = ${DOVECOT_MASTER_USERS_FILE}
  master = yes
  result_success = continue
}

passdb app-passwords {
  driver = sql
  sql_query = SELECT NULL AS password, 'Y' AS nopassword, ap.username AS user FROM app_passwords ap INNER JOIN mailbox m ON m.username = ap.username AND m.active = '1' INNER JOIN account_security s ON s.username = ap.username AND s.totp_enabled_at IS NOT NULL WHERE ap.username = '%{user}' AND ap.revoked_at IS NULL AND ap.secret_hash = SHA2('%{password}', 256)
}

passdb mailbox-passwords {
  driver = sql
  sql_query = SELECT username AS user, password FROM mailbox WHERE username = '%{user}' AND active = '1' AND ('%{master_user}' <> '' OR NOT EXISTS (SELECT 1 FROM account_security s WHERE s.username = mailbox.username AND s.totp_enabled_at IS NOT NULL))
}

userdb sql {
  query = SELECT CONCAT('/var/vmail/', maildir) AS home, CONCAT('/var/vmail/', maildir) AS mail_path, 5000 AS uid, 5000 AS gid FROM mailbox WHERE username = '%{user}' AND active = '1'
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

namespace inbox {
  mailbox Drafts {
    auto = subscribe
    special_use = \Drafts
  }
  mailbox Draft {
    auto = no
    special_use = \Drafts
  }
  mailbox Junk {
    auto = subscribe
    special_use = \Junk
  }
  mailbox "Junk E-mail" {
    auto = no
    special_use = \Junk
  }
  mailbox Spam {
    auto = no
    special_use = \Junk
  }
  mailbox "Bulk Mail" {
    auto = no
    special_use = \Junk
  }
  mailbox Trash {
    auto = subscribe
    special_use = \Trash
  }
  mailbox "Deleted Messages" {
    auto = no
    special_use = \Trash
  }
  mailbox "Deleted Items" {
    auto = no
    special_use = \Trash
  }
  mailbox Bin {
    auto = no
    special_use = \Trash
  }
  mailbox Deleted {
    auto = no
    special_use = \Trash
  }
  mailbox Archive {
    auto = subscribe
    special_use = \Archive
  }
  mailbox Archives {
    auto = no
    special_use = \Archive
  }
  mailbox Sent {
    auto = subscribe
    special_use = \Sent
  }
  mailbox "Sent Messages" {
    auto = no
    special_use = \Sent
  }
  mailbox "Sent Items" {
    auto = no
    special_use = \Sent
  }
  mailbox "Sent Mail" {
    auto = no
    special_use = \Sent
  }
}
EOF

    if [[ -n "${DOVECOT_TLS_CERT_FILE}" ]]; then
        cat <<EOF >> /etc/dovecot/local.conf

# --- OpenMailStack SSL ---
ssl = required
ssl_server_cert_file = ${DOVECOT_TLS_CERT_FILE}
ssl_server_key_file = ${DOVECOT_TLS_KEY_FILE}
EOF
    fi

else
    # ==========================================
    # Dovecot 2.3 and below Syntax
    # ==========================================
    echo -e "Configuring Dovecot SQL connection (Legacy 2.3)..."
    cat <<EOF > /etc/dovecot/dovecot-sql.conf.ext
driver = mysql
connect = host=127.0.0.1 dbname=${POSTFIXADMIN_DB_NAME} user=${POSTFIXADMIN_DB_USER} password=${POSTFIXADMIN_DB_PASSWORD}
default_pass_scheme = BLF-CRYPT
password_query = SELECT username AS user, password FROM mailbox WHERE username = '%u' AND active = '1' AND ('%{master_user}' <> '' OR NOT EXISTS (SELECT 1 FROM account_security s WHERE s.username = mailbox.username AND s.totp_enabled_at IS NOT NULL))
user_query = SELECT maildir, 5000 AS uid, 5000 AS gid FROM mailbox WHERE username = '%u' AND active = '1'
EOF

    chown root:root /etc/dovecot/dovecot-sql.conf.ext
    chmod 600 /etc/dovecot/dovecot-sql.conf.ext

    cat <<EOF > /etc/dovecot/dovecot-app-passwords-sql.conf.ext
driver = mysql
connect = host=127.0.0.1 dbname=${POSTFIXADMIN_DB_NAME} user=${POSTFIXADMIN_DB_USER} password=${POSTFIXADMIN_DB_PASSWORD}
password_query = SELECT NULL AS password, 'Y' AS nopassword, ap.username AS user FROM app_passwords ap INNER JOIN mailbox m ON m.username = ap.username AND m.active = '1' INNER JOIN account_security s ON s.username = ap.username AND s.totp_enabled_at IS NOT NULL WHERE ap.username = '%u' AND ap.revoked_at IS NULL AND ap.secret_hash = SHA2('%w', 256)
EOF

    chown root:root /etc/dovecot/dovecot-app-passwords-sql.conf.ext
    chmod 600 /etc/dovecot/dovecot-app-passwords-sql.conf.ext

    cat <<EOF > /etc/dovecot/local.conf
protocols = ${DOVECOT_PROTOCOLS}

disable_plaintext_auth = yes
auth_mechanisms = plain login
auth_master_user_separator = *

mail_location = maildir:/var/vmail/%domain/%n
mail_uid = 5000
mail_gid = 5000
first_valid_uid = 5000
last_valid_uid = 5000

mail_home = /var/vmail/%{user | domain}/%{user | username}

passdb {
  driver = passwd-file
  args = ${DOVECOT_MASTER_USERS_FILE}
  master = yes
  pass = yes
}

passdb {
  driver = sql
  args = /etc/dovecot/dovecot-app-passwords-sql.conf.ext
}

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

namespace inbox {
  mailbox Drafts {
    auto = subscribe
    special_use = \Drafts
  }
  mailbox Draft {
    auto = no
    special_use = \Drafts
  }
  mailbox Junk {
    auto = subscribe
    special_use = \Junk
  }
  mailbox "Junk E-mail" {
    auto = no
    special_use = \Junk
  }
  mailbox Spam {
    auto = no
    special_use = \Junk
  }
  mailbox "Bulk Mail" {
    auto = no
    special_use = \Junk
  }
  mailbox Trash {
    auto = subscribe
    special_use = \Trash
  }
  mailbox "Deleted Messages" {
    auto = no
    special_use = \Trash
  }
  mailbox "Deleted Items" {
    auto = no
    special_use = \Trash
  }
  mailbox Bin {
    auto = no
    special_use = \Trash
  }
  mailbox Deleted {
    auto = no
    special_use = \Trash
  }
  mailbox Archive {
    auto = subscribe
    special_use = \Archive
  }
  mailbox Archives {
    auto = no
    special_use = \Archive
  }
  mailbox Sent {
    auto = subscribe
    special_use = \Sent
  }
  mailbox "Sent Messages" {
    auto = no
    special_use = \Sent
  }
  mailbox "Sent Items" {
    auto = no
    special_use = \Sent
  }
  mailbox "Sent Mail" {
    auto = no
    special_use = \Sent
  }
}
EOF

    if [[ -n "${DOVECOT_TLS_CERT_FILE}" ]]; then
        cat <<EOF >> /etc/dovecot/local.conf

# --- OpenMailStack SSL ---
ssl = required
ssl_cert = <${DOVECOT_TLS_CERT_FILE}
ssl_key = <${DOVECOT_TLS_KEY_FILE}
EOF
    fi
fi

# local.conf can contain SQL credentials on Dovecot 2.4+, so keep it root-only.
chown root:root /etc/dovecot/local.conf
chmod 600 /etc/dovecot/local.conf

# Restart and enable Dovecot
echo -e "Restarting Dovecot..."
systemctl enable --now dovecot
systemctl restart dovecot

echo -e "${GREEN}Dovecot setup complete!${NC}"

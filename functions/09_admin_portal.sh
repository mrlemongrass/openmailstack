#!/usr/bin/env bash

# ==============================================================================
# Strict Bash Mode
# ==============================================================================
set -euo pipefail
trap 'echo -e "\033[0;31mERROR in ${BASH_SOURCE[0]} at line ${LINENO}: ${BASH_COMMAND}\033[0m" >&2' ERR

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${YELLOW}Starting Admin Portal Deployment...${NC}"

# Source the configuration file
source ./config.conf
SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
source "${SCRIPT_DIR}/lib_os.sh"
detect_openmailstack_os

# 1. Prepare directory and copy files
echo -e "Deploying files to /var/www/openmailstack-admin..."
mkdir -p /var/www/openmailstack-admin
cp -r "${SCRIPT_DIR}/../admin_portal_src/"* /var/www/openmailstack-admin/

# 2. Configure credentials
echo -e "Configuring Admin Portal..."
# Escape variables for sed
DB_USER_PHP=$(printf '%s\n' "$POSTFIXADMIN_DB_USER" | sed -e 's/\\/\\\\/g' -e "s/'/\\\'/g" -e 's/[\/&]/\\&/g')
DB_PASS_PHP=$(printf '%s\n' "$POSTFIXADMIN_DB_PASSWORD" | sed -e 's/\\/\\\\/g' -e "s/'/\\\'/g" -e 's/[\/&]/\\&/g')
DB_NAME_PHP=$(printf '%s\n' "$POSTFIXADMIN_DB_NAME" | sed -e 's/\\/\\\\/g' -e "s/'/\\\'/g" -e 's/[\/&]/\\&/g')
ADMIN_PASS_PHP=$(printf '%s\n' "${ADMIN_PORTAL_PASSWORD:-ChangeMe}" | sed -e 's/\\/\\\\/g' -e "s/'/\\\'/g" -e 's/[\/&]/\\&/g')
RSPAMD_PASS_PHP=$(printf '%s\n' "${POSTFIXADMIN_SETUP_PASSWORD:-Unknown}" | sed -e 's/\\/\\\\/g' -e "s/'/\\\'/g" -e 's/[\/&]/\\&/g')

# Only generate config if it doesn't already exist to preserve customizations
if [[ ! -f /var/www/openmailstack-admin/config.php ]]; then
    mv /var/www/openmailstack-admin/config.php.template /var/www/openmailstack-admin/config.php
    sed -i "s/{{DB_USER}}/${DB_USER_PHP}/g" /var/www/openmailstack-admin/config.php
    sed -i "s/{{DB_PASS}}/${DB_PASS_PHP}/g" /var/www/openmailstack-admin/config.php
    sed -i "s/{{DB_NAME}}/${DB_NAME_PHP}/g" /var/www/openmailstack-admin/config.php
    sed -i "s/{{ADMIN_PASS}}/${ADMIN_PASS_PHP}/g" /var/www/openmailstack-admin/config.php
    sed -i "s/{{RSPAMD_PASS}}/${RSPAMD_PASS_PHP}/g" /var/www/openmailstack-admin/config.php
else
    rm -f /var/www/openmailstack-admin/config.php.template
fi

chown -R root:www-data /var/www/openmailstack-admin
find /var/www/openmailstack-admin -type d -exec chmod 750 {} \;
find /var/www/openmailstack-admin -type f -exec chmod 640 {} \;

# 3. Update Nginx Configuration
echo -e "Configuring Nginx for Admin Portal..."
PHP_SOCK=$(openmailstack_php_fpm_socket || true)
if [[ -z "${PHP_SOCK}" ]]; then
    echo -e "\033[0;31mError: Could not detect a PHP-FPM socket for ${OPENMAILSTACK_OS_LABEL}.\033[0m"
    exit 1
fi

if ! grep -q "# --- OpenMailStack Admin Portal ---" /etc/nginx/sites-available/mailserver.conf; then
# Inject the config right before the final closing brace '}'
sed -i '/^}/i \
    # --- OpenMailStack Admin Portal ---\
    location = /SOGo/admin {\
        return 301 /SOGo/admin/;\
    }\
    location ^~ /SOGo/admin/rspamd/ {\
        proxy_pass http://127.0.0.1:11334/;\
        proxy_set_header Host $host;\
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\
    }\
    location ^~ /SOGo/admin/ {\
        alias /var/www/openmailstack-admin/public/;\
        index index.php index.html;\
        try_files $uri $uri/ @sogoadmin;\
    }\
    location @sogoadmin {\
        rewrite ^/SOGo/admin/(.*)$ /SOGo/admin/index.php?$query_string last;\
    }\
    location ~ ^/SOGo/admin/(.+\\.php)$ {\
        alias /var/www/openmailstack-admin/public/$1;\
        fastcgi_pass unix:'"${PHP_SOCK}"';\
        fastcgi_index index.php;\
        include fastcgi_params;\
        fastcgi_param SCRIPT_FILENAME /var/www/openmailstack-admin/public/$1;\
    }\
' /etc/nginx/sites-available/mailserver.conf
fi

systemctl restart nginx || true

# 4. Interactive Admin Account Setup
echo -e "\n${CYAN}Admin Portal Account Setup${NC}"
echo "1) Create a new Admin account"
echo "2) Make an existing user an Admin"
while true; do
    read -p "Select option (1-2) [default: 1]: " ADMIN_OPT
    ADMIN_OPT=${ADMIN_OPT:-1}
    if [[ "$ADMIN_OPT" =~ ^[12]$ ]]; then
        break
    fi
    echo "Invalid option."
done

if [[ "$ADMIN_OPT" == "2" ]]; then
    read -p "Enter existing user's email address (e.g. user@example.com): " ADMIN_USER
    ADMIN_USER_SQL=$(printf "%s" "$ADMIN_USER" | sed -e 's/\\/\\\\/g' -e "s/'/''/g")
    
    # Check if user exists and grab their password hash
    USER_EXISTS=$(mysql -u "$POSTFIXADMIN_DB_USER" -p"$POSTFIXADMIN_DB_PASSWORD" "$POSTFIXADMIN_DB_NAME" -se "SELECT COUNT(*) FROM mailbox WHERE username='$ADMIN_USER_SQL'")
    if [[ "$USER_EXISTS" -eq 0 ]]; then
        echo -e "${YELLOW}User does not exist in the mailbox table. Proceeding to create as a new admin...${NC}"
        ADMIN_OPT=1
    else
        HASH=$(mysql -u "$POSTFIXADMIN_DB_USER" -p"$POSTFIXADMIN_DB_PASSWORD" "$POSTFIXADMIN_DB_NAME" -se "SELECT password FROM mailbox WHERE username='$ADMIN_USER_SQL'")
        mysql -u "$POSTFIXADMIN_DB_USER" -p"$POSTFIXADMIN_DB_PASSWORD" "$POSTFIXADMIN_DB_NAME" -e "INSERT IGNORE INTO admin (username, password, superadmin, active) VALUES ('$ADMIN_USER_SQL', '$HASH', 1, 1);"
        echo -e "${GREEN}Existing user '$ADMIN_USER' has been granted Admin access!${NC}"
    fi
fi

if [[ "$ADMIN_OPT" == "1" ]]; then
    read -p "Enter new Admin username/email (e.g., admin@example.com): " ADMIN_USER
    ADMIN_USER_SQL=$(printf "%s" "$ADMIN_USER" | sed -e 's/\\/\\\\/g' -e "s/'/''/g")
    
    while true; do
        read -s -p "Enter new Admin password: " ADMIN_PASSWORD
        echo ""
        read -s -p "Confirm new Admin password: " ADMIN_PASSWORD_CONFIRM
        echo ""
        if [[ -z "$ADMIN_PASSWORD" ]]; then
            echo "Password cannot be empty."
        elif [[ "$ADMIN_PASSWORD" != "$ADMIN_PASSWORD_CONFIRM" ]]; then
            echo "Passwords do not match. Please try again."
        else
            break
        fi
    done
    
    # Hash password using doveadm
    ADMIN_HASH=$(doveadm pw -s SHA512-CRYPT -p "$ADMIN_PASSWORD" 2>/dev/null || echo "")
    if [[ -z "$ADMIN_HASH" ]]; then
        # Fallback if doveadm fails during dry-runs or permission issues
        ADMIN_HASH=$(ADMIN_PASSWORD="$ADMIN_PASSWORD" php -r 'echo password_hash(getenv("ADMIN_PASSWORD"), PASSWORD_DEFAULT);')
    fi
    
    mysql -u "$POSTFIXADMIN_DB_USER" -p"$POSTFIXADMIN_DB_PASSWORD" "$POSTFIXADMIN_DB_NAME" -e "
        INSERT IGNORE INTO admin (username, password, superadmin, active) VALUES ('$ADMIN_USER_SQL', '$ADMIN_HASH', 1, 1);
        CREATE TABLE IF NOT EXISTS api_keys (
            id INT AUTO_INCREMENT PRIMARY KEY,
            description VARCHAR(255) NOT NULL,
            key_hash VARCHAR(255) NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            last_used DATETIME NULL
        );
        CREATE TABLE IF NOT EXISTS user_spam_rules (
            username VARCHAR(255) PRIMARY KEY,
            rules_json TEXT
        );
        CREATE TABLE IF NOT EXISTS domain_verification (
            domain VARCHAR(255) PRIMARY KEY,
            token VARCHAR(255) NOT NULL
        );
    "
    echo -e "${GREEN}New Admin account '$ADMIN_USER' created successfully!${NC}"
fi

# Build Sudoers Bridge for Upgrade System
echo -e "Configuring secure upgrade bridge..."
cp "${SCRIPT_DIR}/../upgrade.sh" /usr/local/bin/openmailstack-upgrade.sh
chmod +x /usr/local/bin/openmailstack-upgrade.sh
echo "www-data ALL=(root) NOPASSWD: /usr/local/bin/openmailstack-upgrade.sh" > /etc/sudoers.d/openmailstack-upgrade
chmod 0440 /etc/sudoers.d/openmailstack-upgrade
cp "${SCRIPT_DIR}/../VERSION" /var/www/openmailstack-admin/VERSION

echo -e "\n${GREEN}Admin Portal setup complete!${NC}"

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

echo -e "${YELLOW}Starting System Database and Web Server Installation...${NC}"

# Source the configuration file
source ./config.conf

export DEBIAN_FRONTEND=noninteractive

# 1. Install MariaDB, Nginx, and PHP
echo -e "Installing MariaDB, Nginx, and PHP-FPM with extensions..."
apt-get install -y -qq \
    mariadb-server \
    nginx \
    php-fpm \
    php-mysql \
    php-cli \
    php-mbstring \
    php-imap \
    php-intl \
    php-xml \
    php-curl \
    php-zip \
    php-gd \
    php-bz2

# 2. Secure MariaDB (Idempotent & Portable)
# Debian/Ubuntu configures MariaDB root to use unix_socket by default.
# We enforce it here and clean up default insecure tables.
echo -e "Securing MariaDB environment..."

# Because we are running as system root, the 'mysql' command works without a password.
mysql -e "ALTER USER 'root'@'localhost' IDENTIFIED VIA unix_socket;"
mysql -e "DROP DATABASE IF EXISTS test;"
mysql -e "DELETE FROM mysql.user WHERE User='';"
# Clean up any legacy root hosts that aren't localhost
mysql -e "DELETE FROM mysql.user WHERE User='root' AND Host NOT IN ('localhost', '127.0.0.1', '::1');"
mysql -e "FLUSH PRIVILEGES;"

# 3. Create Databases and Users (Idempotent)
echo -e "Provisioning databases for vmail, PostfixAdmin, and Roundcube..."

# Vmail Database
mysql -e "CREATE DATABASE IF NOT EXISTS ${VMAIL_DB_NAME} DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;"
mysql -e "CREATE USER IF NOT EXISTS '${VMAIL_DB_USER}'@'localhost' IDENTIFIED BY '${VMAIL_DB_PASSWORD}';"
mysql -e "ALTER USER '${VMAIL_DB_USER}'@'localhost' IDENTIFIED BY '${VMAIL_DB_PASSWORD}';" # Forces password update if user already exists
mysql -e "GRANT ALL PRIVILEGES ON ${VMAIL_DB_NAME}.* TO '${VMAIL_DB_USER}'@'localhost';"

# PostfixAdmin Database
mysql -e "CREATE DATABASE IF NOT EXISTS ${POSTFIXADMIN_DB_NAME} DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;"
mysql -e "CREATE USER IF NOT EXISTS '${POSTFIXADMIN_DB_USER}'@'localhost' IDENTIFIED BY '${POSTFIXADMIN_DB_PASSWORD}';"
mysql -e "ALTER USER '${POSTFIXADMIN_DB_USER}'@'localhost' IDENTIFIED BY '${POSTFIXADMIN_DB_PASSWORD}';"
mysql -e "GRANT ALL PRIVILEGES ON ${POSTFIXADMIN_DB_NAME}.* TO '${POSTFIXADMIN_DB_USER}'@'localhost';"

# Roundcube Database
mysql -e "CREATE DATABASE IF NOT EXISTS ${ROUNDCUBE_DB_NAME} DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;"
mysql -e "CREATE USER IF NOT EXISTS '${ROUNDCUBE_DB_USER}'@'localhost' IDENTIFIED BY '${ROUNDCUBE_DB_PASSWORD}';"
mysql -e "ALTER USER '${ROUNDCUBE_DB_USER}'@'localhost' IDENTIFIED BY '${ROUNDCUBE_DB_PASSWORD}';"
mysql -e "GRANT ALL PRIVILEGES ON ${ROUNDCUBE_DB_NAME}.* TO '${ROUNDCUBE_DB_USER}'@'localhost';"

mysql -e "FLUSH PRIVILEGES;"

# 4. Restart and Enable Services
echo -e "Enabling and restarting Nginx and MariaDB..."
systemctl enable --now mariadb nginx

# Dynamically find the PHP-FPM service name and restart it
PHP_FPM_SERVICE=$(systemctl list-unit-files | grep -o 'php.*-fpm.service' | head -n 1 || true)
if [[ -n "$PHP_FPM_SERVICE" ]]; then
    systemctl enable --now "$PHP_FPM_SERVICE"
    systemctl restart "$PHP_FPM_SERVICE"
else
    echo -e "${YELLOW}Warning: Could not dynamically determine PHP-FPM service name. It may need a manual restart later.${NC}"
fi

echo -e "${GREEN}Database and Web Server setup complete!${NC}"

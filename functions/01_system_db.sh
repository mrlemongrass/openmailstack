#!/usr/bin/env bash

# Exit on error
set -e

# Colors for output
RED='\033[0;31m'
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

# 2. Secure MariaDB and Set Root Password
# This replicates 'mysql_secure_installation' non-interactively
echo -e "Securing MariaDB and setting up root access..."

mysql -e "UPDATE mysql.global_priv SET priv=json_set(priv, '$.plugin', 'mysql_native_password', '$.authentication_string', PASSWORD('${DB_ROOT_PASSWORD}')) WHERE User='root';"
mysql -e "DELETE FROM mysql.global_priv WHERE User='';"
mysql -e "DELETE FROM mysql.global_priv WHERE User='root' AND Host NOT IN ('localhost', '127.0.0.1', '::1');"
mysql -e "DROP DATABASE IF EXISTS test;"
mysql -e "DELETE FROM mysql.db WHERE Db='test' OR Db='test\\_%';"
mysql -e "FLUSH PRIVILEGES;"

# 3. Create Databases and Users for the Mail Stack
echo -e "Creating databases for vmail, PostfixAdmin, and Roundcube..."

# Run SQL commands using the newly set root password
MYSQL_CONN="mysql -u root -p${DB_ROOT_PASSWORD} -e"

# Vmail Database (Used by Postfix/Dovecot to look up mailboxes and domains)
$MYSQL_CONN "CREATE DATABASE IF NOT EXISTS ${VMAIL_DB_NAME} DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;"
$MYSQL_CONN "GRANT ALL PRIVILEGES ON ${VMAIL_DB_NAME}.* TO '${VMAIL_DB_USER}'@'localhost' IDENTIFIED BY '${VMAIL_DB_PASSWORD}';"

# PostfixAdmin Database
$MYSQL_CONN "CREATE DATABASE IF NOT EXISTS ${POSTFIXADMIN_DB_NAME} DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;"
$MYSQL_CONN "GRANT ALL PRIVILEGES ON ${POSTFIXADMIN_DB_NAME}.* TO '${POSTFIXADMIN_DB_USER}'@'localhost' IDENTIFIED BY '${POSTFIXADMIN_DB_PASSWORD}';"

# Roundcube Database
$MYSQL_CONN "CREATE DATABASE IF NOT EXISTS ${ROUNDCUBE_DB_NAME} DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;"
$MYSQL_CONN "GRANT ALL PRIVILEGES ON ${ROUNDCUBE_DB_NAME}.* TO '${ROUNDCUBE_DB_USER}'@'localhost' IDENTIFIED BY '${ROUNDCUBE_DB_PASSWORD}';"

$MYSQL_CONN "FLUSH PRIVILEGES;"

# 4. Restart and Enable Services
echo -e "Enabling and restarting Nginx and MariaDB..."
systemctl enable mariadb nginx
systemctl restart mariadb nginx

# Dynamically find the PHP-FPM service name (e.g., php8.1-fpm, php8.2-fpm) and restart it
PHP_FPM_SERVICE=$(systemctl list-unit-files | grep -o 'php.*-fpm.service' | head -n 1)
if [ -n "$PHP_FPM_SERVICE" ]; then
    systemctl enable "$PHP_FPM_SERVICE"
    systemctl restart "$PHP_FPM_SERVICE"
else
    echo -e "${YELLOW}Warning: Could not dynamically determine PHP-FPM service name. It may need a manual restart later.${NC}"
fi

echo -e "${GREEN}Database and Web Server setup complete!${NC}"

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
SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
source "${SCRIPT_DIR}/lib_os.sh"
detect_openmailstack_os

export DEBIAN_FRONTEND=noninteractive

escape_sql_literal() {
    printf "%s" "$1" | sed -e 's/\\/\\\\/g' -e "s/'/''/g"
}

escape_mysql_identifier() {
    printf "%s" "$1" | sed 's/`/``/g'
}

# 1. Install MariaDB, Nginx, and PHP
echo -e "Installing MariaDB, Nginx, and PHP-FPM with extensions..."
PHP_VERSION=$(openmailstack_expected_php_version)
PHP_REQUIRED_PACKAGES=()
PHP_OPTIONAL_PACKAGES=()

if [[ -n "${PHP_VERSION}" ]] && openmailstack_package_exists "php${PHP_VERSION}-fpm"; then
    echo -e "Using versioned PHP packages for ${OPENMAILSTACK_OS_LABEL}: ${PHP_VERSION}"
    PHP_REQUIRED_PACKAGES=(
        "php${PHP_VERSION}-fpm"
        "php${PHP_VERSION}-mysql"
        "php${PHP_VERSION}-cli"
        "php${PHP_VERSION}-mbstring"
        "php${PHP_VERSION}-intl"
        "php${PHP_VERSION}-xml"
        "php${PHP_VERSION}-curl"
        "php${PHP_VERSION}-zip"
        "php${PHP_VERSION}-gd"
        "php${PHP_VERSION}-bz2"
    )
    PHP_OPTIONAL_PACKAGES=(
        "php${PHP_VERSION}-imap"
        "php${PHP_VERSION}-ldap"
    )
else
    echo -e "${YELLOW}Versioned PHP packages unavailable, falling back to unversioned meta packages.${NC}"
    PHP_REQUIRED_PACKAGES=(
        php-fpm
        php-mysql
        php-cli
        php-mbstring
        php-intl
        php-xml
        php-curl
        php-zip
        php-gd
        php-bz2
    )
    PHP_OPTIONAL_PACKAGES=(
        php-imap
        php-ldap
    )
fi

REQUIRED_PACKAGES=(
    mariadb-server
    nginx
    "${PHP_REQUIRED_PACKAGES[@]}"
)

openmailstack_install_required_packages "${REQUIRED_PACKAGES[@]}"
openmailstack_install_optional_packages "${PHP_OPTIONAL_PACKAGES[@]}"

# 2. Secure MariaDB (Idempotent & Portable)
# Debian/Ubuntu configures MariaDB root to use unix_socket by default.
# We enforce it here and clean up default insecure tables.
echo -e "Securing MariaDB environment..."

# Because we are running as system root, the 'mysql' command works without a password.
# Keep SQL out of command arguments to reduce password exposure via process listings.
mysql <<SQL
ALTER USER 'root'@'localhost' IDENTIFIED VIA unix_socket;
DROP DATABASE IF EXISTS test;
DELETE FROM mysql.user WHERE User='';
DELETE FROM mysql.user WHERE User='root' AND Host NOT IN ('localhost', '127.0.0.1', '::1');
FLUSH PRIVILEGES;
SQL

# 3. Create Databases and Users (Idempotent)
echo -e "Provisioning databases for vmail, PostfixAdmin, and Roundcube..."

VMAIL_DB_NAME_SQL="$(escape_mysql_identifier "${VMAIL_DB_NAME}")"
VMAIL_DB_USER_SQL="$(escape_sql_literal "${VMAIL_DB_USER}")"
VMAIL_DB_PASSWORD_SQL="$(escape_sql_literal "${VMAIL_DB_PASSWORD}")"

POSTFIXADMIN_DB_NAME_SQL="$(escape_mysql_identifier "${POSTFIXADMIN_DB_NAME}")"
POSTFIXADMIN_DB_USER_SQL="$(escape_sql_literal "${POSTFIXADMIN_DB_USER}")"
POSTFIXADMIN_DB_PASSWORD_SQL="$(escape_sql_literal "${POSTFIXADMIN_DB_PASSWORD}")"

ROUNDCUBE_DB_NAME_SQL="$(escape_mysql_identifier "${ROUNDCUBE_DB_NAME}")"
ROUNDCUBE_DB_USER_SQL="$(escape_sql_literal "${ROUNDCUBE_DB_USER}")"
ROUNDCUBE_DB_PASSWORD_SQL="$(escape_sql_literal "${ROUNDCUBE_DB_PASSWORD}")"

mysql <<SQL
CREATE DATABASE IF NOT EXISTS \`${VMAIL_DB_NAME_SQL}\` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
CREATE USER IF NOT EXISTS '${VMAIL_DB_USER_SQL}'@'localhost' IDENTIFIED BY '${VMAIL_DB_PASSWORD_SQL}';
ALTER USER '${VMAIL_DB_USER_SQL}'@'localhost' IDENTIFIED BY '${VMAIL_DB_PASSWORD_SQL}';
GRANT ALL PRIVILEGES ON \`${VMAIL_DB_NAME_SQL}\`.* TO '${VMAIL_DB_USER_SQL}'@'localhost';

CREATE DATABASE IF NOT EXISTS \`${POSTFIXADMIN_DB_NAME_SQL}\` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
CREATE USER IF NOT EXISTS '${POSTFIXADMIN_DB_USER_SQL}'@'localhost' IDENTIFIED BY '${POSTFIXADMIN_DB_PASSWORD_SQL}';
ALTER USER '${POSTFIXADMIN_DB_USER_SQL}'@'localhost' IDENTIFIED BY '${POSTFIXADMIN_DB_PASSWORD_SQL}';
GRANT ALL PRIVILEGES ON \`${POSTFIXADMIN_DB_NAME_SQL}\`.* TO '${POSTFIXADMIN_DB_USER_SQL}'@'localhost';

CREATE DATABASE IF NOT EXISTS \`${ROUNDCUBE_DB_NAME_SQL}\` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
CREATE USER IF NOT EXISTS '${ROUNDCUBE_DB_USER_SQL}'@'localhost' IDENTIFIED BY '${ROUNDCUBE_DB_PASSWORD_SQL}';
ALTER USER '${ROUNDCUBE_DB_USER_SQL}'@'localhost' IDENTIFIED BY '${ROUNDCUBE_DB_PASSWORD_SQL}';
GRANT ALL PRIVILEGES ON \`${ROUNDCUBE_DB_NAME_SQL}\`.* TO '${ROUNDCUBE_DB_USER_SQL}'@'localhost';

FLUSH PRIVILEGES;
SQL

# 4. Restart and Enable Services
echo -e "Enabling and restarting Nginx and MariaDB..."
systemctl enable --now mariadb nginx

# Choose PHP-FPM service using OS-aware helper with runtime fallback.
PHP_FPM_SERVICE=$(openmailstack_php_fpm_service || true)
if [[ -n "$PHP_FPM_SERVICE" ]]; then
    echo -e "Using PHP-FPM service: ${PHP_FPM_SERVICE}"
    systemctl enable --now "$PHP_FPM_SERVICE"
    systemctl restart "$PHP_FPM_SERVICE"
else
    echo -e "${YELLOW}Warning: Could not dynamically determine PHP-FPM service name. It may need a manual restart later.${NC}"
fi

echo -e "${GREEN}Database and Web Server setup complete!${NC}"

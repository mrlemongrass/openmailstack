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

echo -e "${YELLOW}Starting PostfixAdmin Installation...${NC}"

# Source the configuration file
source ./config.conf
SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
source "${SCRIPT_DIR}/lib_os.sh"
detect_openmailstack_os

POSTFIXADMIN_ALLOW_LAB_DOMAINS="${POSTFIXADMIN_ALLOW_LAB_DOMAINS:-0}"
if [[ ! "${POSTFIXADMIN_ALLOW_LAB_DOMAINS}" =~ ^[01]$ ]]; then
    echo -e "\033[0;31mError: POSTFIXADMIN_ALLOW_LAB_DOMAINS must be 0 or 1.\033[0m" >&2
    exit 1
fi

PFA_DOMAIN_IN_DNS="YES"
PFA_EMAILCHECK_RESOLVE_DOMAIN="YES"
if [[ "${POSTFIXADMIN_ALLOW_LAB_DOMAINS}" -eq 1 ]]; then
    echo -e "${YELLOW}PostfixAdmin lab domain mode enabled (DNS checks disabled).${NC}"
    PFA_DOMAIN_IN_DNS="NO"
    PFA_EMAILCHECK_RESOLVE_DOMAIN="NO"
fi

# 1. Download and Extract PostfixAdmin
PFA_VERSION="3.3.13"
PFA_TARBALL="postfixadmin-${PFA_VERSION}.tar.gz"
PFA_URL="https://github.com/postfixadmin/postfixadmin/archive/refs/tags/postfixadmin-${PFA_VERSION}.tar.gz"
# Update this checksum whenever PFA_VERSION changes.
PFA_SHA256="026c4f370656b96b6c9f62328e901b9416a6e56d1c4df86249995d661498947b"

echo -e "Downloading PostfixAdmin version ${PFA_VERSION}..."
cd /tmp
wget -q -O "${PFA_TARBALL}" "${PFA_URL}"

echo -e "Verifying PostfixAdmin tarball checksum..."
echo "${PFA_SHA256}  ${PFA_TARBALL}" | sha256sum -c -

echo -e "Extracting to /var/www/postfixadmin..."
tar -xzf "${PFA_TARBALL}"
# Removing the directory first ensures a clean overwrite if re-run
rm -rf /var/www/postfixadmin
mv postfixadmin-postfixadmin-${PFA_VERSION} /var/www/postfixadmin

mkdir -p /var/www/postfixadmin/templates_c
# Set permissions
chown -R ${WEB_USER}:${WEB_GROUP} /var/www/postfixadmin
chmod -R 755 /var/www/postfixadmin

# 2. Generate Setup Password Hash
echo -e "Generating secure setup password hash..."
SETUP_HASH=$(
    POSTFIXADMIN_SETUP_PASSWORD="${POSTFIXADMIN_SETUP_PASSWORD}" php <<'PHP'
<?php
$password = getenv('POSTFIXADMIN_SETUP_PASSWORD');
if ($password === false || $password === '') {
    fwrite(STDERR, "Error: POSTFIXADMIN_SETUP_PASSWORD is empty.\n");
    exit(1);
}
echo password_hash($password, PASSWORD_DEFAULT);
PHP
)

# 3. Create config.local.php
echo -e "Configuring PostfixAdmin database connections and encryption..."
DB_USER_PHP=$(printf '%s' "$POSTFIXADMIN_DB_USER" | sed -e "s/'/\\\'/g")
DB_PASS_PHP=$(printf '%s' "$POSTFIXADMIN_DB_PASSWORD" | sed -e "s/'/\\\'/g")
DB_NAME_PHP=$(printf '%s' "$POSTFIXADMIN_DB_NAME" | sed -e "s/'/\\\'/g")

cat <<EOF > /var/www/postfixadmin/config.local.php
<?php
\$CONF['configured'] = true;
\$CONF['database_type'] = 'mysqli';
\$CONF['database_host'] = 'localhost';
\$CONF['database_user'] = '${DB_USER_PHP}';
\$CONF['database_password'] = '${DB_PASS_PHP}';
\$CONF['database_name'] = '${DB_NAME_PHP}';
\$CONF['setup_password'] = '${SETUP_HASH}';

// --- OpenMailStack Modern Security ---
// Force Dovecot's native Blowfish encryption to prevent auth mismatches
\$CONF['encrypt'] = 'dovecot:BLF-CRYPT';
\$CONF['dovecotpw'] = '/usr/bin/doveadm pw';

// Production-safe by default; can be relaxed for local labs via config.
\$CONF['domain_in_dns'] = '${PFA_DOMAIN_IN_DNS}';
\$CONF['emailcheck_resolve_domain'] = '${PFA_EMAILCHECK_RESOLVE_DOMAIN}';

// --- Quotas and Defaults ---
\$CONF['default_aliases'] = array (
    'abuse'      => 'abuse@${FIRST_DOMAIN}',
    'hostmaster' => 'hostmaster@${FIRST_DOMAIN}',
    'postmaster' => 'postmaster@${FIRST_DOMAIN}',
    'webmaster'  => 'webmaster@${FIRST_DOMAIN}'
);
\$CONF['fetchmail'] = 'NO';
\$CONF['show_footer_text'] = 'NO';
\$CONF['quota'] = 'YES';
\$CONF['domain_quota'] = 'YES';
\$CONF['quota_multiplier'] = '1024000';
\$CONF['used_quotas'] = 'YES';
\$CONF['new_quota_table'] = 'YES';
\$CONF['aliases'] = '100';
\$CONF['mailboxes'] = '100';
\$CONF['maxquota'] = '10000';
\$CONF['domain_quota_default'] = '10000';
EOF

chown ${WEB_USER}:${WEB_GROUP} /var/www/postfixadmin/config.local.php
chmod 640 /var/www/postfixadmin/config.local.php

# 4. Configure Nginx
echo -e "Configuring Nginx for PostfixAdmin..."
PHP_SOCK=$(openmailstack_php_fpm_socket || true)
if [[ -z "${PHP_SOCK}" ]]; then
    echo -e "\033[0;31mError: Could not detect a PHP-FPM socket for ${OPENMAILSTACK_OS_LABEL}.\033[0m"
    exit 1
fi

cat <<EOF > /etc/nginx/sites-available/mailserver.conf
server {
    listen 80;
    server_name ${MAIL_HOSTNAME};
    root /var/www/html;
    index index.php index.html;

    location /postfixadmin {
        alias /var/www/postfixadmin/public/;
        index index.php;
        try_files \$uri \$uri/ /postfixadmin/index.php?\$query_string;
    }

    location ~ ^/postfixadmin/(.+\.php)$ {
        alias /var/www/postfixadmin/public/\$1;
        fastcgi_pass unix:${PHP_SOCK};
        fastcgi_index index.php;
        include fastcgi_params;
        fastcgi_param SCRIPT_FILENAME /var/www/postfixadmin/public/\$1;
    }
}
EOF

rm -f /etc/nginx/sites-enabled/default
ln -sf /etc/nginx/sites-available/mailserver.conf /etc/nginx/sites-enabled/mailserver.conf

systemctl restart nginx

# 5. Initialize the Database
# Trigger PostfixAdmin Upgrade script to create tables
echo -e "Creating PostfixAdmin database tables..."
sudo -u ${WEB_USER} php /var/www/postfixadmin/public/upgrade.php

echo -e "${GREEN}PostfixAdmin setup complete!${NC}"

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

# 1. Download and Extract PostfixAdmin
PFA_VERSION="3.3.13"
echo -e "Downloading PostfixAdmin version ${PFA_VERSION}..."
cd /tmp
wget -q -O postfixadmin.tar.gz "https://github.com/postfixadmin/postfixadmin/archive/refs/tags/postfixadmin-${PFA_VERSION}.tar.gz"

echo -e "Extracting to /var/www/postfixadmin..."
tar -xzf postfixadmin.tar.gz
# Removing the directory first ensures a clean overwrite if re-run
rm -rf /var/www/postfixadmin
mv postfixadmin-postfixadmin-${PFA_VERSION} /var/www/postfixadmin

mkdir -p /var/www/postfixadmin/templates_c
chown -R www-data:www-data /var/www/postfixadmin
chmod -R 755 /var/www/postfixadmin

# 2. Generate Setup Password Hash
echo -e "Generating secure setup password hash..."
SETUP_HASH=$(php -r "echo password_hash('${POSTFIXADMIN_SETUP_PASSWORD}', PASSWORD_DEFAULT);")

# 3. Create config.local.php
echo -e "Configuring PostfixAdmin database connections..."
cat <<EOF > /var/www/postfixadmin/config.local.php
<?php
\$CONF['configured'] = true;
\$CONF['database_type'] = 'mysqli';
\$CONF['database_host'] = 'localhost';
\$CONF['database_user'] = '${POSTFIXADMIN_DB_USER}';
\$CONF['database_password'] = '${POSTFIXADMIN_DB_PASSWORD}';
\$CONF['database_name'] = '${POSTFIXADMIN_DB_NAME}';
\$CONF['setup_password'] = '${SETUP_HASH}';
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

chown www-data:www-data /var/www/postfixadmin/config.local.php
chmod 640 /var/www/postfixadmin/config.local.php

# 4. Configure Nginx
echo -e "Configuring Nginx for PostfixAdmin..."

# BUG FIXED: Removed the stray backslashes here!
PHP_SOCK=$(find /run/php -name "php*-fpm.sock" | head -n 1)

cat <<EOF > /etc/nginx/sites-available/mailserver.conf
server {
    listen 80;
    server_name ${MAIL_HOSTNAME};
    root /var/www/html;
    index index.php index.html;

    location /postfixadmin {
        alias /var/www/postfixadmin/public;
        index index.php;
        try_files \$uri \$uri/ /postfixadmin/public/index.php;
    }

    location ~ ^/postfixadmin/(.+\.php)$ {
        alias /var/www/postfixadmin/public/\$1;
        fastcgi_pass unix:${PHP_SOCK};
        fastcgi_index index.php;
        include fastcgi_params;
        fastcgi_param SCRIPT_FILENAME \$request_filename;
    }
}
EOF

rm -f /etc/nginx/sites-enabled/default
ln -sf /etc/nginx/sites-available/mailserver.conf /etc/nginx/sites-enabled/mailserver.conf

systemctl restart nginx

# 5. Initialize the Database
echo -e "Initializing PostfixAdmin Database tables..."
# upgrade.php is natively idempotent; it just checks if tables exist and updates them!
sudo -u www-data php /var/www/postfixadmin/public/upgrade.php

echo -e "${GREEN}PostfixAdmin setup complete!${NC}"

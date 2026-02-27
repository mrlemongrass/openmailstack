#!/usr/bin/env bash

# Exit on error
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m'

echo -e "${YELLOW}Starting PostfixAdmin Installation...${NC}"

# Source the configuration file
source ./config.conf

# 1. Download and Extract PostfixAdmin
# We use a stable release to ensure reliability
PFA_VERSION="3.3.13"
echo -e "Downloading PostfixAdmin version ${PFA_VERSION}..."
cd /tmp
wget -q -O postfixadmin.tar.gz "https://github.com/postfixadmin/postfixadmin/archive/refs/tags/postfixadmin-${PFA_VERSION}.tar.gz"

echo -e "Extracting to /var/www/postfixadmin..."
tar -xzf postfixadmin.tar.gz
# Remove old directory if it exists (for idempotency)
rm -rf /var/www/postfixadmin
mv postfixadmin-postfixadmin-${PFA_VERSION} /var/www/postfixadmin

# Create the templates_c directory and set permissions
mkdir -p /var/www/postfixadmin/templates_c
chown -R www-data:www-data /var/www/postfixadmin
chmod -R 755 /var/www/postfixadmin

# 2. Generate Setup Password Hash
echo -e "Generating secure setup password hash..."
# We use PHP to generate the hash exactly as PostfixAdmin expects it
SETUP_HASH=$(php -r "echo password_hash('${POSTFIXADMIN_SETUP_PASSWORD}', PASSWORD_DEFAULT);")

# 3. Create config.local.php
echo -e "Configuring PostfixAdmin database connections..."
cat <<EOF > /var/www/postfixadmin/config.local.php
<?php
\$CONF['configured'] = true;

// Database Connection
\$CONF['database_type'] = 'mysqli';
\$CONF['database_host'] = 'localhost';
\$CONF['database_user'] = '${POSTFIXADMIN_DB_USER}';
\$CONF['database_password'] = '${POSTFIXADMIN_DB_PASSWORD}';
\$CONF['database_name'] = '${POSTFIXADMIN_DB_NAME}';

// Security and Setup
\$CONF['setup_password'] = '${SETUP_HASH}';

// Mail Server Settings
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

# Ensure secure permissions on the config file
chown www-data:www-data /var/www/postfixadmin/config.local.php
chmod 640 /var/www/postfixadmin/config.local.php

# 4. Configure Nginx
echo -e "Configuring Nginx for PostfixAdmin..."
# We will create a base Nginx config. SSL will be added later in 07_security.sh
cat <<EOF > /etc/nginx/sites-available/mailserver.conf
server {
    listen 80;
    server_name ${MAIL_HOSTNAME};
    root /var/www/html;
    index index.php index.html;

    # PostfixAdmin Alias
    location /postfixadmin {
        alias /var/www/postfixadmin/public;
        index index.php;
        try_files \$uri \$uri/ /postfixadmin/public/index.php;
    }

    # Handle PHP execution for PostfixAdmin
    location ~ ^/postfixadmin/(.+\.php)$ {
        alias /var/www/postfixadmin/public/\$1;
        fastcgi_pass unix:/run/php/php-fpm.sock;
        fastcgi_index index.php;
        include fastcgi_params;
        fastcgi_param SCRIPT_FILENAME \$request_filename;
    }
}
EOF

# Link Nginx config and restart
rm -f /etc/nginx/sites-enabled/default
ln -sf /etc/nginx/sites-available/mailserver.conf /etc/nginx/sites-enabled/mailserver.conf

# Find correct PHP-FPM socket
PHP_SOCK=\$(find /run/php -name "php*-fpm.sock" | head -n 1)
sed -i "s|unix:/run/php/php-fpm.sock|unix:\$PHP_SOCK|g" /etc/nginx/sites-available/mailserver.conf

systemctl restart nginx

# 5. Initialize the Database
echo -e "Initializing PostfixAdmin Database tables..."
# Run the upgrade script via CLI to create the DB schema automatically
sudo -u www-data php /var/www/postfixadmin/public/upgrade.php

echo -e "${GREEN}PostfixAdmin setup complete!${NC}"

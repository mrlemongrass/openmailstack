#!/usr/bin/env bash

# Exit on error
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m'

echo -e "${YELLOW}Starting Roundcube Webmail Installation...${NC}"

# Source the configuration file
source ./config.conf

# 1. Download and Extract Roundcube
# We use the 'complete' package of the 1.6.x stable branch
RC_VERSION="1.6.9"
echo -e "Downloading Roundcube version ${RC_VERSION}..."
cd /tmp
wget -q -O roundcube.tar.gz "https://github.com/roundcube/roundcubemail/releases/download/${RC_VERSION}/roundcubemail-${RC_VERSION}-complete.tar.gz"

echo -e "Extracting to /var/www/roundcube..."
tar -xzf roundcube.tar.gz
rm -rf /var/www/roundcube
mv roundcubemail-${RC_VERSION} /var/www/roundcube

# Set proper ownership and permissions
chown -R www-data:www-data /var/www/roundcube
chmod -R 755 /var/www/roundcube

# 2. Initialize the Roundcube Database
echo -e "Importing Roundcube database schema..."
mysql -u root -p"${DB_ROOT_PASSWORD}" "${ROUNDCUBE_DB_NAME}" < /var/www/roundcube/SQL/mysql.initial.sql

# 3. Configure Roundcube
echo -e "Generating Roundcube configuration..."
# Generate a random 24-character DES key for session encryption
DES_KEY=$(cat /dev/urandom | tr -dc 'a-zA-Z0-9' | fold -w 24 | head -n 1)

cat <<EOF > /var/www/roundcube/config/config.inc.php
<?php
\$config = [];

// Database Connection
\$config['db_dsnw'] = 'mysql://${ROUNDCUBE_DB_USER}:${ROUNDCUBE_DB_PASSWORD}@localhost/${ROUNDCUBE_DB_NAME}';

// IMAP Settings (Talking to Dovecot)
\$config['imap_host'] = 'localhost:143';
\$config['imap_auth_type'] = 'PLAIN';

// SMTP Settings (Talking to Postfix)
\$config['smtp_host'] = 'localhost:587';
\$config['smtp_user'] = '%u';
\$config['smtp_pass'] = '%p';
\$config['smtp_auth_type'] = 'LOGIN';

// System Settings
\$config['support_url'] = '';
\$config['des_key'] = '${DES_KEY}';
\$config['plugins'] = ['archive', 'zipdownload', 'markasjunk'];
\$config['skin'] = 'elastic'; // The modern, mobile-responsive theme

// Hide the server/host input on the login screen
\$config['auto_create_user'] = true;
EOF

# Secure the config file
chown www-data:www-data /var/www/roundcube/config/config.inc.php
chmod 640 /var/www/roundcube/config/config.inc.php

# Clean up the installer directory for security
rm -rf /var/www/roundcube/installer

# 4. Update Nginx Configuration
echo -e "Adding /webmail alias to Nginx..."

# We inject the Roundcube location blocks into the existing mailserver.conf right before the final closing brace.
sed -i '/^}/i \
    # Roundcube Webmail Alias\
    location /webmail {\
        alias /var/www/roundcube;\
        index index.php;\
        try_files $uri $uri/ /webmail/index.php?$query_string;\
    }\
\
    location ~ ^/webmail/(.+\\.php)$ {\
        alias /var/www/roundcube/$1;\
        fastcgi_pass unix:/run/php/php-fpm.sock;\
        fastcgi_index index.php;\
        include fastcgi_params;\
        fastcgi_param SCRIPT_FILENAME $request_filename;\
    }\
\
    # Block access to Roundcube hidden/internal directories\
    location ~ ^/webmail/(bin|config|temp|logs)/ {\
        deny all;\
    }\
' /etc/nginx/sites-available/mailserver.conf

# Find correct PHP-FPM socket and update the new block
PHP_SOCK=$(find /run/php -name "php*-fpm.sock" | head -n 1)
sed -i "s|fastcgi_pass unix:/run/php/php-fpm.sock;|fastcgi_pass unix:${PHP_SOCK};|g" /etc/nginx/sites-available/mailserver.conf

systemctl restart nginx

echo -e "${GREEN}Roundcube setup complete!${NC}"

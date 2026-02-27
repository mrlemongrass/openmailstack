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

echo -e "${YELLOW}Starting Roundcube Webmail Installation...${NC}"

# Source the configuration file
source ./config.conf

# 1. Download and Extract Roundcube
RC_VERSION="1.6.9"
echo -e "Downloading Roundcube version ${RC_VERSION}..."
cd /tmp
wget -q -O roundcube.tar.gz "https://github.com/roundcube/roundcubemail/releases/download/${RC_VERSION}/roundcubemail-${RC_VERSION}-complete.tar.gz"

echo -e "Extracting to /var/www/roundcube..."
tar -xzf roundcube.tar.gz
# Removing the directory first ensures a clean, idempotent overwrite
rm -rf /var/www/roundcube
mv roundcubemail-${RC_VERSION} /var/www/roundcube
chown -R www-data:www-data /var/www/roundcube
chmod -R 755 /var/www/roundcube

# 2. Initialize the Roundcube Database (Guarded)
echo -e "Importing Roundcube database schema..."
# Check if the 'users' table exists. If not, import the schema.
if ! mysql -e "SELECT 1 FROM ${ROUNDCUBE_DB_NAME}.users LIMIT 1;" &>/dev/null; then
    mysql "${ROUNDCUBE_DB_NAME}" < /var/www/roundcube/SQL/mysql.initial.sql
    echo -e "Database initialized."
else
    echo -e "Database already initialized, skipping."
fi

# 3. Configure Roundcube
echo -e "Generating Roundcube configuration..."
# FIX: Use openssl rand to generate exactly 12 bytes (24 hex characters). 
# This avoids the SIGPIPE error caused by cat /dev/urandom.
DES_KEY=$(openssl rand -hex 12)

cat <<EOF > /var/www/roundcube/config/config.inc.php
<?php
\$config = [];
\$config['db_dsnw'] = 'mysql://${ROUNDCUBE_DB_USER}:${ROUNDCUBE_DB_PASSWORD}@localhost/${ROUNDCUBE_DB_NAME}';
\$config['imap_host'] = 'localhost:143';
\$config['imap_auth_type'] = 'PLAIN';
\$config['smtp_host'] = 'localhost:587';
\$config['smtp_user'] = '%u';
\$config['smtp_pass'] = '%p';
\$config['smtp_auth_type'] = 'LOGIN';
\$config['support_url'] = '';
\$config['des_key'] = '${DES_KEY}';
\$config['plugins'] = ['archive', 'zipdownload', 'markasjunk'];
\$config['skin'] = 'elastic';
\$config['auto_create_user'] = true;
EOF

chown www-data:www-data /var/www/roundcube/config/config.inc.php
chmod 640 /var/www/roundcube/config/config.inc.php
rm -rf /var/www/roundcube/installer

# 4. Update Nginx Configuration (Guarded)
echo -e "Adding /webmail alias to Nginx..."
PHP_SOCK=$(find /run/php -name "php*-fpm.sock" | head -n 1)

if ! grep -q "# --- OpenMailStack Roundcube ---" /etc/nginx/sites-available/mailserver.conf; then
# Inject the config right before the final closing brace '}'
sed -i '/^}/i \
    # --- OpenMailStack Roundcube ---\
    location /webmail {\
        alias /var/www/roundcube;\
        index index.php;\
        try_files $uri $uri/ /webmail/index.php?$query_string;\
    }\
    location ~ ^/webmail/(.+\\.php)$ {\
        alias /var/www/roundcube/$1;\
        fastcgi_pass unix:'"${PHP_SOCK}"';\
        fastcgi_index index.php;\
        include fastcgi_params;\
        fastcgi_param SCRIPT_FILENAME $request_filename;\
    }\
    location ~ ^/webmail/(bin|config|temp|logs)/ {\
        deny all;\
    }\
' /etc/nginx/sites-available/mailserver.conf
fi

systemctl restart nginx
echo -e "${GREEN}Roundcube setup complete!${NC}"

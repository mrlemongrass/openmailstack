#!/bin/bash
set -e

echo "Starting OpenMailStack Upgrade..."

# Ensure we are operating in the repo directory
REPO_DIR="/root/openmailstack"
if [[ ! -d "${REPO_DIR}/.git" ]]; then
    echo "Error: ${REPO_DIR} is not a valid git repository."
    exit 1
fi

cd "${REPO_DIR}"

# Stash any local modifications to tracked files just in case
git stash || true

# Fetch tags and checkout the requested version, or pull main
if [[ -n "$1" ]]; then
    echo "Upgrading to specific version/tag: $1"
    git fetch --tags origin
    git checkout "$1"
else
    echo "Pulling latest changes from main..."
    git checkout main
    git pull origin main
fi

# 1. Update the Admin Portal files
echo "Deploying Admin Portal updates..."
cp -r "${REPO_DIR}/admin_portal_src/public/"* /var/www/openmailstack-admin/
cp "${REPO_DIR}/VERSION" /var/www/openmailstack-admin/VERSION

# Ensure permissions
chown -R www-data:www-data /var/www/openmailstack-admin/

# 2. Restart services if necessary
echo "Restarting Nginx and PHP-FPM..."
systemctl restart nginx php*-fpm || true

# Update the sudoers script itself in case it changed in the repo
cp "${REPO_DIR}/upgrade.sh" /usr/local/bin/openmailstack-upgrade.sh
chmod +x /usr/local/bin/openmailstack-upgrade.sh

echo "Upgrade Complete!"

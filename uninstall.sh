#!/usr/bin/env bash

# ==============================================================================
# Strict Bash Mode
# ==============================================================================
set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m'

echo -e "${RED}======================================================================${NC}"
echo -e "${RED} OpenMailStack Uninstaller                                            ${NC}"
echo -e "${RED}======================================================================${NC}"

# 1. Root Check
if [[ $EUID -ne 0 ]]; then
   echo -e "${RED}Error: This script must be run as root.${NC}" 
   exit 1
fi

echo -e "${YELLOW}WARNING: This will permanently destroy all mailboxes, databases, and web files!${NC}"
read -p "Are you absolutely sure you want to completely remove OpenMailStack? [y/N]: " CONFIRM

if [[ ! "$CONFIRM" =~ ^[Yy]$ ]]; then
    echo -e "${GREEN}Uninstall cancelled. Your server is safe.${NC}"
    exit 0
fi

echo -e "\nStarting teardown..."

# 2. Stop All Services
echo -e "Stopping all mail and web services..."
systemctl stop nginx mariadb postfix dovecot redis-server rspamd clamav-daemon clamav-freshclam fail2ban 2>/dev/null || true
# Catch whichever version of PHP FPM is running
systemctl stop php*-fpm 2>/dev/null || true

# 3. Disable UFW Firewall
echo -e "Disabling UFW Firewall..."
ufw --force disable 2>/dev/null || true

# 4. Purge Packages
echo -e "Purging installed packages (this may take a minute)..."
export DEBIAN_FRONTEND=noninteractive
apt-get purge -y -qq \
    nginx nginx-common \
    mariadb-server mariadb-client \
    postfix postfix-mysql \
    dovecot-core dovecot-imapd dovecot-pop3d dovecot-lmtpd dovecot-mysql \
    rspamd redis-server redis-tools clamav clamav-daemon clamav-freshclam \
    certbot python3-certbot-nginx ufw fail2ban \
    php-fpm php-mysql php-cli php-mbstring php-intl php-xml php-curl php-zip php-gd php-bz2 php-common \
    2>/dev/null || true

echo -e "Cleaning up unused dependencies..."
apt-get autoremove -y -qq
apt-get clean

# 5. Remove Configurations and Web Roots
echo -e "Deleting configurations, certificates, and web files..."
rm -rf /etc/postfix
rm -rf /etc/dovecot
rm -rf /var/www/postfixadmin
rm -rf /var/www/roundcube
rm -rf /etc/nginx/sites-available/mailserver.conf
rm -rf /etc/nginx/sites-enabled/mailserver.conf
rm -rf /etc/rspamd
rm -rf /var/lib/rspamd
rm -rf /etc/fail2ban/jail.local
rm -rf /etc/ssl/openmailstack
rm -rf /etc/letsencrypt/live/*
rm -rf /etc/letsencrypt/archive/*
rm -rf /etc/letsencrypt/renewal/*

# 6. Destroy Databases
echo -e "Destroying MariaDB databases..."
rm -rf /var/lib/mysql

# 7. Remove Vmail User and Physical Mailboxes
echo -e "Removing vmail user and physical mail data..."
if id "vmail" &>/dev/null; then
    userdel -f vmail
fi
rm -rf /var/vmail

echo -e "${GREEN}Uninstall complete! The system has been returned to a clean slate.${NC}"
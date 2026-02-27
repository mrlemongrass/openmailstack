#!/usr/bin/env bash

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m'

echo -e "${RED}===============================================================${NC}"
echo -e "${RED} WARNING: TOTAL SYSTEM WIPE INITIATED                          ${NC}"
echo -e "${RED}===============================================================${NC}"
echo -e "This script will completely remove OpenMailStack from your server."
echo -e "It will DELETE all databases, web files, configurations, and"
echo -e "${YELLOW}EVERY SINGLE EMAIL STORED IN /var/vmail.${NC}"
echo ""

# Ensure script is run as root
if [[ $EUID -ne 0 ]]; then
   echo -e "${RED}Error: This script must be run as root.${NC}" 
   exit 1
fi

read -p "Are you absolutely sure you want to destroy this mail server? (Type 'YES' to continue): " CONFIRM_WIPE

if [[ "$CONFIRM_WIPE" != "YES" ]]; then
    echo -e "${GREEN}Phew! Uninstall aborted. Your server is safe.${NC}"
    exit 0
fi

echo -e "${YELLOW}Stopping services...${NC}"
systemctl stop postfix dovecot nginx mariadb rspamd redis-server clamav-daemon fail2ban php*-fpm || true

echo -e "${YELLOW}Purging installed packages...${NC}"
export DEBIAN_FRONTEND=noninteractive
apt-get purge -y -qq \
    postfix postfix-mysql \
    dovecot-core dovecot-imapd dovecot-pop3d dovecot-lmtpd dovecot-mysql \
    mariadb-server \
    nginx \
    php-fpm php-mysql php-cli php-mbstring php-imap php-intl php-xml php-curl php-zip php-gd php-bz2 \
    rspamd redis-server clamav-daemon clamav-freshclam \
    certbot python3-certbot-nginx ufw fail2ban

echo -e "${YELLOW}Cleaning up unused dependencies...${NC}"
apt-get autoremove -y -qq

echo -e "${YELLOW}Deleting configuration and data directories...${NC}"
# Remove web roots
rm -rf /var/www/postfixadmin
rm -rf /var/www/roundcube
# Remove mail storage
rm -rf /var/vmail
# Remove databases
rm -rf /var/lib/mysql
# Remove configurations
rm -rf /etc/postfix
rm -rf /etc/dovecot
rm -rf /etc/rspamd
rm -rf /var/lib/rspamd
# Note: We do NOT delete /etc/letsencrypt. Let's Encrypt has strict rate limits. 
# If a user wipes their server 5 times in an hour and deletes the certs, Let's Encrypt will block them for a week.

echo -e "${YELLOW}Removing local vmail user and group...${NC}"
userdel vmail || true
groupdel vmail || true

# Reset UFW to prevent getting locked out of SSH if it was enabled
echo -e "${YELLOW}Resetting UFW firewall...${NC}"
ufw --force reset || true
ufw allow 22/tcp || true

echo -e "${GREEN}===============================================================${NC}"
echo -e "${GREEN} Uninstall Complete. The server has been wiped clean.          ${NC}"
echo -e "${GREEN}===============================================================${NC}"

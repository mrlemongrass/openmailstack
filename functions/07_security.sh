#!/usr/bin/env bash

# Exit on error
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m'

echo -e "${YELLOW}Starting Security Configuration (SSL, Firewall, Fail2ban)...${NC}"

# Source the configuration file
source ./config.conf

export DEBIAN_FRONTEND=noninteractive

# 1. Install Security Packages
echo -e "Installing Certbot, UFW, and Fail2ban..."
apt-get install -y -qq certbot python3-certbot-nginx ufw fail2ban

# 2. Request SSL Certificate
# CRITICAL NOTE: This will fail if the DNS A record for MAIL_HOSTNAME doesn't point to this server!
echo -e "Requesting Let's Encrypt SSL Certificate for ${MAIL_HOSTNAME}..."
certbot --nginx --non-interactive --agree-tos --email "${LETSENCRYPT_EMAIL}" -d "${MAIL_HOSTNAME}"

# 3. Apply SSL to Postfix
echo -e "Securing Postfix with SSL/TLS..."
postconf -e "smtpd_tls_cert_file = /etc/letsencrypt/live/${MAIL_HOSTNAME}/fullchain.pem"
postconf -e "smtpd_tls_key_file = /etc/letsencrypt/live/${MAIL_HOSTNAME}/privkey.pem"
postconf -e "smtpd_use_tls = yes"
postconf -e "smtp_tls_security_level = may"
postconf -e "smtpd_tls_security_level = may"
postconf -e "smtpd_tls_auth_only = yes" # Force encryption before allowing login

# 4. Apply SSL to Dovecot
echo -e "Securing Dovecot with SSL/TLS..."
cat <<EOF >> /etc/dovecot/local.conf

# SSL Configuration (Appended by Security Script)
ssl = required
ssl_cert = </etc/letsencrypt/live/${MAIL_HOSTNAME}/fullchain.pem
ssl_key = </etc/letsencrypt/live/${MAIL_HOSTNAME}/privkey.pem
EOF

# 5. Configure the Firewall (UFW)
echo -e "Configuring UFW Firewall..."
# Default policies
ufw default deny incoming
ufw default allow outgoing

# Allow necessary ports
ufw allow 22/tcp      # SSH
ufw allow 80/tcp      # HTTP (Needed for Let's Encrypt renewals)
ufw allow 443/tcp     # HTTPS (Webmail and Admin)
ufw allow 25/tcp      # SMTP (Server to Server)
ufw allow 587/tcp     # Message Submission (Client to Server)
ufw allow 993/tcp     # IMAPS (Reading mail securely)
ufw allow 995/tcp     # POP3S (Legacy secure mail dropping)

# Force enable UFW without the interactive prompt
echo "y" | ufw enable

# 6. Configure Fail2ban
echo -e "Configuring Fail2ban..."
cat <<EOF > /etc/fail2ban/jail.local
[DEFAULT]
bantime = 1h
findtime = 10m
maxretry = 5

[sshd]
enabled = true

[postfix]
enabled = true
port = smtp,465,submission
logpath = /var/log/mail.log

[dovecot]
enabled = true
port = pop3,pop3s,imap,imaps,submission
logpath = /var/log/mail.log
EOF

# 7. Restart Services
echo -e "Restarting all services to apply security settings..."
systemctl restart nginx
systemctl restart postfix
systemctl restart dovecot
systemctl enable fail2ban
systemctl restart fail2ban

echo -e "${GREEN}Security setup complete! Your server is now encrypted and protected.${NC}"

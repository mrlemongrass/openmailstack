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

echo -e "${YELLOW}Starting Security Configuration (SSL, Firewall, Fail2ban)...${NC}"

# Source the configuration file
source ./config.conf

export DEBIAN_FRONTEND=noninteractive

# 1. Install Security Packages
echo -e "Installing Certbot, UFW, and Fail2ban..."
apt-get install -y -qq certbot python3-certbot-nginx ufw fail2ban

# 2. Request SSL Certificate (Guarded against rate limits)
# If the user re-runs the script, we DO NOT want to spam Let's Encrypt APIs.
if [[ ! -d "/etc/letsencrypt/live/${MAIL_HOSTNAME}" ]]; then
    echo -e "Requesting Let's Encrypt SSL Certificate for ${MAIL_HOSTNAME}..."
    certbot --nginx --non-interactive --agree-tos --email "${LETSENCRYPT_EMAIL}" -d "${MAIL_HOSTNAME}"
else
    echo -e "${GREEN}SSL Certificate for ${MAIL_HOSTNAME} already exists. Skipping Certbot.${NC}"
fi

# Ensure the Certbot auto-renewal timer is enabled and active
systemctl enable --now certbot.timer

# 3. Apply SSL to Postfix & Tighten TLS Protocols
echo -e "Securing Postfix with modern SSL/TLS..."
postconf -e "smtpd_tls_cert_file = /etc/letsencrypt/live/${MAIL_HOSTNAME}/fullchain.pem"
postconf -e "smtpd_tls_key_file = /etc/letsencrypt/live/${MAIL_HOSTNAME}/privkey.pem"
postconf -e "smtpd_use_tls = yes"
postconf -e "smtp_tls_security_level = may"
postconf -e "smtpd_tls_security_level = may"
postconf -e "smtpd_tls_auth_only = yes"
# Force modern protocols for incoming mail clients (drops old SSL/TLS vulnerabilities)
postconf -e "smtpd_tls_mandatory_protocols = !SSLv2, !SSLv3, !TLSv1, !TLSv1.1"

# 4. Apply SSL to Dovecot (Guarded append)
echo -e "Securing Dovecot with SSL/TLS..."
if ! grep -q "ssl_cert = </etc/letsencrypt" /etc/dovecot/local.conf; then
cat <<EOF >> /etc/dovecot/local.conf

# --- OpenMailStack SSL ---
ssl = required
ssl_cert = </etc/letsencrypt/live/${MAIL_HOSTNAME}/fullchain.pem
ssl_key = </etc/letsencrypt/live/${MAIL_HOSTNAME}/privkey.pem
EOF
fi

# 5. Configure the Firewall (UFW)
echo -e "Configuring UFW Firewall..."
ufw default deny incoming
ufw default allow outgoing

# Allow necessary ports safely
ufw allow 22/tcp      # SSH
ufw allow 80/tcp      # HTTP
ufw allow 443/tcp     # HTTPS
ufw allow 25/tcp      # SMTP
ufw allow 587/tcp     # Message Submission
ufw allow 993/tcp     # IMAPS
ufw allow 995/tcp     # POP3S

# Enable UFW non-interactively
ufw --force enable

# 6. Configure Fail2ban (Idempotent overwrite)
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
systemctl restart nginx postfix dovecot
systemctl enable --now fail2ban

echo -e "${GREEN}Security setup complete! Your server is now encrypted and protected.${NC}"

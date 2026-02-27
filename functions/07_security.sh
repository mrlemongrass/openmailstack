#!/usr/bin/env bash

# ==============================================================================
# Strict Bash Mode
# ==============================================================================
set -euo pipefail
trap 'echo -e "\033[0;31mERROR in ${BASH_SOURCE[0]} at line ${LINENO}: ${BASH_COMMAND}\033[0m" >&2' ERR

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${YELLOW}Starting Security Configuration (SSL, Firewall, Fail2ban)...${NC}"

# Source the configuration file
source ./config.conf

export DEBIAN_FRONTEND=noninteractive

# 1. Install Security Packages
echo -e "Installing Certbot, UFW, and Fail2ban..."
apt-get install -y -qq certbot python3-certbot-nginx ufw fail2ban openssl

# 2. SSL Certificate Strategy (Interactive Prompt)
echo -e "\n${CYAN}======================================================================${NC}"
echo -e "${CYAN} SSL Certificate Configuration                                        ${NC}"
echo -e "${CYAN}======================================================================${NC}"
echo -e "Let's Encrypt requires a public IP and valid DNS A-record to succeed."
echo -e "If you are testing locally (e.g., in a VM), Let's Encrypt will fail."
echo ""
read -p "Use (L)et's Encrypt or (S)elf-Signed cert for local testing? [L/s]: " CERT_CHOICE
CERT_CHOICE=${CERT_CHOICE:-L}

if [[ "$CERT_CHOICE" =~ ^[Ss]$ ]]; then
    echo -e "\n${YELLOW}Generating Self-Signed Certificate for local testing...${NC}"
    mkdir -p /etc/ssl/openmailstack
    
    # Generate a dummy cert valid for 1 year
    openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
        -keyout /etc/ssl/openmailstack/privkey.pem \
        -out /etc/ssl/openmailstack/fullchain.pem \
        -subj "/C=US/ST=Test/L=Test/O=OpenMailStack/CN=${MAIL_HOSTNAME}" 2>/dev/null
    
    CERT_FILE="/etc/ssl/openmailstack/fullchain.pem"
    KEY_FILE="/etc/ssl/openmailstack/privkey.pem"
    
    echo -e "${YELLOW}Notice: Web interfaces (Nginx) will remain on HTTP for local testing.${NC}"
    echo -e "${YELLOW}Postfix and Dovecot will use the self-signed cert for IMAP/SMTP encryption.${NC}"
    echo -e "${YELLOW}To upgrade to a real cert later, ensure you have a public IP and re-run this script.${NC}"
else
    echo -e "\n${GREEN}Requesting Let's Encrypt SSL Certificate for ${MAIL_HOSTNAME}...${NC}"
    
    if [[ ! -d "/etc/letsencrypt/live/${MAIL_HOSTNAME}" ]]; then
        certbot --nginx --non-interactive --agree-tos --email "${LETSENCRYPT_EMAIL}" -d "${MAIL_HOSTNAME}"
    else
        echo -e "${GREEN}SSL Certificate for ${MAIL_HOSTNAME} already exists. Skipping Certbot.${NC}"
    fi
    
    systemctl enable --now certbot.timer
    
    CERT_FILE="/etc/letsencrypt/live/${MAIL_HOSTNAME}/fullchain.pem"
    KEY_FILE="/etc/letsencrypt/live/${MAIL_HOSTNAME}/privkey.pem"
fi

# 3. Apply SSL to Postfix & Tighten TLS Protocols
echo -e "\nSecuring Postfix with modern SSL/TLS..."
# Because postconf overwrites existing values natively, it seamlessly 
# switches between self-signed and Let's Encrypt paths if re-run!
postconf -e "smtpd_tls_cert_file = ${CERT_FILE}"
postconf -e "smtpd_tls_key_file = ${KEY_FILE}"
postconf -e "smtpd_use_tls = yes"
postconf -e "smtp_tls_security_level = may"
postconf -e "smtpd_tls_security_level = may"
postconf -e "smtpd_tls_auth_only = yes"
postconf -e "smtpd_tls_mandatory_protocols = !SSLv2, !SSLv3, !TLSv1, !TLSv1.1"

# 4. Apply SSL to Dovecot (Clean replacement strategy)
echo -e "Securing Dovecot with SSL/TLS..."
# First, we delete any existing OpenMailStack SSL blocks to prevent duplicates
sed -i '/^# --- OpenMailStack SSL ---/d' /etc/dovecot/local.conf || true
sed -i '/^ssl = required/d' /etc/dovecot/local.conf || true
sed -i '/^ssl_cert =/d' /etc/dovecot/local.conf || true
sed -i '/^ssl_key =/d' /etc/dovecot/local.conf || true

# Now we append the correct paths based on the user's choice
cat <<EOF >> /etc/dovecot/local.conf
# --- OpenMailStack SSL ---
ssl = required
ssl_cert = <${CERT_FILE}
ssl_key = <${KEY_FILE}
EOF

# 5. Configure the Firewall (UFW)
echo -e "Configuring UFW Firewall..."
ufw default deny incoming
ufw default allow outgoing

# Allow necessary ports
ufw allow 22/tcp      # SSH
ufw allow 80/tcp      # HTTP
ufw allow 443/tcp     # HTTPS
ufw allow 25/tcp      # SMTP
ufw allow 587/tcp     # Message Submission
ufw allow 993/tcp     # IMAPS
ufw allow 995/tcp     # POP3S

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

echo -e "${GREEN}Security setup complete!${NC}"
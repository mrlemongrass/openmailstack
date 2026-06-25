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
SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
source "${SCRIPT_DIR}/lib_os.sh"
detect_openmailstack_os

export DEBIAN_FRONTEND=noninteractive

# 1. Install Security Packages
echo -e "Installing Certbot, UFW, and Fail2ban..."
openmailstack_install_required_packages openssl
openmailstack_install_optional_packages certbot python3-certbot-nginx ufw fail2ban

SEC_HAS_CERTBOT=0
SEC_HAS_CERTBOT_NGINX=0
SEC_HAS_UFW=0
SEC_HAS_FAIL2BAN=0

if openmailstack_package_installed "certbot"; then SEC_HAS_CERTBOT=1; fi
if openmailstack_package_installed "python3-certbot-nginx"; then SEC_HAS_CERTBOT_NGINX=1; fi
if openmailstack_package_installed "ufw"; then SEC_HAS_UFW=1; fi
if openmailstack_package_installed "fail2ban"; then SEC_HAS_FAIL2BAN=1; fi

CERT_FILE=""
KEY_FILE=""
LE_CERT_DIR="/etc/letsencrypt/live/${MAIL_HOSTNAME}"

generate_self_signed_cert() {
    echo -e "\n${YELLOW}Generating Self-Signed Certificate for local testing...${NC}"
    mkdir -p /etc/ssl/openmailstack

    openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
        -keyout /etc/ssl/openmailstack/privkey.pem \
        -out /etc/ssl/openmailstack/fullchain.pem \
        -subj "/C=US/ST=Test/L=Test/O=OpenMailStack/CN=${MAIL_HOSTNAME}" 2>/dev/null

    CERT_FILE="/etc/ssl/openmailstack/fullchain.pem"
    KEY_FILE="/etc/ssl/openmailstack/privkey.pem"
}

# Ensure the main Nginx vhost always serves HTTPS with the selected certificate.
configure_nginx_tls() {
    local nginx_conf="/etc/nginx/sites-available/mailserver.conf"
    local tmp_conf

    if [[ ! -f "${nginx_conf}" ]]; then
        openmailstack_record_soft_error "Nginx vhost ${nginx_conf} is missing; skipping HTTPS vhost update."
        return 0
    fi

    if grep -Eq '^[[:space:]]*listen[[:space:]]+443[[:space:]]+ssl;' "${nginx_conf}"; then
        return 0
    fi

    tmp_conf=$(mktemp)
    if ! awk -v cert="${CERT_FILE}" -v key="${KEY_FILE}" '
        BEGIN { inserted=0; skip=0; }
        $0 ~ /# --- OpenMailStack TLS ---/ { skip=1; next; }
        skip && $0 ~ /# --- End OpenMailStack TLS ---/ { skip=0; next; }
        skip { next; }
        {
            print;
            if (inserted == 0 && $0 ~ /^[[:space:]]*listen[[:space:]]+80;/) {
                print "    # --- OpenMailStack TLS ---";
                print "    listen 443 ssl;";
                print "    ssl_certificate " cert ";";
                print "    ssl_certificate_key " key ";";
                print "    # --- End OpenMailStack TLS ---";
                inserted=1;
            }
        }
        END {
            if (inserted == 0) {
                exit 2;
            }
        }
    ' "${nginx_conf}" > "${tmp_conf}"; then
        rm -f "${tmp_conf}"
        openmailstack_record_soft_error "Failed to inject TLS directives into ${nginx_conf}; keeping existing Nginx configuration."
        return 0
    fi

    install -m 644 "${tmp_conf}" "${nginx_conf}"
    rm -f "${tmp_conf}"
}

request_letsencrypt_cert() {
    if [[ -f "${LE_CERT_DIR}/fullchain.pem" && -f "${LE_CERT_DIR}/privkey.pem" ]]; then
        return 0
    fi

    if [[ "${SEC_HAS_CERTBOT}" -eq 0 || "${SEC_HAS_CERTBOT_NGINX}" -eq 0 ]]; then
        return 1
    fi

    certbot certonly --nginx --non-interactive --agree-tos --email "${LETSENCRYPT_EMAIL}" -d "${MAIL_HOSTNAME}"

    [[ -f "${LE_CERT_DIR}/fullchain.pem" && -f "${LE_CERT_DIR}/privkey.pem" ]]
}

enable_certbot_timer_if_available() {
    if [[ "${SEC_HAS_CERTBOT}" -eq 1 ]]; then
        systemctl enable --now certbot.timer || openmailstack_record_soft_error "Failed to enable certbot.timer; certificate renewal may require manual intervention."
    else
        openmailstack_record_soft_error "Let's Encrypt certificate exists but certbot is not installed; automatic renewal is unavailable."
    fi
}

# 2. SSL Certificate Strategy (Non-interactive)
SSL_CERT_MODE="${SSL_CERT_MODE:-auto}"
SSL_CERT_MODE="${SSL_CERT_MODE,,}"
echo -e "Using SSL certificate mode: ${SSL_CERT_MODE}"

case "${SSL_CERT_MODE}" in
    self-signed)
        generate_self_signed_cert
        ;;
    letsencrypt)
        echo -e "\n${GREEN}Requesting Let's Encrypt SSL Certificate for ${MAIL_HOSTNAME}...${NC}"
        if ! request_letsencrypt_cert; then
            echo -e "\033[0;31mError: SSL_CERT_MODE=letsencrypt but certificate request failed for ${MAIL_HOSTNAME}.\033[0m" >&2
            echo -e "\033[0;31mEnsure DNS A-record points to this host and certbot packages are available.\033[0m" >&2
            exit 1
        fi
        enable_certbot_timer_if_available
        CERT_FILE="${LE_CERT_DIR}/fullchain.pem"
        KEY_FILE="${LE_CERT_DIR}/privkey.pem"
        ;;
    auto)
        if request_letsencrypt_cert; then
            echo -e "${GREEN}Using Let's Encrypt certificate for ${MAIL_HOSTNAME}.${NC}"
            enable_certbot_timer_if_available
            CERT_FILE="${LE_CERT_DIR}/fullchain.pem"
            KEY_FILE="${LE_CERT_DIR}/privkey.pem"
        else
            openmailstack_record_soft_error "Let's Encrypt is unavailable or failed for ${MAIL_HOSTNAME}; falling back to self-signed certificate."
            generate_self_signed_cert
        fi
        ;;
    *)
        echo -e "\033[0;31mError: Invalid SSL_CERT_MODE='${SSL_CERT_MODE}'. Expected auto, letsencrypt, or self-signed.\033[0m" >&2
        exit 1
        ;;
esac

# 3. Apply HTTPS certificate to Nginx
echo -e "Configuring Nginx HTTPS listener..."
configure_nginx_tls
if command -v nginx >/dev/null 2>&1; then
    nginx -t
fi

# 4. Apply SSL to Postfix
echo -e "\nSecuring Postfix with modern SSL/TLS..."
postconf -e "smtpd_tls_cert_file = ${CERT_FILE}"
postconf -e "smtpd_tls_key_file = ${KEY_FILE}"
postconf -e "smtpd_use_tls = yes"
postconf -e "smtp_tls_security_level = may"
postconf -e "smtpd_tls_security_level = may"
postconf -e "smtpd_tls_auth_only = yes"
postconf -e "smtpd_tls_mandatory_protocols = !SSLv2, !SSLv3, !TLSv1, !TLSv1.1"

# 5. Apply SSL to Dovecot (Clean replacement strategy)
echo -e "Securing Dovecot with SSL/TLS..."
DOVECOT_VERSION=$(dovecot --version 2>/dev/null | grep -oE '^[0-9]+\.[0-9]+' || echo "unknown")
if [[ "$DOVECOT_VERSION" == "unknown" ]]; then
    echo -e "${YELLOW}Warning: Could not dynamically parse Dovecot version. Defaulting to 2.3 logic.${NC}"
    DOVECOT_VERSION="2.3"
fi

# Scrub any previous OpenMailStack SSL configs to stay idempotent
sed -i '/^# --- OpenMailStack SSL ---/d' /etc/dovecot/local.conf || true
sed -i '/^ssl =/d' /etc/dovecot/local.conf || true
sed -i '/^ssl_cert =/d' /etc/dovecot/local.conf || true
sed -i '/^ssl_key =/d' /etc/dovecot/local.conf || true
sed -i '/^ssl_server_cert_file =/d' /etc/dovecot/local.conf || true
sed -i '/^ssl_server_key_file =/d' /etc/dovecot/local.conf || true

# Append dynamic config based on 2.3 vs 2.4 rules
cat <<EOF >> /etc/dovecot/local.conf
# --- OpenMailStack SSL ---
ssl = required
EOF

if [[ "$DOVECOT_VERSION" == "2.4" ]]; then
cat <<EOF >> /etc/dovecot/local.conf
ssl_server_cert_file = ${CERT_FILE}
ssl_server_key_file = ${KEY_FILE}
EOF
else
cat <<EOF >> /etc/dovecot/local.conf
ssl_cert = <${CERT_FILE}
ssl_key = <${KEY_FILE}
EOF
fi

# 6. Configure the Firewall (UFW)
echo -e "Configuring UFW Firewall..."

# Preserve SSH access even when the daemon is configured on a non-default port.
SSH_PORTS="22"
if command -v sshd >/dev/null 2>&1; then
    DETECTED_SSH_PORTS=$(sshd -T 2>/dev/null | awk '$1=="port" {print $2}' | sort -u | tr '\n' ' ')
    if [[ -n "${DETECTED_SSH_PORTS// }" ]]; then
        SSH_PORTS="${DETECTED_SSH_PORTS}"
    fi
fi

# Also allow the current SSH session port as an extra safety guard.
if [[ -n "${SSH_CONNECTION:-}" ]]; then
    CURRENT_SSH_PORT=$(awk '{print $4}' <<< "${SSH_CONNECTION}")
    if [[ -n "${CURRENT_SSH_PORT}" ]]; then
        SSH_PORTS="${SSH_PORTS} ${CURRENT_SSH_PORT}"
    fi
fi

# 6. Configure the Firewall
if [[ "${PKG_MANAGER}" == "apt" ]]; then
    if command -v ufw >/dev/null 2>&1; then
        echo -e "Configuring UFW..."
        ufw allow 22/tcp
        ufw allow 80/tcp
        ufw allow 443/tcp
        ufw allow 25/tcp
        ufw allow 587/tcp
        ufw allow 993/tcp
        ufw allow 995/tcp
        ufw --force enable
    else
        openmailstack_record_soft_error "UFW is not installed on ${OPENMAILSTACK_OS_LABEL}; firewall configuration skipped."
    fi
elif [[ "${PKG_MANAGER}" == "dnf" ]]; then
    if command -v firewall-cmd >/dev/null 2>&1; then
        echo -e "Configuring Firewalld..."
        systemctl enable --now firewalld
        for SSH_PORT in $(echo "${SSH_PORTS}" | tr ' ' '\n' | awk '/^[0-9]+$/' | sort -u); do
            firewall-cmd --permanent --add-port="${SSH_PORT}/tcp"
        done
        firewall-cmd --permanent --add-service=http
        firewall-cmd --permanent --add-service=https
        firewall-cmd --permanent --add-service=smtp
        firewall-cmd --permanent --add-service=smtps
        firewall-cmd --permanent --add-service=imaps
        firewall-cmd --permanent --add-service=pop3s
        firewall-cmd --reload
    else
        openmailstack_record_soft_error "Firewalld is not installed on ${OPENMAILSTACK_OS_LABEL}; firewall configuration skipped."
    fi
fi

# 7. Configure Fail2ban
echo -e "Configuring Fail2ban..."
if [[ "${SEC_HAS_FAIL2BAN}" -eq 1 ]]; then
MAIL_LOG_PATH="/var/log/mail.log"
[[ "${PKG_MANAGER}" == "dnf" ]] && MAIL_LOG_PATH="/var/log/maillog"

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
logpath = ${MAIL_LOG_PATH}

[dovecot]
enabled = true
port = pop3,pop3s,imap,imaps,submission
logpath = ${MAIL_LOG_PATH}
EOF
else
    openmailstack_record_soft_error "Fail2ban is not installed on ${OPENMAILSTACK_OS_LABEL}; intrusion protection setup skipped."
fi

# 8. Restart Services
echo -e "Restarting all services to apply security settings..."
systemctl restart nginx postfix dovecot
if [[ "${SEC_HAS_FAIL2BAN}" -eq 1 ]]; then
    systemctl enable --now fail2ban
fi

echo -e "${GREEN}Security setup complete!${NC}"

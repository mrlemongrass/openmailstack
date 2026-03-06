#!/usr/bin/env bash

# Strict mode
set -euo pipefail
trap 'echo "ERROR in ${BASH_SOURCE[0]} at line ${LINENO}: ${BASH_COMMAND}" >&2' ERR

# Colors
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${CYAN}==============================================${NC}"
echo -e "${CYAN} OpenMailStack Configuration Wizard           ${NC}"
echo -e "${CYAN}==============================================${NC}"

# Safety check: Don't overwrite if config is in /etc
if [[ -f "/etc/openmailstack/config.conf" ]]; then
    echo -e "${YELLOW}Warning: Found config in /etc/openmailstack/config.conf${NC}"
    read -p "System-wide config exists. Overwrite? (y/N): " OVERWRITE
    if [[ ! "$OVERWRITE" =~ ^[Yy]$ ]]; then
        echo "Exiting wizard."
        exit 0
    fi
fi

if [[ -f "./config.conf" ]]; then
    echo -e "${YELLOW}Warning: config.conf already exists in current directory.${NC}"
    read -p "Do you want to overwrite it and generate new passwords? (y/N): " OVERWRITE
    if [[ ! "$OVERWRITE" =~ ^[Yy]$ ]]; then
        echo "Exiting wizard."
        exit 0
    fi
fi

# 1. Gather User Input
echo ""
read -p "Enter your primary mail domain (e.g., example.com): " USER_DOMAIN
read -p "Enter an email for Let's Encrypt renewal alerts: " USER_EMAIL

# Input validation helpers
# More robust domain validation
is_valid_domain() {
    local domain="${1,,}"  # lowercase for validation
    # Check for prohibited patterns
    [[ "${domain}" =~ ^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$ ]] && \
    ! [[ "${domain}" =~ ^xn-- ]] && \
    ! [[ "${domain}" =~ \.\. ]] && \
    [[ "${#domain}" -le 253 ]]
}

# Enhanced email validation
is_valid_email() {
    local email="${1,,}"
    # Basic structure check
    [[ "${email}" =~ ^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)+$ ]] && \
    [[ "${#email}" -le 254 ]]
}

# Verify domain has MX or A record (basic DNS check)
is_resolvable_domain() {
    local domain="${1}"
    if command -v dig >/dev/null 2>&1; then
        local mx_records a_records
        mx_records="$(dig +short "${domain}" MX | awk 'NF')"
        a_records="$(dig +short "${domain}" A | awk 'NF')"
        [[ -n "${mx_records}" || -n "${a_records}" ]]
    elif command -v getent >/dev/null 2>&1; then
        getent ahosts "${domain}" >/dev/null 2>&1
    elif command -v nslookup >/dev/null 2>&1; then
        nslookup "${domain}" >/dev/null 2>&1
    else
        return 0
    fi
}

if [[ -z "$USER_DOMAIN" || -z "$USER_EMAIL" ]]; then
    echo "Error: Domain and Email cannot be empty." >&2
    exit 1
fi

# Enhanced validation with specific error messages
if ! is_valid_domain "${USER_DOMAIN}"; then
    echo "Error: Invalid domain format: ${USER_DOMAIN}" >&2
    echo "Domain must:" >&2
    echo "  - Be a valid domain name (e.g., example.com)" >&2
    echo "  - Not contain consecutive dots" >&2
    echo "  - Be no longer than 253 characters" >&2
    exit 1
fi

if ! is_valid_email "${USER_EMAIL}"; then
    echo "Error: Invalid email format: ${USER_EMAIL}" >&2
    exit 1
fi

MAIL_HOST_TO_VALIDATE="mail.${USER_DOMAIN}"

# Optional DNS check (don't fail if DNS tools unavailable)
if command -v dig >/dev/null 2>&1 || command -v getent >/dev/null 2>&1 || command -v nslookup >/dev/null 2>&1; then
    echo "Verifying certificate host ${MAIL_HOST_TO_VALIDATE} resolves to an IP address..."
    if ! is_resolvable_domain "${MAIL_HOST_TO_VALIDATE}"; then
        echo "Warning: Host ${MAIL_HOST_TO_VALIDATE} doesn't appear to resolve correctly." >&2
        echo "Continue anyway? This may cause SSL certificate issues." >&2
        read -p "Continue without DNS verification? (y/N): " SKIP_DNS
        if [[ ! "${SKIP_DNS}" =~ ^[Yy]$ ]]; then
            exit 1
        fi
    else
        echo "✓ Host verification passed"
    fi
fi

# 2. Copy Template
cp ./config.default ./config.conf

# 3. Generate Secure Passwords and Inject them
echo -e "\n${YELLOW}Generating secure passwords...${NC}"

# Function to generate a 32-char alphanumeric password with mixed case
gen_pass() {
    # Use /dev/urandom for better entropy and avoid the while loop timeout
    openssl rand -base64 48 | tr -dc 'a-zA-Z0-9' | head -c 32
}

# Replace placeholders using sed
ESCAPED_DOMAIN=$(printf '%s' "${USER_DOMAIN}" | sed 's/[\/&]/\\&/g')
ESCAPED_EMAIL=$(printf '%s' "${USER_EMAIL}" | sed 's/[\/&]/\\&/g')
sed -i "s/FIRST_DOMAIN=\"example.com\"/FIRST_DOMAIN=\"${ESCAPED_DOMAIN}\"/" ./config.conf
sed -i "s/LETSENCRYPT_EMAIL=\"admin@\${FIRST_DOMAIN}\"/LETSENCRYPT_EMAIL=\"${ESCAPED_EMAIL}\"/" ./config.conf

sed -i "s/ChangeMe_Vmail_Pass/$(gen_pass)/" ./config.conf
sed -i "s/ChangeMe_PFA_Pass/$(gen_pass)/" ./config.conf
sed -i "s/ChangeMe_Setup_Pass/$(gen_pass)/" ./config.conf
sed -i "s/ChangeMe_RC_Pass/$(gen_pass)/" ./config.conf

# Secure the file so only root can read it
chmod 600 ./config.conf

echo -e "${GREEN}Success! config.conf has been generated securely.${NC}"
echo -e "You can view your generated passwords by running: ${CYAN}cat ./config.conf${NC}"
echo -e "You are now ready to run: ${GREEN}sudo ./install.sh${NC}"

# Show a summary of what was configured
echo -e "\n${CYAN}===========================================${NC}"
echo -e "${CYAN} Configuration Summary                      ${NC}"
echo -e "${CYAN}===========================================${NC}"
echo -e "Domain:     ${USER_DOMAIN}"
echo -e "Hostname:   mail.${USER_DOMAIN}"
echo -e "Email:      ${USER_EMAIL}"
echo -e "${CYAN}===========================================${NC}"

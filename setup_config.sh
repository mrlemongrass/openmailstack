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

if [[ -f "./config.conf" ]]; then
    echo -e "${YELLOW}Warning: config.conf already exists.${NC}"
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

if [[ -z "$USER_DOMAIN" || -z "$USER_EMAIL" ]]; then
    echo "Error: Domain and Email cannot be empty."
    exit 1
fi

# 2. Copy Template
cp ./config.default ./config.conf

# 3. Generate Secure Passwords and Inject them
echo -e "\n${YELLOW}Generating secure passwords...${NC}"

# Function to generate a 24-char alphanumeric password
gen_pass() {
    openssl rand -base64 24 | tr -dc 'a-zA-Z0-9' | head -c 24
}

# Replace placeholders using sed
sed -i "s/FIRST_DOMAIN=\"example.com\"/FIRST_DOMAIN=\"${USER_DOMAIN}\"/" ./config.conf
sed -i "s/LETSENCRYPT_EMAIL=\"admin@\${FIRST_DOMAIN}\"/LETSENCRYPT_EMAIL=\"${USER_EMAIL}\"/" ./config.conf

sed -i "s/ChangeMe_DB_Root_Pass/$(gen_pass)/" ./config.conf
sed -i "s/ChangeMe_Vmail_Pass/$(gen_pass)/" ./config.conf
sed -i "s/ChangeMe_PFA_Pass/$(gen_pass)/" ./config.conf
sed -i "s/ChangeMe_Setup_Pass/$(gen_pass)/" ./config.conf
sed -i "s/ChangeMe_RC_Pass/$(gen_pass)/" ./config.conf

# Secure the file so only root can read it
chmod 600 ./config.conf

echo -e "${GREEN}Success! config.conf has been generated securely.${NC}"
echo -e "You can view your generated passwords by running: ${CYAN}cat ./config.conf${NC}"
echo -e "You are now ready to run: ${GREEN}sudo ./install.sh${NC}"

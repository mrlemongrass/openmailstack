#!/usr/bin/env bash

# Exit immediately if a command exits with a non-zero status
set -e

# Define text colors for readable output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}Starting OpenMailStack Installation...${NC}"

# Ensure script is run as root
if [[ $EUID -ne 0 ]]; then
   echo -e "${RED}Error: This script must be run as root.${NC}" 
   exit 1
fi

# Load variables (Passwords, Domain names, etc.)
if [[ -f "./config.conf" ]]; then
    source ./config.conf
else
    echo -e "${YELLOW}No config.conf found. Generating one from config.default...${NC}"
    cp ./config.default ./config.conf
    echo -e "${RED}Please edit config.conf with your domain and passwords, then run this script again.${NC}"
    exit 1
fi

# Function to execute modules and log them
run_module() {
    local module_path=$1
    local module_name=$(basename "$module_path")
    
    echo -e "${YELLOW}---> Executing ${module_name}...${NC}"
    
    if bash "$module_path"; then
        echo -e "${GREEN}---> ${module_name} completed successfully.${NC}"
    else
        echo -e "${RED}---> Error executing ${module_name}. Installation aborted.${NC}"
        exit 1
    fi
}

# Execution Order
run_module "functions/00_pre_flight.sh"
run_module "functions/01_system_db.sh"
run_module "functions/02_postfixadmin.sh"
run_module "functions/03_postfix.sh"
run_module "functions/04_dovecot.sh"
run_module "functions/05_rspamd_clamav.sh"
run_module "functions/06_roundcube.sh"
run_module "functions/07_security.sh"

echo -e "${GREEN}==============================================${NC}"
echo -e "${GREEN} OpenMailStack Installation Complete!         ${NC}"
echo -e "${GREEN}==============================================${NC}"
echo "Webmail: https://mail.${FIRST_DOMAIN}/webmail"
echo "Admin Panel: https://mail.${FIRST_DOMAIN}/postfixadmin"
echo "Please save your credentials stored in config.conf securely."

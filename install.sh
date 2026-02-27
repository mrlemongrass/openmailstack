#!/usr/bin/env bash

# ==============================================================================
# Strict Bash Mode: Fail fast on errors, unset variables, and hidden pipeline failures
# ==============================================================================
set -euo pipefail
trap 'echo -e "\033[0;31mERROR in ${BASH_SOURCE[0]} at line ${LINENO}: ${BASH_COMMAND}\033[0m" >&2' ERR

# Define text colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo -e "${CYAN}Starting OpenMailStack Installation...${NC}"

# 1. Root Check
if [[ $EUID -ne 0 ]]; then
   echo -e "${RED}Error: This script must be run as root.${NC}" 
   exit 1
fi

# 2. Config File Check
if [[ ! -f "./config.conf" ]]; then
    echo -e "${RED}Error: No config.conf found.${NC}"
    echo -e "Please run ${YELLOW}sudo ./setup_config.sh${NC} first to generate your secure configuration."
    exit 1
fi

source ./config.conf

# 3. Upfront Configuration Validation
echo -e "Validating configuration..."
if grep -q "ChangeMe_" ./config.conf; then
    echo -e "${RED}Error: Default 'ChangeMe_' passwords detected in config.conf.${NC}"
    echo -e "Please run setup_config.sh or manually update the file with secure passwords."
    exit 1
fi

if [[ "$FIRST_DOMAIN" == "example.com" || -z "$FIRST_DOMAIN" ]]; then
    echo -e "${RED}Error: Invalid domain name in config.conf.${NC}"
    exit 1
fi

# 4. Module Execution Function
run_module() {
    local module_path=$1
    local module_name=$(basename "$module_path")
    
    echo -e "\n${YELLOW}---> Executing ${module_name}...${NC}"
    
    # We call the script with bash. Since the child scripts will ALSO have 
    # 'set -euo pipefail', any failure inside them will bubble up and halt this master script.
    bash "$module_path"
    
    echo -e "${GREEN}---> ${module_name} completed successfully.${NC}"
}

# 5. Execution Order
run_module "functions/00_pre_flight.sh"
run_module "functions/01_system_db.sh"
run_module "functions/02_postfixadmin.sh"
run_module "functions/03_postfix.sh"
run_module "functions/04_dovecot.sh"
run_module "functions/05_rspamd_clamav.sh"
run_module "functions/06_roundcube.sh"
run_module "functions/07_security.sh"

echo -e "\n${GREEN}==============================================${NC}"
echo -e "${GREEN} OpenMailStack Installation Complete!         ${NC}"
echo -e "${GREEN}==============================================${NC}"
echo -e "Webmail:     ${CYAN}https://mail.${FIRST_DOMAIN}/webmail${NC}"
echo -e "Admin Panel: ${CYAN}https://mail.${FIRST_DOMAIN}/postfixadmin${NC}"
echo -e "Run ${YELLOW}cat config.conf${NC} to view your generated admin passwords."

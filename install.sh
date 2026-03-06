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
SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
DRY_RUN=0

print_usage() {
    cat <<EOF
Usage: ./install.sh [--dry-run]

Options:
  --dry-run   Print detected platform and resolved install decisions, then exit.
EOF
}

for arg in "$@"; do
    case "${arg}" in
        --dry-run)
            DRY_RUN=1
            ;;
        -h|--help)
            print_usage
            exit 0
            ;;
        *)
            echo -e "${RED}Error: Unknown option '${arg}'.${NC}"
            print_usage
            exit 1
            ;;
    esac
done

print_dry_run_report() {
    local php_expected php_service php_socket rspamd_codename
    php_expected="$(openmailstack_expected_php_version)"
    php_service="$(openmailstack_php_fpm_service || true)"
    php_socket="$(openmailstack_php_fpm_socket || true)"
    rspamd_codename="$(openmailstack_rspamd_repo_codename)"
    mapfile -t base_packages < <(openmailstack_base_packages)

    echo -e "${CYAN}================================================${NC}"
    echo -e "${CYAN} OpenMailStack Dry Run Report                   ${NC}"
    echo -e "${CYAN}================================================${NC}"
    echo -e "Platform:            ${GREEN}${OPENMAILSTACK_OS_LABEL}${NC}"
    echo -e "Platform key:        ${OPENMAILSTACK_OS_ID}-${OPENMAILSTACK_OS_VERSION_ID}"
    echo -e "Codename:            ${OPENMAILSTACK_OS_CODENAME:-unknown}"
    echo -e "Expected PHP-FPM:    ${php_expected:-unknown}"
    echo -e "Detected PHP service:${php_service:-not found}"
    echo -e "Detected PHP socket: ${php_socket:-not found}"
    echo -e "Rspamd codename:     ${rspamd_codename:-unknown}"
    echo -e "config.conf:         $([[ -f ./config.conf ]] && echo present || echo missing)"
    echo -e "Base package set:"
    for pkg in "${base_packages[@]}"; do
        echo -e "  - ${pkg}"
    done
    echo -e "${CYAN}Dry run completed. No changes were made.${NC}"
}

# Print non-fatal issue summary collected by modules.
report_soft_errors() {
    if [[ -n "${OPENMAILSTACK_SOFT_ERROR_LOG:-}" && -s "${OPENMAILSTACK_SOFT_ERROR_LOG}" ]]; then
        echo -e "\n${YELLOW}==============================================${NC}" >&2
        echo -e "${YELLOW} Non-Fatal Issues Encountered                 ${NC}" >&2
        echo -e "${YELLOW}==============================================${NC}" >&2
        nl -w2 -s'. ' "${OPENMAILSTACK_SOFT_ERROR_LOG}" >&2 || true
        echo -e "${YELLOW}Installation continued past the items above.${NC}" >&2
    fi

    if [[ -n "${OPENMAILSTACK_SOFT_ERROR_LOG:-}" ]]; then
        rm -f "${OPENMAILSTACK_SOFT_ERROR_LOG}" 2>/dev/null || true
    fi
}

# 1. Detect OS and Version
source "${SCRIPT_DIR}/functions/lib_os.sh"
detect_openmailstack_os

if ! openmailstack_require_supported_platform; then
    echo -e "${RED}Error: Unsupported OS detected: ${OPENMAILSTACK_OS_LABEL}.${NC}"
    exit 1
fi

echo -e "Detected OS: ${GREEN}${OPENMAILSTACK_OS_LABEL}${NC} (codename: ${OPENMAILSTACK_OS_CODENAME:-unknown})"

if [[ "${DRY_RUN}" -eq 1 ]]; then
    print_dry_run_report
    exit 0
fi

# 2. Initialize non-fatal issue log
OPENMAILSTACK_SOFT_ERROR_LOG=$(mktemp /tmp/openmailstack-soft-errors.XXXXXX)
export OPENMAILSTACK_SOFT_ERROR_LOG
trap report_soft_errors EXIT

# 3. Root Check
if [[ $EUID -ne 0 ]]; then
   echo -e "${RED}Error: This script must be run as root.${NC}" 
   exit 1
fi

# 4. Config File Check
if [[ ! -f "./config.conf" ]]; then
    echo -e "${RED}Error: No config.conf found.${NC}"
    echo -e "Please run ${YELLOW}sudo ./setup_config.sh${NC} first to generate your secure configuration."
    exit 1
fi

source ./config.conf

# 5. Upfront Configuration Validation
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

# 6. Module Execution Function
run_module() {
    local module_path=$1
    local module_name=$(basename "$module_path")
    
    echo -e "\n${YELLOW}---> Executing ${module_name}...${NC}"
    
    # We call the script with bash. Since the child scripts will ALSO have 
    # 'set -euo pipefail', any failure inside them will bubble up and halt this master script.
    bash "$module_path"
    
    echo -e "${GREEN}---> ${module_name} completed successfully.${NC}"
}

# 7. Execution Order
run_module "functions/00_pre_flight.sh"
run_module "functions/01_system_db.sh"
run_module "functions/02_postfixadmin.sh"
run_module "functions/03_postfix.sh"
run_module "functions/04_dovecot.sh"
run_module "functions/05_rspamd_clamav.sh"
run_module "functions/06_roundcube.sh"
run_module "functions/07_security.sh"
run_module "functions/08_dkim_sync_timer.sh"

echo -e "\n${GREEN}==============================================${NC}"
echo -e "${GREEN} OpenMailStack Installation Complete!         ${NC}"
echo -e "${GREEN}==============================================${NC}"
echo -e "Webmail:     ${CYAN}https://mail.${FIRST_DOMAIN}/webmail${NC}"
echo -e "Admin Panel: ${CYAN}https://mail.${FIRST_DOMAIN}/postfixadmin${NC}"
echo -e "Run ${YELLOW}cat config.conf${NC} to view your generated admin passwords."

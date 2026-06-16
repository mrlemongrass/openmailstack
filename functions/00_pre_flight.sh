#!/usr/bin/env bash

# Exit on error
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m'

echo -e "${YELLOW}Starting Pre-Flight Checks...${NC}"
SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

# Source the configuration file
source ./config.conf
source "${SCRIPT_DIR}/lib_os.sh"

# 1. Check Operating System
echo -e "Checking Operating System..."
detect_openmailstack_os

if ! openmailstack_require_supported_platform; then
    echo -e "${RED}Error: Unsupported platform detected: ${OPENMAILSTACK_OS_LABEL}${NC}"
    exit 1
fi

echo -e "${GREEN}OS check passed: ${OPENMAILSTACK_OS_LABEL}${NC}"
echo -e "OS details -> id: ${OPENMAILSTACK_OS_ID}, version: ${OPENMAILSTACK_OS_VERSION_ID}, codename: ${OPENMAILSTACK_OS_CODENAME:-unknown}"

# Warn early if memory is below recommended minimum (2 GB).
TOTAL_MEM_KB=$(awk '/MemTotal/ {print $2}' /proc/meminfo 2>/dev/null || echo 0)
if [[ "${TOTAL_MEM_KB}" -gt 0 && "${TOTAL_MEM_KB}" -lt 2097152 ]]; then
    TOTAL_MEM_MB=$((TOTAL_MEM_KB / 1024))
    echo -e "${YELLOW}Warning: Only ${TOTAL_MEM_MB} MB RAM detected. ClamAV may fail below 2 GB.${NC}" >&2
fi

# Check disk space availability (minimum 10GB recommended)
AVAILABLE_DISK_KB=$(df -k / 2>/dev/null | awk 'NR==2 {print $4}' || echo 0)
if [[ "${AVAILABLE_DISK_KB}" -gt 0 && "${AVAILABLE_DISK_KB}" -lt 10485760 ]]; then
    AVAILABLE_DISK_GB=$((AVAILABLE_DISK_KB / 1024 / 1024))
    echo -e "${YELLOW}Warning: Only ${AVAILABLE_DISK_GB} GB disk space available. Minimum 10GB recommended.${NC}" >&2
fi

# 2. Set the Hostname
echo -e "Setting hostname to ${MAIL_HOSTNAME}..."
hostnamectl set-hostname "${MAIL_HOSTNAME}"

# 3. Configure /etc/hosts
# We must ensure the server can resolve its own FQDN to a local IP (usually 127.0.1.1)
echo -e "Configuring /etc/hosts..."
# Remove any existing 127.0.1.1 entries to prevent duplicates
sed -i '/^127.0.1.1/d' /etc/hosts
# Add the new FQDN and short hostname
SHORT_HOST=$(echo "${MAIL_HOSTNAME}" | cut -d'.' -f1)
echo "127.0.1.1 ${MAIL_HOSTNAME} ${SHORT_HOST}" >> /etc/hosts
echo -e "${GREEN}Hostname and /etc/hosts configured successfully.${NC}"

# 4. Verify FQDN
CURRENT_FQDN=$(hostname -f)
if [[ "$CURRENT_FQDN" != "$MAIL_HOSTNAME" ]]; then
    echo -e "${RED}Error: FQDN validation failed. Expected $MAIL_HOSTNAME but got $CURRENT_FQDN${NC}"
    exit 1
fi
echo -e "${GREEN}FQDN validation passed: $CURRENT_FQDN${NC}"

# 5. Update System and Install Base Dependencies
echo -e "${YELLOW}Updating package lists and installing base tools...${NC}"
export DEBIAN_FRONTEND=noninteractive
while true; do
    if apt-get update -qq; then
        break
    fi
    echo -e "\n${RED}Error: Package update failed. An external repository may be temporarily down.${NC}" >&2
    if [[ ! -t 0 ]]; then
        echo -e "Non-interactive environment detected. Aborting." >&2
        exit 1
    fi
    echo "1) Retry"
    echo "2) Ignore and continue (may cause installation issues)"
    echo "3) Abort"
    read -p "Select option [1-3] (default: 3): " APT_OPT
    APT_OPT=${APT_OPT:-3}
    if [[ "$APT_OPT" == "2" ]]; then
        echo -e "${YELLOW}Warning: Proceeding despite apt-get update failure.${NC}"
        break
    elif [[ "$APT_OPT" == "3" ]]; then
        echo "Aborting."
        exit 1
    fi
done
apt-get upgrade -y -qq || openmailstack_record_soft_error "Package upgrade had non-fatal issues"

# Verify essential tools are working
for tool in curl wget lsb-release openssl; do
    if ! command -v "${tool}" >/dev/null 2>&1; then
        echo -e "${YELLOW}Warning: ${tool} not found after installation.${NC}" >&2
    fi
done

# Log system resources for troubleshooting
echo -e "${GREEN}System resources:${NC}"
TOTAL_MEM_KB=$(awk '/MemTotal/ {print $2}' /proc/meminfo 2>/dev/null || echo 0)
TOTAL_MEM_MB=$((TOTAL_MEM_KB / 1024))
echo -e "  RAM: ${TOTAL_MEM_MB:-0} MB"
DISK_AVAIL=$(df -h / 2>/dev/null | awk 'NR==2 {print $4}' || echo "unknown")
echo -e "  Disk: ${DISK_AVAIL} available"

# Install essential tools required for the rest of the scripts
mapfile -t BASE_PACKAGES < <(openmailstack_base_packages)
openmailstack_install_required_packages "${BASE_PACKAGES[@]}"

echo -e "${GREEN}System updated and base dependencies installed.${NC}"
echo -e "${GREEN}Pre-Flight Checks Complete!${NC}"

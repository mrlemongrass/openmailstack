#!/usr/bin/env bash

# Exit on error
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m'

echo -e "${YELLOW}Starting Pre-Flight Checks...${NC}"

# Source the configuration file
source ./config.conf

# 1. Check Operating System
echo -e "Checking Operating System..."
if [ -f /etc/os-release ]; then
    . /etc/os-release
    if [[ "$ID" != "ubuntu" && "$ID" != "debian" ]]; then
        echo -e "${RED}Error: This script only supports Ubuntu or Debian. Detected: $ID${NC}"
        exit 1
    fi
    echo -e "${GREEN}OS check passed: $PRETTY_NAME${NC}"
else
    echo -e "${RED}Error: Cannot determine the operating system.${NC}"
    exit 1
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
apt-get update -qq
apt-get upgrade -y -qq

# Install essential tools required for the rest of the scripts
apt-get install -y -qq \
    curl \
    wget \
    sudo \
    gnupg2 \
    ca-certificates \
    lsb-release \
    apt-transport-https \
    software-properties-common \
    dnsutils \
    net-tools \
    unzip

echo -e "${GREEN}System updated and base dependencies installed.${NC}"
echo -e "${GREEN}Pre-Flight Checks Complete!${NC}"

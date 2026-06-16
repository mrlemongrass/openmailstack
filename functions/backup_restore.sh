#!/usr/bin/env bash

# ==============================================================================
# OpenMailStack Backup and Restore System
# ==============================================================================

BACKUP_ROOT="/var/backups/openmailstack"

create_backup() {
    local timestamp=$(date +%Y%m%d_%H%M%S)
    local backup_dir="${BACKUP_ROOT}/${timestamp}"
    
    echo -e "\n${CYAN}Creating safety snapshot before proceeding...${NC}"
    mkdir -p "${backup_dir}"
    
    # 1. Database Backup
    echo -n "Backing up databases... "
    if systemctl is-active mariadb >/dev/null 2>&1; then
        mysqldump --all-databases --events --routines --triggers > "${backup_dir}/databases.sql" 2>/dev/null || true
        echo -e "${GREEN}[OK]${NC}"
    else
        echo -e "${YELLOW}[Skipped - MariaDB not running]${NC}"
    fi

    # 2. Configuration Files Backup
    echo -n "Backing up configurations... "
    [[ -d /etc/postfix ]] && cp -a /etc/postfix "${backup_dir}/"
    [[ -d /etc/dovecot ]] && cp -a /etc/dovecot "${backup_dir}/"
    [[ -d /etc/nginx ]] && cp -a /etc/nginx "${backup_dir}/"
    [[ -d /etc/rspamd ]] && cp -a /etc/rspamd "${backup_dir}/"
    echo -e "${GREEN}[OK]${NC}"

    # 3. Web Data Backup
    echo -n "Backing up web applications... "
    [[ -d /var/www/postfixadmin ]] && cp -a /var/www/postfixadmin "${backup_dir}/"
    [[ -d /var/www/roundcube ]] && cp -a /var/www/roundcube "${backup_dir}/"
    [[ -d /var/www/openmailstack-admin ]] && cp -a /var/www/openmailstack-admin "${backup_dir}/"
    echo -e "${GREEN}[OK]${NC}"

    echo -e "${GREEN}Safety snapshot created at: ${backup_dir}${NC}"

    # 4. Clean up old backups
    cleanup_old_backups
}

cleanup_old_backups() {
    # Locate backup directories older than 30 days
    local old_backups=($(find "${BACKUP_ROOT}" -mindepth 1 -maxdepth 1 -type d -mtime +30 2>/dev/null || true))
    
    if [[ ${#old_backups[@]} -eq 0 ]]; then
        return 0
    fi

    if [[ ! -t 0 || "${DEBIAN_FRONTEND:-}" == "noninteractive" ]]; then
        return 0 # Skip interactive cleanup if running headless
    fi
    echo -e "\n${YELLOW}Found ${#old_backups[@]} backup(s) older than 30 days in ${BACKUP_ROOT}.${NC}"
    read -p "Would you like to manage/delete them to save disk space? (y/N): " manage_opt
    if [[ ! "$manage_opt" =~ ^[Yy]$ ]]; then
        echo "Keeping all old backups."
        return 0
    fi

    echo -e "\n${CYAN}Old Backups Available for Deletion:${NC}"
    for i in "${!old_backups[@]}"; do
        # Extract just the folder name (timestamp) for display
        echo "$((i+1))) $(basename "${old_backups[$i]}")"
    done
    echo "A) Delete All"
    echo "C) Cancel"

    read -p "Select backups to delete (e.g. '1', '1 3', 'A' for All, 'C' to Cancel): " sel
    
    if [[ "$sel" == "C" || "$sel" == "c" ]]; then
        echo "Cleanup cancelled."
        return 0
    elif [[ "$sel" == "A" || "$sel" == "a" ]]; then
        echo -n "Deleting all old backups... "
        for b in "${old_backups[@]}"; do
            rm -rf "$b"
        done
        echo -e "${GREEN}[OK]${NC}"
    else
        for num in $sel; do
            if [[ "$num" =~ ^[0-9]+$ ]] && [[ "$num" -ge 1 && "$num" -le ${#old_backups[@]} ]]; then
                local index=$((num-1))
                if [[ -d "${old_backups[$index]}" ]]; then
                    echo -n "Deleting $(basename "${old_backups[$index]}")... "
                    rm -rf "${old_backups[$index]}"
                    echo -e "${GREEN}[OK]${NC}"
                fi
            else
                echo -e "${RED}Skipped invalid selection: $num${NC}"
            fi
        done
    fi
}

restore_backup() {
    if [[ ! -d "${BACKUP_ROOT}" ]]; then
        echo -e "${RED}No backups found in ${BACKUP_ROOT}${NC}"
        return 1
    fi

    echo -e "\n${CYAN}Available Safety Snapshots:${NC}"
    local backups=($(ls -1tr "${BACKUP_ROOT}"))
    if [[ ${#backups[@]} -eq 0 ]]; then
        echo -e "${RED}No backups found.${NC}"
        return 1
    fi

    for i in "${!backups[@]}"; do
        echo "$((i+1))) ${backups[$i]}"
    done
    echo "c) Cancel"

    read -p "Select a snapshot to restore: " sel
    if [[ "$sel" == "c" || "$sel" == "C" ]]; then
        echo "Restore cancelled."
        return 0
    fi

    local index=$((sel-1))
    if [[ -z "${backups[$index]:-}" ]]; then
        echo -e "${RED}Invalid selection.${NC}"
        return 1
    fi

    local target="${BACKUP_ROOT}/${backups[$index]}"
    echo -e "\n${YELLOW}WARNING: This will overwrite your current configuration and database with the state from ${backups[$index]}.${NC}"
    read -p "Are you absolutely sure? (Type 'YES' to confirm): " confirm
    if [[ "$confirm" != "YES" ]]; then
        echo "Restore cancelled."
        return 0
    fi

    echo -e "\n${CYAN}Restoring from snapshot ${backups[$index]}...${NC}"

    # 1. Restore Database
    if [[ -f "${target}/databases.sql" ]]; then
        echo -n "Restoring databases... "
        mysql < "${target}/databases.sql"
        echo -e "${GREEN}[OK]${NC}"
    fi

    # 2. Restore Configurations
    echo -n "Restoring configurations... "
    [[ -d "${target}/postfix" ]] && rm -rf /etc/postfix && cp -a "${target}/postfix" /etc/
    [[ -d "${target}/dovecot" ]] && rm -rf /etc/dovecot && cp -a "${target}/dovecot" /etc/
    [[ -d "${target}/nginx" ]] && rm -rf /etc/nginx && cp -a "${target}/nginx" /etc/
    [[ -d "${target}/rspamd" ]] && rm -rf /etc/rspamd && cp -a "${target}/rspamd" /etc/
    echo -e "${GREEN}[OK]${NC}"

    # 3. Restore Web Applications
    echo -n "Restoring web applications... "
    [[ -d "${target}/postfixadmin" ]] && rm -rf /var/www/postfixadmin && cp -a "${target}/postfixadmin" /var/www/
    [[ -d "${target}/roundcube" ]] && rm -rf /var/www/roundcube && cp -a "${target}/roundcube" /var/www/
    [[ -d "${target}/openmailstack-admin" ]] && rm -rf /var/www/openmailstack-admin && cp -a "${target}/openmailstack-admin" /var/www/
    echo -e "${GREEN}[OK]${NC}"

    # 4. Restart Services
    echo -n "Restarting services... "
    systemctl daemon-reload
    systemctl restart mariadb nginx postfix dovecot rspamd php*-fpm 2>/dev/null || true
    echo -e "${GREEN}[OK]${NC}"

    echo -e "\n${GREEN}System successfully reverted to state: ${backups[$index]}${NC}"
}

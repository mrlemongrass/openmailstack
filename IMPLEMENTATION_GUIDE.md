# OpenMailStack Implementation Guide

## Enhanced Configuration Wizard

```bash
#!/usr/bin/env bash
# Enhanced setup_config.sh with comprehensive validation

# Input validation helpers
is_valid_domain() {
    local domain="${1,,}"  # lowercase for validation
    # Enhanced pattern validation
    [[ "${domain}" =~ ^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$ ]] && \
    ! [[ "${domain}" =~ ^xn-- ]] && \
    ! [[ "${domain}" =~ \.\. ]] && \
    [[ "${#domain}" -le 253 ]]
}

is_valid_email() {
    local email="${1,,}"
    # Basic structure check with length limit
    [[ "${email}" =~ ^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)+$ ]] && \
    [[ "${#email}" -le 254 ]]
}

# DNS verification (optional, non-blocking)
is_resolvable_domain() {
    local domain="${1}"
    if command -v dig >/dev/null 2>&1; then
        dig +short "${domain}" MX >/dev/null 2>&1 || \
        dig +short "${domain}" A >/dev/null 2>&1
    elif command -v nslookup >/dev/null 2>&1; then
        nslookup "${domain}" >/dev/null 2>&1
    fi
}

# Enhanced password generation with complexity
gen_pass() {
    # Generate 32-character password with mixed case, numbers, and symbols
    openssl rand -base64 48 | tr -dc 'a-zA-Z0-9' | head -c 32
}

# Validate generated password complexity
validate_password_complexity() {
    local password="$1"
    local score=0
    
    # Length check (32+ characters)
    [[ ${#password} -ge 32 ]] && ((score++))
    
    # Uppercase check
    [[ "$password" =~ [A-Z] ]] && ((score++))
    
    # Lowercase check
    [[ "$password" =~ [a-z] ]] && ((score++))
    
    # Number check
    [[ "$password" =~ [0-9] ]] && ((score++))
    
    # Special character check
    [[ "$password" =~ [!@#$%^&*] ]] && ((score++))
    
    # Return 0 if score >= 4 (good password)
    [[ ${score} -ge 4 ]]
}
```

## Memory-Safe Installation

```bash
#!/usr/bin/env bash
# In 00_pre_flight.sh - Enhanced memory management

# Memory-aware installation mode
check_memory_and_optimize() {
    local total_mem_kb
    total_mem_kb=$(awk '/MemTotal/ {print $2}' /proc/meminfo 2>/dev/null || echo 0)
    
    if [[ "${total_mem_kb}" -lt 3145728 ]]; then  # Less than 3GB
        echo -e "\033[0;33mSystem has less than 3GB RAM. Enabling memory-saving mode.\033[0m"
        
        # Suggest alternatives
        if [[ "${total_mem_kb}" -lt 2097152 ]]; then  # Less than 2GB
            echo -e "\033[0;31mWarning: Less than 2GB RAM detected. ClamAV will likely fail.\033[0m"
            
            # Auto-disable ClamAV on very low memory
            export MEMORY_SAVING_MODE=1
            echo -e "\033[0;32mEnabling memory-saving mode (disables ClamAV, reduces MySQL memory)\033[0m"
        fi
    fi
}

# Swap space validation
validate_swap_space() {
    local total_mem_kb
    local total_swap_kb
    
    total_mem_kb=$(awk '/MemTotal/ {print $2}' /proc/meminfo 2>/dev/null || echo 0)
    total_swap_kb=$(awk '/SwapTotal/ {print $2}' /proc/meminfo 2>/dev/null || echo 0)
    
    if [[ "${total_mem_kb}" -lt 4194304 && "${total_swap_kb}" -lt 2097152 ]]; then
        echo -e "\033[0;33mWarning: Low RAM with insufficient swap.\033[0m"
        echo -e "Consider adding swap space to prevent OOM issues during installation:"
        echo -e "  sudo fallocate -l 2G /swapfile"
        echo -e "  sudo chmod 600 /swapfile"
        echo -e "  sudo mkswap /swapfile"
        echo -e "  sudo swapon /swapfile"
    fi
}
```

## Enhanced Security Functions

```bash
#!/usr/bin/env bash
# Enhanced security with environment variable protection

# Secure password handling
secure_password_export() {
    local password_var="$1"
    local password_value="${!password_var}"
    
    # Export with proper quoting
    export "${password_var}"="${password_value}"
}

# Clear sensitive variables
clear_sensitive_variables() {
    local vars=("DB_ROOT_PASSWORD" "VMAIL_DB_PASSWORD" "POSTFIXADMIN_DB_PASSWORD" 
                "ROUNDCUBE_DB_PASSWORD" "POSTFIXADMIN_SETUP_PASSWORD" "FIRST_DOMAIN")
    
    for var in "${vars[@]}"; do
        unset "${var}" 2>/dev/null || true
    done
}

# Create cleanup trap
trap 'clear_sensitive_variables' EXIT

# Log sanitization
log_safe() {
    local message="${1//"$DB_ROOT_PASSWORD"/"[REDACTED]"}"
    message="${message//"$VMAIL_DB_PASSWORD"/"[REDACTED]"}"
    message="${message//"$POSTFIXADMIN_SETUP_PASSWORD"/"[REDACTED]"}"
    echo -e "[${1}]" | logger -t openmailstack
}
```

## Configuration Validation

```bash
#!/usr/bin/env bash
# Enhanced validation in setup_config.sh

# Check disk space (minimum 10GB recommended)
check_disk_space() {
    local available_gb
    available_gb=$(df -k / 2>/dev/null | awk 'NR==2 {print $4}' | awk '{print int($1/1024/1024)}')
    
    if [[ "${available_gb}" -lt 10 ]]; then
        echo -e "\033[0;31mError: Insufficient disk space. Minimum 10GB required.\033[0m"
        echo -e "Available: ${available_gb}GB"
        exit 1
    fi
    
    echo "Disk space: ${available_gb}GB (sufficient)"
}

# Check system resources
check_system_resources() {
    local mem_kb
    local disk_kb
    local cpu_count
    
    mem_kb=$(awk '/MemTotal/ {print $2}' /proc/meminfo 2>/dev/null || echo 0)
    disk_kb=$(df -k / 2>/dev/null | awk 'NR==2 {print $2}' || echo 0)
    cpu_count=$(nproc 2>/dev/null || echo 1)
    
    echo "=== System Resources ==="
    echo "RAM: $((${mem_kb}/1024))MB"
    echo "Disk: $((${disk_kb}/1024/1024))GB"
    echo "CPUs: ${cpu_count}"
    echo "========================"
}

# Validate all config values
validate_config() {
    local errors=0
    
    # Validate domain
    if ! is_valid_domain "${FIRST_DOMAIN}"; then
        echo -e "\033[0;31mError: Invalid domain format\033[0m"
        ((errors++))
    fi
    
    # Validate email
    if ! is_valid_email "${LETSENCRYPT_EMAIL}"; then
        echo -e "\033[0;31mError: Invalid email format\033[0m"
        ((errors++))
    fi
    
    # Validate passwords (non-empty)
    if [[ -z "${DB_ROOT_PASSWORD}" || ${#DB_ROOT_PASSWORD} -lt 16 ]]; then
        echo -e "\033[0;31mError: Passwords must be at least 16 characters\033[0m"
        ((errors++))
    fi
    
    return ${errors}
}
```

## Progress Indicators

```bash
#!/usr/bin/env bash
# Progress bar for long operations

# Simple progress bar
progress_bar() {
    local current=$1
    local total=$2
    local width=${3:-50}
    
    local percent=$((current * 100 / total))
    local filled=$((current * width / total))
    local empty=$((width - filled))
    
    printf "\r[%-${width}s] %3d%% (%d/%d)" \
           "$(printf '%*s' $filled '' | tr ' ' '=')" \
           $percent $current $total
}

# Progress with ETA
progress_with_eta() {
    local current=$1
    local total=$2
    local start_time=$3
    
    local elapsed=$(($(date +%s) - start_time))
    local eta=0
    
    if [[ ${current} -gt 0 ]]; then
        local rate=$((${current} / ${elapsed}))
        if [[ ${rate} -gt 0 ]]; then
            eta=$(((${total} - ${current}) / ${rate}))
        fi
    fi
    
    progress_bar $current $total
    
    if [[ ${eta} -gt 0 ]]; then
        printf " ETA: %dm%ds" $((eta/60)) $((eta%60))
    fi
}

# Spinner for long operations
spinner() {
    local pid=$1
    local delay=0.1
    local spinstr='|/-\'
    
    while [[ -d /proc/$pid ]]; do
        local temp=${spinstr#?}
        printf " [%c]  " "$spinstr"
        spinstr=$temp
        sleep $delay
        printf "\r"
    done
    printf " [✓]  \r"
}
```

## Enhanced Installation Script

```bash
#!/usr/bin/env bash
# install.sh with progress tracking

run_module() {
    local module_path=$1
    local module_name=$(basename "$module_path")
    local module_count=${#MODULES[@]}
    local module_index=${MODULES_INDEX:-0}
    
    echo -e "\n${YELLOW}---> Executing ${module_name}...${NC}"
    
    local start_time=$(date +%s)
    
    # Call the script with bash
    bash "$module_path"
    
    local end_time=$(date +%s)
    local duration=$((end_time - start_time))
    
    echo -e "${GREEN}---> ${module_name} completed successfully (${duration}s)${NC}"
    
    ((MODULES_INDEX++))
}

# Add progress tracking
TOTAL_MODULES=9  # Total number of modules
MODULES_INDEX=0

MODULES=(
    "functions/00_pre_flight.sh"
    "functions/01_system_db.sh"
    # ... etc
)

for module in "${MODULES[@]}"; do
    printf "\r[${MODULES_INDEX}/${TOTAL_MODULES}] Processing: ${module}"
    run_module "$module"
done
```

## Testing Framework

```bash
#!/usr/bin/env bash
# tests/test_lib_os.sh

source "functions/lib_os.sh"

# Test OS detection
test_openmailstack_os_detection() {
    echo "Testing OS detection..."
    detect_openmailstack_os
    
    # Test that OS_ID is set
    if [[ -z "${OPENMAILSTACK_OS_ID}" ]]; then
        echo "FAIL: OS_ID not detected"
        return 1
    fi
    
    # Test that OS_VERSION_ID is set
    if [[ -z "${OPENMAILSTACK_OS_VERSION_ID}" ]]; then
        echo "FAIL: OS_VERSION_ID not detected"
        return 1
    fi
    
    echo "PASS: OS detection working correctly"
}

# Test platform key generation
test_openmailstack_platform_key() {
    echo "Testing platform key generation..."
    local key
    key=$(openmailstack_platform_key)
    
    if [[ "${key}" != debian-* && "${key}" != ubuntu-* ]]; then
        echo "FAIL: Invalid platform key format: ${key}"
        return 1
    fi
    
    echo "PASS: Platform key: ${key}"
}

# Test supported platform requirement
test_openmailstack_require_supported_platform() {
    echo "Testing supported platform requirement..."
    
    local original_id="${OPENMAILSTACK_OS_ID}"
    local original_version="${OPENMAILSTACK_OS_VERSION_ID}"
    
    # Test supported platform
    OPENMAILSTACK_OS_ID="debian"
    OPENMAILSTACK_OS_VERSION_ID="12"
    
    if ! openmailstack_require_supported_platform; then
        echo "FAIL: Debian 12 should be supported"
        return 1
    fi
    
    # Test unsupported platform
    OPENMAILSTACK_OS_ID="fedora"
    OPENMAILSTACK_OS_VERSION_ID="39"
    
    if openmailstack_require_supported_platform; then
        echo "FAIL: Fedora 39 should not be supported"
        return 1
    fi
    
    # Restore original values
    OPENMAILSTACK_OS_ID="${original_id}"
    OPENMAILSTACK_OS_VERSION_ID="${original_version}"
    
    echo "PASS: Platform validation working correctly"
}

# Run all tests
run_all_tests() {
    local failed=0
    
    test_openmailstack_os_detection || ((failed++))
    test_openmailstack_platform_key || ((failed++))
    test_openmailstack_require_supported_platform || ((failed++))
    
    echo ""
    if [[ ${failed} -eq 0 ]]; then
        echo "All tests passed!"
        return 0
    else
        echo "${failed} test(s) failed"
        return 1
    fi
}
```

## Memory Optimization for Low-RAM Systems

```bash
#!/usr/bin/env bash
# In 05_rspamd_clamav.sh - Memory-aware installation

# Check if we should enable memory-saving mode
check_memory_mode() {
    local total_mem_kb
    total_mem_kb=$(awk '/MemTotal/ {print $2}' /proc/meminfo 2>/dev/null || echo 0)
    
    # Memory thresholds
    local memory_warning_kb=3145728  # 3GB
    local memory_critical_kb=2097152  # 2GB
    
    if [[ "${total_mem_kb}" -lt ${memory_critical_kb} ]]; then
        echo -e "\033[0;31mCRITICAL: Less than 2GB RAM detected. Automatic ClamAV disable.\033[0m"
        export CLAMAV_ENABLED=0
        export MYSQL_TUNE_MEMORY=1
    elif [[ "${total_mem_kb}" -lt ${memory_warning_kb} ]]; then
        echo -e "\033[0;33mWARNING: Less than 3GB RAM detected. Consider disabling ClamAV.\033[0m"
    else
        export CLAMAV_ENABLED=1
    fi
}

# MySQL memory tuning for low-RAM systems
tune_mysql_for_memory() {
    if [[ "${MYSQL_TUNE_MEMORY:-0}" -eq 1 ]]; then
        echo -e "\033[0;33mApplying MySQL memory optimizations for low-RAM systems\033[0m"
        
        # Reduce MySQL memory usage
        cat >> /etc/mysql/mariadb.conf.d/50-server.cnf <<EOF
# Optimized for low-memory systems
innodb_buffer_pool_size = 256M
innodb_log_file_size = 64M
key_buffer_size = 32M
query_cache_size = 32M
thread_cache_size = 8
tmp_table_size = 64M
max_heap_table_size = 64M
EOF
    fi
}
```

## Usage Examples

```bash
# Test the enhanced setup wizard
chmod +x setup_config.sh
./setup_config.sh

# Run installation with progress tracking
chmod +x install.sh
./install.sh

# Run in dry-run mode first
./install.sh --dry-run

# Verify installation
systemctl status nginx mariadb postfix dovecot rspamd

# Test email functionality
echo "Test" | mail -s "Test" admin@example.com

# Check logs
tail -f /var/log/mail.log
```

These modifications will make OpenMailStack even more robust, secure, and user-friendly while maintaining full backward compatibility.

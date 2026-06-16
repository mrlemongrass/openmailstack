#!/usr/bin/env bash

# Shared OS detection helpers for OpenMailStack modules.
# Exports:
# - OPENMAILSTACK_OS_ID            (ubuntu|debian|almalinux|rocky|rhel|centos)
# - OPENMAILSTACK_OS_VERSION_ID    (24.04, 12, 13, 9, 8...)
# - OPENMAILSTACK_OS_MAJOR         (24, 12, 13, 9, 8...)
# - OPENMAILSTACK_OS_CODENAME      (noble, bookworm, ...)
# - OPENMAILSTACK_OS_LABEL         (Ubuntu 24.04, Debian 12, AlmaLinux 9...)
# - PKG_MANAGER                    (apt|dnf)
# - WEB_USER                       (www-data|nginx)
# - WEB_GROUP                      (www-data|nginx)

detect_openmailstack_os() {
    local os_release_file=""
    if [[ -r /etc/os-release ]]; then
        os_release_file="/etc/os-release"
    elif [[ -r /usr/lib/os-release ]]; then
        os_release_file="/usr/lib/os-release"
    else
        echo "Error: Cannot determine operating system (os-release file missing)." >&2
        return 1
    fi

    # shellcheck source=/dev/null
    source "${os_release_file}"

    local os_id="${ID:-}"
    local os_version="${VERSION_ID:-}"
    local os_codename="${VERSION_CODENAME:-${UBUNTU_CODENAME:-}}"

    os_id="${os_id,,}"

    if [[ -z "${os_version}" ]] && command -v lsb_release >/dev/null 2>&1; then
        os_version="$(lsb_release -sr 2>/dev/null || true)"
    fi

    if [[ -z "${os_codename}" ]] && command -v lsb_release >/dev/null 2>&1; then
        os_codename="$(lsb_release -sc 2>/dev/null || true)"
    fi

    if [[ -z "${os_id}" || -z "${os_version}" ]]; then
        echo "Error: Unable to parse OS ID/VERSION_ID from /etc/os-release." >&2
        return 1
    fi

    OPENMAILSTACK_OS_ID="${os_id}"
    OPENMAILSTACK_OS_VERSION_ID="${os_version}"
    OPENMAILSTACK_OS_MAJOR="${os_version%%.*}"
    OPENMAILSTACK_OS_CODENAME="${os_codename}"

    # Normalize centos stream 9 to centos
    if [[ "${OPENMAILSTACK_OS_ID}" == "centos" && "${NAME,,}" =~ stream ]]; then
        OPENMAILSTACK_OS_LABEL="CentOS Stream ${OPENMAILSTACK_OS_VERSION_ID}"
    else
        case "${OPENMAILSTACK_OS_ID}" in
            ubuntu) OPENMAILSTACK_OS_LABEL="Ubuntu ${OPENMAILSTACK_OS_VERSION_ID}" ;;
            debian) OPENMAILSTACK_OS_LABEL="Debian ${OPENMAILSTACK_OS_VERSION_ID}" ;;
            almalinux) OPENMAILSTACK_OS_LABEL="AlmaLinux ${OPENMAILSTACK_OS_VERSION_ID}" ;;
            rocky) OPENMAILSTACK_OS_LABEL="Rocky Linux ${OPENMAILSTACK_OS_VERSION_ID}" ;;
            rhel) OPENMAILSTACK_OS_LABEL="RedHat ${OPENMAILSTACK_OS_VERSION_ID}" ;;
            *) OPENMAILSTACK_OS_LABEL="${OPENMAILSTACK_OS_ID} ${OPENMAILSTACK_OS_VERSION_ID}" ;;
        esac
    fi

    # Set package manager and web user dynamically
    if [[ "${OPENMAILSTACK_OS_ID}" =~ ^(debian|ubuntu)$ ]]; then
        PKG_MANAGER="apt"
        WEB_USER="www-data"
        WEB_GROUP="www-data"
    elif [[ "${OPENMAILSTACK_OS_ID}" =~ ^(almalinux|rocky|rhel|centos)$ ]]; then
        PKG_MANAGER="dnf"
        WEB_USER="nginx"
        WEB_GROUP="nginx"
    else
        PKG_MANAGER="unknown"
        WEB_USER="www-data"
        WEB_GROUP="www-data"
    fi

    export OPENMAILSTACK_OS_ID
    export OPENMAILSTACK_OS_VERSION_ID
    export OPENMAILSTACK_OS_MAJOR
    export OPENMAILSTACK_OS_CODENAME
    export OPENMAILSTACK_OS_LABEL
    export PKG_MANAGER
    export WEB_USER
    export WEB_GROUP
}

openmailstack_is_os() {
    local expected_id="${1,,}"
    [[ "${OPENMAILSTACK_OS_ID:-}" == "${expected_id}" ]]
}

openmailstack_is_os_version() {
    local expected_id="${1,,}"
    local expected_version="${2}"
    [[ "${OPENMAILSTACK_OS_ID:-}" == "${expected_id}" && "${OPENMAILSTACK_OS_VERSION_ID:-}" == "${expected_version}" ]]
}

openmailstack_platform_key() {
    echo "${OPENMAILSTACK_OS_ID:-unknown}-${OPENMAILSTACK_OS_MAJOR:-unknown}"
}

openmailstack_require_supported_platform() {
    case "$(openmailstack_platform_key)" in
        debian-11|debian-12|debian-13|ubuntu-22|ubuntu-24|ubuntu-25)
            return 0
            ;;
        almalinux-8|almalinux-9|rocky-8|rocky-9|rhel-8|rhel-9|centos-9)
            return 0
            ;;
        *)
            echo "Error: Unsupported OS version: ${OPENMAILSTACK_OS_LABEL:-unknown}." >&2
            echo "Supported platforms: Debian 11/12/13, Ubuntu 22.04/24.04/25.04, RHEL/Alma/Rocky 8/9, CentOS Stream 9." >&2
            return 1
            ;;
    esac
}

openmailstack_package_exists() {
    local pkg="${1}"
    if [[ "${PKG_MANAGER}" == "apt" ]]; then
        apt-cache show "${pkg}" >/dev/null 2>&1
    elif [[ "${PKG_MANAGER}" == "dnf" ]]; then
        dnf list available "${pkg}" >/dev/null 2>&1 || dnf list installed "${pkg}" >/dev/null 2>&1
    else
        return 1
    fi
}

openmailstack_package_installed() {
    local pkg="${1}"
    if [[ "${PKG_MANAGER}" == "apt" ]]; then
        dpkg-query -W -f='${Status}' "${pkg}" 2>/dev/null | grep -q "install ok installed"
    elif [[ "${PKG_MANAGER}" == "dnf" ]]; then
        rpm -q "${pkg}" >/dev/null 2>&1
    else
        return 1
    fi
}

openmailstack_record_soft_error() {
    local message="${1}"
    local timestamp
    timestamp="$(date '+%Y-%m-%d %H:%M:%S')"

    if [[ -n "${OPENMAILSTACK_SOFT_ERROR_LOG:-}" ]]; then
        printf '[%s] %s\n' "${timestamp}" "${message}" >> "${OPENMAILSTACK_SOFT_ERROR_LOG}"
    fi

    echo "Warning: ${message}" >&2
}

openmailstack_update_repos() {
    if [[ "${PKG_MANAGER}" == "apt" ]]; then
        apt-get update -qq
    elif [[ "${PKG_MANAGER}" == "dnf" ]]; then
        dnf makecache -q
    fi
}

openmailstack_upgrade_packages() {
    if [[ "${PKG_MANAGER}" == "apt" ]]; then
        DEBIAN_FRONTEND=noninteractive apt-get upgrade -y -qq
    elif [[ "${PKG_MANAGER}" == "dnf" ]]; then
        dnf upgrade -y -q
    fi
}

openmailstack_translate_pkg() {
    local pkg="${1}"
    if [[ "${PKG_MANAGER}" == "apt" ]]; then
        echo "${pkg}"
        return
    fi
    
    # RHEL dictionary
    case "${pkg}" in
        dovecot-core|dovecot-imapd|dovecot-lmtpd) echo "dovecot dovecot-pigeonhole" ;;
        dovecot-mysql) echo "dovecot-mysql" ;;
        mariadb-server) echo "mariadb-server" ;;
        php-fpm) echo "php-fpm" ;;
        php-mysql) echo "php-mysqlnd" ;;
        php-mbstring) echo "php-mbstring" ;;
        php-xml) echo "php-xml" ;;
        clamav-daemon) echo "clamd" ;;
        clamav-freshclam) echo "clamav-update" ;;
        fail2ban) echo "fail2ban" ;;
        nginx) echo "nginx" ;;
        rspamd) echo "rspamd" ;;
        certbot) echo "certbot" ;;
        python3-certbot-nginx) echo "python3-certbot-nginx" ;;
        ufw) echo "firewalld" ;;
        *) echo "${pkg}" ;;
    esac
}

openmailstack_install_required_packages() {
    local missing=()
    local translated_pkgs=()
    local pkg t_pkg

    for pkg in "$@"; do
        t_pkg="$(openmailstack_translate_pkg "${pkg}")"
        # t_pkg might contain multiple packages (like dovecot dovecot-pigeonhole)
        for p in $t_pkg; do
            if ! openmailstack_package_exists "${p}"; then
                missing+=("${p}")
            else
                translated_pkgs+=("${p}")
            fi
        done
    done

    if [[ ${#missing[@]} -gt 0 ]]; then
        echo "Error: Required packages unavailable on ${OPENMAILSTACK_OS_LABEL:-current platform}: ${missing[*]}" >&2
        return 1
    fi

    # Dedup
    local unique_pkgs=()
    if [[ ${#translated_pkgs[@]} -gt 0 ]]; then
        readarray -t unique_pkgs < <(printf '%s\n' "${translated_pkgs[@]}" | sort -u)
    fi

    if [[ ${#unique_pkgs[@]} -gt 0 ]]; then
        if [[ "${PKG_MANAGER}" == "apt" ]]; then
            DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "${unique_pkgs[@]}"
        elif [[ "${PKG_MANAGER}" == "dnf" ]]; then
            dnf install -y -q "${unique_pkgs[@]}"
        fi
    fi
}

openmailstack_install_optional_packages() {
    local pkg t_pkg
    for pkg in "$@"; do
        t_pkg="$(openmailstack_translate_pkg "${pkg}")"
        for p in $t_pkg; do
            if ! openmailstack_package_exists "${p}"; then
                openmailstack_record_soft_error "Optional package '${p}' is not available on ${OPENMAILSTACK_OS_LABEL:-current platform}; skipping."
                continue
            fi

            if [[ "${PKG_MANAGER}" == "apt" ]]; then
                if ! DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "${p}"; then
                    openmailstack_record_soft_error "Optional package '${p}' failed to install; continuing."
                fi
            elif [[ "${PKG_MANAGER}" == "dnf" ]]; then
                if ! dnf install -y -q "${p}"; then
                    openmailstack_record_soft_error "Optional package '${p}' failed to install; continuing."
                fi
            fi
        done
    done
}

openmailstack_base_packages() {
    local packages=(
        curl
        wget
        sudo
        ca-certificates
        dnsutils
        unzip
        tar
    )

    if [[ "${PKG_MANAGER}" == "apt" ]]; then
        packages+=(lsb-release software-properties-common net-tools)
        case "$(openmailstack_platform_key)" in
            debian-11|debian-12|debian-13) packages+=(gnupg2) ;;
            ubuntu-22|ubuntu-24|ubuntu-25) packages+=(gnupg) ;;
        esac
        if openmailstack_package_exists "apt-transport-https"; then
            packages+=(apt-transport-https)
        fi
    elif [[ "${PKG_MANAGER}" == "dnf" ]]; then
        packages+=(bind-utils net-tools policycoreutils-python-utils epel-release)
    fi

    printf '%s\n' "${packages[@]}"
}

openmailstack_expected_php_version() {
    if [[ "${PKG_MANAGER}" == "dnf" ]]; then
        echo "8.2" # We will install Remi 8.2 explicitly
        return
    fi
    case "$(openmailstack_platform_key)" in
        debian-11) echo "7.4" ;;
        debian-12) echo "8.2" ;;
        debian-13) echo "8.4" ;;
        ubuntu-22) echo "8.1" ;;
        ubuntu-24) echo "8.3" ;;
        ubuntu-25) echo "8.4" ;;
        *) echo "" ;;
    esac
}

openmailstack_php_fpm_service() {
    local expected_version
    expected_version="$(openmailstack_expected_php_version)"

    if [[ "${PKG_MANAGER}" == "dnf" ]]; then
        if systemctl list-unit-files | grep -q "^php-fpm\.service"; then
            echo "php-fpm.service"
            return 0
        fi
    else
        if [[ -n "${expected_version}" ]] && systemctl list-unit-files | grep -q "^php${expected_version}-fpm\.service"; then
            echo "php${expected_version}-fpm.service"
            return 0
        fi

        if command -v php >/dev/null 2>&1; then
            local runtime_version
            runtime_version="$(php -r 'echo PHP_MAJOR_VERSION.".".PHP_MINOR_VERSION;' 2>/dev/null || true)"
            if [[ -n "${runtime_version}" ]] && systemctl list-unit-files | grep -q "^php${runtime_version}-fpm\.service"; then
                echo "php${runtime_version}-fpm.service"
                return 0
            fi
        fi

        systemctl list-unit-files | awk '/^php[0-9]+\.[0-9]+-fpm\.service/ {print $1}' | head -n 1
    fi
}

openmailstack_php_fpm_socket() {
    local expected_version
    expected_version="$(openmailstack_expected_php_version)"

    if [[ "${PKG_MANAGER}" == "dnf" ]]; then
        if [[ -S "/run/php-fpm/www.sock" ]]; then
            echo "/run/php-fpm/www.sock"
            return 0
        fi
    else
        if [[ -n "${expected_version}" && -S "/run/php/php${expected_version}-fpm.sock" ]]; then
            echo "/run/php/php${expected_version}-fpm.sock"
            return 0
        fi

        if command -v php >/dev/null 2>&1; then
            local runtime_version
            runtime_version="$(php -r 'echo PHP_MAJOR_VERSION.".".PHP_MINOR_VERSION;' 2>/dev/null || true)"
            if [[ -n "${runtime_version}" && -S "/run/php/php${runtime_version}-fpm.sock" ]]; then
                echo "/run/php/php${runtime_version}-fpm.sock"
                return 0
            fi
        fi

        find /run/php -maxdepth 1 -type s -name "php*-fpm.sock" | sort | head -n 1
    fi
}

openmailstack_rspamd_repo_codename() {
    if [[ "${PKG_MANAGER}" == "dnf" ]]; then
        echo "${OPENMAILSTACK_OS_MAJOR}"
        return
    fi
    case "$(openmailstack_platform_key)" in
        debian-11) echo "bullseye" ;;
        debian-12) echo "bookworm" ;;
        debian-13) echo "trixie" ;;
        *) echo "${OPENMAILSTACK_OS_CODENAME}" ;;
    esac
}

#!/usr/bin/env bash

# Shared OS detection helpers for OpenMailStack modules.
# Exports:
# - OPENMAILSTACK_OS_ID            (ubuntu|debian|...)
# - OPENMAILSTACK_OS_VERSION_ID    (24.04, 12, 13, ...)
# - OPENMAILSTACK_OS_MAJOR         (24, 12, 13, ...)
# - OPENMAILSTACK_OS_CODENAME      (noble, bookworm, ...)
# - OPENMAILSTACK_OS_LABEL         (Ubuntu 24.04, Debian 12, ...)

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

    case "${OPENMAILSTACK_OS_ID}" in
        ubuntu)
            OPENMAILSTACK_OS_LABEL="Ubuntu ${OPENMAILSTACK_OS_VERSION_ID}"
            ;;
        debian)
            OPENMAILSTACK_OS_LABEL="Debian ${OPENMAILSTACK_OS_VERSION_ID}"
            ;;
        *)
            OPENMAILSTACK_OS_LABEL="${OPENMAILSTACK_OS_ID} ${OPENMAILSTACK_OS_VERSION_ID}"
            ;;
    esac

    export OPENMAILSTACK_OS_ID
    export OPENMAILSTACK_OS_VERSION_ID
    export OPENMAILSTACK_OS_MAJOR
    export OPENMAILSTACK_OS_CODENAME
    export OPENMAILSTACK_OS_LABEL
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
    echo "${OPENMAILSTACK_OS_ID:-unknown}-${OPENMAILSTACK_OS_VERSION_ID:-unknown}"
}

openmailstack_require_supported_platform() {
    case "$(openmailstack_platform_key)" in
        debian-11|debian-12|debian-13|ubuntu-22.04|ubuntu-24.04|ubuntu-25.04)
            return 0
            ;;
        *)
            echo "Error: Unsupported OS version: ${OPENMAILSTACK_OS_LABEL:-unknown}." >&2
            echo "Supported platforms: Debian 11/12/13, Ubuntu 22.04/24.04/25.04." >&2
            return 1
            ;;
    esac
}

openmailstack_package_exists() {
    local pkg="${1}"
    apt-cache show "${pkg}" >/dev/null 2>&1
}

openmailstack_package_installed() {
    local pkg="${1}"
    dpkg-query -W -f='${Status}' "${pkg}" 2>/dev/null | grep -q "install ok installed"
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

openmailstack_install_required_packages() {
    local missing=()
    local pkg

    for pkg in "$@"; do
        if ! openmailstack_package_exists "${pkg}"; then
            missing+=("${pkg}")
        fi
    done

    if [[ ${#missing[@]} -gt 0 ]]; then
        echo "Error: Required packages unavailable on ${OPENMAILSTACK_OS_LABEL:-current platform}: ${missing[*]}" >&2
        return 1
    fi

    apt-get install -y -qq "$@"
}

openmailstack_install_optional_packages() {
    local pkg
    for pkg in "$@"; do
        if ! openmailstack_package_exists "${pkg}"; then
            openmailstack_record_soft_error "Optional package '${pkg}' is not available on ${OPENMAILSTACK_OS_LABEL:-current platform}; skipping."
            continue
        fi

        if ! apt-get install -y -qq "${pkg}"; then
            openmailstack_record_soft_error "Optional package '${pkg}' failed to install on ${OPENMAILSTACK_OS_LABEL:-current platform}; continuing."
        fi
    done
}

openmailstack_base_packages() {
    local packages=(
        curl
        wget
        sudo
        ca-certificates
        lsb-release
        software-properties-common
        dnsutils
        net-tools
        unzip
    )

    case "$(openmailstack_platform_key)" in
        debian-11|debian-12|debian-13)
            packages+=(gnupg2)
            ;;
        ubuntu-22.04|ubuntu-24.04|ubuntu-25.04)
            packages+=(gnupg)
            ;;
    esac

    # Transitional package; available on some distributions only.
    if openmailstack_package_exists "apt-transport-https"; then
        packages+=(apt-transport-https)
    fi

    printf '%s\n' "${packages[@]}"
}

openmailstack_expected_php_version() {
    case "$(openmailstack_platform_key)" in
        debian-11) echo "7.4" ;;
        debian-12) echo "8.2" ;;
        debian-13) echo "8.4" ;;
        ubuntu-22.04) echo "8.1" ;;
        ubuntu-24.04) echo "8.3" ;;
        ubuntu-25.04) echo "8.4" ;;
        *) echo "" ;;
    esac
}

openmailstack_php_fpm_service() {
    local expected_version
    expected_version="$(openmailstack_expected_php_version)"

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
}

openmailstack_php_fpm_socket() {
    local expected_version
    expected_version="$(openmailstack_expected_php_version)"

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
}

openmailstack_rspamd_repo_codename() {
    case "$(openmailstack_platform_key)" in
        debian-11) echo "bullseye" ;;
        debian-12) echo "bookworm" ;;
        debian-13) echo "trixie" ;;
        ubuntu-22.04) echo "jammy" ;;
        ubuntu-24.04) echo "noble" ;;
        ubuntu-25.04) echo "plucky" ;;
        *)
            # Fallback to detected codename for forward compatibility.
            echo "${OPENMAILSTACK_OS_CODENAME}"
            ;;
    esac
}

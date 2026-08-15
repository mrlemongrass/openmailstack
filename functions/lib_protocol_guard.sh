#!/usr/bin/env bash

protocol_read_release_version() {
    local version_file="$1"
    local version

    [[ -f "${version_file}" && ! -L "${version_file}" ]] || return 1
    version=$(<"${version_file}") || return 1
    version="${version#"${version%%[![:space:]]*}"}"
    version="${version%"${version##*[![:space:]]}"}"
    [[ "${version}" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$ ]] || return 1
    printf '%s\n' "${version}"
}

protocol_version_file_matches() {
    local expected_version="$1"
    local version_file="$2"
    local actual_version

    actual_version=$(protocol_read_release_version "${version_file}") || return 1
    [[ "${actual_version}" == "${expected_version}" ]]
}

# Resolve a live directory without allowing lexical traversal or symlink escapes.
# The resolved directory must be a strict descendant of the allowed parent.
protocol_safe_directory() {
    local candidate="${1%/}"
    local allowed_parent="${2%/}"
    local label="$3"
    local candidate_real
    local parent_real

    [[ "${candidate}" == /* ]] || {
        echo "Error: ${label} must be an absolute path" >&2
        return 1
    }
    [[ -d "${candidate}" && ! -L "${candidate}" ]] || {
        echo "Error: ${label} must be an existing non-symlink directory" >&2
        return 1
    }
    [[ -d "${allowed_parent}" && ! -L "${allowed_parent}" ]] || {
        echo "Error: allowed parent for ${label} is unavailable" >&2
        return 1
    }

    candidate_real=$(readlink -f -- "${candidate}") || return 1
    parent_real=$(readlink -f -- "${allowed_parent}") || return 1
    [[ "${candidate}" == "${candidate_real}" ]] || {
        echo "Error: ${label} must be canonical and contain no symlink or traversal components" >&2
        return 1
    }
    [[ "${allowed_parent}" == "${parent_real}" ]] || {
        echo "Error: allowed parent for ${label} must be canonical" >&2
        return 1
    }
    [[ "${candidate_real}" == "${parent_real}/"* ]] || {
        echo "Error: ${label} must remain below ${allowed_parent}" >&2
        return 1
    }

    printf '%s\n' "${candidate_real}"
}

protocol_secure_directory_metadata() {
    local path_to_check="${1%/}"
    local label="$2"
    local required_uid="${3:-0}"
    local mode
    local mode_value

    [[ "${path_to_check}" == /* && -d "${path_to_check}" && ! -L "${path_to_check}" ]] || {
        echo "Error: ${label} must be an absolute, existing non-symlink directory" >&2
        return 1
    }
    [[ "$(readlink -f -- "${path_to_check}")" == "${path_to_check}" ]] || {
        echo "Error: ${label} must be canonical" >&2
        return 1
    }
    [[ "$(stat -c '%u' -- "${path_to_check}")" == "${required_uid}" ]] || {
        echo "Error: ${label} must have the required owner" >&2
        return 1
    }
    mode=$(stat -c '%a' -- "${path_to_check}") || return 1
    mode_value=$((8#${mode}))
    (( (mode_value & 8#022) == 0 )) || {
        echo "Error: ${label} must not be group/other writable" >&2
        return 1
    }
}

protocol_safe_root_directory() {
    local candidate="$1"
    local allowed_parent="$2"
    local label="$3"
    local required_uid="${4:-0}"
    local resolved

    resolved=$(protocol_safe_directory "${candidate}" "${allowed_parent}" "${label}") || return 1
    protocol_secure_directory_metadata "${allowed_parent}" "allowed parent for ${label}" "${required_uid}" || return 1
    [[ "$(dirname -- "${resolved}")" == "$(readlink -f -- "${allowed_parent}")" ]] || {
        echo "Error: ${label} must be a direct child of ${allowed_parent}" >&2
        return 1
    }
    protocol_secure_directory_metadata "${resolved}" "${label}" "${required_uid}" || return 1

    printf '%s\n' "${resolved}"
}

protocol_prepare_secure_directory() {
    local candidate="${1%/}"
    local allowed_parent="${2%/}"
    local label="$3"
    local required_uid="${4:-0}"
    local candidate_resolved
    local parent_resolved

    protocol_secure_directory_metadata "${allowed_parent}" "allowed parent for ${label}" "${required_uid}" || return 1
    parent_resolved=$(readlink -f -- "${allowed_parent}") || return 1
    candidate_resolved=$(readlink -m -- "${candidate}") || return 1
    [[ "${candidate}" == "${candidate_resolved}" && "$(dirname -- "${candidate_resolved}")" == "${parent_resolved}" ]] || {
        echo "Error: ${label} must be a canonical direct child of ${allowed_parent}" >&2
        return 1
    }
    if [[ -e "${candidate}" || -L "${candidate}" ]]; then
        [[ -d "${candidate}" && ! -L "${candidate}" ]] || {
            echo "Error: ${label} already exists with an unsafe type" >&2
            return 1
        }
    else
        mkdir -m 0755 -- "${candidate}" || return 1
    fi
    protocol_secure_directory_metadata "${candidate}" "${label}" "${required_uid}" || return 1
    printf '%s\n' "${candidate}"
}

protocol_validate_lock_file() {
    local lock_file="$1"
    local required_uid="${2:-0}"

    if [[ -e "${lock_file}" || -L "${lock_file}" ]]; then
        [[ -f "${lock_file}" && ! -L "${lock_file}" ]] || return 1
        [[ "$(stat -c '%u' -- "${lock_file}")" == "${required_uid}" ]] || return 1
    fi
}

# Apply a requested snapshot only after the current state has been captured.
# Return 20 when the requested snapshot failed but recovery succeeded. Return
# 30 or 31 when recovery itself failed.
protocol_run_reversible_restore() {
    local requested_snapshot="$1"
    local prepare_callback="$2"
    local apply_callback="$3"
    local validate_callback="$4"
    local recover_callback="$5"
    local validate_recovered_callback="$6"

    "${prepare_callback}" || return 10
    if "${apply_callback}" "${requested_snapshot}" && "${validate_callback}"; then
        return 0
    fi
    "${recover_callback}" || return 30
    "${validate_recovered_callback}" || return 31
    return 20
}

protocol_recover_after_interruption() {
    local rollback_ready="$1"
    local deploy_complete="$2"
    local recover_callback="$3"
    local validate_recovered_callback="${4:-}"

    if [[ "${rollback_ready}" == "1" && "${deploy_complete}" != "1" ]]; then
        "${recover_callback}" || return 1
        if [[ -n "${validate_recovered_callback}" ]]; then
            "${validate_recovered_callback}" || return 2
        fi
    fi
    return 0
}

protocol_acquire_lock() {
    local lock_fd="$1"
    flock -n "${lock_fd}"
}

#!/usr/bin/env bash

protocol_pending_validate_run_id() {
    [[ "${1:-}" =~ ^[0-9a-f]{24}$ ]]
}

protocol_pending_prepare_directory() {
    local pending_dir="${1%/}"
    local allowed_parent="${2%/}"
    local required_uid="${3:-0}"
    local pending_real
    local parent_real

    [[ "${pending_dir}" == /* && "${allowed_parent}" == /* ]] || return 1
    [[ -d "${allowed_parent}" && ! -L "${allowed_parent}" ]] || return 1
    parent_real=$(readlink -f -- "${allowed_parent}") || return 1
    [[ "${allowed_parent}" == "${parent_real}" ]] || return 1
    [[ "$(stat -c '%u' -- "${allowed_parent}")" == "${required_uid}" ]] || return 1
    if [[ -e "${pending_dir}" || -L "${pending_dir}" ]]; then
        [[ -d "${pending_dir}" && ! -L "${pending_dir}" ]] || return 1
    else
        install -d -o "${required_uid}" -g "${required_uid}" -m 0700 -- "${pending_dir}" || return 1
    fi
    pending_real=$(readlink -f -- "${pending_dir}") || return 1
    [[ "${pending_dir}" == "${pending_real}"
        && "$(dirname -- "${pending_real}")" == "${parent_real}" ]] || return 1
    [[ "$(stat -c '%u:%g:%a' -- "${pending_dir}")" == "${required_uid}:${required_uid}:700" ]] || return 1
    sync -f "${pending_dir}" || return 1
    sync -f "${allowed_parent}" || return 1
    printf '%s\n' "${pending_real}"
}

protocol_pending_list_run_ids() {
    local pending_dir="${1%/}"
    local required_uid="${2:-0}"
    local marker
    local run_id
    local markers=()
    local run_ids=()

    [[ -d "${pending_dir}" && ! -L "${pending_dir}" ]] || return 1
    shopt -s nullglob
    markers=("${pending_dir}"/*.pending)
    shopt -u nullglob
    for marker in "${markers[@]}"; do
        [[ -f "${marker}" && ! -L "${marker}" ]] || return 1
        [[ "$(stat -c '%u:%g:%a' -- "${marker}")" == "${required_uid}:${required_uid}:600" ]] || return 1
        run_id=$(basename -- "${marker}")
        run_id=${run_id%.pending}
        protocol_pending_validate_run_id "${run_id}" || return 1
        [[ "$(<"${marker}")" == "${run_id}" ]] || return 1
        run_ids+=("${run_id}")
    done
    if (( ${#run_ids[@]} > 0 )); then
        printf '%s\n' "${run_ids[@]}" | LC_ALL=C sort
    fi
}

protocol_pending_persist_run() {
    local pending_dir="${1%/}"
    local run_id="$2"
    local required_uid="${3:-0}"
    local marker
    local temporary

    protocol_pending_validate_run_id "${run_id}" || return 1
    [[ -d "${pending_dir}" && ! -L "${pending_dir}" ]] || return 1
    marker="${pending_dir}/${run_id}.pending"
    temporary="${pending_dir}/.${run_id}.$$.$RANDOM.tmp"
    [[ ! -e "${temporary}" && ! -L "${temporary}" ]] || return 1
    install -o "${required_uid}" -g "${required_uid}" -m 0600 /dev/null "${temporary}" || return 1
    if ! printf '%s\n' "${run_id}" >"${temporary}"; then
        rm -f -- "${temporary}"
        return 1
    fi
    if ! sync -f "${temporary}"; then
        rm -f -- "${temporary}"
        return 1
    fi
    if ! mv -fT -- "${temporary}" "${marker}"; then
        rm -f -- "${temporary}"
        return 1
    fi
    sync -f "${pending_dir}" || return 1
    [[ -f "${marker}" && ! -L "${marker}"
        && "$(stat -c '%u:%g:%a' -- "${marker}")" == "${required_uid}:${required_uid}:600"
        && "$(<"${marker}")" == "${run_id}" ]]
}

protocol_pending_clear_run() {
    local pending_dir="${1%/}"
    local run_id="$2"
    local required_uid="${3:-0}"
    local marker

    protocol_pending_validate_run_id "${run_id}" || return 1
    marker="${pending_dir}/${run_id}.pending"
    if [[ ! -e "${marker}" && ! -L "${marker}" ]]; then
        return 0
    fi
    [[ -f "${marker}" && ! -L "${marker}"
        && "$(stat -c '%u:%g:%a' -- "${marker}")" == "${required_uid}:${required_uid}:600"
        && "$(<"${marker}")" == "${run_id}" ]] || return 1
    rm -f -- "${marker}" || return 1
    sync -f "${pending_dir}"
}

protocol_pending_sweep_runs() {
    local pending_dir="${1%/}"
    local cleanup_callback="$2"
    local required_uid="${3:-0}"
    local run_id
    local cleanup_failed=0
    local pending_output=''
    local pending_ids=()

    pending_output=$(protocol_pending_list_run_ids "${pending_dir}" "${required_uid}") || return 1
    if [[ -n "${pending_output}" ]]; then
        mapfile -t pending_ids <<<"${pending_output}"
    fi
    for run_id in "${pending_ids[@]}"; do
        if "${cleanup_callback}" "${run_id}"; then
            protocol_pending_clear_run "${pending_dir}" "${run_id}" "${required_uid}" || cleanup_failed=1
        else
            cleanup_failed=1
        fi
    done
    (( cleanup_failed == 0 ))
}

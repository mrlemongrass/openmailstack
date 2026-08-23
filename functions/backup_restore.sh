#!/usr/bin/env bash

# OpenMailStack disaster-recovery snapshots.
#
# This file is sourced by install.sh and can also be invoked directly:
#   backup_restore.sh backup
#   backup_restore.sh verify /var/backups/openmailstack/oms-backup-<UTC timestamp>
#   backup_restore.sh restore /var/backups/openmailstack/oms-backup-<UTC timestamp> --confirm
#
# Snapshots are logical full backups. They are checksummed but are not encrypted,
# signed, incremental, or point-in-time-recovery archives. Restore drops and
# recreates the listed OMS databases, but does not remove unrelated databases or
# restore MariaDB system schemas, accounts, or package-managed MariaDB config.

OMS_BR_SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
OMS_BR_REPO_ROOT=$(cd "${OMS_BR_SCRIPT_DIR}/.." && pwd -P)
OMS_BR_DEFAULT_INSTALL_CONFIG="${OMS_BR_REPO_ROOT}/config.conf"

oms_br_error() {
    echo "Error: $*" >&2
}

oms_br_fail() {
    oms_br_error "$*"
    return 1
}

oms_br_require_root() {
    [[ ${EUID} -eq 0 ]] || oms_br_fail "Backup and restore must run as root"
}

oms_br_reject_unsafe_text() {
    local value="$1"
    local label="$2"
    [[ -n "${value}" && "${value}" != *$'\n'* && "${value}" != *$'\t'* ]] \
        || oms_br_fail "${label} is empty or contains unsupported control characters"
}

oms_br_assert_absolute_bounded_path() {
    local path="$1"
    local label="$2"
    [[ "${path}" == /* && "${path}" != "/" && "${path}" != *$'\n'* ]] \
        || { oms_br_fail "${label} must be a bounded absolute path"; return 1; }
    [[ "${path}" != */../* && "${path}" != */.. && "${path}" != *'/./'* ]] \
        || { oms_br_fail "${label} contains traversal components"; return 1; }
}

oms_br_assert_no_symlink_components() {
    local path="$1"
    local current=""
    local component
    local -a components=()

    IFS='/' read -r -a components <<< "${path#/}"
    for component in "${components[@]}"; do
        [[ -n "${component}" ]] || continue
        current="${current}/${component}"
        if [[ -L "${current}" ]]; then
            oms_br_fail "Path contains a symlink component: ${current}"
            return 1
        fi
        [[ -e "${current}" ]] || break
    done
}

oms_br_assert_root_owned_nonwritable_directory() {
    local path="$1"
    local label="$2"
    local mode
    local mode_value

    [[ -d "${path}" && ! -L "${path}" ]] \
        || { oms_br_fail "${label} must be a real directory"; return 1; }
    [[ "$(stat -c '%u' -- "${path}")" == "0" ]] \
        || { oms_br_fail "${label} must be owned by root"; return 1; }
    mode=$(stat -c '%a' -- "${path}") || return 1
    mode_value=$((8#${mode}))
    (( (mode_value & 8#022) == 0 )) \
        || { oms_br_fail "${label} must not be group/world writable"; return 1; }
}

oms_br_prepare_secure_directory() {
    local path="$1"
    local label="$2"
    local parent

    oms_br_assert_absolute_bounded_path "${path}" "${label}" || return 1
    oms_br_assert_no_symlink_components "${path}" || return 1
    parent=$(dirname -- "${path}")
    [[ -d "${parent}" && ! -L "${parent}" ]] || return 1
    oms_br_assert_root_owned_nonwritable_directory "${parent}" "${label} parent" || return 1

    if [[ ! -e "${path}" ]]; then
        install -d -o root -g root -m 0700 -- "${path}" || return 1
    fi
    [[ -d "${path}" && ! -L "${path}" ]] \
        || { oms_br_fail "${label} must be a real directory"; return 1; }
    [[ "$(stat -c '%u' -- "${path}")" == "0" ]] \
        || { oms_br_fail "${label} must be owned by root"; return 1; }
    chmod 0700 -- "${path}" || return 1
    [[ "$(stat -c '%a' -- "${path}")" == "700" ]] \
        || { oms_br_fail "${label} must have mode 0700"; return 1; }
}

oms_br_backup_root() {
    printf '%s\n' "${OMS_BACKUP_ROOT:-/var/backups/openmailstack}"
}

oms_br_path_prefix() {
    local prefix="${OMS_BACKUP_PATH_PREFIX:-}"
    if [[ "${OMS_BACKUP_FIXTURE_MODE:-0}" == "1" ]]; then
        [[ -n "${prefix}" ]] || return 1
        oms_br_assert_absolute_bounded_path "${prefix}" "fixture path prefix" || return 1
        printf '%s\n' "${prefix%/}"
        return 0
    fi
    [[ -z "${prefix}" ]] \
        || { oms_br_fail "OMS_BACKUP_PATH_PREFIX is fixture-only"; return 1; }
    printf '%s\n' ''
}

oms_br_actual_path() {
    local key="$1"
    local logical_path="$2"
    local prefix

    if [[ "${key}" == "installer-config" ]]; then
        printf '%s\n' "${OMS_BACKUP_INSTALL_CONFIG:-${OMS_BR_DEFAULT_INSTALL_CONFIG}}"
        return 0
    fi
    prefix=$(oms_br_path_prefix) || return 1
    printf '%s%s\n' "${prefix}" "${logical_path}"
}

oms_br_inventory_specs() {
    cat <<'EOF'
mail-store	/var/vmail	directory
postfix-spool	/var/spool/postfix	directory
oms-config	/etc/openmailstack	directory
postfix-config	/etc/postfix	directory
dovecot-config	/etc/dovecot	directory
dovecot-fallback-cert	/etc/ssl/certs/ssl-cert-snakeoil.pem	file
dovecot-fallback-key	/etc/ssl/private/ssl-cert-snakeoil.key	file
nginx-config	/etc/nginx	directory
rspamd-config	/etc/rspamd	directory
dkim-keys	/var/lib/rspamd/dkim	directory
tls-letsencrypt	/etc/letsencrypt	directory
tls-openmailstack	/etc/ssl/openmailstack	directory
modern-backend	/opt/openmailstack-backend	directory
modern-frontend	/var/www/openmailstack	directory
postfixadmin	/var/www/postfixadmin	directory
roundcube	/var/www/roundcube	directory
admin-portal	/var/www/openmailstack-admin	directory
oms-state	/var/lib/openmailstack	directory
dovecot-systemd-dropins	/etc/systemd/system/dovecot.service.d	directory
fail2ban-config	/etc/fail2ban	directory
monit-debian-config	/etc/monit	directory
monit-rhel-config	/etc/monit.d	directory
backend-unit	/etc/systemd/system/openmailstack.service	file
scheduler-unit	/etc/systemd/system/openmailstack-scheduler-worker.service	file
dkim-sync-unit	/etc/systemd/system/openmailstack-dkim-sync.service	file
dkim-sync-timer	/etc/systemd/system/openmailstack-dkim-sync.timer	file
spam-map-unit	/etc/systemd/system/openmailstack-spam-map-sync.service	file
spam-map-timer	/etc/systemd/system/openmailstack-spam-map-sync.timer	file
rspamd-health-unit	/etc/systemd/system/openmailstack-rspamd-health.service	file
rspamd-health-timer	/etc/systemd/system/openmailstack-rspamd-health.timer	file
remediate-script	/usr/local/sbin/openmailstack-remediate	file
dkim-sync-script	/usr/local/sbin/openmailstack-dkim-sync	file
spam-map-script	/usr/local/sbin/openmailstack-spam-map-sync	file
rspamd-health-script	/usr/local/sbin/openmailstack-rspamd-health	file
rspamd-recover-script	/usr/local/sbin/openmailstack-rspamd-recover	file
quarantine-filter	/usr/local/bin/quarantine_filter.php	file
remediate-sudoers	/etc/sudoers.d/openmailstack-remediate	file
EOF
    printf 'installer-config\t%s\tfile\n' "${OMS_BACKUP_INSTALL_CONFIG:-${OMS_BR_DEFAULT_INSTALL_CONFIG}}"
}

oms_br_database_names() {
    local raw_names
    local name
    local -a names=()
    local -A seen=()

    if [[ -n "${OMS_BACKUP_DATABASES:-}" ]]; then
        raw_names="${OMS_BACKUP_DATABASES}"
    else
        raw_names="${VMAIL_DB_NAME:-vmail} ${POSTFIXADMIN_DB_NAME:-postfixadmin}"
        raw_names+=" ${ROUNDCUBE_DB_NAME:-roundcube}"
        raw_names+=" ${OMS_DB_NAME:-${POSTFIXADMIN_DB_NAME:-postfixadmin}}"
    fi
    oms_br_reject_unsafe_text "${raw_names}" "database allowlist" || return 1
    read -r -a names <<< "${raw_names}"
    [[ ${#names[@]} -gt 0 ]] || return 1
    for name in "${names[@]}"; do
        [[ "${name}" =~ ^[A-Za-z0-9_][A-Za-z0-9_\$-]*$ ]] \
            || { oms_br_fail "Unsupported database name in backup allowlist: ${name}"; return 1; }
        if [[ -z "${seen[${name}]+x}" ]]; then
            printf '%s\n' "${name}"
            seen["${name}"]=1
        fi
    done
}

oms_br_write_database_manifest() {
    local output_file="$1"
    local unsorted_file="${output_file}.unsorted"

    oms_br_database_names > "${unsorted_file}" || return 1
    LC_ALL=C sort -- "${unsorted_file}" > "${output_file}" || return 1
    rm -f -- "${unsorted_file}" || return 1
    [[ -s "${output_file}" ]] || return 1
}

oms_br_mutation_units() {
    cat <<'EOF'
monit.service
certbot.timer
openmailstack-rspamd-health.timer
openmailstack-spam-map-sync.timer
openmailstack-dkim-sync.timer
openmailstack-rspamd-health.service
openmailstack-spam-map-sync.service
openmailstack-dkim-sync.service
nginx.service
postfix.service
openmailstack-scheduler-worker.service
openmailstack.service
dovecot.service
rspamd.service
EOF
}

oms_br_require_command() {
    local configured="$1"
    local fallback="$2"
    local label="$3"
    local resolved

    if [[ -n "${configured}" ]]; then
        resolved="${configured}"
    else
        resolved=$(command -v "${fallback}") \
            || return 1
    fi
    [[ "${resolved}" == /* ]] \
        || { oms_br_fail "${label} is unavailable or unsafe: ${resolved}"; return 1; }
    resolved=$(readlink -f -- "${resolved}") || return 1
    [[ -x "${resolved}" && ! -d "${resolved}" ]] \
        || { oms_br_fail "${label} is unavailable or unsafe: ${resolved}"; return 1; }
    printf '%s\n' "${resolved}"
}

oms_br_systemctl_bin() {
    oms_br_require_command "${OMS_BACKUP_SYSTEMCTL_BIN:-}" systemctl systemctl
}

oms_br_mysqldump_bin() {
    local resolved
    if [[ -n "${OMS_BACKUP_MYSQLDUMP_BIN:-}" ]]; then
        oms_br_require_command "${OMS_BACKUP_MYSQLDUMP_BIN}" mariadb-dump database-dump \
            || return 1
        return 0
    fi
    if resolved=$(command -v mariadb-dump); then
        oms_br_require_command "${resolved}" mariadb-dump database-dump
    else
        oms_br_require_command '' mysqldump database-dump
    fi
}

oms_br_mysql_bin() {
    local resolved
    if [[ -n "${OMS_BACKUP_MYSQL_BIN:-}" ]]; then
        oms_br_require_command "${OMS_BACKUP_MYSQL_BIN}" mariadb database-client \
            || return 1
        return 0
    fi
    if resolved=$(command -v mariadb); then
        oms_br_require_command "${resolved}" mariadb database-client
    else
        oms_br_require_command '' mysql database-client
    fi
}

oms_br_rsync_bin() {
    oms_br_require_command "${OMS_BACKUP_RSYNC_BIN:-}" rsync rsync
}

oms_br_python_bin() {
    oms_br_require_command "${OMS_BACKUP_PYTHON_BIN:-}" python3 python3
}

oms_br_mail_store_move_watch_script() {
    local script_path="${OMS_BR_SCRIPT_DIR}/mail_store_move_watch.py"

    [[ -f "${script_path}" && ! -L "${script_path}" && -r "${script_path}" ]] \
        || { oms_br_fail "Mail-store move watcher is unavailable: ${script_path}"; return 1; }
    printf '%s\n' "${script_path}"
}

oms_br_random_watch_token() {
    local token

    token=$(od -An -N16 -tx1 /dev/urandom | tr -d '[:space:]') || return 1
    [[ "${token}" =~ ^[0-9a-f]{32}$ ]] || return 1
    printf '%s\n' "${token}"
}

oms_br_create_mail_store_watch_sentinel() {
    local sentinel_path="$1"
    local sentinel_token="$2"
    local python_bin
    local watch_script

    [[ "${sentinel_token}" =~ ^[0-9a-f]{32}$ ]] || return 1
    python_bin=$(oms_br_python_bin) || return 1
    watch_script=$(oms_br_mail_store_move_watch_script) || return 1
    printf '%s\n' "${sentinel_token}" \
        | "${python_bin}" "${watch_script}" --create-sentinel "${sentinel_path}"
}

oms_br_check_process_signaling_support() {
    local python_bin
    local watch_script

    python_bin=$(oms_br_python_bin) || return 1
    watch_script=$(oms_br_mail_store_move_watch_script) || return 1
    "${python_bin}" "${watch_script}" --check-process-signaling
}

declare -a OMS_BR_ACTIVE_UNITS=()
OMS_BR_SERVICES_QUIESCED=0
OMS_BR_MAIL_STORE_WATCH_PID=""
OMS_BR_MAIL_STORE_WATCH_START_TIME=""
OMS_BR_MAIL_STORE_WATCH_STAGING=""
OMS_BR_MAIL_STORE_WATCH_SOURCE=""
OMS_BR_MAIL_STORE_WATCH_CONTROL=""
OMS_BR_MAIL_STORE_WATCH_SENTINEL=""
OMS_BR_MAIL_STORE_WATCH_SENTINEL_ID=""
OMS_BR_MAIL_STORE_WATCH_EXIT_STATUS=""
OMS_BR_MAIL_STORE_WATCH_REPORTED_PID=""
OMS_BR_MAIL_STORE_WATCH_REPORTED_START_TIME=""
OMS_BR_PROCESS_STATE=""
OMS_BR_PROCESS_START_TIME=""
OMS_BR_EXACT_LINE_COUNT=0

oms_br_unit_state() {
    local systemctl_bin="$1"
    local property="$2"
    local unit="$3"
    "${systemctl_bin}" show --property="${property}" --value "${unit}"
}

oms_br_record_active_services() {
    local systemctl_bin
    local unit
    local load_state
    local active_state

    systemctl_bin=$(oms_br_systemctl_bin) || return 1
    OMS_BR_ACTIVE_UNITS=()
    while IFS= read -r unit; do
        [[ -n "${unit}" ]] || continue
        load_state=$(oms_br_unit_state "${systemctl_bin}" LoadState "${unit}") \
            || return 1
        case "${load_state}" in
            not-found) continue ;;
            loaded) ;;
            *) return 1 ;;
        esac
        active_state=$(oms_br_unit_state "${systemctl_bin}" ActiveState "${unit}") \
            || return 1
        case "${active_state}" in
            active) OMS_BR_ACTIVE_UNITS+=("${unit}") ;;
            inactive|failed) ;;
            *) oms_br_fail "Service ${unit} is in unstable state ${active_state}"; return 1 ;;
        esac
    done < <(oms_br_mutation_units)
}

oms_br_unit_was_active() {
    local wanted="$1"
    local unit
    for unit in "${OMS_BR_ACTIVE_UNITS[@]}"; do
        [[ "${unit}" == "${wanted}" ]] && return 0
    done
    return 1
}

oms_br_quiesce_services() {
    local systemctl_bin
    local unit
    local active_state

    systemctl_bin=$(oms_br_systemctl_bin) || return 1
    OMS_BR_SERVICES_QUIESCED=1
    for unit in "${OMS_BR_ACTIVE_UNITS[@]}"; do
        active_state=$(oms_br_unit_state "${systemctl_bin}" ActiveState "${unit}") \
            || return 1
        if [[ "${active_state}" == "active" ]]; then
            "${systemctl_bin}" stop "${unit}" || return 1
        elif [[ "${active_state}" != "inactive" && "${active_state}" != "failed" ]]; then
            return 1
        fi
        active_state=$(oms_br_unit_state "${systemctl_bin}" ActiveState "${unit}") \
            || return 1
        [[ "${active_state}" != "active" ]] \
            || { oms_br_fail "Service remained active after stop: ${unit}"; return 1; }
    done
}

oms_br_resume_services() {
    local systemctl_bin
    local index
    local unit
    local active_state
    local status=0

    systemctl_bin=$(oms_br_systemctl_bin) || return 1
    "${systemctl_bin}" daemon-reload || status=1
    for ((index=${#OMS_BR_ACTIVE_UNITS[@]} - 1; index >= 0; index -= 1)); do
        unit="${OMS_BR_ACTIVE_UNITS[index]}"
        if ! active_state=$(oms_br_unit_state "${systemctl_bin}" ActiveState "${unit}"); then
            oms_br_error "Could not read service state while resuming ${unit}"
            status=1
            continue
        fi
        if [[ "${active_state}" != "active" ]]; then
            if ! "${systemctl_bin}" start "${unit}"; then
                oms_br_error "Could not restart previously active service ${unit}"
                status=1
                continue
            fi
        fi
        if ! active_state=$(oms_br_unit_state "${systemctl_bin}" ActiveState "${unit}"); then
            status=1
        elif [[ "${active_state}" != "active" ]]; then
            oms_br_error "Previously active service did not return active: ${unit}"
            status=1
        fi
    done
    return "${status}"
}

oms_br_default_health_check() {
    local mysqladmin_bin
    local nginx_bin
    local postfix_bin
    local doveconf_bin
    local rspamadm_bin
    local curl_bin
    local http_code

    mysqladmin_bin=$(oms_br_require_command "${OMS_BACKUP_MYSQLADMIN_BIN:-}" mysqladmin mysqladmin) \
        || return 1
    "${mysqladmin_bin}" ping --silent || return 1

    if oms_br_unit_was_active nginx.service; then
        nginx_bin=$(oms_br_require_command "${OMS_BACKUP_NGINX_BIN:-}" nginx nginx) || return 1
        "${nginx_bin}" -t >/dev/null || return 1
    fi
    if oms_br_unit_was_active postfix.service; then
        postfix_bin=$(oms_br_require_command "${OMS_BACKUP_POSTFIX_BIN:-}" postfix postfix) || return 1
        "${postfix_bin}" check || return 1
    fi
    if oms_br_unit_was_active dovecot.service; then
        doveconf_bin=$(oms_br_require_command "${OMS_BACKUP_DOVECONF_BIN:-}" doveconf doveconf) || return 1
        "${doveconf_bin}" -n >/dev/null || return 1
    fi
    if oms_br_unit_was_active rspamd.service; then
        rspamadm_bin=$(oms_br_require_command "${OMS_BACKUP_RSPAMADM_BIN:-}" rspamadm rspamadm) || return 1
        "${rspamadm_bin}" configtest >/dev/null || return 1
    fi
    if oms_br_unit_was_active openmailstack.service; then
        curl_bin=$(oms_br_require_command "${OMS_BACKUP_CURL_BIN:-}" curl curl) || return 1
        http_code=$("${curl_bin}" --noproxy '*' --silent --output /dev/null \
            --write-out '%{http_code}' --connect-timeout 2 --max-time 5 \
            "${OMS_BACKUP_BACKEND_HEALTH_URL:-http://127.0.0.1:20000/api/auth/me}") \
            || return 1
        [[ "${http_code}" == "401" ]] || return 1
    fi
}

oms_br_health_check() {
    local healthcheck_bin="${OMS_BACKUP_HEALTHCHECK_BIN:-}"
    if [[ -n "${healthcheck_bin}" ]]; then
        healthcheck_bin=$(oms_br_require_command "${healthcheck_bin}" true healthcheck) \
            || return 1
        "${healthcheck_bin}"
    else
        [[ "${OMS_BACKUP_FIXTURE_MODE:-0}" != "1" ]] \
            || { oms_br_fail "Fixture mode requires OMS_BACKUP_HEALTHCHECK_BIN"; return 1; }
        oms_br_default_health_check
    fi
}

oms_br_wait_for_health() {
    local attempt
    local max_attempts=15
    local retry_delay=1

    if [[ "${OMS_BACKUP_FIXTURE_MODE:-0}" == "1" ]]; then
        retry_delay=0
    fi
    for ((attempt = 1; attempt <= max_attempts; attempt += 1)); do
        if oms_br_health_check; then
            return 0
        fi
        if (( attempt < max_attempts )); then
            sleep "${retry_delay}"
        fi
    done
    oms_br_error "Service health did not recover after ${max_attempts} checks"
    return 1
}

oms_br_symlink_manifest() {
    local snapshot_dir="$1"
    local output_file="$2"
    local link_path
    local relative_path
    local target
    local unsorted="${output_file}.unsorted"
    local links_file="${output_file}.links"

    : > "${unsorted}" || return 1
    if ! find "${snapshot_dir}/payload" -type l -print0 > "${links_file}"; then
        rm -f -- "${unsorted}" "${links_file}"
        return 1
    fi
    while IFS= read -r -d '' link_path; do
        relative_path="${link_path#"${snapshot_dir}"/}"
        target=$(readlink -- "${link_path}") || return 1
        oms_br_reject_unsafe_text "${relative_path}" "snapshot symlink path" || return 1
        oms_br_reject_unsafe_text "${target}" "snapshot symlink target" || return 1
        printf '%s\t%s\n' "${relative_path}" "${target}" >> "${unsorted}" || return 1
    done < "${links_file}"
    LC_ALL=C sort -- "${unsorted}" > "${output_file}" || return 1
    rm -f -- "${unsorted}" "${links_file}" || return 1
}

oms_br_generate_checksums() {
    local snapshot_dir="$1"
    local output_file="$2"
    local list_file="${output_file}.files"
    local found_file="${output_file}.found"
    local path
    local relative_path

    : > "${list_file}" || return 1
    for relative_path in databases.sql databases.tsv inventory.tsv snapshot.meta symlinks.tsv; do
        [[ -f "${snapshot_dir}/${relative_path}" && ! -L "${snapshot_dir}/${relative_path}" ]] \
            || return 1
        printf '%s\0' "${relative_path}" >> "${list_file}" || return 1
    done
    find "${snapshot_dir}/payload" -type f -print0 > "${found_file}" || return 1
    while IFS= read -r -d '' path; do
        relative_path="${path#"${snapshot_dir}"/}"
        oms_br_reject_unsafe_text "${relative_path}" "snapshot file path" || return 1
        printf '%s\0' "${relative_path}" >> "${list_file}" || return 1
    done < "${found_file}"

    (
        cd "${snapshot_dir}" || exit 1
        LC_ALL=C sort -z -- "${list_file}" | xargs -0 sha256sum | LC_ALL=C sort
    ) > "${output_file}" || return 1
    rm -f -- "${list_file}" "${found_file}" || return 1
}

oms_br_validate_symlinks() {
    local snapshot_dir="$1"
    local manifest_tmp
    local relative_path
    local target
    local key
    local entry_root
    local resolved

    manifest_tmp=$(mktemp) || return 1
    if ! oms_br_symlink_manifest "${snapshot_dir}" "${manifest_tmp}"; then
        rm -f -- "${manifest_tmp}"
        return 1
    fi
    if ! cmp -s -- "${manifest_tmp}" "${snapshot_dir}/symlinks.tsv"; then
        rm -f -- "${manifest_tmp}"
        oms_br_fail "Snapshot symlink inventory does not match"
        return 1
    fi
    rm -f -- "${manifest_tmp}" || return 1

    while IFS=$'\t' read -r relative_path target; do
        [[ -n "${relative_path}" ]] || continue
        [[ "${relative_path}" == payload/*/* || "${relative_path}" == payload/* ]] \
            || return 1
        if [[ "${target}" == /* ]]; then
            if ! oms_br_absolute_symlink_target_is_inventory_bounded \
                "${snapshot_dir}" "${target}"; then
                oms_br_fail "Snapshot contains an absolute symlink target outside inventory"
                return 1
            fi
            continue
        fi
        key="${relative_path#payload/}"
        key="${key%%/*}"
        entry_root=$(readlink -m -- "${snapshot_dir}/payload/${key}") || return 1
        resolved=$(readlink -m -- "$(dirname -- "${snapshot_dir}/${relative_path}")/${target}") \
            || return 1
        [[ "${resolved}" == "${entry_root}" || "${resolved}" == "${entry_root}/"* ]] \
            || { oms_br_fail "Snapshot symlink escapes inventory item ${key}"; return 1; }
    done < "${snapshot_dir}/symlinks.tsv"
}

oms_br_absolute_symlink_target_is_inventory_bounded() {
    local snapshot_dir="$1"
    local target="$2"
    local normalized_target
    local key
    local logical_path
    local state
    local kind
    local extra
    local normalized_logical

    normalized_target=$(readlink -m -- "${target}") || return 1
    while IFS=$'\t' read -r key logical_path state kind extra; do
        [[ -n "${key}" && -z "${extra:-}" ]] || return 1
        [[ "${key}" != "database" && "${state}" == "present" ]] || continue
        [[ "${logical_path}" == /* ]] || continue
        normalized_logical=$(readlink -m -- "${logical_path}") || return 1
        if [[ "${kind}" == "directory" ]]; then
            [[ "${normalized_target}" == "${normalized_logical}" \
                || "${normalized_target}" == "${normalized_logical}/"* ]] && return 0
        elif [[ "${normalized_target}" == "${normalized_logical}" ]]; then
            return 0
        fi
    done < "${snapshot_dir}/inventory.tsv"
    return 1
}

oms_br_validate_inventory() {
    local snapshot_dir="$1"
    local key
    local logical_path
    local state
    local kind
    local extra
    local expected_key
    local child
    local child_list
    local invalid_child=0
    local -A expected_path=()
    local -A expected_kind=()
    local -A seen=()

    expected_path[database]='logical:oms-databases'
    expected_kind[database]='file'
    while IFS=$'\t' read -r expected_key logical_path kind extra; do
        [[ -n "${expected_key}" && -z "${extra:-}" ]] || return 1
        expected_path["${expected_key}"]="${logical_path}"
        expected_kind["${expected_key}"]="${kind}"
    done < <(oms_br_inventory_specs)

    while IFS=$'\t' read -r key logical_path state kind extra; do
        [[ -n "${key}" && -z "${extra:-}" ]] || return 1
        [[ "${key}" =~ ^[a-z0-9-]+$ && -n "${expected_path[${key}]+x}" ]] \
            || return 1
        [[ -z "${seen[${key}]+x}" ]] || return 1
        [[ "${logical_path}" == "${expected_path[${key}]}" ]] || return 1
        [[ "${kind}" == "${expected_kind[${key}]}" ]] || return 1
        [[ "${state}" == "present" || "${state}" == "absent" ]] || return 1
        seen["${key}"]=1

        if [[ "${key}" == "database" ]]; then
            [[ "${state}" == "present" && -s "${snapshot_dir}/databases.sql" ]] || return 1
        elif [[ "${state}" == "present" && "${kind}" == "directory" ]]; then
            [[ -d "${snapshot_dir}/payload/${key}" && ! -L "${snapshot_dir}/payload/${key}" ]] || return 1
        elif [[ "${state}" == "present" ]]; then
            [[ -f "${snapshot_dir}/payload/${key}" && ! -L "${snapshot_dir}/payload/${key}" ]] || return 1
        else
            [[ ! -e "${snapshot_dir}/payload/${key}" && ! -L "${snapshot_dir}/payload/${key}" ]] || return 1
        fi
    done < "${snapshot_dir}/inventory.tsv"

    for expected_key in "${!expected_path[@]}"; do
        [[ -n "${seen[${expected_key}]+x}" ]] || return 1
    done
    child_list=$(mktemp) || return 1
    find "${snapshot_dir}/payload" -mindepth 1 -maxdepth 1 -print0 > "${child_list}" \
        || { rm -f -- "${child_list}"; return 1; }
    while IFS= read -r -d '' child; do
        key=$(basename -- "${child}")
        if [[ -z "${expected_path[${key}]+x}" || -z "${seen[${key}]+x}" ]]; then
            invalid_child=1
            break
        fi
    done < "${child_list}"
    rm -f -- "${child_list}" || return 1
    [[ "${invalid_child}" == "0" ]] || return 1
}

oms_br_validate_database_manifest() {
    local snapshot_dir="$1"
    local expected_file

    expected_file=$(mktemp) || return 1
    if ! oms_br_write_database_manifest "${expected_file}"; then
        rm -f -- "${expected_file}" "${expected_file}.unsorted"
        return 1
    fi
    if ! cmp -s -- "${expected_file}" "${snapshot_dir}/databases.tsv"; then
        rm -f -- "${expected_file}"
        oms_br_fail "Snapshot database allowlist does not match this host"
        return 1
    fi
    rm -f -- "${expected_file}" || return 1
}

oms_br_validate_payload_types() {
    local snapshot_dir="$1"
    local unexpected

    unexpected=$(find "${snapshot_dir}/payload" \
        ! -type f ! -type d ! -type l -print -quit) || return 1
    [[ -z "${unexpected}" ]] \
        || { oms_br_fail "Snapshot payload contains an unsupported filesystem object"; return 1; }
}

oms_br_validate_top_level() {
    local snapshot_dir="$1"
    local child
    local name
    local child_list
    local unexpected_name=""

    child_list=$(mktemp) || return 1
    find "${snapshot_dir}" -mindepth 1 -maxdepth 1 -print0 > "${child_list}" \
        || { rm -f -- "${child_list}"; return 1; }
    while IFS= read -r -d '' child; do
        name=$(basename -- "${child}")
        case "${name}" in
            payload|databases.sql|databases.tsv|inventory.tsv|snapshot.meta|symlinks.tsv|checksums.sha256) ;;
            *)
                unexpected_name="${name}"
                break
                ;;
        esac
    done < "${child_list}"
    rm -f -- "${child_list}" || return 1
    if [[ -n "${unexpected_name}" ]]; then
        oms_br_fail "Snapshot contains an unexpected top-level entry: ${unexpected_name}"
        return 1
    fi
}

oms_br_metadata_key_count() {
    local metadata_file="$1"
    local key="$2"

    awk -F'\t' -v key="${key}" '
        $1 == key { count += 1 }
        END { print count + 0 }
    ' "${metadata_file}"
}

oms_br_read_single_metadata_value() {
    local metadata_file="$1"
    local key="$2"

    awk -F'\t' -v key="${key}" '
        $1 == key {
            count += 1
            value = $2
            if (NF != 2 || $2 == "") {
                invalid = 1
            }
        }
        END {
            if (count != 1 || invalid) {
                exit 1
            }
            print value
        }
    ' "${metadata_file}"
}

oms_br_validate_snapshot_contents() {
    local snapshot_dir="$1"
    local checksum_tmp
    local control_file
    local assert_format
    local service_quiescence_mode
    local service_quiescence_ms
    local service_outage_window_ms
    local service_quiescence_mode_count
    local service_quiescence_ms_count
    local service_outage_window_ms_count

    [[ -d "${snapshot_dir}" && ! -L "${snapshot_dir}" ]] || return 1
    for control_file in inventory.tsv snapshot.meta symlinks.tsv checksums.sha256 databases.sql databases.tsv; do
        [[ -f "${snapshot_dir}/${control_file}" && ! -L "${snapshot_dir}/${control_file}" ]] \
            || return 1
    done
    [[ -d "${snapshot_dir}/payload" && ! -L "${snapshot_dir}/payload" ]] || return 1
    oms_br_validate_top_level "${snapshot_dir}" || return 1
    oms_br_validate_payload_types "${snapshot_dir}" || return 1
    assert_format=$(awk -F'\t' '$1 == "format_version" { print $2 }' "${snapshot_dir}/snapshot.meta") \
        || return 1
    [[ "${assert_format}" == "1" ]] || return 1
    grep -Fxq $'encryption\tnone' "${snapshot_dir}/snapshot.meta" || return 1
    grep -Fxq $'point_in_time_recovery\tnot_available' "${snapshot_dir}/snapshot.meta" || return 1
    grep -Fxq $'database_restore_semantics\tlogical_replace_listed_databases' \
        "${snapshot_dir}/snapshot.meta" || return 1
    grep -Fxq $'database_scope\tconfigured_openmailstack_databases' \
        "${snapshot_dir}/snapshot.meta" || return 1
    grep -Fxq $'mysql_configuration\tnot_included' \
        "${snapshot_dir}/snapshot.meta" || return 1
    service_quiescence_mode_count=$(oms_br_metadata_key_count \
        "${snapshot_dir}/snapshot.meta" service_quiescence_mode) || return 1
    service_quiescence_ms_count=$(oms_br_metadata_key_count \
        "${snapshot_dir}/snapshot.meta" service_quiescence_ms) || return 1
    service_outage_window_ms_count=$(oms_br_metadata_key_count \
        "${snapshot_dir}/snapshot.meta" service_outage_window_ms) || return 1
    if (( service_quiescence_mode_count == 0 \
        && service_quiescence_ms_count == 0 \
        && service_outage_window_ms_count == 0 )); then
        : # Legacy format-1 snapshots predate service timing metadata.
    else
        (( service_quiescence_mode_count == 1 )) || return 1
        service_quiescence_mode=$(oms_br_read_single_metadata_value \
            "${snapshot_dir}/snapshot.meta" service_quiescence_mode) || return 1
        case "${service_quiescence_mode}" in
            managed)
                (( service_quiescence_ms_count == 1 \
                    && service_outage_window_ms_count == 1 )) || return 1
                service_quiescence_ms=$(oms_br_read_single_metadata_value \
                    "${snapshot_dir}/snapshot.meta" service_quiescence_ms) || return 1
                service_outage_window_ms=$(oms_br_read_single_metadata_value \
                    "${snapshot_dir}/snapshot.meta" service_outage_window_ms) || return 1
                [[ "${service_quiescence_ms}" =~ ^[0-9]+$ \
                    && "${service_outage_window_ms}" =~ ^[0-9]+$ ]] || return 1
                (( 10#${service_outage_window_ms} >= 10#${service_quiescence_ms} )) \
                    || return 1
                ;;
            managed_externally)
                (( service_quiescence_ms_count == 0 \
                    && service_outage_window_ms_count == 0 )) || return 1
                ;;
            *) return 1 ;;
        esac
    fi
    oms_br_validate_database_manifest "${snapshot_dir}" || return 1
    oms_br_validate_inventory "${snapshot_dir}" || return 1
    oms_br_validate_symlinks "${snapshot_dir}" || return 1

    checksum_tmp=$(mktemp) || return 1
    if ! oms_br_generate_checksums "${snapshot_dir}" "${checksum_tmp}"; then
        rm -f -- "${checksum_tmp}"
        return 1
    fi
    if ! cmp -s -- "${checksum_tmp}" "${snapshot_dir}/checksums.sha256"; then
        rm -f -- "${checksum_tmp}"
        oms_br_fail "Snapshot checksum inventory does not match"
        return 1
    fi
    rm -f -- "${checksum_tmp}" || return 1
    (cd "${snapshot_dir}" && sha256sum -c checksums.sha256 >/dev/null) || return 1
}

oms_br_validate_trusted_snapshot() {
    local requested_path="$1"
    local backup_root
    local backup_root_real
    local snapshot_real
    local snapshot_name
    local control_file
    local mode
    local mode_value

    backup_root=$(oms_br_backup_root) || return 1
    oms_br_prepare_secure_directory "${backup_root}" "backup root" || return 1
    oms_br_assert_absolute_bounded_path "${requested_path}" "snapshot path" || return 1
    [[ ! -L "${requested_path}" && -d "${requested_path}" ]] || return 1
    snapshot_name=$(basename -- "${requested_path}")
    [[ "${snapshot_name}" =~ ^oms-(backup|pre-restore)-[0-9]{8}T[0-9]{6}Z$ ]] \
        || { oms_br_fail "Snapshot name is invalid or incomplete"; return 1; }
    backup_root_real=$(readlink -f -- "${backup_root}") || return 1
    snapshot_real=$(readlink -f -- "${requested_path}") || return 1
    [[ "${requested_path}" == "${backup_root}/${snapshot_name}" \
        && "${snapshot_real}" == "${backup_root_real}/${snapshot_name}" ]] \
        || { oms_br_fail "Snapshot must be a direct canonical child of the backup root"; return 1; }
    [[ "$(stat -c '%u:%a' -- "${requested_path}")" == "0:700" ]] \
        || { oms_br_fail "Snapshot root must be root-owned mode 0700"; return 1; }
    for control_file in inventory.tsv snapshot.meta symlinks.tsv checksums.sha256 databases.sql databases.tsv; do
        [[ "$(stat -c '%u' -- "${requested_path}/${control_file}")" == "0" ]] || return 1
        mode=$(stat -c '%a' -- "${requested_path}/${control_file}") || return 1
        mode_value=$((8#${mode}))
        (( (mode_value & 8#022) == 0 )) || return 1
    done
    oms_br_validate_snapshot_contents "${requested_path}"
}

oms_br_dump_databases() {
    local output_file="$1"
    local database_manifest="$2"
    local dump_bin
    local tmp_file="${output_file}.tmp"
    local -a databases=()

    dump_bin=$(oms_br_mysqldump_bin) || return 1
    mapfile -t databases < "${database_manifest}" || return 1
    [[ ${#databases[@]} -gt 0 ]] || return 1
    if ! "${dump_bin}" \
        --add-drop-database \
        --single-transaction \
        --quick \
        --routines \
        --events \
        --triggers \
        --hex-blob \
        --databases "${databases[@]}" > "${tmp_file}"; then
        oms_br_error "Database dump failed; snapshot will not be promoted"
        return 1
    fi
    [[ -s "${tmp_file}" ]] \
        || { oms_br_fail "Database dump was empty; snapshot will not be promoted"; return 1; }
    chmod 0600 -- "${tmp_file}" || return 1
    mv -- "${tmp_file}" "${output_file}" || return 1
}

oms_br_write_mail_store_message_manifest() {
    local source_path="$1"
    local output_file="$2"

    : > "${output_file}" || return 1
    chmod 0600 -- "${output_file}" || return 1
    [[ -e "${source_path}" ]] || return 0
    [[ -d "${source_path}" ]] || return 1
    if ! (
        cd -- "${source_path}" || exit 1
        find . -regextype posix-extended -type f \
            -regex '.*/(cur|new)/[^/]*' -printf '%p\0%D:%i\0'
    ) > "${output_file}"; then
        oms_br_error "Could not inventory immutable Maildir message identities"
        return 1
    fi
}

oms_br_write_mail_store_regular_manifest() {
    local source_path="$1"
    local output_file="$2"

    : > "${output_file}" || return 1
    chmod 0600 -- "${output_file}" || return 1
    [[ -e "${source_path}" ]] || return 0
    [[ -d "${source_path}" ]] || return 1
    if ! (
        cd -- "${source_path}" || exit 1
        find . -type f -printf '%p\0%D:%i\0'
    ) > "${output_file}"; then
        oms_br_error "Could not inventory current mail-store regular-file identities"
        return 1
    fi
}

oms_br_read_process_identity() {
    local process_pid="$1"
    local stat_line
    local stat_tail
    local -a stat_fields=()

    [[ "${process_pid}" =~ ^[0-9]+$ ]] || return 2
    if ! IFS= read -r stat_line 2>/dev/null < "/proc/${process_pid}/stat"; then
        return 1
    fi
    [[ "${stat_line}" == "${process_pid} ("* && "${stat_line}" == *') '* ]] \
        || return 2
    stat_tail="${stat_line##*) }"
    read -r -a stat_fields <<< "${stat_tail}" || return 2
    [[ ${#stat_fields[@]} -ge 20 ]] || return 2
    [[ "${stat_fields[0]}" =~ ^[A-Za-z]$ \
        && "${stat_fields[19]}" =~ ^[0-9]+$ ]] || return 2
    OMS_BR_PROCESS_STATE="${stat_fields[0]}"
    OMS_BR_PROCESS_START_TIME="${stat_fields[19]}"
}

oms_br_mail_store_move_watch_is_active() {
    local watch_pid="$1"
    local watch_start_time="$2"

    [[ "${watch_start_time}" =~ ^[0-9]+$ ]] || return 1
    oms_br_read_process_identity "${watch_pid}" || return 1
    [[ "${OMS_BR_PROCESS_START_TIME}" == "${watch_start_time}" ]] || return 1
    case "${OMS_BR_PROCESS_STATE}" in
        Z|X|x) return 1 ;;
        *) return 0 ;;
    esac
}

oms_br_signal_mail_store_move_watch() {
    local watch_pid="$1"
    local watch_start_time="$2"
    local signal_name="$3"
    local python_bin
    local watch_script

    oms_br_mail_store_move_watch_is_active \
        "${watch_pid}" "${watch_start_time}" || return 1
    [[ "${signal_name}" == "TERM" || "${signal_name}" == "KILL" ]] || return 1
    python_bin=$(oms_br_python_bin) || return 1
    watch_script=$(oms_br_mail_store_move_watch_script) || return 1
    "${python_bin}" "${watch_script}" \
        --signal-pid "${watch_pid}" \
        --expected-start-time "${watch_start_time}" \
        --process-signal "${signal_name}"
}

oms_br_reap_mail_store_move_watch() {
    local watch_pid="$1"
    local watch_start_time="$2"
    local max_attempts="$3"
    local attempt
    local process_status

    [[ "${watch_pid}" =~ ^[0-9]+$ \
        && "${watch_start_time}" =~ ^[0-9]+$ \
        && "${max_attempts}" =~ ^[0-9]+$ \
        && "${max_attempts}" -gt 0 ]] || return 1
    OMS_BR_MAIL_STORE_WATCH_EXIT_STATUS=""
    for ((attempt = 0; attempt < max_attempts; attempt++)); do
        if oms_br_read_process_identity "${watch_pid}"; then
            if [[ "${OMS_BR_PROCESS_START_TIME}" == "${watch_start_time}" ]]; then
                case "${OMS_BR_PROCESS_STATE}" in
                    Z|X|x) ;;
                    *) sleep 0.1; continue ;;
                esac
            fi
        elif [[ -d "/proc/${watch_pid}" ]]; then
            return 1
        fi
        if wait "${watch_pid}" 2>/dev/null; then
            process_status=0
        else
            process_status=$?
        fi
        OMS_BR_MAIL_STORE_WATCH_EXIT_STATUS="${process_status}"
        return 0
    done
    return 1
}

oms_br_clear_mail_store_move_watch_state() {
    OMS_BR_MAIL_STORE_WATCH_PID=""
    OMS_BR_MAIL_STORE_WATCH_START_TIME=""
    OMS_BR_MAIL_STORE_WATCH_STAGING=""
    OMS_BR_MAIL_STORE_WATCH_SOURCE=""
    OMS_BR_MAIL_STORE_WATCH_CONTROL=""
    OMS_BR_MAIL_STORE_WATCH_SENTINEL=""
    OMS_BR_MAIL_STORE_WATCH_SENTINEL_ID=""
    OMS_BR_MAIL_STORE_WATCH_EXIT_STATUS=""
    OMS_BR_MAIL_STORE_WATCH_REPORTED_PID=""
    OMS_BR_MAIL_STORE_WATCH_REPORTED_START_TIME=""
}

oms_br_remove_mail_store_watch_control_dir() {
    local staging_dir="${OMS_BR_MAIL_STORE_WATCH_STAGING:-}"
    local control_dir="${OMS_BR_MAIL_STORE_WATCH_CONTROL:-}"

    [[ -n "${control_dir}" ]] || return 0
    [[ -n "${staging_dir}" \
        && "${control_dir}" == "${staging_dir}/mail-store-watch-control" ]] \
        || return 1
    oms_br_assert_absolute_bounded_path "${staging_dir}" \
        "mail-store watch staging directory" || return 1
    oms_br_assert_no_symlink_components "${staging_dir}" || return 1
    oms_br_assert_root_owned_nonwritable_directory \
        "${staging_dir}" "mail-store watch staging directory" || return 1
    oms_br_assert_root_owned_nonwritable_directory \
        "${control_dir}" "mail-store watch control directory" || return 1
    rmdir -- "${control_dir}"
}

oms_br_terminate_mail_store_move_watch() {
    local watch_pid="${OMS_BR_MAIL_STORE_WATCH_PID:-}"
    local watch_start_time="${OMS_BR_MAIL_STORE_WATCH_START_TIME:-}"
    local cleanup_status=0

    if ! oms_br_remove_mail_store_watch_sentinel; then
        cleanup_status=1
    fi
    if [[ -n "${watch_pid}" ]]; then
        if [[ ! "${watch_pid}" =~ ^[0-9]+$ \
            || ! "${watch_start_time}" =~ ^[0-9]+$ ]]; then
            cleanup_status=1
        else
            if oms_br_mail_store_move_watch_is_active \
                "${watch_pid}" "${watch_start_time}"; then
                oms_br_signal_mail_store_move_watch \
                    "${watch_pid}" "${watch_start_time}" TERM \
                    || cleanup_status=1
            fi
            if ! oms_br_reap_mail_store_move_watch \
                "${watch_pid}" "${watch_start_time}" 50; then
                oms_br_signal_mail_store_move_watch \
                    "${watch_pid}" "${watch_start_time}" KILL || true
                oms_br_reap_mail_store_move_watch \
                    "${watch_pid}" "${watch_start_time}" 10 || true
                cleanup_status=1
            fi
        fi
    fi
    if ! oms_br_remove_mail_store_watch_control_dir; then
        cleanup_status=1
    fi
    oms_br_clear_mail_store_move_watch_state
    return "${cleanup_status}"
}

oms_br_remove_mail_store_watch_sentinel() {
    local require_present="${1:-0}"
    local control_dir="${OMS_BR_MAIL_STORE_WATCH_CONTROL:-}"
    local sentinel_path="${OMS_BR_MAIL_STORE_WATCH_SENTINEL:-}"
    local sentinel_id="${OMS_BR_MAIL_STORE_WATCH_SENTINEL_ID:-}"
    local current_id
    local sentinel_name

    [[ "${require_present}" == "0" || "${require_present}" == "1" ]] || return 1
    [[ -n "${sentinel_path}" ]] || return 0
    [[ -n "${control_dir}" ]] || return 1
    oms_br_assert_absolute_bounded_path "${control_dir}" \
        "mail-store watch control directory" \
        || return 1
    sentinel_name=$(basename -- "${sentinel_path}") || return 1
    [[ "${sentinel_path}" == "${control_dir}/${sentinel_name}" \
        && "${sentinel_name}" =~ ^\.oms-backup-watch-[0-9a-f]{32}$ ]] || return 1
    oms_br_assert_no_symlink_components "${control_dir}" || return 1
    oms_br_assert_root_owned_nonwritable_directory \
        "${control_dir}" "mail-store watch control directory" || return 1
    if [[ ! -e "${sentinel_path}" && ! -L "${sentinel_path}" ]]; then
        [[ "${require_present}" == "0" ]] || return 1
        return 0
    fi
    [[ "${sentinel_id}" =~ ^[0-9]+:[0-9]+$ \
        && -f "${sentinel_path}" && ! -L "${sentinel_path}" \
        && "$(stat -c '%u' -- "${sentinel_path}")" == "0" ]] || return 1
    current_id=$(stat -c '%d:%i' -- "${sentinel_path}") || return 1
    [[ "${current_id}" == "${sentinel_id}" ]] || return 1
    rm -f -- "${sentinel_path}" || return 1
}

oms_br_count_exact_file_lines() {
    local file_path="$1"
    local expected_line="$2"
    local current_line
    local count=0

    [[ -f "${file_path}" && ! -L "${file_path}" ]] || return 1
    while IFS= read -r current_line || [[ -n "${current_line}" ]]; do
        if [[ "${current_line}" == "${expected_line}" ]]; then
            count=$((count + 1))
        fi
    done < "${file_path}"
    OMS_BR_EXACT_LINE_COUNT="${count}"
}

oms_br_read_mail_store_watch_reported_identity() {
    local identity_file="$1"
    local identity_kind="$2"
    local identity_pattern
    local current_line
    local reported_pid=""
    local reported_start_time=""
    local count=0

    case "${identity_kind}" in
        launch) identity_pattern='^Watcher launched: ([0-9]+):([0-9]+)$' ;;
        ready) identity_pattern='^Watches established: ([0-9]+):([0-9]+)$' ;;
        *) return 1 ;;
    esac
    OMS_BR_MAIL_STORE_WATCH_REPORTED_PID=""
    OMS_BR_MAIL_STORE_WATCH_REPORTED_START_TIME=""
    [[ -f "${identity_file}" && ! -L "${identity_file}" ]] || return 1
    while IFS= read -r current_line || [[ -n "${current_line}" ]]; do
        if [[ "${current_line}" =~ ${identity_pattern} ]]; then
            count=$((count + 1))
            reported_pid="${BASH_REMATCH[1]}"
            reported_start_time="${BASH_REMATCH[2]}"
        fi
    done < "${identity_file}"
    [[ ${count} -eq 1 ]] || return 1
    OMS_BR_MAIL_STORE_WATCH_REPORTED_PID="${reported_pid}"
    OMS_BR_MAIL_STORE_WATCH_REPORTED_START_TIME="${reported_start_time}"
}

oms_br_start_mail_store_move_watch() {
    local staging_dir="$1"
    local source_path="$2"
    local event_file="${staging_dir}/mail-store-directory-moves.events"
    local error_file="${staging_dir}/mail-store-directory-moves.stderr"
    local identity_file="${staging_dir}/mail-store-watch.identity"
    local control_dir="${staging_dir}/mail-store-watch-control"
    local move_watch_bin
    local python_bin
    local watch_script
    local sentinel_nonce
    local sentinel_name
    local sentinel_path
    local attempt
    local ready_attempts=300
    local -a watch_command=()

    [[ -z "${OMS_BR_MAIL_STORE_WATCH_PID:-}" ]] || return 1
    oms_br_read_process_identity "$$" \
        || { oms_br_fail "Linux procfs is required for bounded watcher lifecycle management"; return 1; }
    oms_br_check_process_signaling_support \
        || { oms_br_fail "Linux process signaling support is required for bounded watcher lifecycle management"; return 1; }
    [[ ! -e "${control_dir}" && ! -L "${control_dir}" ]] || return 1
    install -d -o root -g root -m 0700 -- "${control_dir}" || return 1
    oms_br_assert_root_owned_nonwritable_directory \
        "${control_dir}" "mail-store watch control directory" || return 1
    OMS_BR_MAIL_STORE_WATCH_STAGING="${staging_dir}"
    OMS_BR_MAIL_STORE_WATCH_SOURCE="${source_path}"
    OMS_BR_MAIL_STORE_WATCH_CONTROL="${control_dir}"
    sentinel_nonce=$(oms_br_random_watch_token) || return 1
    sentinel_name=".oms-backup-watch-${sentinel_nonce}"
    sentinel_path="${control_dir}/${sentinel_name}"
    OMS_BR_MAIL_STORE_WATCH_SENTINEL="${sentinel_path}"
    OMS_BR_MAIL_STORE_WATCH_SENTINEL_ID=""
    [[ ! -e "${sentinel_path}" && ! -L "${sentinel_path}" ]] \
        || { oms_br_fail "Mail-store watcher sentinel already exists"; return 1; }
    if [[ -n "${OMS_BACKUP_MOVE_WATCH_BIN:-}" ]]; then
        move_watch_bin=$(oms_br_require_command \
            "${OMS_BACKUP_MOVE_WATCH_BIN}" mail-store-move-watch mail-store-move-watch) \
            || return 1
        watch_command=("${move_watch_bin}")
    else
        python_bin=$(oms_br_python_bin) || return 1
        watch_script=$(oms_br_mail_store_move_watch_script) || return 1
        watch_command=("${python_bin}" "${watch_script}")
    fi
    if [[ "${OMS_BACKUP_FIXTURE_MODE:-0}" == "1" \
        && -n "${OMS_BACKUP_TEST_MOVE_WATCH_READY_ATTEMPTS:-}" ]]; then
        [[ "${OMS_BACKUP_TEST_MOVE_WATCH_READY_ATTEMPTS}" =~ ^[0-9]+$ \
            && "${OMS_BACKUP_TEST_MOVE_WATCH_READY_ATTEMPTS}" -gt 0 \
            && "${OMS_BACKUP_TEST_MOVE_WATCH_READY_ATTEMPTS}" -le 300 ]] \
            || return 1
        ready_attempts="${OMS_BACKUP_TEST_MOVE_WATCH_READY_ATTEMPTS}"
    fi
    : > "${event_file}" || return 1
    : > "${error_file}" || return 1
    : > "${identity_file}" || return 1
    chmod 0600 -- "${event_file}" "${error_file}" "${identity_file}" || return 1
    (
        watch_process_pid="${BASHPID}"
        IFS= read -r watch_process_stat \
            < "/proc/${watch_process_pid}/stat" || exit 70
        watch_process_tail="${watch_process_stat##*) }"
        read -r -a watch_process_fields <<< "${watch_process_tail}" || exit 70
        [[ "${watch_process_fields[19]:-}" =~ ^[0-9]+$ ]] || exit 70
        printf 'Watcher launched: %s:%s\n' \
            "${watch_process_pid}" "${watch_process_fields[19]}" \
            > "${identity_file}" || exit 70
        exec "${watch_command[@]}" \
            --root "${source_path}" \
            --control-dir "${control_dir}" \
            --sentinel "${sentinel_name}"
    ) > "${event_file}" 2> "${error_file}" &
    OMS_BR_MAIL_STORE_WATCH_PID=$!
    OMS_BR_MAIL_STORE_WATCH_START_TIME=""

    for ((attempt = 0; attempt < ready_attempts; attempt++)); do
        if [[ -z "${OMS_BR_MAIL_STORE_WATCH_START_TIME}" ]] \
            && oms_br_read_mail_store_watch_reported_identity \
                "${identity_file}" launch; then
            if [[ "${OMS_BR_MAIL_STORE_WATCH_REPORTED_PID}" \
                    == "${OMS_BR_MAIL_STORE_WATCH_PID}" ]] \
                && oms_br_read_process_identity \
                    "${OMS_BR_MAIL_STORE_WATCH_PID}" \
                && [[ "${OMS_BR_PROCESS_START_TIME}" \
                    == "${OMS_BR_MAIL_STORE_WATCH_REPORTED_START_TIME}" ]]; then
                case "${OMS_BR_PROCESS_STATE}" in
                    Z|X|x) ;;
                    *)
                        OMS_BR_MAIL_STORE_WATCH_START_TIME="${OMS_BR_MAIL_STORE_WATCH_REPORTED_START_TIME}"
                        ;;
                esac
            fi
            if [[ -z "${OMS_BR_MAIL_STORE_WATCH_START_TIME}" ]]; then
                oms_br_terminate_mail_store_move_watch || true
                oms_br_error "Mail-store directory move watch reported an unexpected launch identity"
                return 1
            fi
        fi
        if [[ -n "${OMS_BR_MAIL_STORE_WATCH_START_TIME}" ]] \
            && oms_br_read_mail_store_watch_reported_identity \
                "${error_file}" ready; then
            if [[ "${OMS_BR_MAIL_STORE_WATCH_REPORTED_PID}" \
                    == "${OMS_BR_MAIL_STORE_WATCH_PID}" \
                && "${OMS_BR_MAIL_STORE_WATCH_REPORTED_START_TIME}" \
                    == "${OMS_BR_MAIL_STORE_WATCH_START_TIME}" ]] \
                && oms_br_mail_store_move_watch_is_active \
                    "${OMS_BR_MAIL_STORE_WATCH_PID}" \
                    "${OMS_BR_MAIL_STORE_WATCH_START_TIME}"; then
                return 0
            fi
            oms_br_terminate_mail_store_move_watch || true
            oms_br_error "Mail-store directory move watch reported an unexpected readiness identity"
            return 1
        fi
        if [[ -n "${OMS_BR_MAIL_STORE_WATCH_START_TIME}" ]]; then
            if oms_br_mail_store_move_watch_is_active \
                "${OMS_BR_MAIL_STORE_WATCH_PID}" \
                "${OMS_BR_MAIL_STORE_WATCH_START_TIME}"; then
                sleep 0.1
                continue
            fi
            oms_br_terminate_mail_store_move_watch || true
            oms_br_error "Mail-store directory move watch exited before becoming ready"
            return 1
        elif oms_br_read_process_identity "${OMS_BR_MAIL_STORE_WATCH_PID}"; then
            case "${OMS_BR_PROCESS_STATE}" in
                Z|X|x)
                    wait "${OMS_BR_MAIL_STORE_WATCH_PID}" 2>/dev/null || true
                    oms_br_terminate_mail_store_move_watch || true
                    oms_br_error "Mail-store directory move watch exited before becoming ready"
                    return 1
                    ;;
            esac
        elif [[ ! -d "/proc/${OMS_BR_MAIL_STORE_WATCH_PID}" ]]; then
            wait "${OMS_BR_MAIL_STORE_WATCH_PID}" 2>/dev/null || true
            oms_br_terminate_mail_store_move_watch || true
            oms_br_error "Mail-store directory move watch exited before becoming ready"
            return 1
        fi
        sleep 0.1
    done
    oms_br_terminate_mail_store_move_watch || true
    oms_br_error "Mail-store directory move watch did not become ready within 30 seconds"
    return 1
}

oms_br_stop_mail_store_move_watch() {
    local staging_dir="$1"
    local watch_pid="${OMS_BR_MAIL_STORE_WATCH_PID:-}"
    local watch_start_time="${OMS_BR_MAIL_STORE_WATCH_START_TIME:-}"
    local source_path="${OMS_BR_MAIL_STORE_WATCH_SOURCE:-}"
    local control_dir="${OMS_BR_MAIL_STORE_WATCH_CONTROL:-}"
    local sentinel_path="${OMS_BR_MAIL_STORE_WATCH_SENTINEL:-}"
    local sentinel_mode
    local sentinel_token
    local expected_ready_line
    local expected_drain_line
    local watch_status=0
    local error_line
    local attempt
    local drained=0

    [[ -n "${watch_pid}" && "${watch_pid}" =~ ^[0-9]+$ \
        && "${watch_start_time}" =~ ^[0-9]+$ \
        && "${OMS_BR_MAIL_STORE_WATCH_STAGING:-}" == "${staging_dir}" \
        && -n "${source_path}" && -n "${control_dir}" \
        && -n "${sentinel_path}" ]] || return 1
    if ! oms_br_mail_store_move_watch_is_active \
        "${watch_pid}" "${watch_start_time}"; then
        oms_br_terminate_mail_store_move_watch || true
        oms_br_error "Mail-store directory move watch exited before service quiescence"
        return 1
    fi
    oms_br_assert_no_symlink_components "${source_path}" || return 1
    oms_br_assert_no_symlink_components "${control_dir}" || return 1
    [[ -d "${source_path}" && ! -L "${source_path}" \
        && "${sentinel_path}" == "${control_dir}/"* \
        && ! -e "${sentinel_path}" && ! -L "${sentinel_path}" ]] || return 1
    oms_br_assert_root_owned_nonwritable_directory \
        "${control_dir}" "mail-store watch control directory" || return 1
    if grep -Fq 'Drain complete' \
        "${staging_dir}/mail-store-directory-moves.stderr"; then
        oms_br_error "Mail-store directory move watch acknowledged a drain before quiescence"
        return 1
    fi
    sentinel_token=$(oms_br_random_watch_token) || return 1
    if ! oms_br_create_mail_store_watch_sentinel \
        "${sentinel_path}" "${sentinel_token}"; then
        oms_br_error "Could not create the mail-store watcher drain sentinel exclusively"
        return 1
    fi
    [[ -f "${sentinel_path}" && ! -L "${sentinel_path}" \
        && "$(stat -c '%u' -- "${sentinel_path}")" == "0" ]] || return 1
    OMS_BR_MAIL_STORE_WATCH_SENTINEL_ID=$(stat -c '%d:%i' -- "${sentinel_path}") \
        || return 1
    sentinel_mode=$(stat -c '%a' -- "${sentinel_path}") || return 1
    (( (8#${sentinel_mode} & 8#077) == 0 )) || return 1
    expected_drain_line="Drain complete: ${sentinel_token}"
    for ((attempt = 0; attempt < 300; attempt++)); do
        if oms_br_count_exact_file_lines \
            "${staging_dir}/mail-store-directory-moves.stderr" \
            "${expected_drain_line}" \
            && [[ "${OMS_BR_EXACT_LINE_COUNT}" -gt 0 ]]; then
            drained=1
            break
        fi
        if ! oms_br_mail_store_move_watch_is_active \
            "${watch_pid}" "${watch_start_time}"; then
            break
        fi
        sleep 0.1
    done
    if ! oms_br_remove_mail_store_watch_sentinel 1; then
        oms_br_error "Could not remove the mail-store watcher drain sentinel"
        return 1
    fi
    if [[ ${drained} -ne 1 ]]; then
        oms_br_error "Mail-store directory move watch did not drain after service quiescence"
        return 1
    fi
    if oms_br_mail_store_move_watch_is_active \
        "${watch_pid}" "${watch_start_time}"; then
        oms_br_signal_mail_store_move_watch \
            "${watch_pid}" "${watch_start_time}" TERM || return 1
    fi
    if ! oms_br_reap_mail_store_move_watch \
        "${watch_pid}" "${watch_start_time}" 50; then
        oms_br_error "Mail-store directory move watch did not stop after TERM"
        oms_br_signal_mail_store_move_watch \
            "${watch_pid}" "${watch_start_time}" KILL || true
        oms_br_reap_mail_store_move_watch \
            "${watch_pid}" "${watch_start_time}" 10 || true
        oms_br_remove_mail_store_watch_control_dir || true
        oms_br_clear_mail_store_move_watch_state
        return 1
    fi
    watch_status="${OMS_BR_MAIL_STORE_WATCH_EXIT_STATUS}"
    if ! oms_br_remove_mail_store_watch_control_dir; then
        oms_br_clear_mail_store_move_watch_state
        return 1
    fi
    oms_br_clear_mail_store_move_watch_state
    if [[ ${watch_status} -ne 0 ]]; then
        oms_br_error "Mail-store directory move watch failed with status ${watch_status}"
        return 1
    fi
    expected_ready_line="Watches established: ${watch_pid}:${watch_start_time}"
    oms_br_count_exact_file_lines \
        "${staging_dir}/mail-store-directory-moves.stderr" \
        "${expected_ready_line}" || return 1
    [[ "${OMS_BR_EXACT_LINE_COUNT}" -eq 1 ]] || return 1
    oms_br_count_exact_file_lines \
        "${staging_dir}/mail-store-directory-moves.stderr" \
        "${expected_drain_line}" || return 1
    [[ "${OMS_BR_EXACT_LINE_COUNT}" -eq 1 ]] || return 1
    while IFS= read -r error_line; do
        case "${error_line}" in
            "${expected_ready_line}"|"${expected_drain_line}") ;;
            '') ;;
            *)
                oms_br_error "Mail-store directory move watch reported an error"
                return 1
                ;;
        esac
    done < "${staging_dir}/mail-store-directory-moves.stderr"
}

oms_br_assert_mail_store_move_watch_active() {
    local staging_dir="$1"
    local watch_pid="${OMS_BR_MAIL_STORE_WATCH_PID:-}"
    local watch_start_time="${OMS_BR_MAIL_STORE_WATCH_START_TIME:-}"
    local control_dir="${OMS_BR_MAIL_STORE_WATCH_CONTROL:-}"
    local sentinel_path="${OMS_BR_MAIL_STORE_WATCH_SENTINEL:-}"
    local expected_ready_line
    local error_line

    [[ -n "${watch_pid}" && "${watch_pid}" =~ ^[0-9]+$ \
        && "${watch_start_time}" =~ ^[0-9]+$ \
        && "${OMS_BR_MAIL_STORE_WATCH_STAGING:-}" == "${staging_dir}" \
        && -n "${control_dir}" && -n "${sentinel_path}" ]] || return 1
    oms_br_mail_store_move_watch_is_active \
        "${watch_pid}" "${watch_start_time}" \
        || { oms_br_error "Mail-store directory move watch exited during live pre-copy"; return 1; }
    oms_br_assert_root_owned_nonwritable_directory \
        "${control_dir}" "mail-store watch control directory" || return 1
    [[ ! -e "${sentinel_path}" && ! -L "${sentinel_path}" ]] \
        || { oms_br_error "Mail-store watcher sentinel appeared before service quiescence"; return 1; }
    expected_ready_line="Watches established: ${watch_pid}:${watch_start_time}"
    oms_br_count_exact_file_lines \
        "${staging_dir}/mail-store-directory-moves.stderr" \
        "${expected_ready_line}" || return 1
    [[ "${OMS_BR_EXACT_LINE_COUNT}" -eq 1 ]] || return 1
    while IFS= read -r error_line; do
        case "${error_line}" in
            "${expected_ready_line}"|'') ;;
            *)
                oms_br_error "Mail-store directory move watch reported unexpected pre-quiescence output"
                return 1
                ;;
        esac
    done < "${staging_dir}/mail-store-directory-moves.stderr"
}

oms_br_precopy_mail_store() {
    local staging_dir="$1"
    local marker_path="${staging_dir}/mail-store-precopy.marker"
    local message_manifest="${staging_dir}/mail-store-message-baseline.manifest"
    local source_path
    local rsync_bin
    local rsync_status
    local source_was_present=0

    source_path=$(oms_br_actual_path mail-store /var/vmail) || return 1
    oms_br_assert_absolute_bounded_path "${source_path}" "inventory source mail-store" \
        || return 1
    oms_br_assert_no_symlink_components "$(dirname -- "${source_path}")" || return 1
    [[ ! -L "${source_path}" ]] \
        || { oms_br_fail "Inventory source root must not be a symlink: ${source_path}"; return 1; }
    if [[ -e "${source_path}" ]]; then
        [[ -d "${source_path}" ]] || return 1
        oms_br_start_mail_store_move_watch "${staging_dir}" "${source_path}" || return 1
        source_was_present=1
    else
        : > "${staging_dir}/mail-store-directory-moves.events" || return 1
        : > "${staging_dir}/mail-store-directory-moves.stderr" || return 1
        chmod 0600 -- \
            "${staging_dir}/mail-store-directory-moves.events" \
            "${staging_dir}/mail-store-directory-moves.stderr" || return 1
    fi
    : > "${marker_path}" || return 1
    chmod 0600 -- "${marker_path}" || return 1
    touch -d '1 second ago' -- "${marker_path}" || return 1
    oms_br_write_mail_store_message_manifest "${source_path}" "${message_manifest}" \
        || return 1
    [[ ${source_was_present} -eq 1 ]] || return 0
    rsync_bin=$(oms_br_rsync_bin) || return 1
    install -d -o root -g root -m 0700 -- "${staging_dir}/payload/mail-store" \
        || return 1
    if OMS_BR_RSYNC_PHASE=live-precopy \
        "${rsync_bin}" -aHAX --numeric-ids --no-specials --no-devices --quiet --delete -- \
            "${source_path}/" "${staging_dir}/payload/mail-store/"; then
        return 0
    else
        rsync_status=$?
    fi

    # A live Maildir can legitimately lose files while rsync is walking it.
    # The stopped convergence pass remains authoritative and must return zero.
    if [[ ${rsync_status} -eq 24 ]]; then
        printf 'Warning: live mail-store pre-copy observed vanished files; continuing to stopped convergence\n' >&2
        return 0
    fi
    oms_br_error "Live mail-store pre-copy failed with rsync status ${rsync_status}"
    return "${rsync_status}"
}

oms_br_converge_changed_mail_store_files() {
    local staging_dir="$1"
    local source_path="$2"
    local rsync_bin="$3"
    local marker_path="${staging_dir}/mail-store-precopy.marker"
    local baseline_manifest="${staging_dir}/mail-store-message-baseline.manifest"
    local launch_identity="${staging_dir}/mail-store-watch.identity"
    local current_manifest="${staging_dir}/mail-store-regular-current.manifest"
    local changed_list="${staging_dir}/mail-store-changed-files.list"
    local changed_directory_list="${staging_dir}/mail-store-changed-directories.list"
    local directory_move_events="${staging_dir}/mail-store-directory-moves.events"
    local directory_move_errors="${staging_dir}/mail-store-directory-moves.stderr"
    local unsupported_list="${staging_dir}/mail-store-unsupported.list"
    local payload_root="${staging_dir}/payload/mail-store"
    local relative_path
    local identity
    local event_path
    local event_names
    local trailing_byte
    local target_path
    local normalized_target
    local -A baseline_identity=()
    local -A changed_identity=()
    local -A forced_directory_path=()
    local -A forced_file_path=()

    [[ -f "${marker_path}" && ! -L "${marker_path}" ]] \
        || { oms_br_fail "Live mail-store pre-copy marker is missing"; return 1; }
    [[ -f "${baseline_manifest}" && ! -L "${baseline_manifest}" ]] \
        || { oms_br_fail "Live Maildir message identity manifest is missing"; return 1; }
    [[ -f "${directory_move_events}" && ! -L "${directory_move_events}" ]] \
        || { oms_br_fail "Live mail-store directory move event log is missing"; return 1; }
    : > "${changed_list}" || return 1
    chmod 0600 -- "${changed_list}" || return 1

    # Maildir message bodies are immutable once atomically delivered into cur
    # or new. Force every mutable/control file, plus messages whose inode path
    # changed or whose inode was written during the live seed.
    if ! (
        cd -- "${source_path}" || exit 1
        find . -regextype posix-extended -type f \
            ! -regex '.*/(cur|new)/[^/]*' -print0 || exit 1
        find . -regextype posix-extended -type f \
            -regex '.*/(cur|new)/[^/]*' -cnewer "${marker_path}" -print0 || exit 1
    ) > "${changed_list}"; then
        oms_br_error "Could not enumerate mail-store files changed during live pre-copy"
        return 1
    fi
    : > "${changed_directory_list}" || return 1
    chmod 0600 -- "${changed_directory_list}" || return 1
    if [[ -s "${directory_move_events}" ]]; then
        trailing_byte=$(tail -c 1 -- "${directory_move_events}" \
            | od -An -tu1 | tr -d '[:space:]') || return 1
        [[ "${trailing_byte}" == "0" ]] \
            || { oms_br_fail "Mail-store directory move event log is truncated"; return 1; }
    fi
    while IFS= read -r -d '' event_path; do
        IFS= read -r -d '' event_names || return 1
        case "${event_names}" in
            Q_OVERFLOW|UNMOUNT|WATCH_LOST)
                oms_br_error "Mail-store directory move watch lost continuity"
                return 1
                ;;
            MOVED_FROM,ISDIR|MOVED_TO,ISDIR) ;;
            *)
                oms_br_error "Mail-store directory move watch emitted an invalid event"
                return 1
                ;;
        esac
        event_path="${event_path%/}"
        [[ "${event_path}" == "${source_path}/"* ]] || return 1
        relative_path=".${event_path#"${source_path}"}"
        [[ "${relative_path}" == ./* && "${relative_path}" != */../* ]] || return 1
        if [[ -z "${forced_directory_path["${relative_path}"]+x}" ]]; then
            forced_directory_path["${relative_path}"]=1
            printf '%s\0' "${relative_path}" >> "${changed_directory_list}" || return 1
        fi
    done < "${directory_move_events}"
    while IFS= read -r -d '' relative_path; do
        [[ "${relative_path}" == ./* ]] || return 1
        if [[ ! -e "${source_path}/${relative_path#./}" \
            && ! -L "${source_path}/${relative_path#./}" ]]; then
            continue
        fi
        if ! (
            cd -- "${source_path}" || exit 1
            find "${relative_path}" -regextype posix-extended -type f \
                -regex '.*/(cur|new)/[^/]*' -print0
        ) >> "${changed_list}"; then
            oms_br_error "Could not enumerate messages below a renamed Maildir folder"
            return 1
        fi
    done < "${changed_directory_list}"
    while IFS= read -r -d '' relative_path; do
        [[ -n "${relative_path}" ]] || return 1
        forced_file_path["${relative_path}"]=1
    done < "${changed_list}"
    oms_br_write_mail_store_regular_manifest "${source_path}" "${current_manifest}" \
        || return 1
    while IFS= read -r -d '' relative_path; do
        IFS= read -r -d '' identity || return 1
        [[ -n "${relative_path}" && -n "${identity}" ]] || return 1
        baseline_identity["${relative_path}"]="${identity}"
    done < "${baseline_manifest}"
    while IFS= read -r -d '' relative_path; do
        IFS= read -r -d '' identity || return 1
        [[ -n "${relative_path}" && -n "${identity}" ]] || return 1
        if [[ -n "${forced_file_path["${relative_path}"]+x}" ]]; then
            changed_identity["${identity}"]=1
        elif [[ "${relative_path}" =~ ^\./(.*/)?(cur|new)/[^/]+$ \
            && -n "${baseline_identity["${relative_path}"]+x}" \
            && "${baseline_identity["${relative_path}"]}" != "${identity}" ]]; then
            changed_identity["${identity}"]=1
        fi
    done < "${current_manifest}"
    while IFS= read -r -d '' relative_path; do
        IFS= read -r -d '' identity || return 1
        if [[ -n "${changed_identity["${identity}"]+x}" ]]; then
            printf '%s\0' "${relative_path}" >> "${changed_list}" || return 1
        fi
    done < "${current_manifest}"

    : > "${unsupported_list}" || return 1
    chmod 0600 -- "${unsupported_list}" || return 1
    if ! (
        cd -- "${source_path}" || exit 1
        find . \( -type b -o -type c -o -type p -o -type s \) -print0
    ) > "${unsupported_list}"; then
        oms_br_error "Could not enumerate unsupported live mail-store objects"
        return 1
    fi
    while IFS= read -r -d '' relative_path; do
        [[ "${relative_path}" == ./* ]] || return 1
        target_path="${payload_root}/${relative_path#./}"
        normalized_target=$(readlink -m -- "${target_path}") || return 1
        [[ "${normalized_target}" == "${payload_root}/"* ]] || return 1
        if [[ -e "${target_path}" || -L "${target_path}" ]]; then
            rm -rf -- "${target_path}" || return 1
        fi
    done < "${unsupported_list}"

    if ! OMS_BR_RSYNC_PHASE=quiesced-changed-files \
        "${rsync_bin}" -aHAX --numeric-ids --no-specials --no-devices --quiet \
            --ignore-times --from0 --files-from="${changed_list}" -- \
            "${source_path}/" "${staging_dir}/payload/mail-store/"; then
        oms_br_error "Could not converge mail-store files changed during live pre-copy"
        return 1
    fi
    rm -f -- \
        "${baseline_manifest}" \
        "${changed_directory_list}" \
        "${changed_list}" \
        "${current_manifest}" \
        "${directory_move_errors}" \
        "${directory_move_events}" \
        "${launch_identity}" \
        "${marker_path}" \
        "${unsupported_list}" || return 1
}

oms_br_copy_inventory() {
    local staging_dir="$1"
    local phase="${2:-quiesced-full-copy}"
    local key
    local logical_path
    local kind
    local extra
    local source_path
    local rsync_bin

    rsync_bin=$(oms_br_rsync_bin) || return 1
    printf '%s\n' $'database\tlogical:oms-databases\tpresent\tfile' > "${staging_dir}/inventory.tsv" \
        || return 1
    while IFS=$'\t' read -r key logical_path kind extra; do
        [[ -n "${key}" && -z "${extra:-}" ]] || return 1
        source_path=$(oms_br_actual_path "${key}" "${logical_path}") || return 1
        oms_br_assert_absolute_bounded_path "${source_path}" "inventory source ${key}" || return 1
        oms_br_assert_no_symlink_components "$(dirname -- "${source_path}")" || return 1
        oms_br_reject_unsafe_text "${logical_path}" "inventory logical path ${key}" || return 1
        [[ ! -L "${source_path}" ]] \
            || { oms_br_fail "Inventory source root must not be a symlink: ${source_path}"; return 1; }
        if [[ -e "${source_path}" ]]; then
            if [[ "${kind}" == "directory" ]]; then
                [[ -d "${source_path}" ]] || return 1
                install -d -o root -g root -m 0700 -- "${staging_dir}/payload/${key}" || return 1
                # Quiesced service trees can still contain stale Unix sockets,
                # FIFOs, or device nodes. They are runtime endpoints, not
                # restorable data; the service recreates them after restart.
                OMS_BR_RSYNC_PHASE="${phase}" \
                "${rsync_bin}" -aHAX --numeric-ids --no-specials --no-devices --quiet --delete -- \
                    "${source_path}/" "${staging_dir}/payload/${key}/" \
                    || return 1
                if [[ "${key}" == "mail-store" && "${phase}" == "quiesced-convergence" ]]; then
                    # File contents changed during the live seed always advance
                    # inode ctime, even when size and mtime are restored.
                    oms_br_converge_changed_mail_store_files \
                        "${staging_dir}" "${source_path}" "${rsync_bin}" || return 1
                fi
            else
                [[ -f "${source_path}" ]] || return 1
                cp -a -- "${source_path}" "${staging_dir}/payload/${key}" || return 1
            fi
            printf '%s\t%s\tpresent\t%s\n' "${key}" "${logical_path}" "${kind}" \
                >> "${staging_dir}/inventory.tsv" || return 1
        else
            if [[ "${key}" == "mail-store" ]]; then
                rm -rf -- "${staging_dir}/payload/mail-store" || return 1
                rm -f -- \
                    "${staging_dir}/mail-store-changed-files.list" \
                    "${staging_dir}/mail-store-changed-directories.list" \
                    "${staging_dir}/mail-store-directory-moves.events" \
                    "${staging_dir}/mail-store-directory-moves.stderr" \
                    "${staging_dir}/mail-store-message-baseline.manifest" \
                    "${staging_dir}/mail-store-watch.identity" \
                    "${staging_dir}/mail-store-regular-current.manifest" \
                    "${staging_dir}/mail-store-precopy.marker" \
                    "${staging_dir}/mail-store-unsupported.list" || return 1
            fi
            printf '%s\t%s\tabsent\t%s\n' "${key}" "${logical_path}" "${kind}" \
                >> "${staging_dir}/inventory.tsv" || return 1
        fi
    done < <(oms_br_inventory_specs)
}

oms_br_capture_snapshot_stage() {
    local staging_dir="$1"
    local inventory_phase="${2:-quiesced-full-copy}"

    oms_br_write_database_manifest "${staging_dir}/databases.tsv" || return 1
    oms_br_dump_databases "${staging_dir}/databases.sql" "${staging_dir}/databases.tsv" || return 1
    oms_br_copy_inventory "${staging_dir}" "${inventory_phase}" || return 1
}

oms_br_finalize_snapshot_stage() {
    local staging_dir="$1"
    local snapshot_kind="$2"
    local created_at="$3"
    local service_quiescence_mode="${4:-managed_externally}"
    local service_quiescence_ms="${5:-}"
    local service_outage_window_ms="${6:-}"

    case "${service_quiescence_mode}" in
        managed)
            [[ "${service_quiescence_ms}" =~ ^[0-9]+$ \
                && "${service_outage_window_ms}" =~ ^[0-9]+$ ]] || return 1
            (( 10#${service_outage_window_ms} >= 10#${service_quiescence_ms} )) \
                || return 1
            ;;
        managed_externally)
            [[ -z "${service_quiescence_ms}" && -z "${service_outage_window_ms}" ]] \
                || return 1
            ;;
        *) return 1 ;;
    esac

    {
        printf 'format_version\t1\n'
        printf 'snapshot_kind\t%s\n' "${snapshot_kind}"
        printf 'created_at_utc\t%s\n' "${created_at}"
        printf 'database_dump\tlogical_configured_databases\n'
        printf 'database_scope\tconfigured_openmailstack_databases\n'
        printf 'database_restore_semantics\tlogical_replace_listed_databases\n'
        printf 'mysql_configuration\tnot_included\n'
        printf 'encryption\tnone\n'
        printf 'point_in_time_recovery\tnot_available\n'
        printf 'service_quiescence_mode\t%s\n' "${service_quiescence_mode}"
        if [[ "${service_quiescence_mode}" == "managed" ]]; then
            printf 'service_quiescence_ms\t%s\n' "${service_quiescence_ms}"
            printf 'service_outage_window_ms\t%s\n' "${service_outage_window_ms}"
        fi
    } > "${staging_dir}/snapshot.meta" || return 1
    oms_br_symlink_manifest "${staging_dir}" "${staging_dir}/symlinks.tsv" || return 1
    oms_br_generate_checksums "${staging_dir}" "${staging_dir}/checksums.sha256" || return 1
    chmod 0600 -- \
        "${staging_dir}/databases.sql" \
        "${staging_dir}/databases.tsv" \
        "${staging_dir}/inventory.tsv" \
        "${staging_dir}/snapshot.meta" \
        "${staging_dir}/symlinks.tsv" \
        "${staging_dir}/checksums.sha256" || return 1
}

oms_br_build_snapshot_stage() {
    local staging_dir="$1"
    local snapshot_kind="$2"
    local created_at="$3"

    oms_br_capture_snapshot_stage "${staging_dir}" || return 1
    oms_br_finalize_snapshot_stage "${staging_dir}" "${snapshot_kind}" "${created_at}"
}

oms_br_backup_cleanup() {
    local status=$?
    local resume_status=0
    local watch_status=0
    trap - EXIT INT TERM HUP
    if ! oms_br_terminate_mail_store_move_watch; then
        oms_br_error "Failed to stop the mail-store directory move watch"
        watch_status=1
    fi
    if [[ "${OMS_BR_SERVICES_QUIESCED}" == "1" ]]; then
        if ! oms_br_resume_services; then
            oms_br_error "Failed to restore the exact pre-backup service state"
            resume_status=1
        fi
        if ! oms_br_wait_for_health; then
            oms_br_error "Post-backup health check failed"
            resume_status=1
        fi
    fi
    if [[ ${status} -eq 0 && ( ${resume_status} -ne 0 || ${watch_status} -ne 0 ) ]]; then
        status=1
    fi
    exit "${status}"
}

oms_br_create_backup_unlocked() {
    local snapshot_kind="$1"
    local name_prefix="$2"
    local service_mode="${3:-manage-services}"
    local backup_root
    local timestamp
    local snapshot_name
    local final_dir
    local staging_dir

    backup_root=$(oms_br_backup_root) || return 1
    oms_br_prepare_secure_directory "${backup_root}" "backup root" || return 1
    timestamp="${OMS_BACKUP_TIMESTAMP:-$(date -u +%Y%m%dT%H%M%SZ)}"
    [[ "${timestamp}" =~ ^[0-9]{8}T[0-9]{6}Z$ ]] \
        || { oms_br_fail "Backup timestamp must use YYYYMMDDTHHMMSSZ"; return 1; }
    snapshot_name="${name_prefix}-${timestamp}"
    final_dir="${backup_root}/${snapshot_name}"
    staging_dir="${final_dir}.incomplete"
    [[ ! -e "${final_dir}" && ! -L "${final_dir}" \
        && ! -e "${staging_dir}" && ! -L "${staging_dir}" ]] \
        || { oms_br_fail "Snapshot path already exists: ${snapshot_name}"; return 1; }
    install -d -o root -g root -m 0700 -- "${staging_dir}" "${staging_dir}/payload" \
        || return 1

    case "${service_mode}" in
        manage-services)
            if ! (
                set -Eeuo pipefail
                # This state intentionally belongs to the trapped subshell.
                # shellcheck disable=SC2030
                OMS_BR_SERVICES_QUIESCED=0
                OMS_BR_MAIL_STORE_WATCH_PID=""
                OMS_BR_MAIL_STORE_WATCH_START_TIME=""
                OMS_BR_MAIL_STORE_WATCH_STAGING=""
                OMS_BR_MAIL_STORE_WATCH_SOURCE=""
                OMS_BR_MAIL_STORE_WATCH_CONTROL=""
                OMS_BR_MAIL_STORE_WATCH_SENTINEL=""
                OMS_BR_MAIL_STORE_WATCH_SENTINEL_ID=""
                OMS_BR_MAIL_STORE_WATCH_EXIT_STATUS=""
                OMS_BR_MAIL_STORE_WATCH_REPORTED_PID=""
                OMS_BR_MAIL_STORE_WATCH_REPORTED_START_TIME=""
                trap oms_br_backup_cleanup EXIT
                trap 'exit 130' INT
                trap 'exit 143' TERM
                trap 'exit 129' HUP
                oms_br_precopy_mail_store "${staging_dir}" || exit $?
                oms_br_record_active_services || exit $?
                if [[ -n "${OMS_BR_MAIL_STORE_WATCH_PID}" ]]; then
                    oms_br_assert_mail_store_move_watch_active "${staging_dir}" || exit $?
                fi
                service_quiescence_started_ms=$(date +%s%3N) || exit $?
                [[ "${service_quiescence_started_ms}" =~ ^[0-9]+$ ]] || exit 1
                oms_br_quiesce_services || exit $?
                if [[ -n "${OMS_BR_MAIL_STORE_WATCH_PID}" ]]; then
                    oms_br_stop_mail_store_move_watch "${staging_dir}" || exit $?
                fi
                oms_br_capture_snapshot_stage "${staging_dir}" quiesced-convergence || exit $?
                oms_br_resume_services || exit $?
                service_quiescence_finished_ms=$(date +%s%3N) || exit $?
                [[ "${service_quiescence_finished_ms}" =~ ^[0-9]+$ \
                    && "${service_quiescence_finished_ms}" -ge "${service_quiescence_started_ms}" ]] \
                    || exit 1
                service_quiescence_ms=$((service_quiescence_finished_ms - service_quiescence_started_ms))
                OMS_BR_SERVICES_QUIESCED=0
                oms_br_wait_for_health || exit $?
                service_outage_finished_ms=$(date +%s%3N) || exit $?
                [[ "${service_outage_finished_ms}" =~ ^[0-9]+$ \
                    && "${service_outage_finished_ms}" -ge "${service_quiescence_finished_ms}" ]] \
                    || exit 1
                service_outage_window_ms=$((service_outage_finished_ms - service_quiescence_started_ms))
                oms_br_finalize_snapshot_stage \
                    "${staging_dir}" "${snapshot_kind}" "${timestamp}" \
                    managed "${service_quiescence_ms}" "${service_outage_window_ms}" || exit $?
                trap - EXIT INT TERM HUP
            ); then
                oms_br_error "Snapshot remains incomplete and was not promoted: ${staging_dir}"
                return 1
            fi
            ;;
        already-quiesced)
            oms_br_build_snapshot_stage "${staging_dir}" "${snapshot_kind}" "${timestamp}" \
                || { oms_br_error "Snapshot remains incomplete and was not promoted: ${staging_dir}"; return 1; }
            ;;
        *)
            oms_br_fail "Invalid internal snapshot service mode"
            return 1
            ;;
    esac

    oms_br_validate_snapshot_contents "${staging_dir}" || return 1
    [[ "$(stat -c '%u:%a' -- "${staging_dir}")" == "0:700" ]] || return 1
    mv -- "${staging_dir}" "${final_dir}" || return 1
    printf '%s\n' "${final_dir}"
}

oms_br_prepare_lock() {
    local lock_file="${OMS_BACKUP_LOCK_FILE:-/run/openmailstack/backup-restore.lock}"
    local lock_dir

    oms_br_assert_absolute_bounded_path "${lock_file}" "backup lock file" || return 1
    oms_br_assert_no_symlink_components "${lock_file}" || return 1
    lock_dir=$(dirname -- "${lock_file}")
    if [[ ! -e "${lock_dir}" ]]; then
        install -d -o root -g root -m 0755 -- "${lock_dir}" || return 1
    fi
    oms_br_assert_root_owned_nonwritable_directory "${lock_dir}" "backup lock directory" \
        || return 1
    if [[ -e "${lock_file}" || -L "${lock_file}" ]]; then
        [[ -f "${lock_file}" && ! -L "${lock_file}" \
            && "$(stat -c '%u' -- "${lock_file}")" == "0" ]] || return 1
    else
        install -o root -g root -m 0600 /dev/null "${lock_file}" || return 1
    fi
    chmod 0600 -- "${lock_file}" || return 1
    printf '%s\n' "${lock_file}"
}

oms_br_with_lock() {
    local callback="$1"
    shift
    local lock_file
    local lock_fd

    lock_file=$(oms_br_prepare_lock) || return 1
    exec {lock_fd}>"${lock_file}" || return 1
    if ! flock -n "${lock_fd}"; then
        oms_br_error "Another backup or restore operation is already running"
        exec {lock_fd}>&-
        return 1
    fi
    local status=0
    if "${callback}" "$@"; then
        status=0
    else
        status=$?
    fi
    flock -u "${lock_fd}" || status=1
    exec {lock_fd}>&-
    return "${status}"
}

create_backup() {
    umask 077
    oms_br_require_root || return 1
    oms_br_path_prefix >/dev/null || return 1
    oms_br_with_lock oms_br_create_backup_unlocked full oms-backup
}

oms_br_restore_database() {
    local snapshot_dir="$1"
    local mysql_bin
    mysql_bin=$(oms_br_mysql_bin) \
        || { oms_br_error "Database client is unavailable during restore"; return 1; }
    [[ -s "${snapshot_dir}/databases.sql" ]] \
        || { oms_br_error "Database dump is missing or empty during restore"; return 1; }
    if ! "${mysql_bin}" --binary-mode < "${snapshot_dir}/databases.sql"; then
        oms_br_error "Database import failed for snapshot $(basename -- "${snapshot_dir}")"
        return 1
    fi
}

oms_br_remove_target() {
    local target="$1"
    oms_br_assert_absolute_bounded_path "${target}" "restore target" || return 1
    [[ "${target}" != "${OMS_BACKUP_PATH_PREFIX:-}" ]] || return 1
    if [[ -e "${target}" || -L "${target}" ]]; then
        rm -rf -- "${target}" || return 1
    fi
}

oms_br_restore_files() {
    local snapshot_dir="$1"
    local key
    local logical_path
    local state
    local kind
    local extra
    local target
    local rsync_bin

    rsync_bin=$(oms_br_rsync_bin) || return 1
    while IFS=$'\t' read -r key logical_path state kind extra; do
        [[ "${key}" != "database" ]] || continue
        [[ -n "${key}" && -z "${extra:-}" ]] || return 1
        target=$(oms_br_actual_path "${key}" "${logical_path}") || return 1
        oms_br_assert_absolute_bounded_path "${target}" "restore target ${key}" || return 1
        oms_br_assert_no_symlink_components "$(dirname -- "${target}")" || return 1
        mkdir -p -- "$(dirname -- "${target}")" || return 1
        if [[ "${state}" == "absent" ]]; then
            oms_br_remove_target "${target}" \
                || { oms_br_error "Could not remove absent inventory target ${key}"; return 1; }
        elif [[ "${kind}" == "directory" ]]; then
            if [[ -d "${target}" && ! -L "${target}" ]]; then
                "${rsync_bin}" -aHAX --numeric-ids --delete -- \
                    "${snapshot_dir}/payload/${key}/" "${target}/" \
                    || { oms_br_error "Could not restore directory inventory target ${key}"; return 1; }
            else
                oms_br_remove_target "${target}" \
                    || { oms_br_error "Could not replace directory inventory target ${key}"; return 1; }
                cp -a -- "${snapshot_dir}/payload/${key}" "${target}" \
                    || { oms_br_error "Could not restore directory inventory target ${key}"; return 1; }
            fi
        else
            oms_br_remove_target "${target}" \
                || { oms_br_error "Could not replace file inventory target ${key}"; return 1; }
            cp -a -- "${snapshot_dir}/payload/${key}" "${target}" \
                || { oms_br_error "Could not restore file inventory target ${key}"; return 1; }
        fi
    done < "${snapshot_dir}/inventory.tsv"
}

oms_br_apply_snapshot() {
    local snapshot_dir="$1"
    oms_br_restore_files "${snapshot_dir}" || return 1
    oms_br_restore_database "${snapshot_dir}" || return 1
}

OMS_BR_RESTORE_TARGET=""
OMS_BR_RESTORE_SAFETY=""
OMS_BR_RESTORE_MUTATION_STARTED=0
OMS_BR_RESTORE_COMMITTED=0

oms_br_restore_cleanup() {
    local status=$?
    local recovery_status=0
    local resume_status=0
    local health_status=0
    trap - EXIT INT TERM HUP

    if [[ "${OMS_BR_RESTORE_COMMITTED}" != "1" \
        && "${OMS_BR_RESTORE_MUTATION_STARTED}" == "1" ]]; then
        oms_br_error "Requested restore failed; attempting verified pre-restore recovery"
        # A failed resume can leave only some units running while the flag still
        # says the restore is quiesced. Re-check and stop every originally active
        # unit before applying the safety snapshot, even when the flag is set.
        if ! oms_br_quiesce_services; then
            oms_br_error "Could not re-quiesce services before safety recovery"
            recovery_status=1
        fi
        if [[ ${recovery_status} -eq 0 ]] \
            && ! oms_br_apply_snapshot "${OMS_BR_RESTORE_SAFETY}"; then
            oms_br_error "Pre-restore safety snapshot recovery failed"
            recovery_status=1
        fi
    fi

    # Restore trap and mutation run in the same subshell.
    # shellcheck disable=SC2031
    if [[ "${OMS_BR_SERVICES_QUIESCED}" == "1" ]]; then
        if ! oms_br_resume_services; then
            oms_br_error "Failed to restore the exact pre-restore service state"
            resume_status=1
        fi
    fi
    if ! oms_br_wait_for_health; then
        oms_br_error "Post-restore/recovery health check failed"
        health_status=1
    fi

    if [[ ${status} -eq 0 && (${recovery_status} -ne 0 || ${resume_status} -ne 0 || ${health_status} -ne 0) ]]; then
        status=1
    fi
    if [[ ${recovery_status} -ne 0 || ${resume_status} -ne 0 || ${health_status} -ne 0 ]]; then
        status=1
    fi
    exit "${status}"
}

oms_br_restore_locked() {
    local requested_snapshot="$1"

    oms_br_validate_trusted_snapshot "${requested_snapshot}" || return 1

    (
        set -Eeuo pipefail
        OMS_BR_RESTORE_TARGET="${requested_snapshot}"
        OMS_BR_RESTORE_SAFETY=""
        OMS_BR_RESTORE_MUTATION_STARTED=0
        OMS_BR_RESTORE_COMMITTED=0
        OMS_BR_SERVICES_QUIESCED=0
        trap oms_br_restore_cleanup EXIT
        trap 'exit 130' INT
        trap 'exit 143' TERM
        trap 'exit 129' HUP

        oms_br_record_active_services || exit $?
        oms_br_quiesce_services || exit $?
        OMS_BR_RESTORE_SAFETY=$(oms_br_create_backup_unlocked \
            pre-restore oms-pre-restore already-quiesced) || exit $?
        oms_br_validate_trusted_snapshot "${OMS_BR_RESTORE_SAFETY}" || exit $?
        # Recheck after the safety snapshot while mutation services remain
        # quiesced, closing the preflight-to-mutation interval.
        oms_br_validate_trusted_snapshot "${requested_snapshot}" || exit $?
        OMS_BR_RESTORE_MUTATION_STARTED=1
        oms_br_apply_snapshot "${OMS_BR_RESTORE_TARGET}" || exit $?
        oms_br_resume_services || exit $?
        OMS_BR_SERVICES_QUIESCED=0
        oms_br_wait_for_health || exit $?
        OMS_BR_RESTORE_COMMITTED=1
        OMS_BR_RESTORE_MUTATION_STARTED=0
        trap - EXIT INT TERM HUP
    )
}

restore_snapshot() {
    local requested_snapshot="$1"
    umask 077
    oms_br_require_root || return 1
    oms_br_path_prefix >/dev/null || return 1
    oms_br_with_lock oms_br_restore_locked "${requested_snapshot}"
}

verify_backup() {
    local requested_snapshot="$1"
    umask 077
    oms_br_require_root || return 1
    oms_br_path_prefix >/dev/null || return 1
    oms_br_validate_trusted_snapshot "${requested_snapshot}"
}

cleanup_old_backups() {
    # Retention is deliberately operator-managed. Automatic deletion would turn
    # a backup command into an unrelated destructive action.
    return 0
}

restore_backup() {
    local backup_root
    local -a backups=()
    local candidate
    local index
    local selection
    local confirmation

    umask 077
    oms_br_require_root || return 1
    oms_br_path_prefix >/dev/null || return 1
    backup_root=$(oms_br_backup_root) || return 1
    oms_br_prepare_secure_directory "${backup_root}" "backup root" || return 1
    while IFS= read -r -d '' candidate; do
        if oms_br_validate_trusted_snapshot "${candidate}" >/dev/null 2>&1; then
            backups+=("${candidate}")
        fi
    done < <(find "${backup_root}" -mindepth 1 -maxdepth 1 -type d \
        -name 'oms-*-????????T??????Z' -print0 | sort -z)
    [[ ${#backups[@]} -gt 0 ]] || oms_br_fail "No complete trusted snapshots found"

    echo "Available OpenMailStack snapshots:"
    for index in "${!backups[@]}"; do
        printf '%d) %s\n' "$((index + 1))" "$(basename -- "${backups[index]}")"
    done
    read -r -p "Select a snapshot number (or c to cancel): " selection
    [[ "${selection}" != "c" && "${selection}" != "C" ]] || return 0
    [[ "${selection}" =~ ^[0-9]+$ \
        && ${selection} -ge 1 && ${selection} -le ${#backups[@]} ]] \
        || oms_br_fail "Invalid snapshot selection"
    read -r -p "Type RESTORE to overwrite this host from the selected snapshot: " confirmation
    [[ "${confirmation}" == "RESTORE" ]] || return 0
    restore_snapshot "${backups[selection - 1]}"
}

oms_br_usage() {
    cat <<EOF
Usage:
  $0 backup
  $0 verify <absolute-snapshot-path>
  $0 restore <absolute-snapshot-path> --confirm

Snapshots are root-only logical full backups with checksums. They are not
encrypted, signed, incremental, or point-in-time-recovery archives. Database
restore replaces the configured OMS databases; unrelated databases and MariaDB
system schemas/accounts are outside the snapshot contract.
Set OMS_BACKUP_DATABASES to a space-separated allowlist for custom database names.
EOF
}

oms_br_main() {
    local action="${1:-}"
    case "${action}" in
        backup)
            [[ $# -eq 1 ]] || { oms_br_usage >&2; return 64; }
            create_backup
            ;;
        verify)
            [[ $# -eq 2 ]] || { oms_br_usage >&2; return 64; }
            verify_backup "$2"
            ;;
        restore)
            [[ $# -eq 3 && "$3" == "--confirm" ]] \
                || { oms_br_usage >&2; return 64; }
            restore_snapshot "$2"
            ;;
        -h|--help|help)
            oms_br_usage
            ;;
        *)
            oms_br_usage >&2
            return 64
            ;;
    esac
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
    set -Eeuo pipefail
    oms_br_main "$@"
fi

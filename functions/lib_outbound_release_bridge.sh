#!/usr/bin/env bash

# Proves that a legacy -> rollback-compatible bridge transition cannot expose
# rows whose durable semantics the legacy scheduler does not understand.
openmailstack_outbound_compatibility_marker_is_trusted() {
    local source_marker="$1"
    local candidate_marker="$2"

    [[ -s "${source_marker}" && -f "${source_marker}" && ! -L "${source_marker}" ]] || return 1
    [[ -s "${candidate_marker}" && -f "${candidate_marker}" && ! -L "${candidate_marker}" ]] || return 1
    [[ "$(stat -c '%u:%g:%a' -- "${candidate_marker}")" == "0:0:444" ]] || return 1
    cmp -s -- "${source_marker}" "${candidate_marker}"
}

openmailstack_outbound_path_ancestors_are_trusted() {
    local candidate="${1%/}"
    local ancestor
    local metadata
    local owner_uid
    local owner_gid
    local mode
    local mode_value

    [[ "${candidate}" == /* && -e "${candidate}" && ! -L "${candidate}" ]] || return 1
    [[ "$(readlink -f -- "${candidate}")" == "${candidate}" ]] || return 1
    ancestor=$(dirname -- "${candidate}") || return 1
    while true; do
        [[ -d "${ancestor}" && ! -L "${ancestor}" ]] || return 1
        metadata=$(stat -c '%u:%g:%a' -- "${ancestor}") || return 1
        IFS=: read -r owner_uid owner_gid mode <<< "${metadata}"
        [[ "${owner_uid}" == "0" && "${owner_gid}" == "0" \
            && "${mode}" =~ ^[0-7]{3,4}$ ]] || return 1
        mode_value=$((8#${mode}))
        (( (mode_value & 8#022) == 0 )) || return 1
        [[ "${ancestor}" == "/" ]] && break
        ancestor=$(dirname -- "${ancestor}") || return 1
    done
}

openmailstack_outbound_environment_is_trusted() {
    local environment_file="$1"

    [[ -s "${environment_file}" && -f "${environment_file}" \
        && ! -L "${environment_file}" ]] || return 1
    openmailstack_outbound_path_ancestors_are_trusted "${environment_file}" || return 1
    [[ "$(stat -c '%u:%g:%a' -- "${environment_file}")" == "0:0:600" ]]
}

openmailstack_outbound_release_mode_is_absent() {
    local environment_file="$1"

    [[ -s "${environment_file}" && -f "${environment_file}" \
        && ! -L "${environment_file}" ]] || return 1
    ! LC_ALL=C grep -Eq \
        '^[[:space:]]*OMS_OUTBOUND_RELEASE_MODE[[:space:]]*=' \
        -- "${environment_file}"
}

# uploads/ is the sole backend-local runtime-write boundary. Every other
# runtime entry, including the resolved targets of npm's internal symlinks,
# must remain inside the protected tree and outside uploads/.
openmailstack_outbound_backend_runtime_is_trusted() {
    local candidate_backend="$1"
    local required_runtime_file
    local unsafe_runtime_path
    local runtime_symlink
    local symlink_target
    local lexical_target
    local resolved_target
    local symlink_find_fd
    local symlink_find_pid
    local -a runtime_symlinks=()

    [[ -d "${candidate_backend}" && ! -L "${candidate_backend}" ]] || return 1
    openmailstack_outbound_path_ancestors_are_trusted "${candidate_backend}" || return 1
    [[ -d "${candidate_backend}/src" && ! -L "${candidate_backend}/src" ]] || return 1
    [[ ! -e "${candidate_backend}/uploads" \
        || ( -d "${candidate_backend}/uploads" && ! -L "${candidate_backend}/uploads" ) ]] || return 1
    for required_runtime_file in config.js scheduled-send.js api.js index.js eas-send.js; do
        [[ -s "${candidate_backend}/src/${required_runtime_file}" \
            && -f "${candidate_backend}/src/${required_runtime_file}" \
            && ! -L "${candidate_backend}/src/${required_runtime_file}" ]] || return 1
    done
    unsafe_runtime_path=$(find "${candidate_backend}" \
        -path "${candidate_backend}/uploads" -prune -o \
        \( \
            \( -type l \( ! -uid 0 -o ! -gid 0 \) \) \
            -o \
            \( ! -type l \( ! -uid 0 -o ! -gid 0 -o -perm /022 \) \) \
            -o \
            \( -type d ! -perm -005 \) \
            -o \
            \( -type f ! -perm -004 \) \
        \) \
        -print -quit) || return 1
    [[ -z "${unsafe_runtime_path}" ]] || return 1

    exec {symlink_find_fd}< <(find "${candidate_backend}" \
        -path "${candidate_backend}/uploads" -prune -o -type l -print0) || return 1
    symlink_find_pid=$!
    while IFS= read -r -d '' -u "${symlink_find_fd}" runtime_symlink; do
        runtime_symlinks+=("${runtime_symlink}")
    done
    exec {symlink_find_fd}<&-
    wait "${symlink_find_pid}" || return 1

    for runtime_symlink in "${runtime_symlinks[@]}"; do
        symlink_target=$(readlink -- "${runtime_symlink}") || return 1
        if [[ "${symlink_target}" == /* ]]; then
            lexical_target=$(realpath -ms -- "${symlink_target}") || return 1
        else
            lexical_target=$(realpath -ms -- \
                "$(dirname -- "${runtime_symlink}")/${symlink_target}") || return 1
        fi
        case "${lexical_target}" in
            "${candidate_backend}/uploads"|"${candidate_backend}/uploads/"*) return 1 ;;
            "${candidate_backend}/"*) ;;
            *) return 1 ;;
        esac
        resolved_target=$(readlink -f -- "${runtime_symlink}") || return 1
        [[ -e "${resolved_target}" ]] || return 1
        case "${resolved_target}" in
            "${candidate_backend}/uploads"|"${candidate_backend}/uploads/"*) return 1 ;;
            "${candidate_backend}/"*) ;;
            *) return 1 ;;
        esac
    done
}

# The marker is meaningful only when the service account cannot alter or
# replace the runtime that carries it.
openmailstack_outbound_runtime_is_trusted() {
    local source_marker="$1"
    local candidate_backend="$2"
    local candidate_marker="${candidate_backend}/OUTBOUND_RELEASE_COMPATIBILITY"

    openmailstack_outbound_backend_runtime_is_trusted "${candidate_backend}" || return 1
    openmailstack_outbound_compatibility_marker_is_trusted \
        "${source_marker}" "${candidate_marker}"
}

openmailstack_outbound_legacy_runtime_is_trusted() {
    local candidate_backend="$1"
    local candidate_marker="${candidate_backend}/OUTBOUND_RELEASE_COMPATIBILITY"

    [[ ! -e "${candidate_marker}" && ! -L "${candidate_marker}" ]] || return 1
    openmailstack_outbound_backend_runtime_is_trusted "${candidate_backend}"
}

openmailstack_verify_outbound_bridge_transition() {
    local mysql_bin="$1"
    local db_host="$2"
    local db_port="$3"
    local db_user="$4"
    local db_password="$5"
    local db_name="$6"
    local schema_column_count
    local nonlegacy_row_count

    [[ -x "${mysql_bin}" ]] || {
        echo "Error: outbound bridge database client is unavailable" >&2
        return 1
    }
    [[ -n "${db_host}" && "${db_port}" =~ ^[0-9]+$ \
        && ${db_port} -ge 1 && ${db_port} -le 65535 \
        && -n "${db_user}" && -n "${db_name}" ]] || {
        echo "Error: outbound bridge database configuration is invalid" >&2
        return 1
    }

    schema_column_count=$(MYSQL_PWD="${db_password}" "${mysql_bin}" \
        --batch --raw --skip-column-names --connect-timeout=5 \
        --host="${db_host}" --port="${db_port}" --user="${db_user}" "${db_name}" <<'SQL'
SELECT COUNT(*)
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'scheduled_emails'
  AND COLUMN_NAME IN (
    'payload_version', 'submission_kind', 'idempotency_key', 'request_fingerprint',
    'save_in_sent_items', 'status', 'available_at', 'attempts', 'lease_owner',
    'lease_expires_at', 'sender_address', 'message_id', 'envelope_json',
    'rejected_recipients_json', 'raw_message', 'sent_raw_message',
    'smtp_accepted_at', 'sent_copy_completed_at', 'completed_at', 'cancelled_at',
    'removed_at', 'last_error_code', 'last_error_at', 'updated_at'
  );
SQL
    ) || {
        echo "Error: outbound bridge schema evidence could not be read" >&2
        return 1
    }

    [[ "${schema_column_count}" =~ ^[0-9]+$ ]] || {
        echo "Error: outbound bridge database returned invalid schema evidence" >&2
        return 1
    }
    if [[ "${schema_column_count}" == "0" ]]; then
        return 0
    fi
    if [[ "${schema_column_count}" != "24" ]]; then
        echo "Error: scheduled_emails is partially expanded and cannot safely transition through the legacy bridge" >&2
        return 1
    fi

    nonlegacy_row_count=$(MYSQL_PWD="${db_password}" "${mysql_bin}" \
        --batch --raw --skip-column-names --connect-timeout=5 \
        --host="${db_host}" --port="${db_port}" --user="${db_user}" "${db_name}" <<'SQL'
SELECT COUNT(*)
FROM scheduled_emails
WHERE COALESCE(payload_version, 0) <> 1
   OR COALESCE(submission_kind, '') <> 'scheduled'
   OR idempotency_key IS NOT NULL
   OR request_fingerprint IS NOT NULL
   OR COALESCE(save_in_sent_items, 1) <> 1
   OR COALESCE(status, '') <> 'scheduled'
   OR COALESCE(attempts, 0) <> 0
   OR lease_owner IS NOT NULL
   OR lease_expires_at IS NOT NULL
   OR message_id IS NOT NULL
   OR envelope_json IS NOT NULL
   OR rejected_recipients_json IS NOT NULL
   OR raw_message IS NOT NULL
   OR sent_raw_message IS NOT NULL
   OR smtp_accepted_at IS NOT NULL
   OR sent_copy_completed_at IS NOT NULL
   OR completed_at IS NOT NULL
   OR cancelled_at IS NOT NULL
   OR removed_at IS NOT NULL
   OR last_error_code IS NOT NULL
   OR last_error_at IS NOT NULL;
SQL
    ) || {
        echo "Error: outbound bridge durable row evidence could not be read" >&2
        return 1
    }

    [[ "${nonlegacy_row_count}" =~ ^[0-9]+$ ]] || {
        echo "Error: outbound bridge database returned invalid durable row evidence" >&2
        return 1
    }
    if [[ "${nonlegacy_row_count}" != "0" ]]; then
        echo "Error: ${nonlegacy_row_count} nonlegacy outbound row(s) make a legacy bridge rollback unsafe" >&2
        return 1
    fi
}

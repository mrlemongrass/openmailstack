#!/usr/bin/env bash

openmailstack_remove_empty_legacy_quota_dict() {
    local config_path="$1"
    local migrated_path

    [[ -f "${config_path}" ]] || {
        echo "Dovecot configuration not found: ${config_path}" >&2
        return 1
    }

    migrated_path=$(mktemp "${config_path}.openmailstack.XXXXXX") || return 1
    if ! awk '
        function flush_candidate(    item_index) {
            for (item_index = 1; item_index <= candidate_count; item_index++) {
                print candidate[item_index]
            }
            delete candidate
            candidate_count = 0
            candidate_has_settings = 0
            in_candidate = 0
        }

        /^[[:space:]]*dict[[:space:]]+quota[[:space:]]*\{[[:space:]]*$/ && !in_candidate {
            in_candidate = 1
            candidate_count = 1
            candidate[candidate_count] = $0
            next
        }

        in_candidate {
            candidate_count++
            candidate[candidate_count] = $0

            if ($0 ~ /^[[:space:]]*}[[:space:]]*$/) {
                if (candidate_has_settings) {
                    flush_candidate()
                } else {
                    delete candidate
                    candidate_count = 0
                    in_candidate = 0
                }
                next
            }

            if ($0 !~ /^[[:space:]]*($|#)/) {
                candidate_has_settings = 1
            }
            next
        }

        { print }

        END {
            if (in_candidate) {
                flush_candidate()
            }
        }
    ' "${config_path}" > "${migrated_path}"; then
        rm -f -- "${migrated_path}"
        return 1
    fi

    if cmp -s -- "${config_path}" "${migrated_path}"; then
        rm -f -- "${migrated_path}"
        return 0
    fi

    # Copy over the existing inode so ownership, mode, ACLs, and labels remain intact.
    if ! cp -- "${migrated_path}" "${config_path}"; then
        rm -f -- "${migrated_path}"
        return 1
    fi
    rm -f -- "${migrated_path}"
}

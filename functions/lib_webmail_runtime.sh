#!/usr/bin/env bash

openmailstack_webmail_scheduler_worker_managed() {
    [[ -f /etc/openmailstack/scheduler.enabled \
        && -f /etc/systemd/system/openmailstack-scheduler-worker.service ]]
}

openmailstack_webmail_scheduler_worker_load_state() {
    systemctl show --property=LoadState --value openmailstack-scheduler-worker.service
}

openmailstack_webmail_unit_quiesced() {
    local unit_name="$1"
    local active_state

    active_state=$(systemctl show --property=ActiveState --value "${unit_name}") || return 1
    [[ "${active_state}" == "inactive" || "${active_state}" == "failed" ]]
}

openmailstack_stop_webmail_unit_for_tree_mutation() {
    local unit_name="$1"

    systemctl stop --no-block "${unit_name}" || return 1
    protocol_retry_command 30 1 openmailstack_webmail_unit_quiesced "${unit_name}" || {
        echo "Timed out waiting for ${unit_name} to stop before mutating backend files" >&2
        return 1
    }
}

openmailstack_quiesce_webmail_runtime_for_tree_mutation() {
    local scheduler_load_state

    scheduler_load_state=$(openmailstack_webmail_scheduler_worker_load_state) || {
        echo "Could not determine whether openmailstack-scheduler-worker.service is loaded" >&2
        return 1
    }
    [[ -n "${scheduler_load_state}" ]] || return 1

    if ! openmailstack_webmail_scheduler_worker_managed \
        && [[ "${scheduler_load_state}" != "not-found" ]] \
        && ! openmailstack_webmail_unit_quiesced openmailstack-scheduler-worker.service; then
        echo "Refusing backend mutation while an unmanaged Scheduler worker is not quiesced" >&2
        return 1
    fi

    openmailstack_stop_webmail_unit_for_tree_mutation openmailstack.service || return 1
    if openmailstack_webmail_scheduler_worker_managed; then
        openmailstack_stop_webmail_unit_for_tree_mutation openmailstack-scheduler-worker.service || return 1
    elif [[ "${scheduler_load_state}" != "not-found" ]] \
        && ! openmailstack_webmail_unit_quiesced openmailstack-scheduler-worker.service; then
        echo "Unmanaged Scheduler worker changed state before backend mutation" >&2
        return 1
    fi
}

openmailstack_start_quiesced_webmail_unit() {
    local unit_name="$1"

    systemctl reset-failed "${unit_name}" || return 1
    systemctl start "${unit_name}"
}

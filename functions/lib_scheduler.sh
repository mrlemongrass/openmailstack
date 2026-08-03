#!/usr/bin/env bash

openmailstack_scheduler_hosts() {
    local host
    local -A seen=()
    local candidates="${MAIL_HOSTNAME},autoconfig.${FIRST_DOMAIN}"
    if [[ "${ENABLE_OMS_SCHEDULER:-false}" == "true" ]]; then
        candidates="${candidates},${OMS_SCHEDULER_HOST_ALIASES:-${MAIL_HOSTNAME}}"
    fi
    candidates="${candidates//,/ }"
    for host in ${candidates}; do
        host="${host,,}"
        if [[ ! "${host}" =~ ^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$ ]] || [[ "${host}" != *.* ]]; then
            echo "Invalid OMS Scheduler hostname: ${host}" >&2
            return 1
        fi
        if [[ -z "${seen[${host}]+x}" ]]; then
            printf '%s\n' "${host}"
            seen["${host}"]=1
        fi
    done
}

openmailstack_scheduler_server_names() {
    local hosts=()
    mapfile -t hosts < <(openmailstack_scheduler_hosts)
    printf '%s' "${hosts[*]}"
}

#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
# shellcheck source=/dev/null
source "${PROJECT_ROOT}/functions/lib_protocol_pending_runs.sh"

TEST_ROOT=$(mktemp -d)
trap 'find "${TEST_ROOT}" -depth -delete' EXIT
PENDING_PARENT="${TEST_ROOT}/state"
PENDING_DIR="${PENDING_PARENT}/protocol-gate-pending"
ORDER_LOG="${TEST_ROOT}/cleanup-order.log"
RUN_ONE='111111111111111111111111'
RUN_TWO='222222222222222222222222'

install -d -m 0700 "${PENDING_PARENT}"
PENDING_DIR=$(protocol_pending_prepare_directory "${PENDING_DIR}" "${PENDING_PARENT}" "${EUID}")

protocol_pending_persist_run "${PENDING_DIR}" "${RUN_ONE}" "${EUID}"
[[ $(protocol_pending_list_run_ids "${PENDING_DIR}" "${EUID}") == "${RUN_ONE}" ]]

cleanup_uncertain() {
    printf 'uncertain:%s\n' "$1" >>"${ORDER_LOG}"
    return 1
}
if protocol_pending_sweep_runs "${PENDING_DIR}" cleanup_uncertain "${EUID}"; then
    echo 'FAIL: interrupted run journal was cleared without cleanup proof' >&2
    exit 1
fi
[[ $(protocol_pending_list_run_ids "${PENDING_DIR}" "${EUID}") == "${RUN_ONE}" ]]

cleanup_proven() {
    printf 'proven:%s\n' "$1" >>"${ORDER_LOG}"
}
protocol_pending_sweep_runs "${PENDING_DIR}" cleanup_proven "${EUID}"
[[ -z $(protocol_pending_list_run_ids "${PENDING_DIR}" "${EUID}") ]]

protocol_pending_persist_run "${PENDING_DIR}" "${RUN_TWO}" "${EUID}"
[[ $(protocol_pending_list_run_ids "${PENDING_DIR}" "${EUID}") == "${RUN_TWO}" ]]
[[ $(paste -sd ' ' "${ORDER_LOG}") == \
    "uncertain:${RUN_ONE} proven:${RUN_ONE}" ]]

echo 'PASS: a second guarded run retains uncertain predecessors, sweeps them after proof, and journals its own identity'

#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
# shellcheck source=/dev/null
source "${PROJECT_ROOT}/functions/lib_protocol_guard.sh"

TEST_ROOT=$(mktemp -d)
trap 'rm -rf -- "${TEST_ROOT}"' EXIT
install -d "${TEST_ROOT}/allowed/live" "${TEST_ROOT}/outside"

printf '1.2.3-rc.1+build.7\n' >"${TEST_ROOT}/valid-version"
[[ "$(protocol_read_release_version "${TEST_ROOT}/valid-version")" == "1.2.3-rc.1+build.7" ]]
printf '  1.2.3  \n' >"${TEST_ROOT}/trimmed-version"
[[ "$(protocol_read_release_version "${TEST_ROOT}/trimmed-version")" == "1.2.3" ]]
printf 'release-latest\n' >"${TEST_ROOT}/invalid-version"
if protocol_read_release_version "${TEST_ROOT}/invalid-version" >/dev/null 2>&1; then
    echo "FAIL: invalid release VERSION was accepted" >&2
    exit 1
fi
if protocol_version_file_matches "1.2.4" "${TEST_ROOT}/valid-version"; then
    echo "FAIL: mismatched deployed VERSION was accepted" >&2
    exit 1
fi
ln -s "${TEST_ROOT}/valid-version" "${TEST_ROOT}/symlink-version"
if protocol_read_release_version "${TEST_ROOT}/symlink-version" >/dev/null 2>&1; then
    echo "FAIL: symlink release VERSION was accepted" >&2
    exit 1
fi

resolved=$(protocol_safe_directory "${TEST_ROOT}/allowed/live" "${TEST_ROOT}/allowed" "fixture live root")
[[ "${resolved}" == "${TEST_ROOT}/allowed/live" ]]
resolved=$(protocol_safe_root_directory "${TEST_ROOT}/allowed/live" "${TEST_ROOT}/allowed" "fixture rollback root" "$(id -u)")
[[ "${resolved}" == "${TEST_ROOT}/allowed/live" ]]

if protocol_safe_directory "${TEST_ROOT}/allowed/../outside" "${TEST_ROOT}/allowed" "traversal fixture" >/dev/null 2>&1; then
    echo "FAIL: traversal-valued live root was accepted" >&2
    exit 1
fi
ln -s "${TEST_ROOT}/outside" "${TEST_ROOT}/allowed/link"
if protocol_safe_directory "${TEST_ROOT}/allowed/link" "${TEST_ROOT}/allowed" "symlink fixture" >/dev/null 2>&1; then
    echo "FAIL: symlink live root was accepted" >&2
    exit 1
fi
chmod 0777 "${TEST_ROOT}/allowed"
if protocol_safe_root_directory "${TEST_ROOT}/allowed/live" "${TEST_ROOT}/allowed" "writable rollback root" "$(id -u)" >/dev/null 2>&1; then
    echo "FAIL: rollback root below a group/other-writable parent was accepted" >&2
    exit 1
fi
chmod 0755 "${TEST_ROOT}/allowed"

install -d "${TEST_ROOT}/allowed/operator-writable/rollback"
chmod 0777 "${TEST_ROOT}/allowed/operator-writable"
if protocol_safe_root_directory "${TEST_ROOT}/allowed/operator-writable/rollback" "${TEST_ROOT}/allowed" "nested rollback root" "$(id -u)" >/dev/null 2>&1; then
    echo "FAIL: nested rollback root below a writable intermediate directory was accepted" >&2
    exit 1
fi

install -d "${TEST_ROOT}/secure-parent" "${TEST_ROOT}/lock-target"
ln -s "${TEST_ROOT}/lock-target" "${TEST_ROOT}/secure-parent/openmailstack"
lock_target_mode_before=$(stat -c '%a' -- "${TEST_ROOT}/lock-target")
if protocol_prepare_secure_directory "${TEST_ROOT}/secure-parent/openmailstack" "${TEST_ROOT}/secure-parent" "fixture lock root" "$(id -u)" >/dev/null 2>&1; then
    echo "FAIL: precreated lock-root symlink was accepted" >&2
    exit 1
fi
[[ "$(stat -c '%a' -- "${TEST_ROOT}/lock-target")" == "${lock_target_mode_before}" ]]
rm -f -- "${TEST_ROOT}/secure-parent/openmailstack"
prepared_lock_root=$(protocol_prepare_secure_directory "${TEST_ROOT}/secure-parent/openmailstack" "${TEST_ROOT}/secure-parent" "fixture lock root" "$(id -u)")
[[ "${prepared_lock_root}" == "${TEST_ROOT}/secure-parent/openmailstack" ]]
[[ "$(stat -c '%a' -- "${prepared_lock_root}")" == "755" ]]
ln -s "${TEST_ROOT}/missing-lock-target" "${prepared_lock_root}/protocol-release.lock"
if protocol_validate_lock_file "${prepared_lock_root}/protocol-release.lock" "$(id -u)"; then
    echo "FAIL: dangling lock-file symlink was accepted" >&2
    exit 1
fi
rm -f -- "${prepared_lock_root}/protocol-release.lock"

events=()
prepare_ok() { events+=(prepare); }
apply_ok() { events+=("apply:$1"); }
validate_ok() { events+=(validate); }
recover_ok() { events+=(recover); }
validate_recovered_ok() { events+=(validate-recovered); }

protocol_run_reversible_restore snapshot-a prepare_ok apply_ok validate_ok recover_ok validate_recovered_ok
[[ "${events[*]}" == "prepare apply:snapshot-a validate" ]]

events=()
validate_fail() { events+=(validate-failed); return 1; }
set +e
protocol_run_reversible_restore snapshot-b prepare_ok apply_ok validate_fail recover_ok validate_recovered_ok
status=$?
set -e
[[ ${status} -eq 20 ]]
[[ "${events[*]}" == "prepare apply:snapshot-b validate-failed recover validate-recovered" ]]

events=()
prepare_fail() { events+=(prepare-failed); return 1; }
set +e
protocol_run_reversible_restore snapshot-c prepare_fail apply_ok validate_ok recover_ok validate_recovered_ok
status=$?
set -e
[[ ${status} -eq 10 ]]
[[ "${events[*]}" == "prepare-failed" ]]

events=()
prepare_early_command_failure() {
    events+=(prepare-copy-failed)
    false || return 1
    events+=(prepare-incorrectly-continued)
}
set +e
protocol_run_reversible_restore snapshot-d prepare_early_command_failure apply_ok validate_ok recover_ok validate_recovered_ok
status=$?
set -e
[[ ${status} -eq 10 ]]
[[ "${events[*]}" == "prepare-copy-failed" ]]

events=()
protocol_recover_after_interruption 1 0 recover_ok validate_recovered_ok
[[ "${events[*]}" == "recover validate-recovered" ]]
events=()
protocol_recover_after_interruption 1 1 recover_ok
[[ ${#events[@]} -eq 0 ]]
recover_fail() { events+=(recover-failed); return 1; }
set +e
protocol_recover_after_interruption 1 0 recover_fail
status=$?
set -e
[[ ${status} -eq 1 ]]
[[ "${events[*]}" == "recover-failed" ]]
events=()
validate_recovered_fail() { events+=(validate-recovered-failed); return 1; }
set +e
protocol_recover_after_interruption 1 0 recover_ok validate_recovered_fail
status=$?
set -e
[[ ${status} -eq 2 ]]
[[ "${events[*]}" == "recover validate-recovered-failed" ]]

lock_file="${prepared_lock_root}/protocol-release.lock"
protocol_validate_lock_file "${lock_file}" "$(id -u)"
exec {first_lock_fd}>"${lock_file}"
protocol_acquire_lock "${first_lock_fd}"
exec {second_lock_fd}>"${lock_file}"
if protocol_acquire_lock "${second_lock_fd}"; then
    echo "FAIL: second concurrent protocol action acquired the release lock" >&2
    exit 1
fi

echo "PASS: protocol path guards and reversible restore orchestration"

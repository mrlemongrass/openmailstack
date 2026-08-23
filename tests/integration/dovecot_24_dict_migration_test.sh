#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
# shellcheck source=../../functions/lib_dovecot_config.sh
source "${PROJECT_ROOT}/functions/lib_dovecot_config.sh"

FIXTURE_ROOT=$(mktemp -d)
trap 'rm -rf -- "${FIXTURE_ROOT}"' EXIT

LEGACY_CONFIG="${FIXTURE_ROOT}/legacy.conf"
cat <<'EOF' > "${LEGACY_CONFIG}"
dovecot_config_version = 2.4.1
before = retained

dict quota {
  #quota = mysql:/etc/dovecot/dovecot-dict-sql.conf.ext
}

after = retained
EOF

openmailstack_remove_empty_legacy_quota_dict "${LEGACY_CONFIG}"

grep -Fqx 'before = retained' "${LEGACY_CONFIG}"
grep -Fqx 'after = retained' "${LEGACY_CONFIG}"
if grep -Eq '^[[:space:]]*dict[[:space:]]+quota[[:space:]]*\{' "${LEGACY_CONFIG}"; then
    echo "FAIL: empty legacy quota dictionary was not removed" >&2
    exit 1
fi

FIRST_HASH=$(sha256sum "${LEGACY_CONFIG}" | awk '{print $1}')
openmailstack_remove_empty_legacy_quota_dict "${LEGACY_CONFIG}"
SECOND_HASH=$(sha256sum "${LEGACY_CONFIG}" | awk '{print $1}')
[[ "${FIRST_HASH}" == "${SECOND_HASH}" ]] || {
    echo "FAIL: migration is not idempotent" >&2
    exit 1
}

CONFIGURED_DICT="${FIXTURE_ROOT}/configured.conf"
cat <<'EOF' > "${CONFIGURED_DICT}"
dovecot_config_version = 2.4.1
dict quota {
  dict_driver = sql
}
EOF

CONFIGURED_HASH=$(sha256sum "${CONFIGURED_DICT}" | awk '{print $1}')
openmailstack_remove_empty_legacy_quota_dict "${CONFIGURED_DICT}"
[[ "${CONFIGURED_HASH}" == "$(sha256sum "${CONFIGURED_DICT}" | awk '{print $1}')" ]] || {
    echo "FAIL: configured quota dictionary was modified" >&2
    exit 1
}

echo "PASS: Dovecot 2.4 empty legacy quota dictionary migration is narrow and idempotent"

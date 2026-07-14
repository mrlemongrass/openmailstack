#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
MAP_SYNC_SCRIPT="${PROJECT_ROOT}/functions/rspamd_spam_maps_sync.sh"
TMP_DIR=$(mktemp -d)
trap 'rm -rf "${TMP_DIR}"' EXIT

fail() {
    echo "[fail] $*" >&2
    exit 1
}

mkdir -p "${TMP_DIR}/bin"
cat > "${TMP_DIR}/bin/mysql" <<'EOF'
#!/usr/bin/env bash
printf 'global\tGLOBAL\t{}\n'
EOF
chmod 0755 "${TMP_DIR}/bin/mysql"

cat > "${TMP_DIR}/bin/systemctl" <<'EOF'
#!/usr/bin/env bash
exit 1
EOF
chmod 0755 "${TMP_DIR}/bin/systemctl"

MAP_DIR="${TMP_DIR}/maps"
MULTIMAP_CONF="${TMP_DIR}/multimap.conf"
MYSQL_BIN="${TMP_DIR}/bin/mysql" \
SYSTEMCTL_BIN="${TMP_DIR}/bin/systemctl" \
RSPAMD_OMS_MAP_DIR="${MAP_DIR}" \
RSPAMD_OMS_MULTIMAP_CONF="${MULTIMAP_CONF}" \
"${MAP_SYNC_SCRIPT}"

TARGET_MAP="${MAP_DIR}/global/whitelist/sender_addresses.map"
[[ -f "${TARGET_MAP}" ]] || fail "Map sync did not render the expected global map"
touch -d '@1' "${TARGET_MAP}"

MYSQL_BIN="${TMP_DIR}/bin/mysql" \
SYSTEMCTL_BIN="${TMP_DIR}/bin/systemctl" \
RSPAMD_OMS_MAP_DIR="${MAP_DIR}" \
RSPAMD_OMS_MULTIMAP_CONF="${MULTIMAP_CONF}" \
"${MAP_SYNC_SCRIPT}"

[[ "$(stat -c %Y "${TARGET_MAP}")" -eq 1 ]] || fail "Unchanged Rspamd policy map was rewritten"

echo "[pass] Rspamd policy sync preserves unchanged map files"

#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)

cd "${PROJECT_ROOT}"

echo "[lint] Running bash syntax checks..."
while IFS= read -r file; do
    bash -n "${file}"
done < <(find install.sh setup_config.sh uninstall.sh functions tests -type f -name "*.sh" -print)

echo "[lint] bash syntax checks passed."

if command -v shellcheck >/dev/null 2>&1; then
    echo "[lint] Running shellcheck..."
    shellcheck -S warning $(find install.sh setup_config.sh uninstall.sh functions tests -type f -name "*.sh" -print)
    echo "[lint] shellcheck passed."
else
    echo "[lint] shellcheck not installed; skipping."
fi

#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 2 ]]; then
    echo "Usage: $0 <docker-image> <expected-platform-key>" >&2
    exit 1
fi

IMAGE="$1"
EXPECTED_PLATFORM_KEY="$2"
PROJECT_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)

if ! command -v docker >/dev/null 2>&1; then
    echo "docker is required for container dry-run tests." >&2
    exit 1
fi

echo "[integration] Running dry-run in ${IMAGE}..."

docker run --rm \
    -v "${PROJECT_ROOT}:/workspace" \
    -w /workspace \
    "${IMAGE}" \
    bash -lc "set -euo pipefail; bash ./install.sh --dry-run > /tmp/openmailstack-dry-run.log; grep -Fq 'Dry run completed. No changes were made.' /tmp/openmailstack-dry-run.log; grep -Fq 'Platform key:        ${EXPECTED_PLATFORM_KEY}' /tmp/openmailstack-dry-run.log"

echo "[pass] ${IMAGE} dry-run reports expected platform key: ${EXPECTED_PLATFORM_KEY}"

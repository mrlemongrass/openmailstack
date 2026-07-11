#!/usr/bin/env bash
set -euo pipefail

ACTION="${1:-}"

case "${ACTION}" in
    restart-openmailstack)
        if command -v systemd-run >/dev/null 2>&1; then
            unit="openmailstack-remediate-restart-$(date +%s)"
            systemd-run \
                --unit="${unit}" \
                --description="OpenMailStack admin remediation restart" \
                --on-active=2s \
                /usr/bin/systemctl restart openmailstack.service >/dev/null
        else
            nohup /bin/sh -c 'sleep 2; /usr/bin/systemctl restart openmailstack.service' >/dev/null 2>&1 &
        fi
        ;;
    *)
        echo "Unsupported remediation action: ${ACTION}" >&2
        exit 64
        ;;
esac

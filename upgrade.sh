#!/usr/bin/env bash
set -euo pipefail

printf '%s\n' \
    'OpenMailStack automatic upgrades are disabled.' \
    '' \
    'This repository does not yet provide a transactional, full-stack upgrade' \
    'workflow. No files, repository state, packages, or services were changed.' \
    'Follow the Manual release upgrade procedure in INSTALLATION.md for the' \
    'specific release after taking and verifying a complete backup.'

exit 1

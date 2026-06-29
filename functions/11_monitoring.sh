#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
source "${SCRIPT_DIR}/../config.conf"
source "${SCRIPT_DIR}/lib_os.sh"
detect_openmailstack_os

if [[ "${ENABLE_MONIT:-false}" != "true" ]]; then
    echo -e "\033[0;33mMonit is disabled in config.conf. Skipping.\033[0m"
    exit 0
fi

echo -e "\033[0;36mInstalling and configuring Monit...\033[0m"

if [[ "${PKG_MANAGER}" == "apt" ]]; then
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq monit
elif [[ "${PKG_MANAGER}" == "dnf" ]]; then
    dnf install -y -q monit
fi

MONIT_CONF_DIR="/etc/monit/conf.d"
if [[ "${PKG_MANAGER}" == "dnf" ]]; then
    MONIT_CONF_DIR="/etc/monit.d"
fi

mkdir -p "${MONIT_CONF_DIR}"

cat <<EOF > "${MONIT_CONF_DIR}/rspamd"
check process rspamd matching "rspamd: main process"
  start program = "/usr/bin/systemctl start rspamd"
  stop program = "/usr/bin/systemctl stop rspamd"
  if failed port 11332 then restart
  if 3 restarts within 5 cycles then timeout
EOF

if [[ -n "${MONIT_EMAIL:-}" ]]; then
    # Create a basic global alert config if email is set
    cat <<EOF > "${MONIT_CONF_DIR}/alerts"
set alert ${MONIT_EMAIL}
EOF
fi

if [[ -f /etc/monit/monitrc ]]; then
    sed -i 's/^#set httpd port 2812 and/set httpd port 2812 and/g' /etc/monit/monitrc
    sed -i 's/^#    use address localhost/    use address localhost/g' /etc/monit/monitrc
    sed -i 's/^#    allow localhost/    allow localhost/g' /etc/monit/monitrc
fi

systemctl enable monit
systemctl restart monit

echo -e "\033[0;32mMonit configured successfully for Rspamd.\033[0m"

#!/usr/bin/env bash

# ==============================================================================
# Strict Bash Mode
# ==============================================================================
set -euo pipefail
trap 'echo -e "\033[0;31mERROR in ${BASH_SOURCE[0]} at line ${LINENO}: ${BASH_COMMAND}\033[0m" >&2' ERR

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${YELLOW}Starting Modern Webmail Deployment...${NC}"

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_DIR=$(cd "${SCRIPT_DIR}/.." && pwd)
source "${REPO_DIR}/config.conf"
source "${SCRIPT_DIR}/lib_os.sh"
source "${SCRIPT_DIR}/lib_scheduler.sh"
detect_openmailstack_os

PROTOCOL_GATE_REQUIRED_FILE="${OMS_PROTOCOL_GATE_REQUIRED_FILE:-/etc/openmailstack/protocol-gate.required}"
if [[ -f "${PROTOCOL_GATE_REQUIRED_FILE}" && "${OMS_PROTOCOL_GUARDED_DEPLOY:-0}" != "1" ]]; then
    echo -e "${RED}Error: protocol protection is enabled; run functions/protocol_guarded_deploy.sh webmail instead.${NC}" >&2
    exit 1
fi

BACKEND_SRC="${REPO_DIR}/webmail-backend"
FRONTEND_SRC="${REPO_DIR}/webmail-frontend"
BACKEND_DIR="/opt/openmailstack-backend"
FRONTEND_DIR="${OPENMAILSTACK_WEB_ROOT:-/var/www/openmailstack}"
ENV_DIR="/etc/openmailstack"
ENV_FILE="${ENV_DIR}/webmail-backend.env"
DOVECOT_MASTER_USER="${OMS_DOVECOT_MASTER_USER:-oms-internal}"
DOVECOT_MASTER_SECRET_FILE="${OMS_DOVECOT_MASTER_SECRET_FILE:-${ENV_DIR}/dovecot-master.secret}"
SERVICE_FILE="/etc/systemd/system/openmailstack.service"
REMEDIATE_SCRIPT="/usr/local/sbin/openmailstack-remediate"
REMEDIATE_SUDOERS="/etc/sudoers.d/openmailstack-remediate"
NGINX_CONF="/etc/nginx/sites-available/mailserver.conf"
WEBMAIL_USER="openmailstack"
WEBMAIL_GROUP="openmailstack"
WEBMAIL_HOST="${OMS_WEBMAIL_HOST:-127.0.0.1}"
WEBMAIL_PORT="${OMS_WEBMAIL_PORT:-20000}"
PUBLIC_BASE_URL="${OMS_PUBLIC_BASE_URL:-https://${MAIL_HOSTNAME}}"
DEFAULT_DOMAIN="${OMS_DEFAULT_DOMAIN:-${FIRST_DOMAIN}}"
SCHEDULER_ENABLED="${ENABLE_OMS_SCHEDULER:-false}"
SCHEDULER_PUBLIC_BASE_URL="${OMS_SCHEDULER_PUBLIC_BASE_URL:-${PUBLIC_BASE_URL}}"
SCHEDULER_HOST_ALIASES="${OMS_SCHEDULER_HOST_ALIASES:-${MAIL_HOSTNAME}}"
SCHEDULER_SERVER_NAMES="$(openmailstack_scheduler_server_names)"

existing_env_value() {
    local key="$1"
    openmailstack_read_env_value "${ENV_FILE}" "${key}"
}

NOTES_COLLABORATION_ENABLED="${ENABLE_OMS_NOTES_COLLABORATION:-$(existing_env_value ENABLE_OMS_NOTES_COLLABORATION)}"
NOTES_COLLABORATION_ENABLED="${NOTES_COLLABORATION_ENABLED:-false}"
if [[ ! "${NOTES_COLLABORATION_ENABLED}" =~ ^(true|false)$ ]]; then
    echo -e "${RED}Error: ENABLE_OMS_NOTES_COLLABORATION must be true or false.${NC}" >&2
    exit 1
fi

SESSION_SECRET="${OMS_SESSION_SECRET:-$(existing_env_value OMS_SESSION_SECRET)}"
if [[ -z "${SESSION_SECRET}" ]]; then
    SESSION_SECRET="$(openssl rand -hex 32)"
fi
if (( ${#SESSION_SECRET} < 32 )); then
    echo -e "${RED}Error: OMS_SESSION_SECRET must contain at least 32 characters.${NC}" >&2
    exit 1
fi
ACCOUNT_SECURITY_KEY="${OMS_ACCOUNT_SECURITY_KEY:-$(existing_env_value OMS_ACCOUNT_SECURITY_KEY)}"
if [[ -z "${ACCOUNT_SECURITY_KEY}" ]]; then
    ACCOUNT_SECURITY_KEY="$(openssl rand -hex 32)"
fi
if (( ${#ACCOUNT_SECURITY_KEY} < 32 )); then
    echo -e "${RED}Error: OMS_ACCOUNT_SECURITY_KEY must contain at least 32 characters.${NC}" >&2
    exit 1
fi
if [[ ! -s "${DOVECOT_MASTER_SECRET_FILE}" ]]; then
    echo -e "${RED}Error: Dovecot master secret is missing; run functions/04_dovecot.sh first.${NC}" >&2
    exit 1
fi
DOVECOT_MASTER_PASSWORD=$(<"${DOVECOT_MASTER_SECRET_FILE}")
if (( ${#DOVECOT_MASTER_PASSWORD} < 32 )); then
    echo -e "${RED}Error: Dovecot master secret must contain at least 32 characters.${NC}" >&2
    exit 1
fi

SCHEDULER_SECRET_KEY_VERSION="${OMS_SCHEDULER_SECRET_KEY_VERSION:-$(existing_env_value OMS_SCHEDULER_SECRET_KEY_VERSION)}"
SCHEDULER_SECRET_KEY_VERSION="${SCHEDULER_SECRET_KEY_VERSION:-1}"
SCHEDULER_SECRET_KEY="${OMS_SCHEDULER_SECRET_KEY:-$(existing_env_value OMS_SCHEDULER_SECRET_KEY)}"
SCHEDULER_SECRET_KEYRING="${OMS_SCHEDULER_SECRET_KEYRING:-$(existing_env_value OMS_SCHEDULER_SECRET_KEYRING)}"
if [[ "${SCHEDULER_ENABLED}" == "true" && -z "${SCHEDULER_SECRET_KEY}" ]]; then
    SCHEDULER_SECRET_KEY="$(openssl rand -hex 32)"
fi
if [[ "${SCHEDULER_ENABLED}" == "true" && -z "${SCHEDULER_SECRET_KEYRING}" ]]; then
    SCHEDULER_SECRET_KEYRING="${SCHEDULER_SECRET_KEY_VERSION}:${SCHEDULER_SECRET_KEY}"
fi

if [[ "${SCHEDULER_ENABLED}" == "true" ]]; then
    if [[ ! "${SCHEDULER_PUBLIC_BASE_URL}" =~ ^https://[^/]+$ ]]; then
        echo -e "${RED}Error: OMS_SCHEDULER_PUBLIC_BASE_URL must be an HTTPS origin without a path.${NC}" >&2
        exit 1
    fi
    PUBLIC_SCHEDULER_HOST="${SCHEDULER_PUBLIC_BASE_URL#https://}"
    PUBLIC_SCHEDULER_HOST="${PUBLIC_SCHEDULER_HOST%%:*}"
    PUBLIC_SCHEDULER_HOST="${PUBLIC_SCHEDULER_HOST,,}"
    if [[ " ${SCHEDULER_SERVER_NAMES} " != *" ${PUBLIC_SCHEDULER_HOST} "* ]]; then
        echo -e "${RED}Error: OMS_SCHEDULER_PUBLIC_BASE_URL host must be present in OMS_SCHEDULER_HOST_ALIASES.${NC}" >&2
        exit 1
    fi
fi

require_path() {
    local path="$1"
    if [[ ! -e "${path}" ]]; then
        echo -e "${RED}Error: Required path not found: ${path}${NC}" >&2
        exit 1
    fi
}

write_env_line() {
    local key="$1"
    local value="$2"
    value="${value//\\/\\\\}"
    value="${value//\"/\\\"}"
    printf '%s="%s"\n' "${key}" "${value}"
}

install_node_toolchain() {
    echo -e "Installing Node.js/npm and deployment helpers..."
    openmailstack_install_required_packages nodejs npm rsync

    if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
        echo -e "${RED}Error: node and npm are required for modern webmail deployment.${NC}" >&2
        exit 1
    fi

    local node_version major minor patch
    node_version="$(node -p 'process.versions.node')"
    IFS='.' read -r major minor patch <<< "${node_version}"
    if (( major < 20 || (major == 20 && minor < 19) )); then
        echo -e "${RED}Error: Modern webmail requires Node.js >= 20.19.0 for the current Vite stack; found ${node_version}.${NC}" >&2
        echo -e "${YELLOW}Install a current Node.js LTS package and rerun this module.${NC}" >&2
        exit 1
    fi
}

npm_install_for_build() {
    local app_dir="$1"
    (
        umask 022
        cd "${app_dir}"
        if [[ -f package-lock.json ]]; then
            npm ci
        else
            npm install
        fi
    )
}

ensure_service_user() {
    if ! getent group "${WEBMAIL_GROUP}" >/dev/null; then
        groupadd --system "${WEBMAIL_GROUP}"
    fi
    if ! getent passwd "${WEBMAIL_USER}" >/dev/null; then
        useradd --system --gid "${WEBMAIL_GROUP}" --home-dir "${BACKEND_DIR}" --shell /usr/sbin/nologin "${WEBMAIL_USER}"
    fi
}

install_remediation_bridge() {
    require_path "${REPO_DIR}/functions/openmailstack-remediate.sh"
    install -o root -g root -m 0750 "${REPO_DIR}/functions/openmailstack-remediate.sh" "${REMEDIATE_SCRIPT}"
    printf '%s ALL=(root) NOPASSWD: %s restart-openmailstack\n' "${WEBMAIL_USER}" "${REMEDIATE_SCRIPT}" > "${REMEDIATE_SUDOERS}"
    chmod 0440 "${REMEDIATE_SUDOERS}"
}

render_backend_env() {
    echo -e "Writing ${ENV_FILE}..."
    install -d -m 0700 "${ENV_DIR}"
    (
        umask 077
        {
            echo "# Generated by OpenMailStack functions/10_webmail.sh"
            write_env_line "OMS_WEBMAIL_HOST" "${WEBMAIL_HOST}"
            write_env_line "OMS_WEBMAIL_PORT" "${WEBMAIL_PORT}"
            write_env_line "OMS_PUBLIC_BASE_URL" "${PUBLIC_BASE_URL}"
            write_env_line "OMS_DEFAULT_DOMAIN" "${DEFAULT_DOMAIN}"
            write_env_line "OMS_SESSION_SECRET" "${SESSION_SECRET}"
            write_env_line "OMS_ACCOUNT_SECURITY_KEY" "${ACCOUNT_SECURITY_KEY}"
            write_env_line "OMS_COOKIE_SECURE" "${OMS_COOKIE_SECURE:-true}"
            write_env_line "OMS_UPLOAD_LIMIT_BYTES" "${OMS_UPLOAD_LIMIT_BYTES:-26214400}"
            write_env_line "ENABLE_OMS_NOTES_COLLABORATION" "${NOTES_COLLABORATION_ENABLED}"
            write_env_line "ENABLE_OMS_SCHEDULER" "${SCHEDULER_ENABLED}"
            write_env_line "OMS_SCHEDULER_PUBLIC_BASE_URL" "${SCHEDULER_PUBLIC_BASE_URL}"
            write_env_line "OMS_SCHEDULER_HOST_ALIASES" "${SCHEDULER_HOST_ALIASES}"
            write_env_line "OMS_SCHEDULER_NOTIFICATION_FROM" "${OMS_SCHEDULER_NOTIFICATION_FROM:-scheduler@${DEFAULT_DOMAIN}}"
            write_env_line "OMS_SCHEDULER_SMTP_HOST" "${OMS_SCHEDULER_SMTP_HOST:-127.0.0.1}"
            write_env_line "OMS_SCHEDULER_SMTP_PORT" "${OMS_SCHEDULER_SMTP_PORT:-25}"
            write_env_line "OMS_SCHEDULER_SMTP_SERVER_NAME" "${OMS_SCHEDULER_SMTP_SERVER_NAME:-${MAIL_HOSTNAME}}"
            write_env_line "OMS_SCHEDULER_SMTP_REJECT_UNAUTHORIZED" "${OMS_SCHEDULER_SMTP_REJECT_UNAUTHORIZED:-true}"
            if [[ "${SCHEDULER_ENABLED}" == "true" ]]; then
                write_env_line "OMS_SCHEDULER_SECRET_KEY_VERSION" "${SCHEDULER_SECRET_KEY_VERSION}"
                write_env_line "OMS_SCHEDULER_SECRET_KEY" "${SCHEDULER_SECRET_KEY}"
                write_env_line "OMS_SCHEDULER_SECRET_KEYRING" "${SCHEDULER_SECRET_KEYRING}"
            fi
            write_env_line "OMS_DB_HOST" "${OMS_DB_HOST:-127.0.0.1}"
            write_env_line "OMS_DB_PORT" "${OMS_DB_PORT:-3306}"
            write_env_line "OMS_DB_USER" "${OMS_DB_USER:-${POSTFIXADMIN_DB_USER}}"
            write_env_line "OMS_DB_PASSWORD" "${OMS_DB_PASSWORD:-${POSTFIXADMIN_DB_PASSWORD}}"
            write_env_line "OMS_DB_NAME" "${OMS_DB_NAME:-${POSTFIXADMIN_DB_NAME}}"
            write_env_line "OMS_DB_CONNECTION_LIMIT" "${OMS_DB_CONNECTION_LIMIT:-10}"
            write_env_line "OMS_IMAP_HOST" "${OMS_IMAP_HOST:-127.0.0.1}"
            write_env_line "OMS_IMAP_PORT" "${OMS_IMAP_PORT:-143}"
            write_env_line "OMS_IMAP_SECURE" "${OMS_IMAP_SECURE:-false}"
            write_env_line "OMS_IMAP_REJECT_UNAUTHORIZED" "${OMS_IMAP_REJECT_UNAUTHORIZED:-true}"
            write_env_line "OMS_IMAP_MASTER_USER" "${OMS_IMAP_MASTER_USER:-${DOVECOT_MASTER_USER}}"
            write_env_line "OMS_IMAP_MASTER_PASS" "${OMS_IMAP_MASTER_PASS:-${DOVECOT_MASTER_PASSWORD}}"
            write_env_line "OMS_SMTP_HOST" "${OMS_SMTP_HOST:-127.0.0.1}"
            write_env_line "OMS_SMTP_PORT" "${OMS_SMTP_PORT:-587}"
            write_env_line "OMS_SMTP_SECURE" "${OMS_SMTP_SECURE:-false}"
            write_env_line "OMS_SMTP_SERVER_NAME" "${OMS_SMTP_SERVER_NAME:-${MAIL_HOSTNAME}}"
            write_env_line "OMS_SMTP_REJECT_UNAUTHORIZED" "${OMS_SMTP_REJECT_UNAUTHORIZED:-true}"
            write_env_line "OMS_SMTP_MASTER_USER" "${OMS_SMTP_MASTER_USER:-${DOVECOT_MASTER_USER}}"
            write_env_line "OMS_SMTP_MASTER_PASS" "${OMS_SMTP_MASTER_PASS:-${DOVECOT_MASTER_PASSWORD}}"
            write_env_line "OMS_SIEVE_HOST" "${OMS_SIEVE_HOST:-127.0.0.1}"
            write_env_line "OMS_SIEVE_PORT" "${OMS_SIEVE_PORT:-4190}"
            write_env_line "OMS_SIEVE_MASTER_USER" "${OMS_SIEVE_MASTER_USER:-${DOVECOT_MASTER_USER}}"
            write_env_line "OMS_SIEVE_MASTER_PASS" "${OMS_SIEVE_MASTER_PASS:-${DOVECOT_MASTER_PASSWORD}}"
        } > "${ENV_FILE}"
    )
    chown root:root "${ENV_FILE}"
    chmod 0600 "${ENV_FILE}"
}

deploy_backend() {
    echo -e "Building and deploying webmail backend..."
    npm_install_for_build "${BACKEND_SRC}"
    npm --prefix "${BACKEND_SRC}" run build

    ensure_service_user
    install_remediation_bridge
    install -d -o "${WEBMAIL_USER}" -g "${WEBMAIL_GROUP}" -m 0755 "${BACKEND_DIR}"
    rsync -a --delete \
        --exclude node_modules \
        --exclude .npm \
        --exclude uploads \
        "${BACKEND_SRC}/" "${BACKEND_DIR}/"

    (
        umask 022
        cd "${BACKEND_DIR}"
        if [[ -f package-lock.json ]]; then
            npm ci --omit=dev
        else
            npm install --omit=dev
        fi
    )
    chown -R "${WEBMAIL_USER}:${WEBMAIL_GROUP}" "${BACKEND_DIR}"

    render_backend_env
    install -m 0644 "${REPO_DIR}/packaging/systemd/openmailstack.service" "${SERVICE_FILE}"
    systemctl daemon-reload
    systemctl enable --now openmailstack.service
    systemctl restart openmailstack.service
    if [[ -f /etc/openmailstack/scheduler.enabled && -f /etc/systemd/system/openmailstack-scheduler-worker.service ]]; then
        systemctl restart openmailstack-scheduler-worker.service
        systemctl is-active --quiet openmailstack-scheduler-worker.service
    fi
}

deploy_frontend() {
    echo -e "Building and deploying webmail frontend..."
    npm_install_for_build "${FRONTEND_SRC}"
    npm --prefix "${FRONTEND_SRC}" run build

    install -d -m 0755 "${FRONTEND_DIR}"
    rsync -a --delete "${FRONTEND_SRC}/dist/" "${FRONTEND_DIR}/"
    chown -R root:root "${FRONTEND_DIR}"
    find "${FRONTEND_DIR}" -type d -exec chmod 755 {} \;
    find "${FRONTEND_DIR}" -type f -exec chmod 644 {} \;
}

configure_nginx() {
    echo -e "Configuring Nginx for modern webmail..."
    require_path "${NGINX_CONF}"

    local backup cleaned candidate snippet
    backup="$(mktemp)"
    cleaned="$(mktemp)"
    candidate="$(mktemp)"
    snippet="$(mktemp)"

    cp -a "${NGINX_CONF}" "${backup}"
    sed '/# --- OpenMailStack Modern Webmail ---/,/# --- End OpenMailStack Modern Webmail ---/d' "${NGINX_CONF}" > "${cleaned}"
    sed -i "0,/^[[:space:]]*server_name[[:space:]].*;/s//    server_name ${SCHEDULER_SERVER_NAMES};/" "${cleaned}"

    # Older live deployments predate the managed marker but already own the
    # webmail/API locations. Preserve those routes and add only missing routes.
    if ! grep -Fq '# --- OpenMailStack Modern Webmail ---' "${NGINX_CONF}" \
        && grep -Eq '^[[:space:]]*location[[:space:]]+/api/' "${NGINX_CONF}" \
        && grep -Eq '^[[:space:]]*location[[:space:]]+/[[:space:]]*\{' "${NGINX_CONF}"; then
        : > "${snippet}"
        if ! grep -Fq 'location = /mail/config-v1.1.xml' "${cleaned}"; then
            cat >> "${snippet}" <<EOF
    # --- Mozilla Autoconfiguration Routes ---
    location = /mail/config-v1.1.xml {
        proxy_pass http://${WEBMAIL_HOST}:${WEBMAIL_PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
    # --- End Mozilla Autoconfiguration Routes ---

EOF
        fi
        if ! grep -Fq 'location = /.well-known/autoconfig/mail/config-v1.1.xml' "${cleaned}"; then
            cat >> "${snippet}" <<EOF
    # --- Mozilla Autoconfiguration Well-Known Route ---

    location = /.well-known/autoconfig/mail/config-v1.1.xml {
        proxy_pass http://${WEBMAIL_HOST}:${WEBMAIL_PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
    # --- End Mozilla Autoconfiguration Well-Known Route ---

EOF
        fi
        if [[ "${SCHEDULER_ENABLED}" == "true" ]] && ! grep -Eq '^[[:space:]]*location[[:space:]]+\^~[[:space:]]+/scheduler/' "${cleaned}"; then
            cat >> "${snippet}" <<EOF
    # --- OMS Scheduler Route ---
    location ^~ /scheduler/ {
        root ${FRONTEND_DIR};
        try_files \$uri \$uri/ /index.html;
    }
    # --- End OMS Scheduler Route ---

EOF
        fi
        if [[ -s "${snippet}" ]]; then
            if ! awk -v snippet="${snippet}" '
                !inserted && /^[[:space:]]*location[[:space:]]+\/[[:space:]]*\{/ {
                    while ((getline line < snippet) > 0) print line
                    close(snippet)
                    inserted = 1
                }
                { print }
                END { if (!inserted) exit 2 }
            ' "${cleaned}" > "${candidate}"; then
                rm -f "${backup}" "${cleaned}" "${candidate}" "${snippet}"
                echo -e "${RED}Error: Could not add managed routes to the existing webmail vhost.${NC}" >&2
                exit 1
            fi
        else
            cp -a "${cleaned}" "${candidate}"
        fi

        cat "${candidate}" > "${NGINX_CONF}"
        if ! nginx -t; then
            echo -e "${RED}Error: Updated Nginx config failed validation; restoring previous config.${NC}" >&2
            cp -a "${backup}" "${NGINX_CONF}"
            nginx -t || true
            rm -f "${backup}" "${cleaned}" "${candidate}" "${snippet}"
            exit 1
        fi
        rm -f "${backup}" "${cleaned}" "${candidate}" "${snippet}"
        systemctl reload nginx || systemctl restart nginx
        return 0
    fi

    cat > "${snippet}" <<EOF
    # --- OpenMailStack Modern Webmail ---
    client_max_body_size 50m;

    location ^~ /api/ {
        proxy_pass http://${WEBMAIL_HOST}:${WEBMAIL_PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 1h;
    }

    location = /api {
        proxy_pass http://${WEBMAIL_HOST}:${WEBMAIL_PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    location ^~ /socket.io/ {
        proxy_pass http://${WEBMAIL_HOST}:${WEBMAIL_PORT};
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    location = /notes-signal {
        access_log off;
        proxy_pass http://${WEBMAIL_HOST}:${WEBMAIL_PORT};
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 1h;
    }

    location = /rspamd {
        return 301 /rspamd/;
    }

    location ^~ /rspamd/ {
        proxy_pass http://127.0.0.1:11334/;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_buffering off;
        proxy_read_timeout 1h;
    }

    location ^~ /caldav {
        proxy_pass http://${WEBMAIL_HOST}:${WEBMAIL_PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    location ^~ /carddav {
        proxy_pass http://${WEBMAIL_HOST}:${WEBMAIL_PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    location ~* ^/autodiscover/autodiscover\\.xml$ {
        proxy_pass http://${WEBMAIL_HOST}:${WEBMAIL_PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    location = /mail/config-v1.1.xml {
        proxy_pass http://${WEBMAIL_HOST}:${WEBMAIL_PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    location = /.well-known/autoconfig/mail/config-v1.1.xml {
        proxy_pass http://${WEBMAIL_HOST}:${WEBMAIL_PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    location = /Microsoft-Server-ActiveSync {
        proxy_pass http://${WEBMAIL_HOST}:${WEBMAIL_PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 1h;
    }

    location = /.well-known/caldav {
        proxy_pass http://${WEBMAIL_HOST}:${WEBMAIL_PORT};
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    location = /.well-known/carddav {
        proxy_pass http://${WEBMAIL_HOST}:${WEBMAIL_PORT};
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    location ^~ /scheduler/ {
        root ${FRONTEND_DIR};
        try_files \$uri \$uri/ /index.html;
    }

    location / {
        if (\$request_method ~ ^(PROPFIND|OPTIONS)$) {
            return 301 /caldav/;
        }
        root ${FRONTEND_DIR};
        try_files \$uri \$uri/ /index.html;
    }
    # --- End OpenMailStack Modern Webmail ---
EOF

    if ! awk -v snippet="${snippet}" '
        /^}[[:space:]]*$/ && !inserted {
            while ((getline line < snippet) > 0) {
                print line
            }
            close(snippet)
            inserted = 1
        }
        { print }
        END { if (!inserted) exit 2 }
    ' "${cleaned}" > "${candidate}"; then
        rm -f "${backup}" "${cleaned}" "${candidate}" "${snippet}"
        echo -e "${RED}Error: Could not find an insertion point in ${NGINX_CONF}.${NC}" >&2
        exit 1
    fi

    if ! grep -Fq '# --- OpenMailStack Modern Webmail ---' "${candidate}"; then
        rm -f "${backup}" "${cleaned}" "${candidate}" "${snippet}"
        echo -e "${RED}Error: Generated Nginx config is missing the modern webmail marker.${NC}" >&2
        exit 1
    fi

    cat "${candidate}" > "${NGINX_CONF}"
    if ! nginx -t; then
        echo -e "${RED}Error: Generated Nginx config failed validation; restoring previous config.${NC}" >&2
        cp -a "${backup}" "${NGINX_CONF}"
        nginx -t || true
        rm -f "${backup}" "${cleaned}" "${candidate}" "${snippet}"
        exit 1
    fi
    rm -f "${backup}" "${cleaned}" "${candidate}" "${snippet}"
    systemctl reload nginx || systemctl restart nginx
}

require_path "${BACKEND_SRC}"
require_path "${FRONTEND_SRC}"
require_path "${REPO_DIR}/packaging/systemd/openmailstack.service"

install_node_toolchain
deploy_frontend
deploy_backend
configure_nginx

echo -e "${GREEN}Modern webmail deployment complete!${NC}"

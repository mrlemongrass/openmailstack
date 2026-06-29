<RULE[deployment_reminder]>
**CRITICAL: OpenMailStack Deployment Reminder**
This project maintains a strict separation between the development codebase and the live production environment. You MUST sync your local changes to the live directories in order for them to take effect on the live server.

**1. Directory Mapping**
- **Development Workspace (Local):** `/root/openmailstack/`
- **Live Backend (Production):** `/opt/openmailstack-backend/`
- **Live Frontend (Production):** `/var/www/openmailstack/`

**2. Backend Deployment**
Whenever you make changes to the backend in `/root/openmailstack/webmail-backend`, you must sync those changes to the live system directory and restart the service.
Command to run after any backend code changes:
`cd /root/openmailstack/webmail-backend && npm run build && rsync -av --exclude=node_modules /root/openmailstack/webmail-backend/ /opt/openmailstack-backend/ && chown -R openmailstack:openmailstack /opt/openmailstack-backend && systemctl restart openmailstack`

**3. Frontend Deployment**
Whenever you make frontend changes in `/root/openmailstack/webmail-frontend`, you must rebuild the production bundle and sync the output `dist/` directory to the live Nginx web root.
Command to run after any frontend code changes:
`cd /root/openmailstack/webmail-frontend && npm run build && rsync -av --delete dist/ /var/www/openmailstack/`

**4. System Services**
- The backend operates as a systemd service named `openmailstack`. If it fails, check logs using `journalctl -u openmailstack -n 50`.
- Do not edit files directly in `/opt/openmailstack-backend` or `/var/www/openmailstack`. Always edit in `/root/openmailstack/` and sync.
</RULE[deployment_reminder]>

<RULE[deployment_reminder]>
**CRITICAL: OpenMailStack Deployment Reminder**
Whenever you make changes to the backend in `/root/openmailstack/webmail-backend`, you MUST sync those changes to the live system directory at `/opt/openmailstack-backend` before restarting the service.

Command to run after backend build:
`rsync -av --exclude=node_modules /root/openmailstack/webmail-backend/ /opt/openmailstack-backend/ && chown -R openmailstack:openmailstack /opt/openmailstack-backend && systemctl restart openmailstack`

Similarly, frontend changes built in `/root/openmailstack/webmail-frontend` must be synced to `/var/www/openmailstack`.

Command to run after frontend build:
`cd /root/openmailstack/webmail-frontend && npm run build && rsync -av --delete dist/ /var/www/openmailstack/`
</RULE[deployment_reminder]>

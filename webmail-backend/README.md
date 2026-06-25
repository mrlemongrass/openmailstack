# OpenMailStack Webmail Backend

This is the Node/Express API and sync proxy for the modern webmail frontend.

Runtime configuration is read from environment variables. Production installs should render `/etc/openmailstack/webmail-backend.env` from the installer config and load it through `packaging/systemd/openmailstack.service`.

Required:

```bash
OMS_DB_PASSWORD=...
```

Common production values:

```bash
OMS_WEBMAIL_HOST=127.0.0.1
OMS_WEBMAIL_PORT=20000
OMS_PUBLIC_BASE_URL=https://mail.example.com
OMS_DEFAULT_DOMAIN=example.com
OMS_DB_HOST=127.0.0.1
OMS_DB_NAME=postfixadmin
OMS_DB_USER=postfixadmin
OMS_COOKIE_SECURE=true
```

Run checks:

```bash
npm run build
```

# OpenMailStack Webmail Frontend

This is the canonical OpenMailStack webmail and groupware frontend. It is a React + Vite single-page app for mail, calendar, contacts, settings, and admin-facing webmail controls.

The app talks to `webmail-backend` through same-origin `/api` and `/api/apps` routes in production. In development, the Vite proxy forwards those routes to `http://127.0.0.1:20000`.

Useful commands:

```bash
npm run dev
npm run build
npm run lint
```

The older sibling `webmail/` directory is a starter scaffold and is not the product webmail.

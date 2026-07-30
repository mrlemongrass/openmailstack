# Admin RBAC Audit

Last verified: 2026-07-29

## Policy

The modern React Admin app is global-only. Every modern Admin endpoint requires:

1. a valid OpenMailStack web session; and
2. a fresh database check that the session user is an active `superadmin`.

`requireAdminSession` does not trust the role captured when the session was created. It re-reads `admin.active` and `admin.superadmin` on every request, so a demotion takes effect without waiting for the session to expire.

Domain-admin behavior remains only in the legacy `/SOGo/admin/` portal. Its user, domain, global, and quarantine boundaries are listed below. The external `api_v1.php` provisioning API uses global operator keys; it does not claim domain-scoped keys.

## Modern Admin API

All 47 routes below passed the automated middleware inventory in `tests/integration/admin_rbac_guard.cjs`.

| Method | Route | Effective scope |
| --- | --- | --- |
| GET | `/api/admin/branding` | Active superadmin |
| PUT | `/api/admin/branding` | Active superadmin |
| GET | `/api/admin/settings/:namespace` | Active superadmin |
| PUT | `/api/admin/settings/:namespace` | Active superadmin |
| GET | `/api/admin/domains` | Active superadmin, all domains |
| POST | `/api/admin/domains` | Active superadmin |
| GET | `/api/admin/domains/:domain/dns` | Active superadmin |
| DELETE | `/api/admin/domains/:domain` | Active superadmin |
| GET | `/api/admin/admins` | Active superadmin |
| POST | `/api/admin/admins` | Active superadmin |
| POST | `/api/admin/admins/:username/superadmin` | Active superadmin |
| DELETE | `/api/admin/admins/:username/superadmin` | Active superadmin; self/last-superadmin guards |
| DELETE | `/api/admin/admins/:username` | Active superadmin; target must not remain a superadmin |
| GET | `/api/admin/telemetry/metrics` | Active superadmin |
| GET | `/api/admin/telemetry/logs/live` | Active superadmin |
| GET | `/api/admin/telemetry/system-health` | Active superadmin |
| POST | `/api/admin/telemetry/remediate` | Active superadmin; allow-listed operation |
| GET | `/api/admin/telemetry/fail2ban/status` | Active superadmin |
| POST | `/api/admin/telemetry/fail2ban/unban` | Active superadmin |
| GET | `/api/admin/logs` | Active superadmin |
| GET | `/api/admin/mailboxes` | Active superadmin, all domains |
| POST | `/api/admin/mailboxes` | Active superadmin |
| PUT | `/api/admin/mailboxes/:username` | Active superadmin |
| POST | `/api/admin/mailboxes/:username/password` | Active superadmin; revokes target sessions and app passwords |
| DELETE | `/api/admin/mailboxes/:username` | Active superadmin; removes target auth state |
| GET | `/api/admin/aliases` | Active superadmin, all domains |
| POST | `/api/admin/aliases` | Active superadmin |
| PUT | `/api/admin/aliases/:address` | Active superadmin |
| DELETE | `/api/admin/aliases/:address` | Active superadmin |
| GET | `/api/admin/routing` | Active superadmin |
| POST | `/api/admin/routing` | Active superadmin |
| DELETE | `/api/admin/routing/:aliasDomain` | Active superadmin |
| GET | `/api/admin/apikeys` | Active superadmin |
| POST | `/api/admin/apikeys` | Active superadmin |
| DELETE | `/api/admin/apikeys/:id` | Active superadmin |
| GET | `/api/admin/updates` | Active superadmin |
| GET | `/api/admin/spam_policies` | Active superadmin |
| POST | `/api/admin/spam_policies` | Active superadmin |
| GET | `/api/admin/scheduler/v1/mailboxes` | Scheduler installed and active superadmin |
| PUT | `/api/admin/scheduler/v1/mailboxes/:username` | Scheduler installed and active superadmin |
| GET | `/api/admin/scheduler/v1/providers` | Scheduler installed and active superadmin |
| POST | `/api/admin/scheduler/v1/providers` | Scheduler installed and active superadmin |
| PUT | `/api/admin/scheduler/v1/providers/:id` | Scheduler installed and active superadmin |
| DELETE | `/api/admin/scheduler/v1/providers/:id` | Scheduler installed and active superadmin |
| POST | `/api/admin/scheduler/v1/providers/:id/test` | Scheduler installed and active superadmin |
| GET | `/api/admin/scheduler/v1/workflow-operations` | Scheduler installed and active superadmin |
| POST | `/api/admin/scheduler/v1/workflow-operations/:id/reconcile` | Scheduler installed and active superadmin |

There is deliberately no partial domain scope in the modern API. Adding domain admins later requires an explicit resource-to-domain resolver for every route; it must not weaken the current superadmin default.

## Legacy Admin Actions

The legacy action endpoint first requires an authenticated PHP session. It then applies one of three policies to every action.

### Mailbox self-service

These six actions operate only on the signed-in mailbox identity:

| Action | Scope |
| --- | --- |
| `user_get_profile` | Current mailbox |
| `user_change_password` | Current mailbox; revokes web sessions and app passwords |
| `user_get_forwarding` | Current mailbox |
| `user_set_forwarding` | Current mailbox |
| `user_get_spam_rules` | Current mailbox |
| `user_set_spam_rules` | Current mailbox |

### Domain-scoped administration

| Action | Scope |
| --- | --- |
| `get_routing` | Assigned domains, or all for superadmin |
| `get_domains` | Assigned domains, or all for superadmin |
| `get_dns_records` | Explicit domain ownership check |
| `add_domain` | Creates an inactive assigned domain; DNS ownership proof is required before activation |
| `verify_domain` | Explicit domain ownership check |
| `delete_domain` | Explicit domain ownership check |
| `get_mailboxes` | Mailboxes in assigned domains |
| `add_mailbox` | Explicit target-domain ownership check |
| `edit_mailbox` | Explicit existing-domain ownership check; no cross-domain move |
| `delete_mailbox` | Explicit target-domain ownership check |
| `change_password` | Explicit target-domain ownership check; revokes target sessions and app passwords |
| `get_aliases` | Aliases in assigned domains |
| `add_alias` | Explicit target-domain ownership check |
| `edit_alias` | Explicit existing-domain ownership check; no cross-domain move |
| `delete_alias` | Explicit target-domain ownership check |
| `add_catchall` | Explicit target-domain ownership check |
| `get_quarantine` | Recipients in assigned domains |
| `view_quarantine` | Recipient-domain ownership check before file access |
| `delete_quarantine` | Recipient-domain ownership check before deletion |
| `release_quarantine` | Recipient-domain ownership check before release |
| `get_spam_policies` | Assigned domain; global policy is superadmin-only |
| `set_spam_policies` | Assigned domain; global policy is superadmin-only |

### Superadmin-only legacy actions

| Action | Reason |
| --- | --- |
| `get_system_health` | Host-global visibility |
| `get_audit_logs` | Cross-tenant audit data |
| `get_rspamd_password` | Host-global secret |
| `get_domain_aliases` | Cross-domain routing |
| `add_domain_alias` | Cross-domain routing |
| `delete_domain_alias` | Cross-domain routing |
| `get_admins` | Global role management |
| `add_admin` | Global role management |
| `delete_admin` | Global role management |
| `change_admin_password` | Global role management |
| `get_api_keys` | Global provisioning credentials |
| `create_api_key` | Global provisioning credentials |
| `delete_api_key` | Global provisioning credentials |
| `check_updates` | Host-global operations |
| `run_upgrade` | Root-bridged host mutation |

The legacy portal now uses strict, secure, HTTP-only, SameSite cookies and regenerates its session ID after login. Accounts with OpenMailStack two-factor authentication enabled cannot use the password-only legacy login and are directed to the modern app.

Mailbox-backed superadmins are the production default because they can use the modern app, two-factor authentication, and per-client app passwords. Clean installs can still bootstrap a legacy-only admin before any mailbox exists; the installer labels this limitation, enforces the same 12–128 character password policy, and recommends promoting a mailbox-backed account once mailbox provisioning is available.

## External Provisioning API

`api_v1.php` authenticates a bearer token before route dispatch. Tokens are random, stored only as password hashes, and currently authorize global domain/mailbox provisioning. Key creation, listing, and revocation are superadmin-only in both Admin surfaces.

Domain-scoped provisioning tokens are not implemented. A future scoped-token design must store explicit capabilities and allowed domains and deny unrecognized routes by default.

## Regression Proof

- `tests/integration/admin_rbac_guard.cjs` inventories all modern Admin registrations and fails if a route omits the required middleware chain.
- The same guard verifies every sensitive legacy action uses the expected superadmin, domain, or quarantine authorization helper.
- `tests/integration/auth_hardening_guard.cjs` covers the Dovecot/app-password and web-2FA integration points.
- PHP lint, TypeScript build, backend tests, frontend tests/lint/build, and the integration suite remain release gates.

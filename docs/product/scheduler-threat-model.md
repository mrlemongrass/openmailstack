# OMS Scheduler Threat Model

Status: `Phase 0 Approved Baseline`

Last reviewed: 2026-07-12

This document defines the security boundaries that must exist before OMS Scheduler exposes public or authenticated routes. It covers the complete planned surface, even when the feature is not yet implemented.

## 1. Protected Assets

- Private calendar content, including titles, descriptions, attendees, locations, and busy-source identity.
- Derived availability and booking limits.
- Booking attendee identity, answers, consent, notes, and capability links.
- Tenant membership, mailbox entitlement, handles, teams, routing attributes, and assignment traces.
- OAuth refresh/access tokens, API keys, payment references, webhook secrets, conferencing credentials, and messaging credentials.
- Payments, refunds, receipts, tax metadata, and reconciliation state.
- Workflow templates, scheduled jobs, outbox payloads, delivery attempts, and dead letters.
- Audit events, analytics, exports, deletion requests, and retention state.

Raw card data, provider passwords, and arbitrary calendar credentials are not Scheduler application data and must never be stored directly.

## 2. Trust Boundaries

1. Public browser or embed to the public Scheduler API.
2. Authenticated OMS browser to the owner Scheduler API.
3. Superadmin or future domain-scoped admin to the Scheduler Admin API.
4. Provider callback to the provider-specific callback boundary.
5. Scheduler API transaction to MariaDB and the transactional outbox.
6. Scheduler worker to email, calendar, conference, payment, CRM, webhook, translation, SMS, WhatsApp, or voice providers.
7. OMS Calendar projection to web Calendar, CalDAV, ActiveSync, and external clients.

Crossing a boundary requires an explicit identity or a narrowly scoped capability. Display handles, email local parts, event slugs, provider-supplied IDs, and request hostnames are never authorization evidence.

## 3. API Boundary Decision

| Boundary | Planned prefix | Identity | Required controls | Failure behavior |
|---|---|---|---|---|
| Public discovery/slots/booking | `/api/public/scheduler/v1/*` | Anonymous plus abuse signals | Published+enabled check, tenant-bound lookup, strict schema, rate limits, challenge escalation, idempotency | Generic not-found for unpublished/disabled/unknown resources |
| Booking capability | `/api/public/scheduler/v1/bookings/*` | Random single-booking capability token | Hashed token storage, exact booking/tenant/scope, expiry, rotation after sensitive changes | Generic not-found for mismatch; expired/forbidden without resource details |
| Owner management | `/api/scheduler/v1/*` | Valid `oms_session` | Exact mailbox ownership, tenant equality, Scheduler entitlement, CSRF protection | `401` without session; `403` when known authenticated owner lacks entitlement |
| Admin management | `/api/admin/scheduler/v1/*` | Revalidated admin session | Superadmin today; domain-scoped tenant membership only after endpoint-level RBAC exists; audit every mutation | `403` outside scope; never fall back to mailbox ownership |
| Provider callback | `/api/public/scheduler/v1/callbacks/:provider` | Provider signature/state | Raw-body signature verification, timestamp/replay window, provider/account binding, idempotency | Generic `400`/`401`; no provider secrets or tenant data in response |
| Worker | No public HTTP route | Service identity | Least-privilege DB/provider credentials, leased outbox claim, idempotent effect, bounded retry/dead letter | Structured sanitized error and observable dead letter |

The first-party UI must use these same APIs. No UI-only permission rule is authoritative.

## 4. Tenant And Authorization Threats

### Threats

- IDOR through sequential booking, team, event-type, or routing IDs.
- Same local part across domains resolving to the wrong public profile.
- Domain admin acting on another tenant.
- User enabling their own Scheduler entitlement or changing another user's handle.
- Capability token reused against another booking or tenant.
- Disabled mailbox retaining owner or public access.

### Controls

- Every Scheduler aggregate and outbox/audit event carries `tenantKey` explicitly.
- Repository queries begin with tenant scope; IDs are never queried globally and filtered afterward.
- `authorizeSchedulerAction` requires tenant equality, exact owner equality, or explicit admin tenant membership.
- Current Admin implementation remains superadmin-only until domain-scoped endpoints are implemented and tested.
- Public handles are normalized and globally unique; reserved names and cross-domain collisions block enablement.
- Capability tokens are high-entropy, stored only as hashes, booking-bound, scope-bound, expiring, revocable, and rotated on attendee email or ownership changes.
- Private event tokens are 256-bit random values stored only as hashes. Owner rotation serializes on the event row, expiry is bounded, switching away from Private revokes active tokens, and missing/wrong/expired/revoked tokens share generic public failure behavior.
- Private event links carry the bearer value in a URL fragment so it is absent from HTTP access logs and referrer headers. The public app moves it into tab-only storage, removes it from the address bar, sends it only in `X-Scheduler-Access`, and marks token-authorized API responses `no-store`.
- Single-use private links consume only when a booking commits. The booking transaction locks the link row, decrements `uses_remaining`, records `consumed_at`, and writes a sanitized audit event; rollback preserves the use. The same booking attempt retains one idempotency key so a lost response can replay after token consumption.
- One-off private links store only the owner-selected timezone and bounded date/time windows alongside the hashed capability. Creation accepts one to fourteen windows within 62 days that each fit the event duration, forces single-use behavior, and requires Private visibility. Slot and booking authorization replace recurring availability with those windows while still applying native calendar conflicts, notice, buffers, capacity, and transactional consumption.
- Disabling entitlement unpublishes public resources and denies owner management without deleting historical bookings.

### Required tests

- Same ID in two tenants cannot be read or mutated cross-tenant.
- Owner email case normalization cannot cross domain or mailbox.
- Scoped admin cannot enumerate or mutate outside assigned tenants.
- Capability token mismatch returns generic not-found.
- Disabled/unpublished/unknown public profiles are indistinguishable.
- Two simultaneous bookings against the last private-link use produce exactly one confirmed booking, one counter decrement, and one consumption audit; an idempotent replay returns the winner.
- One-off availability cannot expose recurring slots, cannot bypass busy-calendar or capacity checks, and an out-of-window or rolled-back booking cannot consume the link.

## 5. Availability And Calendar Privacy

### Threats

- Slot probing reveals private event titles, attendee identity, or which source calendar is busy.
- High-frequency range scans reconstruct a user's activity.
- Calendar projection drifts from booking state or duplicates events.
- Timezone or DST bugs expose or oversell unavailable time.

### Controls

- Availability providers return only busy intervals to the calculation engine.
- Public responses expose available slot instants and public policy only, never exclusion reasons or busy intervals.
- Limit query range, slot density, requests per handle/IP/network, and cache key cardinality.
- Booking is the workflow source of truth; VEVENT is an idempotent projection with stable booking/event IDs and sequence.
- Transactional capacity holds are authoritative; cached availability is advisory.
- Events that require host confirmation commit a `requested` booking and convert its hold into reserved capacity without creating a VEVENT. Owner approval/rejection locks the booking row: approval rotates guest action tokens, creates the projection, advances the calendar sync token, and enqueues confirmation once; rejection expires the request token, releases capacity, and enqueues rejection once. Matching retries are idempotent and an approve/reject race can produce only one terminal decision.
- Reconciliation records drift without logging private calendar bodies.
- DST gap, overlap, midnight, notice, buffer, and concurrent-capacity tests remain release gates.

Required tests include requested-capacity exclusion, no pre-approval Calendar projection, token rotation, rejection release, requested cancellation without a phantom tombstone, repeated-decision idempotency, and simultaneous approve/reject serialization.

## 6. Public Abuse, Spam, And Enumeration

### Threats

- Handle and email enumeration.
- Booking spam, calendar flooding, notification amplification, and resource exhaustion.
- Injection through names, questions, locations, redirects, UTM fields, or workflow variables.
- Bot reservation of all capacity using abandoned holds.

### Controls

- Generic public errors and constant-shape responses for missing, disabled, or unpublished resources.
- Layered rate limits per IP, network, handle, tenant, and verified identity; challenge escalation instead of universal CAPTCHA.
- Email verification and domain allow/deny policy where configured.
- Short hold TTL, per-origin hold limits, cleanup on every locked acquisition, and background expiration.
- Strict field sizes/types, allowlisted redirect schemes/hosts, output encoding, HTML sanitization, and safe template interpolation.
- Do not place free-text answers in logs, metrics labels, routing traces, webhook errors, or audit metadata.
- Booking-question definitions are owner-controlled and bounded to ten fields. Short, long, and dropdown answers are revalidated against the current public event immediately before booking; confirmed rows store the validated answer plus the immutable question label/type alongside the immutable event snapshot. React renders submitted text without raw HTML, and answers are excluded from the outbox, iCalendar projection, capability responses, and audit metadata.
- Notification and webhook fan-out quotas with loop detection.

Required tests include missing required answers, unknown/duplicate question IDs, invalid dropdown choices, maximum lengths, legacy owner updates, immutable answer snapshots after definition edits, output escaping, and absence from audit metadata.

## 7. OAuth And Provider Secrets

### Threats

- OAuth state/PKCE bypass, callback mix-up, token theft, over-broad scopes, and refresh-token reuse.
- Secrets exposed in frontend bundles, logs, database exports, support views, or process arguments.
- Provider account connected to the wrong OMS tenant or user.

### Controls

- Authorization code with PKCE and cryptographic state bound to tenant, actor, provider, redirect URI, and short expiry.
- Exact callback URI allowlist; no wildcard or request-host-derived redirect URI.
- Minimal provider scopes and capability discovery.
- Encrypt secrets with versioned keys separate from mailbox credential storage; never return refresh tokens to clients.
- Redact authorization headers, tokens, codes, signatures, and provider payload secrets from logs and audits.
- Disconnect revokes provider tokens where possible and tombstones local credentials.
- Provider references contain only provider ID plus external opaque ID.

## 8. Payments

### Threats

- Forged or replayed payment callbacks, amount/currency substitution, duplicate capture/refund, and paid booking without capacity.
- PII or card data stored in OMS.

### Controls

- Provider-hosted checkout; OMS stores provider references and normalized status only.
- Server calculates amount/currency from a versioned event-type snapshot, never public request fields.
- Verify callback signature against raw body plus timestamp/replay window.
- Bind provider event to tenant, booking, expected amount, currency, and current state.
- Idempotency keys for checkout, capture, callback, refund, and outbox effects.
- Capacity hold expiration accounts for payment duration; final confirmation revalidates hold/payment state transactionally.
- Reconciliation detects successful provider payments without confirmed bookings and alerts an administrator.

## 9. Webhooks, Routing, And SSRF

### Threats

- Webhook targets internal services, cloud metadata, local sockets, or DNS-rebinding destinations.
- Callback replay or forged inbound webhooks.
- Routing expressions cause injection, catastrophic regex, data exfiltration, or cross-tenant host assignment.
- Recursive webhooks create unbounded loops.

### Controls

- HTTPS-only outbound URLs by default; block loopback, private, link-local, multicast, Unix sockets, credentials in URLs, and nonstandard schemes.
- Resolve and validate every connection target, including redirects; pin or revalidate DNS results to resist rebinding.
- Sign outbound payloads with per-subscription secrets and stable event IDs.
- Bounded timeout, response size, redirects, attempts, concurrency, and dead-letter retention.
- Inbound provider callbacks require signature, replay window, and idempotency.
- Routing uses a parsed typed expression tree with bounded depth/operations; no `eval` and no user-supplied regex in Phase 1.
- Eligible hosts are tenant-scoped before routing rules run; routing cannot broaden the candidate set.

## 10. Outbox, Jobs, And Audit

- Booking mutation and outbox enqueue occur in the same database transaction.
- Delivery is at-least-once; every provider effect must be idempotent.
- Claims use a worker lease, attempt count, bounded backoff, maximum attempts, and dead-letter state.
- Retryable versus permanent failures are explicit. A worker crash cannot silently acknowledge an event.
- Audit writes include tenant, actor type/ID, action, target, correlation ID, and sanitized metadata.
- Audit metadata excludes secrets, message bodies, booking answers, calendar bodies, payment payloads, and capability tokens.
- Clocks are not trusted for uniqueness; database constraints and idempotency keys remain authoritative.

## 11. Logging And Data Classification

| Class | Examples | Logging rule |
|---|---|---|
| Public | Published event title, duration, public handle | Structured logging allowed when necessary |
| Internal | Tenant ID, booking ID, provider ID, status | Allowed with retention and access control |
| Confidential | Attendee email, phone, answers, busy intervals, IP | Avoid; redact or hash when operationally necessary |
| Secret | Capability token, OAuth token/code, API key, webhook/payment signature | Never log |

Prometheus labels must not contain mailbox addresses, handles, booking IDs, attendee data, URLs, or provider error bodies.

## 12. Phase Gates

Before Phase 1 routes are mounted:

- Authorization tests cover public, owner, scoped-admin, superadmin, capability, disabled, and cross-tenant cases.
- Route middleware maps each prefix in section 3 to the corresponding authorization contract.
- Public rate-limit and generic-error behavior has integration coverage.
- Capability tokens use hash-at-rest storage and rotation rules.
- Outbox persistence/lease/idempotency schema and worker failure behavior are implemented and tested.
- Host alias allowlist and preferred public base URL are validated without trusting `Host`.
- Security review confirms no live migration or public exposure occurred during Phase 0.

Before payments, OAuth, outbound webhooks, or routing are enabled, their controls above require provider-specific contract and adversarial tests.

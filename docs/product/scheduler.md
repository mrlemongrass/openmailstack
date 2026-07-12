# OMS Scheduler Product And Engineering Roadmap

Status: `Phase 2 In Progress - Transactional Single-Use Links Deployed, Physical Client Validation Pending`

Research date: 2026-07-10

Owner: OpenMailStack

## 1. Product Decision

OMS Scheduler is the native OpenMailStack scheduling application. In the web app it is labeled **Scheduler** and appears immediately after **Notes** in desktop and mobile app navigation. Installation is optional, and only an authorized administrator can enable Scheduler for individual mailboxes.

The product goal is functional parity with the scheduling capabilities offered by Calendly and Cal.com, delivered as an integrated, privacy-respecting, self-hostable OpenMailStack application. It is not an iframe, a Cal.com deployment, or a thin link to a third-party service.

“Parity” means that every durable competitor capability is represented in the capability register below, has an OMS acceptance test, and is either `Planned`, `In Progress`, `Implemented`, or explicitly `Provider Dependent`. It does not mean copying competitor source code, visual design, trademarks, proprietary implementation details, contractual support programs, or third-party services.

### Product principles

- Native first: OMS accounts, calendars, contacts, mail delivery, branding, audit logs, and admin policies are the default integrations.
- Administrator controlled: installing Scheduler makes the capability available to the server, but does not publish any user. Users cannot self-enable a public scheduling page.
- No OMS feature paywalls: Scheduler functionality should be available in the open-source product. External providers may still charge for SMS, voice, payment processing, conferencing, CRM, maps, or other APIs.
- Calm for individuals, powerful for teams: a user can publish a useful booking page in minutes, while advanced controls stay progressively disclosed.
- Privacy by design: public bookers see available slots, never raw calendar titles, attendees, private event data, or a user's full busy calendar.
- Correct under concurrency: a slot cannot be double-booked when two requests arrive together.
- API complete: every first-party UI action is backed by a documented, permission-checked API.
- Accessible and localizable: public booking and management flows target WCAG 2.2 AA, keyboard operation, screen readers, locale-aware dates, right-to-left layouts, and timezone clarity.
- Clean-room implementation: competitor documentation informs requirements. Do not copy Cal.com code or enterprise-only implementation. Both projects use AGPL-related licensing, but OMS should still keep provenance and implementation ownership clear.

## 2. Competitive Review

The inventory below is based on current official product, pricing, help, and developer documentation. Competitor capabilities change frequently, so the inventory must be rechecked at the start of each parity release.

Primary sources:

- [Calendly features](https://calendly.com/features/)
- [Calendly pricing and feature comparison](https://calendly.com/pricing/)
- [Calendly Workflows](https://help.calendly.com/hc/en-us/articles/360051017814-Automate-tasks-with-Workflows)
- [Calendly Scheduling page, single-use links, and meeting polls](https://help.calendly.com/hc/en-us/articles/360022356594-Home-page-overview)
- [Calendly developer APIs](https://developer.calendly.com/getting-started)
- [Cal.com pricing and feature comparison](https://cal.com/pricing)
- [Cal.com help documentation index](https://cal.com/help/llms.txt)
- [Cal.com event type settings](https://cal.com/docs/atoms/event-type)
- [Cal.com routing overview](https://cal.com/help/routing/routing-overview)
- [Cal.com Workflows](https://cal.com/help/workflows/workflowsoverview)
- [Cal.com API v2](https://cal.com/docs/api-reference/v2/introduction)
- [Cal.com MCP server](https://cal.com/help/cal-ai/mcp-server)

### 2.1 What Calendly does well

- Low-friction personal scheduling with polished event-type setup, share links, booking pages, mobile apps, and browser extensions.
- One-on-one, group, collective, multi-host, round-robin, priority-based, managed, and book-on-behalf scheduling.
- Availability controls including multiple calendars, schedules, date ranges, buffers, minimum notice, daily limits, and timezone handling.
- Single-use links, one-off meetings, meeting polls, cancellation policies, and contact scheduling activity.
- Routing forms that qualify invitees and route them to a person, team, booking page, or other destination.
- Workflows for booking, start, end, reschedule, cancellation, no-show, reminders, reconfirmation, follow-up, email, and SMS.
- Strong integration coverage: Google and Microsoft suites, conferencing, CRM and marketing systems, Stripe, PayPal, Zapier, webhooks, embeds, browser extensions, and mobile apps.
- Team governance through managed event templates, groups, delegated permissions, admin dashboards, analytics, SSO/SAML, SCIM, domain control, audit logs, and deletion APIs.
- Public REST, Embed, Webhook, and newer Scheduling APIs for embedded and agent-driven scheduling.

### 2.2 What Cal.com does well

- Unlimited individual event types and calendars, rich event settings, public profile pages, embeds, and an extensible app ecosystem.
- Multiple durations, multiple schedules, date overrides, holidays, out-of-office delegation, per-event conflict calendars, custom slot intervals, optimized slots, buffers, minimum notice, frequency limits, future limits, active-booker limits, and user-wide limits.
- Required confirmation, email verification, domain allow/deny rules, booking questions, seats, recurring bookings, private links, secret events, custom redirects, hidden notes, locked timezones, and customizable calendar event names.
- Collective, round-robin, managed, fixed-host, weighted, priority, load-balanced, maximum-availability, dynamic group, team, sub-team, and organization scheduling.
- Sophisticated routing with attributes, weighted attributes, virtual queues, fallbacks, CRM ownership, routing traces, and headless forms.
- Email, SMS, WhatsApp, and voice-agent workflow concepts, dynamic variables, translations, booking/payment/no-show triggers, webhooks, and custom SMTP.
- Booking insights, page analytics, UTM attribution, no-show tracking, recordings/transcripts references, and team performance reporting.
- Stripe and PayPal payments, conferencing options, CRM synchronization, Zapier/Make, mobile and browser clients, and broad calendar-provider support.
- API v2, OAuth scopes, API keys, webhooks, embedded UI components, managed-user/platform concepts, CLI, MCP server, and agent-oriented scheduling operations.
- Enterprise controls including organizations, sub-teams, roles, delegated calendar credentials, SSO/SCIM, audit logs, data residency options, and dedicated deployment concepts.

### 2.3 OMS opportunity

OMS already owns the account, mailbox, SMTP sender, contacts, native calendar store, CalDAV surface, ActiveSync surface, branding, and admin experience. Scheduler can therefore provide a coherent experience without asking a self-hosted user to connect the same OMS calendar and email account back to a third party.

The differentiator should be **a complete scheduling product included with the communication suite**, not merely a cheaper Calendly clone. A confirmed booking should immediately exist in OMS Calendar, send through the user's OMS mail identity, appear on CalDAV and ActiveSync clients, use OMS Contacts for known people, respect OMS branding and policy, and be observable by OMS administrators.

## 3. OMS Capability Contract

The following register is the parity scope. A phase is complete only when its entries have automated tests and the documented acceptance behavior.

Machine-readable status is maintained in [`scheduler-capabilities.json`](scheduler-capabilities.json) and validated by `tests/integration/scheduler_docs_guard.cjs`. Security boundaries and release gates are defined in [`scheduler-threat-model.md`](scheduler-threat-model.md).

### 3.1 Individual scheduling

- Event types: unlimited personal event types, stable slugs, draft/published state, clone, archive, reorder, color, description, internal notes, owner, and destination calendar.
- Duration: fixed durations customizable from 5 minutes through 24 hours with user-friendly hours/minutes controls, plus invitee-selectable multiple durations.
- Location: in person, phone, custom text, OMS-native video link, Zoom, Google Meet, Microsoft Teams, and invitee choice.
- Availability: reusable schedules, multiple windows per day, per-event schedule, date overrides, holidays, out of office, timezone, and working-location metadata.
- Conflict checks: one or more OMS calendars by default and connected external calendars later; transparent/free events do not block.
- Slot rules: interval, start offsets, buffers before/after, minimum notice, rolling/fixed date range, future limit, per-day/week/month/year limits, total-duration limits, and optimized slot packing.
- Booker limits: active booking cap per event type with optional reschedule offer; email/domain allow and deny rules.
- Form: name/email/phone modes, custom questions, required/optional fields, consent checkboxes, hidden/prefilled fields, UTM capture, and validation.
- Booking policy: instant acceptance or host confirmation, cancellation policy, reschedule/cancel cutoff, reason collection, email verification, bot protection, and additional guests.
- Special links: public, unlisted/secret, private hash links, single-use links, expiration by date or successful uses, and one-off customized availability links.
- Group capacity: seats per slot, remaining capacity, attendee management, and waitlist.
- Recurring booking: a booker can request an allowed series with explicit recurrence limits and per-occurrence conflict validation.
- Meeting polls: propose times, invite participants, collect votes, choose the winning slot, and create the final event.
- Booking lifecycle: requested, accepted, rejected, canceled, rescheduled, completed, no-show, paid/refunded, and expired.
- Host tools: book now, book on behalf of another user, add/remove attendees, reassign host, request reschedule, and mark no-show.

### 3.2 Public booking experience

- Public profile at `/scheduler/:handle` and event page at `/scheduler/:handle/:eventSlug`. The default handle is the mailbox local part without `@domain`. The path is independent of the configured OMS hostname: `thang@housevo.us` is available at both `https://webmail.housevo.us/scheduler/thang` and `https://mail.housevo.us/scheduler/thang` when both hostnames are configured OMS aliases with valid TLS.
- Administrators select one preferred Scheduler public base URL for generated links, email, embeds, social metadata, and canonical tags. Every allowlisted OMS webmail hostname serves the same Scheduler paths without changing the handle or booking data.
- Handles are normalized and globally unique per OMS installation. Reserved route names, invalid URL characters, and duplicate local parts across hosted domains must be resolved by an administrator assigning an alternate handle before enablement.
- Disabling Scheduler for a user immediately unpublishes the profile, event pages, embeds, and slot APIs with the same generic not-found response used for unknown handles; existing bookings remain manageable and are not deleted.
- Organization and team directory pages where enabled by policy.
- Server-generated social metadata and index/no-index controls.
- Automatic timezone detection with an explicit, persistent timezone selector.
- Fast month/day/slot navigation, accessible focus management, locale-aware formats, and mobile-first layout.
- Booking summary, form review, confirmation, add-to-calendar options, reschedule, cancel, and expired/unavailable states.
- Host avatar, organization branding, event information, privacy notice, terms link, and optional branding removal.
- Inline, popup, floating-button, and email-slot embeds with a documented postMessage/event contract.
- Query parameter prefill and forwarding with an allowlist so embeds cannot inject unsafe redirects or fields.
- Rate limits, abuse detection, CAPTCHA challenge escalation, email verification, and generic responses that do not expose account existence.

### 3.3 Team scheduling

- Teams, organization/domain membership, sub-teams, owners, admins, schedulers, members, and viewer/analyst roles.
- Collective events requiring all or a configured subset of hosts.
- Group events with multiple invitees per slot.
- Round robin with load balancing or maximum availability.
- Priority order, weights, fixed hosts, round-robin groups, minimum/maximum host counts, and host selection by the booker.
- Managed event templates that administrators can publish, lock, update, and assign at scale.
- Dynamic group links that calculate mutual availability for an ad hoc set of OMS users.
- Delegated scheduling and book-on-behalf permission with an audit trail.
- Out-of-office redirection to a selected teammate.
- Fairness ledger and explainable assignment trace for every automated host selection.

### 3.4 Routing and qualification

- Form builder with short text, long text, number, email, phone, single choice, multiple choice, select, date, consent, and hidden fields.
- Rule builder with nested `AND`/`OR`, equals, contains, comparison, domain, regex-safe matching, and default routes.
- Route actions: event type, team, specific user, external HTTPS/mailto redirect, custom message, or webhook handoff.
- Attribute-based matching for language, country, region, department, specialty, seniority, or administrator-defined attributes.
- Weighted attributes, virtual queues, fallback host subsets, and deterministic tie-breaking.
- CRM owner routing for supported CRM adapters without embedding CRM-specific logic in the scheduling core.
- Headless routing API for existing OMS forms or third-party websites.
- Routing trace that records evaluated rules, eligible hosts, exclusions, fallback, and final assignment without logging sensitive free-text answers unnecessarily.
- Form response retention, export, deletion, consent, and per-field privacy controls.

### 3.5 Workflows and communications

- Triggers: booking requested, accepted/created, rejected, rescheduled, canceled, starts, ends, no-show changed, payment initiated/succeeded/failed/refunded, routing submitted, and routing completed without booking.
- Relative time triggers before or after start/end with timezone-safe scheduling.
- Actions: OMS email to host/attendee/guest/custom address, webhook, in-app notification, calendar update, CRM adapter action, and provider-backed SMS, WhatsApp, or voice call.
- Templates with safe variables, subject/text/HTML variants, preview/test, locale, sender identity, reply-to, and optional calendar attachment.
- Reminders, reconfirmation, follow-ups, feedback requests, no-show recovery, and reschedule links.
- Multi-step workflows, ordering, delay, conditional steps, clone, enable/disable, apply to selected/all event types, and version snapshots for already-booked meetings.
- Delivery ledger with queued/sent/delivered/failed state, retries with backoff, dead-letter handling, idempotency, and manual retry.
- Consent and unsubscribe enforcement by channel; SMS/WhatsApp/voice remain provider-dependent and require administrator configuration.
- Optional automatic translation through a pluggable translation provider; OMS must retain the original and rendered template versions.

### 3.6 Payments

- Payment required before confirmation or payment collected after approval.
- Fixed price, currency, tax/fee metadata, discount code, refund policy, payment status, receipts, and reconciliation.
- Stripe and PayPal adapters first; provider interface for additional processors.
- Signed webhook verification, idempotent processing, replay protection, and no storage of raw card data.
- Cancel/refund policy automation and administrator-visible failure handling.
- Free event types remain independent of payment-provider availability.

### 3.7 Integrations

- Native OMS Calendar, Contacts, Mail, branding, Admin audit, notifications, CalDAV, ActiveSync, and ICS.
- External calendars: Google Calendar, Microsoft 365/Outlook, generic CalDAV, Apple/iCloud through CalDAV/app-password flows where feasible, and read-only ICS busy feeds.
- Conferencing: OMS-generated room URL, Zoom, Google Meet, Microsoft Teams, and custom location adapters.
- CRM/marketing: Salesforce, HubSpot, Microsoft Dynamics, Pipedrive, Mailchimp, Marketo, and Pardot through versioned adapters.
- Automation: outbound webhooks, Zapier/Make-compatible triggers/actions, and a generic integration API.
- Payments: Stripe and PayPal.
- Communications: SMTP through OMS by default; optional Twilio-compatible SMS/WhatsApp and pluggable voice provider.
- Import: Calendly event types and common settings where their export/API permits, Cal.com event types where permitted, and CSV import/export for bookings and contacts.
- Browser extension and mobile/PWA share actions after the web product is stable.

### 3.8 Analytics and operations

- Upcoming, unconfirmed, recurring, past, canceled, and no-show booking views with filters and bulk export.
- Booking counts, completion/cancellation/no-show rates, lead time, time-to-book, popular event types, popular days/times, host utilization, round-robin fairness, and routing conversion.
- Booking-page views, slot views, form starts, form completion, booking conversion, source/referrer, UTM attribution, and privacy-conscious retention.
- Team and organization dashboards with scope-aware access.
- Workflow delivery, payment, integration, webhook, and queue health.
- Prometheus metrics, structured logs, trace/correlation IDs, health checks, and alerts that do not include booking answers or private calendar content.
- CSV/JSON exports and documented metric definitions.

### 3.9 Administration, security, and compliance features

- Domain-based organization mapping, team lifecycle, roles, permission policies, groups, and bulk actions.
- Scheduler enabled/disabled policy by domain, team, or user; public page and branding policies.
- SAML/OIDC SSO and SCIM reuse the suite-wide identity work rather than creating Scheduler-only identity stacks.
- Domain claim/control, delegated calendar connections, managed templates, custom SMTP, and guest notification policies.
- Audit events for configuration, permission, booking, routing, payment, export, deletion, integration, and impersonation/delegation actions.
- Data export/deletion APIs, retention policies, legal hold boundary, consent records, and regional hosting documentation.
- API keys and OAuth clients with narrow scopes, rotation, expiry, hashed storage, revocation, and last-used metadata.
- Secret encryption, SSRF-safe outbound requests, webhook allow/deny policy, signed payloads, CSRF protection, content sanitization, tenant tests, and rate limiting.
- Backup/restore, upgrade migrations, disaster recovery, queue recovery, and clean-VM installer validation.
- Compliance readiness evidence can be built into the product; OMS must not claim certifications such as SOC 2, HIPAA, or ISO 27001 until independently achieved.

### 3.10 Developer platform and agents

- Versioned REST API for profiles, schedules, availability, event types, slots, bookings, attendees, teams, routing, workflows, webhooks, payments, and insights.
- OAuth 2.1 authorization code with PKCE, scoped API keys, pagination, filtering, idempotency keys, rate-limit headers, and consistent errors.
- Signed webhook subscriptions at user, event, team, and organization scope with retries, replay, payload templates, and delivery logs.
- Embedding SDK and headless booking/routing APIs.
- OpenAPI specification, generated examples, webhook schemas, changelog, deprecation policy, and API compatibility tests.
- CLI for common administrative and scheduling actions.
- OMS Scheduler MCP server with least-privilege scopes for reading availability and managing event types, schedules, and bookings.
- Agent-safe booking APIs that require explicit identity, permissions, idempotency, and confirmation rules; voice scheduling is a later provider-backed workflow action.

## 4. Integration With Current OpenMailStack

### 4.1 Frontend

- Add a lazy-loaded `webmail-frontend/src/scheduler/` application and `/scheduler/*` routes.
- Add `Scheduler` immediately after `Notes` in `AppShell` desktop navigation and mobile navigation.
- Because seven equal mobile tabs are already too dense, replace the current expanding tab row with five primary destinations plus a `More` menu before adding Scheduler. The primary order should be Mail, Calendar, Contacts, Notes, Scheduler; Settings, Sync, and Admin belong in `More` according to permission.
- Management views: Event Types, Bookings, Availability, Teams, Routing, Workflows, Analytics, and Scheduler Settings.
- Public `/scheduler/:handle` and `/scheduler/:handle/:eventSlug` routes must use a separate public layout outside `AuthGate`; authenticated hosts should still be able to preview exactly what a guest sees. Static management routes must be reserved so a public handle cannot shadow `bookings`, `event-types`, `availability`, `teams`, `routing`, `workflows`, `analytics`, `settings`, `admin`, `api`, or other application routes.
- Reuse suite appearance tokens and branding, but give public booking pages a quiet, focused layout instead of exposing the full mail app shell.

### 4.2 Backend

- Keep the first implementation in the existing Node/Express backend to reuse sessions, MariaDB, calendar parsing, SMTP, branding, metrics, and deployment. Enforce a modular boundary under `webmail-backend/src/scheduler/` rather than adding more unrelated code to `api.ts`.
- Authenticated management API: `/api/scheduler/v1/*`.
- Public booking API: `/api/public/scheduler/v1/*`, with strict input schemas, independent rate limits, generic error responses, and no mailbox credentials.
- Public pages: `/scheduler/:handle` and `/scheduler/:handle/:eventSlug`, proxied to the frontend with server-rendered metadata or a small metadata endpoint until SSR is justified.
- Generate absolute public links from a configured preferred base URL, never directly from an untrusted HTTP `Host` header. Accept only installer/admin-allowlisted OMS hostnames so aliases work without enabling host-header injection or cache poisoning.
- Background worker: a separate process entry point using the same deployed package, MariaDB-backed leases, an outbox, retry state, and dead-letter records. Do not make reminders depend on a browser session or in-process timer.
- Provider adapters: `calendar`, `conference`, `payment`, `message`, `crm`, `webhook`, and `translation` interfaces with explicit capabilities and health state.

### 4.3 Calendar ownership and consistency

The booking row is the workflow source of truth; the calendar event is its interoperable projection.

1. A public request creates a short-lived slot hold in a database transaction.
2. The service rechecks availability and host eligibility inside the transaction.
3. It creates or requests the booking with an idempotency key and a unique slot/capacity constraint.
4. An outbox record materializes the VEVENT into the selected OMS calendar, including organizer, attendees, RSVP, conferencing, recurrence, and booking identifiers.
5. The existing CalDAV, ActiveSync, Socket.IO, and web Calendar surfaces distribute the event.
6. Cancel, reschedule, reassignment, and payment state changes update both booking state and VEVENT sequence/status through idempotent jobs.
7. Reconciliation detects missing or externally changed calendar events without silently overwriting user changes.

Never infer booking state only by scraping an event title. Store stable booking and event UIDs in both relational records and iCalendar properties.

### 4.4 Initial data model

Use additive, versioned migrations rather than runtime `CREATE TABLE`/`ALTER TABLE` checks for this subsystem.

- `scheduler_profiles`, including unique normalized public handle, enabled state, enabling admin, enable/disable timestamps, and optional handle-history metadata; `scheduler_organizations`, `scheduler_teams`, `scheduler_team_members`
- `scheduler_schedules`, `scheduler_schedule_windows`, `scheduler_date_overrides`, `scheduler_out_of_office`
- `scheduler_event_types`, `scheduler_event_hosts`, `scheduler_event_questions`, `scheduler_private_links`
- `scheduler_bookings`, `scheduler_attendees`, `scheduler_slot_holds`, `scheduler_booking_events`
- `scheduler_polls`, `scheduler_poll_options`, `scheduler_poll_votes`
- `scheduler_routing_forms`, `scheduler_routing_fields`, `scheduler_routes`, `scheduler_routing_responses`, `scheduler_routing_traces`
- `scheduler_workflows`, `scheduler_workflow_steps`, `scheduler_workflow_versions`, `scheduler_jobs`, `scheduler_delivery_attempts`
- `scheduler_integrations`, `scheduler_oauth_tokens`, `scheduler_webhooks`, `scheduler_webhook_deliveries`
- `scheduler_payments`, `scheduler_refunds`
- `scheduler_audit_events`, `scheduler_daily_metrics`

Every tenant-owned table must carry an explicit organization/domain scope and have composite indexes that start with that scope where appropriate. Store OAuth and provider secrets encrypted with key-version metadata; do not reuse mailbox-password ciphertext as a general secrets vault.

### 4.5 Availability engine

The engine must be a pure, testable service whose inputs are schedules, overrides, event rules, busy intervals, host rules, timezone, and requested range.

- Normalize calculations to instants while retaining the originating IANA timezone.
- Correctly handle daylight-saving gaps, overlaps, date-line changes, leap days, all-day events, and transparent events.
- Merge busy intervals from selected calendars, then apply working windows, overrides, notice, limits, duration, buffers, capacity, and assignment rules.
- Return an availability explanation internally so support/admin tools can explain why a slot was excluded without revealing private event details to the guest.
- Cache only safe derived intervals with bounded TTL and invalidate on native calendar Socket.IO/update events.
- Use transactional slot holds and unique constraints; cache results are never booking authority.

### 4.6 Installer and administrator enablement

- Add an explicit interactive installer question: `Install OMS Scheduler? (y/N)`. Default to `No` for upgrades and unattended compatibility unless `ENABLE_OMS_SCHEDULER=true` is already configured.
- Persist the choice as `ENABLE_OMS_SCHEDULER=true|false` in the generated OpenMailStack configuration so reruns, repair installs, dry runs, and upgrades are deterministic and do not repeatedly prompt.
- Add a preferred Scheduler public base URL, defaulting to `OMS_PUBLIC_BASE_URL`, plus an allowlist of public OMS hostname aliases. For example, generated links may prefer `https://webmail.housevo.us` while both `webmail.housevo.us` and `mail.housevo.us` serve `/scheduler/thang`.
- Add Scheduler to component detection, installation summaries, repair/full-install module selection, backup/restore inventory, Nginx route generation, backend environment rendering, service/worker installation, and uninstall/disable documentation.
- Installer and Admin validation must confirm that each enabled hostname resolves to the OMS web service, is present in the intended Nginx `server_name` configuration, and has a valid certificate before presenting it as a usable public Scheduler URL.
- Installing Scheduler creates the schema, worker, application routes, and Admin controls, but creates no public profiles and grants no user entitlement.
- Add a Scheduler control to the Admin mailbox detail/list experience. Only the existing authorized modern Admin boundary, currently superadmin-only until domain-admin scoping is implemented, can enable or disable Scheduler for a mailbox.
- Before enablement, show the exact public URL and reject reserved, invalid, or already-used handles. Default the handle from the mailbox local part and let the administrator assign an alternate handle when required.
- Record enable, disable, and handle-change operations in the Admin audit log with actor, mailbox, old handle, new handle, and timestamp.
- A disabled mailbox must not see Scheduler as an available app destination. Direct authenticated Scheduler management requests return `403`; public routes return the generic not-found response.

## 5. Delivery Roadmap

Estimates are engineering ranges, not commitments. Full competitor parity is a substantial product program: approximately 12-18 months for a focused 4-6 person team to reach broad production parity, followed by continuing integration and enterprise work. One engineer should expect a multi-year effort. The sequence below prioritizes a trustworthy native scheduler before the integration long tail.

### Phase 0 - Architecture and parity baseline (2-3 weeks)

Implementation status (2026-07-11): `Complete`

- Implemented: pure `calculateAvailability` contract in `webmail-backend/src/scheduler/availability.ts` with weekly windows, date overrides, busy intervals, buffers, minimum notice, IANA timezones, DST gap/overlap handling, and local-midnight boundaries.
- Implemented: versioned `001_scheduler_phase0.sql` migration defining tenant-scoped slot inventory and expiring/idempotent holds. It was later applied by the opt-in Phase 1 installer and is live on the validated host.
- Implemented: `SchedulerSlotHoldRepository` in `webmail-backend/src/scheduler/slot-holds.ts` using an inventory-row `FOR UPDATE` lock, capacity counters, expiration cleanup, idempotency, commit, and rollback.
- Implemented: booking/provider contracts in `webmail-backend/src/scheduler/contracts.ts`, outbox/audit contracts in `webmail-backend/src/scheduler/outbox.ts`, and tenant authorization in `webmail-backend/src/scheduler/authorization.ts`.
- Verified: unit coverage for host/booker timezone projection, DST gap/overlap, overrides, conflicts/buffers, notice, midnight, validation, transaction commit/rollback, capacity rejection, idempotent replay, booking transitions, and tenant authorization.
- Verified: `001_scheduler_phase0.sql` applies to a disposable MariaDB 11 instance, and the two-connection capacity-one race produces exactly one hold. Deadlock/lock-timeout retries are bounded at the transaction boundary.
- Implemented: Phase 0 threat model and public/owner/admin/capability/worker API boundary decisions in `docs/product/scheduler-threat-model.md`.
- Implemented: machine-readable parity register in `docs/product/scheduler-capabilities.json`, enforced by the static integration suite.

Delivered:

- [x] Approve the product decisions in section 8.
- [x] Create versioned migration and scheduler module conventions.
- [x] Define booking, availability, provider, permission, outbox, and audit contracts.
- [x] Add the parity register to automated documentation checks.
- [x] Threat model public booking, OAuth secrets, payments, webhooks, tenant boundaries, spam, and enumeration.
- [x] Prototype DST-safe availability and concurrent slot holds.

Exit criteria:

- [x] Two concurrent requests for the last slot yield one confirmed hold and one capacity rejection.
- [x] Timezone test matrix covers DST gap/overlap and host/booker timezone differences.
- [x] Public/authenticated API boundaries and tenant ownership rules are documented and enforced by contract tests.

### Phase 1 - Native individual scheduler MVP (6-8 weeks)

Implementation status (2026-07-12): `Deployed; live booking lifecycle passed; physical client propagation pending`

Delivered:

- [x] Scheduler navigation after Notes, responsive app shell, onboarding, profile/handle, event-type CRUD, and reusable availability.
- [x] Reusable default availability independent of event types, multiple daily windows, week/month/day views, IANA timezone selection, date overrides, date-range blackouts, calendar-aware preview diagnostics, and inheritance by event types.
- [x] A system-managed 30-minute fallback booking flow when the owner has published default availability but has not created any custom event types.
- [x] User-friendly event settings grouped into Setup, Availability, Limits, and Advanced; fixed durations support every minute from 5 minutes through 24 hours, with independent start increments, buffers, notice, capacity, conflict calendars, and custom-hours opt-out.
- [x] Installer opt-in, component detection, deterministic configuration, Admin per-mailbox enable/disable control, audit events, and entitlement-aware navigation.
- [x] Native OMS calendar conflict checks and destination-calendar selection, including recurring busy events.
- [x] Public profile/event pages, timezone-aware slot selection, booking form, confirmation, expiring secure cancel, and expiring secure reschedule.
- [x] OMS email confirmations/cancellations/reschedules with ICS through a leased retrying outbox; native Calendar event projection writes the existing CalDAV/ActiveSync source tables.
- [x] Scheduler-specific sender identity defaults to the owner's named mailbox and can select only owned active aliases, including aliases on additional hosted domains; Reply-To remains the primary mailbox.
- [x] Booking list/detail and basic upcoming/past/canceled filters.
- [x] Lazy-loaded Scheduler management/public bundles and installer/Nginx routes with preferred-host and alias-aware TLS provisioning.

Exit criteria:

- [x] Disposable MariaDB lifecycle proves an enabled user can publish a 30-minute event and accept a booking without an external provider.
- [x] Installer guards prove disabled configuration omits Scheduler migrations and enabled installation begins with no entitled mailboxes; clean-VM execution remains a release gate.
- [x] Admin enable/disable, globally unique handles, generic public not-found behavior, and entitlement-aware authenticated access are implemented and guarded.
- [ ] Physical CalDAV/ActiveSync clients must confirm the projected booking after deployment; the disposable and live lifecycles prove create/update/delete, tombstone, capacity, and sync-token changes in the shared native store.
- [x] Disposable lifecycle proves reschedule updates the same calendar UID and cancel removes it, writes a tombstone, and releases capacity.
- [x] Playwright verified public booking and management layouts at 1440x900 and 390x844 with reachable primary actions, mobile More navigation, and no horizontal overflow.

Live upgrade deployment passed on `mail.housevo.us`: migrations `001` through `005` are recorded, the backend/frontend match the tested build, Nginx serves `/scheduler/` on both configured hostnames, and the staging smoke suite passes. A live create/reschedule/cancel cycle completed all three owned-sender notification jobs, received three Google SMTP acceptances and three local LMTP deliveries, preserved the Calendar UID on reschedule, deleted the projection on cancel, wrote a tombstone, released capacity, and restored the public slot. Physical macOS/Android/Thunderbird and CalDAV/ActiveSync observation remains pending. Clean-VM validation is intentionally deferred until a second development Linux server is available.

### Phase 2 - Complete personal parity (5-7 weeks)

Deliver:

- Multiple durations, locations, questions, confirmation, verification, guests, policies, limits, buffers, overrides, holidays, and out of office.
- Private, secret, single-use, expiring, and one-off links.
- Seats, waitlist, recurring bookings, meeting polls, no-show, and book-on-behalf.
- Embed variants, email slots, prefill, UTM tracking, customization, locale, and timezone lock.
- Import/export and a guided Calendly/Cal.com migration path where supported.

Implementation progress (2026-07-12):

- [x] Unlisted event types are hidden from the public profile directory while remaining bookable at their exact owner-copyable URL. Existing event types remain listed by default, and owner management labels unlisted events explicitly.
- [x] Private event links use 256-bit random bearer tokens stored only as SHA-256 hashes. Owners can generate, rotate, expire, and revoke links; tokens travel in URL fragments, move to tab-only storage, leave the address bar, and reach APIs only through a no-store request header.
- [x] Owners can make a private link single-use. Page views and failed bookings do not consume it; the first successful booking decrements the remaining-use counter inside the booking transaction. Two concurrent final-use attempts yield one booking, and the successful request can be replayed with its original idempotency key after consumption.
- [ ] One-off customized availability remains to complete the private-links capability.

Exit criteria:

- Every item in sections 3.1 and 3.2 has a passing acceptance test.
- Capacity, recurrence, expiry, active-booker limits, and approval races are covered by integration tests.

### Phase 3 - Durable workflows (4-6 weeks)

Deliver:

- Worker process, scheduler job queue, leases, retries, dead letters, outbox, and delivery observability.
- Workflow builder, versioning, time/event triggers, OMS email, webhook, in-app notification, variables, and test sends.
- Reminders, reconfirmation, follow-ups, feedback, cancellation, reschedule, and no-show automation.
- Administrator-provided SMS/WhatsApp adapter and explicit consent/unsubscribe handling.

Exit criteria:

- Worker restart, duplicate delivery, clock skew, and provider outage tests pass.
- Existing bookings keep the workflow version active when they were created unless an admin explicitly migrates them.

### Phase 4 - Teams and managed scheduling (6-9 weeks)

Deliver:

- Domain organizations, teams/sub-teams, Scheduler roles, delegated access, and audit coverage.
- Collective, group, round-robin, priority, weighted, fixed-host, host-choice, and dynamic group events.
- Managed event templates, bulk assignment, out-of-office delegation, and book-on-behalf.
- Assignment fairness and trace views.

Exit criteria:

- Host eligibility and permissions are enforced server-side across every mutation.
- Deterministic simulation verifies fairness, priority, weighting, fallbacks, and reassignment under concurrent load.

### Phase 5 - Routing and qualification (5-7 weeks)

Deliver:

- Routing form and rule builders, team attributes, fallbacks, external/custom actions, and headless API.
- Attribute/weighted routing, virtual queues, response retention, and explainable traces.
- CRM ownership adapter contract and first CRM integration.

Exit criteria:

- A rule cannot route outside its tenant or to an ineligible host.
- Trace output explains the result while respecting form-field privacy and retention policy.

### Phase 6 - Payments and integration framework (6-10 weeks)

Deliver:

- Integration administration, OAuth/token vault, health state, disconnect/revoke, and provider capability discovery.
- Stripe and PayPal, signed webhooks, reconciliation, refunds, receipts, and failure recovery.
- Google/Microsoft calendar and conferencing adapters, Zoom, generic CalDAV, and custom webhooks.
- Zapier/Make contract and first CRM/marketing adapters.

Exit criteria:

- Payment and OAuth threat-model checks pass.
- Provider failure never creates an untracked paid booking or exposes tokens.
- External-calendar conflicts and native-calendar projection reconcile after retries.

### Phase 7 - Analytics, API, embeds, and developer platform (5-8 weeks)

Deliver:

- Funnel, booking, team, host, routing, workflow, payment, and attribution analytics.
- Versioned REST/OpenAPI, OAuth 2.1/PKCE, scoped API keys, webhooks, idempotency, SDK examples, and deprecation policy.
- Production embed SDK and headless slots/booking/routing APIs.
- CLI and integration certification test kit.

Exit criteria:

- The first-party UI can operate only through documented APIs.
- Scope, pagination, rate-limit, idempotency, webhook signature, and tenant-isolation contract tests pass.

### Phase 8 - Enterprise control and operational readiness (6-10 weeks)

Deliver:

- Suite-wide SSO/SCIM integration, domain control, delegated calendar credentials, advanced roles, groups, and bulk lifecycle.
- Organization policies, custom SMTP, guest notification policy, audit export, deletion/export APIs, and retention.
- Backup/restore, disaster recovery, clean-VM install/upgrade/rollback, queue recovery, capacity tests, and administrator runbooks.
- Data-residency deployment options and compliance evidence mapping without unsupported certification claims.

Exit criteria:

- Cross-domain and role test matrices pass for UI and API.
- Recovery exercises prove bookings, jobs, payments, and calendar projections restore consistently.

### Phase 9 - Mobile, extensions, and agent parity (4-7 weeks)

Deliver:

- PWA/mobile scheduling actions, browser extension, email link/slot insertion, and share targets.
- OMS Scheduler MCP server and CLI expansion.
- Agent-safe availability, create, reschedule, cancel, event-type, and schedule operations.
- Optional provider-backed voice workflow with explicit cost, consent, recording, retention, and regional policy controls.

Exit criteria:

- Agent and extension clients use the same scoped API and audit model as every other integration.
- No agent can silently override confirmation, payment, tenant, or delegation policy.

### Phase 10 - Continuous parity and polish

Deliver continuously:

- Quarterly official-doc review of Calendly and Cal.com release notes, pricing feature tables, help indexes, and developer APIs.
- Capability register updates with source, date observed, OMS status, owner, test, and release.
- Performance, accessibility, localization, mobile, security, provider compatibility, and UX regression work.
- Compatibility fixtures for imported competitor data without depending on competitor availability at runtime.

## 6. Quality And Test Strategy

- Unit: availability math, timezone/DST, recurrence, capacity, assignment, routing, workflow variables, signatures, policies, and permissions.
- Property/fuzz: interval merging, recurrence bounds, routing expressions, malformed webhook/API input, and idempotency.
- Database integration: slot races, transactions, unique constraints, tenant scope, job leases, retries, and migrations.
- Contract: every provider adapter, API endpoint, OAuth scope, webhook schema, and embed event.
- End-to-end: host onboarding through guest booking, payment, reminder, reschedule/cancel, Calendar projection, and analytics.
- Protocol: confirmed bookings must remain correct through web Calendar, CalDAV, ActiveSync, ICS clients, and external calendar connectors.
- Security: CSRF, XSS, injection, SSRF, IDOR/tenant escape, enumeration, brute force, webhook replay, OAuth token leakage, payment replay, and export/deletion authorization.
- Accessibility: automated checks plus keyboard and screen-reader journeys for public booking and management.
- Performance targets: cached public page p95 under 500 ms, slot query p95 under 750 ms for a 31-day range, booking transaction p95 under 1.5 s excluding provider redirects, and zero oversold capacity in stress tests.
- Reliability targets: jobs are at-least-once with idempotent effects, no silent dead letters, reconciliation detects projection drift, and public booking degrades clearly when a provider is unavailable.

## 7. Release Gates

No phase is `Implemented` until:

- Source, migration, API schema, UI, tests, installer/deployment, admin controls, metrics, and user/admin documentation exist.
- Relevant local checks actually pass.
- Public and authenticated authorization paths are tested.
- Mobile, keyboard, loading, empty, error, offline/retry, and expired-link states are handled.
- Data migration and rollback are documented and exercised.
- Provider costs and required administrator credentials are disclosed before enablement.
- The capability register links the implementation to an acceptance test.

## 8. Confirmed Product Decisions

1. **Optional installation** - The interactive installer asks whether to install OMS Scheduler and persists the decision for deterministic reruns and upgrades.
2. **Administrator-controlled access** - Installation enables the server capability only. Authorized admins enable or disable Scheduler per mailbox; users cannot self-enable it.
3. **Public URL** - The public profile path is `/scheduler/<local-part>`, without the mailbox domain, on every configured OMS webmail hostname. Thus `thang@housevo.us` works at both `https://webmail.housevo.us/scheduler/thang` and `https://mail.housevo.us/scheduler/thang`. Direct event links append `/<event-slug>`.
4. **Preferred host and aliases** - Administrators choose the preferred public base URL used in generated links, while all allowlisted OMS aliases serve the same routes. Absolute URLs are never derived from an arbitrary request `Host` header.
5. **Handle safety** - Handles are unique per installation. Reserved/invalid names and duplicate local parts across domains require an admin-assigned alternate handle before enablement.
6. **Open-source scope** - Every OMS-owned Scheduler feature ships under the existing OMS AGPL license with no feature gates; only external provider usage can cost money.
7. **First calendar scope** - Phase 1 supports native OMS calendars first; Google, Microsoft, iCloud/generic CalDAV accounts arrive through the integration framework.
8. **Organization boundary** - One mail domain maps to one Scheduler organization by default, with superadmins able to combine or separate domains later.
9. **External services** - Administrators bring their own Stripe, PayPal, Twilio-compatible, conferencing, CRM, and translation credentials; all adapters are optional.
10. **Video meetings** - Begin with configurable/custom URLs and established conferencing providers; do not build a video conferencing engine as part of Scheduler parity.
11. **Telemetry** - Product analytics are first-party and opt-in/configurable by administrators; no OMS cloud dependency is required.

## 9. First Bounded Implementation Task

Phase 0 completed this bounded vertical slice:

> Implement and test the pure availability engine contract plus MariaDB slot holds for a single native OMS calendar and a fixed-duration event type. Prove DST behavior and prove that two concurrent attempts cannot confirm the same one-seat slot.

This highest-risk shared foundation is now proven. Phase 1 begins with persisted installation and mailbox entitlement state before adding navigation, event-type screens, or public booking routes.

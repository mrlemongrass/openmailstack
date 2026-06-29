# OpenMailStack Vision

**Mail server fluent in every protocol**
OpenMailStack speaks every standard mail protocol your users' clients already use, so no one in your fleet gets left behind. JMAP for new apps, IMAP for everything else. Storage, search, external directory and automated DNS are part of the same server, so what you install is one mail server, not a stack of services to glue together.

---

## First-class JMAP support

JMAP is the modern replacement for IMAP, designed around JSON over HTTP instead of the old line-based wire protocol. New mail appears the moment it arrives, every device stays in step, and the protocol is efficient enough to feel native to a mobile or web app. OpenMailStack supports every JMAP extension, so any compliant client gets the full feature set.

- **JMAP for Mail.**
- **JMAP for Sieve Scripts.**
- **JMAP over WebSocket.**
- **JMAP Blob Management.**
- **JMAP Quotas.**

*Example: `jmap-session.json`*
```json
{
  "using": ["urn:ietf:params:jmap:core", "urn:ietf:params:jmap:mail"],
  "methodCalls": [
    ["Email/changes", { "accountId": "u1", "sinceState": "42" }, "0"],
    ["Email/get", {
      "accountId": "u1",
      "#ids": { "resultOf": "0", "name": "Email/changes", "path": "/created" },
      "properties": ["subject", "from", "receivedAt"]
    }, "1"]
  ]
}
```

### JMAP Overview

JMAP (JSON Meta Application Protocol) is a modern, stateful protocol for synchronising mail, calendars, and contacts between a client and a server. It operates over HTTP and uses JSON as its data format, which makes it easy to implement across platforms. JMAP is designed to handle large volumes of data efficiently, offers a consistent interface across data types, and provides built-in push updates so that changes propagate to every connected device as soon as they occur.

#### Enabling JMAP
Accepting JMAP connections requires an HTTP listener defined on the NetworkListener object (found in the WebUI under Settings › Network › Listeners) with the protocol set to http. In most installations this listener is created automatically during setup, so no further action is required.

#### Accessing JMAP
Most JMAP clients discover the JMAP endpoint through the well-known resource at `/.well-known/jmap`, which returns the URL of the JMAP endpoint and other session details. The endpoint itself is served at `/jmap` and is the primary access point for client operations, including retrieving messages, managing mailboxes, and synchronising data.

#### Disabling JMAP
By default, JMAP access is available as soon as an HTTP listener is configured. Some deployments may need to restrict or disable it entirely for security, compliance, or policy reasons.

The most direct way to disable JMAP access server-wide is to add an HTTP access control rule that blocks any path under `/jmap`. This denies access to every JMAP endpoint regardless of per-user settings.

For finer control, JMAP access can be restricted on a per-user, per-group, or per-tenant basis by removing the relevant JMAP permissions from the account or entity, so that only authorised principals can use the service.

JMAP protocol behaviour is configured on the Jmap singleton (found in the WebUI under Settings › Network › JMAP › Limits, Settings › Network › JMAP › Push, Settings › Network › JMAP › WebSocket). The fields below influence request handling, upload quotas, and the size of responses returned by get, set, query, and changes methods.

#### Request limits
Request limits guard the JMAP server against resource exhaustion:
- **`maxConcurrentRequests`**: the number of concurrent requests a single user may have in flight. Default `30`.
- **`maxRequestSize`**: the maximum size of a single request, in bytes. Default `100000000`.
- **`maxMethodCalls`**: the maximum number of method calls that can be included in a single request. Default `24`.

#### Upload limits
Upload limits restrict how often and how much data users can upload:
- **`maxUploadSize`**: the maximum size of a single uploaded file, in bytes. Default `500000000`.
- **`maxConcurrentUploads`**: the number of concurrent uploads a single user may have in flight. Default `4`.
- **`uploadTtl`**: how long each uploaded file is kept in temporary storage before it is deleted. Default `"2h"`.
- **`maxUploadCount`**: the maximum number of files a user may upload within the quota window. Default `1000`.
- **`uploadQuota`**: the total aggregate size of uploaded files allowed per user within the quota window, in bytes. Default `500000000`.

#### Object limits
Object limits restrict the number of objects returned or modified by a single method call:
- **`getMaxResults`**: the maximum number of objects that can be fetched in a single method call. Default `500`.
- **`setMaxObjects`**: the maximum number of objects that can be modified in a single method call. Default `500`.
- **`queryMaxResults`**: the maximum number of results returned by a Query method. Default `5000`.
- **`changesMaxResults`**: the maximum number of change objects returned by a Changes method. Default `5000`.

### WebSockets

WebSockets, described in RFC 6455, allow clients to open a two-way communication channel with a web server. Unlike HTTP, which is unidirectional and requires a new connection for each request, a WebSocket maintains a full-duplex persistent connection in which data can flow in both directions.

#### JMAP over WebSocket
JMAP over WebSocket is a subprotocol described in RFC 8887 that runs the JMAP protocol over a WebSocket transport layer. It delivers higher throughput than JMAP over HTTP by keeping a single persistent connection open between the client and the server, removing the per-request overhead of setting up and authenticating a new HTTP request. Clients authenticate once when the connection is established; credentials remain in effect for the lifetime of the connection.

JMAP over WebSocket is enabled by default in OpenMailStack and is available to JMAP clients at `wss://mail.example.com`.

#### Configuration
WebSocket behaviour is controlled by the following fields on the Jmap singleton (found in the WebUI under Settings › Network › JMAP › Limits, Settings › Network › JMAP › Push, Settings › Network › JMAP › WebSocket):
- **`websocketTimeout`**: time after which an inactive WebSocket connection is closed. Default `"10m"`.
- **`websocketHeartbeat`**: interval between heartbeat packets sent to WebSocket clients. Default `"1m"`.
- **`websocketThrottle`**: time to wait before sending a batch of notifications to a WebSocket client. Default `"1s"`.

#### Conformed RFCs
- RFC 6455 - The WebSocket Protocol
- RFC 8307 - Well-Known URIs for the WebSocket Protocol
- RFC 8441 - Bootstrapping WebSockets with HTTP/2
- RFC 8887 - A JSON Meta Application Protocol (JMAP) Subprotocol for WebSocket

### Push notifications

Push notifications allow JMAP clients to receive updates almost immediately and stay in sync with data changes on the server. OpenMailStack supports two mechanisms:
- **Event source**: clients hold a long-lived HTTP connection open and receive notifications directly from the server over a `text/event-stream` channel.
- **Push subscriptions**: clients register an external push service URL with the server. Each state change produces an HTTP POST to that URL, and the push service is responsible for delivering the notification to the client.

Push and event-source settings are carried on the Jmap singleton (found in the WebUI under Settings › Network › JMAP › Limits, Settings › Network › JMAP › Push, Settings › Network › JMAP › WebSocket).

#### Push Subscriptions
JMAP clients activate push subscriptions by registering a push service URL with the server. Each notification is sent to that URL over HTTPS. For additional privacy, clients can enable web push encryption by supplying Elliptic Curve Diffie-Hellman (ECDH) public keys during registration.

The push subsystem is tuned through the following fields:
- **`pushThrottle`**: minimum time to wait between successive requests to the same push service. Default `"1s"`.
- **`pushMaxAttempts`**: maximum number of delivery attempts before a notification is discarded. Default `3`.
- **`pushAttemptWait`**: time to wait between delivery attempts. Default `"1m"`.
- **`pushRetryWait`**: time to wait between retries. Default `"1s"`.
- **`pushRequestTimeout`**: time after which a connection to the push service URL is considered timed out. Default `"10s"`.
- **`pushVerifyTimeout`**: time to wait for the push service to verify a new subscription. Default `"1m"`.

#### Event Source
JMAP clients that can hold transport connections open connect directly to OpenMailStack and receive push notifications through a `text/event-stream` resource, as described in the event source specification. This is a long-running HTTP request during which the server can append data to the response without terminating it.

The event source endpoint is listed in the JMAP Session resource object (`/.well-known/jmap`) and is available at `/jmap/eventsource/?types={types}&closeafter={closeafter}&ping={ping}`.

To avoid overwhelming the client, the server groups updates and delivers them at a configurable cadence controlled by `eventSourceThrottle`. Default `"1s"`.

#### Conformed RFCs
- RFC 5116 - An Interface and Algorithms for Authenticated Encryption (AEAD_AES_128_GCM)
- RFC 8030 - Generic Event Delivery Using HTTP Push
- RFC 8188 - Encrypted Content-Encoding for HTTP
- RFC 8291 - Message Encryption for Web Push

---

## IMAP and POP

**No client left behind.**
OpenMailStack ships full IMAP4rev2 with IMAP4rev1 fallback, plus a POP3 server for older devices, so an existing fleet keeps working without forcing a client migration. Per-account quotas show up directly in the client, and users can edit their own server-side filters through any ManageSieve client.

- IMAP4rev2 and IMAP4rev1 with dozens of supported extensions.
- IMAP QUOTA reporting per account.
- ManageSieve for user-managed server-side filters.
- POP3 with STLS and SASL for older devices.

---

## Automated DNS

**Hands-off DNS for every mail domain.**
DNS is the most common reason a mail deployment breaks, and the hardest one for a generalist administrator to debug. OpenMailStack can publish and maintain a domain's records directly against a managed zone, so the manual copy-and-paste step that breaks the most deployments goes away. Records reconcile on save, propagation is checked before a key is activated, and ACME DNS challenges run through the same automation.

- Direct integration with Cloudflare, Route 53, Google Cloud DNS, DigitalOcean, OVH and others.
- Dynamic DNS updates with TSIG or SIG(0) for self-hosted authoritative servers.
- Automatic publication of MX, SPF, DKIM, DMARC, TLSA and autoconfig records.

---

## Automated DKIM rotation

**DKIM keys, rotated on a schedule.**
Rotating DKIM signing keys on a schedule is recommended practice and easy to forget under operational pressure. OpenMailStack owns the full lifecycle: new keys are generated on schedule, published in DNS, activated only after propagation is observed, then retired and deleted on configurable timers.

- Per-domain rotation cadence.
- Selector templating with date and version variables.
- Emergency rotation on demand for suspected key compromise.

---

## ACME and TLS

**Certificates that renew themselves.** (We currently do this via a weekly cronjob)
Expired TLS certificates are a routine cause of avoidable outages. OpenMailStack implements ACME directly so renewals run well before expiry, every supported challenge type is available, and TLSA records are refreshed alongside the new certificate so DANE keeps validating without a second tool in the loop.

- Every supported ACME challenge type.
- External Account Binding for CAs that require it.
- On-demand renewal triggered after a DNS update.
- Automatic TLSA refresh after each rotation.

---

## Autoconfig and Autodiscover

Helpdesk tickets that begin "I can't get my email set up" disappear when a client can fetch its own settings from the server. Pointing a mail client at a OpenMailStack server returns IMAP, POP, SMTP, CalDAV and CardDAV settings without the user typing a host name. The modern UA Autoconfig discovery is served alongside the legacy Mozilla Autoconfig and Microsoft Autodiscover v1 and v2 formats, so old and new clients are both covered.

- Modern UA Autoconfig discovery.
- Mozilla Autoconfig for older Thunderbird-based clients.
- Microsoft Autodiscover v1 and v2 for Outlook and Exchange clients.

---

## Multi-tenancy and quotas

**Multi-tenant from the ground up.**
OpenMailStack was built for multi-tenancy from the start, so hosting many organisations on the same deployment stays safe by design. Accounts, domains and tenants are fully isolated; disk quotas are enforced per user and per tenant; aliases and catch-all addresses can be enabled, disabled or annotated; and a whole domain can be redirected onto another without touching the mailboxes underneath.

- Multi-tenant by design, with per-tenant administrators and quotas.
- Domain aliases (one domain pointing at another).
- Email aliases with descriptions; the alias mechanism can be disabled per account.
- Plus-addressing, sub-addressing, catch-all and mailing-list expansion.
- Disk quotas per user and per tenant.

---

## Sieve scripting

**Filter, route and rewrite without leaving the server.** (We sort of have this completed)
Mail rules belong on the server, where they apply to every device a user opens. OpenMailStack includes a full Sieve interpreter with every registered extension. User scripts run sandboxed and are managed through any standard ManageSieve client or JMAP; administrators run trusted scripts at SMTP stages with elevated permissions.

- Every IANA-registered Sieve extension.
- ManageSieve and JMAP for Sieve Scripts management.
- Trusted and untrusted execution contexts.

---

## Web admin

**Manage everything from a browser.**
Day-to-day administration happens in a browser, not in a config file or an SSH session. Account, domain, group and mailing-list management; SMTP queue and report visualisation; configuration of every server object; a log viewer with search; and a self-service portal for password reset and encryption-at-rest key management, all in one console.

- Real-time dashboards and live tracing.
- Account, domain, group, list and Sieve management.
- Queue and report visualisation for DMARC, TLS-RPT and ARF.
- Configuration of every server object from a single web admin.

---

## Migration Engine

**Seamless transition from legacy systems.**
We know that the biggest barrier to adopting a new mail server is the fear of losing data or disrupting operations during the transition. OpenMailStack will feature a built-in, painless Migration Engine designed to confidently migrate existing mail servers, accounts, messages, calendars, and contacts with zero data loss.

- Live, continuous synchronization from external IMAP/CalDAV/CardDAV servers.
- Simple, wizard-driven web interface for configuring source credentials and mapping domains.
- Background task processing for bulk migrations without impacting active server performance.
- Automated health checks and verification to ensure full data fidelity before cutting over DNS.

---

## Complete Features Matrix

Here is the comprehensive matrix of features we foresee OpenMailStack delivering, categorized by functional area:

### Message Store
- JMAP for Mail
- JMAP for Sieve
- JMAP WebSocket transport
- JMAP Blob Management
- JMAP Quotas
- JMAP Sharing
- IMAP4rev1
- IMAP4rev2
- IMAP QUOTA Extension
- ManageSieve
- POP3 with STLS and SASL
- Sub-addressing and catch-all
- Email aliases and mailing lists
- Email alias descriptions and disable flag
- Domain aliases
- Disk quotas per user and per tenant
- Auto-configuration and Autodiscover
- Masked email addresses (privacy aliases)

### MTA
- SMTP server with programmable rules
- Distributed virtual queues
- Delayed and priority delivery, quotas, routing rules, throttling
- Smart-host and relay routing
- Rate and concurrency limiting
- Envelope rewriting and message modification
- Milter integration
- MTA Hooks (HTTP filter alternative)
- Outbound MTA cluster role

### Sender Authentication and Transport Security
- DKIM
- SPF
- DMARC
- ARC, inbound verification only
- DANE
- MTA-STS
- SMTP TLS Reporting
- Automated DKIM key generation and rotation
- Automated DNS management
- ACME challenges (TLS-ALPN-01, DNS-01, HTTP-01, DNS-PERSIST-01, EAB)
- Automatic TLSA record refresh on certificate renewal

### Anti-Spam and Anti-Phishing
- Spam filtering rules
- Statistical classifier (FTRL-Proximal)
- Encryption-at-rest for spam training data
- DNSBL (IP, domain, hash)
- Pyzor collaborative digest filtering
- Phishing protection (homograph URL attacks, sender spoofing)
- Trusted reply tracking
- Sender reputation (IP, ASN, domain, address)
- Greylisting
- Spam traps
- ASN and GeoIP blocking, auto-banning
- AI / LLM spam classifier

### Collaboration
- CalDAV
- CalDAV Scheduling
- iMIP email notifications
- Free/busy lookup
- Recurrence expansion (RRULE)
- Calendar event email notifications via VALARM
- CardDAV with vCard 2.1/3.0
- WebDAV
- WebDAV ACL
- JMAP for Calendars
- JMAP for Contacts
- JMAP for File Storage
- Auto-configuration for CalDAV, CardDAV, WebDAV
- Calendar localized invite templates and scheduling locales
- Branded scheduling and notification emails

### Sieve and Scripting
- Sieve scripting with all IANA-registered extensions
- ManageSieve
- JMAP for Sieve Scripts
- Sieve script deactivation without deletion
- MTA Hooks for Sieve-style upstream filters
- AI / LLM Sieve scripting

### Storage Backends
- RocksDB
- FoundationDB
- PostgreSQL / AlloyDB
- MySQL / MariaDB
- SQLite
- S3-compatible blob storage
- Azure Blob Storage
- Filesystem blob storage
- Redis (in-memory store)
- Read replicas
- Sharded blob storage
- Sharded in-memory data stores

### Full-Text Search
- Internal FTS backend
- Meilisearch
- ElasticSearch / OpenSearch
- PostgreSQL
- MySQL

### Authentication
- Internal directory
- LDAP / Active Directory
- SQL directory
- OAuth 2.0 (device flow and PKCE)
- OpenID Connect
- Third-party OIDC providers
- Two-factor authentication (TOTP)
- App passwords with labels, IP restrictions and expiration
- API keys with labels, IP restrictions and expiration
- Per-domain directory backends

### Security and Encryption
- Encryption at rest (S/MIME, OpenPGP)
- Self-service portal for password reset and encryption key management
- Roles, permissions and ACLs
- Password strength enforcement (zxcvbn) and rotation policies
- IP restrictions on accounts, app passwords and API keys
- Auto-banning with comments and configurable expiration
- Rate limiting
- Memory-safe (Rust)
- Independent security audit

### Cluster and HA
- Cluster coordination (Zenoh peer-to-peer, Kafka, Redpanda, NATS, Redis)
- Automatic node ID generation and management
- Outbound MTA cluster role
- Fault tolerance and high availability
- PROXY protocol
- Kubernetes, Apache Mesos, Docker Swarm

### Observability and Administration
- Logging and tracing (OpenTelemetry, journald, files, console)
- Metrics (OpenTelemetry, Prometheus) Limited
- Webhooks
- Web admin
- Report visualization (DMARC, TLS-RPT, ARF)
- Declarative IaC
- Live telemetry streaming (SSE)
- Message delivery history
- Dashboard with real-time statistics
- Metric alerts (email and webhook)

### Enterprise Additions
- Multi-tenancy with per-tenant quotas and isolation
- Per-domain directory backends
- Branding and customisation
- Multi-tenant branding
- Account archiving and un-deletion
- Restore deleted emails with metadata
- AI / LLM spam classifier
- AI / LLM Sieve scripting
- Read replicas, sharded blob and in-memory stores

### Migration Engine
- Live, continuous synchronization from IMAP/CalDAV/CardDAV servers
- Wizard-driven migration configuration interface
- Bulk migration task processing
- Data fidelity verification and health checks

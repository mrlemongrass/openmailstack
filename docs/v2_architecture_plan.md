# OpenMailStack v2: Architecture Plan

## 1. Executive Summary

OpenMailStack v1 successfully proved that we can provide a beautiful, cohesive management and webmail layer over traditional open-source mail components (Postfix, Dovecot, Rspamd). However, to fulfill the ultimate vision—**"one mail server, not a stack of services to glue together"**—we must transition from a *configuration manager* to a **Unified Mail Platform**. 

**OpenMailStack v2** will be a ground-up rewrite of the core data plane and protocols. It replaces the fragile IPC and complex configuration generation of a multi-daemon stack with a single, highly performant, memory-safe binary (written in **Rust**). The internal data model will be **JMAP-native**, treating legacy protocols (IMAP/POP) as edge translation layers.

---

## 2. Core Architecture Principles

1.  **Single Binary (The Monolith-to-Cluster Model):** A single executable manages SMTP, IMAP, JMAP, CalDAV, ACME, and the Web Admin API. It can run as a standalone monolith on a single VPS or scale horizontally in a cluster using Zenoh/NATS for peer discovery.
2.  **Memory Safety & Concurrency:** Built in **Rust** using `tokio` for async I/O. This eliminates entire classes of buffer overflow vulnerabilities historically prevalent in C-based MTAs and IMAP servers, while handling thousands of concurrent JMAP WebSockets and IMAP idle connections efficiently.
3.  **JMAP-Native Data Model:** The internal representation of accounts, mailboxes, and emails directly maps to JMAP Core and Mail RFCs.
4.  **Pluggable Storage Abstraction:** 
    *   **Metadata Store:** RocksDB (for single-node high performance) or PostgreSQL/AlloyDB (for clustered environments).
    *   **Blob Store (Message Bodies/Attachments):** Local filesystem or S3-compatible object storage.
    *   **Full-Text Search (FTS):** Internal inverted index (Tantivy/Rust) or external (Meilisearch/ElasticSearch).
5.  **Built-in Automation:** DNS management, ACME certificate renewal, and DKIM rotation are not external cronjobs; they are deeply integrated state-machines within the core daemon.

---

## 3. System Components & Data Flow

### 3.1. The Edge / Transport Layer
The server listens on standard ports directly. All TLS termination happens internally using native Rust TLS libraries (e.g., `rustls`), automatically utilizing the certificates managed by the internal ACME subsystem.
*   **HTTP/HTTPS (80/443):** Serves the Web Admin, JMAP API, JMAP WebSockets, CalDAV/CardDAV/WebDAV, and ACME HTTP-01 challenges.
*   **SMTP (25/587/465):** Inbound unauthenticated routing and outbound authenticated submission.
*   **IMAP/POP (143/993/110/995):** Legacy client access.

### 3.2. Protocol Translators & API
*   **JMAP Engine:** The primary interface to the data store. Validates JSON payloads, enforces quotas, and handles WebSocket push events.
*   **IMAP4rev2 / POP3 Bridges:** Rust-based state machines that parse IMAP commands and translate them directly into internal JMAP-equivalent RPC calls. This guarantees 100% feature parity between JMAP and IMAP without maintaining two separate database schemas.

### 3.3. The MTA & Routing Engine
Replacing Postfix and ManageSieve.
*   **Virtual Queues:** Inbound messages are written to durable storage (RocksDB/Kafka) immediately.
*   **Rules Engine:** A Rust-based Sieve compiler and execution engine. Every message passes through tenant-level and user-level Sieve scripts before delivery to the Blob Store.
*   **Anti-Spam Pipeline:** An integrated pipeline replacing the complex Postfix->Milter->Rspamd glue. Fast-path checks (SPF, DKIM, DMARC, DNSBL) are done natively. Complex checks (Statistical classifier, LLM APIs) run asynchronously before the message is committed to the inbox.

### 3.4. Collaboration & Directory
*   **CalDAV / CardDAV:** Handled via the HTTP edge, translating iCalendar/vCard data to internal JMAP Calendar/Contact models.
*   **Directory Services:** Internal SQL/RocksDB directory by default, with traits/interfaces allowing pluggable LDAP/OIDC backends for Enterprise SSO.

---

## 4. Cluster & High Availability (HA)

To support the "Enterprise Additions" (Multi-tenancy, Read Replicas, Sharded Blobs):
*   **Coordination:** `Zenoh` or `NATS` embedded for real-time node discovery, cache invalidation, and distributed lock management.
*   **Outbound MTA Cluster Role:** Specific nodes can be tagged as "Outbound Relays," consuming from the distributed virtual queue to handle outbound IP reputation and throttling, while storage nodes handle client connections.

---

## 5. The Migration Engine (v1 to v2)

The Migration Engine is a first-class subsystem to bridge users from legacy systems (or OpenMailStack v1) to v2.
1.  **Sync Workers:** Background Tokio tasks that connect to external IMAP/CalDAV endpoints.
2.  **State Tracking:** Maintains a mapping of external UIDs to internal JMAP IDs.
3.  **Continuous Ingestion:** Uses IMAP `IDLE` or frequent polling to continuously stream changes into the v2 Storage Engine without impacting the live v1 server.
4.  **Cut-over Verification:** A wizard in the v2 Web Admin verifies DNS propagation and data fidelity before finalizing the migration.

---

## 6. Implementation Phases (The Roadmap to v2)

**Phase 1: Foundation & JMAP Core (The Data Plane)**
*   Initialize the Rust workspace (`openmailstack-core`).
*   Implement the Metadata (PostgreSQL/RocksDB) and Blob (Filesystem/S3) storage traits.
*   Implement the JMAP Core and JMAP Mail RFCs over HTTP.
*   *Milestone:* A headless JMAP server capable of storing and retrieving emails via API.

**Phase 2: The Edge & Legacy Protocols**
*   Implement `rustls` integration and automated ACME certificate management.
*   Build the IMAP4rev2 bridge translating to the JMAP core.
*   *Milestone:* Standard email clients (Thunderbird/Apple Mail) can read mail via IMAP.

**Phase 3: The MTA & Delivery (The Control Plane)**
*   Implement the SMTP receiver (Port 25) and Submission (Port 587).
*   Implement the Sieve execution engine for routing.
*   Implement DKIM signing, SPF validation, and basic DNSBL checks.
*   *Milestone:* The server can receive mail from the internet and clients can send mail outbound.

**Phase 4: Migration, Collaboration, & Polish**
*   Build the IMAP/CalDAV Migration Engine workers.
*   Implement CalDAV/CardDAV bridges.
*   Port the existing React Web Admin to consume the new unified v2 API.
*   *Milestone:* OpenMailStack v2 Beta Release ready for production testing.

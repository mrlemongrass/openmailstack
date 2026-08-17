# ActiveSync Ping research and OMS implementation contract

Date: 2026-08-16
Source baseline: `e8b87463829ef734f8ca6e7fdfd56aa4b6d6a660`

This note separates normative Microsoft Open Specifications requirements, documented Microsoft/Apple product behavior, and OMS implementation recommendations. Research used the current published [MS-ASCMD revision 28.0 (2025-05-20)](https://learn.microsoft.com/en-us/openspecs/exchange_server_protocols/ms-ascmd/1a3490f1-afe1-418a-aa92-6f630036d65a) and first-party product documentation only.

## Decision summary

At the baseline above, OMS is correct to fail closed: `Ping` is neither advertised nor reachable, and an authenticated, parseable Ping request returns HTTP 501. The old handler below the unsupported-command guard is dead code and is not a usable implementation. Do not advertise `Ping` until all of the following are true:

1. The complete request/cache/status contract below is implemented and bounded.
2. Change detection is tied to the authenticated user's current FolderSync inventory and the last Sync response returned to that device.
3. Every waiter releases timers, listeners, and backend resources on response, cancellation, timeout, and disconnect.
4. Protocol tests and a physical iPhone/iPad Direct Push test pass through the production proxy path.

## Normative wire contract

Ping is an HTTP POST command whose URI identifies `Cmd=Ping`, `User`, `DeviceId`, and `DeviceType`; a non-empty body is WBXML. With the plain-text query used by OMS, `MS-ASProtocolVersion` and the applicable authentication header are required. See [MS-ASHTTP request line](https://learn.microsoft.com/en-us/openspecs/exchange_server_protocols/ms-ashttp/abb5236f-9e5c-42aa-9c07-e49bb0a53f97) and [request headers](https://learn.microsoft.com/en-us/openspecs/exchange_server_protocols/ms-ashttp/56b73a17-131b-4984-ad93-f08188dc2332).

For that plain-text query form, `User` and `DeviceType` are each one or more visible ASCII characters; the protocol does not impose the compact-query form's one-byte length field on `DeviceType`. OMS bounds `User` to 320 bytes, canonicalizes it with the same mailbox normalization used for Basic authentication, and keeps the authenticated identity authoritative. A syntactically valid query identity that does not match the authenticated mailbox receives common status 130 without probing either identity. OMS advertises and accepts protocol versions 14.0 and 14.1. Recognized pre-14 versions receive HTTP 400 because Ping/common-status semantics are unavailable; recognized unsupported 16.x versions receive common status 138 after authentication.

### Request

The WBXML document uses [code page 13](https://learn.microsoft.com/en-us/openspecs/exchange_server_protocols/ms-aswbxml/30281619-a8c2-4dfb-9f10-8c59dda83e6f): `Ping` `0x05`, `Status` `0x07`, `HeartbeatInterval` `0x08`, `Folders` `0x09`, `Folder` `0x0A`, `Id` `0x0B`, `Class` `0x0C`, and `MaxFolders` `0x0D`.

```xml
<Ping xmlns="Ping">
  <HeartbeatInterval>900</HeartbeatInterval>
  <Folders>
    <Folder><Id>folder-server-id</Id><Class>Email</Class></Folder>
  </Folders>
</Ping>
```

The [request schema](https://learn.microsoft.com/en-us/openspecs/exchange_server_protocols/ms-ascmd/e7d8c2d9-d777-4792-8409-b911c2f06e14) requires:

- A body, when present, has one page-13 `Ping` root. It contains `HeartbeatInterval`, `Folders`, or both; neither may repeat. The schema uses `xs:all`, so those two children may arrive in either order.
- `HeartbeatInterval` is an integer number of seconds. Its valid range is server-defined.
- `Folders`, when present, contains one or more `Folder` elements. Each has exactly one `Id` and one `Class`, in either order.
- `Id` is the `ServerId` issued by FolderSync, is at most 64 characters, and cannot be duplicated in one Ping request; duplicates require status 4. See [Id](https://learn.microsoft.com/en-us/openspecs/exchange_server_protocols/ms-ascmd/d59567cc-3198-4449-9b13-ca553fd9ad70).
- The [Class](https://learn.microsoft.com/en-us/openspecs/exchange_server_protocols/ms-ascmd/dac80155-d034-4f33-a91e-89026cc81def) enum is `Email`, `Calendar`, `Contacts`, `Tasks`, or `Notes` (`Notes` is invalid before protocol 14.0).

The first Ping from a device for a user must include both heartbeat and folders. The server caches both. Later requests may replace either value while reusing the other, or send no body to reuse both. An empty request without a complete cache receives status 3. These rules come from [monitoring folders for new items](https://learn.microsoft.com/en-us/openspecs/exchange_server_protocols/ms-ascmd/c3f11161-2c46-4f7c-a645-6a808bde92e9) and [HeartbeatInterval](https://learn.microsoft.com/en-us/openspecs/exchange_server_protocols/ms-ascmd/3fa88a42-b013-4e37-96cb-db8273dbd243). As an OMS atomicity requirement, invalid input must not partially update the cache.

For a bodyless request, `Content-Type` should be absent. For a WBXML request at OMS's supported 14.0/14.1 versions it must be `application/vnd.ms-sync.wbxml` or `application/vnd.ms-sync`; see [MS-ASHTTP Content-Type](https://learn.microsoft.com/en-us/openspecs/exchange_server_protocols/ms-ashttp/f1dda4f4-5a06-4761-8ae6-38189eb649a8).

### Response

The [response schema](https://learn.microsoft.com/en-us/openspecs/exchange_server_protocols/ms-ascmd/2de99a15-b056-40dc-a64d-b480601a5e57) is ordered: required `Status`, then optional `Folders`, optional `MaxFolders`, optional `HeartbeatInterval`. A status-2 `Folders` container holds only the changed folder IDs as string-valued `Folder` elements; it does not echo `Class`.

A Ping command response is therefore not an empty HTTP response: it contains at least `Ping/Status` WBXML. Return HTTP 200 with `Content-Type: application/vnd.ms-sync.wbxml` and a correct `Content-Length`. MS-ASHTTP permits a reduced header set on HTTP 200 for protocol 12.1 and later, but still requires `Content-Type` when the response has a body; see [response headers](https://learn.microsoft.com/en-us/openspecs/exchange_server_protocols/ms-ashttp/08ad30b6-5b73-41bc-890b-1cab2cf49827).

### Ping statuses 1-8

The authoritative meanings and client actions are in [Status (Ping)](https://learn.microsoft.com/en-us/openspecs/exchange_server_protocols/ms-ascmd/cec19b0e-b7f9-4967-9569-39c73746efc4).

| Status | Meaning | Required follow-up |
| --- | --- | --- |
| 1 | Heartbeat expired with no reportable additions | Client reissues Ping. |
| 2 | One or more monitored folders changed | Response lists IDs; client Syncs each, then reissues Ping. |
| 3 | Required parameters and a usable cached full request are missing | Client resends the full heartbeat and folder list. |
| 4 | Ping syntax/WBXML shape is invalid | Client corrects the request. Duplicate IDs are explicitly status 4. |
| 5 | Heartbeat is outside the server range | Response includes the nearest allowed `HeartbeatInterval`; client retries with an in-range value. |
| 6 | Folder count exceeds the server limit | Response includes `MaxFolders`; client retries with fewer folders. |
| 7 | Folder hierarchy is stale | Client runs FolderSync, chooses current folders, and reissues Ping. |
| 8 | Server error, commonly transient | Client retries Ping. |

Use HTTP errors for the HTTP/auth/service boundary and Ping statuses for an authenticated Ping command: 401 for missing/refused authentication, 403 if EAS is disabled for the user, 501 while Ping is unsupported, and 503 for dependency outage, queue saturation, or throttling. Missing, malformed, or recognized pre-14 protocol-version headers receive HTTP 400 because Ping negotiation/common-status semantics were not established. Once an identifiable 14.x-or-newer request is authenticated, use the [common command statuses](https://learn.microsoft.com/en-us/openspecs/exchange_server_protocols/ms-ascmd/95cb9d7c-d33d-4b94-9366-d59911c7a060): 101 for unsupported request media, 102 for undecodable WBXML, 103 for a decoded document with no XML root, 108 for invalid `DeviceId`, 109 for invalid `DeviceType`, 130 for a query `User` that differs from the authenticated mailbox, and 138 for a recognized unsupported 16.x protocol version. A recognized but Ping-schema-invalid document receives Ping status 4. The [MS-ASHTTP status table](https://learn.microsoft.com/en-us/openspecs/exchange_server_protocols/ms-ashttp/e092c310-7609-4a38-90cc-10688f79cf8d) defines the remaining transport codes. For 503, clients should honor `Retry-After`, or otherwise delay and exponentially back off; see [HTTP Error 503](https://learn.microsoft.com/en-us/openspecs/exchange_server_protocols/ms-ashttp/7eff4bdd-9736-47a8-bbdf-16b8f2a754ac).

## Wait, change, and retry semantics

The server should hold the request until the heartbeat expires or an item is added to a monitored collection. An addition includes delivery, copy-in, or move-in. It should not return early for modification, deletion, or move-out. This distinction is normative guidance in [MS-ASCMD section 3.1.5.8](https://learn.microsoft.com/en-us/openspecs/exchange_server_protocols/ms-ascmd/c3f11161-2c46-4f7c-a645-6a808bde92e9), even though Microsoft's higher-level Direct Push overview uses broader “new or changed” wording.

Ping evaluates changes against the last SyncKey returned to the client. The client must have received and applied its last Sync response before issuing Ping. Microsoft also documents that Ping acts as acknowledgment of the prior Sync response in [its missing-items analysis](https://learn.microsoft.com/en-us/troubleshoot/exchange/administration/items-missing-on-exchange-activesync-client). Implementation consequences:

- Ping must never advance or replace Sync state.
- Ping must not invent a baseline for a monitored folder with no device Sync checkpoint. As an OMS recovery rule, report that folder in status 2 so the client establishes state with Sync.
- A pending addition stays reportable until that device successfully Syncs the folder. If a status-2 response is lost and Ping is retried, return status 2 again rather than acknowledging the item on Ping alone.
- Status 1 loops directly back to Ping. Status 2 loops through Sync for every returned folder and only then back to Ping. Status 7 loops through FolderSync first.
- Preserve request order when rendering changed folder IDs so retries are deterministic; this is an OMS recommendation, not a protocol requirement.

## Folder identity and class contract for OMS

Ping must resolve folders from the same authenticated inventory emitted by FolderSync, never by decoding or trusting client-supplied paths:

| OMS FolderSync ID | Ping class | Current support |
| --- | --- | --- |
| `m-` plus 62 lowercase hex characters | `Email` | Supported |
| `cal-` plus a positive decimal calendar ID | `Calendar` | Supported |
| `contacts` | `Contacts` | Supported |
| Any task or note identity | `Tasks` / `Notes` | Not currently emitted or Sync-supported |

A well-formed ID absent from the current authenticated inventory means the hierarchy is stale and should produce status 7. A duplicate ID, invalid ID, unknown class, or class that contradicts the current FolderSync object should produce status 4. Do not accept `Tasks` or `Notes` merely because they are valid protocol class strings; OMS must first implement and advertise corresponding FolderSync and Sync collections.

Use the normalized authenticated mailbox identity, not the query-string `User`, as the authority. Cache Ping configuration by `(authenticated user, validated DeviceId)`. Validate `DeviceId` with the same bounded canonical validator used by Sync. Multiple devices for one user must have isolated caches and waiters.

Microsoft specifies per-user/device caching but does not prescribe arbitration for overlapping live Ping requests. OMS should allow at most one active waiter per `(user, DeviceId)`: a newer valid Ping atomically replaces the cached configuration and cleanly cancels/supersedes the older waiter. Use a generation token so completion from an old request cannot answer or mutate the new request. Apply a separate per-user and server-wide connection budget. For scale reference only, Exchange's documented [`EASMaxConcurrency`](https://learn.microsoft.com/en-us/powershell/module/exchangepowershell/new-throttlingpolicy?view=exchange-ps) defaults to 10 per user; that is Microsoft product behavior, not an EAS requirement.

## Heartbeat, proxy, and iOS interoperability

The protocol defines no default heartbeat: the first request supplies it, and valid bounds are implementation-specific. Microsoft Exchange 2007 SP1/2013/2016/2019 document default bounds of 60-900 seconds, configurable down to 1 second but never above 900; see [MS-ASCMD product behavior](https://learn.microsoft.com/en-us/openspecs/exchange_server_protocols/ms-ascmd/26b48eb3-6a22-4509-8cc8-f934305f369c). OMS should initially use explicit 60-900 second bounds, with no silent fallback or truncation. Out-of-range input receives status 5 and the nearest boundary.

Do not cap a requested heartbeat to fit a proxy timeout. Configure every reverse proxy/load balancer timeout above the server maximum, including cleanup margin. Microsoft's [Direct Push guidance](https://learn.microsoft.com/en-us/exchange/direct-push-exchange-2013-help) describes adaptive client heartbeats, a 15-minute Exchange heartbeat, and a recommended 30-minute firewall timeout.

[Apple's deployment guide](https://support.apple.com/en-ie/guide/deployment/dep158966b23/web) confirms that iPhone and iPad use EAS Direct Push for email, tasks, contacts, and calendars, but Apple does not publish the complete Ping wire behavior or fixed heartbeat values. Therefore passing scripted WBXML tests is necessary but not sufficient: release requires a physical iOS device to prove idle status-1 renewal, new-mail status-2 wakeup and Sync, Wi-Fi/cellular transition, sleep/wake, and recovery after proxy or service interruption. OMS currently supports only Email, Calendar, and Contacts in this flow.

## Resource and privacy requirements

- Add a Ping-specific body limit derived from `MaxFolders`; do not inherit the route-wide 16 MiB allowance. Reject before parsing or caching.
- Configure a finite `MaxFolders` and return that exact value with status 6. The protocol leaves the maximum implementation-specific; Microsoft's examples are not normative defaults.
- Bound cache entry size, cache lifetime, partnerships per user, active waiters per user, and active waiters server-wide. Expired cache followed by an empty request returns status 3.
- Prefer a shared mailbox-event/IDLE fan-out or a bounded polling service. Do not hold a dedicated authenticated IMAP connection for every long-lived Ping.
- On request abort, response close, supersession, service shutdown, or any error, promptly and idempotently unregister listeners, clear timers, abort backend work, and release concurrency slots. Microsoft has documented [stranded Ping requests causing memory, connection, and port exhaustion](https://learn.microsoft.com/en-us/troubleshoot/exchange/client-connectivity/activesync-clients-not-connect-sync-delay).
- Log only bounded structural data: command, body size, status, wait duration, folder count, and coarse reason. Never log credentials, WBXML values, usernames, DeviceIds, folder IDs, paths, or cached request bodies.
- Use monotonic elapsed time/fake-clock injection for waits; wall-clock changes must not extend a request indefinitely.

## Current OMS audit at the baseline

- [`eas-protocol.ts`](../../webmail-backend/src/eas-protocol.ts#L4) caps the entire ActiveSync request at 16 MiB, advertises only Sync/FolderSync/ItemOperations/SendMail, and explicitly marks Ping unsupported.
- [`index.ts`](../../webmail-backend/src/index.ts#L374) authenticates before structural logging and returns 501 at the unsupported-command guard. The later legacy Ping branch is unreachable. If made reachable, it would default to 60 seconds, parse with permissive `parseInt`, silently cap at 55 seconds, ignore folders and caches, never detect changes, always return status 1, and leave its timer alive after disconnect.
- [`codepages.ts`](../../webmail-backend/src/wbxml/codepages.ts#L264) already has the correct page-13 tokens.
- [`parser.ts`](../../webmail-backend/src/wbxml/parser.ts#L11) bounds nesting, elements, tokens, and inline content, but Ping still needs command-specific schema/cardinality/value validation and a much smaller body budget.
- FolderSync in [`index.ts`](../../webmail-backend/src/index.ts#L446) emits opaque mail IDs, `contacts`, and visible `cal-*` IDs. [`eas-protocol.ts`](../../webmail-backend/src/eas-protocol.ts#L117) contains the authenticated-inventory mail resolver that Ping should reuse.
- Sync already validates DeviceId and scopes mail/PIM state by authenticated username, device, and collection. Ping must read those checkpoints without changing them.
- [`eas-protocol-hardening.test.cjs`](../../webmail-backend/test/eas-protocol-hardening.test.cjs#L68) correctly enforces the current fail-closed, non-advertised posture.

## Minimum verification before advertising Ping

1. **Parser/status matrix:** exact integer parsing; flexible `xs:all` order; wrong page/root; duplicates; missing/extra children; overlong IDs; invalid class; statuses 3-8 and required companion elements.
2. **WBXML bytes:** request and response round trips on page 13; status-2 folder strings only; status-5 heartbeat and status-6 MaxFolders ordering; non-empty response headers.
3. **Cache:** initial full request, heartbeat-only update, folders-only update, empty reuse, missing/expired cache, invalid-update atomicity, cross-user and cross-device isolation.
4. **Folder boundary:** exact FolderSync inventory, mail opaque IDs, calendar/contact IDs, class mismatch, duplicate IDs, deleted/unknown folder status 7, unsupported Tasks/Notes, and no client path decoding.
5. **Wait engine:** deterministic fake-clock status 1; delivery/copy-in/move-in status 2; no early response for modify/delete/move-out; repeated status 2 until Sync advances; multiple changed folders.
6. **Concurrency/cleanup:** same-device supersession, two-device isolation, per-user/server caps, disconnect/abort/shutdown, no leaked timer/listener/backend connection, and stale-generation completion suppression.
7. **HTTP boundary:** missing/bad auth 401, malformed envelope 400, unsupported 501 before release, dependency/throttle 503 with `Retry-After`, recognized Ping failures as HTTP-200 statuses, and privacy-safe logs.
8. **Integration:** FolderSync -> initial Sync -> Ping status 1; inject mail/calendar/contact addition -> Ping status 2 -> Sync retrieves it -> next Ping status 1. Run through the real reverse proxy at maximum heartbeat.
9. **Physical iOS:** prove Direct Push while idle and across sleep, network transition, reconnect, and service restart. Keep this a distinct release gate from scripted protocol success.

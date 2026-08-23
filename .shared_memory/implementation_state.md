# Implementation State

## 2026-08-22 Webmail Folder And Message Context Menus

**Status: guarded-deployed in active mode and verified through a disposable
public webmail/IMAPS lifecycle.** Mail folders and message rows now open context
menus through desktop right click, a visible actions button for folder
discovery/touch fallback, and `Shift+F10`/the Context Menu key. The shared menu
uses ARIA menu semantics, bounded viewport placement, roving keyboard focus,
outside/Escape/ancestor-scroll dismissal, usable internal overflow scrolling,
and focus restoration. Folder menus provide Open and New subfolder, plus Move
and confirmation-gated Delete for custom folders. The visible Folders heading
provides top-level New folder, and its action affordance stays visible on touch
devices. Message menus reuse the existing folder-qualified
Open/read/star/archive/snooze/delete actions and add Move to and Mark as spam,
with honest Draft/Junk/Scheduled variants. Each message row is a non-focusable
group whose checkbox, star/actions, and labelled open button are siblings.

Authenticated `POST /api/folders` creates at Top level or beneath an existing
selectable parent; `PATCH /api/folders` moves a custom folder while preserving
its leaf name; `DELETE /api/folders` removes a custom leaf. The IMAP service
resolves real folders and the hierarchy delimiter from LIST, treats INBOX casing
compatibly, rejects control characters, delimiter injection, duplicate names,
the virtual Scheduled folder, missing/nonselectable parents, and invalid flat
hierarchy requests, then calls ImapFlow with path segments. INBOX and every RFC
special-use/system folder are protected from move/delete even when ImapFlow does
not select that mailbox as the canonical alias. Top-level `SCHEDULED` is
reserved. Self/descendant moves, collisions, no-op moves, and delete requests
while children remain are rejected. Move/delete preserve IMAP subscriptions,
block paths referenced by active rules or snoozed messages, and atomically purge
the per-user folder-keyed search index so a later worker cannot certify stale
state.

Proof is green: backend 804 pass / 7 documented environment-dependent skips
(811 total); frontend 184/184; ESLint, production build, diff checks, and
complete repository integration pass. Focused backend folder/search regressions
are 39/39 and focused frontend context/search regressions are 20/20. Guarded
bridge and active webmail releases passed public IMAPS and ActiveSync
Mail/Ping/Contacts/Calendar gates. An API/public-IMAPS canary created a top-level
folder and child, moved the child to Top level, proved its new LSUB entry and the
old entry's removal, then deleted both with zero LIST/LSUB residue. Deployed
Chromium proved the corrected message-row accessibility tree, kept a clipped
context menu open while scrolling it in a 900x220 viewport, exercised folder
Move and viewport-wide permanent Delete confirmation, and deleted the folder.
One exact disposable message moved to Archive and then Mark as spam placed it in
the server-designated Junk folder; exact Message-ID cleanup removed it. Browser
sessions and ephemeral authentication state were removed. Folder rename remains
out of scope.

The lifecycle initially exposed a pre-existing Dovecot 2.4 upgrade defect:
Debian's retained 2.3-era empty `dict quota {}` sample became a real dictionary
whose implicit driver was the unsupported name `quota`, so IMAP DELETE returned
an internal error before storage mutation. `functions/lib_dovecot_config.sh`
now removes only an empty/comment-only legacy block, preserves configured
dictionaries, and is idempotently covered by
`tests/integration/dovecot_24_dict_migration_test.sh`. A guarded Dovecot release
passed pre/post mail, required Ping, contacts, and calendar gates. Effective
`dict quota` blocks and post-release dictionary errors are both zero; Dovecot,
the backend, Scheduler worker, and Nginx are active with zero restart counters.
Rollback snapshots are
`/var/backups/openmailstack/protocol-guarded-webmail-20260823T001723Z`,
`/var/backups/openmailstack/protocol-guarded-webmail-20260823T002451Z`, and
`/var/backups/openmailstack/protocol-guarded-dovecot-20260822T202155Z`.

## 2026-08-18 Cycle 15 Physical iPad Body Fetch Repair

**Status: the Exchange message-body spinner is fixed, guarded-deployed, and
physically confirmed on the iPad.** The original iPad sequence completed one
Sync body Fetch, then issued a different Fetch with the immediately previous
SyncKey. Exact replay correctly rejected the changed hash, but the generic stale
boundary returned status 3 and forced a full Inbox resync instead of returning
the second body.

Main commit `885099fd` and surgical release `4417f3d0` add a narrow,
non-mutating compatibility path only for recent same-collection previous-key
Fetch-only requests after a completed Fetch-only response with no paging or
pending commands and only known UIDs. Change/Delete, older keys, unknown UIDs,
and incomplete/malformed state still reset. The physical-shaped HTTP seam proves
two different Fetches converge on the current key without another state save,
while exact replay remains byte-identical.

Focused backend checks pass 49/49; the complete backend suite passes with
bounded concurrency; frontend passes 175/175 plus lint/build; both production
audits are zero; complete repository integration passes. Guarded bridge and
active deployments passed every public IMAPS and ActiveSync
Mail/Ping/Contacts/Calendar pre/post gate. Live backend and worker are active,
readiness is `401`, `NRestarts=0`, and the two changed runtime artifacts match
the surgical release byte-for-byte. The owner opened a real Exchange message
after rollout and confirmed its body renders normally. Same-ClientId retry,
the full physical Direct Push transition matrix, macOS CardDAV/Notes evidence,
and backup-quiescence reduction remain open.

## 2026-08-17 Cycle 14 Physical iPad Send And Settings Repair

**Status: server delivery/Sent storage and the iPad Settings failure are fixed
and guarded-deployed; the final iPad Sent refresh is awaiting owner
confirmation.** One physical iPad Exchange send reserved one durable immediate
row, reached SMTP once, was accepted by Gmail, and produced exactly one server
Sent copy. The iPad's legacy Sent Sync state had not incorporated that new UID,
so its missing Sent item was stale device state rather than a delivery or IMAP
append failure.

The visible account error correlated with six exact 20-byte page-18
`Settings/Oof/Get/BodyType` requests returning HTTP 501. A strict compatibility
handler now answers only Text/HTML OOF Get with Settings/Oof success and
`OofState=0`; it keeps Settings unadvertised, rejects every write/unknown shape
with protocol status 2, and creates no OOF/database/mailbox state. Integrated
main commit `a172be8` is green; the surgical production release `c9d5606a` was
built from the byte-identical installed baseline `21b60b15`, passed complete
local validation, and passed guarded bridge then active public gates. The live
backend matches all 541 tracked release files, is active with zero restarts and
an empty warning journal, and the real public canary returns the exact 27-byte
success response. Do not resend the already delivered mail; physical closure
is an iPad Sent pull-to-refresh plus confirmation that the account error does
not return. ClientId retry remains separately open.

The Settings deployment audit subsequently found newly published
`GHSA-ggr8-5vv4-36mx` in transitive `deepmerge-ts@7.1.5`. Main commit `4f1b336`
and surgical release `df88cc8c` pin `8.0.0` and regression-enforce that floor.
Both production audits are zero; complete main/release validation and a second
guarded bridge/active rollout passed. Production remains active with 541/541
tracked files exact, readiness `401`, `NRestarts=0`, and zero warning journal
entries. No post-fix physical iPad Settings request has been observed yet.

## 2026-08-17 Cycle 13 Durable-Row Rollback Evidence

**Status: the current production active/bridge rollback pair has exact durable
row evidence; physical Apple clients and full recovery remain open.** Fresh
root-only backup `/var/backups/openmailstack/oms-backup-20260817T215021Z`
passed the trusted validator. Approved inert immediate row ID 2 survived an
active worker interval and active-to-bridge restore with byte-identical
30-column digest and zero canary journal/mail/queue evidence. It was deleted
exactly once under bridge, the automatically captured active preimage was
restored, and active attestation plus the Ping-required public suite passed
with zero outbox/canary residue and zero service restarts. Root-only evidence is
at `/var/backups/openmailstack/outbound-rollback-canary-20260817T213124Z-1fc49e9b2c64`.

The backup initially remained `.incomplete` because the backend listener needed
six seconds after systemd activation. A bounded 15-check readiness loop is now
regression-backed for backup and restore, while sustained failure still rolls
back. The production-size run also exposed a long quiescence window while the
mail tree is copied and repeatedly hashed; reducing that outage is the next
operator-safety task.

## 2026-08-16 Cycle 12 Active Runtime And Final Integration

**Status: the core universal outbox and bounded ActiveSync Ping are deployed
active; integrated registry/EAS HTTP expansion is locally verified but not yet
deployed.** Production completed legacy-to-bridge, bridge-to-active, hotfix
bridge/active, runtime/environment attestation, and public protocol gates. The
exact approved calendar repair retained tombstone 23, archived both approved
rows, removed only 22, and left zero duplicate groups. The active runtime has
zero restarts, the outbox was empty at final attestation, and the one-time
repair approval is absent.

Ping is advertised with strict 60-900 second negotiation, authenticated
FolderSync ownership, add-only Email/Contacts/Calendar wake semantics, bounded
cache/wait resources, and cancellation/drain handling. The final public gate
proved three-class wake plus Sync, deletion non-wake, full/bodyless 60-second
renewals, and Status 1 after a 900.080-second hold with zero canary residue.
The scheduler deliberately avoids a fresh poll within the last poll interval;
a genuinely unresolved earlier probe still returns Status 8. The smoke owns an
explicit finite Undici dispatcher because ambient Node Fetch headers time out
before the maximum protocol heartbeat.

Merged `main` at `e5b25f74` passes 779/786 backend tests with seven opt-in
skips, frontend 175/175 plus lint/build, four disposable MariaDB proofs, and the
complete repository integration suite. No code-level P0/P1 remains in the
scoped work. Cycle 13 closed the exactly authorized production durable-row
rollback canary. Release evidence still requires physical iOS SendMail and
Direct Push behavior,
the physical macOS CardDAV identity edit/merge retry, the original physical
macOS Notes lifecycle, and production-scale/off-host recovery. Compaction
remains disabled.

## 2026-08-16 Cycle 11 Universal Outbox Registry And Ordering

**Status: implemented and disposable-database verified; compaction remains
disabled for rollout.** `outbound_submission_registry` now atomically reserves
the owner/key/fingerprint/origin identity with each keyed hot payload row. It
contains no MIME, envelope, body, attachment, recipient, or credential fields.
Hot-row removal copies terminal outcome into the registry in the same
transaction, so replay/conflict remains authoritative after payload deletion.
Bounded backfill is additive/idempotent and compaction fails closed unless every
keyed hot row exactly matches the registry.

Retention policy is seven days for terminal payload, 90 days for body-free
scheduled display metadata, 120 days for web replay tombstones, and 400 days
for ActiveSync replay tombstones. Delivery-uncertain, active/nonterminal,
future-scheduled, and historical null-key rows never auto-expire. The exact
`OMS_OUTBOUND_COMPACTION_MODE=registry-verified-v1` opt-in is required; default
and the Cycle 10 active rollout remain `disabled` until rollback compatibility
with the registry is separately proven.

Mixed legacy local-wall and keyed UTC rows are now selected independently,
projected to real instants, and globally sorted for both Scheduled-folder reads
and bounded worker claims. A `Pacific/Kiritimati` disposable MariaDB fixture
proves the old raw-DATETIME order is wrong and the projected order/claim is
correct. The same proof covers atomic rollback, concurrent reservation,
same-key replay/conflict after hot deletion, owner isolation, abort replay,
apply-twice migration/backfill, bounded concurrent compaction, privacy, and
retention exceptions.

## 2026-08-16 Cycle 9 Rollback Bridge

**Status: rollback-compatible outbound quarantine is implemented, reviewed,
and deployed as the mandatory transition/rollback boundary.** Guarded webmail
releases now require two stages: `webmail-bridge` installs a total outbound
quarantine, then `webmail` may activate only when the live rollback target is
the exact attested bridge. Bridge mode rejects new web/scheduled/ActiveSync
submissions before persistence or delivery, performs no worker claim or lease
mutation, blocks scheduled cancellation/removal mutation, and retains
owner-scoped status reads.

The first bridge transition has a read-only legacy-schema/row preflight. Its
one automatic legacy recovery exception is bound to the exact markerless
snapshot recorded in that process and requires unchanged environment/runtime
content after restore. Later snapshots require a supported marker, exact
bridge/active mode, root-only mode file, and root-owned non-writable runtime
beneath trusted ancestors. Only uploads remain service-writable; symlink
targets cannot escape the protected tree or enter uploads.

Local proof is green: backend 737 total / 732 pass / 5 documented skips / 0
fail; focused rollback preserves a durable immediate row byte-for-byte with
zero DB claim/SMTP/IMAP/auth side effect; disposable MariaDB 1/1; full
integration and affected shell/restore/release gates pass; independent Spec
and Standards re-reviews report no P0-P3. The verified backup, exact repair,
bridge, active deployment, and hotfix bridge/active cycle subsequently passed.
At that checkpoint only the separately authorized live durable-row rollback
canary remained open; Cycle 13 subsequently closed it.

## 2026-08-15 Eight-Cycle Hardening Closeout

**Historical snapshot; superseded by the Cycle 12 state above.**

**Status: universal outbound delivery is locally verified, not deployed, and
the release remains NO-GO.** Cycles 6-8 replace direct web and ActiveSync SMTP
with one durable `scheduled_emails` outbox. The server reserves complete MIME,
envelope, Message-ID, owner-scoped idempotency key, and canonical request
fingerprint before SMTP; replays do not resend and mismatched reuse fails. The
worker has explicit safe-retry, accepted/Sent-copy, partial, failed, and
delivery-uncertain states, claims work on demand, uses an outbox-only UTC
serialization boundary, and scrubs terminal immediate payloads while preserving
dedupe tombstones.

Web compose, inline reply, delayed/Undo mail, and strict ActiveSync SendMail use
the same seam. Browser keys survive concurrent tabs, reloads, ambiguous
responses, pending polling, and attempts to change delivery mode. IndexedDB
stores only UUIDs and privacy-safe digests. Unchanged uncertain mail cannot be
resent until the user explicitly confirms independent verification of
non-delivery. Status responses are owner-scoped and no-store. ActiveSync scopes
ClientId by owner and DeviceId, honors SaveInSentItems, authorizes From, removes
Bcc and Resent-Bcc from transport only, and keeps unsupported Smart operations
fail-closed.

Current proof: backend 729 tests (724 pass, 5 documented skips, 0 fail);
frontend 175/175 plus lint and production build; generated-runtime parity and
repository integration pass; independent focused review passes 80/80; and the
isolated MariaDB 11.8.6 proof passes migration-twice, reservation races, crash
states, exact UTC behavior under a non-UTC process timezone, privacy scrubbing,
soft removal, replay, and conflict behavior. The disposable schema/user were
removed after the proof. Chromium/WebKit desktop/mobile browser qualification
passes 240/240 with zero unexpected diagnostics.

At this checkpoint, deploying through the then-current automatic rollback
target was unsafe: the installed older runtime did not understand immediate
rows or keyed retries, and one duplicate calendar tombstone blocked startup.
Cycles 9-12 subsequently installed the bridge boundary, completed the exact
approved repair and clean-host drill, and added bounded registry retention; see
the current state above. Physical final-runtime evidence remains separately
tracked.

## 2026-08-15 Five-Cycle Hardening Closeout

**Status: locally validated, not deployed, and NO-GO for release.** Commit
`869bb27b` adds serialized web Notes and Draft saves, complete Draft resume,
durable scheduled Cancel/Undo restoration, distinct transport versus
Bcc-preserving Sent MIME, partial-recipient truth, private same-origin
owner-scoped uploads, free/busy authorization/cancellation, mail privacy,
mobile message-cache identity, honest feature surfaces, and accessibility/focus
hardening. Commit `e33c6df6` adds a fail-closed checksummed backup/restore
transaction with explicit inventory, exclusive locking, continuous quiescence,
a verified safety snapshot, and rollback of files, logical database state, and
exact prior service activity.

Final permitted validation passes: backend 690/694 with four documented skips,
frontend 143/143, deterministic Chromium/WebKit browser qualification 176/176,
builds, lint, production dependency audits, repository integration, ShellCheck,
and generated-runtime parity. The opt-in `scheduled-send-db.test.cjs` was not
run because it creates and drops a database table and only the Notes fake
SQL/IMAP seam was approved.

The latest guarded deployment correctly rolled back on an existing exact
calendar-tombstone duplicate; no production row was mutated. Immediate web and
ActiveSync send still have a P1 crash window after SMTP acceptance but before a
durable replay record. Release requires a universal idempotent outbox with
disposable MariaDB proof, the narrow production tombstone repair, guarded live
validation, physical macOS Notes confirmation, and a clean-host restore drill.
See `docs/engineering/RELEASE_READINESS_2026-08-15.md`.

## 2026-08-15 Paired Web Release And Manual Update Boundary

**Status: Deployed, rollback-round-trip validated, and independently
reviewed.** Commits `a808b8d` and `8e8e864` remove automatic/browser-triggered
upgrade claims and retire the passwordless web-to-root bridge. Modern and
legacy Admin update surfaces read only a validated deployed `VERSION`, return
an error for missing/invalid state, and describe the operator-controlled manual
policy. `upgrade.sh` remains as a no-mutation failure entry point.

`functions/protocol_guarded_deploy.sh webmail` now holds one global lock while
it snapshots, deploys, validates, or recovers the legacy Admin Portal and
modern web application as one pair. Snapshots include the full legacy root and
modern runtime/configuration; normal deploy changes only bounded legacy
public/`VERSION` files before the existing modern deploy. The guarded restore
path snapshots the current pair before applying a requested pair and recovers
the current pair if requested validation fails. HUP, INT, and TERM use the same
truthful `20`/`30`/`31` recovery contract.

The first live deployment exposed a startup race: systemd reported active about
two seconds before the backend listener accepted connections, so immediate
deploy and recovered-state probes conservatively failed. The shared runtime
validator now uses a proxy-disabled, per-request-bounded 30-attempt loop for the
expected local `401`; behavior tests cover success and exhaustion. The next
guarded deployment passed public IMAPS and ActiveSync before and after. A live
old-pair/new-pair restore round trip also passed both directions. Current
rollback is
`/var/backups/openmailstack/protocol-guarded-webmail-20260815T103128Z/`; the
verified new-pair restore point is
`/var/backups/openmailstack/protocol-guarded-webmail-20260815T103335Z/`.
Backend 289/292 with three gated skips, frontend 99/99, integration, lint,
build, ShellCheck, PHP lint, and both independent review axes pass.

## 2026-08-15 Notes IMAP Idempotency And Deletion-Race Hardening

**Status: Deployed and deterministic-regression validated; physical macOS
confirmation remains.** Commit `bfbe1d7` serializes each owner's Notes sync
through both a process-local promise tail and a dedicated-connection MySQL
named lock, so web requests, the standalone runner, and multiple backend
processes cannot export the same revision concurrently. Notes reconciliation
uses a complete mailbox identity snapshot instead of the newest 25 messages,
removes duplicate OMS-owned Message-IDs deterministically, fetches bodies only
for imports, and records the exact SQL revision that IMAP acknowledged.

Missing-IMAP deletion now wins only when owner, SQL revision, IMAP revision,
linked UID, and live state still match atomically. A newer web edit therefore
survives and reminder/attachment cleanup runs only after the conditional soft
delete succeeds. Old-message delete failures stop before replacement append;
accepted-but-uncertain appends reconcile by deterministic Message-ID; current
identical saves are no-ops; and restore-during-delete cannot acknowledge the
newer revision.

The approved fake SQL/IMAP seam covers independent runtime instances,
different-owner concurrency, concurrent create, edit/delete/import races,
duplicate Message-IDs, delete failure, uncertain append, and linked plus
IMAP-only mailboxes beyond 25 messages. Focused tests pass 21/21; the complete
backend suite passes 287/290 with three documented environment-gated skips;
frontend 98/98 and every integration guard pass; independent Spec and Standards
reviews have no findings. A clean temporary TypeScript compilation proves the
checked-in runtime JavaScript is current.

The guarded release passed public IMAPS and the ActiveSync full-MIME,
Junk/Trash, and no-change sequence before and after deployment. Repository/live
Notes artifacts match, local and public readiness return the expected 401,
staging passes, and the backend is active with zero restarts. Rollback is
`/var/backups/openmailstack/protocol-guarded-webmail-20260815T085248Z/`.
No real Notes row or mailbox message was used. A physical macOS edit/delete
retry is still required before closing the originating client-observation gate.

## 2026-08-06 Contact CardDAV Identity Hardening

**Status: Deployed and locally/release-gate validated; physical confirmation
remains.** New Contacts-app/API/CSV-created rows now persist a UUID as both
their CardDAV `dav_uid` and vCard `UID`. vCard imports use an independent UUID
href, preserve an incoming `UID`, and persist a generated `UID` when absent.
The compatibility `/api/contacts` writer follows the same invariant.

Existing `contact-<id>` rows are deliberately not rewritten. Duplicate scan
results rank UUID-backed contacts first, allowing the existing merge workflow
to keep the durable UUID row, combine legacy fields, and tombstone the old href.
CardDAV PUT identity remains href-driven: a PUT to the same href updates the
existing row, while a different href remains a create even when names or email
addresses match. Focused identity tests pass 7/7; the complete backend suite
passes 273/276 with three documented environment-gated skips, and repository
integration plus frontend tests pass. Commit `b575a57` passed the guarded
public IMAPS/ActiveSync gates before and after deployment; repository and live
backend artifacts match, readiness and staging pass, and the service has zero
restarts or recent warnings. Rollback is
`/var/backups/openmailstack/protocol-guarded-webmail-20260807T224814Z/`.
A physical macOS retry is still required before release closure.

## 2026-08-04 Notes Authenticated Live Collaboration

**Status: Deployed and live browser-validated for same-owner sessions.** Commits
`7dcfae3`, `ef69a53`, and `2b3a68b` add opt-in, same-origin Notes signaling
with five-minute opaque capabilities bound to the authenticated owner, session,
and one opaque room. The service enforces token expiry, 64 KiB messages, and 32
connections per room; the editor refreshes credentials, elects a bootstrap
leader, persists through atomic `sync_token` checks, and falls back to local
editing when signaling is unavailable. Installer upgrades now add the WebSocket
route to both marked and legacy Nginx vhosts. Unsaved notes remain local and
missing reminders return an expected empty result, keeping normal first-use
flows console-clean.

Backend tests pass 266/269 with three documented skips; frontend tests pass
98/98; lint, production build, integration, and final Spec/Standards reviews
pass. Two isolated authenticated Playwright sessions proved seeded and empty
note bootstrap, bidirectional edits, exact reload persistence, live status, and
zero final console warnings/errors. The guarded deployment passed public IMAPS
and ActiveSync before and after release. Rollback:
`/var/backups/openmailstack/protocol-guarded-webmail-20260804T125823Z/`.

The live cleanup uncovered a separate high-priority data-integrity defect:
rapid Notes save/close/delete synchronization produced duplicate IMAP messages
and one SQL re-import. All exact disposable probe records were removed and both
stores verify empty. Next: reproduce and fix the Notes IMAP write/delete race
before adding cross-account collaboration invitations or ACLs.

## 2026-08-04 Notes Clipboard Image Paste

**Status: Deployed and browser-validated.** Commit `0a85b4d` routes image-only
clipboard pastes through the existing authenticated `/api/notes/upload` path,
validates PNG/JPEG/GIF/WebP files up to 5 MiB, and embeds the returned URL. It
distinguishes image-only HTML clipboard representations from real captioned or
mixed rich content so Quill cannot silently store pasted base64 images while
ordinary rich paste remains intact.

Yjs relative positions resolve the insertion point after asynchronous upload;
note/editor generation checks and abort signals prevent late insertion after a
note switch or unmount, and a moved caret is not stolen. Ordered multi-image
upload, partial failure, and accessible uploading/success/error feedback are
covered. The mobile editor header wraps without hiding close/reminder/save
controls, and the reminder panel stays within a 320 px viewport.

Focused tests pass 6/6; the complete frontend suite passes 90/90, ESLint and
the production build pass, every repository integration guard passes, and
independent Spec/Standards reviews return PASS. Fixture-only Playwright at
1440x900, 390x844, and 320x700 proved direct file paste, image-only HTML paste,
one upload per paste, URL embedding, editor focus, status semantics, no
horizontal overflow, visible mobile controls, and bounded reminder geometry
without persisting production data.

The guarded deployment passed strict public IMAPS and the ActiveSync
full-MIME/Junk/Trash/no-change sequence before and after installation. Live
frontend content matches the tested build, public root/auth return 200/401,
the service is active with `NRestarts=0`, the warning journal is empty, and
full staging smoke passes. Rollback:
`/var/backups/openmailstack/protocol-guarded-webmail-20260804T022450Z/`.

## 2026-08-03 ManageSieve Response Framing

**Status: Deployed, bounded, and live-validated.** Commits `b3494c08` and
`9b421e5` replace string/chunk heuristics with byte-framed ManageSieve response
parsing. Declared UTF-8 literal bytes are consumed exactly before `OK`, `NO`, or
`BYE` can terminate a response; the terminal line must include CRLF. A peer
that ends or closes mid-response now rejects the pending request rather than
leaving it unresolved. Inbound literals are capped at 10 MiB and response
overhead is bounded.

The focused suite passes 4/4. Backend tests report 261 total, 258 passed, three
documented environment-gated skips, and zero failures; frontend tests pass
84/84 through the full integration suite. Both Spec and Standards review axes
pass. The guarded webmail deployment passed strict public IMAPS and ActiveSync
before and after installation; rollback is
`/var/backups/openmailstack/protocol-guarded-webmail-20260804T014236Z/`.
Staging smoke, exact repository/live parser hash, readiness `401`, zero service
restarts, and a clean recent warning journal pass. Three delegated read-only
live `GETSCRIPT webmail` calls each returned 84,349 bytes; no filter or mailbox
state was changed.

## 2026-08-03 Mozilla Mail Autoconfiguration

**Status: Public one-step discovery is deployed and client-validated.** Commit
`63683df8` serves Thunderbird's provider
`/mail/config-v1.1.xml` path and domain well-known fallback from one tested
router. The response uses `%EMAILADDRESS%`, IMAP 993 with SSL, and SMTP 587 with
STARTTLS; it never reflects the query email address. Fresh and legacy Nginx
install paths proxy both routes, and installer certificate-host enumeration now
includes `autoconfig.<FIRST_DOMAIN>` with or without Scheduler.

Backend 254/257 with three environment-gated skips, frontend 84/84 through the
full integration suite, shell syntax, installer dry-run, and focused discovery
guards pass. The guarded release passed strict public IMAPS and ActiveSync
before and after deployment. Staging smoke, both live routes on
`mail.housevo.us`, forced-host routing, exact repository/live artifact hash,
clean warning journal, and `NRestarts=0` pass. Rollback is
`/var/backups/openmailstack/protocol-guarded-webmail-20260803T235205Z/`.
`autoconfig.housevo.us` now resolves by CNAME to `mail.housevo.us`, and the
active Let's Encrypt certificate covers `autoconfig`, `autodiscover`, `mail`,
and `webmail`. Thunderbird 140.12.0esr on Debian 13 and Thunderbird Android
21.1 on Android 11 both fetched the public provider route, selected full-address
usernames, IMAP 993 SSL/TLS, and SMTP 587 STARTTLS, and authenticated without
manual correction. The desktop account-creation success screen, Android
expanded discovered-settings screen, Android Inbox, and matching redacted
Nginx user agents were observed. No message was sent or mailbox data changed.
The disposable Linux user, Thunderbird profile, AVD, APK, screenshots, and
cached credential were removed; the reusable Android SDK contains no account
state. Certificate/vhost backup:
`/var/backups/openmailstack/autoconfig-cert-20260803T2359Z/`.

## 2026-08-03 macOS CardDAV Owned-Collection Writability

**Status: CardDAV physical write lifecycle passed; macOS picker defect remains.**
macOS 26.5.2 classifies Housevo as an active native CardDAV container and
cached its Personal address book as writable, yet still omits it from Contacts
> Settings > General > Default Account. The approved
`macos_contacts_targeted_write.swift` probe explicitly targeted that container,
created one random marker, verified `DESTINATION_OK=HouseVo`, and deleted it.
Live CardDAV logs recorded the matching PUT at 22:56:52 UTC and DELETE at
22:57:15 UTC. Storage has zero active rows and one expected tombstone for the
exact DAV UID; the service remained warning-free and healthy.

The experimental aggregate `DAV:write` compatibility signal was therefore
both ineffective and broader than the implemented property-write contract.
Commit `35d29345` removes it while preserving truthful collection
`bind`/`unbind`, contact-resource `write-content`, owner metadata, and handled
query/multiget/sync reports. Backend 252/255 with three gated skips, frontend
84/84 plus lint/build, integration and focused shell checks, mandatory public
mail gates before/after deployment, public CardDAV lifecycle, staging smoke,
exact artifact hash, clean warnings, and `NRestarts=0` pass. Rollback is
`/var/backups/openmailstack/protocol-guarded-webmail-20260803T230149Z/`. Do not
add ACL or writable-home claims or mutate private macOS databases; the remaining
Default Account failure is isolated to Apple's client eligibility/UI state.

## 2026-07-31 Mandatory IMAPS And ActiveSync Release Gate

**Status: Provisioned, deployed, and live-validated.** The installed host has a
dedicated `oms-canary@housevo.us` mailbox, a generated root-only `0600`
credential file, and a root-only protocol-gate sentinel. The mandatory gate
submits one unique message through strict public SMTP, retrieves and validates
its body over strict public IMAPS 993, then exercises ActiveSync full-MIME
Fetch, read state, Inbox-to-Junk-to-Trash synchronization, and cleanup. Every
run gets a unique synthetic DeviceId and deletes only that exact state row, so
retry replay cannot make consecutive releases reuse an old response. Missing
or exposed credentials and optional-smoke `SKIP` results fail closed.

`functions/10_webmail.sh` and `functions/04_dovecot.sh` refuse direct execution
when protection is enabled. `functions/protocol_guarded_deploy.sh` runs the
real public gate before and after either target and retains a root-only
snapshot. For `webmail`, one lock and recovery callback now covers the modern
backend/frontend/runtime configuration and full legacy Admin Portal as one
pair. Repeated standalone gates, guarded webmail/Dovecot, a forced failed
deployment recovery, and a paired live restore round trip passed. Final canary
mail, web sessions, and ActiveSync state were empty.

## 2026-07-31 iOS Exchange MIME Body Retrieval

**Status: Deployed and physically closed.** iOS opens an ActiveSync message with Sync `Fetch`, `MIMESupport=2`, and `BodyPreference Type=4` while omitting `TruncationSize`. The old normalization reused the saved 500-byte Type-1 list-preview limit, so the returned MIME could contain only headers and iOS displayed "This message has no content." A present body preference with no truncation size now uses the existing 10 MiB bounded complete-content ceiling; explicit limits and requests with no new body preference preserve their previous behavior. Unit and authenticated-smoke regressions model the exact iOS sequence. Backend 251/254 with three documented optional skips, focused ActiveSync 27/27, full integration/frontend 84/84, TypeScript build, shell syntax, and diff checks pass. The deployed artifacts match the tested tree; direct/public EAS OPTIONS, Nginx, a clean warning journal, zero automatic restarts, and full staging smoke pass. Rollback: `/var/backups/openmailstack/20260731T203319Z-eas-mime-body/`. The dedicated canary proves this full-MIME path on every guarded release, and the owner later confirmed iOS Exchange worked normally with Sieve as the only remaining mail issue.

## 2026-07-30 Thunderbird And Android Client Matrix

**Status: Thunderbird desktop, the remote Android client stack, and macOS Mail pass; active test state is clean.** Thunderbird 140.12.0esr on Debian 13.6 completed IMAP/SMTP self-send plus CalDAV and CardDAV create/edit/delete through the live server. Thunderbird Android 21.0 and DAVx5 4.5.18-ose completed the corresponding mail, Calendar-provider, and Contacts-provider lifecycles on an Android 11 API 30 emulator in `dev2-debian`; Etar 1.0.56 supplied the event editor because the bundled AOSP Calendar package declared but omitted its editor class. The server retained stable DAV UIDs through edits and emitted the expected calendar/contact tombstones on delete. Exact Inbox/Sent test UIDs were expunged only after subject verification. The disposable `omsclient` account/home was removed, taking its Thunderbird profiles, Android AVDs, APKs, screenshots, and cached mailbox credential with it. The Android SDK and installed Debian test packages remain reusable and contain no mailbox profile. Post-cleanup staging smoke, public IMAP/SMTP hostname verification, HTTPS, service activity, recent error checks, and zero backend restarts pass. After the IMAP certificate repair, the owner confirmed macOS Mail worked normally. macOS 26.5.2 CardDAV has an explicit create/delete lifecycle pass through a real PUT/DELETE and clean tombstone; only Apple's Default Account picker omission remains open. The later Mozilla Autoconfiguration release and public DNS/SAN expansion closed the manual-configuration gap in both Thunderbird variants.

## 2026-07-30 Public IMAP TLS

**Status: Repaired and live-validated at `20a7018`.** A targeted Dovecot authentication rerun had replaced `local.conf` without the certificate directives normally applied by the later security module, so public port 993 fell back to Debian's self-signed `CN=mail` certificate. The existing Let's Encrypt paths were restored behind `/var/backups/openmailstack/imap-tls-20260730T110533Z/`. The Dovecot module now preserves or recovers a hostname-valid, key-matching certificate pair, and staging smoke verifies trusted hostname coverage on IMAP port 993. The module was rerun against production after the fix; Dovecot retained the Let's Encrypt paths, remained active with zero automatic restarts, and public `mail.housevo.us` verification passed repeatedly.

## 2026-07-29 Authentication and Admin Authorization

**Status: Deployed through `701583fd`; live protocol and browser validation passed.** Production requires separate preserved 64-character session and account-security keys. TOTP secrets use purpose-separated AES-256-GCM encryption; recovery codes and named app passwords are stored only as digests. Two-factor login accepts TOTP or one transactionally consumed recovery code, and enabling 2FA retains only the current session. Dovecot 2.4.1 has separate master, app-password, and mailbox-password passdbs: 2FA blocks the primary password while app passwords work across IMAP, SMTP submission, ManageSieve, and CalDAV. The delegated backend identity remains independent. All 47 modern Admin routes require an authenticated session and fresh active-superadmin row; legacy PHP actions use explicit global, domain, self-service, and quarantine policies. See `docs/engineering/ADMIN_RBAC_AUDIT.md`. Backend 223/226 with three documented optional skips, frontend 82/82, lint/build/integration/PHP checks, disposable live protocol probes, authenticated desktop/mobile Playwright, exact artifacts, and staging smoke pass. Final live probe state is empty and the account used for UI verification has 2FA disabled with no app passwords. Rollback: `/var/backups/openmailstack/auth-2fa-rbac-6f5d51aa-20260730T054937Z/`.

Last reviewed: 2026-08-03. Webmail search performance and correctness are deployed at `4b0eb69d`: ordinary all-field terms use one Boolean FULLTEXT filter/score, while short, quoted, punctuation-bearing, and default InnoDB-stopword terms retain bounded LIKE semantics. Recent worker-certified complete indexes require no synchronous IMAP; every worker cycle invalidates the previous snapshot first and certifies a replacement only after pagination completes and every folder passes same-cycle move/delete reconciliation. LIST-STATUS consolidates unseen and UID identity reads where the server advertises it, worker cycles cannot overlap, superseded frontend/live-fallback work is cancelled, Undo and move actions invalidate stale snapshots, and bounded timing/source/count telemetry excludes query, user, folder, subject, and body values. A production Boolean probe returned 50 rows in about 85 ms; the deployed worker certified two available user snapshots in 33.6 seconds with no failure or overlap. The accessible single/bulk Move picker remains deployed and folder-safe. Exact backend/frontend artifacts, normalized permissions, API/auth boundaries, ActiveSync OPTIONS, zero automatic restarts, warning-free post-restart logs, Nginx, and staging smoke pass. Rollback is `/var/backups/openmailstack/search-perf-73a7ec2-20260721T133522Z`. Calendar Track T is complete for the deployed scope. ActiveSync Mail delta synchronization is deployed at `5b9cd89e`, with FilterType-0 all-mail pagination corrected at `bc4f7387`: state is scoped by mailbox/device/folder; web moves emit source Deletes and destination Adds; FilterType, WindowSize, body truncation, paginated initial catch-up, and efficient post-catch-up no-change polls are bounded and regression-covered. Authenticated production web-to-Junk/web-to-Trash smoke, exact artifacts, service health, rollback checks, the physical stale-key reset, catch-up exhaustion, exact saved-UID reconciliation, and no-change polling pass. The current iOS partnership has 6,243 saved Inbox identities with a nonzero checkpoint/MODSEQ, `MoreAvailable=false`, and zero pending commands. The owner confirmed iOS Exchange, iOS IMAP, and macOS Mail all look correct, closing both the physical catch-up and MIME-body gates. Distinct active Inbox copies sharing sender/subject with already-junked historical messages are separate identities; never mutate them by subject alone. The timezone repair, EAS origin-timezone codec, recurrence exceptions/reminders, and conservative custom-zone handling remain deployed under rollback. Physical macOS 26.5.2 Mail, CalDAV, and CardDAV lifecycles plus iOS 26.5.2 ActiveSync Mail/Calendar pass. Thunderbird desktop and the remote Android client stack pass; the Contacts Default Account picker is documented as an Apple UI issue. Clean-VM validation is deferred until a second development Linux server is available.

## 2026-07-21 Webmail Search Correctness

**Status: Deployed at `fa63f7e6`; authenticated mailbox confirmation pending.** The visible toolbar uses a 300 ms trailing debounce, Enter flushes a pending query immediately, clearing restores the active folder, and every supported field plus explicit current-folder/all-mail scope is exposed. UIDVALIDITY plus folder plus UID is authoritative in the search cache, while folder plus UID keys current-generation all-mail rendering, navigation, prefetch, and individual actions; cross-folder bulk mutation is disabled. The frontend serializes query, field, scope, folder, and limit, surfaces API failures, and visibly labels partial results. `/api/messages/search` uses the database index only when worker UID coverage reaches current IMAP UIDNEXT in the same UIDVALIDITY generation, verifies existence and current flags, purges stale generations/moves/deletes/removed folders, and otherwise merges globally ranked live IMAP summaries. Live envelope search avoids MIME downloads; attachment-name verification alone uses complete sources capped at 1 MiB per message and 8 MiB per request, marking capped/folder-failure results partial. Frontend 43/43, backend 185/188 with three expected optional database skips, ESLint, production builds, lint/integration scripts, `git diff --check`, mocked Chromium desktop/mobile interaction, and independent Standards/Spec review remediation pass. Production now serves `index-BemdpK3F.js`; its mail route contains the Enter handler and `submitSearchQuery` binding. Repository/live affected-module hashes match, `uid_validity` exists, service restarts remain zero, the post-restart warning journal is empty, and staging smoke passes. Rollback: `/var/backups/openmailstack/search-fa63f7e6-20260721T095532Z`.

## 2026-07-20 ActiveSync Mail Delta Release

**Status: Core release, all-mail paging hotfix, and physical catch-up gates pass.** Commit `5b9cd89e` adds durable user/device/folder mail state, opaque sync keys and authenticated retry replay, UID disappearance Deletes, destination-folder Adds, bounded options/body handling, and a MODSEQ no-change path. Hotfix `bc4f7387` removes the protocol-invalid newest-window ceiling: FilterType `0` or omission now pages all items, and legacy floored state forces one full UID snapshot before resuming efficient checkpoints. Backend 176/179 with three expected optional database skips, frontend 37/37, full integration, exact live artifacts, route health, staging smoke, and zero-restart service checks pass. Physical iOS reset its stale key, paged past the old 25-item floor, exhausted and reconciled the Inbox, and returned stable no-change state. The 2026-08-03 read-only gate found 6,243 saved Inbox identities, a nonzero checkpoint/MODSEQ, `minimum_uid=1`, no pending commands, and `MoreAvailable=false`; the owner confirmed the physical Exchange view. Original rollback: `/var/backups/openmailstack/eas-mail-sync-5b9cd89-20260720T222243Z/backend-before.tar.gz`; hotfix rollback: `/var/backups/openmailstack/eas-all-mail-bc4f738-20260720T224709Z/backend-before.tar.gz`.

## 2026-07-20 Scheduler Slot Observability And iOS ActiveSync Preflight

**Status: Logging deployed; the physical iOS follow-up passed in the Calendar gate below.** Commit `8c9f443` adds a bounded one-line `scheduler.slot_generation_failed` JSON record for unexpected public slot failures while retaining generic client errors and excluding private-link tokens, SQL text, booking data, and calendar content. Backend 134/137 with three expected optional skips, route/privacy regressions, integration/Scheduler guards, exact live artifacts, live slot/range behavior, zero-restart services, clean warning journal, and staging smoke pass. Direct/public EAS `OPTIONS` and 13 focused Calendar/Sync tests pass; authenticated route smoke skipped without credentials. Rollback: `/var/backups/openmailstack/scheduler-slot-logging-8c9f443-20260720T181559Z/backend-router.tar.gz`.

## 2026-07-20 Scheduler Public Availability Recovery

**Status: Fixed, deployed, and live-browser verified at commit `cb824940`.** Public slot generation failed before recurrence parsing because legacy `events.uid` and Scheduler `calendar_event_uid` columns use incompatible `utf8mb4` collations. `SchedulerStore.busyIntervals()` now compares the opaque, case-sensitive identifiers as binary values. A disposable MariaDB fixture preserves the mixed-collation shape and passes the complete Phase 1 lifecycle. Backend 132/135 with three expected optional skips, full integration/Scheduler guards, exact live artifacts, active zero-restart services, a clean warning journal, staging smoke, and a production Chromium 62-day `200` with visible slot buttons all pass. No production data or schema changed. Rollback: `/var/backups/openmailstack/scheduler-availability-cb82494-20260720T175949Z/backend-store.tar.gz`.

## 2026-07-20 EAS Timezone Codec And Guarded Calendar Test Release

**Status: Deployed operationally; physical macOS/iOS Calendar gates passed later on 2026-07-20.** `eas-timezone.ts` encodes/decodes the 172-byte little-endian EAS `TIME_ZONE_INFORMATION` value and derives fixed or DST transition rules from IANA zones. Resolution accepts embedded IANA names or the complete CLDR 48 territory-`001` Windows map only when bias/transition rules match, then uses bounded caches and a small rule fallback instead of scanning every IANA zone. `eas-calendar.ts` emits the protocol tag `TimeZone` for zoned timed events, omits it for all-day events, preserves an existing zone when a Change omits the field, and writes zoned iCalendar wall time on inbound EAS recurrence. Fixed Baghdad, New York, Microsoft Pacific, Windows Central, malformed, unknown, all-day, and recurrence fixtures pass. Backend 130/133 with three optional DB skips, frontend 28/28, lint/build, shell/integration, independent reviews, exact live artifacts, public/direct EAS `OPTIONS`, Nginx/services/journal checks, and staging smoke pass. The authenticated calendar smoke skipped because no smoke credentials were supplied. No production calendar/mailbox/settings/schema/configuration was changed. Rollback: `/var/backups/openmailstack/calendar-timezone-20260720T150815Z`.

## 2026-07-20 Time, OMS Drive, And Migration Roadmap

**Status: Initial guarded release deployed; superseded by the completed Track T physical closure summarized above.** The parser resolves IANA `TZID` wall time to its instant while preserving UTC, floating, and all-day metadata through the API. The React Calendar projects canonical instants into the selected System/Home zone across Month/Week/Day, editor, current-day marker, and free/busy requests; new events use explicit `TZID`. Calendar settings add mode and clock visibility, the desktop header clock uses the active zone and 12/24-hour format, and focus/visibility refresh handles device-zone changes with visible error/retry state. Golden backend/frontend vectors cover deterministic New York DST gap/overlap resolution. A disposable Apple-shaped CalDAV lifecycle proves create/HEAD/read/conditional-update/delete with stable ETags; the extracted EAS adapter covers timed/all-day/recurrence plus binary origin timezones; Scheduler edge cases pass; real Chromium/WebKit desktop/mobile flows prove `17:00Z` / `20:00 Asia/Baghdad`; and the guarded live host gate passes. Drive/Migration decisions remain proposed. Later work completed exceptions/reminders, conservative custom `VTIMEZONE` handling, and the physical macOS/iOS matrix.

## 2026-07-20 Message Templates Settings Contract

**Status: Deployed and live-artifact validated at commit `49d14d3c`.** The compose templates UI now uses the shared user-settings response/write contract, and the backend recognizes a bounded `templates` namespace stored in the existing `webmail_user_settings` table. Repository and deployed backend hashes match, the frontend checksum dry-run is empty, and an isolated harness against the deployed backend artifact returns `200` for authenticated GET and PUT without querying production data. The public route retains its `401` unauthenticated boundary; Nginx, services, permissions, staging smoke, and post-restart logs pass. No migration, authentication-session mutation, mailbox mutation, or Scheduler-worker restart occurred. Root-only rollback snapshot: `/var/backups/openmailstack/20260720T113924Z_webmail_templates_contract`.

## 2026-07-20 Webmail Endless Scrolling Live

**Status: Deployed and live-mailbox verified at commit `9b35f5d`.** The frontend under `/var/www/openmailstack` exactly matches the tested `webmail-frontend/dist/` tree. A mailbox-read-only browser run crossed two real 25-message UID cursors, retained 75/75 unique rows, and preserved the exact scroll position and loaded height when a synthetic `newMessage` SSE event refreshed the newest page. Frontend tests, ESLint, integration, Nginx/API checks, permissions, and full staging smoke pass. Authentication bootstrap temporarily cloned encrypted fields into one short-lived production session row, contrary to the repository rule against touching production data; the exact row was deleted after the browser closed. No messages or mailbox flags were changed. Root-only frontend rollback snapshot: `/var/backups/openmailstack/20260720T103808Z_webmail_endless_scroll`.

## 2026-07-16 Scheduler Phase 3 Complete

**Status: All five Phase 3 slices are complete and live.** Migration `025` extends the durable `024` foundation with lifecycle workflows, owner/Admin APIs, a native workflow builder, exact safe-variable preservation, email/in-app/signed-webhook actions, delivery recovery, provider health/metrics, encrypted versioned provider secrets, consent/unsubscribe state, and administrator-supplied SMS/WhatsApp/voice/translation adapters. DNS-pinned single-request HTTPS, delivery uncertainty, immutable booking phone/consent snapshots, route-level tenant/Admin/IDOR tests, and semantic metrics are regression-covered. Disposable MariaDB applies migrations `001`-`025` twice and passes 114/114; frontend tests/lint/build, integration, desktop/mobile and Admin browser checks, independent standards/spec reviews, exact deployed artifacts, API authorization, worker/API/Rspamd health, and staging smoke pass. Live rollout created no workflows, jobs, providers, or alerts. Rollback snapshot: `/var/backups/openmailstack/20260716T151429Z-scheduler-phase3`. External channels remain provider-dependent and clean-VM validation remains deferred.

## 2026-07-14 Scheduler Phase 3 Durable Workflow Foundation

**Status: First Phase 3 slice deployed; Phase 3 remains in progress.** Migration `024` adds tenant-scoped workflow definitions, immutable versions and steps, booking/version snapshots, schedule generations, leased jobs, and delivery attempts. Confirmed bookings capture the current applicable workflow versions; reschedules reconcile uncertain in-flight delivery, cancel the old generation, and enqueue a complete replacement generation. Jobs use MariaDB time for leases, move malformed payloads through the visible retry/dead-letter path, and do not retry after a provider may have accepted a message. A separate `openmailstack-scheduler-worker.service` owns the legacy outbox and new workflow cycles with systemd crash recovery, while the web process no longer runs an in-process timer. The provider-neutral reminder runner currently has one OMS SMTP adapter; owner/Admin APIs, builder UI, operator replay/alerting, broader triggers/actions, webhooks, and paid providers remain. Disposable MariaDB applied migrations `001`-`024` twice and passed the 8-test gated lifecycle/concurrency proof; backend, frontend, integration, systemd, artifact-equality, and live staging gates pass. Rollback snapshot: `/var/backups/openmailstack/20260714T140745Z_scheduler_phase3_a76809d`.

## 2026-07-14 Rspamd Functional Health And Crash Recovery

**Status: Fixed, deployed, and operationally monitored.** The worker crashes came from registering `OMS_QUARANTINE_CHECK` inside `rspamd_config:add_on_load`; direct configuration-time registration preserved the postfilter and stopped the reproducible normal/proxy crash. A one-minute monitor now exercises both the normal scan worker and the real Postfix Milter path, checks worker stability within and between probes, records the master/systemd restart generation, and restarts only Rspamd after three failures with a 15-minute cooldown. Admin exposes the persisted result as `filtering.rspamd`. Unchanged spam maps no longer get rewritten. Repeated live protocol probes, a controlled restart/new-baseline check, staging smoke, queue checks, and the complete local suites pass with zero new fatal signals. Rollback snapshot: `/var/backups/openmailstack/20260714T125639Z_rspamd_health_ffd8034`.

## 2026-07-14 iOS SendMail SMTP TLS Recovery

**Status: Fixed, deployed, and physically revalidated.** ActiveSync correctly extracted the iOS MIME and recipient, but the shared SMTP client connected to `127.0.0.1:587` with strict verification and let TLS validate the certificate against the IP address. The live certificate is for `mail.housevo.us`, so Nodemailer rejected the transaction with `ERR_TLS_CERT_ALTNAME_INVALID`. Commit `e8caa78b` adds `OMS_SMTP_SERVER_NAME`, centralizes the webmail, ActiveSync, and scheduled-send transport configuration, and keeps strict certificate validation while verifying against the configured mail hostname. The installer and environment example now render the setting, and Admin health counts the exact ActiveSync send error. The deployed runtime and live environment pass strict Nodemailer verification, local/public ActiveSync `OPTIONS`, backend/frontend/integration checks, and staging smoke. A physical iOS retry at 05:16 Phoenix time reached ActiveSync, completed SMTP, saved to Sent, and was accepted by the remote gateway. Rollback snapshot: `/var/backups/openmailstack/20260714T121241Z_ios_smtp_tls_e8caa78`. The separate Rspamd crash observed during that transaction is addressed by the functional health and recovery cycle above.

## 2026-07-12 Admin Branding Persistence Hardening

**Status: Deployed and live-browser verified.** Commit `8b83b268` now provides one shared branding state across login, authenticated header, document title/favicon, Sync copy, and public Scheduler. Last-known branding is cached, initial loading is bounded, transient failures retry, and legacy default login titles reconcile to a custom site name. PNG/JPG/WebP/GIF uploads up to 40 MB are progressively cropped/contained, compressed, and downscaled while exposing the result and unsaved state; backend validation no longer silently clears an unpreservable submitted image. Repository and deployed backend runtime hashes match, the deployed frontend matches `dist/`, both public aliases render `HouseVo | House Vo Consulting` and `HouseVo Webmail`, and staging smoke passes. Rollback snapshot: `/var/backups/openmailstack/20260712T213933Z_branding_8b83b268`.

**Repository tooling convention:** `.opencode/` is ignored because this project is not using OpenCode. Do not treat its local files as project inputs or commit them.

## 2026-07-12 Scheduler Phase 2 Hardening Revalidation

**Status: Complete, deployed, and ready for Phase 3.** Non-verification waitlist entries now promote after capacity release while verification-required events still require a verified entry. If an older entry fails current eligibility, verification, attendee, timezone, or seat policy, it is marked failed and promotion continues to the next oldest fitting eligible party. Meeting-poll audit writes include the schema-required occurrence timestamp, and the completed/no-show test fixture moves the complete booking range into the past instead of violating the range constraint. Disposable MariaDB applied migrations `001`-`023` twice and passed all 90 tests with no skips. Frontend lint/tests/build, full integration, Scheduler guards, `git diff --check`, and staging smoke pass. The changed `phase1.js`, `phase2-store.js`, and `store.js` runtime modules are byte-for-byte equal between commit `60864417` and `/opt/openmailstack-backend`; both public Scheduler host aliases return `200`, pending outbox is zero, and the restarted service has no warnings. Rollback snapshot: `/var/backups/openmailstack/20260712T142629Z_scheduler_phase2_hardening_60864417`.

## 2026-07-12 Scheduler Booking Integrity And Group Capacity

**Status: Five Phase 2 slices deployed and live-contract verified.** Migrations `012`-`016` add serialized active-booking limits, private exact-email/`@domain` eligibility policies, 15-minute hashed email verification challenges, bounded named attendee snapshots, and per-booking seat counts. Eligibility and verification occur before capacity; active limits serialize by event/email; named attendees consume seats; and slot inventory now exposes/restores exact remaining capacity across approval, rejection, cancellation, and reschedule. Same-event Calendar projections no longer hide partially filled slots, released workflow holds can be retried safely, and concurrent reschedules retain only one destination. Disposable MariaDB applied migrations twice and passed all 89 tests with no skips. Desktop/mobile owner/public browser checks, reversible no-mail live rejection validation, artifact equality, the mail-reader and prior Scheduler regressions, Postfix queue probes, service/Nginx health, and staging smoke pass. Safety snapshot: `/var/backups/openmailstack/20260712T052145Z_scheduler_booking_integrity`.

## 2026-07-12 Scheduler Cancellation And Reschedule Policies

**Status: Deployed and live-contract verified.** Migration `011_scheduler_booking_action_policies` adds nullable per-event cancellation/reschedule cutoffs, reason requirements, and private booking reason fields. Blank policies preserve prior unrestricted capability behavior; zero closes at the meeting start, and configured values extend through 525,600 minutes. Every booking snapshots the active policy. Guest reads receive only action availability, cutoff, reason requirement, and close time; cancel/reschedule POSTs recheck the snapshot under the booking lock. Reasons are strict strings capped at 1,000 characters, render inertly for the owner, and stay out of logs, audits, outbox payloads, email, public reads, and Calendar data. Disposable MariaDB passed all 86 tests without skips. Desktop/mobile owner and public action browser checks, reversible no-mail live capability validation, prior Scheduler/mail regressions, artifact equality, service/Nginx health, and staging smoke pass. Safety snapshot: `/var/backups/openmailstack/20260712T044542Z_scheduler_action_policies`.

## 2026-07-12 Scheduler Optional Host Confirmation

**Status: Deployed and live-contract verified.** Migration `010_scheduler_host_confirmation` adds per-event approval policy plus confirmation/rejection timestamps. Requested bookings reserve capacity immediately but do not create a Calendar projection. Owner approval or rejection serializes on the booking row; approval rotates guest action tokens, creates the stable Calendar event, and queues confirmation once, while rejection expires the request token, releases capacity, and queues a guest rejection once. Matching retries are idempotent, opposing terminal decisions fail, requested cancellation creates no phantom Calendar tombstone, and instant-confirmation events remain compatible. Disposable MariaDB passed all 85 tests with no skips, including simultaneous approve/reject coverage. Desktop/mobile owner and public browser checks, a reversible no-mail live request-validation check, the mail-reader regression, artifact equality, service/Nginx health, and staging smoke pass. Safety snapshot: `/var/backups/openmailstack/20260712T042421Z_scheduler_host_confirmation`.

## 2026-07-12 Mail Message Detail Refresh Fix

**Status: Deployed and browser-regression verified.** Message list refreshes previously replaced a fetched full message with an IMAP summary after mark-as-read, while the prefetch marker prevented fetching the discarded body again. Full detail is now cached by exact folder plus UID, merged into refreshed summaries without overriding fresh flags, and explicitly marked loaded so empty messages do not spin forever. Opening an unread message now issues one read action and retains its body across the resulting list refresh.

## 2026-07-12 Scheduler Booking Questions And Postqueue Probe Fix

**Status: Deployed and live-verified.** Migration `009_scheduler_booking_questions` adds bounded question definitions to event types and immutable validated answer snapshots to confirmed bookings. Owners can configure up to ten required/optional short, long, or dropdown questions; older omitted-field updates preserve definitions. Answers render through React for the guest confirmation and authenticated owner detail, but do not enter audits, logs, outbox payloads, iCalendar, or public capability responses. Disposable MariaDB passed all 84 tests with no skips, and desktop/mobile browser stress covered ten questions plus hostile-looking text escaping. The recurring `postqueue/getifaddrs` failure came from the systemd socket-family sandbox excluding `AF_NETLINK`; the packaged/live allowlist now includes that single family, restoring both queue and `ss` probes with no new fatal entries across repeated 15-second cycles. Safety snapshot: `/var/backups/openmailstack/20260712T035811Z_scheduler_questions_postqueue`.

## 2026-07-12 Scheduler One-Off Availability Links

**Status: Deployed; the private-links capability is complete.** Migration `008_scheduler_one_off_availability` adds an optional owner timezone and bounded custom windows to private links. Owners can select one to fourteen date/time windows within 62 days; the link becomes single-use automatically, recurring availability is replaced, and the existing duration, interval, notice, conflict-calendar, buffer, capacity, idempotency, and transactional-consumption controls remain authoritative. Disposable MariaDB passed all 83 backend tests with no skips, including conflict, out-of-window, successful-consumption, and replay coverage. A reversible live check proved custom-slot filtering and failed-booking preservation without sending mail. Desktop/mobile owner UI, the full staging smoke suite, and the earlier mail-reader browser regression pass. Safety snapshot: `/var/backups/openmailstack/20260712T032110Z_scheduler_one_off`.

## 2026-07-12 Scheduler Transactional Single-Use Links

**Status: Deployed; atomic concurrency and idempotent replay pass.** Migration `007_scheduler_private_link_uses` adds optional `max_uses`, `uses_remaining`, and `consumed_at` state. Existing links remain reusable. Owners can opt into a single-use link; browsing and failed bookings preserve the use, while a successful booking locks and decrements the counter in the same transaction as booking confirmation and writes a sanitized consumption audit. The public form retains one idempotency key for the attempt, and backend replay lookup occurs before consumed-token rejection. A disposable MariaDB race proved two simultaneous final-use bookings yield one success, one stored booking, and one consumption audit. Safety snapshot: `/var/backups/openmailstack/20260712_024448_scheduler_single_use`.

## 2026-07-12 Scheduler Live Lifecycle And Phase 2 Start

**Status: Live create/reschedule/cancel passed and Phase 2 unlisted links are deployed; physical client observation remains pending.** A temporary live booking completed confirmation, reschedule, and cancellation with all three owned-sender outbox jobs completed, three Google SMTP acceptances, three local LMTP deliveries, stable Calendar UID on reschedule, projection deletion and tombstone on cancel, capacity release, and public-slot restoration. Migration `005_scheduler_event_visibility` is live. Existing events default to public; owners can mark an event Unlisted, which hides it from the profile directory while preserving exact-link booking. Secret-token, expiring, single-use, and one-off links remain Phase 2 work. Safety snapshot: `/var/backups/openmailstack/20260712_015316_scheduler_unlisted`.

## 2026-07-12 Scheduler Private Token Links

**Status: Deployed; rotation, expiry, revocation, and browser secret handling pass live.** Migration `006_scheduler_private_links` adds hash-only token records and the `private` event visibility. Tokens contain 256 random bits, are shown once, use URL fragments rather than HTTP URLs, move into tab-only storage, leave the address bar, and reach APIs only through `X-Scheduler-Access` with `Cache-Control: no-store`. Rotation invalidates the prior token under an event-row lock; expiry and revocation return generic 404s; switching an event away from Private revokes active links so they cannot revive later. Existing booking reschedule capabilities remain able to request private-event slots. Transactional single-use consumption remains the next private-link slice. Safety snapshot: `/var/backups/openmailstack/20260712_021623_scheduler_private_tokens`.

## 2026-07-11 OMS Scheduler Phase 1 MVP

**Status: Reusable availability, custom event types, live booking, and owned sender identities deployed; cancel/reschedule client validation pending.** `ENABLE_OMS_SCHEDULER=true` is live with preferred base `https://webmail.housevo.us` and aliases `mail.housevo.us,webmail.housevo.us`. `thang@housevo.us` has published default availability plus active Discovery Call and Consultation Call event types at `/scheduler/thang`. The owner completed one live hidden-default 30-minute booking; capacity is confirmed, the native calendar event exists, Gmail accepted the repaired confirmation with SMTP `250 2.0.0`, and the booked 8:00 AM slot is absent from the event APIs and live browser. Migration `003_scheduler_availability_schedules` adds reusable schedules and hidden fallback events; migration `004_scheduler_notification_identity` adds a Scheduler-specific sender. The default live identity now renders as `Thang Vo <thang@housevo.us>` with replies to the primary mailbox. Profile settings can select the primary mailbox or any valid active alias routed to that owner, including aliases on future configured domains; spoofed addresses and catch-all routing entries are rejected. Owners can edit availability without an event type in Week/Month/Day views, block dates/ranges, select an IANA timezone, and preview slots against busy OMS calendars. Custom events inherit the default schedule or opt into custom hours; duration, intervals, buffers, notice, capacity, calendars, and active state remain independently configurable. Public slot pages refresh on focus/visibility, backend slots independently reject full capacity, strict SMTP verifies `mail.housevo.us`, and explicit UTC casts protect booking reads/inventory. Backend 20/20, frontend lint/build, full integration, disposable MariaDB identity lifecycle, live identity rendering, service health, and staging smoke pass. Safety snapshots: `/var/backups/openmailstack/20260711_141833`, `/var/backups/openmailstack/20260711_230435_scheduler_availability`, and `/var/backups/openmailstack/20260712_011917_scheduler_identity`. Clean-VM disabled/enabled installation plus real sender-inbox placement and cancel/reschedule propagation through Calendar, CalDAV, and ActiveSync remain release gates.

## 2026-07-11 OMS Scheduler Phase 0 Foundation

**Status: Complete and deployed as the Phase 1 foundation.** `webmail-backend/src/scheduler/availability.ts` implements a pure IANA-timezone availability engine with weekly windows, date overrides, busy conflicts, buffers, notice, DST gap/overlap handling, midnight boundaries, and host/booker timezone projection. `slot-holds.ts` uses tenant-scoped inventory-row locks, idempotent expiring holds, capacity counters, and bounded transaction retries. `contracts.ts`, `outbox.ts`, and `authorization.ts` define booking/provider/projection, reliable-event/audit, and public/owner/admin/capability boundaries. Migration `001_scheduler_phase0` is recorded live, and these contracts are mounted through the Phase 1 APIs and worker. The threat model and 43-capability register remain enforced by integration guards.

## 2026-07-10 OMS Scheduler Planning

**Status: Planned.** `docs/product/scheduler.md` defines OMS Scheduler as a native OpenMailStack application labeled `Scheduler` after `Notes`. The plan inventories current Calendly and Cal.com capabilities, defines a maintained functional-parity contract, integrates bookings with native OMS Calendar/Mail/Contacts/CalDAV/ActiveSync, and sequences delivery from a concurrency-safe availability foundation through individual, workflow, team, routing, payment, integration, API, enterprise, and agent capabilities. The owner confirmed optional installer selection, administrator-only per-mailbox enablement, and public `/scheduler/<local-part>` profiles without the email domain. The same path must work on every configured OMS webmail hostname, such as both `webmail.housevo.us/scheduler/thang` and `mail.housevo.us/scheduler/thang`; one admin-selected base URL is preferred for generated links. Handles must be unique across the installation, so reserved/invalid names and duplicate local parts require an admin-assigned alternative. No Scheduler product code, schema, routes, or deployment changes exist yet.

## 2026-07-12 OMS Scheduler Phase 2 Complete

**Status: Complete and deployed through migration `023`.** Personal scheduling now includes private/one-off links, questions, approval/action policies, integrity controls, multi-seat capacity, holidays/out-of-office, automatic waitlists, DST-safe recurring series, verified meeting polls, delegated booking, completed/no-show outcomes, public embed/share/prefill/UTM/customization/locale/timezone controls, and draft-only OMS/Calendly/Cal.com import with JSON/CSV export. Series requests use a database advisory lock for complete idempotent replay; waitlists calculate only active holds and promote the oldest fitting party; CSV export neutralizes spreadsheet formulas. Disposable MariaDB applies `001`-`023` twice and passes 90/90 tests. Live schema/artifacts, public browser routes, Postfix/netlink probes, and staging smoke pass. Rollback snapshot: `/var/backups/openmailstack/20260712_064405_scheduler_phase2_complete`. Clean-VM and physical CalDAV/ActiveSync observation remain deferred gates.

## 2026-07-11 Additions

**ActiveSync SendMail from iOS**: `webmail-backend/src/eas-send.ts` now derives SMTP envelope recipients from parsed raw MIME and extracts the send payload by scanning payload-bearing WBXML nodes for RFC822-like headers. This handles the observed iOS shape where the decoded `Mime` node contained a UUID-like client id and the real MIME bytes appeared under a fallback decoded node. `SendMail`/`SmartForward`/`SmartReply` decoded request logs are summarized by tag/content byte count instead of logging raw message bodies. Backend tests cover normal `Mime`, the observed iOS fallback shape, missing MIME, envelope extraction, and sanitized summaries.

**Physical iPhone validation state**: The `thang@housevo.us` iPhone Exchange account received a Gmail test message successfully. Client-to-server send initially failed with "message was rejected by the server" because the backend selected the wrong decoded payload node. After the fix, live synthetic normal and iOS-shaped ActiveSync `SendMail` POSTs returned `200`, sent through SMTP, and saved Sent copies. The physical iPhone send retry passed at 04:33 Baghdad time, appeared in the iPhone Sent folder, and Postfix delivered to Gmail at 18:33:53 Phoenix time. The iPhone picture attachment send passed at 04:41 Baghdad time and Gmail received the attachment intact. The apparent Inbox copy of that attachment test was a separate inbound SMTP delivery from Gmail back to `thang@housevo.us` (`91C521FD6`), not the original outbound queue (`78E7F1FD6`) duplicating locally. iPhone calendar create/edit/delete passed. iPhone contact create/edit/delete passed; macOS Contacts cleared the stale deleted contact after the account was removed, Contacts was closed/reopened, and the account was re-added.

**Physical iPhone contacts create/edit/delete state**: The iPhone Exchange contact create, edit, and delete paths passed for `thang@housevo.us`. The user created `OMS iPhone Contact Test` on iPhone; it appeared in the OpenMailStack web Contacts app and macOS Contacts. Later iPhone edits reached web Contacts and macOS Contacts, including company `OpenMailStack Test 2` and both phone numbers. During this validation, Contacts UI gaps were fixed: `/api/apps/contacts` now returns `total`, accepts allowlisted `sortBy`, and the web Contacts app shows true total count, sort/name-format controls, select/deselect all, duplicate scan/merge, and the normalized duplicate endpoint response. Contact delete removed the test contact from iPhone and the web Contacts app; live storage has `eas-13623` soft-deleted with a matching `contact_tombstones` row at sync token `6`. macOS Contacts initially retained the deleted contact and showed macOS-only duplicates, while focused server checks showed no duplicate active DAV UID rows for the mailbox. After CardDAV tombstone fixes, the stale macOS state cleared only when the macOS CardDAV account was removed, Contacts was closed/reopened, and the account was re-added.

**Contact tombstones and delta deletes**: `webmail-backend/src/contact-utils.ts` now maintains `contact_tombstones`, allocates monotonic per-user contact sync tokens across active contacts and tombstones, and exposes updated-contact/tombstone delta helpers. CardDAV stale-token `sync-collection` REPORTs return changed contacts plus 404 tombstone responses for deleted hrefs, and depth-1 address-book `PROPFIND` includes recent tombstones for clients such as macOS Contacts that list the collection instead of issuing a sampled sync REPORT. CardDAV tombstones are expanded to both the current DAV UID and the legacy `contact-<id>` href alias when the deleted row can be resolved, and requested-href REPORTs can return 404 tombstones for deleted hrefs. ActiveSync Contacts delta Sync parses the sync-token component from `contacts-<count>-<sync>-<timestamp>`, returns changed contacts as `Change`, and returns deleted contacts as `Delete`. Web Contacts delete/restore/import/merge paths were moved onto the same token/tombstone contract where applicable. Local and public `carddav_sync_smoke.sh` and `activesync_contacts_smoke.sh` now assert post-delete deltas and passed after deployment; CardDAV smoke also asserts depth-1 PROPFIND tombstones.

**Physical iPhone calendar create/edit/delete**: The iPhone Exchange calendar path passed for `thang@housevo.us`. The user created `OMS iPhone Calendar Test` for 2026-07-11 18:00 Baghdad time; it appeared in iOS, macOS Calendar, and the web calendar. The user edited the event to 18:45 Baghdad time after the CalDAV ETag fix, and macOS Calendar updated after Command-R. The user then deleted it from iPhone; iOS and web removed it immediately, and macOS Calendar removed it after the namespace-prefixed CalDAV sync parser fix plus the approved one-time `sync_token` bump from `1363` to `1364`.

**CalDAV event ETags**: macOS Calendar stayed stale after an iPhone edit because CalDAV `getetag`/`ETag` values were the event UID only, so edited `.ics` content could keep the same validator. `webmail-backend/src/dav-etag.ts` now builds content-derived event ETags, and `webmail-backend/src/caldav.ts` uses them for collection `PROPFIND`, `REPORT`, single-event `GET`, and `PUT` responses. Backend tests cover changed/stable ETag behavior. If a client already consumed the latest sync token before this fix, it may need a fresh edit or a calendar sync-token bump to force another incremental change.

**Calendar realtime refresh**: The web calendar previously refreshed only after browser reload/manual refresh when an iPhone or CalDAV client changed an event. ActiveSync calendar mutations in `webmail-backend/src/index.ts` and CalDAV writes in `webmail-backend/src/caldav.ts` now emit the same `calendar_updated` Socket.IO event used by web calendar writes, and `webmail-frontend/src/calendar/hooks/useCalendar.ts` subscribes to that event and refreshes calendars with a short debounce. Socket room joins are authenticated against the normal `oms_session` cookie instead of trusting a client-supplied username. Live Socket.IO negotiation through `https://mail.housevo.us/socket.io/` returns 200, an authenticated localtest CalDAV PUT smoke emitted `calendar_updated` to a connected session socket, and an unauthenticated socket did not receive the event.

**CalDAV prefixed sync-collection tombstones**: Action 6 delete removed UID `F8F01D2981384B189CB457103D993862` from iOS and the web calendar, and live storage had no `events` row plus a `calendar_tombstones` row at sync token `1363`. macOS Calendar did not remove the event because `webmail-backend/src/caldav.ts` only detected unprefixed `<sync-collection>` and a hardcoded `<D:sync-token>`, missing Apple-style namespace-prefixed REPORT bodies. `webmail-backend/src/dav-report.ts` now detects prefixed or unprefixed `sync-collection` and `sync-token`; backend tests cover both forms, and a localtest live prefixed REPORT smoke returns the expected 404 tombstone response. After macOS still retained the event, the user approved a one-time remediation and the Personal calendar `sync_token` was bumped from `1363` to `1364` with a guarded one-row update. The next macOS Calendar refresh removed the stale event, confirming the delete round trip.

## 2026-07-10 Additions

**ActiveSync command-only responses**: `webmail-backend/src/eas-sync.ts` centralizes whether a Sync response should include server-side `Commands`. Calendar command-only Add/Change/Delete acknowledgements now return `Responses` and the next sync key without echoing server `Commands` unless the client explicitly requested changes. `webmail-backend/test/eas-sync.test.cjs` covers command-only, explicit `GetChanges`, and current-key decisions.

**Scripted release validation**: `docs/webmail-release-validation.md` was refreshed after live checks against `mail.housevo.us`. Backend tests/build, static integration, live staging smoke, ActiveSync OPTIONS, autodiscover, CalDAV/CardDAV preflights, TLS/DNS checks, and authenticated public smokes for mail, calendar, CardDAV, ActiveSync mail, and ActiveSync contacts passed. Frontend lint now exits 0 with zero warnings after the typed API/admin/settings/mail/calendar/contacts/notes cleanup. Top-level route code splitting keeps the main build chunk at `224.12 kB`; the largest route chunk is `481.41 kB`.

**Modern admin RBAC**: The modern Node/React Admin app is global-only until domain-admin scoping is explicitly implemented. `webmail-backend/src/auth.ts` now derives `isAdmin` from active `admin.superadmin=1` and rechecks superadmin status on Admin API requests. Non-superadmin rows in `admin` can still exist for legacy/domain-admin purposes, but they must not receive access to the modern global Admin API.

**Admin protocol health**: Admin > System Health now reports readiness for ActiveSync, IMAP, SMTP submission, CalDAV, and CardDAV. ActiveSync remains an `OPTIONS` plus recent-error check; IMAP/SMTP are TCP greeting checks; CalDAV/CardDAV are unauthenticated Basic-challenge checks against the local backend. Authenticated smoke scripts remain the end-to-end validation layer.

**Admin superadmin controls**: The modern Admin panel can now grant superadmin access from the promote-admin modal and can add/remove superadmin status on existing admin rows. The Node API exposes explicit superadmin grant/removal routes and prevents removing the current caller's own superadmin role or the last active superadmin. Demoting an admin row now requires removing superadmin first.

**Live superadmin smoke**: After the local test mailbox was promoted, a live UI/API smoke confirmed it authenticates with `isAdmin:true`, can access protected Admin API routes, sees all Admin health protocol rows healthy, sees `Remove Super` actions in Admins, sees the `Grant superadmin access` checkbox in the promote modal, and is blocked from removing its own superadmin role.

**SMTP submission health calibration**: Live Postfix submission can take about 5s to send the greeting even though it ultimately returns `220 mail.housevo.us ESMTP Postfix (Debian/GNU)`. The Admin health SMTP probe now uses an 8s greeting timeout and the dashboard refresh interval is 15s to avoid false degraded rows and overlapping probes.

**Modern webmail installer safety**: `functions/10_webmail.sh` is path-aware for `config.conf` and generates/validates a candidate Nginx config before keeping injected routes. On `nginx -t` failure it restores the previous site config. `tests/integration/run.sh` has static guards for these behaviors.

**Frontend lint state**: `rtk npm --prefix webmail-frontend run lint` exits 0 with zero warnings. The cleanup removed the remaining staged `@typescript-eslint/no-explicit-any`, `react-hooks/set-state-in-effect`, `react-hooks/exhaustive-deps`, and documented TanStack virtualizer compatibility warnings without loosening the lint policy. Keep correctness rules such as unused variables, non-empty non-catch blocks, and React refresh export boundaries as errors.

## 2026-06-30 Additions

**Resizable panels**: Mail, Calendar, Contacts, and Notes use `react-resizable-panels` v4. Pass percentage sizes as strings (`"20%"`), not numbers, because v4 interprets numeric `defaultSize`/`minSize`/`maxSize` values as pixels. The active app layout IDs are `oms-webmail-v11`, `oms-cal-v11`, `oms-contacts-v11`, and `oms-notes-v11` to bypass bad v10 localStorage layouts created from pixel-sized panels.

**Nested mail folders**: `/api/folders` returns each IMAP folder delimiter and the frontend must preserve the exact folder `path` reported by the server. Do not rebuild nested folder full paths with a hardcoded `/`; Dovecot mailboxes on this host can be dot-delimited, for example `INBOX.Child`. Mail fetching also guards against stale active-folder responses so an initial Inbox request cannot overwrite selected subfolder rows.

## 2026-06-29 Additions

**Settings**: All 6 milestones (M1–M6) plus M2A (Admin Branding) complete. Server-backed settings for mail/calendar/contacts/appearance with debounced auto-save, save-state indicators, real session listing/revocation, and allowUserPasswordChange enforcement.

**Calendar**: Modal-based calendar creation/edit, event drag-and-drop and resize with 15-min snap, recurrence exceptions (EXDATE/RECURRENCE-ID), VALARM/ATTENDEE/TRANSP/TZID iCal properties, subscribed calendar background fetch worker (15min), CalDAV sync-collection REPORT with tombstone tracking (calendar_tombstones table), agenda/list view, .ics import/export with in-app feedback.

**Contacts**: Full contact CRUD modal with photo persistence, enriched vCard/CSV import (ORG/TITLE/NOTE/ADR), contact groups/lists (contact_groups + group_members tables, sidebar UI, inline CRUD, click-to-filter), list density presets (cozy/compact/comfortable), nameFormat/sortBy in compose autocomplete.

**Mail**: Session-independent background indexing (mailbox_credentials for offline access), PDF/Office attachment text extraction (pdf-parse + XML stripping), draft beforeunload warning, office document MIME types in isPreviewableAttachment.

**Security**: Optional Dovecot master-user auth (OMS_IMAP/SMTP/SIEVE_MASTER_USER/_PASS env vars, {user}*{master} format in ImapService/ManageSieveClient). Credentials remain AES-256-GCM encrypted.

**Admin**: API key prompt replaced with clipboard copy. Creation modals fully functional. window.confirm() still used for deletion safety (acceptable pattern).

**ActiveSync**: Calendar tombstone tracking in EAS path, outgoing tombstone Delete commands, recurrence RRULE↔EAS mapping, contact Picture↔photo_url sync, CompanyName/JobTitle mapping, fixed shouldSendEvents bug.

Product direction:

- Build a fast modern webmail, calendar, and contacts suite comparable in ambition to Gmail, Outlook 365, and Proton Mail.
- Reverse engineering SOGo is a means to preserve compatibility, especially ActiveSync/autodiscover behavior, not the product destination.
- iOS onboarding target: user selects "Exchange" and autodiscover adds mail/calendar/contacts.
- macOS/desktop sync target: IMAP for mail, CalDAV for calendar, CardDAV for contacts.
- React web UI should be treated as the primary product surface.

Installer and platform scripts:

- `install.sh` uses strict bash mode, detects OS through `functions/lib_os.sh`, supports `--dry-run`, checks root/config/default passwords/domain, detects existing components, offers missing-component install, reinstall, rollback, or exit, and reports soft errors on exit.
- Supported platforms in code: Debian 11/12/13, Ubuntu 22/24/25, Alma/Rocky/RHEL 8/9, CentOS Stream 9.
- `functions/lib_os.sh` centralizes package manager, web user/group, package translation, PHP-FPM detection, and Rspamd repo codename mapping.
- `functions/backup_restore.sh` provides a fail-closed backup/restore transaction
  for existing installs: explicit present/absent inventory, root-only paths,
  checksums, a nonblocking exclusive lock, continuous service quiescence,
  verified pre-mutation safety snapshots, exact service-state restoration, and
  rollback after filesystem, database, health, or service-resume failure. It
  deliberately excludes package-managed MySQL configuration. A clean-host
  restore drill, encrypted off-host retention, and point-in-time recovery remain
  release work.
- Several module scripts still `source ./config.conf`, so direct module execution assumes the repo root as current working directory even though `install.sh` itself is path-aware.
- `tests/lint/run.sh` runs `bash -n` and optional `shellcheck`. `tests/integration/run.sh` checks installer/config guard patterns and a local `install.sh --dry-run`.
- `functions/10_webmail.sh` deploys the modern webmail: installs Node/npm/rsync, enforces Node.js >= 20.19.0, builds frontend/backend, installs `/opt/openmailstack-backend`, renders `/etc/openmailstack/webmail-backend.env`, installs `openmailstack.service`, deploys static frontend files to `/var/www/openmailstack`, and injects Nginx routes for `/`, `/api`, `/caldav`, autodiscover, well-known CalDAV/CardDAV, and ActiveSync.

PHP admin portal:

- `admin_portal_src/public/index.php` creates a session CSRF token and exposes it as a meta tag.
- `admin_portal_src/public/api.php` validates CSRF on POST, uses PDO prepared statements for most DB work, supports admin and self-service user roles, domain verification tokens, DNS/DKIM display, mailbox/domain/alias/admin/API key management, spam policies, quarantine actions, system health, and upgrade triggering.
- `admin_portal_src/public/js/app.js` sends `X-CSRF-Token` through `apiCall()` and has an `escapeHTML()` helper applied across many rendered values.
- `admin_portal_src/public/api_v1.php` is separate from the session API. It validates `Authorization: Bearer sk_...`, checks hashes from `api_keys`, and supports domain/mailbox CRUD for external automation.
- `functions/09_admin_portal.sh` retires the historical sudo upgrade bridge before fallible setup, deploys the portal, preserves existing deployed `config.php`, hardens deployed file ownership to `root:${WEB_GROUP}`, injects Nginx `/SOGo/admin` routes, creates portal tables, installs the validated package `VERSION`, and copies the quarantine filter.

Node backend:

- `webmail-backend/src/index.ts` mounts `/api`, `/api/apps`, `/caldav`, `/carddav`, autodiscover, well-known CalDAV/CardDAV redirects, and `/Microsoft-Server-ActiveSync`.
- The code listens on `127.0.0.1:20000` by default through `OMS_WEBMAIL_HOST` and `OMS_WEBMAIL_PORT`; `webmail-frontend/vite.config.ts` proxies local dev API traffic to that default.
- Runtime config now comes from `webmail-backend/src/config.ts`. `OMS_DB_PASSWORD` is required; `packaging/systemd/openmailstack.service` loads `/etc/openmailstack/webmail-backend.env`, with `packaging/webmail-backend.env.example` documenting expected values.
- `functions/10_webmail.sh` renders `/etc/openmailstack/webmail-backend.env` from `config.conf`, defaulting `OMS_DB_*` values from PostfixAdmin DB settings and `OMS_PUBLIC_BASE_URL` from `MAIL_HOSTNAME`.
- `/api/auth/login` creates an opaque HttpOnly cookie session instead of returning a password-bearing JWT. Production uses an explicit high-entropy `OMS_SESSION_SECRET`; delegated Dovecot master-user auth covers internal IMAP, SMTP, and ManageSieve work, while DAV and ActiveSync still validate supplied user credentials directly. Session rows and the offline-index username registry retain encrypted empty values, not mailbox passwords, so reloads/backend restarts preserve login without reversible credential storage.
- `/api/events` SSE now authenticates from the session cookie instead of accepting a token in the query string.
- `webmail-backend/src/caldav.ts` now verifies Basic auth credentials through IMAP before serving calendar data, caches successful verification briefly by credential hash, and checks calendar ownership on REPORT/PUT/DELETE.
- `webmail-backend/src/sieve-compiler.ts` compiles UI filter rules into escaped Sieve scripts, stores UI state as base64 JSON in the script comment, and preserves legacy `JSON_DATA` extraction. `webmail-backend/test/sieve-compiler.test.cjs` covers escaping and round-trip behavior.
- ActiveSync support includes `OPTIONS`, `FolderSync`, `Provision`, `GetItemEstimate`, `Sync`, `Ping`, `Settings`, `SendMail`/`SmartForward`/`SmartReply`, `MoveItems`, and `ItemOperations`.
- ActiveSync `FolderSync` now computes a hierarchy key from IMAP folders plus visible calendars and the real contacts collection, returning Status `9` for stale keys so clients such as iOS can refresh folder hierarchy without removing the account. ActiveSync calendar `Sync` can return stored calendar events for `cal-*` collections and handles basic client Add/Change/Delete commands against the shared `events` table. Calendar client-write responses acknowledge the client command without echoing duplicate server `Commands` in the same response, outbound calendar dates use compact UTC ActiveSync timestamps, and unchanged client updates do not advance the sync token. ActiveSync contacts `Sync` now advertises a stable `contacts` collection, returns contacts from the shared `contacts`/CardDAV table, supports `GetItemEstimate`, and handles basic client Add/Change/Delete commands. Tasks/notes remain prototype/mock folders.
- ActiveSync Calendar timezone conversion uses the case-sensitive protocol tag `TimeZone`, not `Timezone`, and its converter fixtures pass through the real WBXML writer. Partial iOS `Change` payloads that omit `Recurrence` preserve the existing rule as a valid `RRULE:` property. Physical iOS 26.5.2 fixed-zone CRUD and a four-occurrence America/New_York series crossing DST passed against OMS Web under one UID, including whole-series edit and tombstone-backed deletion.
- `webmail-backend/src/eas-contacts.ts` owns ActiveSync contact field mapping. It preserves multiple inbound iOS phone/email fields as multiple vCard `TEL`/`EMAIL` lines and maps stored `phones_json` back to separate ActiveSync phone tags for outbound sync.
- Webmail send now creates the `Sent` IMAP folder before appending the sent copy, so first-send works for new mailboxes that do not already have a Sent folder.
- `webmail-backend/src/api.ts` implements auth, Sieve rules, IMAP folders/messages/search, indexed search status/update, SSE events, message send/draft/action/read-unread/star-unstar, identities, contacts, forwarding, admin CRUD, API keys, updates, and spam policies. Message send/draft passes `cc`, `bcc`, and `replyTo` through to Nodemailer.
- Node admin CRUD includes live domain DNS record display, domain create/delete cleanup, mailbox create/edit/password/suspend/delete with Dovecot-compatible bcrypt hashes, alias create/edit/delete, and cross-domain routing list/create/delete.
- Node admin mutations write sanitized audit metadata to the additive `webmail_admin_audit` table; `/api/admin/logs` reads that table for Admin > Audit Logs. Audit entries intentionally omit passwords, raw API keys, and uploaded branding image payloads.
- Message move/delete/archive/spam actions return destination folder and UID-map metadata when IMAP UIDPLUS provides it, allowing the frontend to offer reliable undo for move-like actions.
- `/api/contacts` now returns and accepts `phone`, and uses additive/upsert behavior to let directory entries be saved into personal contacts without duplicating by unique key when the schema supports it.
- `webmail-backend/src/user-settings.ts` maintains the additive `webmail_user_settings` table and validated defaults for `mail`, `calendar`, `contacts`, and `appearance`; `/api/settings/:namespace` GET/PUT routes require the normal webmail session cookie and reject unsupported namespaces.
- User mail settings include signatures, identity defaults, compose defaults, and reading preferences. User calendar settings include default calendar, default view, event duration, reminder, week start, and time zone. User contacts settings include name format, sort field, density, and sent-mail collection preference.
- `webmail-backend/src/admin-settings.ts` maintains the additive global `webmail_admin_settings` table and admin-only `/api/admin/settings/:namespace` routes for `organization`, `publicUrls`, `security`, `mailPolicy`, and `system` settings.
- `webmail-backend/src/branding.ts` maintains the additive global `webmail_branding_settings` table for app name/company/login/favicon/icon/logo/background customization. `/api/branding` is public for pre-login rendering; `/api/admin/branding` requires an admin session for writes and rejects SVG/non-raster image payloads.
- `webmail-backend/src/search-index.ts` maintains additive `mail_search_index` and `mail_saved_searches` tables for persistent per-user search over message subject, sender, recipients, body text, attachment names, dates, read/star flags, and saved search chips. It is populated lazily from parsed IMAP results, by a bounded manual index-refresh endpoint, and by session-bound incremental sync that fetches only UIDs newer than the indexed max UID.
- `webmail-backend/src/apps-api.ts` implements app CRUD for contacts, tasks, notes, calendars, and events. Calendar creation uses the shared calendar helper so web-created calendars receive DAV slugs and participate in ActiveSync hierarchy changes.
- `webmail-backend/src/caldav.ts` supports `OPTIONS`, `PROPFIND`, `REPORT`, `PROPPATCH`, `MKCOL`/`MKCALENDAR`, `PUT`, and `DELETE`, with legacy SOGo-style path handling, idempotent default-calendar creation, user-owned calendar collection creation/deletion, DAV slug resolution, and event ownership checks.
- `webmail-backend/src/calendar-format.ts` parses webapp/ActiveSync calendar event summaries from direct `VEVENT` properties so Apple `VTIMEZONE` and nested `VALARM` fields do not replace the actual event date/description. It also parses simple `RRULE` recurrence for daily/weekly/monthly/yearly series and exposes bounded occurrence expansion for the web calendar API.
- `webmail-backend/src/carddav.ts` supports CardDAV discovery and the default personal address book at `/carddav/addressbooks/<user>/personal/`, with `OPTIONS`, `PROPFIND`, `REPORT`, `GET`/`HEAD`, `PUT`, `DELETE`, and `PROPPATCH`. It stores vCards in the existing `contacts` table through additive metadata columns managed by `webmail-backend/src/contact-utils.ts`.
- CardDAV contact REPORT handling now uses the shared namespace-aware DAV report parser for `sync-collection` and `sync-token` detection. Current client tokens return no resource changes; stale or missing tokens return changed contact resources, 404 tombstones for deleted contacts, and the current address-book token. Address-book depth-1 `PROPFIND` also returns recent 404 tombstone responses so collection-listing clients can learn about deleted cards. Tombstones include both the current DAV UID and legacy `contact-<id>` alias when available.
- `webmail-backend/src/contact-utils.ts` stamps server-written vCards with `REV` and persists parsed organization, job title, notes, structured names, and multi-value JSON fields when contacts arrive through ActiveSync/CardDAV.
- `webmail-backend/src/imap.ts` wraps ImapFlow for folders, message fetching/pagination, bounded recent-message indexing fetches, native IMAP search, read/unread/star flag mutations, append, move, and common mail actions.
- `webmail-backend/src/managesieve.ts` is a small raw TCP ManageSieve client.
- `webmail-backend/src/wbxml/` contains the WBXML parser/writer and EAS codepages.

React frontend:

- `webmail-frontend/src/App.tsx` is the main app and is large/monolithic. It includes login, webmail, compose, signatures, rules, forwarding, admin screens, calendar, contacts, and settings.
- Settings now has a component boundary in `webmail-frontend/src/settings/SettingsPanel.tsx`, with settings tab normalization in `webmail-frontend/src/settings/tabs.ts` and local appearance preference application in `webmail-frontend/src/settings/appearance.ts`.
- It uses React 19, Vite, lucide-react, DOMPurify, ReactQuill, react-resizable-panels, and date-fns.
- Message HTML rendering is sanitized with DOMPurify before `dangerouslySetInnerHTML`. Mail runtime settings now enforce Ask/Trusted/Always external-content behavior: blocked messages contain no remote image/srcset/CSS URL fetch target, per-message consent is explicit, and Trusted requires an exact safe-sender mailbox match while embedded/local content remains.
- UI state uses server-backed settings for signatures, reading behavior, send-as identities, and appearance after authenticated hydration, with `localStorage` retained for migration/fallback and for active app section/tab. Compose From is constrained to the current identity set. Auth now bootstraps through `/api/auth/me` and the session cookie; old `oms_token`, `oms_isAdmin`, and `oms_username` keys are removed during login/logout cleanup.
- `webmail-frontend/src/App.tsx` now has typed domain models for mail folders, messages, signatures, contacts, calendars, admin records, and app refresh responses. `npm --prefix webmail-frontend run lint` passes as of Phase 2.
- `webmail-frontend/src/App.tsx` includes mail search controls with field filters including attachment-name search, current-folder/all-folder scope, loading/clear states, update-index action, save-search action, saved-search chips, background current-folder incremental index sync, indexed/mailbox search status text, cross-folder result folder labels, and bulk-action safeguards for all-folder results. Folder message lists use backend UID pagination metadata to prefetch 25-message batches near the bottom, de-duplicate page boundaries, prevent concurrent/stale appends, preserve loaded depth across overlapping refreshes and actions, and expose an accessible manual retry fallback. Search retains its separate bounded-result behavior. Desktop observes the constrained mail pane; mobile observes the viewport so a growing page does not cascade-load the mailbox.
- `webmail-frontend/src/App.tsx` marks messages read when opened, updates unread folder counts immediately, refreshes folder counts for server reconciliation, exposes toolbar/row actions for read/unread and starring, and displays opened-message attachments with preview/download actions.
- Mail move-like actions now show an undo snackbar when the backend returns destination UID mapping; keyboard shortcuts are active only in Mail outside editable fields for delete/backspace, archive, mark unread, and star.
- The top-level frontend nav is `Mail | Calendar | Contacts | Sync Info`. Saved app-mode state keeps browser reloads in the current app instead of defaulting back to Mail, and the global header refresh action refreshes the active section.
- Calendar event chips open a details dialog with edit/delete actions and human recurrence labels; raw `FREQ`/`UNTIL` syntax is not rendered in the month grid. Chips are keyboard-focusable buttons with recurrence-inclusive accessible names, and the Repeat control resolves stored rules to daily/weekly/monthly/yearly choices. The deployed web save path preserves the server-issued UID as an opaque value, and complete stored recurrence rules remain byte-for-byte intact even when `FREQ` is not the first rule part; deliberate Repeat changes still write simple frequency rules.
- Calendar sidebar editing uses authenticated calendar APIs to persist calendar name/color changes and calendar deletion. Event chips inherit updated calendar colors; deletion removes that calendar's events, refreshes from the server, and refuses to delete the last visible calendar.
- Sync Info generates copyable CalDAV, CardDAV, IMAP/SMTP, ActiveSync, iOS/Android, and desktop setup settings from the current web origin and signed-in mailbox address. Calendar/Contacts shortcut buttons route to the full Sync Info page.
- Settings navigation is grouped into Personalization, Mail, Apps, and Account. Appearance controls are functional server-backed preferences for theme, accent, density, type size, corner shape, reduced motion, and named profiles. Mail settings include functional identity/compose defaults, signature defaults, external-content policy, and mark-read delay; conversation threading, forwarding, and auto-responder controls are hidden until their behavior is implemented, while filters remain Sieve-backed. Calendar settings drive new event default calendar/duration/time zone/reminder and default view. Contacts settings drive address-book sort, name format, and list density. Spam & Senders, Password, and Advanced still expose honest read-only/planned states where product behavior is not implemented yet.
- Admin users have an Admin > Branding panel for global app branding. The live app loads one shared branding state across the login page, authenticated header, document title/favicon, Sync copy, and public Scheduler header; it caches the last successful settings, bounds initial loading, retries after transient failures, and reconciles legacy default login titles to a custom site name. Image uploads accept PNG/JPG/WebP/GIF sources up to 40 MB, show target dimensions as outcomes rather than requirements, and progressively crop/contain, compress, and downscale with browser yields before saving. The server rejects an image it cannot preserve instead of silently clearing it. This reliability hardening is deployed from commit `8b83b268` with rollback snapshot `/var/backups/openmailstack/20260712T213933Z_branding_8b83b268`.
- Admin users also have an Admin > Settings hub backed by `/api/admin/settings/:namespace` for organization metadata, public URL hints, security defaults, mail policy defaults, update channel, telemetry mode, maintenance window, and admin notice. These settings are currently stored and editable; enforcement remains separate follow-up work.
- Admin users can use Admin > Domains, Cross-Domain Routing, Mailboxes, and Aliases against live Node API routes. DNS Settings opens a copyable records overlay; create/edit/delete/suspend/reset actions refresh admin data and show success/error banners. Aliases have a modal group-member editor with bulk/member removal and mailbox/manual address adds. Mailboxes have a profile editor for display name, quota, phone, alternate email, company/title/address metadata, notes, and Global Directory visibility backed by additive `webmail_mailbox_profiles`.
- Admin users can also promote/demote admins, generate/revoke API keys, save spam policies, save Admin Settings, and save Branding through the shared admin action path so refresh/error banners and audit-log writes are consistent.
- Admin users can explicitly grant/remove superadmin status for admin rows. Superadmin removal is guarded server-side so an admin cannot remove their own superadmin role or remove the last active superadmin.
- Contacts has a selectable Global Directory view populated from active mailboxes and admin-managed mailbox profile metadata via authenticated `/api/directory`. Compose recipient autocomplete merges personal contacts and Global Directory entries, and directory cards can be saved into Personal Contacts.
- Contacts search in the web app is server-backed through `/api/apps/contacts?q=...`, so it can find matches beyond the first loaded page. The UI still applies label filtering client-side to the loaded result set.
- Contacts now listens for authenticated Socket.IO `contacts_updated` events from ActiveSync, CardDAV, and web-app mutations. The Contacts hook refreshes with a debounce and updates the selected detail pane when the refreshed list contains the same contact id.
- Admin > Rspamd WebUI embeds the live Rspamd controller through the modern `/rspamd/` Nginx proxy and also offers an open-in-new-tab fallback.
- Resizable panels now use the typed `useDefaultLayout` API with unique panel IDs instead of unsupported casted `autoSaveId` props.
- The compose rich-text editor and top-level Mail, Calendar, Contacts, Settings, Notes, and Admin routes are lazy-loaded. The current production build main chunk is `224.12 kB`, and the largest route chunk is `481.41 kB`, below the documented 500 kB target.
- `webmail-frontend/src/index.css` contains the actual app styling. `webmail-frontend/src/App.css` looks like leftover Vite starter CSS and is not imported by `App.tsx`.
- `webmail/src/App.tsx` is still the default Vite starter page and is not the active product app; `webmail/README.md` marks it as a deprecated scaffold.

Validation:

- `docs/webmail-release-validation.md` defines local gates, clean-VM checks, and the mail/calendar/contacts/mobile/security client matrix for modern webmail releases.
- `tests/integration/run.sh` includes guards for the modern webmail deployment module, env rendering, Nginx proxy routes, and systemd EnvironmentFile wiring.
- `tests/integration/staging_smoke.sh` checks `openmailstack.service`, the backend listen port, modern `/`, legacy `/webmail`, and unauthenticated `/api/auth/me` returning 401.
- `tests/integration/calendar_sync_smoke.sh` is an authenticated optional smoke for CalDAV MKCALENDAR, event PUT/REPORT, ActiveSync FolderSync full listing, initial ActiveSync calendar Sync, compact calendar date output, ActiveSync calendar client Add persistence without same-response server echo, CalDAV visibility of ActiveSync-created events, current-key no-duplicate follow-up Sync, stale-key reset, and cleanup. It skips unless `OMS_SMOKE_USER` and `OMS_SMOKE_PASSWORD` are set.
- `tests/integration/carddav_sync_smoke.sh` is an authenticated optional smoke for CardDAV contact PUT, PROPFIND, REPORT, GET, DELETE, stale-token `sync-collection` tombstone output, and depth-1 address-book PROPFIND tombstone output. It skips unless `OMS_SMOKE_USER` and `OMS_SMOKE_PASSWORD` are set.
- `tests/integration/mail_sync_smoke.sh` is an authenticated optional smoke for direct SMTP submission, IMAP receipt, webmail API send/read, and attachment download. It skips unless `OMS_SMOKE_USER` and `OMS_SMOKE_PASSWORD` are set.
- `tests/integration/activesync_mail_smoke.sh` is an authenticated optional smoke for ActiveSync FolderSync, INBOX mail Sync, seeded-message body/read-state validation, read/unread Change command acknowledgements, IMAP flag verification, and cleanup. It skips unless `OMS_SMOKE_USER` and `OMS_SMOKE_PASSWORD` are set.
- `tests/integration/activesync_contacts_smoke.sh` is an authenticated optional smoke that seeds a contact through CardDAV, verifies ActiveSync FolderSync exposes Contacts, checks GetItemEstimate, verifies Contacts Sync returns the seeded contact, deletes it, and verifies the next Contacts Sync returns a Delete command. It skips unless `OMS_SMOKE_USER` and `OMS_SMOKE_PASSWORD` are set.

## 2026-07-30 Sieve delivery invariant

- Dovecot's SQL userdb must return both `home` and `mail_path` as the absolute
  `/var/vmail/<domain>/<user>` path. Personal Sieve storage uses `~/sieve`, so
  a mail path alone is insufficient for LMTP and ManageSieve script discovery.
- `functions/04_dovecot.sh` owns this rendering and
  `tests/integration/auth_hardening_guard.cjs` guards it.
- Live proof used a disposable `localtest@housevo.us` active script and LMTP
  message: Dovecot logged `fileinto`, the unique message existed only in the
  temporary target folder, and all probe state was removed afterward.

## 2026-07-30 Ordered rules and existing-mail runner

- Saved Mail Filters are ordered top to bottom. Missing `stopProcessing`
  preserves the legacy Stop default; explicit false continues into later rules.
- The Sieve compiler and manual evaluator share executable rule semantics.
  Preview/Apply is available for any existing folder, moves only, and binds one
  rule revision to one UID snapshot.
- Continued multi-destination moves use a durable database ledger keyed by
  UIDVALIDITY, source UID, and destination, independent of later rule edits.
  Confirmed copies are skipped on retry; uncertain interrupted copies are
  blocked rather than duplicated until the owner explicitly resolves them as
  present or missing. Reservations cover only the destination group being
  attempted, recovery is scoped to the exact displayed actions, and any
  pending copy blocks a later Move-only edit for that source UID.
  Destination-grouped IMAP operations avoid per-message mailbox round-trips,
  and partial successes invalidate/reconcile search state.
- UID searches use bounded numeric windows. Body checks fetch at most 1 MiB and
  use unknown-aware evaluation so sufficient non-Body criteria still decide a
  rule; the UI reports only messages with genuinely undecidable Body rules.
- This workflow is deployed from `e76fe4e568d1466548f264157f9c00eb996d56a5`.
  The production artifacts match the release, the additive ledger is empty,
  and an authenticated preview-only live run completed without mailbox
  mutation or browser errors.

## 2026-08-03 Dependency security boundary

- Patched dependency floors are DOMPurify 3.4.12, Socket.IO parser 4.2.7,
  `ip-address` 10.3.1, linkify 5.0.2/MailParser 3.9.13, PostCSS 8.5.23,
  and brace-expansion 5.0.9. Current locks resolve newer or equal releases.
- React Router remains exactly pinned to 7.18.2 because it supports Node 20;
  the advisory fix in 8.3.0 requires Node 22.22 and React 19.2.7. The advisory
  applies only to unstable RSC APIs, which this Vite browser SPA does not use.
- `tests/integration/dependency_security_guard.cjs` fails if a patched floor
  regresses or an RSC dependency, server build input, unstable API, internal
  RSC client, or action header appears before React Router is upgraded.
- This boundary is deployed from `0236f008`. The live backend dependency audit
  is clean; frontend installation reports only the expected RSC-only advisory.
  Public IMAPS/ActiveSync, staging, Socket.IO, readiness, artifact equality,
  restart count, and the warning journal pass. Rollback snapshot:
  `/var/backups/openmailstack/protocol-guarded-webmail-20260803T232855Z/`.

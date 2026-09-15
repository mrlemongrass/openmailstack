# Contact group synchronization — 2026-09-15

Status: implemented and checked locally; not deployed. No production contacts,
groups, credentials, or device state were accessed or changed for this work.

## Diagnosis

Individual vCard handling already existed, including UID/href identity,
structured contact fields, preserved raw properties, CardDAV CRUD and ActiveSync
conversion. Group interoperability was incomplete:

- Webmail group membership lived in `contact_groups`/`contact_group_members`.
- CardDAV preserved `CATEGORIES`, and ActiveSync converted categories, but
  neither connected them to webmail groups.
- Web group changes did not update contact vCards, ETags or sync revisions.
- Adding members did not validate contact ownership. Deleting a group removed
  memberships before checking group ownership.
- The webmail group selector highlighted a group without filtering contacts.

An actual MariaDB regression using disposable accounts reproduced all four
backend failures before implementation. A rendered React test against the
original hook reproduced the ineffective group selector.

## Implemented behavior

Per-contact categories are the supported interoperability format. Select
**Groups are per-contact categories** in DAVx⁵.

- Webmail membership changes, group rename and deletion project categories into
  each affected contact and advance its sync revision in the same owner-locked
  transaction. Deleting a group retains its contacts.
- CardDAV PUT, vCard import/native creation, supplied-vCard edits and ActiveSync
  contact persistence map categories back to owner-scoped webmail memberships.
- ActiveSync partial changes retain omitted categories unless the protocol's
  Supported-field rules specify clearing them. Existing protocol semantics are
  preserved.
- Escaped commas, semicolons, backslashes, repeated category properties,
  Unicode and folded lines are supported. New category lines fold at 75 bytes.
- Groups have exact, case-sensitive name identity within an owner. New duplicate
  names are rejected; existing group names/colors are reused for incoming
  categories. Names are bounded to 255 UTF-8 bytes and contacts to 128 groups,
  matching the ActiveSync boundary. Membership batches allow at most 1000 IDs.
- Ownership is validated before mutation. Invalid batches and failed database
  writes roll back memberships and vCard revisions together. Existing foreign
  links cannot leak contact names or contribute to group counts.
- The webmail group filter is applied before pagination/counting, combines with
  search, and is owner-scoped. Contact-update notifications refresh group counts.
  Duplicate-name failures reach the existing error toast and retain the input.

## Existing-data reconciliation

The explicit repair combines previously stored categories and webmail group
memberships. It does not choose one historical representation over the other.
It preserves contact UID/href identity. A repeat run reports no changes.

With the normal backend environment supplied, from `webmail-backend`:

```sh
node scripts/reconcile-contact-groups.cjs user@example.com --dry-run
node scripts/reconcile-contact-groups.cjs user@example.com --apply
```

Dry run is the default. It uses a read-only database transaction and does not run
schema initialization or the legacy UID backfill. Output contains counts only.
Apply uses the existing owner lock and one transaction. It refuses accounts over
10,000 contacts, invalid/oversized categories and existing group-vCard resources,
which require separate review. No repair was applied to production in this task.
Review the preview and retained rollback/backup evidence before applying it to an
existing account as part of an authorized release.

## Explicit limitations and next work

- **Separate group vCards remain unsupported.** Incoming `KIND:group` and Apple's
  `X-ADDRESSBOOKSERVER-KIND:group` receive a visible rejection rather than becoming
  fake ordinary contacts. RFC 6350 group resources need persistent group
  UID/href, MEMBER resolution (including forward references), group tombstones,
  collection revisions and concurrency tests before enabling that option.
- Categories carry membership names, not independent group objects. Empty groups
  and group colors do not round-trip through this format. An emptied category can
  leave an empty group in webmail; group deletion remains explicit.
- Existing duplicate-name groups and previously stored group-vCards are not
  silently rewritten. Legacy data needs the preview/reconciliation step.
- Native labels remain separate from groups. This is not a redesign of labels,
  deduplication or group-management UX.
- Physical Samsung/DAVx⁵ and Apple device checks remain outstanding. Scripted
  ActiveSync conversion/persistence is not physical-client proof.
- Release must use the required bridge-then-active guarded deployment and public
  IMAPS/ActiveSync checks. None were run against production for this local task.

## Validation

- Backend full suite: 1,035 passed, 12 gated skips (including the opt-in database
  suite); TypeScript build passed.
- Explicit disposable MariaDB suite: 14 passed, no skips. Exercises real webmail
  and CardDAV routes, ActiveSync conversion/persistence, create/edit/clear,
  rename/delete, stale ETags, owner isolation, atomic failure, legacy preview/
  apply/idempotency, supplied vCards and paginated filtering. Random database and
  database user are removed by test cleanup.
- Final category line-folding correction: 59 focused backend checks and the
  14-check disposable database suite passed after the final build.
- Frontend: 290 tests passed; TypeScript/Vite build and ESLint passed.
- Chromium with synthetic API fixtures confirmed group filtering and a visible
  duplicate-name error while retaining the typed input. Screenshot:
  `output/playwright/contact-group-filter-and-error.png`. Settings responses and
  sockets were deliberately unavailable in the fixture; no clean-console or
  whole-application-health claim is made.
- Rendered React group-selection/count-refresh test passes and fails against the
  original hook. Parsing regression checks preserve escaped values and reject
  invalid group cards/categories.

Commands:

```sh
cd webmail-backend
npm test
OMS_CONTACT_GROUP_DB_TEST=1 node --test test/contact-groups-db.test.cjs
cd ../webmail-frontend
npm test
npm run build
npm run lint
```

## Release preparation — 2026-09-15

Commit, push and guarded deployment were authorized after the local implementation.
The release includes the already committed dark-mode mail and PDF/image preview
work, and waits for that agent's deployment to finish before starting another.

A read-only production preview exposed mixed owner-column collations in older
installations (`contacts`: general_ci; `contact_groups`: unicode_ci). Explicit
comparison collation fixes the four affected joins without a database migration.
The disposable database fixture now reproduces this older schema: it failed
before the query correction and all 14 checks passed afterward. The corrected
read-only preview checked 487 contacts and found zero requiring reconciliation;
no production reconciliation was applied.

Combined release validation: 304 frontend tests, frontend build and lint passed;
backend full suite passed 1,035 tests with 12 gated skips before the collation
correction. Backend build and disposable database checks passed after it.

## Protocol sources

- [DAVx⁵ group formats](https://www.davx5.com/faq/cant-manage-groups-on-device)
- [RFC 6350: group KIND and MEMBER](https://www.rfc-editor.org/rfc/rfc6350.html#section-6.1.4)
- [ActiveSync Contacts Categories](https://learn.microsoft.com/en-us/openspecs/exchange_server_protocols/ms-ascntc/8d739c59-6181-4f04-97f9-6b85f9687056)

The coverage lesson is specific: successful individual-contact CRUD does not
prove group interoperability. The client matrix needs group membership and
cross-protocol round trips as separate acceptance checks.

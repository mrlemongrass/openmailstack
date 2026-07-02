# OpenMailStack Release Criteria

OpenMailStack releases must be evaluated as a full suite:

- Mail
- Calendar
- Contacts
- Notes
- Settings
- Admin
- Sync
- Mobile/responsive layout
- Install/upgrade/deployment
- Security/privacy

A release is ready only when the selected release channel has no unacceptable blockers.

## Release blocker levels

### P0 — Must block every release

- data loss
- credential/token/session leakage
- auth bypass
- cross-user data exposure
- broken fresh install
- broken upgrade path
- broken send/receive for primary mail flow
- destructive admin action without confirmation/safety
- production secrets committed
- database migration corrupts or drops user data
- release artifact cannot be built
- documented security claim is false

### P1 — Must block beta, release candidate, and stable releases

- major Calendar/Contacts/Notes route broken
- compose/send/draft flow unreliable
- ActiveSync/CalDAV/CardDAV status misleading
- admin portal can misconfigure critical services
- misleading UI advertises unavailable core features
- tests/build/typecheck failing without explanation
- install docs are materially wrong
- serious mobile usability failure in primary flows

### P2 — May ship in alpha or beta if documented

- unfinished non-critical feature
- bland UI in non-primary surface
- partial but honest placeholder
- known performance issue outside core flows
- missing advanced feature
- missing non-critical regression coverage

### P3 — Does not block release

- polish
- copy cleanup
- nice-to-have feature
- refactor
- internal maintainability improvement

## Release channels

### Alpha

Acceptable for early testers.

Required:

- fresh install works in a supported environment
- core mail send/receive path is not knowingly broken
- login/session flow works
- admin can create/manage basic domains/mailboxes/aliases
- no known P0 blocker
- known P1/P2 gaps documented
- release notes are honest
- rollback/recovery guidance exists

### Beta

Acceptable for broader testing.

Required:

- no P0 or P1 blockers
- fresh install and upgrade path tested
- Mail, Calendar, Contacts, Notes, Settings, Admin, and Sync surfaces are at least honest about what works
- misleading placeholders removed, disabled, or clearly marked
- major tests/build/typecheck pass
- security/privacy review completed
- known issues documented

### Release candidate

Acceptable as “intended final unless blockers are found.”

Required:

- no P0/P1 blockers
- release branch clean
- version chosen
- changelog/release notes drafted
- install tested
- upgrade tested
- smoke tests completed
- security/privacy checklist completed
- docs match current behavior
- rollback plan exists

### Stable

Acceptable for normal users.

Required:

- release candidate passed without release-blocking findings
- no known P0/P1 blockers
- critical P2 issues resolved or explicitly documented
- support/issue reporting path exists
- release notes are complete
- tag/artifact/checksum/signing policy followed if applicable

## Required release proof

Each release certification must include:

- git branch/status
- commit hash
- version/tag candidate
- test/build/typecheck results
- install test result
- upgrade test result
- smoke test result
- security/privacy review result
- suite workflow verification result
- known issues
- go/no-go recommendation

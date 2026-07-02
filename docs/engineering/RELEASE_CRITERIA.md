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

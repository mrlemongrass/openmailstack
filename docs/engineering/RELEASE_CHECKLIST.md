# OpenMailStack Release Checklist

## Repository

- [ ] Working tree clean
- [ ] Correct release branch
- [ ] Version selected
- [ ] Changelog updated
- [ ] Release notes drafted
- [ ] Known issues updated
- [ ] License files present
- [ ] No secrets or private data committed

## Build and tests

- [ ] Frontend install/build succeeds
- [ ] Frontend typecheck succeeds
- [ ] Frontend tests pass, if present
- [ ] Backend install/tests pass
- [ ] Lint/format checks pass, if present
- [ ] Migration checks pass, if present
- [ ] CI passes, if present

## Install and upgrade

- [ ] Fresh install tested on supported OS
- [ ] Upgrade from previous release tested, if previous release exists
- [ ] Rollback/recovery instructions verified
- [ ] Config generation works
- [ ] Service startup works
- [ ] Nginx/systemd/service routing works

## Suite smoke tests

- [ ] Login/logout/session recovery
- [ ] Admin creates domain/mailbox/alias
- [ ] Mail send
- [ ] Mail receive
- [ ] Inbox/message list
- [ ] Message viewer
- [ ] Compose/reply/forward
- [ ] Attachments
- [ ] Calendar route
- [ ] Event create/edit, if advertised
- [ ] Contacts route
- [ ] Contact create/edit/search, if advertised
- [ ] Notes route
- [ ] Note create/edit/autosave, if advertised
- [ ] Settings save/error behavior
- [ ] Mobile navigation

## Sync/protocol

- [ ] IMAP works
- [ ] SMTP submission works
- [ ] DKIM/Rspamd path verified or documented
- [ ] ActiveSync/SOGo status verified or clearly marked
- [ ] CalDAV status verified or clearly marked
- [ ] CardDAV status verified or clearly marked
- [ ] Sync errors are visible/recoverable where applicable

## Security/privacy

- [ ] No secrets in repo
- [ ] No private mail/calendar/contact/note data in logs/docs/tests
- [ ] Auth/session behavior reviewed
- [ ] Admin permissions reviewed
- [ ] Multi-user boundaries reviewed
- [ ] Destructive actions confirmed
- [ ] Logs avoid credentials/tokens/message bodies
- [ ] Dependency audit reviewed, if available
- [ ] Web security basics reviewed using project-appropriate ASVS checks

## Release decision

- [ ] P0 blockers: 0
- [ ] P1 blockers: 0 for beta/stable/RC
- [ ] P2 issues documented
- [ ] Go/no-go decision recorded

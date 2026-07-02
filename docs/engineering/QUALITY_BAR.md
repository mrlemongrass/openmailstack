# OpenMailStack Quality Bar

## Core mail workflows

Repeatedly verify:

- user can add/connect an account
- user can see inbox
- user can read message
- user can compose message
- user can save draft
- user can send message
- sent message appears correctly
- user can reply
- user can reply all
- user can forward
- user can archive
- user can delete
- user can restore from trash
- user can mark read/unread
- user can star/flag
- user can search
- user can handle attachments
- user can navigate folders/labels
- user can use keyboard shortcuts
- user can recover from failed network request
- user can recover from expired session
- user sees useful loading, empty, and error states

## Rich webmail feature inventory

Inventory, but do not blindly implement:

- multi-account inbox
- unified inbox
- per-account settings
- aliases and identities
- signatures
- conversation threading
- message search
- advanced search operators
- labels/folders
- rules/filters
- snooze
- archive
- spam handling
- trash retention
- attachment preview
- drag-and-drop attachments
- autosaved drafts
- undo send
- keyboard shortcuts
- bulk select/actions
- message templates
- contact autocomplete
- calendar invite rendering
- RSVP actions
- notifications
- responsive/mobile layout
- offline or poor-network resilience
- import/export
- admin/self-hosting setup
- ActiveSync support

## Task selection algorithm

Score candidates:

Severity:
5 = security, privacy, data loss, broken auth, broken send/receive/sync
4 = core workflow broken or severe UX failure
3 = test/build failure, major performance issue, common user frustration
2 = missing polish, inconsistent UI, weak docs, minor bug
1 = cleanup or nice-to-have

Reach:
5 = affects most users or first-run experience
4 = affects common workflows
3 = affects important but less frequent workflows
2 = affects edge cases
1 = internal-only

Confidence:
5 = clear evidence and clear fix
4 = likely fix with manageable uncertainty
3 = needs investigation but bounded
2 = ambiguous
1 = speculative

Effort:
1 = small
2 = moderate
3 = large
4 = very large
5 = rewrite-scale

Priority score:

`(Severity × 4) + (Reach × 3) + (Confidence × 2) - Effort`

Pick the highest-scoring task that can be completed and proven in one coherent loop.

## Definition of done

A task is done only when:

- behavior is implemented or bug is fixed
- acceptance criteria are met
- relevant tests were added or updated
- relevant checks pass, or failures are explained
- diff is focused
- no unrelated files changed
- failure, empty, and loading states were considered
- accessibility was considered for UI changes
- security/privacy was considered for data/auth/mail changes
- performance was considered for mailbox/search/sync/rendering changes
- final report includes proof

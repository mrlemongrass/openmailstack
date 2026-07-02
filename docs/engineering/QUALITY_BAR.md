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

## Product experience priority

The product goal is not only correctness. OpenMailStack must become a polished, premium-feeling webmail product.

After critical repository health is satisfied, product experience issues in primary workflows should be scored aggressively.

Primary workflows include:

- login/account/session
- inbox
- message list
- message viewer
- compose/reply/forward
- attachments
- search
- folders/labels
- settings
- calendar
- contacts
- mobile navigation

A bland, confusing, visually inconsistent, or obviously unfinished primary workflow may be scored as:

Severity: 4  
Reach: 4 or 5  
Confidence: based on evidence  
Effort: based on implementation size

Do not automatically down-rank UI/UX work as “polish.” If the issue affects the user’s trust, clarity, speed, or ability to complete a core workflow, it is a product-quality issue.

## Experience cycle requirement

If the previous two completed cycles were primarily backend, tests, docs, build, dependency, bundle-size, or repository hygiene tasks, the next cycle should be a product experience cycle unless a higher-priority security, data-loss, auth, mail/sync, crash, or failing-build issue is present.

A product experience cycle must produce one of:

- a visible UI/UX improvement
- a better loading, empty, or error state
- a smoother core workflow
- a responsive/mobile improvement
- an accessibility improvement
- a product-experience audit with screenshots and a prioritized UX backlog, if the app cannot yet be safely changed

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

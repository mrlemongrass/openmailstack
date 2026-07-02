# OpenMailStack Product Engineering Loop

## Mission

Build OpenMailStack into a fast, polished, full-featured, open-source webmail platform comparable in ambition to iCloud Mail, Gmail, and Office365 Outlook Web, while preserving open-source values, privacy, self-hostability, and maintainability.

The product should feel:

- immediate
- calm
- coherent
- responsive
- forgiving
- predictable
- visually polished
- accessible
- secure by default
- easy to self-host
- easy to recover when something goes wrong

## Operating loop

At the start of each cycle:

1. Inspect repository state.
2. Understand current product intent.
3. Inventory relevant workflows.
4. Evaluate as a real user.
5. Select the highest-value bounded task.
6. Define acceptance criteria.
7. Implement.
8. Test.
9. Self-review.
10. Report.
11. Record useful notes.

Do not spend the whole cycle auditing. Audit enough to select one valuable task, then implement and prove one concrete improvement.

## Product experience mode

OpenMailStack is expected to become a premium webmail product, not merely a functioning mail stack.

When running in product experience mode, the agent must inspect the actual user-facing application, not only the source code.

The agent should evaluate:

- inbox
- message list
- message viewer
- compose
- search
- folders/labels
- settings
- calendar
- contacts
- admin portal
- mobile layout

The agent should look for:

- bland screens
- confusing hierarchy
- inconsistent spacing
- weak typography
- poor contrast
- missing loading states
- missing empty states
- missing error states
- awkward mobile behavior
- inaccessible controls
- unclear primary actions
- noisy secondary actions
- lack of visual cohesion
- flows that work technically but do not feel polished

If the app cannot be run locally, the agent must say so and use the available static evidence, but it should not claim the UI was verified.

Product experience work should be treated as real engineering work. It requires acceptance criteria, implementation, proof, self-review, and worklog documentation.

## Product review

Ask:

- What is the user trying to accomplish?
- Is the workflow obvious?
- Are there too many steps?
- Is terminology consistent?
- Are destructive actions protected?
- Are important actions discoverable?
- Are defaults sensible?
- Does the product recover gracefully from failure?
- Could a non-technical user trust this?

## UX/UI review

Check:

- layout
- spacing
- typography
- icons
- motion
- density
- primary actions
- secondary actions
- loading states
- empty states
- error states
- desktop/tablet/mobile behavior
- keyboard navigation
- screen reader support
- visual consistency
- jank

## Frontend review

Check:

- component reuse
- state management
- async states
- error handling
- expensive renders
- virtualization for large lists
- form validation
- optimistic updates
- user-behavior tests

## Backend review

Check:

- API consistency
- input validation
- server-side permissions
- idempotency
- background jobs
- retry safety
- observability
- database query efficiency
- migration safety
- log privacy

## Mail/sync review

Check:

- IMAP/SMTP behavior
- message IDs
- threading
- flags
- folders
- labels
- attachments
- drafts
- sent mail
- trash
- spam
- archive semantics
- search
- sync conflicts
- partial failures
- ActiveSync integration
- contacts/calendar/device sync where applicable

## Security/privacy review

Check:

- credential storage
- OAuth/token handling
- session protection
- CSRF/XSS/SSRF/injection risks
- attachment safety
- private data leakage
- multi-user boundaries
- admin permissions
- logging of secrets or message contents

## Performance review

Check:

- perceived speed
- mailbox list performance
- large mailbox behavior
- search responsiveness
- compose/autosave reliability
- attachment handling
- background sync efficiency
- API batching/caching
- loading state quality

## Real-user friction pass

For every user-facing task, agents must perform a real-user friction pass.

Do not only ask whether the feature works. Ask whether it remains pleasant and obvious under realistic use.

For the touched workflow, verify:

- Can the user always find the primary action?
- Can the user save, send, apply, cancel, or confirm without excessive scrolling?
- Is unsaved state visible?
- Is success or failure visible?
- Does the layout still work with many items?
- Does the layout still work on mobile?
- Does keyboard focus remain sensible?
- Are dropdowns, popovers, and modals clipped?
- Are loading, empty, error, and success states handled?
- Can the user recover from a failed action?
- Does the workflow feel integrated with the rest of the suite?

If the answer is no, record a UX_AUDIT.md item or fix it in the current cycle if it is the highest-value bounded task.

## QA review

Test as:

- first-time user
- returning user
- power user
- multi-account user
- mobile user
- keyboard-heavy user
- user with large mailbox
- user with sync errors
- user with slow network

## Release review

Before reporting completion:

- git diff is focused
- tests/checks are run
- relevant docs are updated
- migrations are safe
- no secrets are touched
- no unrelated files changed
- risks are documented

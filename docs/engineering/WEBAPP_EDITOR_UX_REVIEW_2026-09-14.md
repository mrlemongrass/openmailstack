# Web app interaction review — 2026-09-14

## Scope and evidence

Reviewed Mail Compose and Signatures in depth, and surveyed Calendar, Contacts,
Notes, Scheduler, and Settings at 1440 px and 390 px in Chromium. This was the real
frontend with synthetic API responses on a local development server. No real user
mail, settings, contacts, events, notes, or outbound recipients were changed.
Screenshots are in `output/playwright/editor-audit-20260914/`.

The suite survey covers primary navigation and initial/empty states. It is not
certification of every workflow, large dataset, device, sync service, or live
backend. Source findings below are distinguished from browser reproductions.

## Implemented in this change

| Problem | Result | Proof |
| --- | --- | --- |
| Signature paragraphs and line breaks flattened into one line | Convert stored signature HTML through an inert document fragment, preserving block boundaries, blank lines, breaks with attributes, and decoded entities | The actual component test failed with `Regards,Alex ExamplePhone: 123Email: alex@example.test` before the fix; now four separate lines. `compose-desktop.png` |
| Changing signature accumulated copies; No signature was overridden by the default | Initialize once per new composer, honor explicit None, replace only the exact text inserted by this session, and leave reopened draft text untouched | Component interaction tests for default, switching, None, reopened draft, and entities/blank lines |
| Whole composer had fixed dimensions | Header Expand/Restore plus a top-left drag handle, with arrow-key resizing; preserve body and custom size on restore | Browser assertions on width increase and unchanged body; `compose-expanded.png`, `compose-resized.png` |
| Close offered only Cancel and Save & Close | Keep editing, Discard draft, Save & Close. Existing discarded drafts move to Trash; unsaved content is removed locally | `close-mobile.png`; failed delete retained text, successful retry closed; double-click regression test |
| Discard could race autosave if implemented as just close/delete | Stop new saves, wait for the existing queue, use the latest returned folder/UID, and retain the draft on failure | Held the real frontend save request, clicked Discard, released UID 77 in `Team/Drafts`; exactly one delete followed, with no later save. Coordinator tests cover queue blocking, failure, and uncertain save |
| Signature Settings toolbar lacked its Snow theme stylesheet | Load the editor stylesheet so formatting buttons and link controls render correctly on direct navigation | `settings-mobile-fixed.png`, `settings-desktop-fixed.png`; mobile toolbar measured 42 px high |
| Default-signature option clipped on narrow screens | Wrap the name/options row and allow the name field to shrink | Browser measured the complete label within 390 px; screenshot above |

Send remained visible at 390×844 and 390×500 with Cc and Bcc expanded. Manual
window dimensions are overridden on mobile. Actual on-screen keyboard behavior
on physical iOS/Android remains unverified.

## Four follow-up priorities implemented

The operator authorized all four priorities, deployment, commit, and push.

| Priority | Delivered behavior | Evidence |
| --- | --- | --- |
| Settings saves | Serialized, coalesced writes retain pending values until acknowledged. App navigation flushes the queue; failure retains the editor and offers Retry. Rules participate in the navigation guard. Reload/close uses the browser's unsaved warning. Signature Save now reflects the actual server result. | Queue tests cover immediate flush, edits during a write, failure and superseding retries. Browser failed a signature save, stayed in Settings, retried, and reopened the saved name. `settings-save-recovery.png` |
| Rich composition | Plain/rich selector, labelled formatting toolbar, links/lists, default-format preference, format-aware signatures/templates, safe HTML, and confirmed conversion to plain text. Draft reopening fetches the authoritative body and attachment manifest, preventing a cached preview from overwriting a later save. | HTML payloads observed for draft/save and send; send fixture rejected delivery and retained body. Save/reopen retained revised text after the fresh-load fix. Loader tests cover latest HTML, attachments, failures, wrong UID, and no-store requests. `rich-draft-reopened.png` |
| Unsaved Calendar and Contacts forms | Close, Cancel, Escape, app navigation and browser unload protect edits. Keep editing preserves the form; discard is explicit. Save locks prevent double submission and fields are disabled during save. | Both real editors retained changed values after close and navigation cancellation. Router regression covers failed automatic save, retry, form discard and unload. `calendar-unsaved-guard.png` |
| Reminders, keyboard access and errors | Attachment reminder applies to Compose, scheduling, inline replies and Send & Archive. Attach is a keyboard button. Recipient suggestions expose combobox/listbox and highlighted-option semantics. Templates use buttons and an inline name form, persist only after success, retain input on failure, and support rich content. | Component reminder and disabled-setting tests, actual browser reminder, template 503/retry and keyboard file chooser. Backend test preserves rich template mode and legacy plain templates. |

## Remaining review backlog

| Priority | Finding | Evidence | Acceptance for a follow-up |
| --- | --- | --- | --- |
| P2 | Settings has an all-or-nothing loading dependency | **Browser observed with invalid fixture rules, source confirmed:** one failed rules request blocks Signatures and other settings because the page loads all resources with `Promise.all` | Each section shows its own retry/error and unrelated settings remain usable |
| P2 | Native pop-out, minimizing to the inbox, and multiple concurrent drafts are absent | **Source confirmed:** `composeDocked` state is unused in rendered UI; this change adds in-app expansion/resizing only | Define one-owner draft state and handoff/recovery first, then add dock/minimize and a separate-window option without duplicate saves |
| P2 | Scheduler recovery/confirmation patterns remain inconsistent | **Source confirmed:** some event-type and booking mutation handlers use browser `confirm` and have no local failure handling | Named confirmations, progress locks, recoverable errors, and preserved form state across booking/event actions |

The next bounded task is section-specific Settings loading/retry, followed by
separate-window composition with one owner of each draft.

## Suite observations

- **Mail:** core compose, autosave, send-later, templates, attachments, and identity
  selection exist; the main gaps concern editing fidelity, discoverability,
  keyboard access, and trustworthy state transitions.
- **Calendar:** desktop sidebar and mobile view/navigation render within the
  viewport. Recurrence/invitation actions already exist in source; they should
  not be listed as wholly missing. Dirty-form closing is now protected.
- **Contacts:** primary empty-state create action is available on mobile and
  desktop. Import, labels/groups, and duplicate workflows exist. Dirty-form
  closing is protected; other destructive confirmations still merit review.
- **Notes:** empty-state create action and mobile navigation render correctly;
  source already contains save-on-close handling. No Notes synchronization,
  collaboration, or data change is included in this review.
- **Scheduler:** section picker, booking link actions, and guided first-event
  empty state render on mobile. Error handling and confirmation consistency need
  improvement; booking and public availability behavior was not exercised here.
- **Settings:** direct Signatures navigation exposed the missing theme styles and
  clipped option, now fixed. The navigation-loss reproduction is fixed by the acknowledged save queue and navigation guard.

## Validation and release limits

Frontend: 274/274 tests, lint and production build pass. Backend: 1,004 passed,
seven skipped, no failures; build and focused settings/outbound checks (43/43)
pass. Full local integration passed, including deployment, rollback, protocol and
backup fixture suites. The final draft-loader change was followed by another full
frontend suite and build/lint pass.

Browser checks use synthetic API data and intentional failure responses. No real
user mailbox/PIM/settings data was changed, and no real message was sent in these
UI tests. Initial fixture setup had malformed authentication, branding and message
shapes; those were corrected and are not product failures. Realtime sync and
physical-client behavior are outside this browser proof.

Previously flattened drafts cannot be reconstructed automatically; reinsert their
saved signature. Separate-window pop-out remains a follow-up; this release offers
in-app expansion and resizing. Rich text supports ordinary text formatting, links
and lists. Drafts containing images/tables/embedded layouts keep their original
body and require explicit confirmation before simplifying for editing; no inline
image/table authoring is claimed. Physical mobile keyboards remain unverified.

Deployment results and rollback snapshot paths are recorded in WORKLOG.md.

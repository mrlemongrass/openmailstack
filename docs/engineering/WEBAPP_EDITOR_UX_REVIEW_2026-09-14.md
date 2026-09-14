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

## Prioritized remaining work

| Priority | Finding | Evidence | Acceptance for a follow-up |
| --- | --- | --- | --- |
| P1 | Settings edits can disappear on quick navigation | **Browser reproduced:** rename a signature and click Mail before 800 ms; no settings write occurs even after a further second. `settings/routes.tsx` clears pending debounce timers on unmount | Pending edits visibly mark unsaved state; app navigation saves or prompts; failed saves retain a recoverable value |
| P1 | HTML draft editing is incomplete | **Source confirmed:** `draft-resume.ts` can restore HTML with mode `rich`, but `ComposeModal.tsx` always renders a textarea. Stored formatting in signatures is converted to plain text for Compose | One rich/plain editing workflow with toolbar, safe paste, links/lists, appropriate mode conversion, and save/reopen/send round-trip tests |
| P1 | Unsaved-edit protection differs between editors | **Source confirmed:** `ContactEditModal.tsx` close/Escape calls `onClose` directly; `EventModal.tsx` close directly clears the open flag. Notes has a save-on-close coordinator | New and edited Contacts/Calendar forms warn before losing changes and keep work on save failure; confirm by browser |
| P2 | Attachment reminder setting is disconnected | **Source confirmed:** `attachmentReminder` is editable in Settings; no compose/send runtime reads it | A message referring to an attachment with no files prompts before Send; setting controls behavior |
| P2 | Templates are hard to use with a keyboard and can fail silently | **Source confirmed:** template choices are clickable `div`s; saving uses a browser prompt and ignores persistence errors | Keyboard-operable menu, named form, visible pending/success/error states and retry |
| P2 | Attachment picker and recipient suggestions lack complete keyboard/screen-reader interaction | **Source confirmed:** attachment action is a label wrapping a hidden input; suggestion choices lack a combobox/listbox relationship | Tab reaches Attach; Enter opens picker; recipient suggestions expose highlighted option and selection semantics |
| P2 | Settings has an all-or-nothing loading dependency | **Browser observed with invalid fixture rules, source confirmed:** one failed rules request blocks Signatures and other settings because the page loads all resources with `Promise.all` | Each section shows its own retry/error and unrelated settings remain usable |
| P2 | Native pop-out, minimizing to the inbox, and multiple concurrent drafts are absent | **Source confirmed:** `composeDocked` state is unused in rendered UI; this change adds in-app expansion/resizing only | Define one-owner draft state and handoff/recovery first, then add dock/minimize and a separate-window option without duplicate saves |
| P2 | Scheduler recovery/confirmation patterns remain inconsistent | **Source confirmed:** some event-type and booking mutation handlers use browser `confirm` and have no local failure handling | Named confirmations, progress locks, recoverable errors, and preserved form state across booking/event actions |

The next bounded implementation should address Settings navigation loss. Rich
Compose should follow with an explicit content-format contract and draft/send
round-trip proof. Avoid adding more controls while existing controls misrepresent
save state or lose work.

## Suite observations

- **Mail:** core compose, autosave, send-later, templates, attachments, and identity
  selection exist; the main gaps concern editing fidelity, discoverability,
  keyboard access, and trustworthy state transitions.
- **Calendar:** desktop sidebar and mobile view/navigation render within the
  viewport. Recurrence/invitation actions already exist in source; they should
  not be listed as wholly missing. Dirty-form closing needs attention.
- **Contacts:** primary empty-state create action is available on mobile and
  desktop. Import, labels/groups, and duplicate workflows exist. Dirty-form
  closing and consistent confirmations need attention.
- **Notes:** empty-state create action and mobile navigation render correctly;
  source already contains save-on-close handling. No Notes synchronization,
  collaboration, or data change is included in this review.
- **Scheduler:** section picker, booking link actions, and guided first-event
  empty state render on mobile. Error handling and confirmation consistency need
  improvement; booking and public availability behavior was not exercised here.
- **Settings:** direct Signatures navigation exposed the missing theme styles and
  clipped option, now fixed. The navigation-loss reproduction is a separate open
  issue, not a completed save-reliability fix.

## Validation and release limits

Frontend tests pass 265/265; lint and the production build pass. Focused backend
outbound route checks pass 30/30, and the backend build passes. The backend change only adds `draftFolder` to the
existing save response, and its generated JavaScript/source map are refreshed.

Browser checks used synthetic responses, including explicit 503 and delayed-save
cases. Early fixture setup produced branding/rules/appearance schema errors and
an SSE content-type error; those are fixture failures, not reported product bugs.
Realtime sync was not verified. No production deployment, protocol release gate,
SMTP send, or physical-client verification is claimed.

Previously flattened saved drafts contain no recoverable line-break metadata;
this fix cannot infer where those old lines belonged. Reinsert the saved signature
when repairing such a draft. Modified/moved signature text is retained rather than
being removed by a heuristic. Separate-window pop-out and rich-text fidelity are
still open. A frontend deployed ahead of the new save response fails closed for a
new draft whose folder is unavailable; Save & Close and reopening supplies the
exact folder. Deploy backend before frontend through the normal guarded workflow.

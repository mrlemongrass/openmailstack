# Phase 2 — Mail App Polish

**Date:** 2026-06-30
**Status:** Approved
**Scope:** `webmail-frontend/src/mail/` + small backend additions in `webmail-backend/src/`

## Features

### 1. Inline Reply Box

Plain textarea at the bottom of `MessageViewer`, always visible when a message is open.

- `useMail` gains `replyText` state and `sendReply()` function
- 3-row textarea, auto-expands, auto-focuses on message open
- "Rich editor" link opens the existing `ComposeModal` pre-filled
- Send builds a `FormData` with `In-Reply-To` / `References` headers and `Re:` subject
- Sends via `api.sendMessage()`

### 2. Snooze with Custom Time Picker

**Frontend:** Snooze button in `MessageViewer` toolbar + quick hover actions. Popover with presets:
- Later today (6:00 PM)
- Tomorrow (8:00 AM)
- This weekend (Saturday 10:00 AM)
- Next week (Monday 8:00 AM)
- Custom (datetime picker)

**Backend:**
- `POST /api/messages/snooze` — `{ folder, uids, until }` — moves to `Snoozed` folder, stores `snooze_until`
- Snoozed folder excluded from INBOX searches
- Unsnooze: on any mail fetch, check for expired snoozes, move back to INBOX

### 3. Drag-and-Drop Attachments into Compose

- `onDragOver`/`onDrop` handlers on `ComposeModal` container
- Translucent overlay: "Drop files to attach" shown during drag
- `dataTransfer.files` appended to `composeAttachments`
- Entire modal is the drop target

### 4. Quick Hover Actions on Message Rows

Right-aligned icon row, revealed on hover (CSS opacity transition):
- Archive, Delete, Mark Read/Unread, Snooze, Star toggle
- Date text slides left on hover
- Each icon is a `<button>` calling `mail.messageAction()`
- Icons scale with density variants

### 5. "Show Original" / View Headers

**Backend:** `GET /api/folders/:folder/messages/:uid/raw` — returns raw RFC 5322 source

**Frontend:** Button in `MessageViewer` toolbar. Opens modal with:
- Monospace `<pre>` with raw message source
- "Copy" button copies full text to clipboard
- Lazy-loaded: fetch only when modal opens

### 6. Print Stylesheet

`@media print` in `index.css`:
- Hide all UI chrome (header, sidebar, toolbar, mobile tab bar)
- Message viewer goes full-width, white background, black text
- Links show URLs via `a[href]::after`
- Clean typography at 12pt

## Files

| File | Change |
|------|--------|
| `mail/hooks/useMail.ts` | +replyText, sendReply, snooze state/actions |
| `mail/MessageViewer.tsx` | +inline reply, +snooze btn, +show-original btn |
| `mail/MessageRow.tsx` | +hover action icons |
| `mail/ComposeModal.tsx` | +drag-drop overlay |
| `mail/components/InlineReply.tsx` | **New** |
| `mail/components/SnoozePopover.tsx` | **New** |
| `mail/components/RawMessageModal.tsx` | **New** |
| `index.css` | +print stylesheet, +hover-action CSS |
| `webmail-backend/src/api.ts` | +`GET /raw`, +`POST /snooze` |

## Constraints

- No new npm dependencies
- Plain text for inline reply (ReactQuill is lazy-loaded for full compose only)
- Snooze presets use date-fns (already a dependency)
- Print CSS uses standard `@media print` — no JS required

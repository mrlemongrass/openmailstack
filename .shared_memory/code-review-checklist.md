# OpenMailStack Code Review Checklist

> **When to use:** Before merging any PR, before deployment, and during full project audits.
> **Methodology reference:** [[deep-code-review-methodology]] in global shared memory.

## Pre-Review: Determine Scope

1. What subsystems does the diff touch? (mail, calendar, contacts, notes, settings, admin)
2. What shared infrastructure changed? (api.ts, types.ts, DB schemas, auth)
3. What user-visible actions could be affected?

If diff touches >5 files or crosses subsystem boundaries → run Pass 1 + Pass 2 on affected subsystems.

## Pass 2 Flow Traces — Per Subsystem

### Mail (always review — most complex, most state)

| Action | Trace |
|--------|-------|
| Click message to read | MessageList.handleClick → navigate → MessageViewer mounts → fetchMessageBody → **must also call messageAction('read')** → must refresh folder unseen counts |
| Star/unstar message | messageAction('star') → IMAP STORE +FLAGS \Flagged → must update message list + search index |
| Delete message | messageAction('delete') → IMAP MOVE to Trash → must update message list + folder counts + show undo bar |
| Archive message | messageAction('archive') → IMAP MOVE to Archive → same as delete |
| Send message | sendMessage → SMTP send → IMAP APPEND to Sent → delete draft → auto-create contacts |
| Save draft | saveDraft → build MIME → IMAP APPEND to Drafts → delete old drafts with same X-Draft-Id |
| Search | searchMessages → try index first → fall back to IMAP SEARCH |
| Folder list load | fetchFolders → IMAP LIST + STATUS → unseen counts from server |
| Real-time update | SSE event → re-fetch folders + messages → update UI |

### Calendar

| Action | Trace |
|--------|-------|
| Create event | EventModal save → build iCal → POST /api/apps/events → insert into events table → refresh calendars |
| Edit event | EventModal edit → POST /api/apps/events → update row → refresh |
| Delete event | DELETE /api/apps/events/:calendarId/:uid → for recurring, add EXDATE; otherwise delete + tombstone |
| Toggle calendar visibility | PUT /api/apps/calendars/:id → update is_visible → should persist after navigation |

### Contacts

| Action | Trace |
|--------|-------|
| View contact | Click grid card → selectedContact set → ContactDetail renders → fetch activity |
| Create contact | ContactEditModal → POST /api/apps/contacts → insert + build vCard + sync birthday |
| Edit contact | PUT /api/apps/contacts/:id → update row + bump sync_token + sync birthday |
| Delete contact | Soft delete → set deleted_at → must appear in trash → permanent delete must clean up birthday events + group memberships |
| Import contacts | Upload vCard/CSV → parse → INSERT ON DUPLICATE KEY → report counts |
| Merge duplicates | POST /api/apps/contacts-merge → merge fields → delete duplicates |

### Notes

| Action | Trace |
|--------|-------|
| Open note | Click card → isNoteModalOpen=true → NoteEditorModal with LiveNoteEditor → auto-save after 1.5s |
| Create note | "+ New Note" → empty modal → auto-save POST → update editingNote.id from response |
| Edit note | Type → debounced save → PUT /api/notes/:id → must not lose metadata (color, pin, folder) |
| Set reminder | ReminderPicker → POST /api/notes/:id/reminder → display in correct timezone |
| Upload attachment | Drop file → POST /api/notes/:id/attachments → must be downloadable |
| Archive note | Click archive → saveNote({folder:'archive'}) → hidden from main view |
| Image upload | Toolbar button → POST /api/notes/upload → insert URL into editor |
| Checklist toggle | Click checkbox → toggle data-checked → must survive save/load |

### Settings

| Action | Trace |
|--------|-------|
| Change setting | Update local state → PUT /api/settings/:namespace → must persist after logout/login |
| Create signature | WYSIWYG editor → POST /api/settings/signatures → must appear in compose |
| Change appearance | PUT /api/settings/appearance → CSS variables must update immediately |

## Pass 3 State Consistency — Key Pairs

For each pair, verify both sides agree after every action:

- [ ] Sidebar unseen count ↔ IMAP STATUS unseen count (run `doveadm mailbox status -u <user> INBOX`)
- [ ] Message isRead flag ↔ IMAP \Seen flag
- [ ] Message isStarred flag ↔ IMAP \Flagged flag
- [ ] Calendar event in DB ↔ event visible in all views (month/week/day/agenda)
- [ ] Contact deleted_at column ↔ contact visible in trash ↔ contact NOT in main list
- [ ] Note folder column ↔ note visible in correct view (all/archive/trash)
- [ ] Note remind_at column ↔ reminder displayed in UI ↔ reminder timezone correct

## Pass 4 Cross-Subsystem — Key Interfaces

- [ ] `api.ts` notes routes ↔ `apps-api.ts` notes routes (must not diverge — both should have same endpoints)
- [ ] Frontend `api.ts` URL paths ↔ Backend route mount points (apiRouter at /api, appsApiRouter at /api/apps)
- [ ] `shared/types.ts` types ↔ Backend response shapes (every field returned by API must be in the type)
- [ ] Socket events (note_updated, note_deleted) ↔ Frontend listeners
- [ ] Multer configs ↔ Express middleware ordering (no route conflicts)

## Pre-Deployment Quick Check

Run these before deploying:
1. `npm run build` in both frontend and backend — zero errors
2. `npm test` — all tests pass
3. Manually verify: open a message → unread count decrements
4. Manually verify: create a note → refresh → note appears
5. Verify all new API routes return JSON (not HTML or 404)

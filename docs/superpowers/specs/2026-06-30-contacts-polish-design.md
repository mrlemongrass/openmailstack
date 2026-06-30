# Contacts Polish — High Priority Gaps (Features 1-7)

Date: 2026-06-30
Status: Design approved, pending implementation plan

## Overview

Fill the 7 highest-priority gaps in the Contacts app: quick actions, inline detail panel, birthday-to-calendar sync, trash/restore, manual duplicate scan, contact sharing, and selective export.

## Architecture

Three-panel layout when a contact is selected. Follows mail app's list+detail pattern.

```
┌─────────────┬──────────────────┬─────────────────────┐
│  Sidebar     │  Contact List     │  Contact Detail      │
│  (labels,    │  (grid/list)      │  (read-only panel)   │
│   groups,    │                   │                      │
│   trash btn) │                   │  [Quick Actions]     │
│              │                   │  Name, photo, all    │
│              │                   │  fields, activity    │
└─────────────┴──────────────────┴─────────────────────┘
```

Mobile: detail panel replaces list (push navigation pattern).

### New Files

- `contacts/ContactDetail.tsx` — read-only detail panel with quick actions and activity timeline
- `contacts/ContactQuickActions.tsx` — email/call/map icon buttons extracted as sub-component
- `contacts/ContactTrash.tsx` — trash list view with Restore / Delete Forever
- `contacts/ContactShareModal.tsx` — recipient selector modal for sharing vCard internally

### Modified Files

- `contacts/ContactsLayout.tsx` — adds detail panel slot, trash view, share modal
- `contacts/ContactSidebar.tsx` — trash view toggle with count badge, "Find Duplicates" button
- `contacts/ContactGrid.tsx` — onClick opens detail, selection checkboxes, export dropdown
- `contacts/hooks/useContacts.ts` — trash state, birthday events, manual dedup trigger, selectedContact
- `shared/api.ts` — restore, export-selected, share, activity endpoints

## Feature Details

### 1. Quick Actions (ContactQuickActions)

Pure client-side, rendered in the detail panel header:
- **Email**: `mailto:` link using primary email
- **Call**: `tel:` link using primary phone
- **Map**: Google Maps link using primary address

Each action is an icon button. Disabled state when the field is missing (no phone = call button grayed out).

### 2. Contact Detail Inline View (ContactDetail)

Read-only panel. Shows all structured fields from the Contact type:
- Name (prefix, first, middle, last, suffix), nickname
- Photo or avatar initials
- All emails, phones, addresses (as ContactItem[] lists)
- Company, department, job title
- Organization
- Website URL
- Birthday (with calendar icon linking to birthday calendar)
- Notes
- Labels as colored pills

Below the fields: activity timeline section showing recent emails (last 20, matched by email address in from/to/cc) and upcoming shared meetings (next 10, matched by email in calendar_attendees). Fetched from new `/api/apps/contacts/:id/activity` endpoint.

### 3. Birthday → Calendar

Backend: on `POST/PUT /api/apps/contacts` when `birthday` field is present and changed, upsert an all-day recurring event (YEARLY) in the user's Birthdays calendar (auto-created if missing). On birthday removal, delete the event. On contact deletion, delete linked birthday event.

Frontend: no new UI needed — the Birthdays calendar already exists in the calendar sidebar.

### 4. Contact Trash (ContactTrash)

Soft-delete model using `deleted_at TIMESTAMP NULL` column on `contacts` table:
- `DELETE /api/apps/contacts/:id` sets `deleted_at = NOW()` (soft)
- `DELETE /api/apps/contacts/:id/permanent` hard-deletes the row
- `POST /api/apps/contacts/:id/restore` sets `deleted_at = NULL`
- `GET /api/apps/contacts/trash` returns soft-deleted contacts
- All existing queries add `AND deleted_at IS NULL` filter
- Cleanup: on any contact read/write, the backend checks for rows where `deleted_at < NOW() - INTERVAL 30 DAY` and hard-deletes them before proceeding. No separate cron job needed.

Sidebar: "Trash" item below Groups, with count badge. Click switches grid to trash view showing ContactTrash component. Each trashed contact shows "Restore" and "Delete forever" buttons.

### 5. Manual Duplicates Trigger

"Find Duplicates" button in sidebar header. Calls existing `refreshDuplicates()` — no backend changes. Button shows spinner while duplicate detection runs.

### 6. Contact Sharing (ContactShareModal)

Share button in detail panel → modal with:
- Recipient email input (typeahead against contacts/directory)
- Optional message textarea
- Send button

Backend: `POST /api/apps/contacts/:id/share { recipientEmail, message? }` generates a vCard from the contact, attaches it to an internal email sent to the recipient.

### 7. Selective Export

Reuses existing `selectedContactIds` set from multi-select. Export button in grid toolbar becomes a dropdown: "Export All" | "Export Selected" (disabled when nothing selected).

Backend: existing `GET /api/apps/contacts-export` accepts optional `?ids=1,2,3` query param. When present, exports only those contacts.

## Backend Summary

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/apps/contacts/:id/activity` | GET | Recent emails + shared meetings |
| `/api/apps/contacts/trash` | GET | List soft-deleted contacts |
| `/api/apps/contacts/:id/restore` | POST | Restore from trash |
| `/api/apps/contacts/:id/permanent` | DELETE | Hard delete |
| `/api/apps/contacts/:id/share` | POST | Share vCard internally |
| `/api/apps/contacts-export?ids=` | GET | Export selected contacts |

Existing `DELETE /api/apps/contacts/:id` changes to soft-delete.

## Data Flow

```
ContactCard.onClick
  → useContacts.setSelectedContact(id)
  → ContactDetail mounts, reads contact from state
  → GET /api/apps/contacts/:id/activity → renders activity timeline
  → QuickActions rendered from contact fields (client-side only)
```

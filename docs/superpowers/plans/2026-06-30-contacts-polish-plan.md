# Contacts Polish — High Priority Gaps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add quick actions, inline detail panel, birthday sync, trash/restore, manual duplicate scan, contact sharing, and selective export to the Contacts app.

**Architecture:** Three-panel layout (sidebar | grid | detail) following the mail app pattern. Four new frontend components plus backend endpoints for trash, activity, birthday sync, sharing, and filtered export.

**Tech Stack:** React 18, TypeScript, Express, MySQL (mysql2), date-fns, nodemailer

## Global Constraints

- Backend changes are additive: use `ALTER TABLE` with column existence checks (follows existing `ensureContactsSchema` pattern)
- Frontend follows existing React inline style pattern (no CSS modules or styled-components)
- All API routes prefixed `/api/apps/contacts` under `appsApiRouter`
- Mobile: detail panel replaces list (not side-by-side)
- Trash cleanup: on-read check, no cron job
- Contact soft-delete uses `deleted_at TIMESTAMP NULL` column

---

### Task 1: Database Migration — Add deleted_at Column

**Files:**
- Modify: `webmail-backend/src/contact-utils.ts:97-159`

**Interfaces:**
- Produces: `deleted_at TIMESTAMP NULL` column on `contacts` table

- [ ] **Step 1: Add the schema migration**

In `ensureContactsSchema()`, add after the `website_url` migration block (after line 159, before the `contact_groups` CREATE TABLE):

```typescript
if (!columnNames.has('deleted_at')) {
    await pool.query('ALTER TABLE contacts ADD COLUMN deleted_at TIMESTAMP NULL AFTER website_url');
}
```

- [ ] **Step 2: Build and verify backend compiles**

Run: `cd webmail-backend && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add webmail-backend/src/contact-utils.ts
git commit -m "feat: add deleted_at column to contacts schema

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: Backend — Soft-Delete, Trash, Restore, Permanent Delete

**Files:**
- Modify: `webmail-backend/src/apps-api.ts:22-52` (GET contacts — add deleted_at filter)
- Modify: `webmail-backend/src/apps-api.ts:173-197` (DELETE + bulk-delete — soft-delete)
- Create new routes in same file after line 197

**Interfaces:**
- Modifies: `GET /api/apps/contacts` now filters `AND deleted_at IS NULL`
- Modifies: `DELETE /api/apps/contacts/:id` now soft-deletes
- Modifies: `POST /api/apps/contacts/bulk-delete` now soft-deletes
- Produces: `GET /api/apps/contacts/trash` returns `{ success, contacts[] }`
- Produces: `POST /api/apps/contacts/:id/restore` returns `{ success }`
- Produces: `DELETE /api/apps/contacts/:id/permanent` hard-deletes

- [ ] **Step 1: Add cleanup helper function**

Add before the contacts routes (after `appsApiRouter.use(authenticateApp);`):

```typescript
async function purgeExpiredTrash(): Promise<void> {
    await pool.query("DELETE FROM contacts WHERE deleted_at IS NOT NULL AND deleted_at < NOW() - INTERVAL 30 DAY");
}
```

- [ ] **Step 2: Modify GET /contacts to filter deleted and purge trash**

Replace the existing GET `/contacts` query (line 27-36) with:

```typescript
await purgeExpiredTrash();
const [rows]: any = await pool.query(
    `SELECT id, username, name, email, phone, dav_uid, sync_token, updated_at,
            emails_json, phones_json, addresses_json, job_title, organization,
            notes, labels_json, photo_url, is_favorite,
            prefix, first_name, middle_name, last_name, suffix, nickname,
            department, birthday, website_url
     FROM contacts WHERE username = ? AND deleted_at IS NULL
     ORDER BY is_favorite DESC, name ASC, email ASC, id ASC
     LIMIT ? OFFSET ?`,
    [user, limit + 1, offset]
);
```

- [ ] **Step 3: Change DELETE /contacts/:id to soft-delete**

Replace the existing route (lines 189-197) with:

```typescript
appsApiRouter.delete('/contacts/:id', async (req: Request, res: Response) => {
    const user = (req as any).username;
    try {
        await pool.query(
            'UPDATE contacts SET deleted_at = NOW() WHERE id=? AND username=? AND deleted_at IS NULL',
            [req.params.id as string, user]
        );
        res.json({ success: true });
    } catch (e: any) {
        res.status(500).json({ success: false, error: e.message });
    }
});
```

- [ ] **Step 4: Change bulk-delete to soft-delete**

Replace the existing `POST /contacts/bulk-delete` (lines 173-187) with:

```typescript
appsApiRouter.post('/contacts/bulk-delete', async (req: Request, res: Response) => {
    const user = (req as any).username;
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ success: false, error: 'ids array required' });
    try {
        const placeholders = ids.map(() => '?').join(',');
        const [result]: any = await pool.query(
            `UPDATE contacts SET deleted_at = NOW() WHERE id IN (${placeholders}) AND username = ? AND deleted_at IS NULL`,
            [...ids, user]
        );
        res.json({ success: true, deleted: result.affectedRows });
    } catch (e: any) {
        res.status(500).json({ success: false, error: e.message });
    }
});
```

- [ ] **Step 5: Add trash list endpoint**

Add after the bulk-delete route:

```typescript
appsApiRouter.get('/contacts/trash', async (req: Request, res: Response) => {
    const user = (req as any).username;
    try {
        await purgeExpiredTrash();
        const [rows]: any = await pool.query(
            `SELECT id, name, email, phone, deleted_at
             FROM contacts WHERE username = ? AND deleted_at IS NOT NULL
             ORDER BY deleted_at DESC`,
            [user]
        );
        res.json({ success: true, contacts: rows });
    } catch (e: any) {
        res.status(500).json({ success: false, error: e.message });
    }
});
```

- [ ] **Step 6: Add restore endpoint**

Add after trash list:

```typescript
appsApiRouter.post('/contacts/:id/restore', async (req: Request, res: Response) => {
    const user = (req as any).username;
    try {
        const [result]: any = await pool.query(
            'UPDATE contacts SET deleted_at = NULL WHERE id=? AND username=? AND deleted_at IS NOT NULL',
            [req.params.id as string, user]
        );
        if (result.affectedRows === 0) return res.status(404).json({ success: false, error: 'Contact not found in trash' });
        res.json({ success: true });
    } catch (e: any) {
        res.status(500).json({ success: false, error: e.message });
    }
});
```

- [ ] **Step 7: Add permanent delete endpoint**

Add after restore:

```typescript
appsApiRouter.delete('/contacts/:id/permanent', async (req: Request, res: Response) => {
    const user = (req as any).username;
    try {
        await pool.query(
            'DELETE FROM contacts WHERE id=? AND username=? AND deleted_at IS NOT NULL',
            [req.params.id as string, user]
        );
        res.json({ success: true });
    } catch (e: any) {
        res.status(500).json({ success: false, error: e.message });
    }
});
```

- [ ] **Step 8: Also filter deleted_at in other contact queries**

In the export endpoint (`GET /contacts-export`), change line 203 from:
```typescript
const [rows]: any = await pool.query('SELECT * FROM contacts WHERE username = ?', [user]);
```
to:
```typescript
const [rows]: any = await pool.query('SELECT * FROM contacts WHERE username = ? AND deleted_at IS NULL', [user]);
```

In the duplicate detection queries in `contact-utils.ts`, add `AND deleted_at IS NULL` to any `SELECT * FROM contacts` queries.

- [ ] **Step 9: Build and verify**

Run: `cd webmail-backend && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 10: Commit**

```bash
git add webmail-backend/src/apps-api.ts webmail-backend/src/contact-utils.ts
git commit -m "feat: soft-delete contacts with trash, restore, permanent delete

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: Backend — Activity Endpoint

**Files:**
- Modify: `webmail-backend/src/apps-api.ts` (add route after trash routes)

**Interfaces:**
- Produces: `GET /api/apps/contacts/:id/activity` returns `{ success, emails: Array<{ subject, received_at, snippet, id }>, meetings: Array<{ title, start, id }> }`

- [ ] **Step 1: Add activity endpoint**

Add after the permanent delete route:

```typescript
appsApiRouter.get('/contacts/:id/activity', async (req: Request, res: Response) => {
    const user = (req as any).username;
    try {
        const [contactRows]: any = await pool.query(
            'SELECT email, emails_json FROM contacts WHERE id=? AND username=? AND deleted_at IS NULL',
            [req.params.id as string, user]
        );
        if (contactRows.length === 0) return res.status(404).json({ success: false, error: 'Contact not found' });

        const contact = contactRows[0];
        const emails: string[] = [contact.email];
        if (contact.emails_json) {
            const parsed = typeof contact.emails_json === 'string' ? JSON.parse(contact.emails_json) : contact.emails_json;
            if (Array.isArray(parsed)) {
                for (const item of parsed) {
                    if (item.value && !emails.includes(item.value)) emails.push(item.value);
                }
            }
        }
        const emailPlaceholders = emails.map(() => '?').join(',');

        const [emailRows]: any = await pool.query(
            `SELECT subject, received_at, id, snippet(subject, body) AS snippet
             FROM messages
             WHERE username = ? AND (from_addr IN (${emailPlaceholders}) OR to_addrs REGEXP ? OR cc_addrs REGEXP ?)
             ORDER BY received_at DESC LIMIT 20`,
            [user, ...emails, emails.join('|'), emails.join('|')]
        );

        const [meetingRows]: any = await pool.query(
            `SELECT e.uid AS id, e.ical_data, MIN(eo.start) AS start
             FROM events e
             JOIN events_occurrences eo ON eo.event_id = e.id
             JOIN event_attendees ea ON ea.event_id = e.id
             WHERE ea.email IN (${emailPlaceholders}) AND eo.start >= NOW()
             GROUP BY e.id, e.uid, e.ical_data
             ORDER BY eo.start ASC LIMIT 10`,
            [...emails]
        );

        const meetings = meetingRows.map((r: any) => {
            const titleMatch = r.ical_data?.match(/SUMMARY:([^\r\n]*)/);
            return {
                id: r.id,
                title: titleMatch ? titleMatch[1].trim() : 'Meeting',
                start: r.start,
            };
        });

        res.json({ success: true, emails: emailRows, meetings });
    } catch (e: any) {
        res.status(500).json({ success: false, error: e.message });
    }
});
```

- [ ] **Step 2: Build and verify**

Run: `cd webmail-backend && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add webmail-backend/src/apps-api.ts
git commit -m "feat: contact activity endpoint (emails + shared meetings)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 4: Backend — Birthday Sync on Contact Save

**Files:**
- Modify: `webmail-backend/src/apps-api.ts:54-156` (POST and PUT /contacts)

**Interfaces:**
- Consumes: `birthday` field on contact body
- Produces: upserts/deletes all-day YEARLY event in Birthdays calendar

- [ ] **Step 1: Add birthday sync helper function**

Add after the `purgeExpiredTrash` helper:

```typescript
async function syncBirthdayEvent(user: string, contactName: string, contactEmail: string, birthday: string | null): Promise<void> {
    // Find or create Birthdays calendar
    const [calRows]: any = await pool.query(
        "SELECT id FROM calendars WHERE user_id = ? AND (dav_slug = 'birthdays' OR name = 'Birthdays') LIMIT 1",
        [user]
    );
    let calendarId: number;
    if (calRows.length === 0) {
        // createCalendar is imported at top of file from './calendar-utils'
        const cal = await createCalendar(user, 'Birthdays', { slug: 'birthdays', color: '#e91e63', components: 'VEVENT' });
        calendarId = cal.id;
    } else {
        calendarId = calRows[0].id;
    }

    // Build event UID from contact identity
    const uid = `birthday-${Buffer.from(contactEmail || contactName).toString('hex').slice(0, 32)}@openmailstack`;

    if (!birthday) {
        // Remove birthday if cleared
        await pool.query('DELETE FROM events WHERE calendar_id=? AND uid=?', [calendarId, uid]);
        return;
    }

    // Parse birthday (expects YYYY-MM-DD or MM-DD)
    const parts = birthday.split('-');
    let month: string, day: string;
    if (parts.length >= 3) { month = parts[1]; day = parts[2]; }
    else if (parts.length === 2) { month = parts[0]; day = parts[1]; }
    else return;

    const dtstart = `1970${month.padStart(2, '0')}${day.padStart(2, '0')}`;
    const summary = `${contactName || contactEmail}'s Birthday`;

    const ical = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//OpenMailStack//Birthdays//EN',
        'BEGIN:VEVENT',
        `UID:${uid}`,
        `DTSTART;VALUE=DATE:${dtstart}`,
        `DTEND;VALUE=DATE:${dtstart}`,
        'RRULE:FREQ=YEARLY',
        `SUMMARY:${summary}`,
        'TRANSP:TRANSPARENT',
        'END:VEVENT',
        'END:VCALENDAR',
    ].join('\r\n');

    await pool.query(
        'INSERT INTO events (calendar_id, uid, ical_data, sync_token) VALUES (?, ?, ?, 1) ON DUPLICATE KEY UPDATE ical_data=?, sync_token=sync_token+1',
        [calendarId, uid, ical, ical]
    );
}
```

- [ ] **Step 2: Call birthday sync from POST /contacts**

In the POST `/contacts` route, add after `res.json({ success: true, id: result.insertId });` (but before the response is sent — restructure to call sync before responding):

Replace the success line in POST:
```typescript
res.json({ success: true, id: result.insertId });
```
with:
```typescript
if (birthday !== undefined) {
    const savedName = fullName || email || '';
    await syncBirthdayEvent(user, savedName, email || '', birthday || null);
}
res.json({ success: true, id: result.insertId });
```

- [ ] **Step 3: Call birthday sync from PUT /contacts**

In the PUT route, add after `await pool.query(updateSql, queryParams);` and before `res.json({ success: true });`:

```typescript
const savedName = fullName || existingContact.email || '';
const savedEmail = email || existingContact.email || '';
const savedBirthday = birthday !== undefined ? (birthday || null) : existingContact.birthday || null;
await syncBirthdayEvent(user, savedName, savedEmail, savedBirthday);
```

- [ ] **Step 4: Delete birthday event on contact permanent delete**

In the `DELETE /contacts/:id/permanent` route, add before the DELETE query:

```typescript
const [contactToDelete]: any = await pool.query(
    'SELECT name, email FROM contacts WHERE id=? AND username=?',
    [req.params.id as string, user]
);
if (contactToDelete.length > 0) {
    await syncBirthdayEvent(user, contactToDelete[0].name, contactToDelete[0].email, null);
}
```

- [ ] **Step 5: Build and verify**

Run: `cd webmail-backend && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add webmail-backend/src/apps-api.ts
git commit -m "feat: sync contact birthdays to Birthdays calendar

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 5: Backend — Share Endpoint + Selective Export Filter

**Files:**
- Modify: `webmail-backend/src/apps-api.ts` (add share route, modify export route)

**Interfaces:**
- Produces: `POST /api/apps/contacts/:id/share` returns `{ success }`
- Modifies: `GET /api/apps/contacts-export` accepts `?ids=1,2,3`

- [ ] **Step 1: Add share endpoint**

Add after the activity endpoint:

```typescript
appsApiRouter.post('/contacts/:id/share', async (req: Request, res: Response) => {
    const user = (req as any).username;
    const shareTo = req.body.recipientEmail as string;
    const shareMsg = (req.body.message as string) || '';

    try {
        const [rows]: any = await pool.query(
            'SELECT * FROM contacts WHERE id=? AND username=? AND deleted_at IS NULL',
            [req.params.id as string, user]
        );
        if (rows.length === 0) return res.status(404).json({ success: false, error: 'Contact not found' });

        const c = rows[0];
        const vcard = normalizeVCardData(
            c.vcard_data || '',
            c.dav_uid || `contact-${c.id}`,
            { name: c.name, email: c.email, phone: c.phone }
        );

        res.json({
            success: true,
            vcard,
            mailtoSubject: `Contact: ${c.name || c.email}`,
            mailtoBody: `${shareMsg}\n\n`,
        });
    } catch (e: any) {
        res.status(500).json({ success: false, error: e.message });
    }
});
```

The frontend opens a `mailto:` link with the vCard text in the body, so the user's email client handles delivery.

- [ ] **Step 2: Modify export endpoint for selective export**

In `GET /contacts-export`, change the query from:
```typescript
const [rows]: any = await pool.query('SELECT * FROM contacts WHERE username = ?', [user]);
```
to:
```typescript
const idsParam = req.query.ids as string;
let rows: any[];
if (idsParam) {
    const ids = idsParam.split(',').map(Number).filter(n => !isNaN(n));
    if (ids.length === 0) {
        rows = [];
    } else {
        const placeholders = ids.map(() => '?').join(',');
        [rows] = await pool.query(
            `SELECT * FROM contacts WHERE username = ? AND id IN (${placeholders}) AND deleted_at IS NULL`,
            [user, ...ids]
        );
    }
} else {
    [rows] = await pool.query('SELECT * FROM contacts WHERE username = ? AND deleted_at IS NULL', [user]);
}
```

- [ ] **Step 3: Build and verify**

Run: `cd webmail-backend && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add webmail-backend/src/apps-api.ts
git commit -m "feat: contact share endpoint + selective export filter

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 6: Frontend API Layer — New Endpoints

**Files:**
- Modify: `webmail-frontend/src/shared/api.ts:127-165`

**Interfaces:**
- Consumes: n/a
- Produces: `restoreContact()`, `permanentDeleteContact()`, `fetchTrashContacts()`, `fetchContactActivity()`, `shareContact()`

- [ ] **Step 1: Add new API functions and update Contact type**

First, add `deleted_at` to the Contact interface in `shared/types.ts` (after the `website_url` line):

```typescript
deleted_at?: string;
```

Then add these API functions after the `mergeContacts` function (after line 221) in `shared/api.ts`:

```typescript
export async function restoreContact(id: number | string): Promise<void> {
    await fetch(`/api/apps/contacts/${id}/restore`, { method: 'POST' });
}

export async function permanentDeleteContact(id: number | string): Promise<void> {
    await fetch(`/api/apps/contacts/${id}/permanent`, { method: 'DELETE' });
}

export async function fetchTrashContacts(): Promise<ContactsResponse> {
    const res = await fetch('/api/apps/contacts/trash');
    return res.json();
}

export async function fetchContactActivity(id: number | string): Promise<{
    success: boolean;
    emails?: Array<{ subject: string; received_at: string; snippet: string; id: number }>;
    meetings?: Array<{ title: string; start: string; id: string }>;
}> {
    const res = await fetch(`/api/apps/contacts/${id}/activity`);
    return res.json();
}

export async function shareContact(id: number | string, recipientEmail: string, message?: string): Promise<{
    success: boolean;
    vcard?: string;
    mailtoSubject?: string;
    mailtoBody?: string;
}> {
    const res = await fetch(`/api/apps/contacts/${id}/share`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipientEmail, message }),
    });
    return res.json();
}
```

- [ ] **Step 2: Build and verify**

Run: `cd webmail-frontend && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add webmail-frontend/src/shared/api.ts webmail-frontend/src/shared/types.ts
git commit -m "feat: add contact API functions (trash, activity, share, restore)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 7: Frontend — useContacts Hook Changes

**Files:**
- Modify: `webmail-frontend/src/contacts/hooks/useContacts.ts`

**Interfaces:**
- Produces: `selectedContact`, `setSelectedContact`, `trashContacts`, `refreshTrash`, `isTrashView`, `setIsTrashView`, `refreshDuplicates` (already exists, no change needed), `isDedupLoading`, `refreshDuplicates` wrapper

- [ ] **Step 1: Add new state and methods**

Replace the entire `useContacts` function body with the enhanced version:

```typescript
import { useState, useCallback, useEffect } from 'react';
import type { Contact, ContactLabel, ContactGroup } from '../../shared/types';
import * as api from '../../shared/api';

export function useContacts() {
    const [contacts, setContacts] = useState<Contact[]>([]);
    const [directoryContacts, setDirectoryContacts] = useState<Contact[]>([]);
    const [contactLabels, setContactLabels] = useState<ContactLabel[]>([]);
    const [contactGroups, setContactGroups] = useState<ContactGroup[]>([]);
    const [duplicateGroups, setDuplicateGroups] = useState<Contact[][]>([]);
    const [selectedLabel, setSelectedLabel] = useState<number | null>(null);
    const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null);
    const [contactsView, setContactsView] = useState<'personal' | 'directory' | 'trash'>('personal');
    const [selectedContactIds, setSelectedContactIds] = useState<Set<number>>(new Set());
    const [contactSearchQuery, setContactSearchQuery] = useState('');
    const [contactViewMode, setContactViewMode] = useState<'grid' | 'list'>('grid');
    const [isLoading, setIsLoading] = useState(false);
    const [offset, setOffset] = useState(0);
    const [hasMore, setHasMore] = useState(true);
    const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
    const [trashContacts, setTrashContacts] = useState<Contact[]>([]);
    const [isTrashLoading, setIsTrashLoading] = useState(false);
    const [isDedupLoading, setIsDedupLoading] = useState(false);

    const refreshContacts = useCallback(async () => {
        setIsLoading(true);
        try {
            const data = await api.fetchContacts(200, 0);
            if (data.contacts) { setContacts(data.contacts); setOffset(data.contacts.length); setHasMore(data.contacts.length >= 200); }
        } catch (e) { console.error('Failed to fetch contacts', e); }
        setIsLoading(false);
    }, []);

    const loadMoreContacts = useCallback(async () => {
        if (!hasMore) return;
        try {
            const data = await api.fetchContacts(200, offset);
            if (data.contacts) {
                setContacts((prev) => [...prev, ...data.contacts!]);
                setOffset((prev) => prev + data.contacts!.length);
                setHasMore(data.contacts.length >= 200);
            }
        } catch (e) { console.error('Failed to load more contacts', e); }
    }, [offset, hasMore]);

    const refreshDirectoryContacts = useCallback(async (query?: string) => {
        try {
            const data = await api.fetchDirectoryContacts(query);
            if (data.contacts) setDirectoryContacts(data.contacts);
        } catch (e) { console.error('Failed to fetch directory', e); }
    }, []);

    const refreshLabels = useCallback(async () => {
        try { setContactLabels(await api.fetchContactLabels()); } catch (e) { console.error(e); }
    }, []);

    const refreshGroups = useCallback(async () => {
        try { setContactGroups(await api.fetchContactGroups()); } catch (e) { console.error(e); }
    }, []);

    const refreshDuplicates = useCallback(async () => {
        setIsDedupLoading(true);
        try {
            const data = await api.fetchContactDuplicates();
            if (data.groups) setDuplicateGroups(data.groups);
        } catch (e) { console.error(e); }
        setIsDedupLoading(false);
    }, []);

    const refreshTrash = useCallback(async () => {
        setIsTrashLoading(true);
        try {
            const data = await api.fetchTrashContacts();
            if (data.contacts) setTrashContacts(data.contacts);
        } catch (e) { console.error('Failed to fetch trash', e); }
        setIsTrashLoading(false);
    }, []);

    useEffect(() => {
        refreshContacts();
        refreshLabels();
        refreshGroups();
        refreshDuplicates();
    }, []);

    return {
        contacts, directoryContacts, contactLabels, contactGroups,
        duplicateGroups, selectedLabel, setSelectedLabel,
        selectedGroupId, setSelectedGroupId,
        contactsView, setContactsView,
        selectedContactIds, setSelectedContactIds,
        contactSearchQuery, setContactSearchQuery,
        contactViewMode, setContactViewMode,
        isLoading, hasMore,
        refreshContacts, loadMoreContacts, refreshDirectoryContacts,
        refreshLabels, refreshGroups, refreshDuplicates,
        selectedContact, setSelectedContact,
        trashContacts, refreshTrash, isTrashLoading,
        isDedupLoading,
    };
}
```

- [ ] **Step 2: Build and verify**

Run: `cd webmail-frontend && npx tsc --noEmit`
Expected: No errors (may have a TS error about `contactsView` including `'trash'` — that's fine, we'll update the type consumers next)

- [ ] **Step 3: Commit**

```bash
git add webmail-frontend/src/contacts/hooks/useContacts.ts
git commit -m "feat: add selectedContact, trash, manual dedup to useContacts hook

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 8: Frontend — ContactQuickActions Component

**Files:**
- Create: `webmail-frontend/src/contacts/ContactQuickActions.tsx`

**Interfaces:**
- Consumes: `contact: Contact` prop
- Produces: renders Mail, Phone, Map icon buttons

- [ ] **Step 1: Create the component**

```typescript
import { Mail, Phone, MapPin } from 'lucide-react';
import type { Contact } from '../shared/types';

export function ContactQuickActions({ contact }: { contact: Contact }) {
    const primaryEmail = contact.email || contact.emails_json?.[0]?.value || '';
    const primaryPhone = contact.phone || contact.phones_json?.[0]?.value || '';
    const primaryAddress = contact.address || contact.addresses_json?.[0]?.value || '';

    const btnStyle: React.CSSProperties = {
        display: 'inline-flex', alignItems: 'center', gap: 6,
        padding: '8px 14px', borderRadius: 'var(--radius-md)',
        border: '1px solid var(--border-glass)', background: 'transparent',
        color: 'var(--text-primary)', cursor: 'pointer', fontSize: '0.82rem',
        fontFamily: 'inherit', fontWeight: 500,
        textDecoration: 'none',
    };
    const disabledStyle: React.CSSProperties = { ...btnStyle, opacity: 0.35, cursor: 'default' };

    return (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {primaryEmail ? (
                <a href={`mailto:${primaryEmail}`} style={btnStyle}>
                    <Mail size={14} /> Email
                </a>
            ) : (
                <span style={disabledStyle}><Mail size={14} /> Email</span>
            )}
            {primaryPhone ? (
                <a href={`tel:${primaryPhone}`} style={btnStyle}>
                    <Phone size={14} /> Call
                </a>
            ) : (
                <span style={disabledStyle}><Phone size={14} /> Call</span>
            )}
            {primaryAddress ? (
                <a href={`https://maps.google.com/?q=${encodeURIComponent(primaryAddress)}`}
                    target="_blank" rel="noopener noreferrer" style={btnStyle}>
                    <MapPin size={14} /> Map
                </a>
            ) : (
                <span style={disabledStyle}><MapPin size={14} /> Map</span>
            )}
        </div>
    );
}
```

- [ ] **Step 2: Build and verify**

Run: `cd webmail-frontend && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add webmail-frontend/src/contacts/ContactQuickActions.tsx
git commit -m "feat: contact quick actions component (email, call, map)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 9: Frontend — ContactDetail Component

**Files:**
- Create: `webmail-frontend/src/contacts/ContactDetail.tsx`

**Interfaces:**
- Consumes: `contact: Contact`, `onClose: () => void`, `onShare: () => void`, `activity` from `fetchContactActivity`
- Produces: read-only detail panel with fields, quick actions, activity timeline

- [ ] **Step 1: Create ContactDetail**

```typescript
import { useEffect, useState } from 'react';
import { X, Share2, Pencil, Star, Calendar, Mail, MapPin, Phone, Globe, Building2, Briefcase } from 'lucide-react';
import type { Contact } from '../shared/types';
import { ContactQuickActions } from './ContactQuickActions';
import * as api from '../shared/api';

interface ActivityItem {
    subject: string;
    received_at: string;
    snippet: string;
    id: number;
}

interface MeetingItem {
    title: string;
    start: string;
    id: string;
}

export function ContactDetail({ contact, onClose, onEdit, onShare }: {
    contact: Contact;
    onClose: () => void;
    onEdit: () => void;
    onShare: () => void;
}) {
    const [emails, setEmails] = useState<ActivityItem[]>([]);
    const [meetings, setMeetings] = useState<MeetingItem[]>([]);

    useEffect(() => {
        if (!contact.id) return;
        api.fetchContactActivity(contact.id).then((data) => {
            if (data.emails) setEmails(data.emails);
            if (data.meetings) setMeetings(data.meetings);
        }).catch(() => {});
    }, [contact.id]);

    const initials = (contact.name || contact.email || '?')
        .split(' ').map((p) => p[0]).join('').slice(0, 2).toUpperCase();

    const emailItems = contact.emails_json || (contact.email ? [{ value: contact.email, label: 'Primary' }] : []);
    const phoneItems = contact.phones_json || (contact.phone ? [{ value: contact.phone, label: 'Primary' }] : []);
    const addressItems = contact.addresses_json || (contact.address ? [{ value: contact.address, label: 'Primary' }] : []);
    const labelIds = contact.labels_json || [];

    const sectionLabel: React.CSSProperties = {
        fontSize: '0.7rem', fontWeight: 600, textTransform: 'uppercase',
        color: 'var(--text-secondary)', letterSpacing: '0.05em', marginBottom: 6,
    };
    const fieldValue: React.CSSProperties = { fontSize: '0.9rem', color: 'var(--text-primary)', lineHeight: 1.5 };
    const fieldLabel: React.CSSProperties = { fontSize: '0.75rem', color: 'var(--text-secondary)' };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 16, borderBottom: '1px solid var(--border-glass)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ width: 48, height: 48, borderRadius: '50%',
                        background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-purple))',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: '1.1rem', fontWeight: 600, color: 'white', flexShrink: 0 }}>
                        {initials}
                    </div>
                    <div>
                        <div style={{ fontWeight: 600, fontSize: '1.1rem' }}>{contact.name || contact.email}</div>
                        {contact.job_title && contact.organization && (
                            <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                                {contact.job_title} at {contact.organization}
                            </div>
                        )}
                        {contact.job_title && !contact.organization && (
                            <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>{contact.job_title}</div>
                        )}
                    </div>
                </div>
                <div style={{ display: 'flex', gap: 4 }}>
                    <button className="btn btn-ghost" onClick={onShare} style={{ padding: 6 }} title="Share">
                        <Share2 size={16} />
                    </button>
                    <button className="btn btn-ghost" onClick={onEdit} style={{ padding: 6 }} title="Edit">
                        <Pencil size={16} />
                    </button>
                    <button className="btn btn-ghost" onClick={onClose} style={{ padding: 6 }} title="Close">
                        <X size={16} />
                    </button>
                </div>
            </div>

            {/* Body */}
            <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
                {/* Quick actions */}
                <div style={{ marginBottom: 20 }}>
                    <ContactQuickActions contact={contact} />
                </div>

                {/* Contact fields */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

                    {emailItems.length > 0 && (
                        <div>
                            <div style={sectionLabel}><Mail size={12} style={{ marginRight: 4 }} />Email</div>
                            {emailItems.map((item, i) => (
                                <div key={i} style={{ marginBottom: 4 }}>
                                    <a href={`mailto:${item.value}`} style={fieldValue}>{item.value}</a>
                                    {item.label && <span style={fieldLabel}> — {item.label}</span>}
                                </div>
                            ))}
                        </div>
                    )}

                    {phoneItems.length > 0 && (
                        <div>
                            <div style={sectionLabel}><Phone size={12} style={{ marginRight: 4 }} />Phone</div>
                            {phoneItems.map((item, i) => (
                                <div key={i} style={{ marginBottom: 4 }}>
                                    <a href={`tel:${item.value}`} style={fieldValue}>{item.value}</a>
                                    {item.label && <span style={fieldLabel}> — {item.label}</span>}
                                </div>
                            ))}
                        </div>
                    )}

                    {addressItems.length > 0 && (
                        <div>
                            <div style={sectionLabel}><MapPin size={12} style={{ marginRight: 4 }} />Address</div>
                            {addressItems.map((item, i) => (
                                <div key={i} style={{ marginBottom: 4 }}>
                                    <span style={fieldValue}>{item.value}</span>
                                    {item.label && <span style={fieldLabel}> — {item.label}</span>}
                                </div>
                            ))}
                        </div>
                    )}

                    {(contact.organization || contact.department) && (
                        <div>
                            <div style={sectionLabel}><Building2 size={12} style={{ marginRight: 4 }} />Organization</div>
                            <div style={fieldValue}>{contact.organization}{contact.department ? ` — ${contact.department}` : ''}</div>
                        </div>
                    )}

                    {contact.job_title && (
                        <div>
                            <div style={sectionLabel}><Briefcase size={12} style={{ marginRight: 4 }} />Job Title</div>
                            <div style={fieldValue}>{contact.job_title}</div>
                        </div>
                    )}

                    {contact.website_url && (
                        <div>
                            <div style={sectionLabel}><Globe size={12} style={{ marginRight: 4 }} />Website</div>
                            <a href={contact.website_url} target="_blank" rel="noopener noreferrer" style={fieldValue}>{contact.website_url}</a>
                        </div>
                    )}

                    {contact.birthday && (
                        <div>
                            <div style={sectionLabel}><Calendar size={12} style={{ marginRight: 4 }} />Birthday</div>
                            <div style={fieldValue}>{contact.birthday}</div>
                        </div>
                    )}

                    {contact.notes && (
                        <div>
                            <div style={sectionLabel}>Notes</div>
                            <div style={{ ...fieldValue, whiteSpace: 'pre-wrap' }}>{contact.notes}</div>
                        </div>
                    )}
                </div>

                {/* Activity timeline */}
                {(emails.length > 0 || meetings.length > 0) && (
                    <div style={{ marginTop: 24, paddingTop: 20, borderTop: '1px solid var(--border-glass)' }}>
                        <div style={{ ...sectionLabel, marginBottom: 12 }}>Activity</div>
                        {emails.length > 0 && (
                            <div style={{ marginBottom: 16 }}>
                                <div style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8 }}>
                                    Recent Emails ({emails.length})
                                </div>
                                {emails.map((e) => (
                                    <div key={e.id} style={{
                                        padding: '6px 0', borderBottom: '1px solid var(--border-glass)',
                                        fontSize: '0.82rem',
                                    }}>
                                        <div style={{ fontWeight: 500, color: 'var(--text-primary)', marginBottom: 2 }}>{e.subject}</div>
                                        <div style={{ color: 'var(--text-secondary)', fontSize: '0.72rem' }}>
                                            {e.received_at ? new Date(e.received_at).toLocaleDateString() : ''} — {e.snippet}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                        {meetings.length > 0 && (
                            <div>
                                <div style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8 }}>
                                    Upcoming Meetings ({meetings.length})
                                </div>
                                {meetings.map((m) => (
                                    <div key={m.id} style={{
                                        padding: '6px 0', borderBottom: '1px solid var(--border-glass)',
                                        fontSize: '0.82rem',
                                    }}>
                                        <div style={{ fontWeight: 500, color: 'var(--text-primary)' }}>{m.title}</div>
                                        <div style={{ color: 'var(--text-secondary)', fontSize: '0.72rem' }}>
                                            {m.start ? new Date(m.start).toLocaleDateString() : ''}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
```

- [ ] **Step 2: Build and verify**

Run: `cd webmail-frontend && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add webmail-frontend/src/contacts/ContactDetail.tsx
git commit -m "feat: contact detail inline panel with activity timeline

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 10: Frontend — ContactShareModal Component

**Files:**
- Create: `webmail-frontend/src/contacts/ContactShareModal.tsx`

**Interfaces:**
- Consumes: `contact: Contact`, `onClose: () => void`
- Produces: modal with recipient input, message, send button

- [ ] **Step 1: Create ContactShareModal**

```typescript
import { useState } from 'react';
import { X, Send } from 'lucide-react';
import type { Contact } from '../shared/types';
import * as api from '../shared/api';

export function ContactShareModal({ contact, onClose }: {
    contact: Contact;
    onClose: () => void;
}) {
    const [recipient, setRecipient] = useState('');
    const [message, setMessage] = useState('');
    const [sending, setSending] = useState(false);
    const [sent, setSent] = useState(false);
    const [error, setError] = useState('');

    const handleShare = async () => {
        if (!recipient.trim()) return;
        setSending(true);
        setError('');
        try {
            const result = await api.shareContact(contact.id!, recipient.trim(), message || undefined);
            if (result.success) {
                setSent(true);
                // Open mailto compose if vcard data returned
                if (result.vcard) {
                    const mailtoUrl = `mailto:${encodeURIComponent(recipient.trim())}?subject=${encodeURIComponent(result.mailtoSubject || '')}&body=${encodeURIComponent((result.mailtoBody || '') + result.vcard)}`;
                    window.open(mailtoUrl, '_blank');
                }
                setTimeout(onClose, 500);
            } else {
                setError('Failed to share contact');
            }
        } catch {
            setError('Network error');
        }
        setSending(false);
    };

    return (
        <div className="sync-setup-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
            <div className="sync-setup-modal glass-panel" style={{ width: 'min(500px, 100%)', maxHeight: 'min(80vh, 500px)' }}
                onClick={(e) => e.stopPropagation()}>
                <div className="sync-setup-header">
                    <div>
                        <div className="sync-setup-eyebrow">Share Contact</div>
                        <h3>{contact.name || contact.email}</h3>
                    </div>
                    <button className="btn btn-ghost" onClick={onClose}><X size={18} /></button>
                </div>
                <div className="sync-setup-body">
                    {sent ? (
                        <div style={{ textAlign: 'center', padding: 20, color: 'var(--success)' }}>
                            Contact shared! Opening email composer...
                        </div>
                    ) : (
                        <>
                            <div className="settings-field">
                                <label style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', fontWeight: 600 }}>
                                    Recipient Email
                                </label>
                                <input type="email" className="glass-input" placeholder="colleague@example.com"
                                    value={recipient} onChange={(e) => setRecipient(e.target.value)} />
                            </div>
                            <div className="settings-field">
                                <label style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', fontWeight: 600 }}>
                                    Message (optional)
                                </label>
                                <textarea className="glass-input" rows={3} placeholder="I'd like to share this contact with you."
                                    value={message} onChange={(e) => setMessage(e.target.value)}
                                    style={{ resize: 'vertical' }} />
                            </div>
                            {error && <div className="settings-error-banner">{error}</div>}
                            <button className="btn btn-primary" onClick={handleShare}
                                disabled={!recipient.trim() || sending} style={{ alignSelf: 'flex-end' }}>
                                <Send size={14} /> {sending ? 'Sending...' : 'Share'}
                            </button>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
```

- [ ] **Step 2: Build and verify**

Run: `cd webmail-frontend && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add webmail-frontend/src/contacts/ContactShareModal.tsx
git commit -m "feat: contact share modal with email recipient + vCard attachment

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 11: Frontend — ContactTrash Component

**Files:**
- Create: `webmail-frontend/src/contacts/ContactTrash.tsx`

**Interfaces:**
- Consumes: `contacts` (ReturnType<typeof useContacts>)
- Produces: list of trashed contacts with Restore + Delete Forever buttons

- [ ] **Step 1: Create ContactTrash**

```typescript
import { RotateCcw, Trash2 } from 'lucide-react';
import type { Contact } from '../shared/types';
import * as api from '../shared/api';

export function ContactTrash({ contacts: c }: {
    contacts: {
        trashContacts: Contact[];
        refreshTrash: () => Promise<void>;
        refreshContacts: () => Promise<void>;
        isTrashLoading: boolean;
    };
}) {
    const handleRestore = async (id: number | string) => {
        await api.restoreContact(id);
        c.refreshTrash();
        c.refreshContacts();
    };

    const handlePermanentDelete = async (id: number | string) => {
        if (!window.confirm('Permanently delete this contact?')) return;
        await api.permanentDeleteContact(id);
        c.refreshTrash();
    };

    if (c.isTrashLoading) {
        return <div style={{ padding: 24, color: 'var(--text-secondary)', textAlign: 'center' }}>Loading trash...</div>;
    }

    if (c.trashContacts.length === 0) {
        return (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-secondary)' }}>
                <div style={{ fontSize: '1rem', marginBottom: 8 }}>Trash is empty</div>
                <div style={{ fontSize: '0.82rem' }}>Deleted contacts appear here for 30 days before permanent removal.</div>
            </div>
        );
    }

    return (
        <div style={{ padding: 16, overflow: 'auto', flex: 1 }}>
            <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: 12 }}>
                Contacts in trash are automatically deleted after 30 days.
            </div>
            {c.trashContacts.map((contact) => (
                <div key={contact.id} style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '10px 14px', marginBottom: 8,
                    border: '1px solid var(--border-glass)', borderRadius: 'var(--radius-md)',
                    background: 'var(--bg-glass)',
                }}>
                    <div>
                        <div style={{ fontWeight: 500 }}>{contact.name || contact.email}</div>
                        {contact.email && <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{contact.email}</div>}
                        {contact.deleted_at && (
                            <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginTop: 2 }}>
                                Deleted {new Date(contact.deleted_at).toLocaleDateString()}
                            </div>
                        )}
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                        <button className="btn btn-ghost" onClick={() => handleRestore(contact.id!)}
                            style={{ padding: '6px 12px', fontSize: '0.8rem' }}>
                            <RotateCcw size={14} /> Restore
                        </button>
                        <button className="btn btn-danger" onClick={() => handlePermanentDelete(contact.id!)}
                            style={{ padding: '6px 12px', fontSize: '0.8rem' }}>
                            <Trash2 size={14} /> Delete Forever
                        </button>
                    </div>
                </div>
            ))}
        </div>
    );
}
```

- [ ] **Step 2: Build and verify**

Run: `cd webmail-frontend && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add webmail-frontend/src/contacts/ContactTrash.tsx
git commit -m "feat: contact trash view with restore and permanent delete

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 12: Frontend — ContactSidebar Changes

**Files:**
- Modify: `webmail-frontend/src/contacts/ContactSidebar.tsx`

**Interfaces:**
- Consumes: `contacts` from useContacts (now includes `isDedupLoading`, `refreshDuplicates`, `setContactsView`, `contactsView`, `refreshTrash`, `trashContacts`)
- Produces: added "Find Duplicates" button, "Trash" nav item with count badge

- [ ] **Step 1: Add duplicates button and trash item**

In `ContactSidebar`, add imports at top:

```typescript
import { Users, Building2, Plus, ScanLine, Trash2 } from 'lucide-react';
```

Replace the "New Contact" button section to also include the duplicates button:

```typescript
<div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
    <button className="btn btn-primary" style={{ flex: 1 }}
        onClick={() => c.setContactsView('personal')}>
        <Plus size={16} /> New
    </button>
    <button className="btn btn-ghost" style={{ padding: '6px 10px' }}
        onClick={() => c.refreshDuplicates()}
        disabled={c.isDedupLoading}
        title="Find Duplicates">
        <ScanLine size={16} />
    </button>
</div>
```

Add Trash item below Groups section (before the closing `</div>` of the sidebar):

```typescript
<div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--border-glass)' }}>
    <div className="nav-item" style={{ display: 'flex', alignItems: 'center', gap: 8,
        padding: '6px 10px', borderRadius: 'var(--radius-md)', cursor: 'pointer',
        background: c.contactsView === 'trash' ? 'rgba(239,68,68,0.12)' : 'transparent',
        fontWeight: c.contactsView === 'trash' ? 600 : 400 }}
        onClick={() => {
            c.setContactsView('trash');
            c.refreshTrash();
        }}>
        <Trash2 size={16} color={c.contactsView === 'trash' ? 'var(--danger)' : 'currentColor'} />
        <span>Trash</span>
        {c.trashContacts.length > 0 && (
            <span style={{ marginLeft: 'auto', fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
                {c.trashContacts.length}
            </span>
        )}
    </div>
</div>
```

- [ ] **Step 2: Replace the `Plus` import and make sidebar handle new return type**

The existing import line needs updating. Replace:
```typescript
import { Users, Building2, Plus } from 'lucide-react';
```
with:
```typescript
import { Users, Building2, Plus, ScanLine, Trash2 } from 'lucide-react';
```

- [ ] **Step 3: Build and verify**

Run: `cd webmail-frontend && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add webmail-frontend/src/contacts/ContactSidebar.tsx
git commit -m "feat: add find duplicates button and trash nav to contacts sidebar

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 13: Frontend — ContactGrid Changes

**Files:**
- Modify: `webmail-frontend/src/contacts/ContactGrid.tsx`

**Interfaces:**
- Consumes: `contacts` from useContacts (now includes `selectedContact`, `setSelectedContact`, `selectedContactIds`, `setSelectedContactIds`, `contactsView`)
- Produces: onClick opens detail, checkbox selection, export dropdown

- [ ] **Step 1: Add onClick to ContactCard**

In the `ContactCard` component, add `onClick` prop:

```typescript
function ContactCard({ contact, onClick, isSelected, onToggleSelect }: {
    contact: Contact;
    onClick: () => void;
    isSelected?: boolean;
    onToggleSelect?: () => void;
}) {
    const initials = (contact.name || contact.email || '?').split(' ').map((p) => p[0]).join('').slice(0, 2).toUpperCase();
    return (
        <div className="contact-card glass-panel" style={{
            padding: 16, borderRadius: 'var(--radius-md)', cursor: 'pointer',
            position: 'relative',
            border: isSelected ? '1px solid var(--accent-primary)' : undefined,
            boxShadow: isSelected ? '0 0 0 1px var(--accent-primary)' : undefined,
        }} onClick={onClick}>
            {onToggleSelect && (
                <div style={{ position: 'absolute', top: 8, right: 8, zIndex: 2 }}
                    onClick={(e) => { e.stopPropagation(); onToggleSelect(); }}>
                    <div style={{
                        width: 20, height: 20, borderRadius: 4,
                        border: `2px solid ${isSelected ? 'var(--accent-primary)' : 'var(--border-glass)'}`,
                        background: isSelected ? 'var(--accent-primary)' : 'transparent',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                        {isSelected && <span style={{ color: 'white', fontSize: '0.7rem' }}>✓</span>}
                    </div>
                </div>
            )}
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                <div style={{ width: 40, height: 40, borderRadius: '50%',
                    background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-purple))',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '0.9rem', fontWeight: 600, color: 'white', flexShrink: 0 }}>
                    {initials}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: '0.95rem', marginBottom: 2 }}>
                        {contact.name || contact.email}
                    </div>
                    {contact.email && <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{contact.email}</div>}
                    {contact.phone && <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: 2 }}>{contact.phone}</div>}
                </div>
            </div>
        </div>
    );
}
```

- [ ] **Step 2: Add export dropdown to toolbar**

Replace the current toolbar (the `<div>` containing search input and grid/list toggle) to also include an export dropdown. Replace the export button area:

```typescript
const [showExportMenu, setShowExportMenu] = useState(false);

// In the toolbar, add after the grid/list toggle button:
<div style={{ position: 'relative' }}>
    <button className="btn btn-ghost" style={{ padding: '6px 10px' }}
        onClick={() => setShowExportMenu(!showExportMenu)}>
        Export
    </button>
    {showExportMenu && (
        <div className="glass-panel" style={{
            position: 'absolute', right: 0, top: '100%', marginTop: 4, zIndex: 50,
            padding: 4, minWidth: 160, borderRadius: 'var(--radius-md)',
        }}>
            <button className="btn btn-ghost" style={{ width: '100%', justifyContent: 'flex-start', fontSize: '0.85rem' }}
                onClick={() => { setShowExportMenu(false); window.open('/api/apps/contacts-export?format=vcard', '_blank'); }}>
                Export All (vCard)
            </button>
            <button className="btn btn-ghost" style={{ width: '100%', justifyContent: 'flex-start', fontSize: '0.85rem' }}
                onClick={() => { setShowExportMenu(false); window.open('/api/apps/contacts-export?format=csv', '_blank'); }}>
                Export All (CSV)
            </button>
            {c.selectedContactIds.size > 0 && (
                <>
                    <div style={{ height: 1, background: 'var(--border-glass)', margin: '2px 8px' }} />
                    <button className="btn btn-ghost" style={{ width: '100%', justifyContent: 'flex-start', fontSize: '0.85rem' }}
                        onClick={() => {
                            setShowExportMenu(false);
                            const ids = Array.from(c.selectedContactIds).join(',');
                            window.open(`/api/apps/contacts-export?format=vcard&ids=${ids}`, '_blank');
                        }}>
                        Export Selected ({c.selectedContactIds.size}) vCard
                    </button>
                    <button className="btn btn-ghost" style={{ width: '100%', justifyContent: 'flex-start', fontSize: '0.85rem' }}
                        onClick={() => {
                            setShowExportMenu(false);
                            const ids = Array.from(c.selectedContactIds).join(',');
                            window.open(`/api/apps/contacts-export?format=csv&ids=${ids}`, '_blank');
                        }}>
                        Export Selected ({c.selectedContactIds.size}) CSV
                    </button>
                </>
            )}
        </div>
    )}
</div>
```

- [ ] **Step 3: Wire ContactCard onClick to setSelectedContact**

In the row rendering, change the `ContactCard` usage from:
```typescript
<ContactCard key={contact.id} contact={contact} />
```
to:
```typescript
<ContactCard key={contact.id} contact={contact}
    onClick={() => c.setSelectedContact(contact)}
    isSelected={c.selectedContactIds.has(contact.id as number)}
    onToggleSelect={() => {
        const newSet = new Set(c.selectedContactIds);
        const id = contact.id as number;
        if (newSet.has(id)) newSet.delete(id); else newSet.add(id);
        c.setSelectedContactIds(newSet);
    }}
/>
```

- [ ] **Step 4: Add `useState` import at top**

The `ContactGrid` component now uses `useState` — ensure the import line is:
```typescript
import { useRef, useCallback, useState } from 'react';
```

- [ ] **Step 5: Build and verify**

Run: `cd webmail-frontend && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add webmail-frontend/src/contacts/ContactGrid.tsx
git commit -m "feat: contact card onClick, selection checkboxes, export dropdown

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 14: Frontend — ContactsLayout Integration

**Files:**
- Modify: `webmail-frontend/src/contacts/ContactsLayout.tsx`

**Interfaces:**
- Consumes: `ContactDetail`, `ContactTrash`, `ContactShareModal` components; updated useContacts return type
- Produces: three-panel layout, trash view routing, share modal

- [ ] **Step 1: Rewrite ContactsLayout with detail panel and trash**

Replace the entire file:

```typescript
import { useState } from 'react';
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle, useDefaultLayout } from 'react-resizable-panels';
import { useMediaQuery } from '../shared/hooks/useMediaQuery';
import { useContacts } from './hooks/useContacts';
import { ContactSidebar } from './ContactSidebar';
import { ContactGrid } from './ContactGrid';
import { ContactDetail } from './ContactDetail';
import { ContactTrash } from './ContactTrash';
import { ContactShareModal } from './ContactShareModal';
import { useAppearance } from '../shared/hooks/useAppearance';

function ResizeHandle() {
    return (
        <PanelResizeHandle style={{ width: 16, cursor: 'col-resize', position: 'relative' }}>
            <div style={{ position: 'absolute', top: 0, bottom: 0, left: 6, right: 6,
                background: 'rgba(255,255,255,0.08)', borderRadius: 4 }} />
        </PanelResizeHandle>
    );
}

export function ContactsLayout() {
    const contacts = useContacts();
    const isMobile = useMediaQuery('(max-width: 767px)');
    const { appearance } = useAppearance();
    const density = (appearance.density as 'compact' | 'cozy' | 'comfortable') || 'cozy';
    const [showShare, setShowShare] = useState(false);

    const contactsPanelLayout = useDefaultLayout({
        id: 'oms-contacts-v12',
        panelIds: ['contacts-sidebar', 'contacts-view'],
    });

    // Mobile: detail pushes over list
    if (isMobile) {
        if (contacts.selectedContact) {
            return (
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                    <ContactDetail
                        contact={contacts.selectedContact}
                        onClose={() => contacts.setSelectedContact(null)}
                        onEdit={() => { /* open edit modal */ }}
                        onShare={() => setShowShare(true)}
                    />
                    {showShare && contacts.selectedContact && (
                        <ContactShareModal
                            contact={contacts.selectedContact}
                            onClose={() => setShowShare(false)}
                        />
                    )}
                </div>
            );
        }
        if (contacts.contactsView === 'trash') {
            return (
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                    <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border-glass)' }}>
                        <button className="btn btn-ghost" onClick={() => contacts.setContactsView('personal')}>
                            ← Back to Contacts
                        </button>
                    </div>
                    <ContactTrash contacts={contacts} />
                </div>
            );
        }
        return (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                <ContactGrid contacts={contacts} density={density} />
            </div>
        );
    }

    // Desktop: three panels when detail open
    const showDetail = contacts.selectedContact !== null;
    const showTrash = contacts.contactsView === 'trash';

    return (
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden' }}>
            <PanelGroup
                id="oms-contacts-v12"
                orientation="horizontal"
                defaultLayout={contactsPanelLayout.defaultLayout}
                onLayoutChange={contactsPanelLayout.onLayoutChange}
                style={{ width: '100%', height: '100%', minHeight: 0, minWidth: 0 }}
            >
                <Panel id="contacts-sidebar" defaultSize="20%" minSize="10%" maxSize="35%">
                    <ContactSidebar contacts={contacts} />
                </Panel>
                <ResizeHandle />
                <Panel id="contacts-view" defaultSize={showDetail ? "50%" : "80%"} minSize="30%">
                    {showTrash ? (
                        <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                            <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border-glass)' }}>
                                <button className="btn btn-ghost" onClick={() => contacts.setContactsView('personal')}>
                                    ← Back to Contacts
                                </button>
                            </div>
                            <ContactTrash contacts={contacts} />
                        </div>
                    ) : (
                        <ContactGrid contacts={contacts} density={density} />
                    )}
                </Panel>
                {showDetail && (
                    <>
                        <ResizeHandle />
                        <Panel id="contacts-detail" defaultSize="30%" minSize="20%">
                            <ContactDetail
                                contact={contacts.selectedContact}
                                onClose={() => contacts.setSelectedContact(null)}
                                onEdit={() => { /* open edit modal */ }}
                                onShare={() => setShowShare(true)}
                            />
                        </Panel>
                    </>
                )}
            </PanelGroup>
            {showShare && contacts.selectedContact && (
                <ContactShareModal
                    contact={contacts.selectedContact}
                    onClose={() => setShowShare(false)}
                />
            )}
        </div>
    );
}
```

- [ ] **Step 2: Build and verify**

Run: `cd webmail-frontend && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add webmail-frontend/src/contacts/ContactsLayout.tsx
git commit -m "feat: integrate detail panel, trash, and share into contacts layout

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 15: Final Integration — Wire Edit Modal from Detail Panel

**Files:**
- Modify: `webmail-frontend/src/contacts/ContactsLayout.tsx`

**Description:** The ContactDetail `onEdit` prop currently does nothing. Wire it to open the existing contact edit modal (or a simple inline edit if no modal exists). Since the codebase already has contact CRUD through the API, we open the contact in the edit form. If there's an existing edit modal component, reuse it; otherwise we connect to the existing save flow.

- [ ] **Step 1: Check if a contact edit modal exists**

Run: `grep -rn 'saveContact\|editContact\|ContactModal\|EditContact' webmail-frontend/src/contacts/`

If no edit modal exists, we'll use a simple approach: clicking Edit from the detail panel selects the contact and switches to an edit state. For now, since the codebase uses the sidebar "New Contact" button to create (but doesn't show where the edit form lives), let's add a minimal edit-in-place approach or note this as a future task.

Actually, looking at the current code, there is NO edit modal component. The "New Contact" button in the sidebar sets `setContactsView('personal')` but there's no contact form UI component visible in the current codebase. The existing contact create/edit/delete likely happens through a separate admin panel or is triggered through the API.

For this plan, the `onEdit` handler opens the existing contact save flow. Since there's no existing edit modal component, we integrate with whatever mechanism the app uses. If the edit form lives in `App.tsx` or elsewhere, we'll need to bubble the event up. For now, the simplest approach: `onEdit` sets a state that can be handled at the app level, or we create a minimal inline edit form.

Let me check what edit mechanism exists:

- [ ] **Step 1: Determine edit approach**

Run a search for contact editing UI patterns in the codebase. If no existing edit modal, add the `ContactEditModal` (a simple form reusing the saveContact API). For this plan, we document the approach and wire it:

In `ContactsLayout.tsx`, add state:
```typescript
const [editingContact, setEditingContact] = useState<Contact | null>(null);
```

And the `onEdit` handler:
```typescript
onEdit={() => setEditingContact(contacts.selectedContact)}
```

And render a simple edit form modal when `editingContact` is set. The edit form reuses `saveContact` from the API. Since this is a straightforward form, include it inline in the layout or as a separate component.

Given the plan length, let me keep this as a minimal but functional edit connection. The contact create/edit form already works via the API — we just need to trigger it from the detail panel.

- [ ] **Step 2: Add ContactEditModal component**

Create `webmail-frontend/src/contacts/ContactEditModal.tsx` with a simple form:

```typescript
import { useState } from 'react';
import { X, Save } from 'lucide-react';
import type { Contact } from '../shared/types';
import * as api from '../shared/api';

export function ContactEditModal({ contact, onClose, onSaved }: {
    contact: Contact;
    onClose: () => void;
    onSaved: () => void;
}) {
    const isNew = !contact.id;
    const [form, setForm] = useState<Partial<Contact>>({ ...contact });
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    const handleChange = (field: string, value: string) => {
        setForm((prev) => ({ ...prev, [field]: value }));
    };

    const handleSave = async () => {
        setSaving(true);
        setError('');
        try {
            const result = await api.saveContact(form);
            if (result.success) {
                onSaved();
                onClose();
            } else {
                setError(result.error || 'Failed to save');
            }
        } catch {
            setError('Network error');
        }
        setSaving(false);
    };

    return (
        <div className="sync-setup-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
            <div className="sync-setup-modal glass-panel" style={{ width: 'min(560px, 100%)', maxHeight: 'min(85vh, 700px)' }}
                onClick={(e) => e.stopPropagation()}>
                <div className="sync-setup-header">
                    <div>
                        <div className="sync-setup-eyebrow">{isNew ? 'New' : 'Edit'} Contact</div>
                        <h3>{isNew ? 'Create Contact' : form.name || form.email || 'Edit'}</h3>
                    </div>
                    <button className="btn btn-ghost" onClick={onClose}><X size={18} /></button>
                </div>
                <div className="sync-setup-body" style={{ gap: 12 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                        <div className="settings-field">
                            <label style={{ color: 'var(--text-secondary)', fontSize: '0.82rem' }}>First Name</label>
                            <input className="glass-input" value={form.first_name || ''} onChange={(e) => handleChange('first_name', e.target.value)} />
                        </div>
                        <div className="settings-field">
                            <label style={{ color: 'var(--text-secondary)', fontSize: '0.82rem' }}>Last Name</label>
                            <input className="glass-input" value={form.last_name || ''} onChange={(e) => handleChange('last_name', e.target.value)} />
                        </div>
                    </div>
                    <div className="settings-field">
                        <label style={{ color: 'var(--text-secondary)', fontSize: '0.82rem' }}>Email</label>
                        <input className="glass-input" type="email" value={form.email || ''} onChange={(e) => handleChange('email', e.target.value)} />
                    </div>
                    <div className="settings-field">
                        <label style={{ color: 'var(--text-secondary)', fontSize: '0.82rem' }}>Phone</label>
                        <input className="glass-input" value={form.phone || ''} onChange={(e) => handleChange('phone', e.target.value)} />
                    </div>
                    <div className="settings-field">
                        <label style={{ color: 'var(--text-secondary)', fontSize: '0.82rem' }}>Organization</label>
                        <input className="glass-input" value={form.organization || ''} onChange={(e) => handleChange('organization', e.target.value)} />
                    </div>
                    <div className="settings-field">
                        <label style={{ color: 'var(--text-secondary)', fontSize: '0.82rem' }}>Job Title</label>
                        <input className="glass-input" value={form.job_title || ''} onChange={(e) => handleChange('job_title', e.target.value)} />
                    </div>
                    <div className="settings-field">
                        <label style={{ color: 'var(--text-secondary)', fontSize: '0.82rem' }}>Birthday (YYYY-MM-DD)</label>
                        <input className="glass-input" value={form.birthday || ''} onChange={(e) => handleChange('birthday', e.target.value)} placeholder="1990-01-15" />
                    </div>
                    <div className="settings-field">
                        <label style={{ color: 'var(--text-secondary)', fontSize: '0.82rem' }}>Notes</label>
                        <textarea className="glass-input" rows={3} value={form.notes || ''} onChange={(e) => handleChange('notes', e.target.value)} style={{ resize: 'vertical' }} />
                    </div>
                    {error && <div className="settings-error-banner">{error}</div>}
                    <button className="btn btn-primary" onClick={handleSave} disabled={saving} style={{ alignSelf: 'flex-end' }}>
                        <Save size={14} /> {saving ? 'Saving...' : 'Save'}
                    </button>
                </div>
            </div>
        </div>
    );
}
```

- [ ] **Step 3: Wire ContactEditModal into ContactsLayout**

In `ContactsLayout.tsx`, add import:
```typescript
import { ContactEditModal } from './ContactEditModal';
```

Add state:
```typescript
const [editingContact, setEditingContact] = useState<Contact | null>(null);
```

Change the `onEdit` prop passed to `ContactDetail`:
```typescript
onEdit={() => setEditingContact(contacts.selectedContact)}
```

Add at the end of the return (before the closing tag):
```typescript
{editingContact && (
    <ContactEditModal
        contact={editingContact}
        onClose={() => setEditingContact(null)}
        onSaved={() => {
            contacts.refreshContacts();
            contacts.setSelectedContact(null);
        }}
    />
)}
```

Also wire the sidebar "New" button: change the onClick from `() => c.setContactsView('personal')` to actually open the edit modal with an empty contact. In `ContactsLayout.tsx`, pass an `onNewContact` callback:
```typescript
const handleNewContact = () => {
    setEditingContact({ name: '', email: '' });
};
```

And pass this to the sidebar. But since `ContactSidebar` takes `contacts` directly, we need a different approach. The simplest: add a state in `ContactsLayout` and conditionally render the edit modal there.

Actually, let's keep it simpler. The sidebar "New" button's onClick is currently `() => c.setContactsView('personal')` which just switches view. Let's keep that behavior and rely on the edit modal being opened from the detail panel's Edit button. The existing "New Contact" button in the original code was wired to switch views — removing that would change existing behavior. We'll add edit from detail, and leave the "New" button as-is for now.

- [ ] **Step 4: Build and verify**

Run: `cd webmail-frontend && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add webmail-frontend/src/contacts/ContactEditModal.tsx webmail-frontend/src/contacts/ContactsLayout.tsx
git commit -m "feat: contact edit modal wired to detail panel and layout

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 16: Build Verification

- [ ] **Step 1: Full TypeScript check**

```bash
cd webmail-frontend && npx tsc --noEmit
cd ../webmail-backend && npx tsc --noEmit
```

Expected: Both pass with zero errors.

- [ ] **Step 2: Frontend build check**

```bash
cd webmail-frontend && npx vite build
```

Expected: Build succeeds.

- [ ] **Step 3: Verify all imports resolve**

```bash
cd webmail-frontend && grep -rn "from '\.\." src/contacts/ | grep -v node_modules | sort
```

Expected: All local imports point to existing files.

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "chore: build verification, all contacts polish features complete

Co-Authored-By: Claude <noreply@anthropic.com>"
```

# Phase 2 — Mail App Polish: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add inline reply, snooze, drag-drop attachments, hover actions, raw-message view, and a print stylesheet to the mail app.

**Architecture:** Each feature is a self-contained addition to the existing mail components. Three new sub-components (`InlineReply`, `SnoozePopover`, `RawMessageModal`) plug into `MessageViewer`. `MessageRow` gains a hover-action bar. `ComposeModal` gains drop-zone handlers. Two small backend endpoints (`/raw`, `/snooze`) added to `webmail-backend`.

**Tech Stack:** React 19, TypeScript 6, date-fns, lucide-react (no new dependencies)

## Global Constraints

- No new npm dependencies
- Plain text for inline reply (ReactQuill lazy-loaded for full compose only)
- Snooze presets use date-fns (already a dependency)
- Print CSS uses standard `@media print` — no JS required
- Backend changes are minimal — one route each for raw and snooze, no new DB tables
- All changes scoped to `webmail-frontend/src/mail/` and `webmail-backend/src/api.ts`

---

### Task 1: Print Stylesheet

**Files:**
- Modify: `webmail-frontend/src/index.css` (append `@media print` block)

**Interfaces:**
- None — pure CSS, no JS dependencies

- [ ] **Step 1: Add the print stylesheet to index.css**

Append to `webmail-frontend/src/index.css`:

```css
/* ---- Print Styles ---- */
@media print {
  .app-shell-header,
  .mobile-tab-bar,
  [data-panel-group-direction] > :first-child,
  [data-panel-resize-handle],
  .mail-toolbar,
  .message-viewer-toolbar,
  .inline-reply-box,
  .compose-modal-overlay,
  .snooze-popover {
    display: none !important;
  }

  body {
    background: white !important;
    color: black !important;
    font-size: 12pt !important;
    font-family: Georgia, 'Times New Roman', serif !important;
  }

  .glass-panel {
    background: none !important;
    backdrop-filter: none !important;
    -webkit-backdrop-filter: none !important;
    border: none !important;
    box-shadow: none !important;
    border-radius: 0 !important;
    padding: 0 !important;
  }

  .message-body {
    color: black !important;
    line-height: 1.5 !important;
  }

  .message-body a {
    color: black !important;
    text-decoration: underline !important;
  }

  a[href]::after {
    content: " (" attr(href) ")";
    font-size: 0.8em;
    color: #666;
  }

  @page {
    margin: 1.5cm;
  }
}
```

- [ ] **Step 2: Verify the build still passes**

```bash
cd /root/openmailstack/webmail-frontend && npx vite build 2>&1 | tail -3
```

Expected: `✓ built in ...` with no errors.

- [ ] **Step 3: Commit**

```bash
git add webmail-frontend/src/index.css
git commit -m "feat: add print stylesheet — hide chrome, clean typography

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: Quick Hover Actions on Message Rows

**Files:**
- Modify: `webmail-frontend/src/mail/MessageRow.tsx` (add action bar, hover CSS)

**Interfaces:**
- Consumes: `messageAction` from the mail hook (already passed via props)
- Produces: Hover-revealed action icons on each message row

- [ ] **Step 1: Add hover action icons to MessageRow**

Update `webmail-frontend/src/mail/MessageRow.tsx`. Replace the date section in the second content row with a split layout that shows actions on hover.

Add these imports at the top (add to existing lucide-react import):
```typescript
import { Archive, Trash2, Mail, MailOpen, Clock } from 'lucide-react';
```

Add `onArchive`, `onDelete`, `onMarkRead`, `onSnooze` to the `MessageRowProps` interface:

```typescript
interface MessageRowProps {
  message: Message;
  isSelected: boolean;
  isThreaded: boolean;
  density: 'compact' | 'cozy' | 'comfortable';
  style?: React.CSSProperties;
  onSelect: (uid: number, shift: boolean) => void;
  onClick: (uid: number) => void;
  onStar: (uid: number) => void;
  onArchive: (uid: number) => void;
  onDelete: (uid: number) => void;
  onMarkRead: (uid: number) => void;
  onSnooze: (uid: number) => void;
  forwardedRef?: React.RefCallback<HTMLDivElement>;
}
```

In the second content row, replace the existing date + attachments span with:

```tsx
<div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 2,
  fontSize: density === 'compact' ? '0.75rem' : '0.82rem', color: 'var(--text-secondary)' }}>
  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    fontWeight: message.isRead ? 400 : 500 }}>
    {message.subject || '(no subject)'}
  </span>
  <span style={{ flexShrink: 0, marginLeft: 8, display: 'flex', gap: 4, alignItems: 'center' }}>
    <span className="message-row-date" style={{ marginRight: 4 }}>{dateStr}</span>
    {message.hasAttachments && <Paperclip size={12} />}
  </span>
</div>

{/* Hover action bar — appears on row hover */}
<div className="message-row-actions" style={{
  display: 'flex', gap: 2, alignItems: 'center',
  opacity: 0, transition: 'opacity 0.15s ease',
}}>
  <ActionButton icon={Archive} title="Archive" onClick={() => onArchive(message.uid)} />
  <ActionButton icon={Trash2} title="Delete" onClick={() => onDelete(message.uid)} />
  <ActionButton icon={message.isRead ? Mail : MailOpen} title={message.isRead ? 'Mark unread' : 'Mark read'}
    onClick={() => onMarkRead(message.uid)} />
  <ActionButton icon={Clock} title="Snooze" onClick={() => onSnooze(message.uid)} />
</div>
```

Add the `ActionButton` helper component at the bottom of the file:

```typescript
function ActionButton({ icon: Icon, title, onClick }: {
  icon: React.ComponentType<any>; title: string; onClick: () => void;
}) {
  return (
    <button
      className="btn btn-ghost"
      title={title}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      style={{ padding: '2px 4px', borderRadius: 4, fontSize: 0 }}
    >
      <Icon size={14} />
    </button>
  );
}
```

- [ ] **Step 2: Add hover CSS to index.css**

Append to `webmail-frontend/src/index.css`:

```css
.message-row:hover .message-row-actions {
  opacity: 1 !important;
}

.message-row:hover .message-row-date {
  display: none;
}
```

- [ ] **Step 3: Update MessageList to pass new action callbacks**

In `webmail-frontend/src/mail/MessageList.tsx`, update the `MessageRow` JSX to pass the new props:

```tsx
<MessageRow
  key={msg.uid} message={msg}
  isSelected={mail.selectedMessages.includes(msg.uid)}
  isThreaded={false} density={density}
  style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${virtualRow.start}px)` }}
  onSelect={handleSelect} onClick={handleClick} onStar={handleStar}
  onArchive={(uid) => mail.messageAction('archive', [uid])}
  onDelete={(uid) => mail.messageAction('delete', [uid])}
  onMarkRead={(uid) => {
    const msg = mail.messages.find((m) => m.uid === uid);
    if (msg) mail.messageAction(msg.isRead ? 'unread' : 'read', [uid]);
  }}
  onSnooze={(uid) => { /* wired in Task 6 */ }}
/>
```

- [ ] **Step 4: Verify build**

```bash
cd /root/openmailstack/webmail-frontend && npx tsc -b 2>&1
```

Expected: `TypeScript: No errors found`

- [ ] **Step 5: Commit**

```bash
git add webmail-frontend/src/mail/MessageRow.tsx webmail-frontend/src/mail/MessageList.tsx webmail-frontend/src/index.css
git commit -m "feat: add quick hover actions to message rows — archive, delete, read, snooze

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: Inline Reply Box

**Files:**
- Create: `webmail-frontend/src/mail/components/InlineReply.tsx`
- Modify: `webmail-frontend/src/mail/MessageViewer.tsx` (add inline reply below message body)
- Modify: `webmail-frontend/src/mail/hooks/useMail.ts` (add reply state + sendReply)

**Interfaces:**
- Consumes: `mail.composeTo`, `mail.composeSubject` from `useMail`
- Produces: `<InlineReply>` component, `useMail` gains `replyText`, `sendReply()`

- [ ] **Step 1: Add reply state to useMail**

In `webmail-frontend/src/mail/hooks/useMail.ts`, add after the existing compose state:

```typescript
// Inline reply state
const [replyText, setReplyText] = useState('');
const [replySending, setReplySending] = useState(false);

const sendReply = useCallback(async (to: string, subject: string, inReplyTo: string, references: string) => {
  setReplySending(true);
  try {
    const formData = new FormData();
    formData.append('to', to);
    formData.append('subject', subject.startsWith('Re:') ? subject : `Re: ${subject}`);
    formData.append('body', replyText);
    formData.append('inReplyTo', inReplyTo);
    formData.append('references', references);
    await api.sendMessage(formData);
    setReplyText('');
    return true;
  } catch (e) {
    console.error('Reply failed', e);
    return false;
  } finally {
    setReplySending(false);
  }
}, [replyText]);
```

Add to the return object:
```typescript
replyText, setReplyText, replySending, sendReply,
```

- [ ] **Step 2: Create InlineReply component**

Create `webmail-frontend/src/mail/components/InlineReply.tsx`:

```typescript
import { Send, Paperclip, Maximize2 } from 'lucide-react';
import { useState } from 'react';

interface InlineReplyProps {
  replyText: string;
  replySending: boolean;
  onReplyTextChange: (text: string) => void;
  onSend: () => void;
  onOpenFullCompose: () => void;
}

export function InlineReply({
  replyText, replySending, onReplyTextChange, onSend, onOpenFullCompose,
}: InlineReplyProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="inline-reply-box" style={{
      borderTop: '2px solid var(--border-glass)', padding: 12,
      background: 'rgba(0,0,0,0.1)',
    }}>
      <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8 }}>
        Quick Reply
      </div>
      <textarea
        className="glass-input"
        placeholder="Type your reply..."
        value={replyText}
        onChange={(e) => onReplyTextChange(e.target.value)}
        onFocus={() => setExpanded(true)}
        rows={expanded ? 6 : 3}
        style={{
          width: '100%', resize: 'vertical', minHeight: expanded ? 120 : 60,
          fontFamily: 'inherit', fontSize: '0.9rem',
        }}
      />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            className="btn btn-primary"
            disabled={!replyText.trim() || replySending}
            onClick={onSend}
            style={{ fontSize: '0.85rem', padding: '6px 14px' }}
          >
            <Send size={14} />
            {replySending ? 'Sending...' : 'Send'}
          </button>
          <button
            className="btn btn-ghost"
            onClick={onOpenFullCompose}
            style={{ fontSize: '0.8rem' }}
          >
            <Maximize2 size={14} />
            Rich editor
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Wire InlineReply into MessageViewer**

In `webmail-frontend/src/mail/MessageViewer.tsx`, add the import:

```typescript
import { InlineReply } from './components/InlineReply';
```

Add after the message content div (after the attachments section), before the closing `</div>` of the outer container:

```tsx
<InlineReply
  replyText={mail.replyText}
  replySending={mail.replySending || false}
  onReplyTextChange={mail.setReplyText}
  onSend={() => {
    if (message) {
      mail.sendReply(
        message.from?.match(/<(.+?)>/)?.at(1) || message.from,
        message.subject || '',
        message.messageId || '',
        (message.references || []).join(' ')
      );
    }
  }}
  onOpenFullCompose={() => {
    if (message) {
      mail.setComposeTo(message.from);
      mail.setComposeSubject(`Re: ${message.subject}`);
      mail.setComposeBody(mail.replyText);
      mail.setIsComposing(true);
    }
  }}
/>
```

- [ ] **Step 4: Verify build**

```bash
cd /root/openmailstack/webmail-frontend && npx tsc -b 2>&1
```

Expected: Clean build.

- [ ] **Step 5: Commit**

```bash
git add webmail-frontend/src/mail/components/InlineReply.tsx webmail-frontend/src/mail/MessageViewer.tsx webmail-frontend/src/mail/hooks/useMail.ts
git commit -m "feat: add inline reply box — plain text, quick send, rich editor link

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 4: Drag-and-Drop Attachments into Compose

**Files:**
- Modify: `webmail-frontend/src/mail/ComposeModal.tsx`

**Interfaces:**
- Consumes: `composeAttachments`, `setComposeAttachments` from mail hook
- Produces: Drop zone overlay on the compose modal

- [ ] **Step 1: Add drag-drop handlers to ComposeModal**

In `webmail-frontend/src/mail/ComposeModal.tsx`, add state for drag-over:

```typescript
import { useState } from 'react';  // add to existing import
```

Inside the component, add:

```typescript
const [isDragOver, setIsDragOver] = useState(false);

const handleDragOver = (e: React.DragEvent) => {
  e.preventDefault();
  e.stopPropagation();
  setIsDragOver(true);
};

const handleDragLeave = (e: React.DragEvent) => {
  e.preventDefault();
  e.stopPropagation();
  // Only set false if leaving the modal boundary
  if (e.currentTarget === e.target) setIsDragOver(false);
};

const handleDrop = (e: React.DragEvent) => {
  e.preventDefault();
  e.stopPropagation();
  setIsDragOver(false);
  if (e.dataTransfer.files.length > 0) {
    mail.setComposeAttachments((prev) => [...prev, ...Array.from(e.dataTransfer.files)]);
  }
};
```

Add `onDragOver`, `onDragEnter`, `onDragLeave`, `onDrop` to the modal overlay div (the outer `position: fixed` div):

```tsx
<div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.7)',
  display: 'flex', alignItems: 'flex-end', justifyContent: 'flex-end', padding: 20 }}
  onDragOver={handleDragOver}
  onDragEnter={handleDragOver}
  onDragLeave={handleDragLeave}
  onDrop={handleDrop}>
```

Add a conditional drop overlay inside the modal container, before the header:

```tsx
{isDragOver && (
  <div style={{
    position: 'absolute', inset: 0, zIndex: 10,
    background: 'rgba(59,130,246,0.15)',
    border: '3px dashed var(--accent-primary)',
    borderRadius: 'var(--radius-lg)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    pointerEvents: 'none',
  }}>
    <span style={{ fontSize: '1.2rem', fontWeight: 600, color: 'var(--accent-primary)' }}>
      Drop files to attach
    </span>
  </div>
)}
```

- [ ] **Step 2: Verify build**

```bash
cd /root/openmailstack/webmail-frontend && npx tsc -b 2>&1
```

Expected: Clean build.

- [ ] **Step 3: Commit**

```bash
git add webmail-frontend/src/mail/ComposeModal.tsx
git commit -m "feat: add drag-and-drop attachments to compose modal

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 5: Show Original / View Raw Headers

**Files:**
- Create: `webmail-frontend/src/mail/components/RawMessageModal.tsx`
- Modify: `webmail-frontend/src/mail/MessageViewer.tsx` (add "Show original" button)
- Modify: `webmail-backend/src/api.ts` (add `GET /raw` endpoint)

**Interfaces:**
- Consumes: Message folder + UID from URL params
- Produces: `<RawMessageModal>` that fetches and displays raw message source

- [ ] **Step 1: Add backend raw-message endpoint**

In `webmail-frontend/src/mail/components/RawMessageModal.tsx`, add the endpoint route to `webmail-backend/src/api.ts`. Find the existing messages route registration and add:

```typescript
// GET /api/folders/:folder/messages/:uid/raw — returns raw RFC 5322 source
app.get('/api/folders/:folder/messages/:uid/raw', async (req: any, res: any) => {
  try {
    const user = req.session?.user;
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const { folder, uid } = req.params;
    const imap = await getImapConnection(user);
    await imap.mailboxOpen(decodeURIComponent(folder));
    const message = await imap.fetchOne(`${uid}`, { source: true });
    await imap.logout();

    if (!message || !message.source) {
      return res.status(404).json({ error: 'Message not found' });
    }

    res.set('Content-Type', 'text/plain; charset=utf-8');
    res.send(message.source.toString());
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to fetch raw message' });
  }
});
```

- [ ] **Step 2: Create RawMessageModal component**

Create `webmail-frontend/src/mail/components/RawMessageModal.tsx`:

```typescript
import { X, Copy, Check } from 'lucide-react';
import { useState, useEffect } from 'react';

interface RawMessageModalProps {
  folder: string;
  uid: number;
  onClose: () => void;
}

export function RawMessageModal({ folder, uid, onClose }: RawMessageModalProps) {
  const [raw, setRaw] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/folders/${encodeURIComponent(folder)}/messages/${uid}/raw`)
      .then((res) => {
        if (!res.ok) throw new Error('Failed to fetch');
        return res.text();
      })
      .then((text) => { setRaw(text); setLoading(false); })
      .catch((e) => { setError(e.message); setLoading(false); });
  }, [folder, uid]);

  const handleCopy = async () => {
    if (raw) {
      await navigator.clipboard.writeText(raw);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1100, background: 'rgba(0,0,0,0.7)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="glass-panel" style={{ width: 750, maxHeight: '85vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '12px 16px', borderBottom: '1px solid var(--border-glass)' }}>
          <span style={{ fontWeight: 600 }}>Raw Message</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-ghost" onClick={handleCopy}
              style={{ padding: '4px 10px', fontSize: '0.8rem' }}>
              {copied ? <><Check size={14} /> Copied</> : <><Copy size={14} /> Copy</>}
            </button>
            <button className="btn btn-ghost" onClick={onClose} style={{ padding: 4 }}>
              <X size={18} />
            </button>
          </div>
        </div>
        <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
          {loading && <div style={{ color: 'var(--text-secondary)' }}>Loading...</div>}
          {error && <div style={{ color: 'var(--danger)' }}>{error}</div>}
          {raw && (
            <pre style={{
              whiteSpace: 'pre-wrap', fontFamily: "'SF Mono', 'Fira Code', monospace",
              fontSize: '0.78rem', lineHeight: 1.5, color: 'var(--text-primary)',
              margin: 0,
            }}>
              {raw}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Add "Show original" button to MessageViewer**

In `webmail-frontend/src/mail/MessageViewer.tsx`, add state:

```typescript
const [showRaw, setShowRaw] = useState(false);
```

Add import:
```typescript
import { RawMessageModal } from './components/RawMessageModal';
import { Code } from 'lucide-react';  // add to existing import
```

Add button in the toolbar (after the Forward button, before the spacer):
```tsx
<button className="btn btn-ghost" onClick={() => setShowRaw(true)} title="Show original">
  <Code size={16} />
</button>
```

Render the modal conditionally (after the closing `</div>` of the viewer):
```tsx
{showRaw && message && (
  <RawMessageModal
    folder={folder || 'INBOX'}
    uid={message.uid}
    onClose={() => setShowRaw(false)}
  />
)}
```

- [ ] **Step 4: Verify frontend build**

```bash
cd /root/openmailstack/webmail-frontend && npx tsc -b 2>&1
```

Expected: Clean build.

- [ ] **Step 5: Verify backend compiles**

```bash
cd /root/openmailstack/webmail-backend && npx tsc 2>&1 | head -10
```

Expected: No errors (or only pre-existing ones unrelated to the new route).

- [ ] **Step 6: Commit**

```bash
git add webmail-frontend/src/mail/components/RawMessageModal.tsx webmail-frontend/src/mail/MessageViewer.tsx webmail-backend/src/api.ts
git commit -m "feat: add 'Show original' raw message viewer with copy-to-clipboard

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 6: Snooze with Custom Time Picker

**Files:**
- Create: `webmail-frontend/src/mail/components/SnoozePopover.tsx`
- Modify: `webmail-frontend/src/mail/MessageViewer.tsx` (add snooze button)
- Modify: `webmail-frontend/src/mail/hooks/useMail.ts` (add snooze action)
- Modify: `webmail-backend/src/api.ts` (add `POST /snooze` endpoint)

**Interfaces:**
- Consumes: `messageAction` from `useMail`
- Produces: `<SnoozePopover>` with preset times + custom picker, `snoozeMessages()` in hook

- [ ] **Step 1: Add backend snooze endpoint**

In `webmail-backend/src/api.ts`, add after the existing message action route:

```typescript
// POST /api/messages/snooze — snooze messages until a time
app.post('/api/messages/snooze', async (req: any, res: any) => {
  try {
    const user = req.session?.user;
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const { folder, uids, until } = req.body;
    if (!uids || !uids.length || !until) {
      return res.status(400).json({ error: 'Missing uids or until' });
    }

    const untilDate = new Date(until);
    if (isNaN(untilDate.getTime())) {
      return res.status(400).json({ error: 'Invalid until date' });
    }

    const imap = await getImapConnection(user);

    // Ensure Snoozed folder exists
    await imap.mailboxCreate('Snoozed').catch(() => {});

    // Move messages to Snoozed
    await imap.mailboxOpen(folder);
    await imap.messageMove(uids.map(String), 'Snoozed');

    // Add snooze-until custom flag or store in DB
    // For now: store in MySQL snooze_queue table
    const db = await getDb();
    for (const uid of uids) {
      await db.execute(
        `INSERT INTO snooze_queue (owner, original_folder, imap_uid, snooze_until)
         VALUES (?, ?, ?, ?)`,
        [user, folder, uid, untilDate.toISOString()]
      );
    }

    await imap.logout();

    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Snooze failed' });
  }
});
```

Also add the snooze check on mail fetch (in the existing `GET /api/folders/:path/messages` handler, add before returning messages):

```typescript
// Check for expired snoozes and restore them
const db = await getDb();
const [expired] = await db.execute(
  `SELECT original_folder, imap_uid FROM snooze_queue
   WHERE owner = ? AND snooze_until <= NOW()`,
  [user]
);
if (Array.isArray(expired) && expired.length > 0) {
  const imap = await getImapConnection(user);
  await imap.mailboxOpen('Snoozed');
  for (const row of expired as any[]) {
    await imap.messageMove([String(row.imap_uid)], row.original_folder);
  }
  await imap.logout();
  await db.execute(
    `DELETE FROM snooze_queue WHERE owner = ? AND snooze_until <= NOW()`,
    [user]
  );
}
```

- [ ] **Step 2: Add snooze state + action to useMail**

In `webmail-frontend/src/mail/hooks/useMail.ts`, add state:

```typescript
const [snoozingUid, setSnoozingUid] = useState<number | null>(null);

const snoozeMessages = useCallback(async (uids: number[], until: Date) => {
  try {
    await fetch('/api/messages/snooze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folder: activeFolder, uids, until: until.toISOString() }),
    });
    await fetchMessages();
    await fetchFolders();
  } catch (e) { console.error('Snooze failed', e); }
}, [activeFolder, fetchMessages, fetchFolders]);
```

Add to return:
```typescript
snoozingUid, setSnoozingUid, snoozeMessages,
```

- [ ] **Step 3: Create SnoozePopover component**

Create `webmail-frontend/src/mail/components/SnoozePopover.tsx`:

```typescript
import { Clock, X } from 'lucide-react';
import { format, addHours, addDays, startOfDay, setHours, nextSaturday } from 'date-fns';

interface SnoozePopoverProps {
  onSelect: (until: Date) => void;
  onClose: () => void;
}

function getPresets(): { label: string; date: Date }[] {
  const now = new Date();
  const today6pm = setHours(startOfDay(now), 18);
  const tomorrow8am = setHours(startOfDay(addDays(now, 1)), 8);
  const saturday10am = setHours(startOfDay(nextSaturday(now)), 10);
  const nextMonday8am = (() => {
    const d = new Date(now);
    d.setDate(d.getDate() + ((1 + 7 - d.getDay()) % 7 || 7));
    return setHours(startOfDay(d), 8);
  })();

  return [
    { label: `Later today (${format(today6pm, 'h:mm a')})`, date: today6pm },
    { label: `Tomorrow (${format(tomorrow8am, 'h:mm a')})`, date: tomorrow8am },
    { label: `This weekend (${format(saturday10am, 'EEE h:mm a')})`, date: saturday10am },
    { label: `Next week (${format(nextMonday8am, 'EEE h:mm a')})`, date: nextMonday8am },
  ];
}

export function SnoozePopover({ onSelect, onClose }: SnoozePopoverProps) {
  const presets = getPresets();

  return (
    <div style={{ position: 'absolute', top: '100%', right: 0, zIndex: 50, marginTop: 4 }}
      onClick={(e) => e.stopPropagation()}>
      <div className="glass-panel" style={{ width: 260, padding: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '4px 8px', marginBottom: 4 }}>
          <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>Snooze until</span>
          <button className="btn btn-ghost" onClick={onClose} style={{ padding: 2 }}><X size={14} /></button>
        </div>
        {presets.map((preset) => (
          <div key={preset.label}
            style={{ padding: '8px 12px', cursor: 'pointer', borderRadius: 'var(--radius-sm)',
              fontSize: '0.85rem' }}
            className="nav-item"
            onClick={() => onSelect(preset.date)}>
            <Clock size={14} style={{ marginRight: 8 }} />
            {preset.label}
          </div>
        ))}
        <div style={{ borderTop: '1px solid var(--border-glass)', margin: '4px 0' }} />
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px',
          cursor: 'pointer', borderRadius: 'var(--radius-sm)', fontSize: '0.85rem' }}
          className="nav-item">
          <Clock size={14} />
          Custom...
          <input type="datetime-local"
            style={{ marginLeft: 'auto', background: 'transparent', border: '1px solid var(--border-glass)',
              borderRadius: 4, color: 'var(--text-primary)', padding: '2px 4px', fontSize: '0.8rem' }}
            onChange={(e) => {
              if (e.target.value) onSelect(new Date(e.target.value));
            }} />
        </label>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Wire snooze into MessageViewer**

In `webmail-frontend/src/mail/MessageViewer.tsx`, add state for the popover:

```typescript
const [showSnooze, setShowSnooze] = useState(false);
```

Add import:
```typescript
import { SnoozePopover } from './components/SnoozePopover';
```

Add a snooze button in the toolbar (after the star button):
```tsx
<div style={{ position: 'relative' }}>
  <button className="btn btn-ghost" onClick={() => setShowSnooze(!showSnooze)} title="Snooze">
    <Clock size={16} />
  </button>
  {showSnooze && (
    <SnoozePopover
      onSelect={(until) => {
        mail.snoozeMessages([message!.uid], until);
        setShowSnooze(false);
      }}
      onClose={() => setShowSnooze(false)}
    />
  )}
</div>
```

- [ ] **Step 5: Wire snooze on hover action in MessageList**

Update the `onSnooze` prop in `MessageList.tsx` MessageRow to open a snooze for that message. For now, snooze immediately to "Tomorrow 8am" on single-click:

```tsx
onSnooze={(uid) => {
  const tomorrow8am = setHours(startOfDay(addDays(new Date(), 1)), 8);
  mail.snoozeMessages([uid], tomorrow8am);
}}
```

(Add `import { addDays, startOfDay, setHours } from 'date-fns';` at top of MessageList.tsx)

- [ ] **Step 6: Create DB table for snooze queue**

If it doesn't exist, add to the backend DB setup:

```sql
CREATE TABLE IF NOT EXISTS snooze_queue (
  id INT AUTO_INCREMENT PRIMARY KEY,
  owner VARCHAR(255) NOT NULL,
  original_folder VARCHAR(255) NOT NULL,
  imap_uid INT NOT NULL,
  snooze_until DATETIME NOT NULL,
  INDEX idx_owner (owner),
  INDEX idx_snooze_until (snooze_until)
);
```

- [ ] **Step 7: Verify frontend build**

```bash
cd /root/openmailstack/webmail-frontend && npx tsc -b 2>&1
```

Expected: Clean build.

- [ ] **Step 8: Commit**

```bash
git add webmail-frontend/src/mail/components/SnoozePopover.tsx webmail-frontend/src/mail/MessageViewer.tsx webmail-frontend/src/mail/hooks/useMail.ts webmail-frontend/src/mail/MessageList.tsx webmail-backend/src/api.ts
git commit -m "feat: add snooze with preset times, custom picker, and backend snooze queue

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 7: Final Integration & Verification

**Files:**
- All modified files from Tasks 1-6

- [ ] **Step 1: Full TypeScript check**

```bash
cd /root/openmailstack/webmail-frontend && npx tsc -b 2>&1
```

Expected: `TypeScript: No errors found`

- [ ] **Step 2: Production build**

```bash
cd /root/openmailstack/webmail-frontend && npx vite build 2>&1 | tail -3
```

Expected: `✓ built in ...`

- [ ] **Step 3: Backend TypeScript check**

```bash
cd /root/openmailstack/webmail-backend && npx tsc 2>&1 | tail -5
```

Expected: No new errors.

- [ ] **Step 4: Run integration smoke tests if available**

```bash
cd /root/openmailstack && bash tests/run_all.sh 2>&1 | tail -10
```

- [ ] **Step 5: Final commit if any straggling changes**

```bash
git add -A && git diff --staged --name-only
# If any uncommitted changes: commit them
```

---

## Summary

| Task | Feature | Files | Backend? |
|------|---------|-------|----------|
| 1 | Print stylesheet | `index.css` | No |
| 2 | Hover actions | `MessageRow.tsx`, `MessageList.tsx`, `index.css` | No |
| 3 | Inline reply | `InlineReply.tsx` (new), `MessageViewer.tsx`, `useMail.ts` | No |
| 4 | Drag-drop attachments | `ComposeModal.tsx` | No |
| 5 | Show original | `RawMessageModal.tsx` (new), `MessageViewer.tsx` | Yes — `GET /raw` |
| 6 | Snooze | `SnoozePopover.tsx` (new), `MessageViewer.tsx`, `useMail.ts`, `MessageList.tsx` | Yes — `POST /snooze` |
| 7 | Integration | Build check, test run | Both |

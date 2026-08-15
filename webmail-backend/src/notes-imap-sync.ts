import { ImapService } from './imap';
import { deleteNoteIfRevisionMatches, listNotes, saveNote } from './notes-utils';
import { pool } from './db';
import * as crypto from 'crypto';
import { simpleParser } from 'mailparser';

function cleanMessageId(value: unknown): string {
    return typeof value === 'string' ? value.replace(/[<>]/g, '').trim() : '';
}

function isOmsMessageId(value: string): boolean {
    return value.toLowerCase().endsWith('@openmailstack.local');
}

function parseEmailToNote(subject: string, body: string, messageId: string, uid: number): any {
    // Basic extraction
    let title = subject || 'Untitled Note';
    let content = body;
    
    // Apple Notes usually have HTML body. If there's an HTML body, we use it.
    // In our simplified parse, we just take the body string.
    return {
        title,
        content,
        imap_uid: uid,
        imap_msgid: messageId
    };
}

const ownerSyncTails = new Map<string, Promise<void>>();

export async function syncNotesWithImap(user: string, pass: string): Promise<void> {
    const ownerKey = user.trim().toLowerCase();
    const previous = ownerSyncTails.get(ownerKey) || Promise.resolve();
    const current = previous
        .catch(() => undefined)
        .then(() => syncNotesWithImapOnce(user, pass));
    ownerSyncTails.set(ownerKey, current);

    try {
        await current;
    } finally {
        if (ownerSyncTails.get(ownerKey) === current) {
            ownerSyncTails.delete(ownerKey);
        }
    }
}

async function syncNotesWithImapOnce(user: string, pass: string): Promise<void> {
    const imap = new ImapService(user, pass);
    let lockConnection: any = null;
    let lockAcquired = false;
    const lockName = `oms-notes-${crypto.createHash('sha256')
        .update(user.trim().toLowerCase())
        .digest('hex')
        .slice(0, 48)}`;
    try {
        lockConnection = await pool.getConnection();
        const [lockRows]: any = await lockConnection.query('SELECT GET_LOCK(?, 30) AS acquired', [lockName]);
        if (Number(lockRows[0]?.acquired) !== 1) {
            throw new Error('Another Notes synchronization is still being processed');
        }
        lockAcquired = true;
        await imap.connect();
        // Ensure schema has imap_uid
        try {
            await pool.query("ALTER TABLE notes ADD COLUMN imap_uid INT DEFAULT NULL");
        } catch(e) {}
        try {
            await pool.query("ALTER TABLE notes ADD COLUMN imap_msgid VARCHAR(255) DEFAULT NULL");
        } catch(e) {}

        const folders = await imap.getFolders();
        let notesFolder = folders.find((f: any) => f.path === 'Notes');
        if (!notesFolder) {
            // macOS Notes usually creates a folder called 'Notes'. If it doesn't exist, we can try to create it.
            try {
                // @ts-ignore
                await imap.client.mailboxCreate('Notes');
                notesFolder = { path: 'Notes', unseen: 0 };
            } catch (e) {
                await imap.logout();
                return; // Failed to create or no Notes folder
            }
        }
        
        let messages = await imap.getMessageIdentities(notesFolder.path);

        // A retry or a formerly concurrent sync can leave multiple copies of the
        // same OMS revision. Keep the newest UID and remove only OMS-owned copies.
        const messagesById = new Map<string, any[]>();
        for (const message of messages) {
            if (message.flags.includes('\\Deleted')) continue;
            const messageId = cleanMessageId(message.envelope?.messageId);
            if (!messageId || !isOmsMessageId(messageId)) continue;
            messagesById.set(messageId, [...(messagesById.get(messageId) || []), message]);
        }
        const duplicateUids = new Set<number>();
        for (const copies of messagesById.values()) {
            if (copies.length < 2) continue;
            copies.sort((left, right) => left.uid - right.uid);
            for (const duplicate of copies.slice(0, -1)) duplicateUids.add(duplicate.uid);
        }
        if (duplicateUids.size > 0) {
            await imap.messageAction(notesFolder.path, [...duplicateUids], 'hardDelete');
            messages = messages.filter(message => !duplicateUids.has(message.uid));
        }
        
        const dbNotes = await listNotes(user, true);
        
        // 0. Handle deletions from IMAP
        const imapUids = new Set(messages.filter(m => !m.flags.includes('\\Deleted')).map(m => m.uid));
        const imapMessageIds = new Set(
            messages
                .filter(message => !message.flags.includes('\\Deleted'))
                .map(message => cleanMessageId(message.envelope?.messageId))
                .filter(Boolean),
        );
        for (const note of dbNotes) {
            if ((note as any).is_deleted) continue; // Already deleted
            if ((note as any).imap_uid && !imapUids.has((note as any).imap_uid)) {
                const linkedMessageId = cleanMessageId((note as any).imap_msgid);
                if (linkedMessageId && imapMessageIds.has(linkedMessageId)) continue;
                // If we edited it in the WebApp, it would have sync_token != imap_sync_token
                // So if it's dirty, don't delete it.
                if ((note as any).sync_token === (note as any).imap_sync_token) {
                    await deleteNoteIfRevisionMatches(
                        note.id,
                        user,
                        Number((note as any).sync_token),
                        Number((note as any).imap_uid),
                    );
                }
            }
        }

        // 1. Sync from IMAP to DB
        for (const msg of messages) {
            if (msg.flags.includes('\\Deleted')) continue;

            const msgIdClean = cleanMessageId(msg.envelope?.messageId);
            const existing = dbNotes.find(n => (
                (n as any).imap_uid === msg.uid
                || (msgIdClean && cleanMessageId((n as any).imap_msgid) === msgIdClean)
            ));
            const messageIdMatch = Boolean(
                existing
                && msgIdClean
                && cleanMessageId((existing as any).imap_msgid) === msgIdClean,
            );
            if (existing && (!(existing as any).imap_uid || ((existing as any).imap_uid !== msg.uid && messageIdMatch))) {
                // We just found the IMAP UID for a note we previously pushed. Link it!
                await pool.query('UPDATE notes SET imap_uid = ? WHERE id = ? AND owner = ?', [msg.uid, existing.id, user]);
                (existing as any).imap_uid = msg.uid;
            } else if (!existing) {
                // Fetch full body
                const fullMsg = await imap.getMessageByUid(notesFolder.path, msg.uid);
                if (fullMsg && fullMsg.source) {
                    const parsedMail = await simpleParser(fullMsg.source);
                    const parsed = parseEmailToNote(parsedMail.subject || '', parsedMail.html || parsedMail.text || '', parsedMail.messageId || '', fullMsg.uid);
                    
                    const newId = crypto.randomUUID();
                    const saved = await saveNote({
                        ...parsed,
                        owner: user,
                        id: newId
                    });
                    
                    // Mark it as synced with IMAP immediately so we don't push it back
                    await pool.query(
                        'UPDATE notes SET imap_sync_token = ? WHERE id = ? AND owner = ?',
                        [(saved as any).sync_token, newId, user],
                    );
                }
            }
        }
        
        // 2. Sync from DB to IMAP (new or updated notes)
        const updatedDbNotes = await listNotes(user, true);
        for (const note of updatedDbNotes) {
            const isDirty = (note as any).sync_token !== (note as any).imap_sync_token;
            if (isDirty && (note as any).is_deleted) {
                const deletedRevision = Number((note as any).sync_token);
                if ((note as any).imap_uid) {
                    await imap.messageAction(notesFolder.path, [(note as any).imap_uid], 'delete');
                }
                await pool.query(
                    `UPDATE notes SET imap_uid = NULL, imap_sync_token = ?
                     WHERE id = ? AND owner = ? AND sync_token = ? AND is_deleted = 1`,
                    [deletedRevision, note.id, user, deletedRevision],
                );
                // We don't hardDelete yet to keep EAS sync happy. 
            } else if (!(note as any).is_deleted && (!(note as any).imap_uid || isDirty)) {
                // We need to push to IMAP
                const msgId = `<${note.id}-${(note as any).sync_token}@openmailstack.local>`;
                const dateStr = new Date(note.created_at || Date.now()).toUTCString();
                const emailContent = `Date: ${dateStr}\r\nFrom: ${user}\r\nTo: ${user}\r\nSubject: ${note.title || 'Untitled'}\r\nMessage-ID: ${msgId}\r\nMIME-Version: 1.0\r\nX-Uniform-Type-Identifier: com.apple.mail-note\r\nContent-Type: text/html; charset="utf-8"\r\n\r\n${note.content || ''}`;
                const [reservation]: any = await pool.query(
                    'UPDATE notes SET imap_msgid = ? WHERE id = ? AND owner = ? AND sync_token = ? AND is_deleted = 0',
                    [msgId, note.id, user, (note as any).sync_token],
                );
                if (reservation.affectedRows === 0) continue;
                
                // If it already had a UID, delete the old one in IMAP
                if ((note as any).imap_uid) {
                    await imap.messageAction(notesFolder.path, [(note as any).imap_uid], 'delete');
                }
                
                await imap.appendMessage(notesFolder.path, emailContent, ['\\Seen']);
                await pool.query(
                    `UPDATE notes SET imap_msgid = ?, imap_uid = NULL, imap_sync_token = ?
                     WHERE id = ? AND owner = ? AND sync_token = ? AND is_deleted = 0 AND imap_msgid = ?`,
                    [msgId, (note as any).sync_token, note.id, user, (note as any).sync_token, msgId],
                );
            }
        }
        
    } catch(e) {
        console.error("Failed to sync Notes with IMAP", e);
    } finally {
        try { await imap.logout(); } catch(e) {}
        if (lockConnection) {
            if (lockAcquired) {
                await lockConnection.query('SELECT RELEASE_LOCK(?)', [lockName]).catch(() => undefined);
            }
            lockConnection.release();
        }
    }
}

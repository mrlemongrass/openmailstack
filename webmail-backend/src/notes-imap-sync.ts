import { ImapService } from './imap';
import { listNotes, saveNote, deleteNote } from './notes-utils';
import { pool } from './db';
import * as crypto from 'crypto';
import { simpleParser } from 'mailparser';

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

export async function syncNotesWithImap(user: string, pass: string): Promise<void> {
    const imap = new ImapService(user, pass);
    try {
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
        
        const result = await imap.getMessages(notesFolder.path);
        const messages = result.messages;
        
        const dbNotes = await listNotes(user, true);
        
        // 0. Handle deletions from IMAP
        const imapUids = new Set(messages.filter(m => !m.flags.includes('\\Deleted')).map(m => m.uid));
        for (const note of dbNotes) {
            if ((note as any).is_deleted) continue; // Already deleted
            if ((note as any).imap_uid && !imapUids.has((note as any).imap_uid)) {
                // If we edited it in the WebApp, it would have sync_token != imap_sync_token
                // So if it's dirty, don't delete it.
                if ((note as any).sync_token === (note as any).imap_sync_token) {
                    await deleteNote(note.id, user);
                }
            }
        }

        // 1. Sync from IMAP to DB
        for (const msg of messages) {
            if (msg.flags.includes('\\Deleted')) continue;

            const msgIdClean = (msg.envelope?.messageId || '').replace(/[<>]/g, '');
            const existing = dbNotes.find(n => (n as any).imap_uid === msg.uid || ((n as any).imap_msgid || '').replace(/[<>]/g, '') === msgIdClean);
            if (existing && !(existing as any).imap_uid) {
                // We just found the IMAP UID for a note we previously pushed. Link it!
                await pool.query('UPDATE notes SET imap_uid = ?, imap_sync_token = sync_token WHERE id = ? AND owner = ?', [msg.uid, existing.id, user]);
                (existing as any).imap_uid = msg.uid;
                (existing as any).imap_sync_token = (existing as any).sync_token;
            } else if (!existing) {
                // Fetch full body
                const fullMsg = await imap.getMessageByUid(notesFolder.path, msg.uid);
                if (fullMsg && fullMsg.source) {
                    const parsedMail = await simpleParser(fullMsg.source);
                    const parsed = parseEmailToNote(parsedMail.subject || '', parsedMail.html || parsedMail.text || '', parsedMail.messageId || '', fullMsg.uid);
                    
                    const newId = crypto.randomUUID();
                    await saveNote({
                        ...parsed,
                        owner: user,
                        id: newId
                    });
                    
                    // Mark it as synced with IMAP immediately so we don't push it back
                    await pool.query('UPDATE notes SET imap_sync_token = sync_token WHERE id = ?', [newId]);
                }
            }
        }
        
        // 2. Sync from DB to IMAP (new or updated notes)
        const updatedDbNotes = await listNotes(user, true);
        for (const note of updatedDbNotes) {
            const isDirty = (note as any).sync_token !== (note as any).imap_sync_token;
            if (isDirty && (note as any).is_deleted) {
                if ((note as any).imap_uid) {
                    try { await imap.messageAction(notesFolder.path, [(note as any).imap_uid], 'delete'); } catch(e) {}
                }
                await pool.query('UPDATE notes SET imap_uid = NULL, imap_sync_token = sync_token WHERE id = ?', [note.id]);
                // We don't hardDelete yet to keep EAS sync happy. 
            } else if (!(note as any).is_deleted && (!(note as any).imap_uid || isDirty)) {
                // We need to push to IMAP
                const msgId = `<${note.id}-${(note as any).sync_token}@openmailstack.local>`;
                const dateStr = new Date(note.created_at || Date.now()).toUTCString();
                const emailContent = `Date: ${dateStr}\r\nFrom: ${user}\r\nTo: ${user}\r\nSubject: ${note.title || 'Untitled'}\r\nMessage-ID: ${msgId}\r\nMIME-Version: 1.0\r\nX-Uniform-Type-Identifier: com.apple.mail-note\r\nContent-Type: text/html; charset="utf-8"\r\n\r\n${note.content || ''}`;
                
                // If it already had a UID, delete the old one in IMAP
                if ((note as any).imap_uid) {
                    try { await imap.messageAction(notesFolder.path, [(note as any).imap_uid], 'delete'); } catch(e) {}
                }
                
                await imap.appendMessage(notesFolder.path, emailContent, ['\\Seen']);
                await pool.query('UPDATE notes SET imap_msgid = ?, imap_uid = NULL, imap_sync_token = sync_token WHERE id = ? AND owner = ?', [msgId, note.id, user]);
            }
        }
        
    } catch(e) {
        console.error("Failed to sync Notes with IMAP", e);
    } finally {
        try { await imap.logout(); } catch(e) {}
    }
}

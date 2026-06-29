"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.syncNotesWithImap = syncNotesWithImap;
const imap_1 = require("./imap");
const notes_utils_1 = require("./notes-utils");
const db_1 = require("./db");
const crypto = __importStar(require("crypto"));
const mailparser_1 = require("mailparser");
function parseEmailToNote(subject, body, messageId, uid) {
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
async function syncNotesWithImap(user, pass) {
    const imap = new imap_1.ImapService(user, pass);
    try {
        await imap.connect();
        // Ensure schema has imap_uid
        try {
            await db_1.pool.query("ALTER TABLE notes ADD COLUMN imap_uid INT DEFAULT NULL");
        }
        catch (e) { }
        try {
            await db_1.pool.query("ALTER TABLE notes ADD COLUMN imap_msgid VARCHAR(255) DEFAULT NULL");
        }
        catch (e) { }
        const folders = await imap.getFolders();
        let notesFolder = folders.find((f) => f.path === 'Notes');
        if (!notesFolder) {
            // macOS Notes usually creates a folder called 'Notes'. If it doesn't exist, we can try to create it.
            try {
                // @ts-ignore
                await imap.client.mailboxCreate('Notes');
                notesFolder = { path: 'Notes', unseen: 0 };
            }
            catch (e) {
                await imap.logout();
                return; // Failed to create or no Notes folder
            }
        }
        const result = await imap.getMessages(notesFolder.path);
        const messages = result.messages;
        const dbNotes = await (0, notes_utils_1.listNotes)(user, true);
        // 0. Handle deletions from IMAP
        const imapUids = new Set(messages.filter(m => !m.flags.includes('\\Deleted')).map(m => m.uid));
        for (const note of dbNotes) {
            if (note.is_deleted)
                continue; // Already deleted
            if (note.imap_uid && !imapUids.has(note.imap_uid)) {
                // If we edited it in the WebApp, it would have sync_token != imap_sync_token
                // So if it's dirty, don't delete it.
                if (note.sync_token === note.imap_sync_token) {
                    await (0, notes_utils_1.deleteNote)(note.id, user);
                }
            }
        }
        // 1. Sync from IMAP to DB
        for (const msg of messages) {
            if (msg.flags.includes('\\Deleted'))
                continue;
            const msgIdClean = (msg.envelope?.messageId || '').replace(/[<>]/g, '');
            const existing = dbNotes.find(n => n.imap_uid === msg.uid || (n.imap_msgid || '').replace(/[<>]/g, '') === msgIdClean);
            if (existing && !existing.imap_uid) {
                // We just found the IMAP UID for a note we previously pushed. Link it!
                await db_1.pool.query('UPDATE notes SET imap_uid = ?, imap_sync_token = sync_token WHERE id = ? AND owner = ?', [msg.uid, existing.id, user]);
                existing.imap_uid = msg.uid;
                existing.imap_sync_token = existing.sync_token;
            }
            else if (!existing) {
                // Fetch full body
                const fullMsg = await imap.getMessageByUid(notesFolder.path, msg.uid);
                if (fullMsg && fullMsg.source) {
                    const parsedMail = await (0, mailparser_1.simpleParser)(fullMsg.source);
                    const parsed = parseEmailToNote(parsedMail.subject || '', parsedMail.html || parsedMail.text || '', parsedMail.messageId || '', fullMsg.uid);
                    const newId = crypto.randomUUID();
                    await (0, notes_utils_1.saveNote)({
                        ...parsed,
                        owner: user,
                        id: newId
                    });
                    // Mark it as synced with IMAP immediately so we don't push it back
                    await db_1.pool.query('UPDATE notes SET imap_sync_token = sync_token WHERE id = ?', [newId]);
                }
            }
        }
        // 2. Sync from DB to IMAP (new or updated notes)
        const updatedDbNotes = await (0, notes_utils_1.listNotes)(user, true);
        for (const note of updatedDbNotes) {
            const isDirty = note.sync_token !== note.imap_sync_token;
            if (isDirty && note.is_deleted) {
                if (note.imap_uid) {
                    try {
                        await imap.messageAction(notesFolder.path, [note.imap_uid], 'delete');
                    }
                    catch (e) { }
                }
                await db_1.pool.query('UPDATE notes SET imap_uid = NULL, imap_sync_token = sync_token WHERE id = ?', [note.id]);
                // We don't hardDelete yet to keep EAS sync happy. 
            }
            else if (!note.is_deleted && (!note.imap_uid || isDirty)) {
                // We need to push to IMAP
                const msgId = `<${note.id}-${note.sync_token}@openmailstack.local>`;
                const dateStr = new Date(note.created_at || Date.now()).toUTCString();
                const emailContent = `Date: ${dateStr}\r\nFrom: ${user}\r\nTo: ${user}\r\nSubject: ${note.title || 'Untitled'}\r\nMessage-ID: ${msgId}\r\nMIME-Version: 1.0\r\nX-Uniform-Type-Identifier: com.apple.mail-note\r\nContent-Type: text/html; charset="utf-8"\r\n\r\n${note.content || ''}`;
                // If it already had a UID, delete the old one in IMAP
                if (note.imap_uid) {
                    try {
                        await imap.messageAction(notesFolder.path, [note.imap_uid], 'delete');
                    }
                    catch (e) { }
                }
                await imap.appendMessage(notesFolder.path, emailContent, ['\\Seen']);
                await db_1.pool.query('UPDATE notes SET imap_msgid = ?, imap_uid = NULL, imap_sync_token = sync_token WHERE id = ? AND owner = ?', [msgId, note.id, user]);
            }
        }
    }
    catch (e) {
        console.error("Failed to sync Notes with IMAP", e);
    }
    finally {
        try {
            await imap.logout();
        }
        catch (e) { }
    }
}
//# sourceMappingURL=notes-imap-sync.js.map
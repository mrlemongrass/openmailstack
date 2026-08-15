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
function cleanMessageId(value) {
    return typeof value === 'string' ? value.replace(/[<>]/g, '').trim() : '';
}
function isOmsMessageId(value) {
    return value.toLowerCase().endsWith('@openmailstack.local');
}
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
const ownerSyncTails = new Map();
async function syncNotesWithImap(user, pass) {
    const ownerKey = user.trim().toLowerCase();
    const previous = ownerSyncTails.get(ownerKey) || Promise.resolve();
    const current = previous
        .catch(() => undefined)
        .then(() => syncNotesWithImapOnce(user, pass));
    ownerSyncTails.set(ownerKey, current);
    try {
        await current;
    }
    finally {
        if (ownerSyncTails.get(ownerKey) === current) {
            ownerSyncTails.delete(ownerKey);
        }
    }
}
async function syncNotesWithImapOnce(user, pass) {
    const imap = new imap_1.ImapService(user, pass);
    let lockConnection = null;
    let lockAcquired = false;
    const lockName = `oms-notes-${crypto.createHash('sha256')
        .update(user.trim().toLowerCase())
        .digest('hex')
        .slice(0, 48)}`;
    try {
        lockConnection = await db_1.pool.getConnection();
        const [lockRows] = await lockConnection.query('SELECT GET_LOCK(?, 30) AS acquired', [lockName]);
        if (Number(lockRows[0]?.acquired) !== 1) {
            throw new Error('Another Notes synchronization is still being processed');
        }
        lockAcquired = true;
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
        let messages = await imap.getMessageIdentities(notesFolder.path);
        // A retry or a formerly concurrent sync can leave multiple copies of the
        // same OMS revision. Keep the newest UID and remove only OMS-owned copies.
        const messagesById = new Map();
        for (const message of messages) {
            if (message.flags.includes('\\Deleted'))
                continue;
            const messageId = cleanMessageId(message.envelope?.messageId);
            if (!messageId || !isOmsMessageId(messageId))
                continue;
            messagesById.set(messageId, [...(messagesById.get(messageId) || []), message]);
        }
        const duplicateUids = new Set();
        for (const copies of messagesById.values()) {
            if (copies.length < 2)
                continue;
            copies.sort((left, right) => left.uid - right.uid);
            for (const duplicate of copies.slice(0, -1))
                duplicateUids.add(duplicate.uid);
        }
        if (duplicateUids.size > 0) {
            await imap.messageAction(notesFolder.path, [...duplicateUids], 'hardDelete');
            messages = messages.filter(message => !duplicateUids.has(message.uid));
        }
        const dbNotes = await (0, notes_utils_1.listNotes)(user, true);
        // 0. Handle deletions from IMAP
        const imapUids = new Set(messages.filter(m => !m.flags.includes('\\Deleted')).map(m => m.uid));
        const imapMessageIds = new Set(messages
            .filter(message => !message.flags.includes('\\Deleted'))
            .map(message => cleanMessageId(message.envelope?.messageId))
            .filter(Boolean));
        for (const note of dbNotes) {
            if (note.is_deleted)
                continue; // Already deleted
            if (note.imap_uid && !imapUids.has(note.imap_uid)) {
                const linkedMessageId = cleanMessageId(note.imap_msgid);
                if (linkedMessageId && imapMessageIds.has(linkedMessageId))
                    continue;
                // If we edited it in the WebApp, it would have sync_token != imap_sync_token
                // So if it's dirty, don't delete it.
                if (note.sync_token === note.imap_sync_token) {
                    await (0, notes_utils_1.deleteNoteIfRevisionMatches)(note.id, user, Number(note.sync_token), Number(note.imap_uid));
                }
            }
        }
        // 1. Sync from IMAP to DB
        for (const msg of messages) {
            if (msg.flags.includes('\\Deleted'))
                continue;
            const msgIdClean = cleanMessageId(msg.envelope?.messageId);
            const existing = dbNotes.find(n => (n.imap_uid === msg.uid
                || (msgIdClean && cleanMessageId(n.imap_msgid) === msgIdClean)));
            const messageIdMatch = Boolean(existing
                && msgIdClean
                && cleanMessageId(existing.imap_msgid) === msgIdClean);
            if (existing && (!existing.imap_uid || (existing.imap_uid !== msg.uid && messageIdMatch))) {
                // We just found the IMAP UID for a note we previously pushed. Link it!
                await db_1.pool.query('UPDATE notes SET imap_uid = ? WHERE id = ? AND owner = ?', [msg.uid, existing.id, user]);
                existing.imap_uid = msg.uid;
            }
            else if (!existing) {
                // Fetch full body
                const fullMsg = await imap.getMessageByUid(notesFolder.path, msg.uid);
                if (fullMsg && fullMsg.source) {
                    const parsedMail = await (0, mailparser_1.simpleParser)(fullMsg.source);
                    const parsed = parseEmailToNote(parsedMail.subject || '', parsedMail.html || parsedMail.text || '', parsedMail.messageId || '', fullMsg.uid);
                    const newId = crypto.randomUUID();
                    const saved = await (0, notes_utils_1.saveNote)({
                        ...parsed,
                        owner: user,
                        id: newId
                    });
                    // Mark it as synced with IMAP immediately so we don't push it back
                    await db_1.pool.query('UPDATE notes SET imap_sync_token = ? WHERE id = ? AND owner = ?', [saved.sync_token, newId, user]);
                }
            }
        }
        // 2. Sync from DB to IMAP (new or updated notes)
        const updatedDbNotes = await (0, notes_utils_1.listNotes)(user, true);
        for (const note of updatedDbNotes) {
            const isDirty = note.sync_token !== note.imap_sync_token;
            if (isDirty && note.is_deleted) {
                const deletedRevision = Number(note.sync_token);
                if (note.imap_uid) {
                    await imap.messageAction(notesFolder.path, [note.imap_uid], 'delete');
                }
                await db_1.pool.query(`UPDATE notes SET imap_uid = NULL, imap_sync_token = ?
                     WHERE id = ? AND owner = ? AND sync_token = ? AND is_deleted = 1`, [deletedRevision, note.id, user, deletedRevision]);
                // We don't hardDelete yet to keep EAS sync happy. 
            }
            else if (!note.is_deleted && (!note.imap_uid || isDirty)) {
                // We need to push to IMAP
                const msgId = `<${note.id}-${note.sync_token}@openmailstack.local>`;
                const dateStr = new Date(note.created_at || Date.now()).toUTCString();
                const emailContent = `Date: ${dateStr}\r\nFrom: ${user}\r\nTo: ${user}\r\nSubject: ${note.title || 'Untitled'}\r\nMessage-ID: ${msgId}\r\nMIME-Version: 1.0\r\nX-Uniform-Type-Identifier: com.apple.mail-note\r\nContent-Type: text/html; charset="utf-8"\r\n\r\n${note.content || ''}`;
                const [reservation] = await db_1.pool.query('UPDATE notes SET imap_msgid = ? WHERE id = ? AND owner = ? AND sync_token = ? AND is_deleted = 0', [msgId, note.id, user, note.sync_token]);
                if (reservation.affectedRows === 0)
                    continue;
                // If it already had a UID, delete the old one in IMAP
                if (note.imap_uid) {
                    await imap.messageAction(notesFolder.path, [note.imap_uid], 'delete');
                }
                await imap.appendMessage(notesFolder.path, emailContent, ['\\Seen']);
                await db_1.pool.query(`UPDATE notes SET imap_msgid = ?, imap_uid = NULL, imap_sync_token = ?
                     WHERE id = ? AND owner = ? AND sync_token = ? AND is_deleted = 0 AND imap_msgid = ?`, [msgId, note.sync_token, note.id, user, note.sync_token, msgId]);
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
        if (lockConnection) {
            if (lockAcquired) {
                await lockConnection.query('SELECT RELEASE_LOCK(?)', [lockName]).catch(() => undefined);
            }
            lockConnection.release();
        }
    }
}
//# sourceMappingURL=notes-imap-sync.js.map
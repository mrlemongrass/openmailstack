"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.startSearchWorker = exports.runSearchIndexer = void 0;
const db_1 = require("./db");
const imap_1 = require("./imap");
const mailparser_1 = require("mailparser");
const search_index_1 = require("./search-index");
const auth_1 = require("./auth");
const getAddressText = (addr) => addr?.text || "";
const getAttachmentNames = (parsed) => parsed.attachments ? parsed.attachments.map((a) => a.filename).filter(Boolean).join(", ") : "";
const parsedMailToIndexRow = (folder, msg, parsed) => ({
    folder,
    uid: msg.uid,
    messageId: parsed.messageId || "",
    subject: parsed.subject || "(No Subject)",
    sender: getAddressText(parsed.from),
    recipients: [getAddressText(parsed.to), getAddressText(parsed.cc), getAddressText(parsed.bcc)].filter(Boolean).join(", "),
    sentAt: parsed.date || null,
    preview: parsed.text ? parsed.text.substring(0, 180) : "",
    bodyText: (() => {
        let txt = parsed.text || "";
        if (parsed.attachments && Array.isArray(parsed.attachments)) {
            for (const att of parsed.attachments) {
                if (att.contentType && (att.contentType.startsWith("text/") || att.contentType === "application/json")) {
                    if (att.content && att.content.length < 50000) {
                        txt += "\n\n--- " + (att.filename || "attachment") + " ---\n" + att.content.toString("utf8");
                    }
                }
            }
        }
        return txt;
    })(),
    attachmentNames: getAttachmentNames(parsed),
    inReplyTo: parsed.inReplyTo || "",
    references: parsed.references || [],
    isRead: msg.flags.includes("\\Seen"),
    isStarred: msg.flags.includes("\\Flagged"),
    messageSize: msg.source ? msg.source.length : 0
});
const runSearchIndexer = async () => {
    try {
        const [sessions] = await db_1.pool.query("SELECT username, password_ciphertext, password_iv, password_tag FROM webmail_sessions WHERE expires_at > NOW()");
        const processedUsers = new Set();
        for (const session of sessions) {
            const username = session.username;
            if (processedUsers.has(username))
                continue;
            processedUsers.add(username);
            let imap = null;
            try {
                const password = (0, auth_1.decryptPassword)(session.password_ciphertext, session.password_iv, session.password_tag);
                imap = new imap_1.ImapService(username, password);
                await imap.connect();
                const folders = await imap.getFolders();
                for (const folderObj of folders) {
                    const folderPath = folderObj.path;
                    const [maxUidRows] = await db_1.pool.query("SELECT MAX(uid) AS maxUid FROM mail_search_index WHERE username = ? AND folder = ?", [username, folderPath]);
                    const maxUid = maxUidRows[0].maxUid || 0;
                    const messages = await imap.getMessagesSinceUid(folderPath, maxUid + 1, 50);
                    const rows = [];
                    for (const msg of messages) {
                        const parsed = await (0, mailparser_1.simpleParser)(msg.source);
                        rows.push(parsedMailToIndexRow(folderPath, msg, parsed));
                    }
                    if (rows.length > 0) {
                        await (0, search_index_1.upsertMailSearchRows)(username, rows);
                        console.log(`[SearchWorker] Indexed ${rows.length} messages for ${username} in ${folderPath}`);
                    }
                }
                if (imap) {
                    await imap.logout().catch(() => { });
                }
            }
            catch (err) {
                console.error(`[SearchWorker] Failed to index for ${username}:`, err);
                if (imap) {
                    await imap.logout().catch(() => { });
                }
            }
        }
    }
    catch (err) {
        console.error("[SearchWorker] General error:", err);
    }
};
exports.runSearchIndexer = runSearchIndexer;
const startSearchWorker = () => {
    // Run every 5 minutes
    setInterval(exports.runSearchIndexer, 5 * 60 * 1000);
    // Run once on startup after 30 seconds
    setTimeout(exports.runSearchIndexer, 30000);
};
exports.startSearchWorker = startSearchWorker;
//# sourceMappingURL=search-worker.js.map
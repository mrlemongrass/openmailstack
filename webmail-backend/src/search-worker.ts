import { pool } from "./db";
import { ImapService } from "./imap";
import { simpleParser } from "mailparser";
import { upsertMailSearchRows, MailSearchIndexRow } from "./search-index";
import { decryptPassword } from "./auth";

const getAddressText = (addr: any) => addr?.text || "";
const getAttachmentNames = (parsed: any) => parsed.attachments ? parsed.attachments.map((a: any) => a.filename).filter(Boolean).join(", ") : "";

const parsedMailToIndexRow = (folder: string, msg: any, parsed: any): MailSearchIndexRow => ({
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

export const runSearchIndexer = async () => {
    try {
        const [sessions]: any = await pool.query("SELECT username, password_ciphertext, password_iv, password_tag FROM webmail_sessions WHERE expires_at > NOW()");
        const processedUsers = new Set<string>();
        for (const session of sessions) {
            const username = session.username;
            if (processedUsers.has(username)) continue;
            processedUsers.add(username);
            
            let imap: any = null;
            try {
                const password = decryptPassword(session.password_ciphertext, session.password_iv, session.password_tag);
                imap = new ImapService(username, password);
                await imap.connect();
                const folders = await imap.getFolders();
                for (const folderObj of folders) {
                    const folderPath = folderObj.path;
                    const [maxUidRows]: any = await pool.query("SELECT MAX(uid) AS maxUid FROM mail_search_index WHERE username = ? AND folder = ?", [username, folderPath]);
                    const maxUid = maxUidRows[0].maxUid || 0;
                    
                    const messages = await imap.getMessagesSinceUid(folderPath, maxUid + 1, 50);
                    const rows: MailSearchIndexRow[] = [];
                    for (const msg of messages) {
                        const parsed = await simpleParser(msg.source);
                        rows.push(parsedMailToIndexRow(folderPath, msg, parsed));
                    }
                    if (rows.length > 0) {
                        await upsertMailSearchRows(username, rows);
                        console.log(`[SearchWorker] Indexed ${rows.length} messages for ${username} in ${folderPath}`);
                    }
                }
                if (imap) {
                    await imap.logout().catch(() => {});
                }
            } catch (err) {
                console.error(`[SearchWorker] Failed to index for ${username}:`, err);
                if (imap) {
                    await imap.logout().catch(() => {});
                }
            }
        }
    } catch (err) {
        console.error("[SearchWorker] General error:", err);
    }
};

export const startSearchWorker = () => {
    // Run every 5 minutes
    setInterval(runSearchIndexer, 5 * 60 * 1000);
    // Run once on startup after 30 seconds
    setTimeout(runSearchIndexer, 30000);
};

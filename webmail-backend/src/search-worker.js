"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.startSearchWorker = exports.purgeUserSearchIndex = exports.getSearchWorkerStatus = exports.runSearchIndexer = void 0;
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
/* ---------- Worker state schema ---------- */
let workerSchemaReady = null;
const ensureWorkerSchema = async () => {
    if (!workerSchemaReady) {
        workerSchemaReady = (async () => {
            await (0, search_index_1.ensureMailSearchSchema)();
            await db_1.pool.query(`
                CREATE TABLE IF NOT EXISTS mail_search_worker_state (
                    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
                    username VARCHAR(255) NOT NULL,
                    folder VARCHAR(255) NOT NULL,
                    last_uid_indexed BIGINT UNSIGNED NOT NULL DEFAULT 0,
                    last_full_sync_at TIMESTAMP NULL,
                    message_count INT UNSIGNED NOT NULL DEFAULT 0,
                    indexed_count INT UNSIGNED NOT NULL DEFAULT 0,
                    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    UNIQUE KEY uniq_user_folder (username, folder)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            `);
        })();
    }
    return workerSchemaReady;
};
const getWorkerFolderState = async (username, folder) => {
    const [rows] = await db_1.pool.query('SELECT last_uid_indexed, last_full_sync_at, message_count, indexed_count FROM mail_search_worker_state WHERE username = ? AND folder = ?', [username, folder]);
    if (rows.length === 0) {
        return { lastUidIndexed: 0, lastFullSyncAt: null, messageCount: 0, indexedCount: 0 };
    }
    return {
        lastUidIndexed: Number(rows[0].last_uid_indexed || 0),
        lastFullSyncAt: rows[0].last_full_sync_at || null,
        messageCount: Number(rows[0].message_count || 0),
        indexedCount: Number(rows[0].indexed_count || 0)
    };
};
const updateWorkerFolderState = async (username, folder, update) => {
    const lastUid = update.lastUidIndexed ?? 0;
    const msgCount = update.messageCount ?? 0;
    const idxCount = update.indexedCount ?? 0;
    const lastSync = update.lastFullSyncAt || null;
    await db_1.pool.query(`INSERT INTO mail_search_worker_state (username, folder, last_uid_indexed, last_full_sync_at, message_count, indexed_count)
         VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
            last_uid_indexed = GREATEST(last_uid_indexed, VALUES(last_uid_indexed)),
            last_full_sync_at = COALESCE(VALUES(last_full_sync_at), last_full_sync_at),
            message_count = VALUES(message_count),
            indexed_count = VALUES(indexed_count)`, [username, folder, lastUid, lastSync, msgCount, idxCount]);
};
/* ---------- Expunge reconciliation ---------- */
const EXPUNGE_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
let lastExpungeRun = 0;
const reconcileExpungedMessages = async (username, folder, imap) => {
    try {
        const mbx = await imap.client.mailboxOpen(folder);
        try {
            if (mbx.exists === 0) {
                // Folder is empty — delete all indexed messages for this folder
                const [indexedRows] = await db_1.pool.query('SELECT uid FROM mail_search_index WHERE username = ? AND folder = ?', [username, folder]);
                const staleUids = indexedRows.map((r) => Number(r.uid));
                if (staleUids.length > 0) {
                    await (0, search_index_1.deleteMailSearchRows)(username, folder, staleUids);
                    console.log(`[SearchWorker] Expunge: removed ${staleUids.length} stale entries for ${username} in ${folder} (folder empty)`);
                }
                return;
            }
            // Get all UIDs currently in the IMAP folder
            const imapUids = await imap.client.search({ all: true }, { uid: true });
            if (!Array.isArray(imapUids) || imapUids.length === 0)
                return;
            const imapUidSet = new Set(imapUids.map(Number));
            // Get all indexed UIDs for this folder
            const [indexedRows] = await db_1.pool.query('SELECT uid FROM mail_search_index WHERE username = ? AND folder = ?', [username, folder]);
            const staleUids = [];
            for (const row of indexedRows) {
                const uid = Number(row.uid);
                if (!imapUidSet.has(uid)) {
                    staleUids.push(uid);
                }
            }
            if (staleUids.length > 0) {
                await (0, search_index_1.deleteMailSearchRows)(username, folder, staleUids);
                console.log(`[SearchWorker] Expunge: removed ${staleUids.length} stale entries for ${username} in ${folder}`);
            }
        }
        finally {
            await imap.client.mailboxClose();
        }
    }
    catch (err) {
        console.error(`[SearchWorker] Expunge reconciliation failed for ${username} in ${folder}:`, err);
    }
};
const getAvailableUserCredentials = async () => {
    const [sessions] = await db_1.pool.query("SELECT username, password_ciphertext, password_iv, password_tag FROM webmail_sessions WHERE expires_at > NOW()");
    const seen = new Set();
    const credentials = [];
    for (const session of sessions) {
        const username = session.username;
        if (seen.has(username))
            continue;
        seen.add(username);
        try {
            const password = (0, auth_1.decryptPassword)(session.password_ciphertext, session.password_iv, session.password_tag);
            credentials.push({ username, password });
        }
        catch (err) {
            console.error(`[SearchWorker] Failed to decrypt credentials for ${username}:`, err);
        }
    }
    return credentials;
};
/* ---------- Per-user indexing ---------- */
const BATCH_SIZE = 200;
const indexUserFolders = async (credential) => {
    const { username, password } = credential;
    let imap = null;
    try {
        imap = new imap_1.ImapService(username, password);
        await imap.connect();
        const folders = await imap.getFolders();
        const shouldRunExpunge = Date.now() - lastExpungeRun >= EXPUNGE_INTERVAL_MS;
        for (const folderObj of folders) {
            const folderPath = folderObj.path;
            try {
                // Get worker state for resume tracking
                const state = await getWorkerFolderState(username, folderPath);
                const maxUid = state.lastUidIndexed;
                // Incremental indexing: fetch new messages since last indexed UID
                const messages = await imap.getMessagesSinceUid(folderPath, maxUid + 1, BATCH_SIZE);
                const rows = [];
                for (const msg of messages) {
                    const parsed = await (0, mailparser_1.simpleParser)(msg.source);
                    rows.push(parsedMailToIndexRow(folderPath, msg, parsed));
                }
                if (rows.length > 0) {
                    await (0, search_index_1.upsertMailSearchRows)(username, rows);
                    console.log(`[SearchWorker] Indexed ${rows.length} messages for ${username} in ${folderPath}`);
                }
                // Find the highest UID we indexed
                const newMaxUid = rows.reduce((max, row) => Math.max(max, row.uid), maxUid);
                // Get current indexed count for this folder
                const [countRows] = await db_1.pool.query('SELECT COUNT(*) AS cnt FROM mail_search_index WHERE username = ? AND folder = ?', [username, folderPath]);
                const indexedCount = Number(countRows[0]?.cnt || 0);
                await updateWorkerFolderState(username, folderPath, {
                    lastUidIndexed: newMaxUid,
                    messageCount: indexedCount + (rows.length > 0 ? 0 : 0), // will be updated by expunge
                    indexedCount
                });
                // Run expunge reconciliation less frequently
                if (shouldRunExpunge) {
                    await reconcileExpungedMessages(username, folderPath, imap);
                    // Update counts after expunge
                    const [postExpungeRows] = await db_1.pool.query('SELECT COUNT(*) AS cnt FROM mail_search_index WHERE username = ? AND folder = ?', [username, folderPath]);
                    const postExpungeCount = Number(postExpungeRows[0]?.cnt || 0);
                    await updateWorkerFolderState(username, folderPath, {
                        lastUidIndexed: newMaxUid,
                        lastFullSyncAt: new Date(),
                        messageCount: postExpungeCount,
                        indexedCount: postExpungeCount
                    });
                }
            }
            catch (folderErr) {
                console.error(`[SearchWorker] Failed to index folder ${folderPath} for ${username}:`, folderErr);
            }
        }
        if (shouldRunExpunge) {
            lastExpungeRun = Date.now();
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
};
/* ---------- Main indexer entry ---------- */
const runSearchIndexer = async () => {
    try {
        await ensureWorkerSchema();
        const credentials = await getAvailableUserCredentials();
        if (credentials.length === 0) {
            console.log("[SearchWorker] No user credentials available, skipping cycle");
            return;
        }
        console.log(`[SearchWorker] Starting indexing cycle for ${credentials.length} user(s)`);
        for (const credential of credentials) {
            await indexUserFolders(credential);
        }
        console.log("[SearchWorker] Indexing cycle complete");
    }
    catch (err) {
        console.error("[SearchWorker] General error:", err);
    }
};
exports.runSearchIndexer = runSearchIndexer;
const getSearchWorkerStatus = async () => {
    await ensureWorkerSchema();
    const [rows] = await db_1.pool.query(`SELECT username, folder, last_uid_indexed, last_full_sync_at, message_count, indexed_count, updated_at
         FROM mail_search_worker_state
         ORDER BY updated_at DESC`);
    const userSet = new Set();
    let totalIndexed = 0;
    let lastUpdated = null;
    const folders = rows.map((row) => {
        userSet.add(row.username);
        const idxCount = Number(row.indexed_count || 0);
        totalIndexed += idxCount;
        if (!lastUpdated || (row.updated_at && new Date(row.updated_at) > new Date(lastUpdated))) {
            lastUpdated = row.updated_at;
        }
        return {
            username: row.username,
            folder: row.folder,
            lastUidIndexed: Number(row.last_uid_indexed || 0),
            lastFullSyncAt: row.last_full_sync_at || null,
            messageCount: Number(row.message_count || 0),
            indexedCount: idxCount,
            updatedAt: row.updated_at || null
        };
    });
    return {
        totalUsers: userSet.size,
        totalFolders: folders.length,
        totalIndexedMessages: totalIndexed,
        lastUpdatedAt: lastUpdated,
        folders
    };
};
exports.getSearchWorkerStatus = getSearchWorkerStatus;
/* ---------- Index purge ---------- */
const purgeUserSearchIndex = async (username) => {
    await (0, search_index_1.ensureMailSearchSchema)();
    await ensureWorkerSchema();
    const [result] = await db_1.pool.query('DELETE FROM mail_search_index WHERE username = ?', [username]);
    await db_1.pool.query('DELETE FROM mail_search_worker_state WHERE username = ?', [username]);
    const deletedCount = result.affectedRows || 0;
    console.log(`[SearchWorker] Purged ${deletedCount} index entries for ${username}`);
    return deletedCount;
};
exports.purgeUserSearchIndex = purgeUserSearchIndex;
/* ---------- Lifecycle ---------- */
const startSearchWorker = () => {
    // Run every 5 minutes
    setInterval(exports.runSearchIndexer, 5 * 60 * 1000);
    // Run once on startup after 30 seconds
    setTimeout(exports.runSearchIndexer, 30000);
};
exports.startSearchWorker = startSearchWorker;
//# sourceMappingURL=search-worker.js.map
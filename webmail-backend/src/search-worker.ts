import { pool } from "./db";
import { ImapService } from "./imap";
import { simpleParser } from "mailparser";
const pdfParse = require("pdf-parse");
import { upsertMailSearchRows, deleteMailSearchRows, ensureMailSearchSchema, MailSearchIndexRow } from "./search-index";
import { decryptPassword } from "./auth";

const getAddressText = (addr: any) => addr?.text || "";
const getAttachmentNames = (parsed: any) => parsed.attachments ? parsed.attachments.map((a: any) => a.filename).filter(Boolean).join(", ") : "";

const stripXmlTags = (xml: string): string => xml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

const extractOfficeXmlText = (content: Buffer): string => {
    try {
        // Office Open XML / ODF files are ZIP archives containing XML
        const zlib = require('zlib');
        // Try to find and extract document.xml or content.xml
        // Simple approach: find XML text between tags in the raw buffer
        const str = content.toString('utf8');
        // Look for document.xml content in ZIP central directory entries
        const xmlSegments = str.match(/<w:t[^>]*>([^<]+)<\/w:t>/g);
        if (xmlSegments) return xmlSegments.map(s => s.replace(/<\/?w:t[^>]*>/g, '')).join(' ').trim();
        // Fallback: strip all XML tags from any recognizable XML in the buffer
        const xmlMatch = str.match(/<office:document[^>]*>[\s\S]*<\/office:document>/);
        if (xmlMatch) return stripXmlTags(xmlMatch[0]);
        // Try text:p for ODF
        const textSegments = str.match(/<text:p[^>]*>([^<]*)<\/text:p>/g);
        if (textSegments) return textSegments.map(s => s.replace(/<\/?text:p[^>]*>/g, '')).join(' ').trim();
    } catch {}
    return '';
};

const extractAttachmentText = async (attachment: any): Promise<string> => {
    const ct = attachment.contentType || '';
    const content = attachment.content;
    if (!content || content.length === 0) return '';

    try {
        if (ct === 'application/pdf') {
            const data = await pdfParse(content);
            return (data.text || '').substring(0, 100000);
        }
        if (ct.includes('opendocument') || ct.includes('openxmlformats') || ct === 'application/msword' || ct === 'application/rtf') {
            return extractOfficeXmlText(content).substring(0, 100000);
        }
    } catch {}
    return '';
};

const parsedMailToIndexRow = (folder: string, msg: any, parsed: any, extraText?: string): MailSearchIndexRow => ({
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
        if (extraText) txt += "\n\n" + extraText;
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

let workerSchemaReady: Promise<void> | null = null;

const ensureWorkerSchema = async () => {
    if (!workerSchemaReady) {
        workerSchemaReady = (async () => {
            await ensureMailSearchSchema();
            await pool.query(`
                CREATE TABLE IF NOT EXISTS mail_search_worker_state (
                    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
                    username VARCHAR(255) NOT NULL,
                    folder VARCHAR(255) NOT NULL,
                    uid_validity VARCHAR(32) NULL,
                    last_uid_indexed BIGINT UNSIGNED NOT NULL DEFAULT 0,
                    last_full_sync_at TIMESTAMP NULL,
                    message_count INT UNSIGNED NOT NULL DEFAULT 0,
                    indexed_count INT UNSIGNED NOT NULL DEFAULT 0,
                    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    UNIQUE KEY uniq_user_folder (username, folder)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            `);
            const [uidValidityColumns]: any = await pool.query(
                'SHOW COLUMNS FROM mail_search_worker_state LIKE "uid_validity"'
            );
            if (uidValidityColumns.length === 0) {
                await pool.query(
                    'ALTER TABLE mail_search_worker_state ADD COLUMN uid_validity VARCHAR(32) NULL AFTER folder'
                );
            }
            await pool.query(`
                CREATE TABLE IF NOT EXISTS mail_search_user_state (
                    username VARCHAR(255) NOT NULL PRIMARY KEY,
                    folders_json MEDIUMTEXT NOT NULL,
                    completed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            `);
        })();
    }
    return workerSchemaReady;
};

/* ---------- Worker state helpers ---------- */

interface WorkerFolderState {
    uidValidity: string;
    lastUidIndexed: number;
    lastFullSyncAt: Date | null;
    messageCount: number;
    indexedCount: number;
}

const getWorkerFolderState = async (username: string, folder: string): Promise<WorkerFolderState> => {
    const [rows]: any = await pool.query(
        'SELECT uid_validity, last_uid_indexed, last_full_sync_at, message_count, indexed_count FROM mail_search_worker_state WHERE username = ? AND folder = ?',
        [username, folder]
    );
    if (rows.length === 0) {
        return { uidValidity: '', lastUidIndexed: 0, lastFullSyncAt: null, messageCount: 0, indexedCount: 0 };
    }
    return {
        uidValidity: String(rows[0].uid_validity || ''),
        lastUidIndexed: Number(rows[0].last_uid_indexed || 0),
        lastFullSyncAt: rows[0].last_full_sync_at || null,
        messageCount: Number(rows[0].message_count || 0),
        indexedCount: Number(rows[0].indexed_count || 0)
    };
};

const updateWorkerFolderState = async (
    username: string,
    folder: string,
    update: Partial<{ uidValidity: string; lastUidIndexed: number; lastFullSyncAt: Date | null; messageCount: number; indexedCount: number }>
) => {
    const uidValidity = update.uidValidity || null;
    const lastUid = update.lastUidIndexed ?? 0;
    const msgCount = update.messageCount ?? 0;
    const idxCount = update.indexedCount ?? 0;
    const lastSync = update.lastFullSyncAt || null;

    await pool.query(
        `INSERT INTO mail_search_worker_state (username, folder, uid_validity, last_uid_indexed, last_full_sync_at, message_count, indexed_count)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
            uid_validity = COALESCE(VALUES(uid_validity), uid_validity),
            last_uid_indexed = GREATEST(last_uid_indexed, VALUES(last_uid_indexed)),
            last_full_sync_at = COALESCE(VALUES(last_full_sync_at), last_full_sync_at),
            message_count = VALUES(message_count),
            indexed_count = VALUES(indexed_count)`,
        [username, folder, uidValidity, lastUid, lastSync, msgCount, idxCount]
    );
};

export const getSearchIndexCoverage = async (username: string, folders: string[]) => {
    await ensureWorkerSchema();
    if (folders.length === 0) return new Map<string, { uidValidity: string; lastUidIndexed: number }>();
    const [rows]: any = await pool.query(
        `SELECT folder, uid_validity, last_uid_indexed
         FROM mail_search_worker_state
         WHERE username = ? AND folder IN (?)`,
        [username, folders]
    );
    return new Map<string, { uidValidity: string; lastUidIndexed: number }>(rows.map((row: any) => [
        row.folder,
        {
            uidValidity: String(row.uid_validity || ''),
            lastUidIndexed: Number(row.last_uid_indexed || 0),
        },
    ]));
};

export interface SearchIndexSnapshot {
    folderPaths: string[];
    uidNextByFolder: Map<string, number>;
    uidValidityByFolder: Map<string, string>;
    ageMs: number;
}

interface StoredSearchFolderSnapshot {
    path: string;
    uidNext: number;
    uidValidity: string;
}

const saveSearchIndexSnapshot = async (username: string, folders: StoredSearchFolderSnapshot[]) => {
    await ensureWorkerSchema();
    await pool.query(
        `INSERT INTO mail_search_user_state (username, folders_json, completed_at)
         VALUES (?, ?, CURRENT_TIMESTAMP)
         ON DUPLICATE KEY UPDATE
            folders_json = VALUES(folders_json),
            completed_at = CURRENT_TIMESTAMP`,
        [username, JSON.stringify(folders)]
    );
};

export const invalidateSearchIndexSnapshot = async (username: string) => {
    await ensureWorkerSchema();
    await pool.query('DELETE FROM mail_search_user_state WHERE username = ?', [username]);
};

export const getFreshSearchIndexSnapshot = async (
    username: string,
    scope: 'folder' | 'all',
    folder: string,
    maxAgeMs = 10 * 60 * 1000,
): Promise<SearchIndexSnapshot | null> => {
    await ensureWorkerSchema();
    const [rows]: any = await pool.query(
        `SELECT folders_json, completed_at
         FROM mail_search_user_state
         WHERE username = ?`,
        [username]
    );
    if (rows.length === 0) return null;

    const completedAt = new Date(rows[0].completed_at);
    const ageMs = Date.now() - completedAt.getTime();
    if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > maxAgeMs) return null;

    let storedFolders: StoredSearchFolderSnapshot[];
    try {
        const parsed = JSON.parse(String(rows[0].folders_json || '[]'));
        if (!Array.isArray(parsed)) return null;
        storedFolders = parsed.filter((item: any) => (
            item && typeof item.path === 'string' && item.path
            && Number.isInteger(Number(item.uidNext)) && Number(item.uidNext) > 0
            && typeof item.uidValidity === 'string' && item.uidValidity
        )).map((item: any) => ({
            path: item.path,
            uidNext: Number(item.uidNext),
            uidValidity: item.uidValidity,
        }));
    } catch {
        return null;
    }

    if (scope === 'folder') {
        storedFolders = storedFolders.filter(item => item.path === folder);
    }
    if (storedFolders.length === 0) return null;

    return {
        folderPaths: storedFolders.map(item => item.path),
        uidNextByFolder: new Map(storedFolders.map(item => [item.path, item.uidNext])),
        uidValidityByFolder: new Map(storedFolders.map(item => [item.path, item.uidValidity])),
        ageMs,
    };
};

export const invalidateSearchIndexFolderIdentity = async (
    username: string,
    folder: string,
    uidValidity: string,
) => {
    await ensureWorkerSchema();
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        await connection.query(
            'DELETE FROM mail_search_index WHERE username = ? AND folder = ?',
            [username, folder]
        );
        await connection.query(
            `INSERT INTO mail_search_worker_state
                (username, folder, uid_validity, last_uid_indexed, last_full_sync_at, message_count, indexed_count)
             VALUES (?, ?, ?, 0, NULL, 0, 0)
             ON DUPLICATE KEY UPDATE
                uid_validity = VALUES(uid_validity),
                last_uid_indexed = 0,
                last_full_sync_at = NULL,
                message_count = 0,
                indexed_count = 0`,
            [username, folder, uidValidity]
        );
        await connection.commit();
    } catch (err) {
        await connection.rollback();
        throw err;
    } finally {
        connection.release();
    }
};

/* ---------- Expunge reconciliation ---------- */

const EXPUNGE_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
let lastExpungeRun = 0;

const reconcileExpungedMessages = async (username: string, folder: string, imap: ImapService) => {
    try {
        const mbx = await imap.client.mailboxOpen(folder);
        try {
            if (mbx.exists === 0) {
                // Folder is empty — delete all indexed messages for this folder
                const [indexedRows]: any = await pool.query(
                    'SELECT uid FROM mail_search_index WHERE username = ? AND folder = ?',
                    [username, folder]
                );
                const staleUids = indexedRows.map((r: any) => Number(r.uid));
                if (staleUids.length > 0) {
                    await deleteMailSearchRows(username, folder, staleUids);
                    console.log(`[SearchWorker] Expunge: removed ${staleUids.length} stale entries for ${username} in ${folder} (folder empty)`);
                }
                return;
            }

            // Get all UIDs currently in the IMAP folder
            const imapUids = await imap.client.search({ all: true }, { uid: true });
            if (!Array.isArray(imapUids) || imapUids.length === 0) return;

            const imapUidSet = new Set(imapUids.map(Number));

            // Get all indexed UIDs for this folder
            const [indexedRows]: any = await pool.query(
                'SELECT uid FROM mail_search_index WHERE username = ? AND folder = ?',
                [username, folder]
            );

            const staleUids: number[] = [];
            for (const row of indexedRows) {
                const uid = Number(row.uid);
                if (!imapUidSet.has(uid)) {
                    staleUids.push(uid);
                }
            }

            if (staleUids.length > 0) {
                await deleteMailSearchRows(username, folder, staleUids);
                console.log(`[SearchWorker] Expunge: removed ${staleUids.length} stale entries for ${username} in ${folder}`);
            }
        } finally {
            await imap.client.mailboxClose();
        }
    } catch (err) {
        console.error(`[SearchWorker] Expunge reconciliation failed for ${username} in ${folder}:`, err);
    }
};

/* ---------- Credential retrieval ---------- */

interface UserCredential {
    username: string;
    password: string;
}

const getAvailableUserCredentials = async (): Promise<UserCredential[]> => {
    const [rows]: any = await pool.query(
        `SELECT username, password_ciphertext, password_iv, password_tag FROM (
            SELECT username, password_ciphertext, password_iv, password_tag FROM webmail_sessions WHERE expires_at > NOW()
            UNION
            SELECT username, password_ciphertext, password_iv, password_tag FROM mailbox_credentials
        ) AS combined`
    );
    const seen = new Set<string>();
    const credentials: UserCredential[] = [];

    for (const row of rows) {
        const username = row.username;
        if (seen.has(username)) continue;
        seen.add(username);
        try {
            const password = decryptPassword(row.password_ciphertext, row.password_iv, row.password_tag);
            credentials.push({ username, password });
        } catch (err) {
            console.error(`[SearchWorker] Failed to decrypt credentials for ${username}:`, err);
        }
    }

    return credentials;
};

/* ---------- Per-user indexing ---------- */

const BATCH_SIZE = 200;

const indexUserFolders = async (credential: UserCredential) => {
    const { username, password } = credential;
    let imap: ImapService | null = null;

    try {
        imap = new ImapService(username, password);
        await imap.connect();
        const folderSnapshot = await imap.getSearchFolderSnapshot();
        const folders = folderSnapshot.folderPaths.map(path => ({ path }));
        const completedFolders: StoredSearchFolderSnapshot[] = [];
        let snapshotComplete = folderSnapshot.failedFolders.length === 0;
        const shouldRunExpunge = Date.now() - lastExpungeRun >= EXPUNGE_INTERVAL_MS;

        for (const folderObj of folders) {
            const folderPath = folderObj.path;

            try {
                // Get worker state for resume tracking
                let state = await getWorkerFolderState(username, folderPath);
                const uidValidity = folderSnapshot.uidValidityByFolder.get(folderPath) || '';
                const observedUidNext = folderSnapshot.uidNextByFolder.get(folderPath) || 0;
                if (!uidValidity) throw new Error(`Missing UIDVALIDITY for ${folderPath}`);
                if (observedUidNext < 1) throw new Error(`Missing UIDNEXT for ${folderPath}`);
                if (state.uidValidity !== uidValidity) {
                    await invalidateSearchIndexFolderIdentity(username, folderPath, uidValidity);
                    state = { uidValidity, lastUidIndexed: 0, lastFullSyncAt: null, messageCount: 0, indexedCount: 0 };
                }
                const maxUid = state.lastUidIndexed;

                // Incremental indexing: fetch new messages since last indexed UID
                const page = await imap.getMessagesSinceUid(folderPath, maxUid + 1, BATCH_SIZE);
                const messages = page.messages;
                if (page.moreAvailable) snapshotComplete = false;
                const rows: MailSearchIndexRow[] = [];
                for (const msg of messages) {
                    const parsed = await simpleParser(msg.source);
                    let extraText = '';
                    if (parsed.attachments && Array.isArray(parsed.attachments)) {
                        for (const att of parsed.attachments) {
                            const txt = await extractAttachmentText(att);
                            if (txt) extraText += `\n\n--- ${att.filename || 'attachment'} ---\n${txt}`;
                        }
                    }
                    rows.push(parsedMailToIndexRow(folderPath, msg, parsed, extraText || undefined));
                }

                if (rows.length > 0) {
                    await upsertMailSearchRows(username, rows);
                    console.log(`[SearchWorker] Indexed ${rows.length} messages for ${username} in ${folderPath}`);
                }

                // Find the highest UID we indexed
                const newMaxUid = rows.reduce((max, row) => Math.max(max, row.uid), maxUid);
                const indexedThroughUid = page.moreAvailable
                    ? newMaxUid
                    : Math.max(newMaxUid, observedUidNext - 1);

                // Get current indexed count for this folder
                const [countRows]: any = await pool.query(
                    'SELECT COUNT(*) AS cnt FROM mail_search_index WHERE username = ? AND folder = ?',
                    [username, folderPath]
                );
                const indexedCount = Number(countRows[0]?.cnt || 0);

                await updateWorkerFolderState(username, folderPath, {
                    uidValidity,
                    lastUidIndexed: indexedThroughUid,
                    messageCount: indexedCount + (rows.length > 0 ? 0 : 0), // will be updated by expunge
                    indexedCount
                });

                // Run expunge reconciliation less frequently
                if (shouldRunExpunge) {
                    await reconcileExpungedMessages(username, folderPath, imap);

                    // Update counts after expunge
                    const [postExpungeRows]: any = await pool.query(
                        'SELECT COUNT(*) AS cnt FROM mail_search_index WHERE username = ? AND folder = ?',
                        [username, folderPath]
                    );
                    const postExpungeCount = Number(postExpungeRows[0]?.cnt || 0);
                    await updateWorkerFolderState(username, folderPath, {
                        uidValidity,
                        lastUidIndexed: indexedThroughUid,
                        lastFullSyncAt: new Date(),
                        messageCount: postExpungeCount,
                        indexedCount: postExpungeCount
                    });
                }
                if (!page.moreAvailable) {
                    completedFolders.push({
                        path: folderPath,
                        uidNext: observedUidNext,
                        uidValidity,
                    });
                }
            } catch (folderErr) {
                snapshotComplete = false;
                console.error(`[SearchWorker] Failed to index folder ${folderPath} for ${username}:`, folderErr);
            }
        }

        if (snapshotComplete && completedFolders.length === folders.length) {
            await saveSearchIndexSnapshot(username, completedFolders);
        }

        if (shouldRunExpunge) {
            lastExpungeRun = Date.now();
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
};

/* ---------- Main indexer entry ---------- */

let searchIndexerRunning = false;

export const runSearchIndexer = async () => {
    if (searchIndexerRunning) {
        console.log('[SearchWorker] Previous indexing cycle is still running, skipping overlap');
        return;
    }
    searchIndexerRunning = true;
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
    } catch (err) {
        console.error("[SearchWorker] General error:", err);
    } finally {
        searchIndexerRunning = false;
    }
};

/* ---------- Status ---------- */

export interface SearchWorkerStatus {
    totalUsers: number;
    totalFolders: number;
    totalIndexedMessages: number;
    lastUpdatedAt: Date | string | null;
    folders: Array<{
        username: string;
        folder: string;
        uidValidity: string;
        lastUidIndexed: number;
        lastFullSyncAt: Date | string | null;
        messageCount: number;
        indexedCount: number;
        updatedAt: Date | string | null;
    }>;
}

export const getSearchWorkerStatus = async (): Promise<SearchWorkerStatus> => {
    await ensureWorkerSchema();

    const [rows]: any = await pool.query(
        `SELECT username, folder, uid_validity, last_uid_indexed, last_full_sync_at, message_count, indexed_count, updated_at
         FROM mail_search_worker_state
         ORDER BY updated_at DESC`
    );

    const userSet = new Set<string>();
    let totalIndexed = 0;
    let lastUpdated: Date | string | null = null;

    const folders = rows.map((row: any) => {
        userSet.add(row.username);
        const idxCount = Number(row.indexed_count || 0);
        totalIndexed += idxCount;
        if (!lastUpdated || (row.updated_at && new Date(row.updated_at) > new Date(lastUpdated as string))) {
            lastUpdated = row.updated_at;
        }
        return {
            username: row.username,
            folder: row.folder,
            uidValidity: String(row.uid_validity || ''),
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

/* ---------- Index purge ---------- */

export const purgeUserSearchIndex = async (username: string) => {
    await ensureMailSearchSchema();
    await ensureWorkerSchema();

    const [result]: any = await pool.query(
        'DELETE FROM mail_search_index WHERE username = ?',
        [username]
    );
    await pool.query(
        'DELETE FROM mail_search_worker_state WHERE username = ?',
        [username]
    );
    await pool.query(
        'DELETE FROM mail_search_user_state WHERE username = ?',
        [username]
    );

    const deletedCount = result.affectedRows || 0;
    console.log(`[SearchWorker] Purged ${deletedCount} index entries for ${username}`);
    return deletedCount;
};

/* ---------- Lifecycle ---------- */

export const startSearchWorker = () => {
    // Run every 5 minutes
    setInterval(runSearchIndexer, 5 * 60 * 1000);
    // Run once on startup after 30 seconds
    setTimeout(runSearchIndexer, 30000);
};
